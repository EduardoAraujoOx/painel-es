"""Testes do coletor e do resumo por e-mail (módulo `noticias`). Só biblioteca padrão:
  python3 -I -m unittest discover -s pipeline/noticias/testes -v
Não usam rede nem as notícias reais: tudo parte de dados fictícios criados aqui."""

import importlib.util
import json
import smtplib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

PASTA = Path(__file__).resolve().parents[1]


def carregar(nome):
    spec = importlib.util.spec_from_file_location(nome, PASTA / f"{nome}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


coletar = carregar("coletar")
enviar = carregar("enviar")
CFG = json.loads((PASTA / "config.json").read_text(encoding="utf-8"))
UTC = timezone.utc


class TextoERegras(unittest.TestCase):
    def test_normalizar_tira_acento_e_pontuacao(self):
        self.assertEqual(coletar.normalizar("Orçamento: Remanejamento!"), "orcamento remanejamento")

    def test_asterisco_casa_continuacao_e_respeita_fronteira(self):
        p = [coletar.compilar("remanejamento*")]
        self.assertTrue(coletar.casa(p, coletar.normalizar("Remanejamentos de despesa")))
        self.assertFalse(coletar.casa([coletar.compilar("tce")], coletar.normalizar("tcetera")))

    def test_temas_da_config(self):
        comp = coletar.compilar_temas(CFG)
        self.assertIn("transicao", coletar.temas_de(CFG, "Pazolini escolhe Erick Musso para coordenar transição de governo no ES", comp))
        self.assertIn("financas", coletar.temas_de(CFG, "Governo do ES pode enviar novo projeto de Orçamento à Assembleia", comp))

    def test_recorte_comeca_a_meia_noite_de_brasilia(self):
        self.assertEqual(coletar.inicio_do_recorte({"desde": "2026-10-25"}), datetime(2026, 10, 25, 3, 0, tzinfo=UTC))


FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title> Governo do ES publica decreto &amp; remanejamento </title><link>https://exemplo.com/a</link><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate><source>Veiculo A</source></item>
<item><title>Link perigoso</title><link>javascript:alert(1)</link><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Sem link</title><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate></item>
</channel></rss>"""


class CasoSejus(unittest.TestCase):
    """Matérias reais de 29-30/10/2026 que o filtro antigo descartava por não conhecer a Sejus."""
    TITULOS = ["Sejus suspende uso de câmeras corporais, rastreamento de viaturas e biometria facial",
               "Sejus suspende contratos de rastreamento de viaturas e câmeras corporais",
               "Sejus suspende contratos de infraestrutura e tecnologia por falta de recursos"]

    def test_entram_e_recebem_o_tema_de_restricao(self):
        F = coletar.preparar(CFG)
        for t in self.TITULOS:
            self.assertEqual(coletar.decidir(CFG, t, "G1", F, regional=True)[0], "confirmada", t)  # via busca restrita ao G1 Espírito Santo
            self.assertIn("restricao", coletar.temas_de(CFG, t, F["temas"]), t)

    def test_notícia_policial_com_restricao_nao_e_descartada_como_ruido(self):
        tmp = Path(tempfile.mkdtemp()); coletar.SAIDA = tmp / "index.json"
        hoje = datetime(2026, 10, 30, 15, 0, tzinfo=UTC)
        it = {"titulo": self.TITULOS[1], "veiculo": "V", "url": "https://e.com/x", "data": hoje - timedelta(hours=1)}
        itens, _ = coletar.consolidar(CFG, [it], hoje)
        self.assertEqual(len(itens), 1)
        self.assertEqual(itens[0]["temas"][0], "restricao")


class Auditoria(unittest.TestCase):
    """Falhas achadas na auditoria de 30/10/2026 (matérias relevantes que o filtro descartava) e os falsos positivos que as correções poderiam criar."""

    def classe(self, titulo, veiculo="Folha do ES", regional=False):
        return coletar.decidir(CFG, titulo, veiculo, coletar.preparar(CFG), regional)[0]

    def test_vocabulario_fiscal_royalties_e_emendas(self):
        self.assertEqual(self.classe("ES pode perder R$ 500 milhões com decisão do STF sobre royalties do petróleo"), "confirmada")
        self.assertEqual(self.classe("Lei fixa regras para execução de emendas parlamentares no ES"), "confirmada")

    def test_governo_do_espirito_santo_por_extenso(self):
        self.assertEqual(self.classe("Governo do Espírito Santo assina aval e Polícia Científica prepara primeiro concurso"), "confirmada")

    def test_flexao_e_preposicao_nao_escondem_a_restricao(self):
        comp = coletar.compilar_temas(CFG)
        for t in ("Sejus suspendeu os contratos de rastreamento", "Suspensão dos contratos da Sesp preocupa servidores",
                  "Secretaria interrompe obras por falta de verba", "Sesa deixa de pagar fornecedores e atrasa repasses"):
            self.assertIn("restricao", coletar.temas_de(CFG, t, comp), t)

    def test_siglas_de_outros_estados_nao_entram(self):
        for t in ("Concurso da SEFAZ SP: últimos dias de inscrição para 60 vagas de analista", "Detran-DF suspende atendimento presencial até segunda-feira"):
            self.assertEqual(self.classe(t, "G1"), "descartada", t)
        self.assertEqual(self.classe("Sefaz-ES divulga calendário do IPVA", "A Gazeta"), "confirmada")
        self.assertEqual(self.classe("Pazolini se reúne com governador de SP", "A Gazeta"), "confirmada")  # âncora do ES

    def test_sigla_de_orgao_que_existe_em_varios_estados_exige_fonte_capixaba_ou_ancora(self):
        t = "TCE determina suspensão de licitação da Sedurb por divergências em edital"
        self.assertEqual(self.classe(t, "Amazonas1"), "possivel")                    # fonte de fora, sem âncora do ES
        self.assertEqual(self.classe(t, "Folha do ES"), "confirmada")                 # veículo capixaba
        self.assertEqual(self.classe(t, "Amazonas1", regional=True), "confirmada")    # veio de busca restrita a site capixaba
        self.assertEqual(self.classe("Sedurb do ES licita obra", "Amazonas1"), "confirmada")  # âncora no próprio título

    def test_site_de_concurso_e_excluido(self):
        self.assertEqual(self.classe("Concurso Banestes: inscrições abertas para 936 vagas", "Estratégia Concursos"), "descartada")

    def test_fonte_oficial_passa_direto(self):
        self.assertEqual(self.classe("Confira o expediente dos órgãos nos dias 30 de outubro e 2 de novembro", "Governo ES"), "confirmada")

    def test_restricao_sozinha_nao_basta_com_a_mera_mencao_ao_es(self):
        # uma operadora que suspende serviço no ES não é notícia do governo: vira "possível", não "confirmada"
        self.assertEqual(self.classe("Vivo suspende serviços de internet no ES após falha"), "possivel")

    def test_o_que_cheira_a_assunto_publico_capixaba_vira_possivel_e_o_resto_cai(self):
        self.assertEqual(self.classe("Estado deixa de pagar fornecedores e atrasa repasses a hospitais"), "possivel")
        self.assertEqual(self.classe("Flávio Bolsonaro usou passaporte italiano para entrar na Argentina"), "descartada")

    def test_palavra_de_dois_sentidos_nao_vira_tema_fiscal(self):
        comp = coletar.compilar_temas(CFG)
        self.assertNotIn("financas", coletar.temas_de(CFG, "Almoço sem carne: 5 receitas práticas e ricas em proteínas vegetais", comp))
        self.assertIn("financas", coletar.temas_de(CFG, "Queda na receita pública preocupa o governo do ES", comp))

    def test_possivel_fica_fora_do_resumo_e_sobe_de_categoria_quando_confirmada(self):
        tmp = Path(tempfile.mkdtemp()); coletar.SAIDA = tmp / "index.json"
        hoje = datetime(2026, 10, 30, 15, 0, tzinfo=UTC)
        base = {"titulo": "Estado deixa de pagar fornecedores e atrasa repasses a hospitais", "veiculo": "V", "url": "https://e.com/x", "data": hoje - timedelta(hours=1)}
        itens, novos = coletar.consolidar(CFG, [{**base, "possivel": True}], hoje)
        self.assertEqual((len(itens), novos, itens[0]["possivel"]), (1, 0, True))  # "novos" conta só as confirmadas
        self.assertEqual(enviar.selecionar(itens, hoje - timedelta(days=1)), [])
        coletar.SAIDA.write_text(json.dumps({"itens": itens}), encoding="utf-8")
        itens, novos = coletar.consolidar(CFG, [{**base, "possivel": False}], hoje)
        self.assertEqual((len(itens), novos, itens[0]["possivel"]), (1, 1, False))


class FerramentaDeAuditoria(unittest.TestCase):
    """A auditoria só serve se mostrar TODO motivo de descarte: o que ela omite é justamente o que ninguém vai ver."""

    def test_todo_motivo_que_o_filtro_emite_esta_descrito_na_auditoria(self):
        auditar = carregar("auditar")
        F = coletar.preparar(CFG)
        casos = [("TCE determina suspensão de licitação da Sedurb por divergências em edital", "Amazonas1"),  # sigla_sem_ancora
                 ("Concurso da SEFAZ SP: últimos dias de inscrição", "G1"),                                  # outro_estado
                 ("Horóscopo de hoje: veja o que os astros revelam", "A Gazeta"),                            # excluir
                 ("Concurso Banestes: inscrições abertas para 936 vagas", "Estratégia Concursos"),           # veiculo_excluido
                 ("ATA DA ASSEMBLEIA GERAL EXTRAORDINÁRIA DA COMPANHIA ESTADUAL DE TRANSPORTES COLETIVOS", "Tribuna Online"),  # caixa_alta
                 ("Estado deixa de pagar fornecedores e atrasa repasses a hospitais", "Folha do ES"),         # possivel
                 ("Prefeitura anuncia novo orçamento para 2027", "Folha Nacional"),                           # sem_contexto_com_tema
                 ("Flávio Bolsonaro usou passaporte italiano", "Folha do ES")]                                # sem_contexto
        vistos = set()
        for titulo, veiculo in casos:
            classe, motivo = coletar.decidir(CFG, titulo, veiculo, F)
            if classe != "confirmada":
                vistos.add(motivo)
                self.assertIn(motivo, auditar.MOTIVOS, f"a auditoria omitiria o motivo {motivo!r} ({titulo})")
        self.assertGreaterEqual(len(vistos), 7)  # o teste cobre de fato os motivos, não só um


class Feeds(unittest.TestCase):
    def test_le_item_valido_e_descarta_link_inseguro_ou_ausente(self):
        itens = coletar.ler_feed(FEED)
        self.assertEqual(len(itens), 1)
        self.assertEqual(itens[0]["titulo"], "Governo do ES publica decreto & remanejamento")
        self.assertEqual(itens[0]["veiculo"], "Veiculo A")

    def test_recusa_declaracao_de_entidades(self):
        mau = b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "y">]><rss><channel><item><title>&x;</title><link>https://a.com</link></item></channel></rss>'
        with self.assertRaises(ValueError):
            coletar.ler_feed(mau)

    def test_tira_o_veiculo_que_o_google_anexa_ao_titulo(self):
        self.assertEqual(coletar.tirar_veiculo_do_titulo("Decreto sai hoje - Folha Vitória", "Folha Vitória"), "Decreto sai hoje")
        self.assertEqual(coletar.tirar_veiculo_do_titulo("Decreto - sai hoje", "Folha Vitória"), "Decreto - sai hoje")


class Consolidacao(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        coletar.SAIDA = self.tmp / "index.json"  # sem histórico anterior
        self.hoje = datetime(2026, 10, 30, 15, 0, tzinfo=UTC)

    def item(self, titulo, veiculo="V", url="https://e.com/x", data=None):
        return {"titulo": titulo, "veiculo": veiculo, "url": url, "data": data or self.hoje - timedelta(hours=1)}

    def test_corta_o_que_e_anterior_a_eleicao(self):
        antigo = self.item("Governo do ES anuncia orçamento", data=datetime(2026, 10, 24, 12, 0, tzinfo=UTC))
        novo = self.item("Governo do ES anuncia orçamento novo")
        itens, _ = coletar.consolidar(CFG, [antigo, novo], self.hoje)
        self.assertEqual([i["titulo"] for i in itens], ["Governo do ES anuncia orçamento novo"])

    def test_policial_sem_tema_de_atencao_e_descartado_mas_com_tema_fica(self):
        crime = self.item("Assalto a ônibus em Vila Velha deixa um morto no ES")
        ficou = self.item("Governador eleito promete pacto estadual para combater o feminicídio")
        itens, _ = coletar.consolidar(CFG, [crime, ficou], self.hoje)
        self.assertEqual([i["titulo"] for i in itens], ["Governador eleito promete pacto estadual para combater o feminicídio"])

    def test_mesmo_titulo_em_veiculos_diferentes_vira_uma_noticia(self):
        a = self.item("Transição de Pazolini solicita dados de dez áreas", "Veículo A", "https://a.com/1")
        b = self.item("Transição de Pazolini solicita dados de dez áreas", "Veículo B", "https://b.com/1")
        itens, novos = coletar.consolidar(CFG, [a, b], self.hoje)
        self.assertEqual((len(itens), novos), (1, 1))
        self.assertEqual([o["veiculo"] for o in itens[0]["outras"]], ["Veículo B"])

    def test_ordem_da_mais_recente_para_a_mais_antiga(self):
        v = self.item("Governo do ES publica decreto A", data=self.hoje - timedelta(hours=5))
        n = self.item("Governo do ES publica decreto B", data=self.hoje - timedelta(hours=1))
        itens, _ = coletar.consolidar(CFG, [v, n], self.hoje)
        self.assertEqual([i["titulo"][-1] for i in itens], ["B", "A"])


def dados_ficticios(agora):
    def it(i, titulo, temas, horas, coletado_horas):
        return {"id": f"id{i}", "titulo": titulo, "veiculo": f"Veículo {i}", "url": f"https://exemplo.com/{i}", "temas": temas,
                "data": enviar.iso(agora - timedelta(hours=horas)), "coletado_em": enviar.iso(agora - timedelta(hours=coletado_horas)), "outras": []}
    return {"temas": {"transicao": "Transição", "financas": "Finanças e orçamento", "governador": "Governador e Palácio"},
            "itens": [it(1, "Equipe de transição recebe dados", ["transicao", "governador"], 1, 1),
                      it(2, "Estado remaneja despesas", ["financas"], 2, 2),
                      it(3, "Governador visita obra", ["governador"], 3, 3),
                      it(4, "Notícia antiga já enviada", ["financas"], 30, 30)]}


class Resumo(unittest.TestCase):
    def setUp(self):
        self.ref = datetime(2026, 10, 30, 15, 0, tzinfo=UTC)
        self.dados = dados_ficticios(self.ref)
        self.tmp = Path(tempfile.mkdtemp())
        enviar.DADOS, enviar.MARCO = self.tmp / "index.json", self.tmp / "ultimo-envio.json"
        enviar.DADOS.write_text(json.dumps(self.dados), encoding="utf-8")
        self.enviados = []
        outer = self

        class Falso:
            def __init__(s, *a, **k): pass
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def starttls(s, **k): pass
            def login(s, u, p): pass
            def send_message(s, m): outer.enviados.append(m)
        self.original = smtplib.SMTP
        smtplib.SMTP = Falso

    def tearDown(self):
        smtplib.SMTP = self.original

    def rodar(self, env, args=()):
        import os, sys
        self.enviados.clear()
        for k in ("NOTICIAS_DESTINATARIOS", "SMTP_USUARIO", "SMTP_SENHA", "PAINEL_URL"):
            os.environ.pop(k, None)
        os.environ.update(env)
        enviar.agora = lambda: self.ref
        sys.argv = ["enviar.py", *args]
        enviar.main()
        return list(self.enviados)

    ENV = {"NOTICIAS_DESTINATARIOS": "a@exemplo.com; B@exemplo.com, a@exemplo.com, invalido@", "SMTP_USUARIO": "u@exemplo.com", "SMTP_SENHA": "s"}

    def test_sem_credenciais_nao_envia_nem_grava_marco(self):
        self.assertEqual(self.rodar({}), [])
        self.assertFalse(enviar.MARCO.exists())

    def test_envia_um_por_destinatario_sem_duplicar_e_grava_marco(self):
        msgs = self.rodar(self.ENV)
        self.assertEqual(sorted(m["To"] for m in msgs), ["B@exemplo.com", "a@exemplo.com"])
        self.assertEqual({p.get_content_type() for p in msgs[0].iter_parts()}, {"text/plain", "text/html"})
        self.assertIn("3 notícias novas", msgs[0]["Subject"])
        corpo = msgs[0].get_body(("html",)).get_content()
        self.assertIn("Abrir o painel", corpo)  # sem PAINEL_URL, vale o endereço padrão
        self.assertIn("https://painel-es.vercel.app", corpo)  # a de 30 horas atrás fica de fora no primeiro envio (24 h)
        self.assertTrue(enviar.MARCO.exists())

    def test_segundo_envio_sem_novidade_nao_manda_nada(self):
        self.rodar(self.ENV)
        self.assertEqual(self.rodar(self.ENV), [])

    def test_teste_nao_mexe_no_marco(self):
        msgs = self.rodar(self.ENV, ["--teste"])
        self.assertTrue(msgs[0]["Subject"].startswith("[TESTE] Governo e transição no ES:"))
        self.assertFalse(enviar.MARCO.exists())

    def test_so_o_que_veio_depois_do_marco_entra(self):
        enviar.MARCO.write_text(json.dumps({"ultimo_envio": enviar.iso(self.ref - timedelta(minutes=150))}), encoding="utf-8")
        msgs = self.rodar(self.ENV)
        self.assertIn("2 notícias novas", msgs[0]["Subject"])  # só os itens 1 e 2 foram coletados depois do marco

    def test_agrupa_por_tema_na_ordem_de_prioridade_sem_repetir(self):
        grupos = enviar.agrupar(enviar.selecionar(self.dados["itens"], self.ref - timedelta(hours=48)), self.dados["temas"])
        self.assertEqual([g[0] for g in grupos], ["Transição", "Finanças e orçamento", "Governador e Palácio"])
        self.assertEqual(sum(len(g[1]) for g in grupos), 4)

    def test_titulo_malicioso_e_escapado_e_link_perigoso_nao_vira_href(self):
        d = json.loads(json.dumps(self.dados))
        d["itens"][0]["titulo"] = '<script>alert(1)</script> & "x"'
        d["itens"][0]["url"] = "javascript:alert(1)"
        corpo_html, corpo_txt = enviar.montar_conteudo(d, d["itens"][:2], self.ref, "", "agora")
        self.assertNotIn("<script>", corpo_html)
        self.assertNotIn("javascript:", corpo_html)
        self.assertIn("&lt;script&gt;", corpo_html)
        self.assertNotIn("javascript:", corpo_txt)


    # --- o resumo também traz contratos que o detector viu suspensos, rescindidos ou anulados ---

    def prepara(self, contratos):
        enviar.SUSPENSOS = self.tmp / "suspensos.json"
        enviar.SUSPENSOS.write_text(json.dumps({"itens": contratos}), encoding="utf-8")

    def contrato(self, i, horas, cat="suspenso", **extra):
        return {"id": f"c{i}", "orgao": "SECRETARIA DE ESTADO DA JUSTIÇA", "fornecedor": f"Fornecedor {i}", "objeto": "Sistema de monitoramento <b>eletrônico</b>",
                "tipo": "Contrato", "valor_inicial": 2500000.0, "valor_final": 2500000.0, "categoria": cat, "situacao": "Instrumento Contratual Suspenso",
                "visto_em": enviar.iso(self.ref - timedelta(hours=horas)), **extra}

    def test_so_entra_o_que_foi_visto_depois_do_marco_e_o_baseline_nao_conta(self):
        self.prepara([self.contrato(1, 2), self.contrato(2, 40), {**self.contrato(3, 1), "visto_em": None}])
        self.assertEqual([c["id"] for c in enviar.contratos_novos(self.ref - timedelta(hours=24))], ["c1"])
        enviar.SUSPENSOS = self.tmp / "nao_existe.json"
        self.assertEqual(enviar.contratos_novos(self.ref - timedelta(hours=24)), [])

    def test_resumo_devido_recupera_horario_pulado(self):
        h = lambda dia, hora, minuto: datetime(2026, 10, dia, hora, minuto, tzinfo=UTC)
        # 08h17 BRT (11h17 UTC) pulado: às 12h UTC ainda é devido, e deixa de ser depois de um envio
        self.assertTrue(enviar.resumo_devido(h(30, 21, 29), h(31, 12, 0)))
        self.assertFalse(enviar.resumo_devido(h(31, 12, 5), h(31, 13, 0)))
        # antes do primeiro horário do dia, vale o envio da noite anterior (21h17 UTC)
        self.assertFalse(enviar.resumo_devido(h(30, 21, 29), h(31, 10, 0)))
        self.assertTrue(enviar.resumo_devido(h(30, 15, 30), h(31, 10, 0)))
        self.assertTrue(enviar.resumo_devido(None, h(31, 10, 0)))

    def test_devido_so_informa_e_nao_envia(self):
        enviar.MARCO.write_text(json.dumps({"ultimo_envio": enviar.iso(self.ref - timedelta(hours=30))}), encoding="utf-8")
        import io, contextlib, sys
        enviar.agora = lambda: self.ref
        sys.argv = ["enviar.py", "--devido"]
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            enviar.main()
        self.assertEqual(saida.getvalue().strip(), "sim")
        self.assertEqual(self.enviados, [])

    def test_assunto_com_contratos(self):
        self.assertIn("2 notícias novas e 1 contrato suspenso, rescindido ou anulado", enviar.assunto(2, self.ref, False, 1))
        self.assertIn("3 contratos suspensos, rescindidos ou anulados", enviar.assunto(0, self.ref, False, 3))
        self.assertNotIn("contrato", enviar.assunto(2, self.ref, False, 0))

    def test_dia_so_com_contrato_novo_ainda_envia_e_escapa_o_html(self):
        d = json.loads(json.dumps(self.dados)); d["itens"] = []
        enviar.DADOS.write_text(json.dumps(d), encoding="utf-8")
        self.prepara([self.contrato(1, 1)])
        msgs = self.rodar(self.ENV)
        self.assertEqual(len(msgs), 2)
        self.assertIn("1 contrato suspenso", msgs[0]["Subject"])
        corpo = msgs[0].get_body(("html",)).get_content()
        self.assertIn("Contratos suspensos, rescindidos ou anulados (1)", corpo)
        self.assertIn("&lt;b&gt;eletrônico", corpo)
        self.assertNotIn("<b>eletrônico", corpo)

    def test_sem_noticia_e_sem_contrato_novo_nao_envia(self):
        d = json.loads(json.dumps(self.dados)); d["itens"] = []
        enviar.DADOS.write_text(json.dumps(d), encoding="utf-8")
        self.prepara([self.contrato(1, 40)])
        self.assertEqual(self.rodar(self.ENV), [])


if __name__ == "__main__":
    unittest.main()
