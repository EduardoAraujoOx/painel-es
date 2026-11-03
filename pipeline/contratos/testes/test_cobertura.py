"""Testes dos sinais de cobertura do módulo `contratacoes`: situação encerrada com prazo em aberto e pagamento depois do fim do contrato.
Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/contratos/testes -v
Não usam rede nem os arquivos do cache: partem de registros fictícios no formato interno do `montar.py`."""

import datetime
import importlib.util
import sys
import unittest
from pathlib import Path

PASTA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PASTA))
import regras as R  # noqa: E402

REF = datetime.date(2026, 11, 3)


def carregar_montar():
    """Importa o montar.py com a data de referência fixa (ele lê a data de sys.argv ao ser importado)."""
    antes = sys.argv
    sys.argv = ["montar.py", REF.isoformat()]
    try:
        spec = importlib.util.spec_from_file_location("montar_teste", PASTA / "montar.py")
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        return modulo
    finally:
        sys.argv = antes


M = carregar_montar()


def contrato(situacao, fim, **extra):
    c = {"inst": "contrato", "sit": situacao, "fim_ef": fim, "fim": fim, "cel": datetime.date(2025, 1, 10), "ini": datetime.date(2025, 1, 10),
         "vini": 1_000_000.0, "vfin": 1_000_000.0, "emp": {}, "emp_tot": 0.0, "nes": set(), "cat": "Mão de obra e serviços de apoio",
         "objeto": "Serviços de limpeza", "n_pror": 0, "modal": "Pregão", "fora_siga": False}
    c.update(extra)
    return c


def codigos(c):
    return {a for a, _ in M.avaliar_contrato(c)["alertas"]}


class Situacoes(unittest.TestCase):
    def test_finalizado_e_diferente_de_rescisao(self):
        for sit in ("Instrumento Contratual Finalizado", "ENCERRADO", "Extinto", "Instrumento Contratual Finalizado "):
            self.assertTrue(R.finalizado(sit), sit)
        for sit in ("Rescisão Contratual", "Instrumento Contratual Anulado", "Instrumento Contratual em Execução", "CELEBRADO", "", None):
            self.assertFalse(R.finalizado(sit), sit)

    def test_variante_longa_do_siga_conta_como_encerrada(self):
        longa = "Instrumento Contratual Finalizado (quando não houver mais informações a serem prestadas sobre o instrumento contratual e sua execução)"
        self.assertTrue(R.encerrado(longa))
        self.assertTrue(R.finalizado(longa))
        self.assertFalse(R.encerrado("Instrumento Contratual em Execução"))


class SituacaoDivergente(unittest.TestCase):
    def test_finalizado_com_prazo_futuro_gera_alerta_e_nao_e_vigente(self):
        c = M.avaliar_contrato(contrato("Instrumento Contratual Finalizado", datetime.date(2027, 3, 9)))
        self.assertFalse(c["vigente"])
        self.assertIn("situacao_divergente", {a for a, _ in c["alertas"]})

    def test_prazo_ja_vencido_nao_gera_o_alerta(self):
        self.assertNotIn("situacao_divergente", codigos(contrato("Instrumento Contratual Finalizado", datetime.date(2026, 6, 30))))

    def test_fim_exatamente_na_data_de_referencia_conta_como_prazo_em_aberto(self):
        self.assertIn("situacao_divergente", codigos(contrato("ENCERRADO", REF)))

    def test_rescisao_e_anulacao_nao_geram_o_alerta(self):
        for sit in ("Rescisão Contratual", "Instrumento Contratual Anulado"):
            self.assertNotIn("situacao_divergente", codigos(contrato(sit, datetime.date(2027, 3, 9))), sit)

    def test_contrato_em_execucao_continua_vigente_sem_alerta(self):
        c = M.avaliar_contrato(contrato("Instrumento Contratual em Execução", datetime.date(2027, 3, 9)))
        self.assertTrue(c["vigente"])
        self.assertNotIn("situacao_divergente", {a for a, _ in c["alertas"]})

    def test_avulso_nao_gera_o_alerta(self):
        c = contrato("Instrumento Contratual Finalizado", datetime.date(2027, 3, 9), inst="avulso")
        self.assertNotIn("situacao_divergente", codigos(c))

    def test_catalogo_tem_texto_e_orientacao(self):
        for codigo in ("situacao_divergente", "pago_apos_fim"):
            self.assertIn(codigo, R.ALERTAS)
            self.assertIn(codigo, R.ESCLARECER)


class PagoAposFim(unittest.TestCase):
    MENSAL = {"2025-10": 40_000.0, "2025-11": 41_000.0, "2025-12": 42_000.0, "2026-01": 43_000.0, "2026-02": 44_000.0}

    def test_carencia_de_dois_meses(self):
        # fim em 21/10/2025: contam só os meses depois de dezembro de 2025
        total, primeiro = R.pago_apos(datetime.date(2025, 10, 21), self.MENSAL)
        self.assertEqual(total, 87_000.0)
        self.assertEqual(primeiro, "2026-01")

    def test_virada_de_ano(self):
        total, primeiro = R.pago_apos(datetime.date(2025, 11, 30), {"2026-01": 10.0, "2026-02": 20.0})
        self.assertEqual((total, primeiro), (20.0, "2026-02"))   # nov + 2 = jan: janeiro ainda está na carência

    def test_sem_data_de_fim_ou_sem_pagamento_posterior(self):
        self.assertEqual(R.pago_apos(None, self.MENSAL), (0.0, None))
        self.assertEqual(R.pago_apos(datetime.date(2026, 2, 1), self.MENSAL), (0.0, None))

    def test_ignora_meses_com_valor_zero_ou_negativo(self):
        total, primeiro = R.pago_apos(datetime.date(2025, 1, 31), {"2025-06": 0.0, "2025-07": -5.0, "2025-08": 7.0})
        self.assertEqual((total, primeiro), (7.0, "2025-08"))

    def test_carencia_ajustavel(self):
        total, _ = R.pago_apos(datetime.date(2025, 10, 21), self.MENSAL, carencia_meses=0)
        self.assertEqual(total, 42_000.0 + 43_000.0 + 44_000.0 + 41_000.0)


if __name__ == "__main__":
    unittest.main()
