"""Testes do detector de contratos suspensos (módulo `suspensos`). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/contratos/testes -v
Não usam rede: partem de linhas fictícias no formato dos CSV do SIGA."""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("suspensos", Path(__file__).resolve().parents[1] / "suspensos.py")
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)
UTC = timezone.utc


def linha(i, situacao, orgao="SECRETARIA DE ESTADO DA JUSTIÇA", cel="10/03/2025 00:00:00", fim="10/03/2027 00:00:00", valor="1234,56", ano="2025", **extra):
    return {"Id": str(i), "IdOrgao": "85", "NomeOrgao": orgao, "NumeroDocumento": f"CT{i}", "TipoDocumento": "Contrato", "Fornecedor": f"Fornecedor {i}",
            "CnpjFornecedor": "00000000000191", "Objeto": f"Objeto   do contrato {i}", "Situacao": situacao, "DataCelebracao": cel, "DataFimVigencia": fim,
            "ValorInicial": valor, "ValorFinal": valor, "_ano": ano, **extra}


def K(i):
    """Identidade (chave) do contrato fictício i, como o detector a calcula: não depende do campo Id do SIGA."""
    return f"85|CT{i}|Contrato|00000000000191|2025-03-10"


class Classificacao(unittest.TestCase):
    def test_categoria(self):
        self.assertEqual(S.categoria("Instrumento Contratual com Execução Suspensa"), "suspenso")
        self.assertEqual(S.categoria("Instrumento Contratual Suspenso"), "suspenso")
        self.assertEqual(S.categoria("Rescisão Contratual"), "rescindido")
        self.assertEqual(S.categoria("Instrumento Contratual Anulado"), "anulado")
        self.assertEqual(S.categoria("Instrumento Contratual Revogado"), "anulado")
        for normal in ("Instrumento Contratual em Execução", "Instrumento Contratual Finalizado", "ENCERRADO", "", None):
            self.assertIsNone(S.categoria(normal))

    def test_valores_e_datas_no_formato_brasileiro(self):
        self.assertEqual(S.valor_br("6361,60"), 6361.60)
        self.assertEqual(S.valor_br("1.234.567,89"), 1234567.89)
        self.assertIsNone(S.valor_br(""))
        self.assertEqual(S.data_iso("16/04/2026 00:00:00"), "2026-04-16")
        self.assertIsNone(S.data_iso("sem data"))

    def test_relevancia(self):
        self.assertTrue(S.relevante("suspenso", "2018-01-01", "2019-01-01", 2026))       # suspenso conta sempre
        self.assertFalse(S.relevante("rescindido", "2019-05-01", "2020-05-01", 2026))     # rescisão antiga não é alerta
        self.assertTrue(S.relevante("rescindido", "2023-05-01", "2024-05-01", 2026))      # do mandato atual
        self.assertTrue(S.relevante("anulado", "2020-05-01", "2026-12-31", 2026))         # ainda em vigência neste ano

    def test_extrair_filtra_normaliza_e_ignora_situacao_normal(self):
        linhas = [linha(1, "Instrumento Contratual com Execução Suspensa"), linha(2, "Instrumento Contratual em Execução"),
                  linha(3, "Rescisão Contratual", cel="01/01/2019 00:00:00", fim="01/01/2020 00:00:00")]
        itens = S.extrair(linhas, 2026)
        self.assertEqual(list(itens), [K(1)])
        self.assertEqual(itens[K(1)]["objeto"], "Objeto do contrato 1")  # espaços repetidos viram um
        self.assertEqual((itens[K(1)]["categoria"], itens[K(1)]["valor_final"], itens[K(1)]["fim"]), ("suspenso", 1234.56, "2027-03-10"))


