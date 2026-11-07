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
        c[39], c[47] = "COMUNICAÇÃO SOCIAL", "SERVIÇOS DE PUBLICIDADE INSTITUCIONAL"
    return (";".join(c) + "\n").encode("utf-8")


class Linha(unittest.TestCase):
    def test_pagamento_a_cnpj(self):
        chave, vals, nomes = D.linha_para_registro(linha())
        self.assertEqual(chave, ("09232819000159", "100109", "40", "25000052", "INEXIGIBILIDADE", "2026-02"))
        self.assertEqual(vals, [100.5, 80.25, 60.0])
        self.assertEqual(nomes["09232819000159"], "FORNECEDOR TESTE LTDA")
        self.assertEqual(nomes["UG100109"], "SECRETARIA DE ESTADO DO GOVERNO")
        self.assertEqual(nomes["SB100109|09232819000159|25000052"], "SERVIÇOS DE PUBLICIDADE INSTITUCIONAL|COMUNICAÇÃO SOCIAL")

    def test_cpf_ou_documento_invalido_nao_e_lido(self):
        for doc in ("12345678901", "***123456**", "0923281900015", "0923281900015A", ""):
            self.assertIsNone(D.linha_para_registro(linha(cnpj=doc)), doc)

    def test_linha_curta_ou_truncada(self):
        self.assertIsNone(D.linha_para_registro(b"curta;demais\n"))
        self.assertEqual(D.linha_para_registro(linha(n=40)), "ruim")

    def test_contrato_zerado_ou_vazio_nao_gera_descricao_do_gasto(self):
        for ct in ("00000000", "  "):
            self.assertFalse([k for k in D.linha_para_registro(linha(contrato=ct))[2] if k.startswith("SB")])

    def test_contrato_sem_codigo_fica_vazio_ou_zerado(self):
        self.assertEqual(D.linha_para_registro(linha(contrato="00000000"))[0][3], "00000000")
        self.assertEqual(D.linha_para_registro(linha(contrato="  "))[0][3], "")


if __name__ == "__main__":
    unittest.main()
