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


def coletar(cfg, dias):
    limite = max(agora() - timedelta(days=dias), inicio_do_recorte(cfg))
    gate = compilar_lista(cfg["contexto_es"])
    local = compilar_lista(cfg["localizador"])
    excluir = compilar_lista(cfg["excluir"])
    compilados = {t: compilar_lista(v["termos"]) for t, v in cfg["temas"].items()}
    coletados, relatorio = [], []
    for fonte in fontes_do_config(cfg, dias):
        lidos = aceitos = 0
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
                n = normalizar(titulo)
                letras = [ch for ch in titulo if ch.isalpha()]
                if len(letras) > 30 and sum(ch.isupper() for ch in letras) / len(letras) > 0.8:
                    continue  # aviso legal em caixa alta (licitações de conselhos, editais), não é notícia
                # entra se citar o governo do Estado (contexto_es) ou se tiver tema e um localizador (ES, capixaba...)
                if casa(excluir, n) or not (casa(gate, n) or (casa(local, n) and temas_de(cfg, titulo, compilados))):
                    continue
                aceitos += 1
                coletados.append({"titulo": titulo, "veiculo": veiculo, "url": it["url"], "data": data})
        relatorio.append({"fonte": fonte["nome"], "consulta": fonte["rotulo"], "ok": not erro, "lidos": lidos, "aceitos": aceitos, **({"erro": erro} if erro else {})})
    return coletados, relatorio


# ---------------------------------------------------------------- consolidação

def id_de(titulo):
    return hashlib.sha1(normalizar(titulo).encode()).hexdigest()[:12]


def eh_redirecionador(url):
    return urllib.parse.urlparse(url).netloc.endswith("news.google.com")


def temas_de(cfg, titulo, compilados):
    n = normalizar(titulo)
    return [t for t, padroes in compilados.items() if casa(padroes, n)]


def consolidar(cfg, coletados, hoje):
    compilados = {t: compilar_lista(v["termos"]) for t, v in cfg["temas"].items()}
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
            por_id[i] = {"id": i, "titulo": c["titulo"], "veiculo": c["veiculo"], "url": c["url"], "data": iso(c["data"]), "coletado_em": iso(hoje), "outras": []}
            novos += 1
            continue
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
    coletados, relatorio = coletar(cfg, dias)
    for r in relatorio:
        marca = "ok " if r["ok"] else "FALHA"
        print(f"{marca} {r['fonte']:<16} lidos={r['lidos']:<4} aceitos={r['aceitos']:<4} {r['consulta'][:70]}" + (f"  [{r['erro']}]" if not r["ok"] else ""))
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
        "itens": itens,
    }
    print(f"\n{len(itens)} notícias guardadas, {novos} novas nesta coleta.")
    if args.dry_run:
        return
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
