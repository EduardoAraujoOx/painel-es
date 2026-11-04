#!/usr/bin/env python3
"""Consulta pública de processos do e-Docs para os contratos principais (opcional; não roda sozinho).

O número de processo do SIGA é, em ~80% dos contratos (93–98% na SEG e no ITIC), o protocolo do e-Docs (ex.: 2026-1QHD4).
A consulta pública do site https://processoeletronico.es.gov.br/ mostra, sem login, o assunto, o resumo, as unidades e o histórico de
tramitação do processo. Este script faz a mesma consulta, só leitura, para os contratos principais do painel e grava um resumo em
data/contratacoes/processos.json, que a tela do contrato mostra ao lado do protocolo.

Cuidados: o endereço usado (api.es.gov.br/sep/<protocolo>) é o do próprio site de consulta, não uma API documentada para terceiros.
Por isso o script consulta 1 protocolo por segundo, só os dos contratos principais (classe A), guarda em cache e nunca repete uma consulta
recente. A API oficial do e-Docs (api.e-docs.es.gov.br) exige credencial de um órgão e não é usada aqui. Não se lê nenhuma peça do processo.

Uso: python3 -I pipeline/contratos/edocs.py [--max N] [--dias D]     (depois de montar.py; padrão: até 400 consultas, reaproveitando as de até 60 dias)
"""
import datetime
import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import amplo  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DADOS = os.path.join(RAIZ, "data", "contratacoes")
DESTINO = os.path.join(DADOS, "processos.json")
URL = "https://api.es.gov.br/sep/"
PAUSA_S = 1.0
AGENTE = "painel-es/1.0 (consulta publica de protocolos de contratos; somente leitura)"


def reduzir(d):
    """Resumo de uma resposta da consulta: o que o painel mostra (sem peças nem documentos)."""
    ups = sorted((d.get("updates") or []), key=lambda u: u.get("date") or "", reverse=True)
    ult = ups[0] if ups else {}
    return {"assunto": (d.get("subject") or "").strip(), "resumo": " ".join((d.get("summary") or "").split()), "unidades": list(d.get("parts") or [])[:6],
            "situacao": (d.get("status") or "").strip(), "tramites": len(ups),
            "ultima": {"data": (ult.get("date") or "")[:10], "orgao": (ult.get("agency") or "").strip(), "area": (ult.get("area") or "").strip(), "status": (ult.get("status") or "").strip()} if ult else None}


def consultar(protocolo):
    """Resumo do processo, {'naoEncontrado': True} se a consulta não o conhece, ou None em caso de falha (tentar de novo depois)."""
    p = subprocess.run(["curl", "-sS", "-m", "40", "-A", AGENTE, "-w", "\n%{http_code}", URL + protocolo], capture_output=True, text=True)
    corpo, _, codigo = p.stdout.rpartition("\n")
    if p.returncode != 0:
        return None
    if codigo.strip() in ("404", "204"):
        return {"naoEncontrado": True}
    if codigo.strip() != "200":
        return None
    try:
        return reduzir(json.loads(corpo))
    except ValueError:
        return None


def protocolos_principais():
    """Protocolos (válidos) dos contratos principais (classe A) nos arquivos por órgão gerados pelo montar.py."""
    achados = {}
    for f in glob.glob(os.path.join(DADOS, "org", "*.json")):
        d = json.load(open(f))
        c = {n: i for i, n in enumerate(d["campos"])}
        for k in d["contratos"]:
            if k[c["classeA"]]:
                p = amplo.protocolo_edocs(k[c["proc"]])
                if p:
                    achados[p] = max(achados.get(p, 0), k[c["vfin"]] or 0)
    return [p for p, _ in sorted(achados.items(), key=lambda x: -x[1])]


def main():
    args = sys.argv[1:]
    limite = int(args[args.index("--max") + 1]) if "--max" in args else 400
    dias = int(args[args.index("--dias") + 1]) if "--dias" in args else 60
    try:
        cache = json.load(open(DESTINO))
    except (OSError, ValueError):
        cache = {}
    hoje = datetime.date.today()
    recentes = lambda p: p in cache and (hoje - datetime.date.fromisoformat(cache[p]["consultadoEm"])).days <= dias
    pendentes = [p for p in protocolos_principais() if not recentes(p)][:limite]
    print(f"{len(pendentes)} protocolos a consultar (1 por segundo); {len(cache)} já em cache", flush=True)
    for i, p in enumerate(pendentes, 1):
        r = consultar(p)
        if r is not None:
            cache[p] = dict(r, consultadoEm=hoje.isoformat())
        if i % 25 == 0:
            json.dump(cache, open(DESTINO, "w"), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        time.sleep(PAUSA_S)
    json.dump(cache, open(DESTINO, "w"), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"{len(cache)} processos em {DESTINO}")


if __name__ == "__main__":
    main()
