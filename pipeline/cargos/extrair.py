#!/usr/bin/env python3
"""Extrai cargos comissionados e funções gratificadas da folha mensal (dados abertos do ES).

Cada mês da folha pesa de 80 a 250 MB. O arquivo é lido em fluxo (nunca gravado em disco)
e só as linhas de interesse são mantidas. O resultado de cada mês fica em .cache/cargos/AAAA-MM.json.

Uso:
    python3 pipeline/cargos/extrair.py --meses 2024-10:2026-09 --jobs 6
    python3 pipeline/cargos/extrair.py --meses 2026-09 --arquivo /caminho/Remuneracoes-09_2026.csv
"""
import argparse
import collections
import csv
import io
import json
import multiprocessing
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regras  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "cargos")
CKAN = "https://dados.es.gov.br/api/3/action/package_show?id=portal-da-transparencia-pessoal"


def curl(*args):
    return subprocess.Popen(
        ["curl", "-sS", "-L", "--fail", "--retry", "4", "--retry-delay", "5", *args],
        stdout=subprocess.PIPE,
    )


def listar_recursos():
    """Mapa 'AAAA-MM' -> URL do CSV de remuneração, a partir da API CKAN."""
    caminho = os.path.join(CACHE, "recursos.json")
    if os.path.exists(caminho):
        return json.load(open(caminho))
    proc = curl(CKAN)
    dados = json.load(proc.stdout)["result"]["resources"]
    proc.wait()
    recursos = {}
    for r in sorted(dados, key=lambda x: x.get("last_modified") or ""):
        nome = r["name"]
        if nome.startswith("Remuneracoes-") and nome.endswith(".csv"):
            mm, aaaa = nome[len("Remuneracoes-"):-4].split("_")
            recursos[f"{aaaa}-{mm}"] = r["url"]  # o mais recente prevalece em caso de duplicata
        elif nome == "VinculosServidores.csv":
            recursos["vinculos"] = r["url"]
    os.makedirs(CACHE, exist_ok=True)
    json.dump(recursos, open(caminho, "w"))
    return recursos


def linhas_csv(origem):
    """Itera as linhas do CSV, vindo de URL (fluxo) ou de arquivo local."""
    if os.path.exists(origem):
        arq = open(origem, encoding="utf-8-sig", newline="")
        yield from csv.DictReader(arq, delimiter=";")
        return
    proc = curl(origem)
    texto = io.TextIOWrapper(proc.stdout, encoding="utf-8-sig", newline="")
    yield from csv.DictReader(texto, delimiter=";")
    if proc.wait() != 0:
        raise RuntimeError(f"falha no download de {origem}")


def extrair_mes(mes, origem):
    """Processa um mês e devolve (registros, diagnostico)."""
    mes_folha = f"{mes[5:7]}/{mes[:4]}"
    agregado = collections.OrderedDict()
    rubricas_vistas = collections.Counter()
    lidas = 0
    for r in linhas_csv(origem):
        lidas += 1
        tipo = r["TipoFuncao"]
        if tipo not in regras.TIPOS_ALVO or r["Situacao_Folha"] != "ATIVO":
            continue
        rub = r["Rubrica"]
        rubricas_vistas[rub] += 1
        # Só a competência corrente: ajustes retroativos de outros meses distorceriam o mês.
        if r["MesCompetencia"] != r["MesFolha"] or r["MesFolha"] != mes_folha:
            continue
        chave = (r["Orgao"], r["NumFunc"], r["NumVinc"], r["Funcao"], tipo)
        reg = agregado.get(chave)
        if reg is None:
            reg = agregado[chave] = {"nome": r["Nome"], "unidade": r["CentroCusto"],
                                     "cargo_ef": r["Cargo"], "rub": collections.defaultdict(float)}
        valor = regras.para_float(r["Valor"])
        reg["rub"][rub] += valor if r["VantagemDesconto"] == "V" else -valor

    # O cache guarda as rubricas (e não o valor já calculado): as regras de valor vivem em
    # regras.py e são aplicadas em montar.py, de modo que mudá-las não exige novo download.
    registros = []
    for (org, numfunc, numvinc, funcao, tipo), reg in agregado.items():
        rub = {k: round(v, 2) for k, v in reg["rub"].items() if round(v, 2) != 0}
        registros.append([org, numfunc, numvinc, reg["nome"], funcao, regras.TIPOS_ALVO[tipo],
                          reg["unidade"], reg["cargo_ef"], rub])
    diag = {"linhas_lidas": lidas, "registros": len(registros),
            "rubricas": dict(rubricas_vistas.most_common())}
    return registros, diag


def tarefa(args):
    mes, origem = args
    destino = os.path.join(CACHE, f"{mes}.json")
    if os.path.exists(destino):
        return mes, "já existia"
    registros, diag = extrair_mes(mes, origem)
    tmp = destino + ".tmp"
    json.dump({"mes": mes, "registros": registros, "diagnostico": diag},
              open(tmp, "w"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, destino)
    return mes, f"{len(registros)} registros ({diag['linhas_lidas']} linhas lidas)"


def expandir_meses(spec):
    if ":" not in spec:
        return [spec]
    ini, fim = spec.split(":")
    a, m = int(ini[:4]), int(ini[5:7])
    saida = []
    while f"{a:04d}-{m:02d}" <= fim:
        saida.append(f"{a:04d}-{m:02d}")
        m += 1
        if m == 13:
            a, m = a + 1, 1
    return saida


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--meses", required=True, help="AAAA-MM ou intervalo AAAA-MM:AAAA-MM")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--arquivo", help="CSV local (somente com um único mês)")
    a = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    meses = expandir_meses(a.meses)
    if a.arquivo:
        tarefas = [(meses[0], a.arquivo)]
    else:
        recursos = listar_recursos()
        faltando = [m for m in meses if m not in recursos]
        if faltando:
            sys.exit(f"meses sem arquivo publicado: {faltando}")
        tarefas = [(m, recursos[m]) for m in meses]

    with multiprocessing.Pool(a.jobs) as pool:
        for mes, msg in pool.imap_unordered(tarefa, tarefas):
            print(f"{mes}: {msg}", flush=True)


if __name__ == "__main__":
    main()
