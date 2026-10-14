#!/usr/bin/env python3
"""Baixa a taxa Selic (Banco Central, série SGS 4189: Selic acumulada no mês anualizada, base 252) e guarda a média de cada ano em
pipeline/fundos/selic.json. Serve para estimar, em ordem de grandeza, o saldo aplicado de um fundo a partir do rendimento que ele arrecadou.

Uso: python3 -I pipeline/fundos/selic.py
"""
import collections
import json
import os
import subprocess

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4189/dados?formato=json&dataInicial=01/01/2024&dataFinal=31/12/2026"


def main():
    p = subprocess.run(["curl", "-sSL", "--fail", "-m", "60", URL], capture_output=True)
    if p.returncode:
        raise SystemExit("falha ao baixar a Selic: " + p.stderr.decode()[:200])
    por_ano = collections.defaultdict(list)
    for r in json.loads(p.stdout):
        por_ano[r["data"][6:]].append((r["data"], float(r["valor"])))
    saida = {"fonte": "Banco Central do Brasil, SGS 4189 (Selic acumulada no mês anualizada, base 252)", "url": URL,
             "media": {a: round(sum(v for _, v in l) / len(l), 2) for a, l in sorted(por_ano.items())},
             "meses": {a: len(l) for a, l in sorted(por_ano.items())}}
    with open(os.path.join(RAIZ, "pipeline", "fundos", "selic.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, indent=1)
    print(saida["media"], saida["meses"])


if __name__ == "__main__":
    main()
