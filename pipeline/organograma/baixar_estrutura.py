#!/usr/bin/env python3
"""Baixa a estrutura organizacional OFICIAL de cada órgão, da plataforma "Organograma ES"
(https://organograma.es.gov.br), o organograma oficial de serviços do Governo do ES.

É a mesma fonte que o site de cada secretaria incorpora na sua página de organograma (por
exemplo, planejamento.es.gov.br/organograma). Usa as duas rotas públicas que a própria página
chama no navegador, sem autenticação:
    /home/organizacoes/<id do Estado>     lista de órgãos do Estado
    /organograma/detalhes/<id do órgão>   árvore de unidades, com subordinação (unidadesFilhas)

Guarda um RETRATO datado por órgão em estrutura/oficial/<SIGLA>.json, só com o necessário
(nome, sigla, id e filhas), para que o montador não dependa de rede e para que se saiba de
quando é a estrutura. Pede um órgão por vez, com pausa entre os pedidos.

Uso: python3 pipeline/organograma/baixar_estrutura.py [SIGLA ...]
     (sem argumentos: todos os órgãos do módulo organograma)
"""
import datetime
import json
import os
import re
import subprocess
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
DESTINO = os.path.join(AQUI, "estrutura", "oficial")
BASE = "https://organograma.es.gov.br"
ESTADO = "fe88eb2a-a1f3-4cb1-a684-87317baf5a57"   # patriarca "ESTADO DO ESPIRITO SANTO"
PAUSA_S = 0.6


def pegar(caminho):
    proc = subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "90", "--retry", "3", "--retry-delay", "4",
                           "-H", "Accept: application/json", BASE + caminho],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{caminho}: {proc.stderr.strip()[:200]}")
    d = json.loads(proc.stdout)
    if not d.get("ok"):
        raise RuntimeError(f"{caminho}: {d.get('mensagem')}")
    return d["retorno"]


def enxugar(u):
    return {"nome": re.sub(r"\s+", " ", u.get("nome") or "").strip(), "sigla": (u.get("sigla") or "").strip(),
            "id": u.get("guid"), "filhas": [enxugar(f) for f in (u.get("unidadesFilhas") or [])]}


def chave(s):
    return re.sub(r"[^A-Z0-9]+", "", (s or "").upper())


def main():
    pedidos = [chave(s) for s in sys.argv[1:]]
    if not pedidos:
        idx = os.path.join(RAIZ, "data", "organograma", "index.json")
        pedidos = [chave(o["sigla"]) for o in json.load(open(idx))["orgs"]]
    orgs = {chave(o["sigla"]): o for o in pegar(f"/home/organizacoes/{ESTADO}")}
    os.makedirs(DESTINO, exist_ok=True)
    hoje = datetime.date.today().isoformat()
    ok, ausentes = [], []
    for c in pedidos:
        o = orgs.get(c)
        if o is None:
            ausentes.append(c)
            continue
        time.sleep(PAUSA_S)
        arvore = pegar(f"/organograma/detalhes/{o['guid']}")
        unidades = [enxugar(u) for u in arvore]
        total = sum(1 for _ in _percorrer(unidades))
        json.dump({"orgao": o["sigla"], "razaoSocial": o["razaoSocial"], "id": o["guid"], "capturadoEm": hoje,
                   "fonte": f"{BASE}/Organograma/{o['guid']}", "unidades": unidades},
                  open(os.path.join(DESTINO, re.sub(r"[^A-Za-z0-9_-]", "_", o["sigla"]) + ".json"), "w"),
                  ensure_ascii=False, separators=(",", ":"))
        ok.append((o["sigla"], total))
        print(f"{o['sigla']}: {total} unidades", flush=True)
    print(f"\n{len(ok)} órgãos baixados; sem correspondência na plataforma: {ausentes}")


def _percorrer(nos):
    for u in nos:
        yield u
        yield from _percorrer(u["filhas"])


if __name__ == "__main__":
    main()
