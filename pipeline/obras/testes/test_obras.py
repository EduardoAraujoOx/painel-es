"""Testes do coletor de obras paralisadas (módulo `obras`). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/obras/testes -v
Não usam rede: partem de uma página de detalhe real salva (detalhe_exemplo.html) e de listas fictícias no formato do portal."""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("obras", AQUI.parent / "coletar.py")
O = importlib.util.module_from_spec(spec)
spec.loader.exec_module(O)
UTC = timezone.utc
EXEMPLO = (AQUI / "detalhe_exemplo.html").read_text(encoding="utf-8")


def pagina(ids, proxima=None):
    links = f'<a href="/Obras/ObrasGeral/ObterObras?Ordenar=Descricao&amp;Situacao=103&amp;page={proxima}">próxima</a>' if proxima else ""
    return "<table>" + "".join(f'<tr><td><a cont-id="{i}">obra {i}</a></td></tr>' for i in ids) + "</table>" + links


def detalhe(situacao="Paralisada (12/10/2026)", valor="R$ 1.000.000,00", objeto="Obra X"):
    return (f"<div><b>Órgão Responsável:</b> <span>SEDU</span> <b>Objeto:</b> <span>{objeto}</span> <b>Município:</b> <span>Vitória</span> "
            f"<b>Contrato / Ano – Nº da Obra:</b> <span>1 / 2024 - 1</span> <b>Data de Assinatura do Contrato:</b> <span>01/02/2024</span> "
            f"<b>Empresa Contratada:</b> <span>11.111.111/0001-11 - EMPRESA LTDA</span> <b>Situação:</b> <span>{situacao}</span> "
            f"<b>Percentual de Execução:</b> <span>40,5%</span> <b>Valor Contratado</b> <b>Inicial:</b> <span>{valor}</span> "
            f"<b>Aditado:</b> <span>R$ 0,00</span> <b>Total:</b> <span>{valor}</span></div>")


class Leitura(unittest.TestCase):
    def test_le_a_pagina_real_de_detalhe(self):
        d = O.ler_detalhe(EXEMPLO, 3666)
        self.assertEqual((d["data_situacao"], d["municipio"], d["assinatura"], d["execucao"], d["valor"]), ("2014-08-29", "Guarapari", "2013-11-26", 67.15, 503194.14))
        self.assertEqual((d["situacao_texto"], d["cnpj"], d["empresa"]), ("Paralisada (29/08/2014)", "10.933.120/0001-03", "ATOL CONSULTORIA AMBIENTAL LTDA"))
        self.assertTrue(d["orgao"].startswith("DER ES"))
        self.assertTrue(d["url"].endswith("/Obras/ObrasDetalhe?id=3666"))

    def test_pagina_inesperada_ou_sem_data_devolve_none(self):
        self.assertIsNone(O.ler_detalhe("<html>erro</html>", 1))
        self.assertIsNone(O.ler_detalhe(detalhe(situacao="Em execução"), 1))  # sem data entre parênteses

    def test_valor_e_tipo(self):
        self.assertEqual(O.valor_br("R$ 12.852.999,28"), 12852999.28)
        self.assertEqual(O.tipo_da_situacao("Paralisada (29/08/2014)"), "paralisada")
        self.assertEqual(O.tipo_da_situacao("Contrato rescindido (01/10/2022)"), "rescindida")
        self.assertIsNone(O.tipo_da_situacao("Em execução"))

    def test_paginacao_da_lista_junta_as_paginas_e_para_sem_proxima(self):
        paginas = {1: pagina(["1", "2"], proxima=2), 2: pagina(["3"])}
        chamadas = []
        def falso(url):
            pg = int(url.rsplit("page=", 1)[1]); chamadas.append(pg); return paginas[pg]
        O.PAUSA, antes = 0, O.PAUSA
        try:
            self.assertEqual(O.ids_da_situacao("103", falso), ["1", "2", "3"])
        finally:
            O.PAUSA = antes
        self.assertEqual(chamadas, [1, 2])


