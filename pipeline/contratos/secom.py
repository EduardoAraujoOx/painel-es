#!/usr/bin/env python3
"""Contratos de publicidade publicados no site da Secom (https://secom.es.gov.br/contratos-publicidade).

Os contratos das agências de propaganda (Concorrência nº 001/2019, Lei 12.232/2010) não estão no SIGA, no PNCP, no CidadES nem no Portal da
Transparência, mas a Secom publica no próprio site os contratos consolidados (texto, termos aditivos e extratos), um por lote. Este script lê a página,
baixa cada PDF, extrai com `pdftotext` o que interessa (número, lote, processo, licitação, agências e CNPJ, valor global anual estimado, início da
vigência, prorrogações e termos aditivos publicados) e grava data/contratacoes/publicidade_secom.json. O `montar.py` liga esses dados aos pagamentos do
SIGEFES pelo CNPJ-raiz da agência e pela licitação.

Limites: o PDF consolidado vai só até o último termo aditivo que a Secom publicou; o que veio depois não está no arquivo. O valor é o valor global anual
estimado (teto de referência), não o valor pago. Só leitura, sem login.

Uso: python3 -I pipeline/contratos/secom.py     (precisa de `pdftotext`, do pacote poppler-utils)
"""
import datetime
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos", "secom")
DESTINO = os.path.join(RAIZ, "data", "contratacoes", "publicidade_secom.json")
PAGINA = "https://secom.es.gov.br/contratos-publicidade"
EXECUCAO = "https://secom.es.gov.br/execucao-contratual-de-publicidade"
TITULO = re.compile(r"Contrato de Presta..o de Servi.os n.\s*(\d+)/(\d{4})\s*\(LOTE\s*(\d+)\)", re.I)


def listar_contratos(pagina_html, base=PAGINA):
    """[(título, url do PDF)] dos contratos consolidados da página (título 'Contrato de Prestação de Serviços nº 002/2021 (LOTE 01) - CONSOLIDADO')."""
    achados, vistos = [], set()
    for url, rotulo in re.findall(r'href="([^"]+\.pdf[^"]*)"[^>]*>\s*([^<]*)', pagina_html, re.I):
        rotulo = html.unescape(rotulo).strip()
        if TITULO.search(rotulo) and url not in vistos:
            vistos.add(url)
            achados.append((rotulo, urllib.parse.urljoin(base, html.unescape(url))))
    return achados


def limpar(texto):
    """Texto corrido do PDF: sem rodapés de página, carimbos de data e do e-Docs, com espaços normalizados."""
    texto = re.sub(r"P.GINA \d+ / \d+|\d\d/\d\d/\d{4} \d\d:\d\d|20\d\d-[A-Z0-9]{6} - E-DOCS - DOCUMENTO ORIGINAL", "", texto)
    return re.sub(r"\s+", " ", texto)


def so_digitos(s):
    return re.sub(r"\D", "", s or "")


