#!/usr/bin/env python3
"""Lê as receitas (SIGEFES, Portal da Transparência do ES) das unidades gestoras de FUNDO.

Guarda em .cache/fundos/rec_<ano>.json o que cada fundo arrecadou (receita orçamentária própria, já líquida de deduções) e
a receita prevista, por mês, origem (impostos, patrimonial, transferências...), rubrica e fonte de recursos. A receita
orçamentária não inclui as transferências financeiras que o Tesouro faz ao fundo; um fundo que gasta muito mais do que
arrecada é, em geral, abastecido por essas transferências, e esse fato é um sinal que o painel exibe.

Mesma leitura em fatias de pipeline/fundos/execucao_fundos.py.   Uso: python3 -I pipeline/fundos/receita_fundos.py [anos...]
"""
import collections
import csv
import json
import os
import re
import subprocess
import sys
from multiprocessing import Pool

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(RAIZ, "pipeline", "contratos"))
import execucao as E  # noqa: E402

CACHE = os.path.join(RAIZ, ".cache", "fundos")
COLS = ("CodUnidadeGestora", "UnidadeGestora", "Mes", "CodOrigem", "Origem", "CodRubrica", "Rubrica", "CodigoFonte", "Fonte",
        "PrevistaLiquida", "ArrecadadaLiquida", "TipoArquivo")


def numero(s):
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def recursos():
    pacote = json.loads(E.curl_texto("https://dados.es.gov.br/api/3/action/package_show?id=portal-da-transparencia-receitas"))["result"]
    achados = {}
    for r in pacote["resources"]:
        m = re.fullmatch(r"receitas-?(\d{4})\.csv", r["name"], re.I)
        if m and int(m.group(1)) >= 2022:
            achados.setdefault(m.group(1), []).append((int(r.get("size") or 0), r["url"]))
    # há duas cópias de alguns anos (nomes Receitas-AAAA e receitasAAAA): usa a de maior tamanho
    return {a: max(v)[1] for a, v in achados.items()}


def ler_fatia(args):
    url, ini, fim, tam, idx = args
    agg = collections.defaultdict(lambda: [0.0, 0.0])      # (ug, mes, origem, rubrica, fonte) -> prevista, arrecadada
    nomes = {}
    vistas = set()
    cmd = ["curl", "-sS", "-L", "--fail", "--retry", "4", "--retry-delay", "3", "-r", f"{max(0, ini - 1)}-{min(tam - 1, fim + E.SOBRA)}", url]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 20)
    pos = max(0, ini - 1)
    primeira = True
    for linha in p.stdout:
        inicio = pos
        pos += len(linha)
        if primeira:
            primeira = False
            if ini > 0 or inicio == 0:
                continue
        if inicio >= fim:
            continue
        if b"FUNDO" not in linha[:200].upper():
            continue
        h = hash(linha)
        if h in vistas:
            continue
        vistas.add(h)
        try:
            c = next(csv.reader([linha.decode("utf-8", "replace")], delimiter=";"))
        except csv.Error:
            continue
        if len(c) <= max(idx.values()):
            continue
        ug_nome = c[idx["UnidadeGestora"]]
        if "FUNDO" not in ug_nome.upper():
            continue
        ug = c[idx["CodUnidadeGestora"]]
        k = (ug, c[idx["Mes"]], c[idx["CodOrigem"]], c[idx["CodRubrica"]], c[idx["CodigoFonte"]])
        a = agg[k]
        a[0] += numero(c[idx["PrevistaLiquida"]]); a[1] += numero(c[idx["ArrecadadaLiquida"]])
        nomes["ug:" + ug] = ug_nome.strip()[:90]
        nomes["or:" + k[2]] = c[idx["Origem"]][:70]
        nomes["ru:" + k[3]] = c[idx["Rubrica"]][:90]
        nomes["fo:" + k[4]] = c[idx["Fonte"]][:80]
    p.stdout.close()
    if p.wait() != 0:
        return None
    return dict(agg), nomes


def fatia(args):
    for _ in range(4):
        r = ler_fatia(args)
        if r is not None:
            return r
    raise RuntimeError(f"fatia {args[1]}-{args[2]} de {args[0][-40:]} falhou 4 vezes")


def ano(pool, ano_, url):
    cab = E.cabecalho(url)
    idx = {n: cab.index(n) for n in COLS}
    tam = E.tamanho(url)
    trabalhos = [(url, i, min(tam, i + E.FATIA), tam, idx) for i in range(0, tam, E.FATIA)]
    agg = collections.defaultdict(lambda: [0.0, 0.0])
    nomes = {}
    for a, n in pool.imap_unordered(fatia, trabalhos):
        for k, v in a.items():
            t = agg[k]; t[0] += v[0]; t[1] += v[1]
        nomes.update(n)
    saida = {"ano": int(ano_), "linhas": [list(k) + [round(v[0], 2), round(v[1], 2)] for k, v in sorted(agg.items())], "nomes": dict(sorted(nomes.items()))}
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, f"rec_{ano_}.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{ano_}: {len(agg)} grupos, {len({k[0] for k in agg})} fundos, arrecadado R$ {sum(v[1] for v in agg.values()) / 1e6:,.1f} mi", flush=True)


def main():
    anos = sys.argv[1:] or ["2024", "2025", "2026"]
    urls = recursos()
    with Pool(E.PARALELO) as pool:
        for a in anos:
            ano(pool, a, urls[a])


if __name__ == "__main__":
    main()
