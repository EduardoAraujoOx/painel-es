"""Testes das funções puras de pncp.py (janelas de consulta, redução do registro, link). Sem rede."""

import datetime
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("pncp", Path(__file__).resolve().parents[1] / "pncp.py")
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
D = datetime.date

REGISTRO = {"numeroControlePNCP": "28162790000120-2-000036/2025", "anoContrato": 2025, "sequencialContrato": 36,
            "orgaoEntidade": {"cnpj": "28162790000120", "razaoSocial": "INSTITUTO DE TECNOLOGIA", "poderId": "E", "esferaId": "E"},
            "unidadeOrgao": {"nomeUnidade": "EES-INSTITUTO"}, "niFornecedor": "05903138000114", "nomeRazaoSocialFornecedor": "FRAGA DE MEDEIROS PROJETOS LTDA",
            "processo": " 2025-ABCDE ", "dataAssinatura": "2025-11-11T00:00:00", "dataVigenciaInicio": "2025-11-12", "dataVigenciaFim": "2030-11-12",
            "valorInicial": 18862035.81, "valorGlobal": 18862035.81, "objetoContrato": "Manutenção   corretiva\n e evolutiva",
            "categoriaProcesso": {"id": 2, "nome": "Serviços"}, "tipoContrato": {"id": 1, "nome": "Contrato (termo inicial)"}, "numeroContratoEmpenho": "036/2025", "campoQueSobra": 1}


class Janelas(unittest.TestCase):
    def test_periodo_curto_e_uma_janela(self):
        self.assertEqual(P.janelas(D(2026, 1, 1), D(2026, 3, 1)), [(D(2026, 1, 1), D(2026, 3, 1))])

    def test_periodo_longo_divide_sem_buracos_nem_sobreposicao(self):
        j = P.janelas(D(2025, 1, 1), D(2026, 11, 4))
        self.assertEqual(j[0][0], D(2025, 1, 1))
        self.assertEqual(j[-1][1], D(2026, 11, 4))
        for (a, b), (c, d) in zip(j, j[1:]):
            self.assertEqual(c, b + datetime.timedelta(days=1))
        self.assertTrue(all((b - a).days <= 364 for a, b in j))

    def test_periodo_invertido_e_vazio(self):
        self.assertEqual(P.janelas(D(2026, 2, 1), D(2026, 1, 1)), [])


class Registro(unittest.TestCase):
    def test_enxugar_guarda_so_o_que_o_painel_usa(self):
        e = P.enxugar(REGISTRO)
        self.assertNotIn("campoQueSobra", e)
        self.assertEqual((e["cnpj"], e["processo"], e["assinatura"], e["fim"]), ("05903138000114", "2025-ABCDE", "2025-11-11", "2030-11-12"))
        self.assertEqual((e["categoria"], e["tipo"], e["objeto"]), ("Serviços", "Contrato (termo inicial)", "Manutenção corretiva e evolutiva"))

    def test_enxugar_tolera_campos_ausentes(self):
        e = P.enxugar({"numeroControlePNCP": "x"})
        self.assertEqual((e["processo"], e["assinatura"], e["categoria"], e["orgaoCnpj"]), ("", "", None, None))

    def test_link_do_contrato(self):
        self.assertEqual(P.link(P.enxugar(REGISTRO)), "https://pncp.gov.br/app/contratos/28162790000120/2025/36")


if __name__ == "__main__":
    unittest.main()
