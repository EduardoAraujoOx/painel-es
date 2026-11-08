import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import amplo as AM  # noqa: E402
import secom as S  # noqa: E402

PAGINA = """<a href="/media/Arquivos/CONTRATO%20002.pdf">Contrato de Presta&#xE7;&#xE3;o de Servi&#xE7;os n&#xBA; 002/2021 (LOTE 01) - CONSOLIDADO</a>
<a href="/media/Arquivos/CONTRATO%20002.pdf">Baixar</a><a href="/media/Arquivos/outro.pdf">Plano de Integridade</a>"""

TEXTO = ("Contrato de Prestação de Serviços nº 002/2021 (LOTE 01) Processo nº 86477200/2019 Concorrência nº 001/2019 e as empresas: "
         "(i) MP PUBLICIDADE LTDA, inscrita no CNPJ nº 31.479.710/0001-70, com sede (ii) AMPLA SERVIÇOS DE PROPAGANDA E PUBLICIDADE LTDA, inscrita no CNPJ nº 11.145.893/0001-80, "
         "3.1 - O valor global anual estimado do Contrato é de R$ 50.000.000,00 (cinquenta milhões de reais). "
         "4.1 - A vigência contratual terá início em 20 de setembro de 2021 e, a partir de então, terá duração de 12 (doze) meses. "
         "4.1.2 ... limitada a 60 (sessenta) meses, desde que "
         "Prorrogar o prazo de vigência do Contrato nº 002/2021 pelo prazo de 12 (doze) meses, a contar de 20/09/2022. "
         "Prorrogar o prazo de vigência do Contrato nº 002/2021 pelo prazo de 12 (doze) meses, a contar de 20/09/2023. "
         "1º Termo Aditivo ao Contrato nº 002/2021 2º Termo Aditivo ao Contrato nº 002/2021 3º Termo Aditivo ao Contrato nº 002/2021 "
         "(i) MP PUBLICIDADE LTDA, inscrita no CNPJ nº 31.479.710/0002-50 (iii) AMPLA SERVIÇOS DE PROPAGANDA E PUBLICIDADE LTDA, inscrita no CNPJ nº 11.145.893/0003-41,")


class LeitorSecom(unittest.TestCase):
    def test_lista_so_os_contratos(self):
        r = S.listar_contratos(PAGINA)
        self.assertEqual(len(r), 1)
        self.assertIn("002/2021", r[0][0])
        self.assertTrue(r[0][1].startswith("https://secom.es.gov.br/media/Arquivos/CONTRATO%20002"))

    def test_le_contrato(self):
        c = S.ler_contrato(S.limpar(TEXTO), "Contrato de Prestação de Serviços nº 002/2021 (LOTE 01) - CONSOLIDADO")
        self.assertEqual((c["numero"], c["lote"], c["processo"], c["licitacao"]), ("002/2021", "01", "86477200/2019", "001/2019"))
        self.assertEqual(c["valorAnual"], 50000000.0)
        self.assertEqual(c["inicio"], "2021-09-20")
        self.assertEqual(c["prorrogacoes"], ["2022-09-20", "2023-09-20"])
        self.assertEqual(c["aditivos"], [1, 2, 3])
        self.assertEqual(c["vigenciaPublicadaAte"], "2024-09-19")
        self.assertEqual(c["limiteLegalAte"], "2026-09-19")
        nomes = {p["nome"]: p for p in c["partes"]}
        self.assertEqual(nomes["MP PUBLICIDADE LTDA"]["cnpjs"], ["31479710000170", "31479710000250"])
        self.assertEqual(nomes["AMPLA SERVIÇOS DE PROPAGANDA E PUBLICIDADE LTDA"]["raizes"], ["11145893"])


class LigacaoComSigefes(unittest.TestCase):
    CONTRATOS = [{"numero": "002/2021", "lote": "01", "licitacao": "001/2019", "valorAnual": 5e7, "inicio": "2021-09-20", "vigenciaPublicadaAte": "2024-09-19", "limiteLegalAte": "2026-09-19",
                  "aditivos": [1, 2, 3], "url": "u", "partes": [{"nome": "AMPLA", "raizes": ["11145893"]}]},
                 {"numero": "003/2021", "lote": "02", "licitacao": "001/2019", "valorAnual": 2.5e7, "inicio": "2021-09-20", "vigenciaPublicadaAte": "2024-09-19", "limiteLegalAte": "2026-09-19",
                  "aditivos": [1], "url": "v", "partes": [{"nome": "MP", "raizes": ["31479710"]}]}]

    def test_liga_pela_licitacao_e_pela_raiz(self):
        r = AM.instrumentos_publicados({"numeroLicitacao": "001/2019", "cnpj": "11145893000341"}, self.CONTRATOS)
        self.assertEqual([x["numero"] for x in r], ["002/2021"])
        self.assertEqual(r[0]["aditivos"], 3)

    def test_outra_licitacao_ou_empresa_nao_liga(self):
        self.assertEqual(AM.instrumentos_publicados({"numeroLicitacao": "002/2020", "cnpj": "11145893000341"}, self.CONTRATOS), [])
        self.assertEqual(AM.instrumentos_publicados({"numeroLicitacao": "001/2019", "cnpj": "99999999000199"}, self.CONTRATOS), [])

    def test_contrato_publicado_reforca_o_indicio(self):
        g = {"codigo": "21003003", "licitacao": "CONCORRÊNCIA", "numeroLicitacao": "001/2019", "mesesLista": ["2025-%02d" % m for m in range(1, 11)], "meses": 10,
             "desde": "2025-01", "ate": "2025-10", "tipo": "contrato", "instrumento": AM.instrumentos_publicados({"numeroLicitacao": "001/2019", "cnpj": "11145893000341"}, self.CONTRATOS)}
        r = AM.qualificar_relacao(g)
        self.assertEqual(r["nivel"], "forte")
        self.assertTrue(any("contrato publicado pelo órgão" in m for m in r["motivos"]))


if __name__ == "__main__":
    unittest.main()
