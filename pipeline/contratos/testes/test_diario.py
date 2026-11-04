"""Testes da leitura do Diário Oficial em diario.py. Sem rede: usa o texto (público) do termo de rescisão publicado em 05/10/2026."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("diario", Path(__file__).resolve().parents[1] / "diario.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

# Texto como o pdftotext o devolve: atos vizinhos misturados e marcas <#DIOES#protocolo#...> abrindo e fechando cada publicação.
EDICAO = ("Protocolo 1880977\n<#DIOES#1880386#1#2034702/>\nSecretaria de Estado do Governo - SEG -\n<#DIOES#1880977#1#2035351/>\n"
          "Vice-Governadoria do Estado\n\n<#DIOES#1880890#1#2035258>\n\nTERMO\nDE\nRESCISÃO\nUNILATERAL\nDO\nCONTRATO\nDO\nCONTRATO\nNº\n"
          "2024.000050.10109.01\nPROCESSO\nADMINISTRATIVO Nº 2024-P9NG2\n\n<#DIOES#1880386#1#2034702>\n\nORDEM DE SERVIÇO Nº 005\n"
          "Art. 1º Designar as servidoras abaixo para exercer a função de Agente de Contratação.\n\n"
          "Contratante: Secretaria de Estado do Governo\n- SEG.\nProcesso: 2024-NG2\nContratada: GARTNER DO BRASIL SERVICOS\nDE PESQUISAS LTDA\n"
          "CNPJ: 02.593.165/0001-40\nDA\nRESCISÃO:\nfica\nneste\nato\nunilateralmente rescindido o Contrato nº\n2024.000050.10109.01,\n"
          "cujo objeto é a prestação de serviços acesso a dados de conhecimento.\nPEDRO CAÇADOR NETO\nProtocolo 1880890\n<#DIOES#1880890#1#2035258/>\n"
          "\fPágina dois: Termo Aditivo ao Contrato nº 2025.000010.10109.01 com prorrogação de prazo.\n")


class Marcas(unittest.TestCase):
    def test_protocolo_da_publicacao(self):
        spans = D.spans_protocolo(EDICAO)
        self.assertEqual(D.protocolo_em(EDICAO, spans, EDICAO.find("RESCISÃO:")), "1880890")
        self.assertEqual(D.protocolo_em(EDICAO, spans, 0), "")


class Atos(unittest.TestCase):
    def test_rescisao_pelo_numero_do_contrato(self):
        atos = D.atos_da_edicao(EDICAO, set())
        resc = [a for a in atos if a["n"] == "2024.000050.10109.01"]
        self.assertTrue(resc)
        self.assertEqual({a["t"] for a in resc}, {"Rescisão"})
        self.assertEqual({a["p"] for a in resc}, {"1880890"})
        self.assertNotIn("<#DIOES", resc[0]["x"])
        self.assertIn("2024-P9NG2", resc[0]["np"])

    def test_cnpj_do_siga_liga_o_ato_quando_ha_tipo(self):
        atos = D.atos_da_edicao(EDICAO, {"02593165000140"})
        self.assertTrue(any(a["c"] == "02593165000140" and a["t"] == "Rescisão" for a in atos))

    def test_cnpj_fora_da_lista_nao_gera_ato(self):
        self.assertFalse(any(a["c"] for a in D.atos_da_edicao(EDICAO, {"11111111000111"})))

    def test_pagina_pelo_avanco_de_pagina(self):
        atos = D.atos_da_edicao(EDICAO, set())
        adit = [a for a in atos if a["n"] == "2025.000010.10109.01"]
        self.assertEqual(adit[0]["pg"], 2)
        self.assertEqual(adit[0]["t"], "Aditivo ou prorrogação")
        self.assertEqual([a["pg"] for a in atos if a["n"] == "2024.000050.10109.01"][0], 1)


class Tipos(unittest.TestCase):
    def test_precedencia(self):
        self.assertEqual(D.classificar("termo aditivo e termo de rescisão"), "Rescisão")
        self.assertEqual(D.classificar("aplicação de penalidade de multa"), "Penalidade")
        self.assertEqual(D.classificar("apostilamento ao contrato"), "Apostilamento")
        self.assertEqual(D.classificar("lista de empresas"), "Citação")


if __name__ == "__main__":
    unittest.main()
