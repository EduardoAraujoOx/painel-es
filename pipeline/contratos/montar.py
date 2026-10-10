#!/usr/bin/env python3
"""Monta os dados do módulo "contratacoes" a partir de .cache/contratos/ (baixar.py e receita.py).

Para cada órgão: contratos vigentes (e os vencidos que seguem recebendo empenhos), gasto empenhado por ano,
principais fornecedores e alertas. Para cada fornecedor: ficha da Receita (situação, abertura, atividade,
endereço), quadro societário e rede de sócios, e alertas de cruzamento.

Saídas em data/contratacoes/:  index.json, org/<ID>.json, forn/<DD>.json (fichas, 100 fatias).
Uso: python3 -I pipeline/contratos/montar.py [AAAA-MM-DD da data de referência; padrão: hoje]
"""
import collections
import csv
import datetime
import glob
import json
import math
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regras as R  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
DESTINO = os.path.join(RAIZ, "data", "contratacoes")
REF = datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.date.today()
ANOS_SERIE = list(range(2019, REF.year + 1))
ANOS_GASTO = (REF.year - 1, REF.year)          # janela de "gasto recente": ano anterior e ano corrente
ATIVIDADE_DESDE = 2023                          # fornecedores com algum documento a partir deste ano ganham ficha


# ----------------------------------------------------------------------------------------- leitura
def num(s):
    s = (s or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def data(s):
    try:
        return datetime.datetime.strptime((s or "")[:10], "%d/%m/%Y").date()
    except ValueError:
        return None


def iso(d):
    return d.isoformat() if d else ""


def digitos(s):
    return re.sub(r"\D", "", s or "")


def ler(padrao):
    for f in sorted(glob.glob(os.path.join(CACHE, padrao))):
        ano = re.search(r"(\d{4})\.csv$", f).group(1)
        with open(f, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh, delimiter=";"):
                r["_ano"] = int(ano)
                yield r


def titulo(s):
    pequenas = {"de", "da", "do", "das", "dos", "e", "em", "para", "a", "o"}
    palavras = (s or "").lower().split()
    return " ".join(w if (i and w in pequenas) else (w.upper() if w in {"ies", "es", "ltda", "epp", "me", "sa", "s/a"} else w.capitalize())
                    for i, w in enumerate(palavras))


# ------------------------------------------------------------------------------------ contratos
def carregar_contratos():
    por_chave = {}
    for r in ler("c20*.csv"):
        if not r.get("IdOrgao"):
            continue
        chave = (r["IdOrgao"], r["NumeroProcesso"], r["NumeroDocumento"])
        antigo = por_chave.get(chave)
        if antigo is None or int(r["Id"] or 0) >= int(antigo["Id"] or 0):    # repetição: vale o registro mais novo
            por_chave[chave] = r
    return por_chave


def alteracoes():
    por_doc = collections.defaultdict(list)
    for r in ler("a20*.csv"):
        por_doc[(r["NumeroProcesso"], r["NumeroDocumento"])].append(r)
    return por_doc


def chave_ne(numero, ano):
    """Número do empenho no formato do SIGEFES (AAAANEnnnnn). O SIGA grava ora o número completo, ora só a sequência."""
    n = (numero or "").strip()
    m = re.search(r"(\d{4})NE(\d+)", n)
    if m:
        return f"{m.group(1)}NE{int(m.group(2)):05d}"
    if n.isdigit():
        return f"{ano}NE{int(n):05d}"
    m = re.search(r"NE(\d+)", n)
    return f"{ano}NE{int(m.group(1)):05d}" if m else None


def empenhos():
    por_doc = collections.defaultdict(lambda: collections.defaultdict(float))
    nes = collections.defaultdict(set)
    for r in ler("e20*.csv"):
        ano = min(r["_ano"], REF.year)
        chave = (r["NumeroProcesso"], r["NumeroDocumento"])
        por_doc[chave][ano] += num(r["valorGlobal"])
        k = chave_ne(r["NumeroEmpenho"], r["_ano"])
        if k:
            nes[chave].add((k, digitos(r["cnpjFornecedor"])))
    return por_doc, nes


def carregar_execucao():
    """Pagamentos do SIGEFES (execucao.py): por empenho, e por fornecedor x órgão x ano."""
    ne, ne_ug, ug_org, ugs, anos = {}, {}, {}, {}, []
    mes_rows = []
    for f in sorted(glob.glob(os.path.join(CACHE, "exec_20??.json"))):
        d = json.load(open(f))
        anos.append(d["ano"])
        for chave, cnpj, ug, org, lic, el, a in d["ne"]:
            ug_org[ug] = org
            ne_ug[(chave, cnpj)] = ug
            x = ne.setdefault((chave, cnpj), {})
            for ano, t in a.items():
                y = x.setdefault(ano, [0.0, 0.0, 0.0])
                for j in range(3):
                    y[j] += t[j]
        mes_rows += d["mes"]
        ugs.update(d["ugs"])
    return {"ne": ne, "ne_ug": ne_ug, "ug_org": ug_org, "ugs": ugs, "mes": mes_rows, "anos": anos}


EXEC = {"ne": {}, "ne_ug": {}, "ug_org": {}, "ugs": {}, "mes": [], "anos": []}


def meses_entre(a, b):
    return max(0.0, (b - a).days / 30.4375) if a and b else 0.0


def montar_contratos():
    brutos, alts = carregar_contratos(), alteracoes()
    emps, nes = empenhos()
    recs = []
    for (org, proc, doc), r in brutos.items():
        cel, ini, fim = data(r["DataCelebracao"]), data(r["DataInicioVigencia"]), data(r["DataFimVigencia"])
        al = alts.get((proc, doc), [])
        fims = [d for d in (data(a["DataFimVigencia"]) for a in al) if d]
        fim_ef = max(fims + ([fim] if fim else [])) if (fims or fim) else None
        n_pror = sum(1 for a in al if re.search(r"prorroga|vigencia|renova", R.sem_acento(a["TipoAlteracao"]).lower()))
        cnpj = digitos(r["CnpjFornecedor"])
        emp = dict(emps.get((proc, doc), {}))
        recs.append({
            "org": int(org), "org_nome": r["NomeOrgao"].strip(), "proc": proc, "doc": doc,
            "tipo_doc": r["TipoDocumento"].strip(), "inst": R.tipo_instrumento(r["TipoDocumento"]),
            "modal": R.modalidade(r["ModalidadeProcesso"]),
            "cat": R.categoria(r["Objeto"], r["TipoAquisicao"]), "tipo_aq": r["TipoAquisicao"].strip(),
            "objeto": re.sub(r"\s+", " ", r["Objeto"]).strip(), "forn": r["Fornecedor"].strip(), "cnpj": cnpj,
            "vini": num(r["ValorInicial"]), "vfin": num(r["ValorFinal"]),
            "cel": cel, "ini": ini or cel, "fim": fim, "fim_ef": fim_ef, "sit": r["Situacao"].strip(),
            "fora_siga": (r.get("procRealizadoSiga") or "").strip().upper() == "N", "reg_preco": (r.get("eRegistroPreco") or "").upper() == "S",
            "n_alt": len(al), "n_pror": n_pror, "emp": emp, "emp_tot": sum(emp.values()), "nes": nes.get((proc, doc), set()),
        })
    return recs


def avaliar_contrato(c):
    """Calcula vigência, valores e alertas próprios do contrato."""
    c["vigente"] = False
    if c["inst"] == "contrato" and not R.encerrado(c["sit"]):
        if c["fim_ef"]:
            c["vigente"] = c["fim_ef"] >= REF
        elif c["cel"] and c["cel"] >= REF.replace(year=REF.year - 5):
            c["vigente"] = True
    meses = meses_entre(c["ini"], c["fim_ef"])
    c["meses"] = meses
    c["anual"] = c["vfin"] / max(meses, 12.0) * 12.0 if c["vfin"] else 0.0
    c["saldo"] = c["vfin"] - c["emp_tot"] if c["inst"] == "contrato" else None
    pagos = [EXEC["ne"][k] for k in c["nes"] if k in EXEC["ne"]]
    c["pago_ano"] = collections.defaultdict(float)
    for x in pagos:
        for ano, t in x.items():
            c["pago_ano"][int(ano)] += t[2]
    c["pago"] = sum(c["pago_ano"].values())
    c["pago_excl"] = sum(t[2] for k in c.get("nes_excl", ()) if k in EXEC["ne"] for t in EXEC["ne"][k].values())   # só empenhos que não servem a outro documento
    c["ligado"] = bool(pagos)
    c["ess"] = R.essencialidade(c["cat"], c["objeto"])
    meses_rest = max(0.0, (c["fim_ef"] - REF).days / 30.4375) if c["fim_ef"] else 0.0
    c["restante"] = min(c["vfin"], c["anual"] * meses_rest / 12.0) if c["vigente"] else 0.0   # quanto ainda deve receber até o fim da vigência (estimativa linear)
    al = []
    if c["inst"] == "contrato":
        if c["fim_ef"] and any(a > c["fim_ef"].year and a >= REF.year - 1 for a in c["emp"]):
            al.append(("vigencia_vencida", "a"))
        if c["vigente"] and not c["fim_ef"]:
            al.append(("sem_prazo", "m"))
        if c["vini"] > 0 and c["vfin"] > c["vini"]:
            f = (c["vfin"] - c["vini"]) / c["vini"]
            if f >= R.LIMITE_ADITIVO_ALTO:
                al.append(("aditivo_valor", "a"))
            elif f >= R.LIMITE_ADITIVO_MEDIO:
                al.append(("aditivo_valor", "m"))
        if c["n_pror"] >= R.PRORROGACOES_MUITAS:
            al.append(("prorrogacoes", "m"))
        if meses > R.DURACAO_LONGA_MESES:
            al.append(("duracao_longa", "m"))
        if c["vfin"] > 0 and c["emp_tot"] > 1.10 * c["vfin"] and c["emp_tot"] - c["vfin"] > 50_000:
            al.append(("empenho_acima", "m"))
        if c["vfin"] > 0 and c["pago_excl"] > 1.10 * c["vfin"] and c["pago_excl"] - c["vfin"] > 50_000:
            al.append(("pago_acima", "m"))
        if (c["vigente"] and c["vfin"] >= R.VALOR_RELEVANTE * 10 and c["ini"] and c["fim_ef"] and c["fim_ef"] > c["ini"] and (c["fim_ef"] - c["ini"]).days >= 365
                and c["pago"] >= 0.8 * c["vfin"] and (REF - c["ini"]).days / (c["fim_ef"] - c["ini"]).days < 0.5):
            al.append(("ritmo_acelerado", "m"))
    if c["modal"] in R.DIRETAS and c["inst"] == "contrato":
        if c["vfin"] >= R.DIRETA_VALOR_ALTO:
            al.append(("direta_valor", "a"))
        elif c["vfin"] >= R.DIRETA_VALOR_MEDIO:
            al.append(("direta_valor", "m"))
    if c["modal"] == "Não informada" and c["inst"] == "contrato" and c["vfin"] >= R.VALOR_RELEVANTE:
        al.append(("sem_modalidade", "i"))
    if c["fora_siga"] and c["inst"] == "contrato" and c["vfin"] >= R.VALOR_RELEVANTE:
        al.append(("fora_siga", "i"))
    c["alertas"] = al
    return c


# ----------------------------------------------------------------------------------- servidores
def nomes_de_servidores():
    nomes = collections.defaultdict(set)
    try:
        for p in json.load(open(os.path.join(RAIZ, ".cache", "organograma", "todos.json")))["pessoas"]:
            nomes[R.norm_nome(p[3])].add(p[0])
    except OSError:
        pass
    cargos = sorted(glob.glob(os.path.join(RAIZ, ".cache", "cargos", "20??-??.json")))
    if cargos:
        for p in json.load(open(cargos[-1]))["registros"]:
            nomes[R.norm_nome(p[3])].add(p[0])
    return nomes


# ----------------------------------------------------------------------------------- fornecedores
SIT_CADASTRAL = {"01": "Nula", "2": "Ativa", "02": "Ativa", "3": "Suspensa", "03": "Suspensa", "4": "Inapta", "04": "Inapta",
                 "8": "Baixada", "08": "Baixada"}
PORTE = {"00": "Não informado", "01": "Microempresa", "03": "Empresa de pequeno porte", "05": "Demais"}


def fmt_data_rfb(s):
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if s and len(s) == 8 and s != "00000000" else ""


def fichas_fornecedores(recs, receita):
    """Ficha por CNPJ com cadastro e sócios; devolve também índices para os alertas cruzados."""
    emp_rfb, est, soc, rede, tab = (receita["empresas"], receita["estab"], receita["socios"], receita["rede"], receita["tabelas"])
    nomes_srv = nomes_de_servidores()
    cnpjs = {c["cnpj"] for c in recs if len(c["cnpj"]) == 14}
    por_raiz = collections.defaultdict(list)
    for c in sorted(cnpjs):
        por_raiz[c[:8]].append(c)
    fichas = {}
    for cnpj in cnpjs:
        raiz = cnpj[:8]
        e = emp_rfb.get(raiz)
        s = est.get(cnpj)
        f = {"cnpj": cnpj, "cadastro": bool(e and s)}
        if e:
            f.update(razao=e[0], natureza=tab["naturezas"].get(e[1], e[1]), capital=float(e[2].replace(",", ".") or 0), porte=PORTE.get(e[3], e[3]), porte_cod=e[3])
        if s:
            logr = " ".join(x for x in (s[7], s[8], s[9], s[10]) if x).strip()
            f.update(fantasia=s[1], situacao=SIT_CADASTRAL.get(s[2], s[2]), situacao_cod=s[2], data_situacao=fmt_data_rfb(s[3]),
                     motivo=tab["motivos"].get(s[4], "") if s[4] not in ("", "00") else "", abertura=fmt_data_rfb(s[5]),
                     cnae=(s[6], tab["cnaes"].get(s[6], "")), endereco=logr, bairro=s[11], cep=s[12], uf=s[13],
                     municipio=tab["municipios"].get(s[14], s[14]), matriz=s[0] == "1")
        socios = []
        for ident, nome, cpf, qual, entrada, faixa, rep in soc.get(raiz, []):
            item = {"tipo": {"1": "PJ", "2": "PF", "3": "Exterior"}.get(ident, ident), "nome": nome, "doc": cpf,
                    "qual": tab["qualificacoes"].get(qual, qual), "entrada": fmt_data_rfb(entrada), "faixa": faixa}
            if ident == "2":
                outras = [b for b in rede.get(f"{nome}|{cpf}", []) if b != raiz]
                item["rede"] = len(outras) + 1
                item["outros"] = [x for b in outras for x in por_raiz.get(b, [])]
                item["servidor"] = sorted(nomes_srv.get(R.norm_nome(nome), ())) if len(nome.split()) >= 3 else []
            socios.append(item)
        f["socios"] = socios
        fichas[cnpj] = f
    return fichas


def endereco_chave(f):
    if not f.get("endereco") or not f.get("cep"):
        return None
    return re.sub(r"\W+", "", R.sem_acento(f["endereco"]).lower()) + f["cep"]


# ----------------------------------------------------------------------------------------- agregação
def main():
    receita = json.load(open(os.path.join(CACHE, "receita.json")))
    global EXEC
    EXEC = carregar_execucao()
    brutos_recs = montar_contratos()
    uso_ne = collections.Counter(k for c in brutos_recs for k in c["nes"])
    for c in brutos_recs:
        c["nes_excl"] = {k for k in c["nes"] if uso_ne[k] == 1}
    recs = [avaliar_contrato(c) for c in brutos_recs]
    print(f"execução: anos {EXEC['anos']}; {sum(1 for c in recs if c['ligado'])} contratos com empenho vinculado a pagamentos", flush=True)
    # unidade gestora do SIGEFES -> órgão do SIGA: pela maioria dos empenhos vinculados a contratos; na falta, pelo nome
    votos = collections.defaultdict(collections.Counter)
    for c in recs:
        for k in c["nes"]:
            if k in EXEC["ne_ug"]:
                votos[EXEC["ne_ug"][k]][c["org"]] += 1
    ug2siga = {ug: v.most_common(1)[0][0] for ug, v in votos.items()}
    nome2siga = {R.norm_nome(c["org_nome"]): c["org"] for c in recs}
    por_nome = 0
    for ug, nome in EXEC["ugs"].items():
        if ug not in ug2siga and R.norm_nome(nome) in nome2siga:
            ug2siga[ug] = nome2siga[R.norm_nome(nome)]
            por_nome += 1
    print(f"UGs mapeadas ao órgão do SIGA: {len(ug2siga)} (por votos de empenho: {len(votos)}; por nome: {por_nome}) de {len(EXEC['ugs'])}", flush=True)
    pago_of = collections.defaultdict(lambda: collections.defaultdict(float))      # (órgão SIGA, CNPJ) -> ano -> pago
    pago_f = collections.defaultdict(lambda: collections.defaultdict(float))       # CNPJ -> ano -> pago (todo o Estado)
    for cnpj, ug, aaaamm, (emp_, liq_, pago_) in EXEC["mes"]:
        ano_ = int(aaaamm[:4])
        pago_f[cnpj][ano_] += pago_
        org_siga = ug2siga.get(ug)
        if org_siga is not None:
            pago_of[(org_siga, cnpj)][ano_] += pago_
    for c in recs:
        po = pago_of.get((c["org"], c["cnpj"]), {})
        if (c["inst"] == "contrato" and c["vigente"] and c["vfin"] >= R.VALOR_RELEVANTE * 10 and c["ini"] and (REF - c["ini"]).days > 365
                and EXEC["anos"] and sum(po.values()) <= 0 and c["cel"] and c["cel"].year >= 2021):
            c["alertas"].append(("sem_pagamento", "i"))
    print(f"{len(recs)} documentos; {sum(c['vigente'] for c in recs)} contratos vigentes em {REF}", flush=True)
    fichas = fichas_fornecedores(recs, receita)

    # --- por fornecedor x órgão: contratado, empenhado, fracionamento
    fo = collections.defaultdict(lambda: {"cont": collections.Counter(), "emp": collections.Counter(), "n_av": 0, "dir": 0.0,
                                         "vig": 0, "anual": 0.0, "saldo": 0.0, "n_ct": 0, "dir_docs": collections.defaultdict(list),
                                         "nome": "", "desde": None, "ate": None, "restante": 0.0,
                                         "ess_w": collections.Counter(), "cat_w": collections.Counter()})
    org_nome, org_ano_cont, org_ano_emp = {}, collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    org_cat, org_modal = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    for c in recs:
        org_nome[c["org"]] = c["org_nome"]
        a = fo[(c["org"], c["cnpj"])]
        a["nome"] = a["nome"] or c["forn"]
        ano = c["cel"].year if c["cel"] else None
        if c["cel"] and (a["desde"] is None or c["cel"] < a["desde"]):
            a["desde"] = c["cel"]
        peso = (c["anual"] if c["vigente"] else 0.0) + sum(v for y, v in c["emp"].items() if y in ANOS_GASTO)
        a["ess_w"][c["ess"]] += peso
        a["cat_w"][c["cat"]] += peso
        if c["vigente"] and c["fim_ef"] and (a["ate"] is None or c["fim_ef"] > a["ate"]):
            a["ate"] = c["fim_ef"]
        a["restante"] += c["restante"]
        if ano:
            a["cont"][ano] += c["vfin"]
            org_ano_cont[c["org"]][ano] += c["vfin"]
        for y, v in c["emp"].items():
            a["emp"][y] += v
            org_ano_emp[c["org"]][y] += v
            if y in ANOS_GASTO:
                org_cat[c["org"]][c["cat"]] += v
                org_modal[c["org"]][c["modal"]] += v
        if c["inst"] == "contrato":
            a["n_ct"] += 1
            if c["vigente"]:
                a["vig"] += 1
                a["anual"] += c["anual"]
                a["saldo"] += max(c["saldo"] or 0.0, 0.0)
        else:
            a["n_av"] += 1
        if c["modal"] in R.DIRETAS and ano in ANOS_GASTO:
            a["dir"] += c["vfin"]
            if c["inst"] == "avulso" and 0 < c["vfin"] < R.LIMITE_DISPENSA:
                a["dir_docs"][ano].append(c["vfin"])
    frac = {}
    for k, a in fo.items():
        for ano, vs in a["dir_docs"].items():
            if len(vs) >= 3 and sum(vs) >= R.LIMITE_DISPENSA:
                frac[(k, ano)] = (len(vs), sum(vs))

    # --- alertas por fornecedor (cadastro, sócios)
    orgs_do_forn = collections.defaultdict(set)
    for c in recs:
        if c["cel"] and c["cel"].year >= ATIVIDADE_DESDE or any(y >= ATIVIDADE_DESDE for y in c["emp"]):
            orgs_do_forn[c["cnpj"]].add(c["org"])
    procs_do_forn = collections.defaultdict(set)
    for c in recs:
        procs_do_forn[c["cnpj"]].add((c["org"], c["proc"]))
    end_idx = collections.defaultdict(set)
    for cnpj, f in fichas.items():
        k = endereco_chave(f)
        if k:
            end_idx[k].add(cnpj)
    primeira = {}
    for c in recs:
        if c["cel"] and c["vfin"] >= R.VALOR_RELEVANTE:
            if c["cnpj"] not in primeira or c["cel"] < primeira[c["cnpj"]][0]:
                primeira[c["cnpj"]] = (c["cel"], c["org"])
    tot_forn = collections.defaultdict(lambda: {"anual": 0.0, "emp": 0.0})
    for c in recs:
        if c["vigente"]:
            tot_forn[c["cnpj"]]["anual"] += c["anual"]
        for y, v in c["emp"].items():
            if y in ANOS_GASTO:
                tot_forn[c["cnpj"]]["emp"] += v
    alertas_forn = {}
    for c in {c["cnpj"] for c in recs}:
        al = []
        f = fichas.get(c)
        valor_ref = max(tot_forn[c]["anual"], tot_forn[c]["emp"] / max(1, len(ANOS_GASTO)))
        if len(c) == 11:
            if valor_ref >= R.VALOR_RELEVANTE:
                al.append(("pessoa_fisica", "i", "Contratado por CPF; sem cadastro de CNPJ."))
        elif not f or not f["cadastro"]:
            al.append(("sem_cadastro", "i", "CNPJ ausente da base da Receita usada (pode ter sido baixado antes da publicação)."))
        else:
            if f["situacao_cod"] not in ("02", "2") and valor_ref > 0:
                al.append(("situacao_irregular", "a", f"Situação cadastral: {f['situacao']}" + (f" desde {f['data_situacao']}" if f["data_situacao"] else "") + (f" ({f['motivo']})" if f["motivo"] else "") + "."))
            if c in primeira and f["abertura"]:
                dias = (primeira[c][0] - datetime.date.fromisoformat(f["abertura"])).days
                if dias < R.EMPRESA_RECENTE_DIAS:
                    al.append(("empresa_recente", "m", f"Aberta em {f['abertura']}; primeiro contrato relevante em {iso(primeira[c][0])} ({max(dias, 0)} dias depois)."))
            if valor_ref >= 1_000_000 and f["capital"] < R.CAPITAL_BAIXO_FRACAO * valor_ref:
                al.append(("capital_baixo", "m", f"Capital social de R$ {f['capital']:,.0f} frente a R$ {valor_ref:,.0f} por ano com o Estado.".replace(",", ".")))
            teto = R.TETO_ME if f["porte_cod"] == "01" else R.TETO_EPP if f["porte_cod"] == "03" else None
            if teto and tot_forn[c]["anual"] > teto:
                al.append(("porte_acima_teto", "m", f"{f['porte']}: teto de receita anual de R$ {teto:,.0f}; contratos vigentes somam R$ {tot_forn[c]['anual']:,.0f} por ano.".replace(",", ".")))
            k = endereco_chave(f)
            if k and len(end_idx[k] - {c}) >= 1:
                outros = sorted(end_idx[k] - {c})
                al.append(("endereco_comum", "i", f"Mesmo endereço de {len(outros)} outro(s) fornecedor(es) do Estado."))
            for s in f["socios"]:
                if s["tipo"] != "PF":
                    continue
                if s["outros"]:
                    mesmo_proc = any(procs_do_forn[o] & procs_do_forn[c] for o in s["outros"])
                    mesmo_orgao = any(orgs_do_forn[o] & orgs_do_forn[c] for o in s["outros"])
                    nivel = "a" if mesmo_proc else "m" if mesmo_orgao else "i"
                    onde = ", com contratação no mesmo processo." if mesmo_proc else ", atendendo ao mesmo órgão." if mesmo_orgao else "."
                    al.append(("socio_em_comum", nivel, f"{s['nome']} também é sócio de {len(s['outros'])} outro(s) fornecedor(es) do Estado" + onde))
                if s["servidor"]:
                    al.append(("socio_servidor", "m", f"{s['nome']}: nome igual ao de servidor ativo ({', '.join(s['servidor'][:4])})."))
                if s["rede"] >= R.REDE_GRANDE:
                    al.append(("rede_grande", "i", f"{s['nome']} consta como sócio em {s['rede']} empresas."))
        alertas_forn[c] = al

    # --- arquivos
    if os.path.isdir(DESTINO):
        shutil.rmtree(DESTINO)
    os.makedirs(os.path.join(DESTINO, "org"))
    os.makedirs(os.path.join(DESTINO, "forn"))
    nivel_peso = {"a": 3, "m": 1, "i": 0}
    indice_orgs = []
    prioridades = []
    def unicos(alertas):
        """Um alerta por código, no maior nível em que apareceu (vários sócios geram o mesmo alerta)."""
        melhor = {}
        for x in alertas:
            if x[0] not in melhor or nivel_peso[x[1]] > nivel_peso[melhor[x[0]]]:
                melhor[x[0]] = x[1]
        return melhor

    pontos_forn = {k: sum(nivel_peso[n] for n in unicos(v).values()) for k, v in alertas_forn.items()}
    CAMPOS = ["doc", "proc", "forn", "cnpj", "objeto", "cat", "modal", "vini", "vfin", "cel", "ini", "fim", "fimef", "sit", "anual", "saldo", "empAnt", "empAtu", "npror", "rp", "ess", "restante", "pago", "pagoAnt", "pagoAtu", "alertas"]
    for org in sorted(org_nome):
        meus = [c for c in recs if c["org"] == org]
        alvo = [c for c in meus if c["vigente"] or any(a[0] == "vigencia_vencida" for a in c["alertas"])]
        alvo.sort(key=lambda c: -c["anual"])
        contratos = [[c["doc"], c["proc"], titulo(c["forn"]) if c["forn"].isupper() else c["forn"], c["cnpj"], c["objeto"][:300], c["cat"], c["modal"],
                      round(c["vini"], 2), round(c["vfin"], 2), iso(c["cel"]), iso(c["ini"]), iso(c["fim"]), iso(c["fim_ef"]), c["sit"],
                      round(c["anual"], 2), None if c["saldo"] is None else round(c["saldo"], 2),
                      round(c["emp"].get(ANOS_GASTO[0], 0.0), 2), round(c["emp"].get(ANOS_GASTO[1], 0.0), 2), c["n_pror"], int(c["reg_preco"]), c["ess"], round(c["restante"], 2),
                      round(c["pago"], 2), round(c["pago_ano"].get(int(ANOS_GASTO[0]), 0.0), 2), round(c["pago_ano"].get(int(ANOS_GASTO[1]), 0.0), 2),
                      [f"{a}:{n}" for a, n in c["alertas"]]] for c in alvo]
        for c in alvo:
            pc = sum(nivel_peso[n] for _, n in c["alertas"])
            pf = pontos_forn.get(c["cnpj"], 0)
            if c["vigente"] and pc + pf >= 3 and c["anual"] >= 1_000_000:
                codigos = [f"{a}:{n}" for a, n in c["alertas"]] + [f"{a}:{n}" for a, n in unicos(alertas_forn.get(c["cnpj"], [])).items() if n != "i"]
                prioridades.append({"org": org, "orgNome": titulo(org_nome[org]), "doc": c["doc"], "forn": titulo(c["forn"]) if c["forn"].isupper() else c["forn"],
                                    "cnpj": c["cnpj"], "cat": c["cat"], "objeto": c["objeto"][:160], "anual": round(c["anual"], 2),
                                    "saldo": round(max(c["saldo"] or 0.0, 0.0), 2), "pontos": pc + pf,
                                    "prioridade": round((pc + pf) * math.log10(c["anual"]), 2), "alertas": codigos})
        forns = []
        for (o, cnpj), a in fo.items():
            if o != org:
                continue
            emp_recente = sum(a["emp"].get(y, 0.0) for y in ANOS_GASTO)
            cont_recente = sum(a["cont"].get(y, 0.0) for y in ANOS_GASTO)
            po = pago_of.get((o, cnpj), {})
            pago_ant, pago_atu = po.get(int(ANOS_GASTO[0]), 0.0), po.get(int(ANOS_GASTO[1]), 0.0)
            if emp_recente <= 0 and a["vig"] == 0 and cont_recente <= 0 and pago_ant + pago_atu <= 0:
                continue
            fr = [(ano, n, s) for (k, ano), (n, s) in frac.items() if k == (o, cnpj)]
            al = [[x[0], x[1], x[2]] for x in alertas_forn.get(cnpj, [])]
            al += [["fracionamento", "m", f"{n} compras diretas abaixo de R$ {R.LIMITE_DISPENSA:,.0f} em {ano}, somando R$ {s:,.0f}.".replace(",", ".")] for ano, n, s in fr]
            if a["vig"] == 0 and pago_ant + pago_atu >= 1_000_000:
                al.append(["pago_sem_contrato", "m", f"Pagos R$ {pago_ant + pago_atu:,.0f} em {ANOS_GASTO[0]}–{ANOS_GASTO[1]} sem contrato vigente neste órgão.".replace(",", ".")])
            forns.append({"cnpj": cnpj, "nome": titulo(a["nome"]) if a["nome"].isupper() else a["nome"], "vig": a["vig"], "anual": round(a["anual"], 2),
                          "pagoAnt": round(pago_ant, 2), "pagoAtu": round(pago_atu, 2), "pagoTot": round(sum(po.values()), 2),
                          "natureza": fichas.get(cnpj, {}).get("natureza", ""),
                          "saldo": round(a["saldo"], 2), "empAnt": round(a["emp"].get(ANOS_GASTO[0], 0.0), 2), "empAtu": round(a["emp"].get(ANOS_GASTO[1], 0.0), 2),
                          "cont": round(cont_recente, 2), "direta": round(a["dir"], 2), "nAvulsos": a["n_av"],
                          "desde": iso(a["desde"]), "ate": iso(a["ate"]), "restante": round(a["restante"], 2),
                          "cat": a["cat_w"].most_common(1)[0][0] if a["cat_w"] else "", "ess": a["ess_w"].most_common(1)[0][0] if a["ess_w"] else "indefinido",
                          "alertas": [f"{a}:{n}" for a, n in unicos(al).items()], "risco": sum(nivel_peso[n] for n in unicos(al).values())})
        forns.sort(key=lambda x: -(x["pagoAnt"] + x["pagoAtu"] + x["empAnt"] + x["empAtu"] + x["anual"]))
        total_emp = sum(x["empAnt"] + x["empAtu"] for x in forns) or 1.0
        vigentes = [c for c in meus if c["vigente"]]
        cont_recente = sum(org_ano_cont[org].get(y, 0.0) for y in ANOS_GASTO)
        diretas_recente = sum(c["vfin"] for c in meus if c["modal"] in R.DIRETAS and c["cel"] and c["cel"].year in ANOS_GASTO)
        n_al_alto = sum(1 for c in alvo if any(n == "a" for _, n in c["alertas"]))
        n_al_medio = sum(1 for c in alvo if any(n == "m" for _, n in c["alertas"]))
        n_forn_sinal = sum(1 for x in forns if x["risco"] >= 3)
        pago_org_ant = sum(v.get(int(ANOS_GASTO[0]), 0.0) for (o_, _c), v in pago_of.items() if o_ == org)
        pago_org_atu = sum(v.get(int(ANOS_GASTO[1]), 0.0) for (o_, _c), v in pago_of.items() if o_ == org)
        resumo = {"id": org, "nome": titulo(org_nome[org]), "nomeSiga": org_nome[org],
                  "pagoAnt": round(pago_org_ant, 2), "pagoAtu": round(pago_org_atu, 2),
                  "vigentes": len(vigentes), "valorVigente": round(sum(c["vfin"] for c in vigentes), 2),
                  "anualVigente": round(sum(c["anual"] for c in vigentes), 2),
                  "saldoVigente": round(sum(max(c["saldo"] or 0.0, 0.0) for c in vigentes), 2),
                  "empAnt": round(org_ano_emp[org].get(ANOS_GASTO[0], 0.0), 2), "empAtu": round(org_ano_emp[org].get(ANOS_GASTO[1], 0.0), 2),
                  "contratadoRecente": round(cont_recente, 2), "diretaPct": round(diretas_recente / cont_recente, 4) if cont_recente else 0.0,
                  "fornecedores": len(forns), "maiorForn": round(forns[0]["empAnt"] + forns[0]["empAtu"], 2) / total_emp if forns and total_emp > 1 else 0.0,
                  "contratosAlta": n_al_alto, "contratosMedia": n_al_medio, "fornecedoresSinalizados": n_forn_sinal,
                  "arquivo": f"org/{org}"}
        resumo["maiorForn"] = round(resumo["maiorForn"], 4)
        anual_total = sum(x["anual"] for x in forns) or 1.0
        resumo["maiorFornAnual"] = round(max((x["anual"] for x in forns), default=0.0) / anual_total, 4)
        resumo["coberturaEmpenho"] = round((resumo["empAnt"] + resumo["empAtu"]) / max(1, len(ANOS_GASTO)) / resumo["anualVigente"], 4) if resumo["anualVigente"] else None
        if not (resumo["vigentes"] or resumo["empAnt"] or resumo["empAtu"] or resumo["contratadoRecente"] or resumo["pagoAnt"] or resumo["pagoAtu"]):
            continue
        indice_orgs.append(resumo)
        serie = {"anos": ANOS_SERIE, "contratado": [round(org_ano_cont[org].get(y, 0.0), 2) for y in ANOS_SERIE],
                 "empenhado": [round(org_ano_emp[org].get(y, 0.0), 2) for y in ANOS_SERIE]}
        json.dump({"org": resumo, "campos": CAMPOS, "contratos": contratos, "fornecedores": forns[:120],
                   "categorias": [[k, round(v, 2)] for k, v in org_cat[org].most_common()],
                   "modalidades": [[k, round(v, 2)] for k, v in org_modal[org].most_common()], "serie": serie},
                  open(os.path.join(DESTINO, "org", f"{org}.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    # fichas de fornecedores em 100 fatias
    ativos = {c["cnpj"] for c in recs if (c["cel"] and c["cel"].year >= ATIVIDADE_DESDE) or any(y >= ATIVIDADE_DESDE for y in c["emp"])}
    orgs_forn = collections.defaultdict(list)
    for (o, cnpj), a in fo.items():
        if cnpj in ativos:
            orgs_forn[cnpj].append([o, titulo(org_nome[o]), a["n_ct"], a["vig"], round(a["anual"], 2), round(sum(a["emp"].values()), 2),
                                    round(sum(a["emp"].get(y, 0.0) for y in ANOS_GASTO), 2),
                                    round(sum(pago_of.get((o, cnpj), {}).get(int(y), 0.0) for y in ANOS_GASTO), 2), round(sum(pago_of.get((o, cnpj), {}).values()), 2)])
    glob_f = {}
    for (o, cnpj), a in fo.items():
        g = glob_f.setdefault(cnpj, {"anual": 0.0, "restante": 0.0, "emp": 0.0, "desde": None, "ate": None, "vig": 0, "orgs": [],
                                     "ess_w": collections.Counter(), "cat_w": collections.Counter()})
        g["anual"] += a["anual"]
        g["restante"] += a["restante"]
        g["emp"] += sum(a["emp"].get(y, 0.0) for y in ANOS_GASTO)
        g["vig"] += a["vig"]
        g["desde"] = a["desde"] if g["desde"] is None or (a["desde"] and a["desde"] < g["desde"]) else g["desde"]
        g["ate"] = a["ate"] if g["ate"] is None or (a["ate"] and a["ate"] > g["ate"]) else g["ate"]
        g["ess_w"].update(a["ess_w"])
        g["cat_w"].update(a["cat_w"])
        if a["vig"] or sum(a["emp"].get(y, 0.0) for y in ANOS_GASTO) > 0:
            g["orgs"].append(o)
    fatias = collections.defaultdict(dict)
    for cnpj in ativos:
        f = fichas.get(cnpj, {"cnpj": cnpj, "cadastro": False, "socios": []})
        nome = f.get("razao") or next((c["forn"] for c in recs if c["cnpj"] == cnpj), "")
        g = glob_f.get(cnpj)
        resumo_f = {"anual": round(g["anual"], 2), "restante": round(g["restante"], 2), "emp": round(g["emp"], 2), "vig": g["vig"],
                    "pago": round(sum(pago_f.get(cnpj, {}).get(int(y), 0.0) for y in ANOS_GASTO), 2),
                    "pagoAno": {str(y): round(v, 2) for y, v in sorted(pago_f.get(cnpj, {}).items())},
                    "desde": iso(g["desde"]), "ate": iso(g["ate"]),
                    "cat": g["cat_w"].most_common(1)[0][0] if g["cat_w"] else "", "ess": g["ess_w"].most_common(1)[0][0] if g["ess_w"] else "indefinido"} if g else None
        f = dict(f, nome=nome, resumo=resumo_f, orgaos=sorted(orgs_forn[cnpj], key=lambda x: -x[5]),
                 alertas=[[a, n, t] for a, n, t in alertas_forn.get(cnpj, [])])
        for s in f.get("socios", []):
            s["outros"] = [{"cnpj": o, "nome": next((fichas[o].get("razao") for _ in [0] if o in fichas), o)} for o in s.get("outros", [])]
        fatias[(cnpj[:8][:2] if len(cnpj) == 14 else "pf")][cnpj] = f
    for k, d in fatias.items():
        json.dump(d, open(os.path.join(DESTINO, "forn", f"{k}.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    indice_orgs.sort(key=lambda o: -(o["anualVigente"] + o["empAnt"] + o["empAtu"]))
    prioridades.sort(key=lambda x: -x["prioridade"])
    # fornecedores de maior exposição no governo todo
    expo = collections.defaultdict(lambda: {"anual": 0.0, "emp": 0.0, "orgs": set()})
    for (o, cnpj), a in fo.items():
        e = expo[cnpj]
        e["anual"] += a["anual"]
        e["emp"] += sum(a["emp"].get(y, 0.0) for y in ANOS_GASTO)
        if a["vig"] or sum(a["emp"].get(y, 0.0) for y in ANOS_GASTO) > 0:
            e["orgs"].add(o)
    top_forn = sorted(expo.items(), key=lambda kv: -(kv[1]["anual"] + kv[1]["emp"]))[:40]
    nomes_forn = {}
    for c in recs:
        nomes_forn.setdefault(c["cnpj"], c["forn"])
    top_forn = [{"cnpj": k, "nome": fichas.get(k, {}).get("razao") or nomes_forn.get(k, k), "anual": round(v["anual"], 2), "emp": round(v["emp"], 2),
                 "orgaos": len(v["orgs"]), "alertas": [f"{a}:{n}" for a, n in unicos(alertas_forn.get(k, [])).items() if n != "i"]} for k, v in top_forn]
    todos_forn = []
    for cnpj, g in glob_f.items():
        pago_rec = sum(pago_f.get(cnpj, {}).get(int(y), 0.0) for y in ANOS_GASTO)
        if g["anual"] <= 0 and g["emp"] <= 0 and pago_rec <= 0:
            continue
        todos_forn.append([cnpj, titulo(fichas.get(cnpj, {}).get("razao") or nomes_forn.get(cnpj, cnpj)), round(g["anual"], 2), round(g["restante"], 2), round(g["emp"], 2),
                           iso(g["desde"]), iso(g["ate"]), len(set(g["orgs"])), g["vig"], g["cat_w"].most_common(1)[0][0] if g["cat_w"] else "",
                           g["ess_w"].most_common(1)[0][0] if g["ess_w"] else "indefinido",
                           [f"{a}:{n}" for a, n in unicos(alertas_forn.get(cnpj, [])).items()], sorted(set(g["orgs"]))[0] if g["orgs"] else 0, round(pago_rec, 2),
                           fichas.get(cnpj, {}).get("natureza", "")])
    todos_forn.sort(key=lambda x: -(x[2] + x[4] + x[13]))
    json.dump({"campos": ["cnpj", "nome", "anual", "restante", "emp", "desde", "ate", "nOrgs", "nVig", "cat", "ess", "alertas", "org", "pago", "natureza"], "fornecedores": todos_forn},
              open(os.path.join(DESTINO, "fornecedores.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    busca = [[cnpj, f.get("razao") or nomes_forn.get(cnpj, ""), "; ".join(s["nome"] for s in f.get("socios", []) if s["tipo"] == "PF")]
             for cnpj, f in ((k, fichas.get(k, {})) for k in sorted(ativos))]
    json.dump(busca, open(os.path.join(DESTINO, "busca.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"ref": iso(REF), "anosGasto": list(ANOS_GASTO), "receita": receita["publicacao"],
               "alertas": {k: {"nivel": v[0], "titulo": v[1], "descricao": v[2]} for k, v in R.ALERTAS.items()},
               "limiteDispensa": R.LIMITE_DISPENSA, "execucaoAnos": EXEC["anos"], "essencialidade": R.ROTULO_ESSENCIALIDADE,
               "fonte": {"contratos": "Portal da Transparência do ES — Contratos, Alterações Contratuais e Empenhos (SIGA)",
                         "cadastro": f"Receita Federal — dados abertos do CNPJ, publicação de {receita['publicacao']}"},
               "prioridades": prioridades[:80], "topFornecedores": top_forn,
               "orgs": indice_orgs}, open(os.path.join(DESTINO, "index.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    tam = sum(os.path.getsize(p) for p in glob.glob(os.path.join(DESTINO, "**", "*.json"), recursive=True))
    print(f"{len(indice_orgs)} órgãos; {len(ativos)} fornecedores com ficha; {tam / 1e6:.1f} MB em {DESTINO}")


if __name__ == "__main__":
    main()
