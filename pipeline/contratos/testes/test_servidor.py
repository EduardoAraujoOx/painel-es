import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import regras as R  # noqa: E402

MIOLOS = {"MARIA DA SILVA SANTOS|123456": ["SESA"], "JOSE AUGUSTO DE SOUZA|654321": ["SEDU", "PMES"]}


class ServidorConfirmado(unittest.TestCase):
    def test_nome_e_miolo_iguais_confirmam(self):
        self.assertEqual(R.servidor_confirmado("Maria da Silva Santos", "***123456**", MIOLOS), ["SESA"])

    def test_acento_e_caixa_nao_atrapalham(self):
        self.assertEqual(R.servidor_confirmado("JOSÉ AUGUSTO DE SOUZA", "***654321**", MIOLOS), ["SEDU", "PMES"])

    def test_so_nome_nao_confirma(self):
        self.assertEqual(R.servidor_confirmado("MARIA DA SILVA SANTOS", "***999999**", MIOLOS), [])

    def test_so_miolo_nao_confirma(self):
        self.assertEqual(R.servidor_confirmado("OUTRA PESSOA QUALQUER", "***123456**", MIOLOS), [])

    def test_sem_base_ou_cpf_invalido_nao_aponta(self):
        self.assertEqual(R.servidor_confirmado("MARIA DA SILVA SANTOS", "***123456**", {}), [])
        self.assertEqual(R.servidor_confirmado("MARIA DA SILVA SANTOS", "", MIOLOS), [])
        self.assertEqual(R.servidor_confirmado("MARIA DA SILVA SANTOS", "***12**", MIOLOS), [])


if __name__ == "__main__":
    unittest.main()
