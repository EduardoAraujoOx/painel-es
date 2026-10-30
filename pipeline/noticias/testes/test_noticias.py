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
        comp = {t: coletar.compilar_lista(v["termos"]) for t, v in CFG["temas"].items()}
        self.assertIn("transicao", coletar.temas_de(CFG, "Pazolini escolhe Erick Musso para coordenar transição de governo no ES", comp))
        self.assertIn("financas", coletar.temas_de(CFG, "Governo do ES pode enviar novo projeto de Orçamento à Assembleia", comp))

    def test_recorte_comeca_a_meia_noite_de_brasilia(self):
        self.assertEqual(coletar.inicio_do_recorte({"desde": "2026-10-25"}), datetime(2026, 10, 25, 3, 0, tzinfo=UTC))


FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title> Governo do ES publica decreto &amp; remanejamento </title><link>https://exemplo.com/a</link><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate><source>Veiculo A</source></item>
<item><title>Link perigoso</title><link>javascript:alert(1)</link><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Sem link</title><pubDate>Fri, 30 Oct 2026 12:00:00 GMT</pubDate></item>
</channel></rss>"""


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
        self.assertIn("3 novas", msgs[0]["Subject"])  # a de 30 horas atrás fica de fora no primeiro envio (24 h)
        self.assertTrue(enviar.MARCO.exists())

    def test_segundo_envio_sem_novidade_nao_manda_nada(self):
        self.rodar(self.ENV)
        self.assertEqual(self.rodar(self.ENV), [])

    def test_teste_nao_mexe_no_marco(self):
        msgs = self.rodar(self.ENV, ["--teste"])
        self.assertTrue(msgs[0]["Subject"].startswith("[TESTE]"))
        self.assertFalse(enviar.MARCO.exists())

    def test_so_o_que_veio_depois_do_marco_entra(self):
        enviar.MARCO.write_text(json.dumps({"ultimo_envio": enviar.iso(self.ref - timedelta(minutes=150))}), encoding="utf-8")
        msgs = self.rodar(self.ENV)
        self.assertIn("2 novas", msgs[0]["Subject"])  # só os itens 1 e 2 foram coletados depois do marco

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


if __name__ == "__main__":
    unittest.main()
