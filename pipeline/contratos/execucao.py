#!/usr/bin/env python3
"""Lê a execução da despesa (SIGEFES, Portal da Transparência do ES) e guarda, para os fornecedores dos
contratos, o que foi empenhado, liquidado e PAGO por empenho, órgão pagador e mês.

Os arquivos anuais de despesas têm de 0,5 a 1,5 GB. Em vez de baixá-los, o script lê cada um em fatias de
bytes, em paralelo, e guarda só as linhas cujo favorecido é um CNPJ presente nos contratos (CPF não é lido).
O vínculo com o contrato vem pelo número do empenho: o SIGA registra o empenho de cada contrato
(NumeroEmpenho, ex.: 2026NE00136) e o SIGEFES traz o mesmo número em DocumentoEmpenho.

Resultado: .cache/contratos/exec_<ano>.json.   Uso: python3 -I pipeline/contratos/execucao.py 2025 2026 ...
"""
import csv
import glob
import json
import os
import re
import subprocess
import sys
from multiprocessing import Pool

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
PACOTE = "https://dados.es.gov.br/api/3/action/package_show?id=portal-da-transparencia-despesas-execucao-orcamentaria-e-financeira"
FATIA = 48 * 1024 * 1024
SOBRA = 6 * 1024 * 1024       # leitura além do fim da fatia, para terminar a última linha
PARALELO = 14


def curl_texto(url, extra=()):
    p = subprocess.run(["curl", "-sSL", "--fail", "-m", "120", "--retry", "3", *extra, url], capture_output=True)
    if p.returncode:
        raise RuntimeError(f"{url}: {p.stderr.decode()[:200]}")
    return p.stdout


def cnpjs_dos_contratos():
    achados = set()
    for f in glob.glob(os.path.join(CACHE, "[ce]20*.csv")):
        with open(f, encoding="utf-8-sig", newline="") as fh:
            cab = fh.readline().rstrip("\r\n").split(";")
            nome = next((n for n in ("CnpjFornecedor", "cnpjFornecedor") if n in cab), None)
            if nome is None:
                continue
            col = cab.index(nome)
            for linha in csv.reader(fh, delimiter=";"):
                if len(linha) > col:
                    d = re.sub(r"\D", "", linha[col])
                    if len(d) == 14:
                        achados.add(d.encode())
    return achados


def valor(b):
    try:
        return float(b.replace(b",", b"."))
    except ValueError:
        return 0.0


def fatia(args):
    url, ini, fim, tam, indices, cnpjs = args
    ne, mes, lidas, aceitas, ruins = {}, {}, 0, 0, 0
    i_ne, i_ug, i_ugn, i_org, i_lic, i_elem = indices
    cmd = ["curl", "-sS", "-L", "--fail", "--retry", "4", "--retry-delay", "3", "-r",
           f"{max(0, ini - 1)}-{min(tam - 1, fim + SOBRA)}", url]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 20)
    pos = max(0, ini - 1)
    primeira = True
    for linha in p.stdout:
        inicio = pos
        pos += len(linha)
        if primeira:
            primeira = False
            if ini > 0 or inicio == 0:
                continue                      # sobra da linha anterior (ou o cabeçalho)
        if inicio >= fim:
            break
        lidas += 1
        campos = linha.split(b";", 7)
        if len(campos) < 8 or campos[6] not in cnpjs:
            continue
        try:
            c = next(csv.reader([linha.decode("utf-8", "replace")], delimiter=";"))
        except csv.Error:
            ruins += 1
            continue
        if len(c) < 71:
            ruins += 1
            continue
        aceitas += 1
        cnpj = c[6]
        ano, aaaamm = c[0], f"{c[1][6:10]}-{c[1][3:5]}"
        emp, liq, pago = valor(c[2].encode()), valor(c[3].encode()), valor(c[4].encode())
        k = (c[i_ne], cnpj)
        d = ne.setdefault(k, {"ug": c[i_ug], "org": c[i_org], "lic": c[i_lic], "el": c[i_elem], "a": {}})
        t = d["a"].setdefault(ano, [0.0, 0.0, 0.0])
        t[0] += emp; t[1] += liq; t[2] += pago
        m = mes.setdefault((cnpj, c[i_ug], aaaamm), [0.0, 0.0, 0.0])
        m[0] += emp; m[1] += liq; m[2] += pago
        mes.setdefault(("_ug", c[i_ug], c[i_ugn]), None)
    p.stdout.close()
    p.kill()
    p.wait()
    return ne, mes, lidas, aceitas, ruins


