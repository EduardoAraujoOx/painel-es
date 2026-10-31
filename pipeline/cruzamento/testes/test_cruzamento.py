"""Testes do cruzamento do Diário com o SIGA e o Portal de Obras. Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/cruzamento/testes -v
Não usam rede: partem de linhas fictícias no formato do SIGA e de atos no formato de data/atos/index.json."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("cruzar", Path(__file__).resolve().parents[1] / "cruzar.py")
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)


def categoria(sit):
    s = (sit or "").lower()
    return "suspenso" if "suspens" in s else "rescindido" if s.startswith("rescis") else "anulado" if ("anulad" in s or "revogad" in s) else None


def valor(s):
    try:
        return float((s or "").replace(".", "").replace(",", "."))
    except ValueError:
        return None


def siga(doc, orgao, forn, sit="Instrumento Contratual em Execução", tipo="Contrato"):
    return {"NumeroDocumento": doc, "TipoDocumento": tipo, "NomeOrgao": orgao, "Fornecedor": forn, "Situacao": sit, "ValorInicial": "1000,00", "DataCelebracao": "09/05/2024 00:00:00", "Objeto": "obra"}


def ato(titulo, tipo="paralisacao", orgao="Secretaria de Estado da Educação - SEDU -", i="1"):
    return {"id": i, "tipo": tipo, "titulo": titulo, "orgao": orgao, "data": "2026-10-22"}


SEDU, SECTI, SESA = "SECRETARIA DE ESTADO DA EDUCAÇÃO", "SECRETARIA DA CIÊNCIA, TECNOLOGIA, INOVAÇÃO, EDUCAÇÃO PROFISSIONAL", "SECRETARIA DE ESTADO DA SAÚDE"


class Referencias(unittest.TestCase):
    def test_codigo_e_numero_ano(self):
        casos = {
            "Extrato 1ª Ordem de Paralisacao CT094-2024": ([], [(94, 2024)]),
            "EXTRATO DIO TERMO DE RESCISÃO UNILATERAL - Contrato nº 2025.000105.32101.01": (["2025.000105.32101.01"], []),
            "EXTRATO DO SEGUNDO TERMO ADITIVO CONT. 25-2025 - PAS PROJETOS": ([], [(25, 2025)]),
            "Extrato - Rescisão Amigável - Contrato 0008.2022 - PRONAR S.A": ([], [(8, 2022)]),
            "Termo de Rescisão Unilateral ao TO nº 915.2026 - ED 10.2025": ([], [(915, 2026)]),
            "2. Anulação do Contrato nº 061.2021": ([], [(61, 2021)]),
            "Extrato do Termo de Rescisão. Processo 2025-XT895": ([], []),
        }
        for titulo, esperado in casos.items():
            self.assertEqual(C.referencias(titulo), esperado, titulo)

    def test_numero_e_ano_do_siga(self):
        self.assertEqual(C.numero_ano_do_siga("Contrato 2024.000094.42101.01/2024"), (94, 2024))
        self.assertEqual(C.numero_ano_do_siga("CONTRATO/SEAG/00025/2021"), (25, 2021))
        self.assertIsNone(C.numero_ano_do_siga("Empenho 2025NE00287"))

    def test_anos_necessarios_inclui_o_ano_seguinte(self):
        self.assertEqual(C.anos_necessarios([ato("Contrato 061.2021"), ato("CT094-2024")]), [2021, 2022, 2024, 2025])


class CasamentoSiga(unittest.TestCase):
    def cruzar(self, atos, linhas):
        return C.cruzar(atos, linhas, [], categoria, valor)

    def test_so_contratos_entram_no_indice(self):
        linhas = [siga("Contrato 2024.000094.42101.01/2024", SEDU, "SUENGE"), siga("Autorização de Compra/Ordem de Fornecimento 2024.000094.42101.05/2024", SEDU, "X", tipo="Autorização de Compra/Ordem de Fornecimento")]
        r = self.cruzar([ato("Extrato 1ª Ordem de Paralisacao CT094-2024")], linhas)
        self.assertEqual(r["1"]["siga"]["fornecedor"], "SUENGE")

    def test_codigo_do_contrato_basta(self):
        linhas = [siga("Contrato 2025.000105.32101.01/2025", SECTI, "FORNECEDOR A")]
        r = self.cruzar([ato("EXTRATO DIO TERMO DE RESCISÃO UNILATERAL - Contrato nº 2025.000105.32101.01", "rescisao", SECTI)], linhas)
        self.assertEqual((r["1"]["siga"]["como"], r["1"]["siga"]["fornecedor"]), ("código do contrato", "FORNECEDOR A"))

    def test_mesmo_numero_e_ano_em_orgaos_diferentes_fica_com_o_do_ato(self):
        # CT094-2024 existe na Educação (SEDU) e na Ciência e Tecnologia (SECTI): o órgão do ato desempata
        linhas = [siga("Contrato 2024.000094.32101.01/2024", SECTI, "CENTRO DE EVENTOS"), siga("Contrato 2024.000094.42101.01/2024", SEDU, "SUENGE ENGENHARIA")]
        r = self.cruzar([ato("Extrato 1ª Ordem de Paralisacao CT094-2024")], linhas)
        self.assertEqual(r["1"]["siga"]["fornecedor"], "SUENGE ENGENHARIA")

    def test_orgao_incompativel_nao_casa(self):
        linhas = [siga("Contrato 2024.000094.42101.01/2024", SESA, "OUTRA EMPRESA")]
        self.assertIsNone(self.cruzar([ato("Extrato 1ª Ordem de Paralisacao CT094-2024")], linhas)["1"]["siga"])

    def test_empresa_citada_no_titulo_precisa_ser_a_mesma(self):
        # Contrato 0008.2022 da Saúde com a Pronar: o contrato 8/2022 da Saúde no SIGA é de outra empresa, então não é o mesmo
        linhas = [siga("Contrato 2022.000008.44101.01/2022", SESA, "M & L CLIMATIZACAO E SERVICOS")]
        t = "Extrato - Rescisão Amigável - Contrato - Contrato 0008.2022 - PRONAR S.A"
        self.assertIsNone(self.cruzar([ato(t, "rescisao", "Secretaria de Estado da Saúde - SESA -")], linhas)["1"]["siga"])
        linhas.append(siga("Contrato 2022.000008.44102.01/2022", SESA, "PRONAR S/A"))  # com a Pronar também na lista, a empresa do título desempata
        self.assertEqual(self.cruzar([ato(t, "rescisao", "Secretaria de Estado da Saúde - SESA -")], linhas)["1"]["siga"]["fornecedor"], "PRONAR S/A")

    def test_duas_empresas_compativeis_e_ambiguidade_nao_casa(self):
        linhas = [siga("Contrato 2024.000094.42101.01/2024", SEDU, "A"), siga("Contrato 2024.000094.42102.01/2024", SEDU, "B")]
        self.assertIsNone(self.cruzar([ato("Extrato 1ª Ordem de Paralisacao CT094-2024")], linhas)["1"]["siga"])

    def test_leitura_registrado_nao_registrado_e_nao_encontrado(self):
        linhas = [siga("Contrato 2024.000094.42101.01/2024", SEDU, "A", "Instrumento Contratual em Execução"),
                  siga("Contrato 2025.000029.44928.01/2025", SESA, "B", "Rescisão Contratual")]
        r = self.cruzar([ato("Extrato 1ª Ordem de Paralisacao CT094-2024", "paralisacao", i="1"),
                         ato("Extrato - Rescisão Amigável Contrato nº 2025.000029.44928.01", "rescisao", "Secretaria de Estado da Saúde - SESA -", "2"),
                         ato("Extrato de Rescisão CT 77-2020", "rescisao", i="3"),
                         ato("Extrato - Termo de Cancelamento - ARP 0082.2026 - Fisiolin", "cancelamento", i="4")], linhas)
        self.assertEqual([r[i]["leitura"] for i in "1234"], ["nao_registrado", "registrado", "nao_encontrado", None])
        self.assertEqual(C.resumo(r), {"total": 4, "com_siga": 2, "registrado": 1, "nao_registrado": 1, "nao_encontrado": 1})


class CasamentoObras(unittest.TestCase):
    OBRAS = [{"id": "10", "tipo": "paralisada", "data_situacao": "2024-01-19", "contrato": "094 / 2024 - 1", "orgao": "SEDU - SECRETARIA DE ESTADO DA EDUCAÇÃO", "url": "https://t/10"},
             {"id": "11", "tipo": "rescindida", "data_situacao": "2023-06-16", "contrato": "094 / 2024 - 1", "orgao": "DER ES - DEPARTAMENTO DE ESTRADAS E RODAGEM", "url": "https://t/11"}]

    def test_casa_por_numero_ano_e_orgao(self):
        r = C.casar_obras(ato("Extrato 1ª Ordem de Paralisacao CT094-2024"), self.OBRAS)
        self.assertEqual((r["id"], r["tipo"]), ("10", "paralisada"))

    def test_sem_correspondencia_devolve_none(self):
        self.assertIsNone(C.casar_obras(ato("Extrato CT999-2024"), self.OBRAS))
        self.assertIsNone(C.casar_obras(ato("Extrato CT094-2024", orgao="Secretaria de Estado da Saúde - SESA -"), self.OBRAS))


if __name__ == "__main__":
    unittest.main()
