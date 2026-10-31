#!/usr/bin/env python3
"""
Coletor de notícias do painel Transição (módulo `noticias`).

Lê, uma vez por dia, o Google Notícias (consultas fixas, inclusive por site, o que alcança
veículos que bloqueiam leitura automatizada) e os feeds RSS dos principais veículos
capixabas, descarta o que não tem relação com o governo do Estado, marca cada notícia com
temas por regras de palavras (config.json) e grava data/noticias/index.json.

Só guarda título, veículo, data e link: nunca o texto da matéria. A triagem é
determinística, sem modelo de linguagem, e serve para indicar onde olhar; não
substitui a leitura da notícia.

Uso (sem dependências externas):
  python3 -I pipeline/noticias/coletar.py              # coleta a janela do config.json
  python3 -I pipeline/noticias/coletar.py --dias 30    # carga inicial / retroativa
  python3 -I pipeline/noticias/coletar.py --dry-run    # mostra o resumo sem gravar
"""

import argparse
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
CONFIG = AQUI / "config.json"
SAIDA = RAIZ / "data" / "noticias" / "index.json"
VERIFICACAO = RAIZ / "data" / "noticias" / "verificacao.json"

AGENTE = "Mozilla/5.0 (compatible; painel-es-noticias/1.0; +https://github.com/EduardoAraujoOx/painel-es)"
LIMITE_BYTES = 6_000_000
GOOGLE = "https://news.google.com/rss/search?q={q}&hl=pt-BR&gl=BR&ceid=BR:pt-419"
MAX_OUTRAS = 5  # veículos adicionais guardados quando o mesmo título aparece em mais de um


def agora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- texto

def normalizar(s):
    """Minúsculas, sem acento, hífen e pontuação viram espaço (o * é preservado)."""
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9*]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def compilar(termo):
    partes = [re.escape(p).replace(r"\*", "[a-z0-9]*") for p in normalizar(termo).split()]
    return re.compile(r"(?<![a-z0-9])" + r"\s+".join(partes) + r"(?![a-z0-9])")


def compilar_lista(termos):
    return [compilar(t) for t in termos]


def casa(padroes, texto):
    return any(p.search(texto) for p in padroes)


def limpar(s):
    s = html.unescape(s or "")
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def url_segura(u):
    try:
        p = urllib.parse.urlparse((u or "").strip())
    except ValueError:
        return ""
    return u.strip() if p.scheme in ("http", "https") and p.netloc else ""


# ---------------------------------------------------------------- rede e feeds

def baixar(url, tentativas=3):
    ultimo = None
    for n in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                dados = r.read(LIMITE_BYTES + 1)
            if len(dados) > LIMITE_BYTES:
                raise ValueError("resposta acima do limite de tamanho")
            return dados
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            ultimo = e
            time.sleep(2 * (n + 1))
    raise RuntimeError(str(ultimo))


def ler_feed(dados):
    """Devolve [{titulo, url, data, veiculo}] de um RSS ou Atom. Recusa DTD/entidades (XML não confiável)."""
    if b"<!ENTITY" in dados.upper():
        raise ValueError("feed com declaração de entidades recusado")
    raiz = ET.fromstring(dados)
    itens = []
    for no in raiz.iter():
        marca = no.tag.split("}")[-1]
        if marca not in ("item", "entry"):
            continue
        campo = {}
        for c in no:
            k = c.tag.split("}")[-1]
            if k == "link" and not (c.text or "").strip() and c.get("href"):
                campo.setdefault("link", c.get("href"))
            elif k not in campo:
                campo[k] = (c.text or "").strip()
        titulo = limpar(campo.get("title"))
        link = url_segura(campo.get("link"))
        data = None
        for k in ("pubDate", "published", "updated", "date"):
            if campo.get(k):
                try:
                    data = parsedate_to_datetime(campo[k])
                except (TypeError, ValueError):
                    try:
                        data = datetime.fromisoformat(campo[k].replace("Z", "+00:00"))
                    except ValueError:
                        data = None
                if data is not None:
                    if data.tzinfo is None:
                        data = data.replace(tzinfo=timezone.utc)
                    break
        if titulo and link:
            itens.append({"titulo": titulo, "url": link, "data": data, "veiculo": limpar(campo.get("source"))})
    return itens


