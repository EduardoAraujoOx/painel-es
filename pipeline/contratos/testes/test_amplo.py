"""Testes das funções puras da base ampla (cruzamento SIGA x PNCP, protocolo do e-Docs, gestão, Pareto). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/contratos/testes -v"""

import datetime
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("amplo", Path(__file__).resolve().parents[1] / "amplo.py")
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
D = datetime.date


class Protocolo(unittest.TestCase):
    def test_formato_do_edocs(self):
        for ok in ("2026-1QHD4", "2024-XM4CR", " 2025-p9ng2 ", "2024 -P9NG2"):
            self.assertIsNotNone(A.protocolo_edocs(ok), ok)
        for ruim in ("2024-3816", "2022-SEI191639000049381202254", "2025-25.0.000001105-6", "2025-HTV2BC", "", None, "1"):
            self.assertIsNone(A.protocolo_edocs(ruim), ruim)

    def test_link_so_para_protocolo_valido(self):
        self.assertEqual(A.link_consulta("2024-xm4cr"), "https://processoeletronico.es.gov.br/?protocolo=2024-XM4CR")
        self.assertIsNone(A.link_consulta("2024-3816"))


class Cruzamento(unittest.TestCase):
    def siga(self, cnpj, processo, data):
        return {"cnpj": cnpj, "processo": processo, "data": data}

    def test_casa_por_processo_mesmo_com_datas_distantes(self):
        s = [self.siga("1", "2024-AAAAA", D(2024, 1, 10))]
        p = [self.siga("1", "2024-AAAAA", D(2025, 6, 1))]
        pares, so_p, so_s = A.casar(s, p)
        self.assertEqual((pares, so_p, so_s), ([(0, 0)], [], []))

    def test_processo_igual_mas_cnpj_diferente_nao_casa(self):
        pares, so_p, so_s = A.casar([self.siga("1", "2024-AAAAA", D(2024, 1, 10))], [self.siga("2", "2024-AAAAA", D(2024, 1, 10))])
        self.assertEqual((pares, so_p, so_s), ([], [0], [0]))

    def test_reserva_por_data_dentro_da_tolerancia(self):
        s = [self.siga("1", "2024-SEI-1", D(2024, 1, 10))]
        dentro = A.casar(s, [self.siga("1", "outro", D(2024, 3, 1))])
        fora = A.casar(s, [self.siga("1", "outro", D(2024, 3, 20))])
        self.assertEqual(dentro[0], [(0, 0)])
        self.assertEqual(fora[0], [])
        self.assertEqual(fora[1:], ([0], [0]))

    def test_cada_contrato_do_siga_e_usado_uma_vez(self):
        s = [self.siga("1", "2024-AAAAA", D(2024, 1, 10))]
        p = [self.siga("1", "2024-AAAAA", D(2024, 1, 10)), self.siga("1", "2024-AAAAA", D(2024, 1, 12))]
        pares, so_p, so_s = A.casar(s, p)
        self.assertEqual(len(pares), 1)
        self.assertEqual(so_p, [1])

    def test_varios_contratos_do_mesmo_fornecedor_casam_pelo_par_mais_proximo(self):
        s = [self.siga("1", "x", D(2025, 1, 1)), self.siga("1", "y", D(2025, 6, 1))]
        p = [self.siga("1", "z", D(2025, 6, 5)), self.siga("1", "w", D(2025, 1, 3))]
        pares, _, _ = A.casar(s, p)
        self.assertEqual(pares, [(0, 1), (1, 0)])

    def test_listas_vazias(self):
        self.assertEqual(A.casar([], []), ([], [], []))
        self.assertEqual(A.casar([self.siga("1", "a", None)], []), ([], [], [0]))

    def test_sem_datas_so_casa_por_processo(self):
        pares, so_p, _ = A.casar([self.siga("1", "a", None)], [self.siga("1", "b", None)])
        self.assertEqual((pares, so_p), ([], [0]))


class Pareto(unittest.TestCase):
    def test_corte_em_80_por_cento(self):
        self.assertEqual(A.corte_pareto([50, 30, 10, 5, 5]), 2)        # 50+30 = 80
        self.assertEqual(A.corte_pareto([40, 30, 20, 10]), 3)          # 40+30 = 70 < 80; com 20 chega a 90
        self.assertEqual(A.corte_pareto([100]), 1)

    def test_casos_de_borda(self):
        self.assertEqual(A.corte_pareto([]), 0)
        self.assertEqual(A.corte_pareto([0, 0, 0]), 3)
        self.assertEqual(A.corte_pareto([None, 10]), 1)
        self.assertEqual(A.corte_pareto([10, 10, 10, 10], 1.0), 4)

    def test_ordem_da_entrada_nao_importa(self):
        self.assertEqual(A.corte_pareto([5, 50, 5, 30, 10]), A.corte_pareto([50, 30, 10, 5, 5]))


