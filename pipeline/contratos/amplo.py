"""Funções puras da base ampla de contratos: cruzamento SIGA x PNCP, protocolo do e-Docs, gestão do contrato e corte de Pareto.

Sem rede e sem arquivos: recebem listas de dicionários e devolvem listas, para serem testadas à parte (testes/test_amplo.py).
"""
import datetime
import re

# Protocolo de processo do e-Docs: ano, hífen e 5 caracteres em base 30 (ex.: 2026-1QHD4).
PROTOCOLO = re.compile(r"^\d{4}-[0-9A-Z]{5}$")
URL_CONSULTA = "https://processoeletronico.es.gov.br/?protocolo="


def normaliza_processo(s):
    return re.sub(r"\s+", "", (s or "").strip().upper())


def protocolo_edocs(s):
    """O protocolo normalizado, se o texto tem o formato do e-Docs; senão None."""
    p = normaliza_processo(s)
    return p if PROTOCOLO.match(p) else None


def link_consulta(s):
    """Endereço da consulta pública de processos (abre a consulta já com o protocolo), ou None."""
    p = protocolo_edocs(s)
    return URL_CONSULTA + p if p else None


def casar(siga, pncp, tolerancia_dias=60):
    """Liga contratos do PNCP aos do SIGA.

    Cada item é um dicionário com 'cnpj' (só dígitos), 'processo' (texto) e 'data' (datetime.date ou None, a assinatura/celebração).
    Primeiro casa por CNPJ + processo (protocolo do e-Docs); o que sobra casa por CNPJ + data, dentro da tolerância.
    Em empate vale o par de datas mais próximas; cada contrato é usado uma só vez.
    Devolve (pares [(i_pncp, i_siga)], so_pncp [i_pncp], so_siga [i_siga])."""
    usados_siga, pares = set(), []
    por_cnpj = {}
    for j, s in enumerate(siga):
        por_cnpj.setdefault(s["cnpj"], []).append(j)

    def distancia(a, b):
        return abs((a - b).days) if a and b else 10 ** 6

    pendentes = []
    for i, p in enumerate(pncp):
        proc = normaliza_processo(p.get("processo"))
        cand = []
        if proc:
            cand = [j for j in por_cnpj.get(p["cnpj"], ()) if j not in usados_siga and normaliza_processo(siga[j].get("processo")) == proc]
        if cand:
            j = min(cand, key=lambda j: (distancia(p.get("data"), siga[j].get("data")), j))
            usados_siga.add(j)
            pares.append((i, j))
        else:
            pendentes.append(i)
    so_pncp = []
    for i in pendentes:
        p = pncp[i]
        cand = [j for j in por_cnpj.get(p["cnpj"], ()) if j not in usados_siga and distancia(p.get("data"), siga[j].get("data")) <= tolerancia_dias]
        if cand:
            j = min(cand, key=lambda j: (distancia(p.get("data"), siga[j].get("data")), j))
            usados_siga.add(j)
            pares.append((i, j))
        else:
            so_pncp.append(i)
    so_siga = [j for j in range(len(siga)) if j not in usados_siga]
    return sorted(pares), so_pncp, so_siga


def corte_pareto(valores, fracao=0.8):
    """Quantos dos maiores valores são necessários para somar a fração pedida do total (no mínimo 1; todos, se o total é zero)."""
    ordenados = sorted((v or 0.0 for v in valores), reverse=True)
    total = sum(ordenados)
    if not ordenados:
        return 0
    if total <= 0:
        return len(ordenados)
    acum = 0.0
    for n, v in enumerate(ordenados, 1):
        acum += v
        if acum >= fracao * total:
            return n
    return len(ordenados)


_FUNCOES = {"GESTOR": ("Gestor", 0), "GESTOR TITULAR": ("Gestor", 0), "SUPLENTE_GESTOR": ("Suplente de gestor", 1), "SUPLENTE GESTOR": ("Suplente de gestor", 1),
            "FISCAL": ("Fiscal", 2), "FISCAL TITULAR": ("Fiscal", 2), "SUPLENTE_FISCAL": ("Suplente de fiscal", 3), "SUPLENTE FISCAL": ("Suplente de fiscal", 3),
            "MEMBRO": ("Membro", 4)}


def _data_iso(s):
    try:
        return datetime.datetime.strptime((s or "")[:10], "%d/%m/%Y").date().isoformat()
    except ValueError:
        return ""


def resumir_gestao(linhas):
    """Gestor e fiscal de um contrato, a partir das linhas do arquivo de comissões do SIGA (campos Funcao, Nome, Setor, Situacao, DataInicio, DataFim).

    Devolve [função, nome, setor, início ISO, fim ISO, situação], com gestor antes de fiscal, e sem repetir a mesma pessoa na mesma função."""
    vistos, saida = set(), []
    for r in linhas:
        chave = re.sub(r"\s+", " ", (r.get("Funcao") or "").strip().upper())
        funcao, ordem = _FUNCOES.get(chave, ((r.get("Funcao") or "").strip().title(), 9))
        nome = re.sub(r"\s+", " ", (r.get("Nome") or "").strip())
        if not nome or (funcao, nome.upper()) in vistos:
            continue
        vistos.add((funcao, nome.upper()))
        saida.append((ordem, [funcao, nome, (r.get("Setor") or "").strip(), _data_iso(r.get("DataInicio")), _data_iso(r.get("DataFim")), (r.get("Situacao") or "").strip()]))
    return [x for _, x in sorted(saida, key=lambda t: (t[0], t[1][1]))]