def tirar_veiculo_do_titulo(titulo, veiculo):
    """O Google Notícias anexa ' - Veículo' ao título; tira quando bate com a fonte informada."""
    if " - " not in titulo:
        return titulo
    cabeca, cauda = titulo.rsplit(" - ", 1)
    nc, nv = normalizar(cauda), normalizar(veiculo)
    if cabeca and nc and nv and (nc == nv or nv.startswith(nc) or nc.startswith(nv)):
        return cabeca.strip()
    return titulo


# ---------------------------------------------------------------- coleta

def inicio_do_recorte(cfg):
    """Início do recorte (config 'desde', AAAA-MM-DD, meia-noite de Brasília) em UTC."""
    return datetime.fromisoformat(cfg["desde"] + "T00:00:00-03:00").astimezone(timezone.utc)


def fontes_do_config(cfg, dias):
    for q in cfg["consultas_google"]:
        url = GOOGLE.format(q=urllib.parse.quote(f"{q} when:{dias}d"))
        yield {"nome": "Google Notícias", "tipo": "google", "rotulo": q, "urls": [url]}
    for f in cfg["feeds"]:
        urls = [f["url"]] + [f"{f['url']}{'&' if '?' in f['url'] else '?'}paged={n}" for n in range(2, f.get("paginas", 1) + 1)]
        yield {"nome": f["nome"], "tipo": "feed", "rotulo": f["url"], "urls": urls}


def compilar_temas(cfg):
    """Cada tema vale por termos soltos ou por combinações: título que traga algo de CADA grupo da combinação
    (ex.: um verbo de corte e um alvo de gasto), em qualquer ordem e com qualquer preposição no meio."""
    return {t: {"termos": compilar_lista(v.get("termos", [])),
                "comb": [[compilar_lista(g) for g in comb] for comb in v.get("combinacoes", [])]}
            for t, v in cfg["temas"].items()}


def temas_de(cfg, titulo, compilados):
    n = normalizar(titulo)
    return [t for t, c in compilados.items() if casa(c["termos"], n) or any(all(casa(g, n) for g in comb) for comb in c["comb"])]


def preparar(cfg):
    """Compila uma vez tudo o que o filtro usa."""
    return {"gate": compilar_lista(cfg["contexto_es"]), "local": compilar_lista(cfg["localizador"]), "excluir": compilar_lista(cfg["excluir"]),
            "setor": compilar_lista(cfg.get("setor_publico", [])), "temas": compilar_temas(cfg),
            "oficiais": {normalizar(v) for v in cfg.get("fontes_oficiais", [])}, "locais": {normalizar(v) for v in cfg.get("veiculos_capixabas", [])},
            "ambig": compilar_lista(cfg.get("siglas_ambiguas", [])), "ancoras": compilar_lista(cfg.get("ancoras_es", cfg["localizador"])), "veic_excl": compilar_lista(cfg.get("veiculos_excluidos", [])),
            "outro_uf": re.compile(r"(?<![A-Za-z])(?:" + "|".join(re.escape(u) for u in cfg.get("outros_estados", [])) + r")(?![A-Za-z])") if cfg.get("outros_estados") else None}