class Gestao(unittest.TestCase):
    def linha(self, funcao, nome, setor="X", situacao="ATIVO", ini="29/05/2025 00:00:00", fim="01/11/2023 00:00:00"):
        return {"Funcao": funcao, "Nome": nome, "Setor": setor, "Situacao": situacao, "DataInicio": ini, "DataFim": fim}

    def test_funcoes_normalizadas_e_gestor_antes_de_fiscal(self):
        r = A.resumir_gestao([self.linha("Fiscal Titular", "ANA"), self.linha("SUPLENTE_FISCAL", "BIA"), self.linha("GESTOR", "CARLA"), self.linha("SUPLENTE_GESTOR", "DANI")])
        self.assertEqual([x[0] for x in r], ["Gestor", "Suplente de gestor", "Fiscal", "Suplente de fiscal"])

    def test_datas_em_iso_e_data_invalida_vazia(self):
        r = A.resumir_gestao([self.linha("GESTOR", "CARLA", ini="06/10/2018 00:00:00", fim="")])
        self.assertEqual((r[0][3], r[0][4]), ("2018-10-06", ""))

    def test_nao_repete_pessoa_na_mesma_funcao_e_ignora_sem_nome(self):
        r = A.resumir_gestao([self.linha("GESTOR", "carla"), self.linha("Gestor Titular", "CARLA"), self.linha("GESTOR", "  ")])
        self.assertEqual(len(r), 1)

    def test_sem_linhas(self):
        self.assertEqual(A.resumir_gestao([]), [])


class AtosDoDiario(unittest.TestCase):
    ATOS = [{"n": "2024.000050.10109.01", "c": "", "t": "Rescisão", "p": "1880890", "pg": 2, "x": "Termo de rescisão unilateral", "np": ["2024-P9NG2"], "nc": [], "e": 11522, "d": "2026-10-05"},
            {"n": "", "c": "02593165000140", "t": "Rescisão", "p": "1880890", "pg": 2, "x": "Termo de rescisão unilateral do contrato, com texto mais longo", "np": ["2024-P9NG2"], "nc": [], "e": 11522, "d": "2026-10-05"},
            {"n": "", "c": "11111111000111", "t": "Aditivo ou prorrogação", "p": "1700000", "pg": 9, "x": "Termo aditivo ao contrato 23/2022", "np": [], "nc": ["23/2022"], "e": 9000, "d": "2025-03-01"},
            {"n": "", "c": "11111111000111", "t": "Aditivo ou prorrogação", "p": "1700001", "pg": 9, "x": "Termo aditivo ao contrato 7/2022", "np": [], "nc": ["7/2022"], "e": 9001, "d": "2025-03-02"}]

    def test_numero_estruturado_e_antigo(self):
        self.assertEqual(A.numero_estruturado("Contrato 2024.000050.10109.01/2024"), "2024.000050.10109.01")
        self.assertIsNone(A.numero_estruturado("Contrato 023/2022"))
        self.assertEqual(A.numero_antigo("Contrato 023/2022"), "23/2022")

    def test_liga_pelo_numero_sem_repetir_o_mesmo_ato(self):
        por_n, por_c = A.indexar_atos(self.ATOS)
        r = A.atos_do_contrato("Contrato 2024.000050.10109.01/2024", "02593165000140", "2024-P9NG2", por_n, por_c)
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0][:4], ["2026-10-05", "Rescisão", "1880890", 2])

    def test_liga_pelo_cnpj_com_numeracao_antiga_e_nao_confunde_outro_numero(self):
        por_n, por_c = A.indexar_atos(self.ATOS)
        r = A.atos_do_contrato("Contrato 023/2022", "11111111000111", "", por_n, por_c)
        self.assertEqual([x[2] for x in r], ["1700000"])
        self.assertEqual(A.atos_do_contrato("Contrato 99/2022", "11111111000111", "", por_n, por_c), [])

    def test_numero_estruturado_nao_se_liga_por_cnpj_a_contrato_de_outro_orgao(self):
        outro = {"n": "2026.000100.44922.01", "c": "", "t": "Rescisão", "p": "1868084", "pg": 21, "x": "Rescisão unilateral", "np": ["2024-M38D0"], "nc": [], "e": 1, "d": "2026-09-15"}
        cnpj = dict(outro, n="", c="09077954000177")
        por_n, por_c = A.indexar_atos([outro, cnpj])
        self.assertEqual(A.atos_do_contrato("Contrato 2026.001001.44101.01/2026", "09077954000177", "2024-M38D0", por_n, por_c), [])
        self.assertEqual(len(A.atos_do_contrato("Contrato 2026.000100.44922.01/2026", "09077954000177", "2024-M38D0", por_n, por_c)), 1)

    def test_rescisao_publicada_depois_da_celebracao(self):
        atos = [["2026-10-05", "Rescisão", "1", 1, 1, ""], ["2024-01-01", "Rescisão", "2", 1, 1, ""]]
        self.assertEqual(A.rescisao_publicada(atos, "2025-01-03"), "2026-10-05")
        self.assertEqual(A.rescisao_publicada(atos, "2027-01-01"), "")
        self.assertEqual(A.rescisao_publicada([], "2025-01-03"), "")