class Comparacao(unittest.TestCase):
    D1 = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)
    D2 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)

    def it(self, i, tipo="paralisada", data="2024-01-19", valor=100.0):
        return {"id": str(i), "tipo": tipo, "data_situacao": data, "valor": valor, "orgao": "SEDU", "municipio": "X", "objeto": f"obra {i}"}

    def test_primeiro_levantamento_e_base_e_nada_e_novo(self):
        r = O.montar({"1": self.it(1), "2": self.it(2, "rescindida", "2023-10-02")}, None, self.D1)
        self.assertTrue(r["baseline"])
        self.assertEqual((r["novos"], r["contagem"], [i["visto_em"] for i in r["itens"]]), ([], {"paralisada": 1, "rescindida": 1}, [None, None]))
        self.assertEqual(r["valor"]["paralisada"], 100.0)

    def test_obra_nova_na_lista_e_obra_que_mudou_de_situacao_sao_novidade(self):
        r1 = O.montar({"1": self.it(1), "2": self.it(2)}, None, self.D1)
        r2 = O.montar({"1": self.it(1, "rescindida", "2026-11-01"), "2": self.it(2), "3": self.it(3, data="2026-10-20")}, r1, self.D2)
        self.assertEqual(sorted(r2["novos"]), ["1", "3"])
        por_id = {i["id"]: i for i in r2["itens"]}
        self.assertEqual(por_id["3"]["visto_em"], "2026-11-01T12:00:00Z")
        self.assertIsNone(por_id["2"]["visto_em"])  # a antiga continua sem data de detecção

    def test_obra_que_saiu_da_situacao_vai_para_saidas(self):
        r1 = O.montar({"1": self.it(1), "2": self.it(2)}, None, self.D1)
        r2 = O.montar({"2": self.it(2)}, r1, self.D2)
        self.assertEqual([s["id"] for s in r2["saidas"]], ["1"])
        self.assertEqual(r2["saidas"][0]["saiu_em"], "2026-11-01T12:00:00Z")

    def test_contagem_desde_o_corte_e_ordem_da_mais_recente(self):
        r = O.montar({"1": self.it(1, data="2026-10-04"), "2": self.it(2, data="2026-10-03"), "3": self.it(3, data="2026-11-02")}, None, self.D1)
        self.assertEqual(r["desde_corte"]["paralisada"], 2)  # 04/10 conta, 03/10 não
        self.assertEqual([i["id"] for i in r["itens"]], ["3", "1", "2"])

    def test_mudou_ignora_a_hora_de_geracao(self):
        r1 = O.montar({"1": self.it(1)}, None, self.D1)
        r2 = O.montar({"1": self.it(1)}, r1, self.D2)
        self.assertFalse(O.mudou(r1, r2))
        self.assertTrue(O.mudou(r2, O.montar({"1": self.it(1), "2": self.it(2)}, r2, self.D2)))


class Coleta(unittest.TestCase):
    def falso(self, lista, detalhes, falhar=()):
        chamadas = []
        def f(url):
            chamadas.append(url)
            if "ObterObras" in url:
                cod = url.split("Situacao=")[1].split("&")[0]
                return pagina(lista.get(cod, []))
            i = url.rsplit("id=", 1)[1]
            if i in falhar:
                raise RuntimeError("fora do ar")
            return detalhes[i]
        return f, chamadas

    def test_le_as_duas_listas_e_o_detalhe_de_cada_obra(self):
        f, _ = self.falso({"103": ["1"], "104": ["2"]}, {"1": detalhe("Paralisada (12/10/2026)"), "2": detalhe("Contrato rescindido (03/10/2023)")})
        atuais, falhas = O.coletar(None, f, pausa=0)
        self.assertEqual((atuais["1"]["tipo"], atuais["1"]["data_situacao"], atuais["2"]["tipo"], falhas), ("paralisada", "2026-10-12", "rescindida", []))

    def test_rescindida_ja_guardada_nao_e_baixada_de_novo_mas_paralisada_sim(self):
        anterior = {"itens": [{"id": "1", "tipo": "paralisada", "data_situacao": "2024-01-01", "visto_em": None},
                              {"id": "2", "tipo": "rescindida", "data_situacao": "2023-10-02", "visto_em": None}]}
        f, chamadas = self.falso({"103": ["1"], "104": ["2"]}, {"1": detalhe("Paralisada (12/10/2026)")})
        atuais, _ = O.coletar(anterior, f, pausa=0)
        self.assertEqual(atuais["1"]["data_situacao"], "2026-10-12")  # a data da paralisada foi atualizada
        self.assertFalse(any(u.endswith("id=2") for u in chamadas))  # rescindida guardada não foi baixada

    def test_falha_no_detalhe_mantem_a_obra_guardada_e_nao_inventa_a_nova(self):
        anterior = {"itens": [{"id": "1", "tipo": "paralisada", "data_situacao": "2024-01-01", "valor": 5.0}]}
        f, _ = self.falso({"103": ["1", "9"]}, {}, falhar=("1", "9"))
        atuais, falhas = O.coletar(anterior, f, pausa=0)
        self.assertEqual(sorted(falhas), ["1", "9"])
        self.assertIn("1", atuais)  # mantida a versão guardada
        self.assertNotIn("9", atuais)  # nova sem detalhe: fica para a próxima coleta

    def test_situacao_que_mudou_entre_a_lista_e_o_detalhe_nao_entra(self):
        f, _ = self.falso({"103": ["1"]}, {"1": detalhe("Concluída (01/10/2026)")})
        atuais, falhas = O.coletar(None, f, pausa=0)
        self.assertEqual((atuais, falhas), ({}, ["1"]))


if __name__ == "__main__":
    unittest.main()
