#!/usr/bin/env python3
"""Conferência do que o painel baixa do SIGA com a página Contratos do Portal da Transparência do ES.

A página https://transparencia.es.gov.br/Contratos ("Fonte de Dados: SIGA e CidadES") monta a tabela com um GET em
/Contratos/Contrato/ObterContratos, que devolve, por órgão, o valor original e o valor aditivado dos instrumentos celebrados no ano.
Este script faz a mesma consulta (só leitura, sem login), soma o arquivo do SIGA que o painel usa (c<ano>.csv, baixado por baixar.py)
por órgão e grava as diferenças em data/contratacoes/cobertura.json, que a tela mostra em "Fontes e método".

Por que existe: mostrar com número, e não por suposição, que o painel enxerga o mesmo conjunto de contratos que o Portal. Diferenças pequenas
são esperadas quando o SIGA recebe contratos entre o download e a consulta; diferenças grandes e persistentes são lacuna de cobertura.

Uso: python3 -I pipeline/contratos/portal.py [ano ...]   (padrão: o ano corrente e os dois anteriores; rode depois de baixar.py)
"""
import csv
import datetime
import glob
import json
import os
import re
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
DESTINO = os.path.join(RAIZ, "data", "contratacoes", "cobertura.json")
URL = "https://transparencia.es.gov.br/Contratos/Contrato/ObterContratos?"
TOLERANCIA = 1.0          # R$: diferença menor que isso é arredondamento


def numero(s):
    """'1.234,56' -> 1234.56; vazio -> 0."""
    try:
        return float((s or "0").replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def extrair_pagina(html):
    """(lista de órgãos [{IdOrgao, NomeOrgao, ValorTotalInicial, ValorTotalFinal}], total de páginas) de uma resposta do Portal."""
    m = re.search(r"var resultado = (\[.*?\]);\s*var grafico", html, re.S)
    lista = json.loads(m.group(1)) if m else []
    n = re.search(r"(\d+) de (\d+)\s*</", html)
    return lista, int(n.group(2)) if n else 1


def somar_siga(linhas):
    """Soma por órgão (IdOrgao) do arquivo de contratos do SIGA: {id: [nome, inicial, final, documentos]}."""
    por = {}
    for r in linhas:
        x = por.setdefault(str(r["IdOrgao"]), [r["NomeOrgao"], 0.0, 0.0, 0])
        x[1] += numero(r["ValorInicial"])
        x[2] += numero(r["ValorFinal"])
        x[3] += 1
    return por


def comparar(portal, siga, maximo=15):
    """Compara {id: [nome, original, aditivado]} do Portal com {id: [nome, inicial, final, docs]} do SIGA.

    Devolve {'orgaos': n do Portal, 'identicos': n, 'soPortal': [...], 'soSiga': [...], 'divergentes': [{id, nome, portal, siga, diferenca}] (maiores primeiro)}.
    Idêntico: valor original e aditivado iguais, com tolerância de arredondamento."""
    ident, diverg, so_portal, so_siga = 0, [], [], []
    for k, (nome, orig, adit) in portal.items():
        s = siga.get(k)
        if s is None:
            so_portal.append({"id": k, "nome": nome, "portal": round(orig, 2)})
        elif abs(s[1] - orig) <= TOLERANCIA and abs(s[2] - adit) <= TOLERANCIA:
            ident += 1
        else:
            diverg.append({"id": k, "nome": nome, "portal": round(orig, 2), "siga": round(s[1], 2), "diferenca": round(s[1] - orig, 2)})
    for k, s in siga.items():
        if k not in portal:
            so_siga.append({"id": k, "nome": s[0], "siga": round(s[1], 2)})
    diverg.sort(key=lambda d: -abs(d["diferenca"]))
    return {"orgaos": len(portal), "identicos": ident, "divergentes": diverg[:maximo], "nDivergentes": len(diverg),
            "soPortal": so_portal[:maximo], "soSiga": so_siga[:maximo]}


def consultar(ano):
    """Totais por órgão do Portal no ano: ({id: [nome, original, aditivado]}, (total original, total aditivado)) ou None se a consulta falhar."""
    portal, pg, total = {}, 1, None
    while True:
        q = (f"Filtro.TipoConsulta=1&Filtro.Orgao=&Filtro.Ano={ano}&Filtro.PorPeriodo=false&Filtro.PeriodoDoAno=1&Filtro.DataInicio=01%2F01%2F{ano}&Filtro.DataFim=31%2F12%2F{ano}"
             f"&Filtro.Mensal=1&Filtro.Bimestre=1&Filtro.Trimestre=1&Filtro.Quadrimestre=1&Filtro.Semestre=1&Filtro.Situacao=&Filtro.Texto=&Filtro.OrigemContrato=-1&busca=1&pagina={pg}")
        html = None
        for _ in range(4):
            p = subprocess.run(["curl", "-sS", "-m", "90", "-L", "-H", "X-Requested-With: XMLHttpRequest", "-H", "Referer: https://transparencia.es.gov.br/Contratos", URL + q],
                               capture_output=True, text=True)
            if p.returncode == 0 and "var resultado" in p.stdout:
                html = p.stdout
                break
            time.sleep(3)
        if html is None:
            return None
        lista, paginas = extrair_pagina(html)
        for x in lista:
            portal[str(x["IdOrgao"])] = [x["NomeOrgao"], x["ValorTotalInicial"], x["ValorTotalFinal"]]
        t = re.search(r"Total Geral</th>\s*<th class=\"text-right\">([\d.,]+)</th>\s*<th class=\"text-right\">([\d.,]+)</th>", html)
        if t:
            total = (numero(t.group(1)), numero(t.group(2)))
        if pg >= paginas:
            return portal, total
        pg += 1


def main():
    hoje = datetime.date.today()
    anos = sys.argv[1:] or [str(hoje.year - i) for i in range(3)]
    saida = {"geradoEm": hoje.isoformat(), "fonte": "Portal da Transparência do ES, página Contratos (SIGA e CidadES), consulta ObterContratos", "anos": {}}
    for ano in anos:
        arq = os.path.join(CACHE, f"c{ano}.csv")
        if not os.path.exists(arq):
            print(f"{ano}: sem {arq} (rode baixar.py antes)", file=sys.stderr)
            continue
        with open(arq, encoding="utf-8-sig", newline="") as f:
            siga = somar_siga(csv.DictReader(f, delimiter=";"))
        r = consultar(ano)
        if r is None:
            print(f"{ano}: a consulta ao Portal falhou", file=sys.stderr)
            continue
        portal, total = r
        res = comparar(portal, siga)
        res["portalTotal"] = {"original": total[0], "aditivado": total[1]} if total else None
        res["sigaTotal"] = {"inicial": round(sum(x[1] for x in siga.values()), 2), "final": round(sum(x[2] for x in siga.values()), 2), "documentos": sum(x[3] for x in siga.values())}
        saida["anos"][ano] = res
        print(f"{ano}: {res['identicos']} de {res['orgaos']} órgãos idênticos; {res['nDivergentes']} divergentes; só no Portal {len(res['soPortal'])}, só no SIGA {len(res['soSiga'])}", flush=True)
    if not saida["anos"]:
        sys.exit("nenhum ano conferido")
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "w") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print("→", DESTINO)


if __name__ == "__main__":
    main()
