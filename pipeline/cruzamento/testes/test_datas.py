"""Testes das datas dos suspensos e rescindidos. Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/cruzamento/testes -v
Não usam rede: partem de instrumentos, atos, cruzamento e obras fictícios nos formatos dos arquivos de data/."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("datas", Path(__file__).resolve().parents[1] / "datas.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

DER = "DEPARTAMENTO DE EDIFICACOES E DE RODOVIAS DO ESTADO DO ESPIRITO SANTO"


def item(doc="Contrato 102/2022", cat="suspenso", forn="D. FERNANDES CONSTRUCOES E SERVICOS AMBIENTAIS EIRELI", cnpj="20227181000109", orgao=DER, visto=None, i="x"):
    return {"id": i, "orgao": orgao, "documento": doc, "tipo": "Contrato", "fornecedor": forn, "cnpj": cnpj, "categoria": cat, "visto_em": visto}


def obra(contrato="102 / 2022 - 1", tipo="paralisada", data="2026-09-01", cnpj="20.227.181/0001-09", empresa="D. FERNANDES CONSTRUCOES LTDA", orgao=DER, i="o1"):
    return {"id": i, "contrato": contrato, "tipo": tipo, "data_situacao": data, "cnpj": cnpj, "empresa": empresa, "orgao": orgao, "url": "https://x/" + i}


def ato(tipo="paralisacao", data="2026-10-20", i="a1"):
    return {"id": i, "tipo": tipo, "data": data, "url": "https://d/" + i}


def cruz_de(it, i="a1"):
    return {i: {"siga": {"documento": it["documento"], "orgao": it["orgao"], "fornecedor": it["fornecedor"]}}}


class Datas(unittest.TestCase):
    def test_diario_vale_mais_que_obras_e_painel(self):
        it = item(visto="2026-10-31T10:00:00Z")
        d = D.calcular([it], [ato()], cruz_de(it), [obra()])
        self.assertEqual((d["x"]["fonte"], d["x"]["data"]), ("diario", "2026-10-20"))

    def test_ato_de_outra_situacao_nao_data_o_instrumento(self):
        it = item(cat="suspenso")
        d = D.calcular([it], [ato(tipo="rescisao")], cruz_de(it), [])
        self.assertNotIn("x", d)

    def test_ato_ligado_a_outro_contrato_nao_vale(self):
        it, outro = item(), item(doc="Contrato 999/2022", i="y")
        d = D.calcular([it], [ato()], cruz_de(outro), [])
        self.assertNotIn("x", d)

    def test_ato_mais_recente_vence(self):
        it = item()
        cruz = {**cruz_de(it, "a1"), **cruz_de(it, "a2")}
        d = D.calcular([it], [ato(data="2026-10-10", i="a1"), ato(data="2026-10-25", i="a2")], cruz, [])
        self.assertEqual(d["x"]["data"], "2026-10-25")

    def test_obras_pelo_numero_ano_e_cnpj(self):
        d = D.calcular([item()], [], {}, [obra()])
        self.assertEqual((d["x"]["fonte"], d["x"]["data"]), ("obras", "2026-09-01"))
        self.assertEqual(d["x"]["url"], "https://x/o1")

    def test_cnpj_diferente_nao_casa_mesmo_com_mesmo_numero(self):
        d = D.calcular([item()], [], {}, [obra(cnpj="11.111.111/0001-11")])
        self.assertNotIn("x", d)

    def test_sem_cnpj_vale_orgao_e_empresa(self):
        it = item(cnpj="")
        self.assertIn("x", D.calcular([it], [], {}, [obra(cnpj="")]))
        self.assertNotIn("x", D.calcular([it], [], {}, [obra(cnpj="", empresa="OUTRA EMPRESA DE PINTURA LTDA")]))
        self.assertNotIn("x", D.calcular([it], [], {}, [obra(cnpj="", orgao="SECRETARIA DE ESTADO DA SAÚDE")]))

    def test_situacao_da_obra_precisa_equivaler(self):
        self.assertNotIn("x", D.calcular([item(cat="suspenso")], [], {}, [obra(tipo="rescindida")]))
        self.assertIn("x", D.calcular([item(cat="rescindido")], [], {}, [obra(tipo="rescindida")]))

    def test_varias_obras_do_contrato_vale_a_mais_recente(self):
        d = D.calcular([item()], [], {}, [obra(data="2026-05-01", i="o1"), obra(contrato="102 / 2022 - 2", data="2026-09-15", i="o2")])
        self.assertEqual(d["x"]["data"], "2026-09-15")
        self.assertIn("2 obras", d["x"]["texto"])

    def test_painel_e_o_ultimo_recurso_e_sem_nada_nao_entra(self):
        d = D.calcular([item(visto="2026-10-31T10:00:00Z"), item(i="y", doc="Contrato 5/2020")], [], {}, [])
        self.assertEqual((d["x"]["fonte"], d["x"]["data"]), ("painel", "2026-10-31"))
        self.assertNotIn("y", d)

    def test_so_contrato_casa_com_obra_e_formatos_do_siga(self):
        ordem = {**item(doc="Ordem de Execução de Serviço 102/2022"), "tipo": "Ordem de Execução de Serviço"}
        self.assertNotIn("x", D.calcular([ordem], [], {}, [obra()]))
        for doc in ("Contrato 00102/2022", "Contrato 2022.000102.50101.01/2022"):
            self.assertIn("x", D.calcular([item(doc=doc)], [], {}, [obra()]), doc)

    def test_resumo(self):
        its = [item(), item(i="y", doc="Contrato 5/2020")]
        d = D.calcular(its, [], {}, [obra()])
        self.assertEqual(D.resumo(d, its), {"total": 2, "com_data": 1, "diario": 0, "obras": 1, "painel": 0})


if __name__ == "__main__":
    unittest.main()
