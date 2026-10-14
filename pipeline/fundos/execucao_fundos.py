#!/usr/bin/env python3
"""Lê a execução da despesa (SIGEFES, Portal da Transparência do ES) das unidades gestoras de FUNDO.

Para cada ano, guarda em .cache/fundos/exec_<ano>.json o que as unidades gestoras cujo nome contém "FUNDO" empenharam,
liquidaram e pagaram (ValorPago) e pagaram em restos a pagar (ValorRap), agrupado por mês, grupo de despesa, elemento,
fonte de recursos e modalidade de aplicação; por programa e ação; e por favorecido que não é pessoa física
(empresa ou órgão/entidade; CPF não é lido nem guardado).

A leitura segue o padrão de pipeline/contratos/execucao.py: fatias de bytes em paralelo, conferência do código de saída do
curl, repetição da fatia que falhar e descarte de linhas idênticas dentro da fatia (repetição por nova tentativa).

Uso: python3 -I pipeline/fundos/execucao_fundos.py [anos...]    (padrão: 2024 2025 2026)
"""
import collections
import csv
import json
import os
import subprocess
import sys
from multiprocessing import Pool

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(RAIZ, "pipeline", "contratos"))
import execucao as E  # noqa: E402

CACHE = os.path.join(RAIZ, ".cache", "fundos")
COLS = ("Data", "CodigoUnidadeGestora", "UnidadeGestora", "CodigoGrupoDespesa", "CodigoElementoDespesa", "ElementoDespesa",
        "CodigoFonte", "Fonte", "CodigoModalidade", "Modalidade", "CodigoPrograma", "Programa", "CodigoAcao", "Acao",
        "TipoFavorecido", "CpfCnpjNis", "Favorecido", "CodigoFuncao", "Funcao")


def ler_fatia(args):
    """Devolve None se o download falhar no meio (o chamador repete a fatia inteira)."""
    url, ini, fim, tam, idx = args
    principal = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0])   # (ug, mes, gnd, elem, fonte, modal) -> emp, liq, pago, rap, linhas
    programa = collections.defaultdict(lambda: [0.0, 0.0])                 # (ug, prog, acao) -> pago, rap
    favorecido = collections.defaultdict(lambda: [0.0, 0.0])               # (ug, tipo, doc, nome) -> pago, rap
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
        if b"FUNDO" not in linha.upper():
            continue
        h = hash(linha)
        if h in vistas:
            continue
        vistas.add(h)
        try:
            c = next(csv.reader([linha.decode("utf-8", "replace")], delimiter=";"))
        except csv.Error:
            continue
        if len(c) < 71:
            continue
        ug_nome = c[idx["UnidadeGestora"]]
        if "FUNDO" not in ug_nome.upper():
            continue
        ug = c[idx["CodigoUnidadeGestora"]]
        d = c[idx["Data"]]
        mes = d[6:10] + "-" + d[3:5]
        gnd, el, fonte, modal = c[idx["CodigoGrupoDespesa"]], c[idx["CodigoElementoDespesa"]], c[idx["CodigoFonte"]], c[idx["CodigoModalidade"]]
        emp, liq, pago, rap = E.valor(c[2].encode()), E.valor(c[3].encode()), E.valor(c[4].encode()), E.valor(c[5].encode())
        a = principal[(ug, mes, gnd, el, fonte, modal)]
        a[0] += emp; a[1] += liq; a[2] += pago; a[3] += rap; a[4] += 1
        pr = programa[(ug, c[idx["CodigoPrograma"]], c[idx["CodigoAcao"]])]
        pr[0] += pago; pr[1] += rap
        tf = c[idx["TipoFavorecido"]]
        if tf in ("2", "3"):
            f = favorecido[(ug, tf, c[idx["CpfCnpjNis"]], c[idx["Favorecido"]][:80])]
            f[0] += pago; f[1] += rap
        nomes["ug:" + ug] = ug_nome[:90]
        nomes["el:" + el] = c[idx["ElementoDespesa"]][:60]
        nomes["fo:" + fonte] = c[idx["Fonte"]][:80]
        nomes["mo:" + modal] = c[idx["Modalidade"]][:60]
        nomes["pg:" + c[idx["CodigoPrograma"]]] = c[idx["Programa"]][:80]
        nomes["ac:" + ug + ":" + c[idx["CodigoAcao"]]] = c[idx["Acao"]][:90]
        nomes["fn:" + c[idx["CodigoFuncao"]]] = c[idx["Funcao"]][:40]
    p.stdout.close()
    if p.wait() != 0:
        return None
    return dict(principal), dict(programa), dict(favorecido), nomes


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
    principal = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0])
    programa = collections.defaultdict(lambda: [0.0, 0.0])
    favorecido = collections.defaultdict(lambda: [0.0, 0.0])
    nomes = {}
    for pri, pro, fav, nom in pool.imap_unordered(fatia, trabalhos):
        for k, v in pri.items():
            t = principal[k]
            for j in range(5):
                t[j] += v[j]
        for k, v in pro.items():
            t = programa[k]; t[0] += v[0]; t[1] += v[1]
        for k, v in fav.items():
            t = favorecido[k]; t[0] += v[0]; t[1] += v[1]
        nomes.update(nom)
    saida = {
        "ano": int(ano_),
        "principal": [list(k) + [round(x, 2) for x in v[:4]] + [v[4]] for k, v in sorted(principal.items())],
        "programa": [list(k) + [round(x, 2) for x in v] for k, v in sorted(programa.items())],
        "favorecido": [list(k) + [round(x, 2) for x in v] for k, v in sorted(favorecido.items())],
        "nomes": dict(sorted(nomes.items())),
    }
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, f"exec_{ano_}.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, separators=(",", ":"))
    tot = sum(v[2] + v[3] for v in principal.values())
    print(f"{ano_}: {len(principal)} grupos, {len({k[0] for k in principal})} fundos, pago+RAP R$ {tot / 1e6:,.1f} mi", flush=True)


def main():
    anos = sys.argv[1:] or ["2024", "2025", "2026"]
    urls = E.resolver_recursos()
    with Pool(E.PARALELO) as pool:
        for a in anos:
            ano(pool, a, urls[a])


if __name__ == "__main__":
    main()
