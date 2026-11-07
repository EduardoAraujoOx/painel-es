#!/usr/bin/env python3
"""Lê a execução da despesa (SIGEFES, Portal da Transparência do ES) de um ano SEM filtrar pelos CNPJs do SIGA.

`execucao.py` guarda só os pagamentos a CNPJs que aparecem em algum documento do SIGA, o que deixa de fora fornecedores que
nunca passaram pelo SIGA. Este script lê o mesmo arquivo anual (em fatias de bytes, em paralelo, sem gravá-lo em disco) e guarda
todos os pagamentos a CNPJ (CPF não é lido), agregados por CNPJ, unidade gestora, elemento de despesa, código de contrato do
SIGEFES, tipo de licitação e mês. Guarda também, em `nomes`, o subelemento e a subfunção de cada (UG, CNPJ, contrato do SIGEFES). O `montar.py` usa esse arquivo para completar o pago dos órgãos com os fornecedores fora do SIGA.

Resultado: .cache/contratos/despesas_<ano>.json
Uso: python3 -I pipeline/contratos/despesas.py 2025 2026      (cada ano leva de 5 a 10 minutos; arquivo de 1 a 1,5 GB)
Se o proxy ou a rede cortar conexões longas, use fatias menores: DESPESAS_FATIA_MB=12 (padrão).
"""
import csv
import hashlib
import json
import os
import subprocess
import sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import execucao as E  # noqa: E402  (reaproveita a descoberta do arquivo anual e a leitura do tamanho)

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
FATIA = int(os.environ.get("DESPESAS_FATIA_MB", "12")) * 1024 * 1024
SOBRA = 2 * 1024 * 1024
PARALELO = int(os.environ.get("DESPESAS_PARALELO", "12"))
NCOLUNAS = 71
# posições no arquivo Despesas-AAAA.csv
C_DATA, C_EMP, C_LIQ, C_PAGO, C_CNPJ, C_FAVORECIDO, C_LICITACAO = 1, 2, 3, 4, 6, 9, 11
C_UG, C_UG_NOME, C_ELEMENTO, C_ELEMENTO_NOME, C_CONTRATO = 21, 22, 25, 26, 69
C_SUBFUNCAO, C_SUBELEMENTO = 39, 47


def valor(b):
    try:
        return float(b.replace(b",", b"."))
    except ValueError:
        return 0.0


def linha_para_registro(linha):
    """Uma linha (bytes) do arquivo -> (chave, [empenhado, liquidado, pago], nomes) ou None se não for pagamento a CNPJ válido.

    chave = (CNPJ, UG, elemento, código de contrato do SIGEFES, tipo de licitação, 'AAAA-MM'); nomes traz favorecido, UG e elemento."""
    campos = linha.split(b";", 7)
    if len(campos) < 8:
        return None
    cnpj = campos[C_CNPJ]
    if len(cnpj) != 14 or not cnpj.isdigit():
        return None
    try:
        c = next(csv.reader([linha.decode("utf-8", "replace")], delimiter=";"))
    except csv.Error:
        return "ruim"
    if len(c) < NCOLUNAS:
        return "ruim"
    mes = f"{c[C_DATA][6:10]}-{c[C_DATA][3:5]}"
    chave = (c[C_CNPJ], c[C_UG], c[C_ELEMENTO], c[C_CONTRATO].strip(), c[C_LICITACAO], mes)
    vals = [valor(c[C_EMP].encode()), valor(c[C_LIQ].encode()), valor(c[C_PAGO].encode())]
    nomes = {c[C_CNPJ]: c[C_FAVORECIDO], "UG" + c[C_UG]: c[C_UG_NOME], "EL" + c[C_ELEMENTO]: c[C_ELEMENTO_NOME]}
    if c[C_CONTRATO].strip().strip("0"):
        # o que o SIGEFES diz do objeto do gasto (subelemento e subfunção) por unidade gestora, fornecedor e código de contrato do SIGEFES
        nomes[f"SB{c[C_UG]}|{c[C_CNPJ]}|{c[C_CONTRATO].strip()}"] = f"{c[C_SUBELEMENTO].strip()}|{c[C_SUBFUNCAO].strip()}"
    return chave, vals, nomes


def ler_fatia(args):
    url, ini, fim, tam = args
    agg, nomes, vistas, lidas, aceitas, ruins = {}, {}, set(), 0, 0, 0
    cmd = ["curl", "-sS", "-L", "--fail", "--retry", "4", "--retry-delay", "3", "-r", f"{max(0, ini - 1)}-{min(tam - 1, fim + SOBRA)}", url]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 20)
    pos, primeira = max(0, ini - 1), True
    for linha in p.stdout:
        inicio = pos
        pos += len(linha)
        if primeira:
            primeira = False
            if ini > 0 or inicio == 0:
                continue                          # sobra da linha anterior (ou o cabeçalho)
        if inicio >= fim:
            continue                              # além da fatia: lê até o fim do pedido só para conferir que o download terminou bem
        lidas += 1
        h = hashlib.md5(linha).digest()
        if h in vistas:
            continue                              # linha idêntica na mesma fatia conta uma vez (repetição por nova tentativa do curl)
        r = linha_para_registro(linha)
        if r is None:
            continue
        if r == "ruim":
            ruins += 1
            continue
        vistas.add(h)
        aceitas += 1
        chave, vals, nm = r
        a = agg.setdefault(chave, [0.0, 0.0, 0.0])
        for j in range(3):
            a[j] += vals[j]
        nomes.update(nm)
    p.stdout.close()
    if p.wait() != 0:
        return None
    return agg, nomes, lidas, aceitas, ruins


def fatia(args):
    for _ in range(4):
        r = ler_fatia(args)
        if r is not None:
            return r
    raise RuntimeError(f"fatia {args[1]}-{args[2]} falhou 4 vezes")


def ler_ano(ano):
    url = E.resolver_recursos()[ano]
    tam = E.tamanho(url)
    trabalhos = [(url, i, min(tam, i + FATIA), tam) for i in range(0, tam, FATIA)]
    agg, nomes, lidas, aceitas, ruins = {}, {}, 0, 0, 0
    with Pool(PARALELO) as pool:
        for ag, nm, l, a, r in pool.imap_unordered(fatia, trabalhos):
            lidas += l
            aceitas += a
            ruins += r
            nomes.update(nm)
            for k, v in ag.items():
                x = agg.setdefault(k, [0.0, 0.0, 0.0])
                for j in range(3):
                    x[j] += v[j]
    destino = os.path.join(CACHE, f"despesas_{ano}.json")
    os.makedirs(CACHE, exist_ok=True)
    with open(destino, "w") as f:
        json.dump({"ano": ano, "colunas": ["cnpj", "ug", "elemento", "contrato", "licitacao", "mes", "empenhado", "liquidado", "pago"],
                   "linhas": [list(k) + v for k, v in sorted(agg.items())], "nomes": nomes}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{ano}: {lidas} linhas lidas, {aceitas} pagamentos a CNPJ, {ruins} descartadas; {len(agg)} grupos → {destino}", flush=True)


def main():
    anos = sys.argv[1:]
    if not anos:
        sys.exit("uso: despesas.py AAAA [AAAA ...]")
    for ano in anos:
        ler_ano(ano)


if __name__ == "__main__":
    main()