class Comparacao(unittest.TestCase):
    D1 = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)
    D2 = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)
    D3 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)

    def base(self):
        return S.montar(S.extrair([linha(1, "Instrumento Contratual Suspenso")], 2026), None, self.D1)

    def test_primeiro_levantamento_e_so_base_de_comparacao(self):
        r = self.base()
        self.assertTrue(r["baseline"])
        self.assertEqual((r["novos"], r["itens"][0]["visto_em"]), ([], None))  # nada é "novo" na primeira vez
        self.assertEqual(r["contagem"], {"suspenso": 1, "rescindido": 0, "anulado": 0})

    def test_novo_suspenso_aparece_como_novo_com_a_data_da_deteccao(self):
        r2 = S.montar(S.extrair([linha(1, "Instrumento Contratual Suspenso"), linha(2, "Instrumento Contratual com Execução Suspensa")], 2026), self.base(), self.D2)
        self.assertEqual(r2["novos"], [K(2)])
        por_id = {i["id"]: i for i in r2["itens"]}
        self.assertEqual(por_id[K(2)]["visto_em"], "2026-10-31T12:00:00Z")
        self.assertIsNone(por_id[K(1)]["visto_em"])  # o antigo continua sem data de detecção

    def test_mudanca_de_situacao_e_novidade(self):
        r2 = S.montar(S.extrair([linha(1, "Rescisão Contratual")], 2026), self.base(), self.D2)
        self.assertEqual(r2["novos"], [K(1)])  # suspenso virou rescindido

    def test_o_que_deixou_de_estar_suspenso_vai_para_saidas(self):
        r2 = S.montar(S.extrair([], 2026), self.base(), self.D2)
        self.assertEqual([s["id"] for s in r2["saidas"]], [K(1)])
        self.assertEqual(r2["saidas"][0]["saiu_em"], "2026-10-31T12:00:00Z")
        self.assertEqual(r2["contagem"]["suspenso"], 0)

    def test_serie_so_ganha_ponto_quando_a_contagem_muda(self):
        r1 = self.base()
        r2 = S.montar(S.extrair([linha(1, "Instrumento Contratual Suspenso")], 2026), r1, self.D2)
        self.assertEqual(len(r2["serie"]), 1)
        r3 = S.montar(S.extrair([linha(1, "Instrumento Contratual Suspenso"), linha(2, "Instrumento Contratual Suspenso")], 2026), r2, self.D3)
        self.assertEqual([p["suspenso"] for p in r3["serie"]], [1, 2])

    def test_renumeracao_do_id_do_siga_nao_gera_novidade(self):
        # O SIGA renumera o campo Id a cada publicação (62778 virou 45536): o mesmo contrato não pode parecer saída + entrada.
        r1 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in (1, 2, 3)], 2026), None, self.D1)
        r2 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso", **{"Id": str(900 + i)}) for i in (1, 2, 3)], 2026), r1, self.D2)
        self.assertEqual((r2["novos"], r2["saidas"]), ([], []))
        self.assertTrue(all(i["visto_em"] is None for i in r2["itens"]))

    def test_levantamento_gravado_com_regra_antiga_de_id_casa_pela_identidade(self):
        r1 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in (1, 2, 3)], 2026), None, self.D1)
        for it in r1["itens"]:
            it["id"] = "numero-antigo-" + it["documento"]  # id gravado por versão anterior do detector
        r2 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in (1, 2, 3)], 2026), r1, self.D2)
        self.assertEqual((r2["novos"], r2["saidas"]), ([], []))

    def test_trava_contra_tudo_novo_de_uma_vez(self):
        # Se, por qualquer mudança na identificação, mais da metade aparece como nova de uma vez, não é notícia: vira nova base.
        antigos = S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in range(1, 31)], 2026)
        r1 = S.montar(antigos, None, self.D1)
        outros = S.extrair([linha(i, "Instrumento Contratual Suspenso", cel="11/04/2025 00:00:00") for i in range(1, 31)], 2026)  # outra data de celebração: outra chave
        r2 = S.montar(outros, r1, self.D2)
        self.assertEqual(r2["novos"], [])
        self.assertTrue(all(i["visto_em"] is None for i in r2["itens"]))

    def test_suspensao_em_massa_de_verdade_continua_sendo_novidade(self):
        # 40 suspensos novos de uma vez, sem os antigos saírem: é exatamente o sinal que o detector existe para mostrar.
        r1 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in range(1, 31)], 2026), None, self.D1)
        r2 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in range(1, 71)], 2026), r1, self.D2)
        self.assertEqual(len(r2["novos"]), 40)

    def test_poucos_novos_continuam_sendo_novos_mesmo_com_muitos_itens(self):
        r1 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in range(1, 31)], 2026), None, self.D1)
        r2 = S.montar(S.extrair([linha(i, "Instrumento Contratual Suspenso") for i in range(1, 33)], 2026), r1, self.D2)
        self.assertEqual(sorted(r2["novos"]), sorted([K(31), K(32)]))

    def test_mudou_ignora_a_hora_de_geracao(self):
        r1 = self.base()
        r2 = S.montar(S.extrair([linha(1, "Instrumento Contratual Suspenso")], 2026), r1, self.D2)
        self.assertFalse(S.mudou(r1, r2))  # mesmo conjunto, outra hora: não republica
        r3 = S.montar(S.extrair([linha(1, "Instrumento Contratual Suspenso"), linha(2, "Instrumento Contratual Suspenso")], 2026), r2, self.D3)
        self.assertTrue(S.mudou(r2, r3))

    def test_por_orgao_agrega_e_ordena(self):
        itens = S.extrair([linha(1, "Instrumento Contratual Suspenso"), linha(2, "Instrumento Contratual Suspenso"),
                           linha(3, "Instrumento Contratual Suspenso", orgao="DER")], 2026)
        agr = S.por_orgao(itens)
        self.assertEqual((agr[0]["orgao"], agr[0]["suspenso"]), ("SECRETARIA DE ESTADO DA JUSTIÇA", 2))


if __name__ == "__main__":
    unittest.main()