def cabecalho(url):
    topo = curl_texto(url, ("-r", "0-8191")).decode("utf-8-sig", "replace").split("\n")[0].rstrip("\r")
    return topo.split(";")


def resolver_recursos():
    r = json.loads(curl_texto(PACOTE))["result"]["resources"]
    return {re.match(r"Despesas-(\d{4})\.csv$", x["name"]).group(1): x["url"] for x in r if re.match(r"Despesas-(\d{4})\.csv$", x["name"])}


def tamanho(url):
    """Tamanho do arquivo, lido do Content-Range de um pedido de 1 byte (o endereço assinado do armazenamento não aceita HEAD)."""
    p = subprocess.run(["curl", "-sSL", "-m", "60", "-r", "0-0", "-D", "-", "-o", "/dev/null", url], capture_output=True, text=True)
    m = re.findall(r"content-range:\s*bytes\s+\d+-\d+/(\d+)", p.stdout, re.I)
    if not m:
        raise RuntimeError("não consegui obter o tamanho de " + url)
    return int(m[-1])


def main():
    anos = sys.argv[1:] or ["2025", "2026"]
    urls = resolver_recursos()
    cnpjs = cnpjs_dos_contratos()
    print(f"{len(cnpjs)} CNPJs a procurar", flush=True)
    with Pool(PARALELO) as pool:
        for ano in anos:
            url = urls[ano]
            cab = cabecalho(url)
            idx = tuple(cab.index(n) for n in ("DocumentoEmpenho", "CodigoUnidadeGestora", "UnidadeGestora", "CodigoOrgao", "TipoLicitacao", "ElementoDespesa"))
            tam = tamanho(url)
            trabalhos = [(url, ini, min(tam, ini + FATIA), tam, idx, cnpjs) for ini in range(0, tam, FATIA)]
            ne, mes, ugs, lidas, aceitas, ruins = {}, {}, {}, 0, 0, 0
            for parte_ne, parte_mes, l, a, r in pool.imap_unordered(fatia, trabalhos):
                lidas += l; aceitas += a; ruins += r
                for k, v in parte_ne.items():
                    d = ne.setdefault(k, {"ug": v["ug"], "org": v["org"], "lic": v["lic"], "el": v["el"], "a": {}})
                    for a_, t in v["a"].items():
                        x = d["a"].setdefault(a_, [0.0, 0.0, 0.0])
                        for j in range(3):
                            x[j] += t[j]
                for k, v in parte_mes.items():
                    if k[0] == "_ug":
                        ugs[k[1]] = k[2]
                        continue
                    x = mes.setdefault(k, [0.0, 0.0, 0.0])
                    for j in range(3):
                        x[j] += v[j]
            destino = os.path.join(CACHE, f"exec_{ano}.json")
            json.dump({"ano": ano, "ne": [[k[0], k[1], v["ug"], v["org"], v["lic"], v["el"], v["a"]] for k, v in ne.items()],
                       "mes": [[k[0], k[1], k[2], v] for k, v in mes.items()], "ugs": ugs}, open(destino, "w"), ensure_ascii=False, separators=(",", ":"))
            print(f"{ano}: {lidas} linhas lidas, {aceitas} de fornecedores dos contratos, {ruins} descartadas; {len(ne)} empenhos → {destino}", flush=True)


if __name__ == "__main__":
    main()