class ContatoCadastral(unittest.TestCase):
    def test_telefone_formatado(self):
        self.assertEqual(A.telefone("27", "33313100"), "(27) 3331-3100")
        self.assertEqual(A.telefone("11", "987654321"), "(11) 98765-4321")
        self.assertEqual(A.telefone("", "33313100"), "")
        self.assertEqual(A.telefone("27", "123"), "")

    def test_email_e_telefones(self):
        c = A.contato_cadastral("Sociedade Empresária Limitada", " Contato@Empresa.com.br ", "27", "33313100", "27", "33313100")
        self.assertEqual(c, {"email": "contato@empresa.com.br", "telefones": ["(27) 3331-3100"]})

    def test_empresario_individual_e_eireli_ficam_sem_contato(self):
        self.assertIsNone(A.contato_cadastral("Empresário (Individual)", "eu@mail.com", "27", "33313100"))
        self.assertIsNone(A.contato_cadastral("Empresa Individual de Responsabilidade Limitada (de Natureza Empresária)", "eu@mail.com"))

    def test_sem_dado_utilizavel(self):
        self.assertIsNone(A.contato_cadastral("Sociedade Anônima Fechada", "", "", ""))
        self.assertEqual(A.contato_cadastral("Sociedade Anônima Fechada", "sem-arroba", "27", "33313100")["email"], "")


class ContratosDoSigefes(unittest.TestCase):
    NOMES = {"11145893000341": "AMPLA SERVICOS DE PROPAGANDA E PUBLICIDADE LTDA", "SB100104|11145893000341|21003003": "SERVIÇOS DE PUBLICIDADE INSTITUCIONAL|COMUNICAÇÃO SOCIAL"}
    LINHAS = [["11145893000341", "100104", "39", "21003003", "CONCORRÊNCIA", "2026-03", 0.0, 0.0, 1683.67],
              ["11145893000341", "100104", "39", "21003003", "CONCORRÊNCIA", "2026-06", 0.0, 0.0, 1000.0],
              ["11145893000341", "100104", "39", "21003003", "CONCORRÊNCIA", "2025-12", 0.0, 0.0, 500.0],
              ["11145893000341", "100104", "13", "21003003", "CONCORRÊNCIA", "2026-03", 0.0, 0.0, 9999.0],      # elemento fora da contratação
              ["11145893000341", "100104", "39", "00000000", "CONCORRÊNCIA", "2026-03", 0.0, 0.0, 7.0],         # sem código de contrato
              ["99999999000199", "100104", "39", "55", "PREGÃO", "2026-03", 0.0, 0.0, 800.0]]                   # fornecedor com documento no SIGA

    def roda(self, **kw):
        args = dict(linhas=self.LINHAS, nomes=self.NOMES, ug_org={"100104": 175}, pares_sem_doc={(175, "11145893000341")}, anos=("2025", "2026"), elementos={"39": "x"})
        args.update(kw)
        return A.contratos_do_sigefes(**args)

    def test_agrupa_por_contrato_e_soma_por_ano(self):
        r = self.roda()
        self.assertEqual(list(r), [175])
        g = r[175][0]
        self.assertEqual((g["codigo"], g["licitacao"], g["objeto"], g["subfuncao"]), ("21003003", "CONCORRÊNCIA", "SERVIÇOS DE PUBLICIDADE INSTITUCIONAL", "COMUNICAÇÃO SOCIAL"))
        self.assertEqual(g["pago"], {"2025": 500.0, "2026": 2683.67})
        self.assertEqual((g["desde"], g["ate"], g["total"]), ("2025-12", "2026-06", 3183.67))
        self.assertEqual(len(r[175]), 1)

    def test_so_pares_sem_documento_e_ug_conhecida(self):
        self.assertEqual(self.roda(pares_sem_doc=set()), {})
        self.assertEqual(self.roda(ug_org={}), {})

    def test_ano_fora_do_periodo_nao_entra(self):
        self.assertEqual(self.roda(anos=("2024",)), {})


if __name__ == "__main__":
    unittest.main()
