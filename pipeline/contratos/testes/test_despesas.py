"""Testes da leitura de uma linha do arquivo de despesas (SIGEFES) em despesas.py. Sem rede."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("despesas", Path(__file__).resolve().parents[1] / "despesas.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)


def linha(cnpj="09232819000159", data="03/02/2026 00:00:00", emp="100,50", liq="80,25", pago="60,00", ug="100109", elemento="40", contrato="25000052", lic="INEXIGIBILIDADE", n=71):
    c = [""] * n
    c[0], c[1], c[2], c[3], c[4], c[6], c[9], c[11] = "2026", data, emp, liq, pago, cnpj, "FORNECEDOR TESTE LTDA", lic
    if n > 69:
        c[21], c[22], c[25], c[26], c[69] = ug, "SECRETARIA DE ESTADO DO GOVERNO", elemento, "SERVIÇOS DE TECNOLOGIA", contrato
        c[39], c[47], c[43], c[54], c[59], c[60], c[51] = "COMUNICAÇÃO SOCIAL", "SERVIÇOS DE PUBLICIDADE INSTITUCIONAL", "DIVULGAÇÃO INSTITUCIONAL", "Lei nº 8.666/1993", "001", "2026", "2026-ABCDE"
    return (";".join(c) + "\n").encode("utf-8")


class Linha(unittest.TestCase):
    def test_pagamento_a_cnpj(self):
        chave, vals, nomes, extra = D.linha_para_registro(linha())
        self.assertEqual(chave, ("09232819000159", "100109", "40", "25000052", "INEXIGIBILIDADE", "2026-02"))
        self.assertEqual(vals, [100.5, 80.25, 60.0])
        self.assertEqual(nomes["09232819000159"], "FORNECEDOR TESTE LTDA")
        self.assertEqual(nomes["UG100109"], "SECRETARIA DE ESTADO DO GOVERNO")
        self.assertEqual(extra[0], "100109|09232819000159|25000052")
        self.assertEqual(extra[1], "SERVIÇOS DE PUBLICIDADE INSTITUCIONAL|COMUNICAÇÃO SOCIAL")
        self.assertEqual(extra[2], ["001/2026", "2026-ABCDE", "Lei nº 8.666/1993", "DIVULGAÇÃO INSTITUCIONAL"])

    def test_cpf_ou_documento_invalido_nao_e_lido(self):
        for doc in ("12345678901", "***123456**", "0923281900015", "0923281900015A", ""):
            self.assertIsNone(D.linha_para_registro(linha(cnpj=doc)), doc)

    def test_linha_curta_ou_truncada(self):
        self.assertIsNone(D.linha_para_registro(b"curta;demais\n"))
        self.assertEqual(D.linha_para_registro(linha(n=40)), "ruim")

    def test_pagamento_sem_contrato_tambem_guarda_o_gasto_com_codigo_vazio(self):
        extra = D.linha_para_registro(linha(contrato="  "))[3]
        self.assertEqual(extra[0], "100109|09232819000159|")

    def test_contrato_sem_codigo_fica_vazio_ou_zerado(self):
        self.assertEqual(D.linha_para_registro(linha(contrato="00000000"))[0][3], "00000000")
        self.assertEqual(D.linha_para_registro(linha(contrato="  "))[0][3], "")


if __name__ == "__main__":
    unittest.main()
