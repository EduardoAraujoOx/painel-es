#!/usr/bin/env python3
"""Baixa do PNCP (Portal Nacional de Contratações Públicas, API de consulta pública) os contratos dos órgãos do Poder Executivo estadual.

Por que existe: o SIGA não esgota os contratos dos órgãos. Em 2025–2026 o ITIC tem 79 contratos no PNCP e 27 no SIGA, e em vários contratos
o valor do SIGA é uma fração do valor global do PNCP. O PNCP é publicado pelos próprios órgãos (Lei 14.133/2021) e é a fonte complementar.

Como funciona:
  1. a lista de órgãos parte de pncp_orgaos.json (CNPJs conhecidos) e é ampliada pela consulta de contratações por UF=ES dos últimos dias
     (esfera estadual), para pegar órgãos que passaram a publicar;
  2. para cada órgão, baixa os contratos do período em janelas de até 365 dias;
  3. grava só os campos usados (enxugar), em .cache/contratos/pncp_estado.json.

Uso: python3 -I pipeline/contratos/pncp.py [AAAA-MM-DD inicial] [AAAA-MM-DD final]   (padrão: 2025-01-01 até hoje)
Variáveis: PNCP_PARALELO (padrão 5), PNCP_DESCOBRIR_DIAS (padrão 60; 0 desliga a descoberta).
Sem credencial. A API responde com 204 (sem corpo) quando não há contratos.
"""
import concurrent.futures as cf
import datetime
import json
import os
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
SEMENTE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pncp_orgaos.json")
BASE = "https://pncp.gov.br/api/consulta/v1"
PARALELO = int(os.environ.get("PNCP_PARALELO", "5"))
DIAS_DESCOBRIR = int(os.environ.get("PNCP_DESCOBRIR_DIAS", "60"))


def get_json(url, tentativas=5):
    """Corpo JSON da resposta, {} se a API devolve vazio (204), None se falhou em todas as tentativas."""
    for t in range(tentativas):
        p = subprocess.run(["curl", "-sS", "-m", "90", url], capture_output=True, text=True)
        if p.returncode == 0:
            if not p.stdout.strip():
                return {}
            if p.stdout.lstrip().startswith("{"):
                try:
                    return json.loads(p.stdout)
                except ValueError:
                    pass
        time.sleep(3)
    return None


def janelas(ini, fim, dias=365):
    """Divide [ini, fim] em janelas consecutivas de até `dias` dias (a API limita o intervalo da consulta)."""
    saida, a = [], ini
    while a <= fim:
        b = min(a + datetime.timedelta(days=dias - 1), fim)
        saida.append((a, b))
        a = b + datetime.timedelta(days=1)
    return saida


def enxugar(c):
    """Reduz um contrato do PNCP aos campos que o painel usa."""
    nome = lambda x: (x or {}).get("nome") if isinstance(x, dict) else x
    o, u = c.get("orgaoEntidade") or {}, c.get("unidadeOrgao") or {}
    return {"controle": c.get("numeroControlePNCP"), "ano": c.get("anoContrato"), "sequencial": c.get("sequencialContrato"),
            "orgaoCnpj": o.get("cnpj"), "orgao": o.get("razaoSocial"), "poder": o.get("poderId"), "esfera": o.get("esferaId"), "unidade": u.get("nomeUnidade"),
            "cnpj": c.get("niFornecedor"), "fornecedor": c.get("nomeRazaoSocialFornecedor"), "processo": (c.get("processo") or "").strip(),
            "assinatura": (c.get("dataAssinatura") or "")[:10], "ini": (c.get("dataVigenciaInicio") or "")[:10], "fim": (c.get("dataVigenciaFim") or "")[:10],
            "valorInicial": c.get("valorInicial"), "valorGlobal": c.get("valorGlobal"), "objeto": " ".join((c.get("objetoContrato") or "").split()),
            "categoria": nome(c.get("categoriaProcesso")), "tipo": nome(c.get("tipoContrato")), "numeroContrato": c.get("numeroContratoEmpenho")}


def link(c):
    return f"https://pncp.gov.br/app/contratos/{c['orgaoCnpj']}/{c['ano']}/{c['sequencial']}"


def descobrir(fim):
    """CNPJs de órgãos estaduais que publicaram contratações nos últimos DIAS_DESCOBRIR dias (consulta por UF, todas as modalidades)."""
    if DIAS_DESCOBRIR <= 0:
        return {}
    ini = fim - datetime.timedelta(days=DIAS_DESCOBRIR)
    achados, tarefas = {}, []
    for m in range(1, 14):
        d = get_json(f"{BASE}/contratacoes/publicacao?dataInicial={ini:%Y%m%d}&dataFinal={fim:%Y%m%d}&codigoModalidadeContratacao={m}&uf=ES&pagina=1&tamanhoPagina=50")
        for pg in range(1, ((d or {}).get("totalPaginas") or 0) + 1):
            tarefas.append((m, pg))

    def pagina(a):
        m, pg = a
        d = get_json(f"{BASE}/contratacoes/publicacao?dataInicial={ini:%Y%m%d}&dataFinal={fim:%Y%m%d}&codigoModalidadeContratacao={m}&uf=ES&pagina={pg}&tamanhoPagina=50")
        return (d or {}).get("data", [])

    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for lista in ex.map(pagina, tarefas):
            for x in lista:
                o = x.get("orgaoEntidade") or {}
                if o.get("esferaId") == "E" and o.get("poderId") not in ("J", "L"):
                    achados[o["cnpj"]] = o.get("razaoSocial", "")
    return achados


def contratos_do_orgao(cnpj, ini, fim):
    saida = []
    for a, b in janelas(ini, fim):
        pg = 1
        while True:
            d = get_json(f"{BASE}/contratos?dataInicial={a:%Y%m%d}&dataFinal={b:%Y%m%d}&cnpjOrgao={cnpj}&pagina={pg}&tamanhoPagina=500")
            if d is None:
                print(f"AVISO: falha ao ler {cnpj} {a}..{b} página {pg}", file=sys.stderr)
                break
            saida += [enxugar(c) for c in d.get("data", [])]
            if pg >= (d.get("totalPaginas") or 0):
                break
            pg += 1
    return cnpj, saida


def main():
    hoje = datetime.date.today()
    ini = datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.date(2025, 1, 1)
    fim = datetime.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else hoje
    orgaos = dict(json.load(open(SEMENTE))["orgaos"])
    novos = {c: n for c, n in descobrir(fim).items() if c not in orgaos}
    orgaos.update(novos)
    print(f"{len(orgaos)} órgãos ({len(novos)} descobertos agora: {sorted(novos.values())[:5]}); contratos de {ini} a {fim}", flush=True)
    por_orgao, total = {}, 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for cnpj, lista in ex.map(lambda c: contratos_do_orgao(c, ini, fim), sorted(orgaos)):
            por_orgao[cnpj] = lista
            total += len(lista)
    os.makedirs(CACHE, exist_ok=True)
    destino = os.path.join(CACHE, "pncp_estado.json")
    with open(destino, "w") as f:
        json.dump({"geradoEm": hoje.isoformat(), "inicio": ini.isoformat(), "fim": fim.isoformat(), "orgaos": orgaos, "contratos": por_orgao}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{total} contratos de {len(por_orgao)} órgãos → {destino}")


if __name__ == "__main__":
    main()
