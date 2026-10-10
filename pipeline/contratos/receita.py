#!/usr/bin/env python3
"""Cruza os fornecedores do Estado com o cadastro de CNPJ da Receita Federal (dados abertos).

Lê, em fluxo e sem gravar os arquivos brutos, os pacotes Empresas, Estabelecimentos e Sócios de um
espelho público da publicação mensal da Receita (mesmos arquivos de dadosabertos.rfb.gov.br), e guarda
em .cache/contratos/receita.json só o que diz respeito aos CNPJs que aparecem nos contratos e empenhos:

  * empresas:  razão social, natureza jurídica, capital social, porte;
  * estab:     situação cadastral, data de abertura, CNAE principal, endereço, município;
  * socios:    quadro societário (nome, CPF mascarado pela Receita, qualificação, entrada, faixa etária);
  * rede:      para cada sócio pessoa física, em quantas empresas do país (CNPJ básicos distintos) ele
               consta como sócio, para apontar quem controla várias empresas.

O CPF dos sócios já vem mascarado na fonte (***123456**) e é mantido assim.
Uso: python3 -I pipeline/contratos/receita.py [AAAA-MM-DD da publicação]
"""
import csv
import glob
import json
import os
import re
import subprocess
import sys
import zlib
from multiprocessing import Pool

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
ESPELHO = "https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos"
PUBLICACAO = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
FATIAS = range(10)


def so_digitos(s):
    return re.sub(r"\D", "", s or "")


def cnpjs_dos_contratos():
    achados = set()
    for f in glob.glob(os.path.join(CACHE, "[ce]20*.csv")):
        with open(f, encoding="utf-8-sig", newline="") as fh:
            cab = fh.readline().rstrip("\r\n").split(";")
            nome_col = next((n for n in ("CnpjFornecedor", "cnpjFornecedor") if n in cab), None)
            if nome_col is None:      # arquivo vazio (só o cabeçalho ou nada)
                continue
            col = cab.index(nome_col)
            for linha in csv.reader(fh, delimiter=";"):
                if len(linha) > col:
                    d = so_digitos(linha[col])
                    if len(d) == 14:
                        achados.add(d)
    return achados


def fluxo(nome):
    """Linhas (bytes) do único arquivo dentro do zip, lido em fluxo. Descompacta com zlib (e não com
    funzip) porque alguns arquivos passam de 4 GB descompactados."""
    url = f"{ESPELHO}/{PUBLICACAO}/{nome}.zip"
    curl = subprocess.Popen(["curl", "-sS", "-L", "--fail", "--retry", "3", "--retry-delay", "5", url],
                            stdout=subprocess.PIPE, bufsize=1 << 20)
    cab = curl.stdout.read(30)
    if cab[:4] != b"PK\x03\x04":
        raise RuntimeError(f"{nome}: resposta não é um zip")
    curl.stdout.read(int.from_bytes(cab[26:28], "little") + int.from_bytes(cab[28:30], "little"))
    d = zlib.decompressobj(-15)
    resto = b""
    while not d.eof:
        pedaco = curl.stdout.read(1 << 20)
        if not pedaco:
            break
        dados = resto + d.decompress(pedaco)
        *linhas, resto = dados.split(b"\n")
        for linha in linhas:
            yield linha
    if resto:
        yield resto
    curl.stdout.close()
    if not d.eof or curl.wait():
        raise RuntimeError(f"falha ao ler {nome}")


def campos(linha):
    """Campos de uma linha no formato "a";"b";"" (retira só a aspa inicial e a final, para não perder campo vazio no fim)."""
    linha = linha.rstrip(b"\r\n")
    linha = linha[1:] if linha[:1] == b'"' else linha
    linha = linha[:-1] if linha[-1:] == b'"' else linha
    return [c.decode("latin-1") for c in linha.split(b'";"')]


def passo_empresas(args):
    i, basicos = args
    saida = {}
    for linha in fluxo(f"Empresas{i}"):
        if linha[1:9].decode("ascii", "ignore") in basicos:
            c = campos(linha)
            saida[c[0]] = [c[1], c[2], c[4], c[5]]       # razão, natureza, capital social, porte
    return saida


def passo_estabelecimentos(args):
    i, basicos = args
    saida = {}
    for linha in fluxo(f"Estabelecimentos{i}"):
        if linha[1:9].decode("ascii", "ignore") in basicos:
            c = campos(linha)
            saida[c[0] + c[1] + c[2]] = [c[3], c[4], c[5], c[6], c[7], c[10], c[11], c[13], c[14], c[15], c[16],
                                         c[17], c[18], c[19], c[20], c[27]]
    return saida


def passo_socios(args):
    i, basicos = args
    saida = {}
    for linha in fluxo(f"Socios{i}"):
        if linha[1:9].decode("ascii", "ignore") in basicos:
            c = campos(linha)
            saida.setdefault(c[0], []).append([c[1], c[2], c[3], c[4], c[5], c[10], c[8]])
    return saida


def passo_rede(args):
    i, chaves = args
    vistos = {}
    for linha in fluxo(f"Socios{i}"):
        p = linha.rstrip(b"\r\n")[1:-1].split(b'";"')
        if len(p) > 3 and p[1] == b"2":
            k = (p[2], p[3])
            if k in chaves:
                vistos.setdefault(k, set()).add(p[0].decode("ascii", "ignore"))
    return vistos


def tabela(nome):
    saida = {}
    for linha in fluxo(nome):
        c = campos(linha)
        saida[c[0]] = c[1]
    return saida


def main():
    cnpjs = cnpjs_dos_contratos()
    basicos = {c[:8] for c in cnpjs}
    print(f"{len(cnpjs)} CNPJs ({len(basicos)} raízes) nos contratos e empenhos; publicação {PUBLICACAO}", flush=True)
    with Pool(6) as pool:
        empresas, estab, socios = {}, {}, {}
        for parte in pool.map(passo_empresas, [(i, basicos) for i in FATIAS]):
            empresas.update(parte)
        print(f"empresas: {len(empresas)}", flush=True)
        for parte in pool.map(passo_estabelecimentos, [(i, basicos) for i in FATIAS]):
            estab.update({k: v for k, v in parte.items() if k in cnpjs or v[0] == "1"})
        print(f"estabelecimentos: {len(estab)}", flush=True)
        for parte in pool.map(passo_socios, [(i, basicos) for i in FATIAS]):
            socios.update(parte)
        print(f"empresas com sócios: {len(socios)}", flush=True)
        chaves = {(s[1].encode("latin-1"), s[2].encode("latin-1")) for ss in socios.values() for s in ss if s[0] == "2"}
        redes = {}
        for parte in pool.map(passo_rede, [(i, chaves) for i in FATIAS]):
            for k, v in parte.items():
                redes.setdefault(k, set()).update(v)
        rede = {f"{k[0].decode('latin-1')}|{k[1].decode('latin-1')}": sorted(v) for k, v in redes.items()}
        print(f"sócios PF rastreados: {len(rede)}", flush=True)
    tabs = {n.lower(): tabela(n) for n in ("Cnaes", "Municipios", "Naturezas", "Qualificacoes", "Motivos")}
    destino = os.path.join(CACHE, "receita.json")
    json.dump({"publicacao": PUBLICACAO, "empresas": empresas, "estab": estab, "socios": socios, "rede": rede,
               "tabelas": tabs}, open(destino, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"gravado {destino} ({os.path.getsize(destino) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
