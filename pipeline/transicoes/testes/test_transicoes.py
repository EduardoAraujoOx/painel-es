"""Testes do coletor de transições em outros estados (módulo `transicoes`). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/transicoes/testes -v
Não usam rede: partem de títulos reais do Google Notícias (08/11/2026)."""

import importlib.util
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("transicoes", Path(__file__).resolve().parents[1] / "coletar.py")
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)
UTC = timezone.utc
CFG = json.loads(T.CONFIG.read_text(encoding="utf-8"))
F = T.preparar(CFG)


def c(titulo):
    return T.classificar(CFG, titulo, F)


class Configuracao(unittest.TestCase):
    def test_treze_estados_sem_o_es_e_sem_repeticao(self):
        ufs = [e["uf"] for e in CFG["estados"]]
        self.assertEqual(len(ufs), 13)
        self.assertEqual(len(set(ufs)), 13)
        self.assertNotIn("ES", ufs)
        self.assertEqual(set(ufs), {"AL", "AP", "AM", "MA", "MG", "PA", "PR", "RJ", "RN", "RS", "RO", "RR", "TO"})

    def test_todo_estado_tem_busca_e_cue_e_todo_tema_de_medida_existe(self):
        for e in CFG["estados"]:
            self.assertEqual(len(e["buscas"]), 2, e["uf"])
            self.assertTrue(e["cues"] or e.get("cues_exatos"), e["uf"])
            self.assertTrue(e["eleito"] and e["partido"], e["uf"])
        for t in CFG["temas_de_medida"]:
            self.assertIn(t, CFG["temas"])

    def test_consultas_cobrem_cada_estado_e_as_gerais(self):
        q = list(T.consultas(CFG, 30))
        self.assertEqual(len(q), 13 * 3 + len(CFG["buscas_gerais"]))
        self.assertTrue(all("when:30d" in txt for _, txt in q))


class Classificacao(unittest.TestCase):
    def test_medidas_de_outros_estados_entram_com_a_uf_e_o_tema(self):
        casos = [("Sergio Moro anuncia redução de secretarias e combate ao crime no Paraná", ["PR"], "estrutura"),
                 ("Zucco mira fusão de secretarias em reforma administrativa que será votada antes do novo governo do assumir", ["RS"], "estrutura"),
                 ("Cleitinho anuncia auditorias em contratos do governo de Minas", ["MG"], "contratos"),
                 ("Marcos Rogério negocia Orçamento de R$ 20 bilhões e prepara cortes de gastos", ["RO"], "gastos"),
                 ("Governo de Minas prevê déficit de quase R$ 8,9 bi no ano que vem, o primeiro sob Cleitinho", ["MG"], "diagnostico"),
                 ("Omar Aziz promete renegociar dívida do AM, fazer concursos e reduzir filas na saúde nos primeiros 100 dias", ["AM"], "pessoal"),
                 ("Braide anuncia início da transição de governo e reafirma redução do ICMS como prioridade", ["MA"], "economia")]
        for t, ufs, tema in casos:
            r = c(t)
            self.assertIsNotNone(r, t)
            self.assertEqual(r["ufs"], ufs, t)
            self.assertIn(tema, r["temas"], t)
            self.assertEqual(r["categoria"], "medida", t)

    def test_nomes_e_protocolo_entram_como_equipe(self):
        for t, uf in [("Cadu Xavier anuncia primeiros nomes da equipe de transição do Governo do RN", "RN"),
                      ("Transição no Paraná para Moro começa em 5 de novembro", "PR"),
                      ("Governo do Tocantins publica decreto que regulamenta transição para gestão de Vicentinho Júnior", "TO"),
                      ("Equipes de Moro e Ratinho Jr iniciam transição do governo do Paraná", "PR")]:
            r = c(t)
            self.assertIsNotNone(r, t)
            self.assertEqual((r["ufs"], r["categoria"]), ([uf], "equipe"), t)

    def test_sigla_e_nome_exato_do_estado(self):
        self.assertEqual(c("Governo do RS e equipe de transição discutem contas do estado")["ufs"], ["RS"])
        self.assertEqual(c("Hana define equipe para transição de governo no Pará; confira os nomes")["ufs"], ["PA"])

    def test_para_minusculo_nao_vira_o_estado_do_para(self):
        self.assertIsNone(c("Equipe de transição se prepara para o novo governo e vai cortar gastos"))
        self.assertEqual(T.ufs_do_titulo(F, "Transição para o novo governo começa hoje"), [])

    def test_fora_do_escopo_nao_entra(self):
        for t in ("Pazolini anuncia equipe de transição e promete cortar gastos no ES",  # o ES tem as outras abas
                  "Tarcísio promete cortar gastos em São Paulo no segundo mandato",  # estado que mantém o governo
                  "Equipe de transição de Elmano de Freitas reúne secretários no Ceará",
                  "Transição energética: Rondônia atrai investimentos em biocombustíveis",  # outro sentido de "transição"
                  "Transição de carreira em TI: como usar a experiência para conquistar novas oportunidades",
                  "Prefeito eleito de Porto Velho monta equipe de transição em Rondônia",
                  "Marcos Rogério vota projeto no Senado",  # cita o eleito, sem transição nem medida
                  "Cleitinho cobra políticos que defendem boicotes por voto: abram mão do salário"):
            self.assertIsNone(c(t), t)

    def test_nome_do_eleito_com_medida_basta_sem_a_palavra_transicao(self):
        r = c("Marcos Rogério prepara cortes profundos na própria carne do governo, para iniciar seu mandato")
        self.assertEqual((r["ufs"], r["categoria"]), (["RO"], "medida"))


