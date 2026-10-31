"""Testes do coletor do Diário Oficial (módulo `atos`). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/diario/testes -v
Não usam rede: partem de um sumário fictício no formato do Diário Oficial do ES."""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("diario", Path(__file__).resolve().parents[1] / "coletar.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)
UTC = timezone.utc

SUMARIO = """<ul id="tree" class="filetree" data-id="1">
	<li><span class="folder">Poder Executivo</span>
		<ul>
			<li><span class="folder">Secretaria de Estado da Educação - SEDU -</span>
				<ul>
					<li><span class="folder">Termos</span>
						<ul>
							<li><span class="file"><a class="linkMateria" identificador="2001" pagina="1"data-id="9" data-protocolo="1"> #1894679 - Extrato 1ª Ordem de Paralisacao CT093-2026</a></span></li>
							<li><span class="file"><a class="linkMateria" identificador="2002" pagina="2"data-id="9" data-protocolo="2"> #1894680 - PORTARIA - SUSPENSÃO FÉRIAS - FULANO DE TAL</a></span></li>
						</ul>
					</li>
				</ul>
			</li>
			<li><span class="folder">Secretaria de Estado da Saúde - SESA -</span>
				<ul>
					<li><span class="folder">Termos</span>
						<ul>
							<li><span class="file"><a class="linkMateria" identificador="2003" pagina="3"data-id="9" data-protocolo="3"> #1895354 - Extrato - Rescisão Amigável - Contrato - Contrato 0008.2022 - PRONAR S.A</a></span></li>
						</ul>
					</li>
				</ul>
			</li>
		</ul>
	</li>
	<li><span class="folder">Prefeituras</span>
		<ul><li><span class="folder">Linhares</span><ul>
			<li><span class="file"><a class="linkMateria" identificador="2004" pagina="4"data-id="9" data-protocolo="4"> #1 - Extrato de rescisão de contrato 12-2026</a></span></li>
		</ul></li></ul>
	</li>
</ul>"""
PE = ["Poder Executivo", "Secretaria de Estado da Saúde - SESA -", "Termos"]


class Classificacao(unittest.TestCase):
    def test_tipos_e_alvos_de_atos_reais(self):
        casos = [
            ("#1 - Extrato 1ª Ordem de Paralisacao CT093-2026", ("paralisacao", "contrato")),
            ("#1 - Extrato - Rescisão Amigável - Contrato - Contrato 0008.2022 - PRONAR S.A", ("rescisao", "contrato")),
            ("#1 - EXTRATO DE TERMO DE RESCISÃO CT 148365 - GEREN", ("rescisao", "contrato")),
            ("#1 - Extrato - Termo de Distrato - Contrato n.º 2025.000002.48101.01", ("rescisao", "contrato")),
            ("#1 - Extrato - Termo de Cancelamento - ARP 0082.2026 - Fisiolin", ("cancelamento", "ata")),
            ("#1 - 2. Anulação do Contrato nº 061.2021", ("anulacao", "contrato")),
            ("#1 - AVISO DE SUSPENSÃO DO PREGÃO ELETRÔNICO 045/2026", ("suspensao", "licitação")),
            ("#1 - Termo de suspensão da execução do Contrato 12/2025", ("suspensao", "contrato")),
            ("#1 - REVOGAÇÃO DA LICITAÇÃO - PREGÃO 12/2026", ("anulacao", "licitação")),
        ]
        for titulo, esperado in casos:
            self.assertEqual(D.classificar(titulo, PE), esperado, titulo)

    def test_palavras_de_exclusao_nao_pegam_pedacos_de_outras_palavras(self):
        # "suspensão" contém "pensão" e "concessão" contém "cessão": o filtro de atos de pessoa não pode derrubar atos de contrato por isso
        self.assertEqual(D.classificar("#1 - Termo de suspensão do Contrato 12/2025 - obra", PE), ("suspensao", "contrato"))
        self.assertEqual(D.classificar("#1 - Rescisão do Contrato de concessão 03/2024", PE), ("rescisao", "contrato"))

    def test_suspensao_de_penalidade_nao_e_suspensao_de_contrato(self):
        self.assertIsNone(D.classificar("#1 - Extrato - suspensão Penalidade - Contrato 009-2023 - Dact", PE))
        self.assertEqual(D.classificar("#1 - EXTRATO DO SEGUNDO TERMO ADITIVO CONT. 25-2025 - SUSPENSÃO DE VIGENCIA", PE), ("suspensao", "contrato"))

    def test_atos_de_pessoa_e_assuntos_alheios_ficam_de_fora(self):
        for titulo in ["#1 - PORTARIA - SUSPENSÃO FÉRIAS - FULANO", "#1 - PORTARIA RESCISÃO - EVA GERLANIA - MON. DE RES. PRISIONAL - CONV. ADMINISTRATIVA",
                       "#1 - O.S Nº 156-S RESCISÃO DO TERMO DE COMPROMISSO DE ESTAGIO", "#1 - RESUMO DO TERMO DE RESCISÃO CESSÃO DE SERVIDOR - Beltrano",
                       "#1 - Instrução de Serviço nº 090 - Cancelamento de Férias", "#1 - DECRETO Nº 2275-S - CRD - SESA - R$ 36.695.299,70",
                       "#1 - Extrato do 4º Termo Aditivo - Contrato 110-2025", "#1 - Anulação de nomeação do cargo de confiança"]:
            self.assertIsNone(D.classificar(titulo, PE), titulo)

    def test_so_poder_executivo(self):
        titulo = "#1 - Extrato de rescisão de contrato 12-2026"
        self.assertIsNotNone(D.classificar(titulo, PE))
        for pasta in (["Prefeituras", "Linhares"], ["CM - EXECUTIVO", "Prefeituras", "Linhares"], ["Diversos", "Publicações de Terceiros"], []):
            self.assertIsNone(D.classificar(titulo, pasta), pasta)


class Sumario(unittest.TestCase):
    def test_le_a_arvore_com_caminho_e_titulo(self):
        mats = D.ler_sumario(SUMARIO)
        self.assertEqual([m[0] for m in mats], ["2001", "2002", "2003", "2004"])
        self.assertEqual(mats[0][2], ["Poder Executivo", "Secretaria de Estado da Educação - SEDU -", "Termos"])
        self.assertEqual(mats[3][2], ["Prefeituras", "Linhares"])

    def test_extrai_so_os_atos_de_contrato_do_executivo(self):
        edicao = {"id": 11600, "data": "29/10/2026"}
        itens = D.extrair(edicao, D.ler_sumario(SUMARIO))
        self.assertEqual([i["id"] for i in itens], ["2001", "2003"])  # férias e prefeitura ficam de fora
        i = itens[0]
        self.assertEqual((i["data"], i["tipo"], i["orgao"], i["setor"], i["titulo"]),
                         ("2026-10-29", "paralisacao", "Secretaria de Estado da Educação - SEDU -", "Termos", "Extrato 1ª Ordem de Paralisacao CT093-2026"))
        self.assertTrue(i["url"].endswith("/publicacoes_ver_conteudo/2001/11600"))


class Comparacao(unittest.TestCase):
    D1 = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)
    D2 = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)

    def it(self, i, data="2026-10-29", tipo="rescisao"):
        return {"id": str(i), "edicao": 1, "data": data, "tipo": tipo, "alvo": "contrato", "titulo": f"ato {i}", "orgao": "SESA", "setor": "", "url": "https://x/" + str(i)}

    def test_primeira_carga_e_base_de_comparacao(self):
        r = D.montar(None, [self.it(1), self.it(2)], {11, 12}, "2026-10-04", self.D1)
        self.assertTrue(r["baseline"])
        self.assertEqual((r["novos"], [i["visto_em"] for i in r["itens"]]), ([], [None, None]))
        self.assertEqual(r["contagem"]["rescisao"], 2)

    def test_ato_novo_recebe_a_data_da_deteccao_e_repeticao_nao_duplica(self):
        r1 = D.montar(None, [self.it(1)], {11}, "2026-10-04", self.D1)
        r2 = D.montar(r1, [self.it(1), self.it(2, tipo="paralisacao")], {11, 12}, "2026-10-04", self.D2)
        self.assertEqual(r2["novos"], ["2"])
        por_id = {i["id"]: i for i in r2["itens"]}
        self.assertEqual(por_id["2"]["visto_em"], "2026-10-31T12:00:00Z")
        self.assertIsNone(por_id["1"]["visto_em"])  # o antigo continua sem data de detecção
        self.assertEqual(len(r2["itens"]), 2)

    def test_ordem_do_mais_recente_e_corte_por_data(self):
        r = D.montar(None, [self.it(1, "2026-10-10"), self.it(2, "2026-10-28"), self.it(3, "2026-09-30")], {1}, "2026-10-04", self.D1)
        self.assertEqual([i["id"] for i in r["itens"]], ["2", "1"])  # 30/09 é anterior ao corte

    def test_mudou_ignora_a_hora_de_geracao(self):
        r1 = D.montar(None, [self.it(1)], {11}, "2026-10-04", self.D1)
        r2 = D.montar(r1, [self.it(1)], {11}, "2026-10-04", self.D2)
        self.assertFalse(D.mudou(r1, r2))
        r3 = D.montar(r2, [self.it(1), self.it(2)], {11}, "2026-10-04", self.D2)
        self.assertTrue(D.mudou(r2, r3))


if __name__ == "__main__":
    unittest.main()
