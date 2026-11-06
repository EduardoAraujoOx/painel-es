"""Testes do coletor de decretos e normas do Diário Oficial (módulo `normas`). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/normas/testes -v
Não usam rede: partem de títulos reais do Diário (04/11/2026) e de um trecho do texto do decreto 6518-R."""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("normas", Path(__file__).resolve().parents[1] / "coletar.py")
N = importlib.util.module_from_spec(spec)
spec.loader.exec_module(N)
UTC = timezone.utc

GOV = ["Poder Executivo", "Governadoria do Estado", "Decretos"]


class Classificacao(unittest.TestCase):
    def test_decretos_regulamentares_da_serie_r_entram(self):
        casos = {"#1897760 - DECRETO Nº 6518-R - Encerramento de exercício - 2026": ["encerramento"],
                 "#1896124 - DECRETO Nº 6514-R - Altera RICMS-ES - isenção preservativos": ["tributario"],
                 "#1897756 - DECRETO Nº 6517-R - Retificacao IPM provisório 2027 (1)": ["tributario"],
                 "#1898690 - DECRETO Nº 6520-R - Transformação de cargos SESPORT_SEG_03.11.26 - DIO": ["cargos"]}
        for t, temas in casos.items():
            self.assertEqual(N.classificar(t, GOV + ["Decreto R"]), ("decreto", temas), t)

    def test_decreto_de_pessoa_serie_s_fica_de_fora_mas_a_transicao_entra(self):
        for t in ("#1894913 - DECRETO Nº 2215-S - Agregar o 1º Ten QOAPM Reginaldo Jorge de Oliveira - 2026-JQB7J - DIO",
                  "#1881714 - DECRETO Nº 2086-S - Cessar efeitos Decreto N° 1991-S - Designar Ronaldo Endlich Schmidt Filho - PROCON",
                  "#1898376 - DECRETO Nº 2282-S - Nomear Rodolfo Augusto dos Anjos Mageste - SESPORT - DIO"):
            self.assertIsNone(N.classificar(t, GOV + ["Decreto S"]), t)
        self.assertEqual(N.classificar("#1896018 - DECRETO Nº 2270-S - Equipe de Transição de Governo 2026 - DIO", GOV + ["Decreto S"]), ("transicao", ["transicao"]))

    def test_ato_de_gestao_fiscal_pelo_titulo(self):
        sefaz = ["Poder Executivo", "Secretaria de Estado da Fazenda - SEFAZ -", "Portaria"]
        casos = ["PORTARIA CONJUNTA SEFAZ/SEGER Nº 12-R - Contingenciamento de despesas do exercício de 2026", "Decreto de limitação de empenho e movimentação financeira - 2026",
                 "PORTARIA SEFAZ Nº 80-R - Abertura de crédito adicional suplementar", "Instrução Normativa - Inscrição de restos a pagar 2026", "Cronograma de programação financeira - 4º bimestre"]
        for t in casos:
            self.assertEqual(N.classificar(t, sefaz)[0], "fiscal", t)

    def test_rotina_e_terceiros_ficam_de_fora(self):
        sefaz = ["Poder Executivo", "Secretaria de Estado da Fazenda - SEFAZ -", "Ordem de Serviço"]
        for t, c in [("#1882332 - PORTARIA 264-R DE DESCENTRALIZAÇÃO ORÇAMENTÁRIA EXTERNA", sefaz),
                     ("#1893257 - RESUMO - 7º TERMO ADITIVO - CONTRATO Nº 004-2023 - REMANEJAMENTO - PRONORT.", sefaz),
                     ("#1895738 - OS nº 77_Demonstrativo Mensal da Realização da Receita Orçamentária 09_2026", sefaz),
                     ("Extrato de contrato - encerramento do exercício", sefaz),
                     ("Decreto nº 22889 de 29-10-2026 - Declara nulidade do Decreto nº 22818", ["CM - EXECUTIVO", "Prefeituras", "Nova Venécia", "Decreto"]),
                     ("DECRETO Nº 100-R - Encerramento de exercício", ["CM - EXECUTIVO", "Prefeituras", "Linhares", "Decreto R"]),
                     ("", [])]:
            self.assertIsNone(N.classificar(t, c), t)