def decidir(cfg, titulo, veiculo, F, regional=False):
    """Classifica o título em 'confirmada', 'possivel' ou 'descartada', com o motivo.
    `regional` diz que a fonte já é capixaba (feed do ES ou busca restrita a site capixaba).
    Possível = cheira a assunto público capixaba mas não cita o Estado: fica guardada, fora do e-mail e dos números, para não
    perder em silêncio o que um filtro rígido deixaria passar."""
    n = normalizar(titulo)
    letras = [ch for ch in titulo if ch.isalpha()]
    if len(letras) > 30 and sum(ch.isupper() for ch in letras) / len(letras) > 0.8:
        return "descartada", "caixa_alta"  # aviso legal em caixa alta (licitações de conselhos, editais), não é notícia
    if casa(F["excluir"], n):
        return "descartada", "excluir"
    if casa(F["veic_excl"], normalizar(veiculo)):
        return "descartada", "veiculo_excluido"
    # sigla de outro estado (SP, DF...) sem nenhuma âncora do ES: as siglas de órgãos (Sefaz, Detran, Sesa) existem em todos os estados
    if F["outro_uf"] and F["outro_uf"].search(titulo) and not casa(F["ancoras"], n):
        return "descartada", "outro_estado"
    if normalizar(veiculo) in F["oficiais"]:
        return "confirmada", "fonte_oficial"
    if casa(F["gate"], n):
        return "confirmada", "contexto"
    capixaba = regional or normalizar(veiculo) in F["locais"]
    if casa(F["ambig"], n):  # sigla que existe em vários estados: precisa de fonte capixaba ou de âncora do ES
        return ("confirmada", "sigla_com_ancora") if capixaba or casa(F["ancoras"], n) else ("possivel", "sigla_sem_ancora")
    temas = temas_de(cfg, titulo, F["temas"])
    # "restricao" sozinho não basta com a mera menção ao ES (uma operadora que suspende serviço no ES não é notícia do governo)
    if casa(F["local"], n) and [t for t in temas if t != "restricao"]:
        return "confirmada", "tema_e_localizador"
    if (casa(F["local"], n) or capixaba) and (temas or casa(F["setor"], n)):
        return "possivel", "possivel"
    return "descartada", "sem_contexto_com_tema" if temas else "sem_contexto"


def coletar(cfg, dias, descartadas=None):
    """Lê as fontes e devolve (aceitas, relatório). As possíveis vão junto, com possivel=True.
    Se `descartadas` for uma lista, nela entram as recusadas e as possíveis, com o motivo."""
    limite = max(agora() - timedelta(days=dias), inicio_do_recorte(cfg))
    F = preparar(cfg)
    coletados, relatorio = [], []
    for fonte in fontes_do_config(cfg, dias):
        regional = fonte["tipo"] == "feed" or "site:" in fonte["rotulo"]  # feeds e buscas restritas a sites: todos capixabas
        lidos = aceitos = possiveis = 0
        erro = ""
        for url in fonte["urls"]:
            try:
                itens = ler_feed(baixar(url))
            except (RuntimeError, ET.ParseError, ValueError) as e:
                erro = str(e)[:160]
                break
            for it in itens:
                lidos += 1
                veiculo = it["veiculo"] or fonte["nome"]
                titulo = tirar_veiculo_do_titulo(it["titulo"], veiculo) if fonte["tipo"] == "google" else it["titulo"]
                data = it["data"] or agora()
                if data < limite:
                    continue
                classe, motivo = decidir(cfg, titulo, veiculo, F, regional)
                if descartadas is not None and classe != "confirmada":
                    descartadas.append({"titulo": titulo, "veiculo": veiculo, "url": it["url"], "data": data, "motivo": motivo, "fonte": fonte["nome"], "consulta": fonte["rotulo"]})
                if classe == "descartada":
                    continue
                if classe == "possivel":
                    possiveis += 1
                else:
                    aceitos += 1
                coletados.append({"titulo": titulo, "veiculo": veiculo, "url": it["url"], "data": data, "possivel": classe == "possivel"})
        relatorio.append({"fonte": fonte["nome"], "consulta": fonte["rotulo"], "ok": not erro, "lidos": lidos, "aceitos": aceitos, "possiveis": possiveis, **({"erro": erro} if erro else {})})
    return coletados, relatorio


# ---------------------------------------------------------------- consolidação

def id_de(titulo):
    return hashlib.sha1(normalizar(titulo).encode()).hexdigest()[:12]


def eh_redirecionador(url):
    return urllib.parse.urlparse(url).netloc.endswith("news.google.com")