class Consolidacao(unittest.TestCase):
    HOJE = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)

    def coletado(self, titulo, url="https://g.com/1", veiculo="G1", dias=1):
        return {"titulo": titulo, "veiculo": veiculo, "url": url, "data": self.HOJE - timedelta(days=dias)}

    def test_deduplica_pelo_titulo_e_prefere_o_link_direto(self):
        t = "Cleitinho anuncia auditorias em contratos do governo de Minas"
        itens = T.consolidar(CFG, [self.coletado(t, "https://news.google.com/rss/articles/abc", "Estado de Minas"), self.coletado(t, "https://em.com.br/x", "Estado de Minas"),
                                    self.coletado(t, "https://g1.globo.com/y", "G1")], self.HOJE)
        self.assertEqual(len(itens), 1)
        self.assertEqual(itens[0]["url"], "https://em.com.br/x")
        self.assertEqual([o["veiculo"] for o in itens[0]["outras"]], ["G1"])  # o link do Google (mesmo veículo) não vira "outra"; o de outro veículo vira

    def test_reclassifica_o_guardado_e_tira_o_que_nao_passa_mais(self):
        velho = {"id": "x1", "titulo": "Tarcísio promete cortar gastos em São Paulo", "veiculo": "G1", "url": "https://g.com/2", "data": "2026-11-01T10:00:00Z", "coletado_em": "2026-11-01T10:00:00Z", "outras": []}
        bom = {"id": "x2", "titulo": "Sergio Moro anuncia redução de secretarias no Paraná", "veiculo": "G1", "url": "https://g.com/3", "data": "2026-11-01T10:00:00Z", "coletado_em": "2026-11-01T10:00:00Z", "outras": []}
        itens = T.consolidar(CFG, [], self.HOJE, [velho, bom])
        self.assertEqual([i["id"] for i in itens], ["x2"])
        self.assertEqual(itens[0]["ufs"], ["PR"])

    def test_no_primeiro_levantamento_nada_e_novo_e_depois_so_o_que_apareceu(self):
        a = self.coletado("Sergio Moro anuncia redução de secretarias no Paraná", "https://g.com/a", dias=3)
        primeiro = T.consolidar(CFG, [a], self.HOJE)
        self.assertEqual(primeiro[0]["coletado_em"], T.N.iso(a["data"]))
        b = self.coletado("Cleitinho anuncia auditorias em contratos do governo de Minas", "https://g.com/c", dias=0)
        segundo = {i["titulo"][:8]: i for i in T.consolidar(CFG, [a, b], self.HOJE, primeiro)}
        self.assertEqual(segundo["Cleitinh"]["coletado_em"], T.N.iso(self.HOJE))
        self.assertEqual(segundo["Sergio M"]["coletado_em"], T.N.iso(a["data"]))

    def test_corta_o_que_e_anterior_ao_primeiro_turno(self):
        antigo = self.coletado("Sergio Moro anuncia redução de secretarias no Paraná", dias=40)  # 29/09/2026
        self.assertEqual(T.consolidar(CFG, [antigo], self.HOJE), [])

    def test_montar_conta_por_estado_e_por_categoria(self):
        itens = T.consolidar(CFG, [self.coletado("Sergio Moro anuncia redução de secretarias no Paraná", "https://g.com/a"),
                                   self.coletado("Transição no Paraná para Moro começa em 5 de novembro", "https://g.com/b"),
                                   self.coletado("Cleitinho anuncia auditorias em contratos do governo de Minas", "https://g.com/c")], self.HOJE)
        saida = T.montar(CFG, itens, self.HOJE)
        self.assertEqual(saida["contagem"], {"total": 3, "medidas": 2, "equipe": 1})
        self.assertEqual({e["uf"]: e["total"] for e in saida["estados"]}["PR"], 2)
        self.assertEqual(len(saida["estados"]), 13)
        self.assertEqual(saida["ref"], "2026-11-08")


if __name__ == "__main__":
    unittest.main()
