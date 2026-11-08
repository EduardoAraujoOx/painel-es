import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import cidades as C  # noqa: E402


def linha(**kw):
    base = {"NomeEsferaAdministrativa": "Estado do Espírito Santo", "NomeUnidadeGestoraReferencia": "Companhia Espírito Santense de Saneamento", "ChaveInstrumento": "K1",
            "CodigoUnidadeGestoraReferencia": "X", "NumeroInstrumentoContratacao": "CT-1", "AnoInstrumentoContratacao": "2023", "TipoInstrumento": "Contrato", "SituacaoInstrumento": "Em execução",
            "NomeContratado": "AGENCIA X LTDA", "NumeroIdentificacaoContratado": "11145893000341", "ObjetoInstrumento": "Serviços de publicidade", "ObjetoContratacao": "", "ModalidadeLicitacao": "Disputa",
            "NumeroEdital": "003", "AnoEdital": "2023", "DataAssinaturaInstrumentoContratacao": "2023-12-01", "InicioVigenciaContrato": "2023-12-01", "FimVigenciaContrato": "2024-12-01",
            "ValorTotalContratacaoInstrumento": "10000000,00", "ValorAtualContratacaoInstrumento": "30000000,00", "UrlInstrumentoContratacao": "u", "NumeroProcessoAdministrativo": "1/2023"}
    base.update(kw)
    return base


class Leitura(unittest.TestCase):
    def test_numero(self):
        self.assertEqual(C.numero("9000000,00"), 9000000.0)
        self.assertEqual(C.numero("1.234,56"), 1234.56)
        self.assertEqual(C.numero(""), 0.0)
        self.assertEqual(C.numero("x"), 0.0)

    def test_empresa_da_unidade(self):
        self.assertEqual(C.empresa_da_unidade("Banco do Estado do Espírito Santo S/A")[0], "banestes")
        self.assertEqual(C.empresa_da_unidade("Banestes Seguros S/A")[0], "banestes-seguros")
        self.assertIsNone(C.empresa_da_unidade("Secretaria de Estado da Saúde"))

    def test_ignora_outras_esferas_e_unidades(self):
        r = list(C.ler([linha(NomeEsferaAdministrativa="Vitória"), linha(NomeUnidadeGestoraReferencia="Secretaria de Estado da Saúde")]))
        self.assertEqual(r, [])
        self.assertEqual(C.ler([linha(NomeEsferaAdministrativa="Vitória")]), {})

    def test_agrupa_instrumento_alteracao_e_pagamento_sem_duplicar(self):
        med = dict(NumeroMedicao="1", AnoMedicao="2024", DataInicioMedicao="2024-01-01", DataFimMedicao="2024-01-31", ValorTotalMedicao="100,00", DataPagamento="2024-02-05", ValorPagamento="100,00")
        alt = dict(NumeroTermoContratualAlteracao="1", AnoTermoContratualAlteracao="2024", TipoTermoContratualAlteracao="Aditivo de valor", DataAssinaturaTermoAlteracaoContratual="2024-05-01",
                   DescricaoAlteracao="acréscimo", ValorTotalContratacaoAlteracao="30000000,00")
        inst = C.ler([linha(**med), linha(**med), linha(**alt), linha(**dict(med, NumeroMedicao="2", DataPagamento="2025-01-10", ValorPagamento="50,00"))])
        self.assertEqual(len(inst), 1)
        c = C.compactar(inst["K1"])
        self.assertEqual(c["pagoAno"], {"2024": 100.0, "2025": 50.0})
        self.assertEqual(c["pago"], 150.0)
        self.assertEqual(c["medicoes"], 2)
        self.assertEqual(c["ultimoPagamento"], "2025-01-10")
        self.assertEqual(c["nAlteracoes"], 1)
        self.assertEqual(c["valorAtual"], 30000000.0)
        self.assertTrue(c["publicidade"])
        self.assertEqual(c["cnpj"], "11145893000341")
        self.assertEqual(c["modalidade"], "Disputa nº 003/2023")

    def test_resumo_por_empresa(self):
        inst = C.ler([linha(), linha(ChaveInstrumento="K2", ObjetoInstrumento="Limpeza", NumeroMedicao="1", DataPagamento="2024-03-01", ValorPagamento="10,00")])
        resumo, por = C.montar(inst)
        self.assertEqual(len(resumo), 1)
        self.assertEqual(resumo[0]["instrumentos"], 2)
        self.assertEqual(resumo[0]["publicidade"]["instrumentos"], 1)
        self.assertEqual(resumo[0]["pagoAno"], {"2024": 10.0})


if __name__ == "__main__":
    unittest.main()