def mais_meses(data_iso, meses):
    """Data ISO deslocada em meses inteiros (mesmo dia)."""
    d = datetime.date.fromisoformat(data_iso)
    m = d.month - 1 + meses
    return datetime.date(d.year + m // 12, m % 12 + 1, min(d.day, 28)).isoformat()


def ler_contrato(texto, titulo="", url=""):
    """Dados do contrato consolidado a partir do texto do PDF (já passado por `limpar`)."""
    t = TITULO.search(titulo) or TITULO.search(texto)
    numero, ano, lote = (t.group(1), t.group(2), t.group(3)) if t else ("", "", "")
    proc = re.search(r"Processo n.\s*([\d./-]+)", texto)
    lic = re.search(r"Concorr.ncia n.\s*(\d+/\d{4})", texto)
    partes = {}
    for nome, cnpj in re.findall(r"\((?:i{1,3}|iv|v)\)\s+([A-ZÀ-Ú0-9&.,' -]+?),\s+inscrita no CNPJ n.\s*([\d./-]+)", texto):
        if len(so_digitos(cnpj)) == 14:
            partes.setdefault(nome.strip(" ,"), set()).add(so_digitos(cnpj))
    valor = re.search(r"valor global anual estimado do Contrato . de R\$\s*([\d.]+,\d\d)", texto)
    inicio = re.search(r"in.cio em (\d{1,2}) de (\w+) de (\d{4}) e, a partir de ent.o, ter. dura..o de (\d+)", texto)
    meses = {"janeiro": 1, "fevereiro": 2, "marco": 3, "março": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12}
    ini_iso, duracao = None, 12
    if inicio and inicio.group(2).lower() in meses:
        ini_iso = datetime.date(int(inicio.group(3)), meses[inicio.group(2).lower()], int(inicio.group(1))).isoformat()
        duracao = int(inicio.group(4))
    prorrog = sorted({(int(d[2]), int(d[1]), int(d[0])) for d in re.findall(r"Prorrogar o prazo.{0,200}?a contar de (\d{2})/(\d{2})/(\d{4})", texto)})
    prorrog = [f"{a:04d}-{m:02d}-{d:02d}" for a, m, d in prorrog]
    aditivos = sorted({int(n) for n in re.findall(r"(\d+). Termo Aditivo ao Contrato n. \d+/\d{4}", texto)})
    limite = re.search(r"limitada a (\d+) \(\w+\) meses", texto)
    fim_publicado = mais_meses(ini_iso, duracao * (1 + len(prorrog))) if ini_iso else None
    if fim_publicado:
        fim_publicado = (datetime.date.fromisoformat(fim_publicado) - datetime.timedelta(days=1)).isoformat()
    limite_fim = None
    if ini_iso and limite:
        limite_fim = (datetime.date.fromisoformat(mais_meses(ini_iso, int(limite.group(1)))) - datetime.timedelta(days=1)).isoformat()
    return {"numero": f"{numero}/{ano}" if numero else "", "lote": lote, "processo": proc.group(1) if proc else "", "licitacao": lic.group(1) if lic else "",
            "partes": [{"nome": n, "cnpjs": sorted(c), "raizes": sorted({x[:8] for x in c})} for n, c in partes.items()],
            "valorAnual": float(valor.group(1).replace(".", "").replace(",", ".")) if valor else None,
            "inicio": ini_iso, "prorrogacoes": prorrog, "aditivos": aditivos, "vigenciaPublicadaAte": fim_publicado,
            "limiteLegalAte": limite_fim, "titulo": titulo, "url": url}


def baixar(url, destino):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    for _ in range(4):
        p = subprocess.run(["curl", "-sS", "-m", "120", "-L", "-A", "Mozilla/5.0", "-o", destino, "-w", "%{http_code}", url], capture_output=True, text=True)
        if p.returncode == 0 and p.stdout.strip() == "200" and os.path.getsize(destino) > 1000:
            return True
    return False


def main():
    os.makedirs(CACHE, exist_ok=True)
    pag = os.path.join(CACHE, "pagina.html")
    if not baixar(PAGINA, pag):
        sys.exit("não foi possível ler a página de contratos da Secom")
    lista = listar_contratos(open(pag, encoding="utf-8", errors="replace").read())
    contratos = []
    for titulo, url in lista:
        pdf = os.path.join(CACHE, re.sub(r"\W+", "_", titulo)[:60] + ".pdf")
        if not baixar(url, pdf):
            print(f"falha ao baixar {titulo}", file=sys.stderr)
            continue
        txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
        c = ler_contrato(limpar(txt), titulo, url)
        contratos.append(c)
        print(f"{c['numero']} lote {c['lote']}: {len(c['partes'])} agências, R$ {c['valorAnual'] or 0:,.0f} por ano, início {c['inicio']}, "
              f"prorrogações {c['prorrogacoes']}, vigência publicada até {c['vigenciaPublicadaAte']}", flush=True)
    if not contratos:
        sys.exit("nenhum contrato lido")
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "w", encoding="utf-8") as f:
        json.dump({"geradoEm": datetime.date.today().isoformat(), "fonte": PAGINA, "execucao": EXECUCAO, "contratos": contratos}, f, ensure_ascii=False, separators=(",", ":"))
    print("→", DESTINO)


if __name__ == "__main__":
    main()
