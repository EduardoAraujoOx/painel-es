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


if __name__ == "__main__":
    unittest.main()