EMENTA_HTML = """<html><head><style><!-- @font-face {font-family:"Cambria Math"} --></style></head><body><p>DECRETO Nº 6518-R, DE 03 DE NOVEMBRO DE 2026.</p>
<p>Dispõe sobre os procedimentos a serem adotados pelos órgãos e entidades da administração pública estadual para o encerramento orçamentário, financeiro e contábil
do exercício de 2026, em cumprimento às normas de Direito Financeiro, e dá outras providências.</p><p>O GOVERNADOR DO ESTADO DO ESPÍRITO SANTO, no exercício das atribuições</p></body></html>"""


class Ementa(unittest.TestCase):
    def test_pega_a_frase_dispoe_sobre_e_para_antes_do_preambulo(self):
        e = N.ementa_do_texto(EMENTA_HTML)
        self.assertTrue(e.startswith("Dispõe sobre os procedimentos"))
        self.assertTrue(e.endswith("e dá outras providências."))
        self.assertNotIn("GOVERNADOR", e)
        self.assertNotIn("Cambria", e)  # o estilo do Word não vaza

    def test_pdf_ou_texto_sem_ementa_da_none(self):
        self.assertIsNone(N.ementa_do_texto("%PDF-1.7 %âãÏÓ 1 0 obj"))
        self.assertIsNone(N.ementa_do_texto(""))
        self.assertIsNone(N.ementa_do_texto("<p>Nada que lembre uma ementa aqui</p>"))
        self.assertLessEqual(len(N.ementa_do_texto("<p>Dispõe sobre " + "x " * 600 + "</p>")), 360)


LEI_HTML = """<html><body><p>LEI Nº 12.968</p><p>Autoriza o Poder Executivo a aderir ao Programa de Acompanhamento e Transparência Fiscal de que trata a Lei Complementar Federal
nº 178, de 13 de janeiro de 2021.</p><p>O GOVERNADOR DO ESTADO DO ESPÍRITO SANTO Faço saber que a Assembleia Legislativa decretou e eu sanciono a seguinte Lei: Art. 1º Fica o Poder Executivo autorizado</p></body></html>"""
LEI_UTILIDADE = """<p>LEI Nº 12.957</p><p>Declara de utilidade pública a Academia Aracruzense de Letras, localizada no município de Aracruz.</p><p>O GOVERNADOR DO ESTADO DO ESPÍRITO SANTO Faço saber</p>"""


class Leis(unittest.TestCase):
    LEIS = ["Poder Executivo", "Governadoria do Estado", "Leis", "Leis Ordinárias"]

    def test_lei_entra_pelo_caminho_e_o_titulo_so_traz_o_numero(self):
        self.assertEqual(N.classificar("#1894950 - LEI Nº 12.968", self.LEIS)[0], "lei")
        self.assertEqual(N.classificar("#1894951 - LEI COMPLEMENTAR Nº 1.158", ["Poder Executivo", "Governadoria do Estado", "Leis", "Leis Complementares"])[0], "lei")
        self.assertIsNone(N.classificar("LEI Nº 100", ["CM - EXECUTIVO", "Câmaras", "Castelo", "Lei"]))  # câmara: fora
        self.assertIsNone(N.classificar("LEI Nº 1", ["Diversos", "Poder Legislativo", "Assembléia Legislativa do Espírito Santo - ALES -", "Leis"]))  # Legislativo: fora

    def test_ementa_da_lei_vem_depois_do_cabecalho_e_antes_do_preambulo(self):
        e = N.ementa_do_texto(LEI_HTML)
        self.assertTrue(e.startswith("Autoriza o Poder Executivo a aderir ao Programa de Acompanhamento"))
        self.assertTrue(e.endswith("13 de janeiro de 2021."))
        self.assertNotIn("GOVERNADOR", e)
        self.assertTrue(N.ementa_do_texto(LEI_UTILIDADE).endswith("município de Aracruz."))

    def test_lei_honorifica_sai_e_a_de_gestao_fica_com_tema(self):
        for e in ("Declara de utilidade pública a Academia Aracruzense de Letras, localizada no município de Aracruz.",
                  "Acrescenta item ao Anexo I da Lei nº 10.974, de 14 de janeiro de 2019, conferindo ao município de Vila Velha o Título de Capital Estadual da Canoagem Havaiana.",
                  "Institui o Dia Estadual do Combate à Fome.", "Denomina Rodovia Fulano de Tal o trecho da ES-164."):
            self.assertIsNone(N.qualificar_lei(e), e)
        self.assertEqual(N.qualificar_lei("Autoriza o Poder Executivo a aderir ao Programa de Acompanhamento e Transparência Fiscal de que trata a Lei Complementar Federal nº 178"), ["fiscal", "programa"])
        self.assertIn("orcamento", N.qualificar_lei("Regulamenta a execução orçamentária e financeira das emendas parlamentares individuais"))
        self.assertIn("cargos", N.qualificar_lei("Altera a Lei Complementar nº 46 e dispõe sobre a remuneração dos servidores da Polícia Civil"))
        self.assertEqual(N.qualificar_lei("Institui o Programa Mão Amiga Alimentar-ES e dispõe sobre a isenção de responsabilidade civil para doadores de alimentos"), ["programa"])
        self.assertEqual(N.qualificar_lei(None), ["outro"])  # PDF sem leitor: fica, sem tema (a LDO não pode se perder)

    def test_montar_guarda_as_leis_ignoradas_e_nao_as_lista(self):
        hoje = datetime(2026, 11, 5, 15, 0, tzinfo=UTC)
        m = N.montar(None, [], [1], "2026-10-04", hoje, ["1886027"])
        self.assertEqual((m["ignoradas"], m["itens"]), (["1886027"], []))
        m2 = N.montar(m, [], [1, 2], "2026-10-04", hoje, ["1888833"])
        self.assertEqual(m2["ignoradas"], ["1886027", "1888833"])  # acumula, em ordem numérica


