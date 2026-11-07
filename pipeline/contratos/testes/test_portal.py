"""Testes da conferência com o Portal da Transparência em portal.py. Sem rede."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("portal", Path(__file__).resolve().parents[1] / "portal.py")
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

HTML = ('<tr><td>1 de 3</td></tr> var resultado = [{"IdOrgao":175,"NomeOrgao":"SECOM","ValorTotalInicial":747281.79,"ValorTotalFinal":747281.79,"CnpjFornecedor":""}]; '
        'var graficoValorInicial = [];')


class Leitura(unittest.TestCase):
    def test_numero_brasileiro(self):
        self.assertEqual(P.numero("1.234,56"), 1234.56)
        self.assertEqual(P.numero("16129,20"), 16129.2)
        self.assertEqual(P.numero(""), 0.0)
        self.assertEqual(P.numero("x"), 0.0)

    def test_pagina_do_portal(self):
        lista, n = P.extrair_pagina(HTML)
        self.assertEqual(lista[0]["IdOrgao"], 175)
        self.assertEqual(n, 3)
        self.assertEqual(P.extrair_pagina("sem tabela"), ([], 1))

    def test_soma_do_siga_por_orgao(self):
        linhas = [{"IdOrgao": "40", "NomeOrgao": "ADERES", "ValorInicial": "100,50", "ValorFinal": "120,50"},
                  {"IdOrgao": "40", "NomeOrgao": "ADERES", "ValorInicial": "1.000,00", "ValorFinal": "1.000,00"}]
        self.assertEqual(P.somar_siga(linhas), {"40": ["ADERES", 1100.5, 1120.5, 2]})


class Comparacao(unittest.TestCase):
    def test_identicos_divergentes_e_orgaos_so_de_um_lado(self):
        portal = {"1": ["A", 100.0, 110.0], "2": ["B", 200.0, 200.0], "3": ["C", 50.0, 50.0]}
        siga = {"1": ["A", 100.0, 110.0, 5], "2": ["B", 250.0, 250.0, 7], "9": ["Z", 10.0, 10.0, 1]}
        r = P.comparar(portal, siga)
        self.assertEqual((r["orgaos"], r["identicos"], r["nDivergentes"]), (3, 1, 1))
        self.assertEqual(r["divergentes"][0]["id"], "2")
        self.assertEqual(r["divergentes"][0]["diferenca"], 50.0)
        self.assertEqual([x["id"] for x in r["soPortal"]], ["3"])
        self.assertEqual([x["id"] for x in r["soSiga"]], ["9"])

    def test_tolerancia_de_arredondamento(self):
        r = P.comparar({"1": ["A", 100.0, 100.0]}, {"1": ["A", 100.4, 99.6, 1]})
        self.assertEqual(r["identicos"], 1)


if __name__ == "__main__":
    unittest.main()
