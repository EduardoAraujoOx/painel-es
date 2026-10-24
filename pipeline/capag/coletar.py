#!/usr/bin/env python3
"""Coleta no Siconfi (API de dados abertos do Tesouro Nacional) os demonstrativos do Espírito Santo que sustentam o
diagnóstico de sustentabilidade fiscal e o cálculo da CAPAG (Portaria MF 1.583/2023, alterada pela 1.764/2024).

Demonstrativos lidos, todos do Governo do Estado (id_ente 32), com todos os anexos que a API devolve:
  RREO  cada bimestre de cada ano (anexos 01 balanço orçamentário, 02 despesa por função, 03 receita corrente líquida,
        04 previdência, 06 resultado primário e nominal, entre outros);
  RGF   Poder Executivo, cada quadrimestre (anexos 01 pessoal, 02 dívida consolidada, 03 garantias, 05 disponibilidade
        de caixa e restos a pagar, 06 demonstrativo simplificado);
  DCA   cada exercício (anexos I-AB a I-HI: balanço orçamentário, financeiro e patrimonial).

Guarda cada consulta, sem alteração, em .cache/capag/<tipo>_<ano>_<periodo>.json (lista de linhas da API). Consulta
sem retorno fica registrada como arquivo vazio, para o montador saber que o período ainda não foi publicado.

Uso: python3 -I pipeline/capag/coletar.py [ano_inicial] [ano_final]     (padrão: 2018 e o ano corrente)
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "capag")
BASE = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt/"
ENTE = 32  # Espírito Santo (código IBGE da UF)
PAUSA = 0.4  # segundos entre pedidos, para não sobrecarregar a API


def consultar(endpoint, tentativas=4, **params):
    """Lê todas as páginas de um endpoint da API e devolve a lista de linhas."""
    linhas, offset = [], 0
    while True:
        q = dict(params, offset=offset)
        url = BASE + endpoint + "?" + urllib.parse.urlencode(q)
        for t in range(tentativas):
            try:
                with urllib.request.urlopen(url, timeout=90) as r:
                    pagina = json.load(r)
                break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                if t == tentativas - 1:
                    raise RuntimeError(f"falha em {url}: {e}")
                time.sleep(3 * (t + 1))
        linhas.extend(pagina.get("items", []))
        if not pagina.get("hasMore"):
            return linhas
        offset += len(pagina.get("items", [])) or 5000
        time.sleep(PAUSA)


def guardar(nome, linhas):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, nome + ".json"), "w", encoding="utf-8") as f:
        json.dump(linhas, f, ensure_ascii=False, separators=(",", ":"))
    return len(linhas)


def main():
    hoje = datetime.date.today()
    ini = int(sys.argv[1]) if len(sys.argv) > 1 else 2018
    fim = int(sys.argv[2]) if len(sys.argv) > 2 else hoje.year
    resumo = []
    for ano in range(ini, fim + 1):
        for bim in range(1, 7):
            nome = f"rreo_{ano}_{bim}"
            n = guardar(nome, consultar("rreo", an_exercicio=ano, nr_periodo=bim, co_tipo_demonstrativo="RREO", id_ente=ENTE))
            resumo.append((nome, n))
            time.sleep(PAUSA)
        for quad in range(1, 4):
            nome = f"rgf_{ano}_{quad}"
            n = guardar(nome, consultar("rgf", an_exercicio=ano, in_periodicidade="Q", nr_periodo=quad,
                                        co_tipo_demonstrativo="RGF", co_poder="E", id_ente=ENTE))
            resumo.append((nome, n))
            time.sleep(PAUSA)
        nome = f"dca_{ano}"
        n = guardar(nome, consultar("dca", an_exercicio=ano, id_ente=ENTE))
        resumo.append((nome, n))
        time.sleep(PAUSA)
        print(ano, "ok", flush=True)
    vazios = [n for n, q in resumo if q == 0]
    print(f"{len(resumo)} consultas, {len(resumo) - len(vazios)} com dados, {len(vazios)} sem dados")
    if vazios:
        print("sem dados:", ", ".join(vazios))


if __name__ == "__main__":
    main()