class Montagem(unittest.TestCase):
    EDICAO = {"id": 11603, "data": "04/11/2026"}
    MATERIAS = [("1897760", "#1897760 - DECRETO Nº 6518-R - Encerramento de exercício - 2026", GOV + ["Decreto R"]),
                ("1897744", "#1897744 - DECRETO Nº 2276-S - Designar Juliani Nunes Campos Johanson", GOV + ["Decreto S"]),
                ("1", "Decreto de Prefeitura", ["CM - EXECUTIVO", "Prefeituras", "Linhares", "Decreto R"])]

    def test_extrai_so_o_que_interessa_com_link_e_data(self):
        itens = N.extrair(self.EDICAO, self.MATERIAS)
        self.assertEqual(len(itens), 1)
        i = itens[0]
        self.assertEqual((i["data"], i["tipo"], i["temas"], i["orgao"]), ("2026-11-04", "decreto", ["encerramento"], "Governadoria do Estado"))
        self.assertTrue(i["url"].startswith("https://ioes.dio.es.gov.br/") and i["url"].endswith("/1897760/11603"))

    def test_primeira_carga_nao_marca_novos_e_a_seguinte_marca(self):
        hoje = datetime(2026, 11, 5, 15, 0, tzinfo=UTC)
        base = N.montar(None, N.extrair(self.EDICAO, self.MATERIAS), [11603], "2026-10-04", hoje)
        self.assertTrue(base["baseline"])
        self.assertEqual((base["novos"], base["contagem"]["decreto"], base["itens"][0]["visto_em"]), ([], 1, None))
        outra = {"id": 11606, "data": "05/11/2026"}
        mais = N.extrair(outra, [("1898690", "#1898690 - DECRETO Nº 6520-R - Transformação de cargos", GOV + ["Decreto R"])])
        seg = N.montar(base, mais + N.extrair(self.EDICAO, self.MATERIAS), [11603, 11606], "2026-10-04", hoje)
        self.assertFalse(seg["baseline"])
        self.assertEqual(seg["novos"], ["1898690"])  # o que já estava guardado não vira novo de novo
        self.assertEqual([i["id"] for i in seg["itens"]], ["1898690", "1897760"])  # mais recente primeiro
        self.assertTrue(N.mudou(base, seg))
        self.assertFalse(N.mudou(seg, dict(seg, gerado_em="outro")))

    def test_o_que_e_anterior_ao_recorte_nao_entra(self):
        hoje = datetime(2026, 11, 5, 15, 0, tzinfo=UTC)
        velho = N.extrair({"id": 1, "data": "01/10/2026"}, self.MATERIAS[:1])
        self.assertEqual(N.montar(None, velho, [1], "2026-10-04", hoje)["itens"], [])


if __name__ == "__main__":
    unittest.main()