def consolidar(cfg, coletados, hoje):
    compilados = compilar_temas(cfg)
    existentes = {}
    if SAIDA.exists():
        try:
            for it in json.loads(SAIDA.read_text(encoding="utf-8")).get("itens", []):
                existentes[it["id"]] = it
        except (ValueError, KeyError):
            pass
    por_id = dict(existentes)
    novos = 0
    for c in coletados:
        i = id_de(c["titulo"])
        atual = por_id.get(i)
        reg = {"veiculo": c["veiculo"], "url": c["url"]}
        if atual is None:
            por_id[i] = {"id": i, "titulo": c["titulo"], "veiculo": c["veiculo"], "url": c["url"], "data": iso(c["data"]), "coletado_em": iso(hoje), "outras": [],
                         "possivel": bool(c.get("possivel"))}
            if not c.get("possivel"):
                novos += 1  # "novos" conta só as confirmadas
            continue
        if atual.get("possivel") and not c.get("possivel"):
            atual["possivel"] = False  # a mesma matéria apareceu confirmada em outra busca: sobe de categoria
            atual["coletado_em"] = iso(hoje)
            novos += 1
        # mesmo título em outro veículo ou link: prefere o link direto ao do Google e guarda os demais
        if eh_redirecionador(atual["url"]) and not eh_redirecionador(c["url"]):
            reg, atual["veiculo"], atual["url"] = {"veiculo": atual["veiculo"], "url": atual["url"]}, c["veiculo"], c["url"]
        if reg["url"] != atual["url"] and all(o["url"] != reg["url"] for o in atual["outras"]) and len(atual["outras"]) < MAX_OUTRAS \
                and normalizar(reg["veiculo"]) != normalizar(atual["veiculo"]):
            atual["outras"].append(reg)
    corte = inicio_do_recorte(cfg)
    ruido = compilar_lista(cfg["ruido_sem_tema"]["termos"])
    salvo = set(cfg["ruido_sem_tema"]["salvo_temas"])
    itens = []
    for it in por_id.values():
        if datetime.fromisoformat(it["data"].replace("Z", "+00:00")) < corte:
            continue
        it["temas"] = temas_de(cfg, it["titulo"], compilados)  # recalcula: mudar o config vale para o que já foi guardado
        if casa(ruido, normalizar(it["titulo"])) and not (set(it["temas"]) & salvo):
            continue  # notícia policial ou de acidente sem tema de atenção
        itens.append(it)
    itens.sort(key=lambda x: (x["data"], x["id"]), reverse=True)
    return itens, novos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, help="janela de coleta em dias (padrão: janela_dias do config)")
    ap.add_argument("--dry-run", action="store_true", help="só mostra o resumo")
    args = ap.parse_args()

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    dias = args.dias or cfg["janela_dias"]
    hoje = agora()
    descartadas = []
    coletados, relatorio = coletar(cfg, dias, descartadas)
    for r in relatorio:
        marca = "ok " if r["ok"] else "FALHA"
        print(f"{marca} {r['fonte']:<16} lidos={r['lidos']:<4} aceitos={r['aceitos']:<4} possiveis={r['possiveis']:<3} {r['consulta'][:60]}" + (f"  [{r['erro']}]" if not r["ok"] else ""))
    descartes = {}
    for d in descartadas:
        descartes[d["motivo"]] = descartes.get(d["motivo"], 0) + 1
    if not any(r["ok"] for r in relatorio):
        sys.exit("nenhuma fonte respondeu: o arquivo de saída não foi alterado")

    itens, novos = consolidar(cfg, coletados, hoje)
    saida = {
        "ref": hoje.strftime("%Y-%m-%d"),
        "gerado_em": iso(hoje),
        "janela_dias": dias,
        "desde": cfg["desde"],
        "temas": {t: v["rotulo"] for t, v in cfg["temas"].items()},
        "fontes": relatorio,
        "novos_na_coleta": novos,
        "descartes_na_coleta": descartes,
        "itens": itens,
    }
    confirmadas = sum(1 for i in itens if not i.get("possivel"))
    print(f"\n{confirmadas} notícias confirmadas e {len(itens) - confirmadas} possíveis guardadas, {novos} novas confirmadas nesta coleta. Descartes: {descartes}")
    if args.dry_run:
        return
    # Selo de que a coleta rodou, mesmo sem novidade: a tela mostra "Última verificação" (e o Action publica uma vez por hora)
    VERIFICACAO.parent.mkdir(parents=True, exist_ok=True)
    VERIFICACAO.write_text(json.dumps({"verificado_em": iso(hoje), "novas": novos}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if SAIDA.exists():
        try:
            antes = json.loads(SAIDA.read_text(encoding="utf-8"))
        except ValueError:
            antes = {}
        falhas = lambda d: sorted(f["consulta"] for f in d.get("fontes", []) if not f["ok"])
        if antes.get("itens") == itens and falhas(antes) == falhas(saida):
            print("sem novidades: o arquivo não foi alterado (o Action só publica quando algo muda)")
            return
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
