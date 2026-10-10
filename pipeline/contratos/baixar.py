#!/usr/bin/env python3
"""Baixa do Portal da Transparência do ES (dados abertos, sistema SIGA) os arquivos anuais de
Contratos, Alterações Contratuais e Empenhos, e os guarda em .cache/contratos/ (não vão ao Git).

Uso: python3 -I pipeline/contratos/baixar.py [ano_inicial]     (padrão: 2016)
"""
import json
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
PACOTE = "https://dados.es.gov.br/api/3/action/package_show?id=portal-da-transparencia-contratos"
PREFIXO = {"Contratos": "c", "AlteracoesContratuais": "a", "Empenhos": "e"}


def curl(url, destino=None):
    cmd = ["curl", "-sSL", "--fail", "-m", "300", "--retry", "3", "--retry-delay", "5"]
    cmd += ["-o", destino] if destino else []
    p = subprocess.run(cmd + [url], capture_output=True, text=not destino)
    if p.returncode:
        raise RuntimeError(f"{url}: {p.stderr.strip()[:200]}")
    return p.stdout


def main():
    inicial = int(sys.argv[1]) if len(sys.argv) > 1 else 2016
    os.makedirs(CACHE, exist_ok=True)
    recursos = json.loads(curl(PACOTE))["result"]["resources"]
    n = 0
    for r in recursos:
        m = re.match(r"(Contratos|AlteracoesContratuais|Empenhos)-(\d{4})\.csv$", r["name"])
        if not m or int(m.group(2)) < inicial:
            continue
        destino = os.path.join(CACHE, f"{PREFIXO[m.group(1)]}{m.group(2)}.csv")
        curl(r["url"], destino)
        n += 1
    print(f"{n} arquivos em {CACHE}")


if __name__ == "__main__":
    main()
