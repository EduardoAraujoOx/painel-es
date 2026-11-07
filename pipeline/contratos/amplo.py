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


# --- atos do Diário Oficial (diario.py) ligados aos contratos ---------------------------------------------------------------------------------
NUMERO_CONTRATO = re.compile(r"\b(20\d{2}\.\d{6}\.\d{4,6}\.\d{2})\b")
NUMERO_ANTIGO = re.compile(r"(\d{1,10})\s*/\s*(\d{4})")


def numero_estruturado(doc):
    """Número no formato AAAA.NNNNNN.UG.SS dentro do texto do documento do SIGA (ex.: 'Contrato 2024.000050.10109.01/2024'), ou None."""
    m = NUMERO_CONTRATO.search(doc or "")
    return m.group(1) if m else None


def numero_antigo(doc):
    """Numeração antiga 'N/AAAA' (ex.: 'Contrato 023/2022' -> '23/2022'), ou None."""
    m = NUMERO_ANTIGO.search(doc or "")
    return f"{int(m.group(1))}/{m.group(2)}" if m else None


def indexar_atos(atos):
    """Índices dos atos do Diário por número de contrato e por CNPJ."""
    por_n, por_c = {}, {}
    for a in atos:
        if a.get("n"):
            por_n.setdefault(a["n"], []).append(a)
        if a.get("c"):
            por_c.setdefault(a["c"], []).append(a)
    return por_n, por_c


def atos_do_contrato(doc, cnpj, proc, por_n, por_c, maximo=12):
    """Atos do Diário que dizem respeito ao contrato.

    Liga pelo número estruturado do contrato (único: traz o ano, a unidade gestora e a sequência). Só quando o contrato não tem esse número,
    liga pelo CNPJ do fornecedor quando o trecho cita também o mesmo protocolo de processo ou a mesma numeração antiga N/AAAA; com número
    estruturado essa via não vale, porque um mesmo fornecedor e um mesmo processo de origem alcançam contratos de órgãos diferentes. Devolve [[data, tipo, protocolo, página, edição, trecho]] por data,
    sem repetir o mesmo ato (data, tipo e protocolo) e ficando com os `maximo` mais recentes."""
    achados = []
    n = numero_estruturado(doc)
    if n:
        achados += por_n.get(n, [])
    antigo, p = numero_antigo(doc), normaliza_processo(proc)
    for a in ([] if n else por_c.get(cnpj, [])):
        if (p and p in a.get("np", ())) or (antigo and antigo in a.get("nc", ())):
            achados.append(a)
    vistos, saida = set(), []
    for a in sorted(achados, key=lambda a: (a["d"], a["p"], -len(a["x"]))):
        chave = (a["d"], a["t"], a["p"])
        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append([a["d"], a["t"], a["p"], a["pg"], a["e"], a["x"][:520]])
    return saida[-maximo:]


def rescisao_publicada(atos, celebracao_iso=""):
    """Data (ISO) da rescisão mais recente publicada no Diário depois da celebração do contrato, ou ''."""
    datas = [a[0] for a in atos if a[1] == "Rescisão" and a[0] >= (celebracao_iso or "")]
    return max(datas) if datas else ""


# --- contato cadastral do fornecedor (Receita Federal) ------------------------------------------------------------------------------------------
def telefone(ddd, numero):
    """'(27) 3331-3100' a partir do DDD e do número da Receita; '' se não houver número utilizável."""
    ddd, numero = re.sub(r"\D", "", ddd or ""), re.sub(r"\D", "", numero or "")
    if len(numero) not in (8, 9) or len(ddd) not in (2, 3):
        return ""
    return f"({ddd}) {numero[:-4]}-{numero[-4:]}"


def contato_cadastral(natureza, email, ddd1="", tel1="", ddd2="", tel2=""):
    """E-mail e telefones do cadastro do CNPJ, ou None se a empresa é individual (empresário individual, inclusive MEI, e EIRELI), cujo contato
    costuma ser pessoal, ou se o cadastro não traz nenhum dos dois."""
    if "individual" in (natureza or "").lower():
        return None
    email = (email or "").strip().lower()
    telefones = []
    for t in (telefone(ddd1, tel1), telefone(ddd2, tel2)):
        if t and t not in telefones:
            telefones.append(t)
    if "@" not in email:
        email = ""
    return {"email": email, "telefones": telefones} if email or telefones else None


# --- contratos que só aparecem no SIGEFES (pagamento com código de contrato, sem nenhum documento do SIGA no órgão) --------------------------------
def contratos_do_sigefes(linhas, nomes, ug_org, pares_sem_doc, anos, elementos):
    """Agrupa os pagamentos do SIGEFES que citam um código de contrato e cujo fornecedor não tem documento algum do SIGA no órgão pagador.

    linhas: [cnpj, ug, elemento, contrato, licitação, 'AAAA-MM', empenhado, liquidado, pago] (despesas.py); nomes: nomes de fornecedores e as
    descrições 'SB<ug>|<cnpj>|<contrato>' -> 'subelemento|subfunção'; ug_org: unidade gestora -> órgão do SIGA; pares_sem_doc: {(órgão, cnpj)};
    anos: anos de interesse (texto); elementos: elementos de despesa de contratação. Devolve {órgão: [contrato]} com os de maior pago primeiro.

    Serve para publicidade e outras contratações que o SIGA não registra: o SIGEFES conhece o contrato (código, tipo de licitação e o que se
    paga), o SIGA não."""
    grupos = {}
    for cnpj, ug, el, ct, lic, mes, _emp, _liq, pago in linhas:
        ct = (ct or "").strip()
        org = ug_org.get(ug)
        if org is None or el not in elementos or not ct.strip("0") or (org, cnpj) not in pares_sem_doc or mes[:4] not in anos:
            continue
        g = grupos.setdefault((org, cnpj, ct), {"cnpj": cnpj, "forn": nomes.get(cnpj, cnpj), "codigo": ct, "licitacao": lic or "", "ug": ug,
                                               "pago": {a: 0.0 for a in anos}, "desde": mes, "ate": mes})
        g["pago"][mes[:4]] += pago
        g["desde"], g["ate"] = min(g["desde"], mes), max(g["ate"], mes)
    saida = {}
    for (org, cnpj, ct), g in grupos.items():
        sub, _, fun = (nomes.get(f"SB{g['ug']}|{cnpj}|{ct}") or "").partition("|")
        total = sum(g["pago"].values())
        if total <= 0:
            continue
        g.update(objeto=sub.strip(), subfuncao=fun.strip(), total=round(total, 2))
        g["pago"] = {a: round(v, 2) for a, v in g["pago"].items()}
        saida.setdefault(org, []).append(g)
    for lista in saida.values():
        lista.sort(key=lambda g: -g["total"])
    return saida
