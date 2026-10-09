#!/usr/bin/env python3
"""Monta os arquivos de dados do painel a partir das extrações mensais (.cache/AAAA-MM.json).

Saídas (em data/, servidas apenas depois do login):
    data/index.json        visão geral: um registro por órgão, com séries mensais
    data/org/<SIGLA>.json  ocupantes do último mês de cada órgão, com tempo na função

Definições de fluxo (por órgão, entre meses consecutivos):
    chave de pessoa  = (órgão, matrícula, vínculo); os fluxos são contados por (pessoa, tipo)
    entrada          = pessoa ocupa CC (ou FG) no mês e não ocupava no mês anterior
    saída            = pessoa ocupava CC (ou FG) no mês anterior e já não ocupa
    troca de função  = mesma pessoa, no mesmo tipo e órgão, mas em função de nome diferente
    Mudança de órgão aparece como saída num órgão e entrada em outro.

Só conta como ocupante quem tem pagamento do cargo na competência (valor > 0).
"""
import argparse
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extrair  # noqa: E402
import regras  # noqa: E402

TIPO_COMPLETO = {"CC": regras.TIPO_CC, "FG": regras.TIPO_FG}

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RAIZ, ".cache")
SAIDA = os.path.join(RAIZ, "data")


def carregar_meses(filtro=None):
    meses = {}
    for caminho in sorted(glob.glob(os.path.join(CACHE, "????-??.json"))):
        d = json.load(open(caminho))
        if filtro is None or d["mes"] in filtro:
            meses[d["mes"]] = d
    if not meses:
        sys.exit("nenhuma extração mensal em .cache/")
    return meses


def seguro(sigla):
    return re.sub(r"[^A-Za-z0-9_-]", "_", sigla)


def limpar_funcao(nome):
    return re.sub(r"\s+", " ", nome).strip()


def subsidio_padrao_por_funcao(registros):
    """Moda do SUBSIDIO entre ocupantes de CC sem cargo efetivo e sem outras rubricas de cargo."""
    por_funcao = collections.defaultdict(collections.Counter)
    for org, nf, nv, nome, funcao, tipo, unidade, cargo_ef, rub in registros:
        if tipo != "CC" or cargo_ef.strip():
            continue
        if rub.get(regras.R_SUBSIDIO) and not any(rub.get(r) for r in (regras.R_OPCAO, regras.R_VENC_PURO, regras.R_VENC_EFET)):
            por_funcao[limpar_funcao(funcao)][round(rub[regras.R_SUBSIDIO], 2)] += 1
    return {f: c.most_common(1)[0][0] for f, c in por_funcao.items()}


def main():
    global SAIDA
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--meses", help="subconjunto consecutivo AAAA-MM:AAAA-MM (padrão: todos os extraídos)")
    ap.add_argument("--saida", help="pasta de saída (padrão: data/)")
    a = ap.parse_args()
    if a.saida:
        SAIDA = os.path.abspath(a.saida)
    filtro = set(extrair.expandir_meses(a.meses)) if a.meses else None
    meses = carregar_meses(filtro)
    lista = sorted(meses)
    for ant, prox in zip(lista, lista[1:]):
        if extrair.expandir_meses(f"{ant}:{prox}")[1:-1]:
            sys.exit(f"meses não consecutivos entre {ant} e {prox}: os fluxos ficariam incorretos")
    ultimo = lista[-1]
    vinc_path = os.path.join(CACHE, "vinculos.json")
    extra = json.load(open(vinc_path)) if os.path.exists(vinc_path) else {"orgaos": {}, "vinculos": {}}

    # índices por mês: pessoa -> {(função, tipo) -> registro}  e  (pessoa, tipo) -> {funções}
    por_mes = {}
    por_mes_tipo = {}
    sem_pagamento = collections.Counter()
    for mes in lista:
        idx = collections.defaultdict(dict)
        idx_tipo = collections.defaultdict(set)
        registros = [r for r in meses[mes]["registros"] if r[0] not in regras.ORGAOS_EXCLUIDOS]
        padrao = subsidio_padrao_por_funcao(registros)
        for org, nf, nv, nome, funcao, tipo, unidade, cargo_ef, rub in registros:
            funcao = limpar_funcao(funcao)
            valor, prov, ocupante, subs_carreira = regras.valor_e_provimento(
                TIPO_COMPLETO[tipo], rub, cargo_ef, padrao.get(funcao))
            if not ocupante:
                # Sem nenhuma rubrica de cargo na competência (ex.: só "insuficiência de saldo",
                # resíduo de acerto de quem foi desligado ou afastado): não é ocupante. Contá-los
                # infla o quadro todo janeiro e cria rotatividade fictícia.
                sem_pagamento[mes] += 1
                continue
            idx[(org, nf, nv)][(funcao, tipo)] = (nome, unidade, cargo_ef, prov, valor, subs_carreira)
            idx_tipo[((org, nf, nv), tipo)].add(funcao)
        por_mes[mes] = idx
        por_mes_tipo[mes] = idx_tipo

    orgaos = sorted({p[0] for m in lista for p in por_mes[m]})
    zero = lambda: {"cc": 0, "fg": 0, "custo_cc": 0.0, "custo_fg": 0.0,
                    "ent_cc": 0, "ent_fg": 0, "sai_cc": 0, "sai_fg": 0, "troc_cc": 0, "troc_fg": 0}
    serie = {o: {m: zero() for m in lista} for o in orgaos}

    for i, mes in enumerate(lista):
        for (org, nf, nv), funcoes in por_mes[mes].items():
            for (funcao, tipo), (_, _, _, _, valor, _) in funcoes.items():
                s = serie[org][mes]
                s[tipo.lower()] += 1
                s["custo_" + tipo.lower()] += valor
        if i == 0:
            continue
        atual, anterior = por_mes_tipo[mes], por_mes_tipo[lista[i - 1]]
        for (pessoa, tipo), funcoes in atual.items():
            s = serie[pessoa[0]][mes]
            if (pessoa, tipo) not in anterior:
                s["ent_" + tipo.lower()] += 1
            elif funcoes != anterior[(pessoa, tipo)]:
                s["troc_" + tipo.lower()] += 1
        for (pessoa, tipo) in anterior:
            if (pessoa, tipo) not in atual:
                serie[pessoa[0]][mes]["sai_" + tipo.lower()] += 1

    # tempo na função (para os ocupantes do último mês)
    def desde(pessoa, funcao_tipo):
        inicio, continuo = ultimo, True
        for mes in reversed(lista[:-1]):
            f = por_mes[mes].get(pessoa)
            if f is not None and funcao_tipo in f:
                inicio = mes
            else:
                continuo = False
                break
        return inicio, continuo  # continuo=True: presente desde o início da janela (data é limite)

    os.makedirs(os.path.join(SAIDA, "org"), exist_ok=True)
    for antigo in glob.glob(os.path.join(SAIDA, "org", "*.json")):
        os.remove(antigo)

    ocupantes_por_org = collections.defaultdict(list)
    for pessoa, funcoes in por_mes[ultimo].items():
        org, nf, nv = pessoa
        vinculo = extra["vinculos"].get(f"{org}|{nf}|{nv}")
        for (funcao, tipo), (nome, unidade, cargo_ef, prov, valor, subs_carreira) in funcoes.items():
            ini, na_borda = desde(pessoa, (funcao, tipo))
            ocupantes_por_org[org].append({
                "id": f"{nf}-{nv}", "nome": nome, "funcao": funcao, "tipo": tipo,
                "unidade": unidade, "cargoEfetivo": cargo_ef.strip(), "prov": prov,
                "valor": valor, "subsidioCarreira": subs_carreira or None, "desde": ini, "limite": na_borda,
                "vinculo": vinculo[0] if vinculo else None,
                "exercicio": vinculo[1] if vinculo else None,
            })

    resumo_orgs = []
    for org in orgaos:
        s = serie[org]
        u = s[ultimo]
        if u["cc"] + u["fg"] == 0:
            continue
        ocup = sorted(ocupantes_por_org[org], key=lambda o: (-o["valor"], o["nome"]))
        json.dump({"sigla": org, "mes": ultimo, "ocupantes": ocup},
                  open(os.path.join(SAIDA, "org", seguro(org) + ".json"), "w"),
                  ensure_ascii=False, separators=(",", ":"))
        resumo_orgs.append({
            "sigla": org, "arquivo": seguro(org),
            "nome": extra["orgaos"].get(org, org),
            "serie": [[m, s[m]["cc"], s[m]["fg"], round(s[m]["custo_cc"], 2), round(s[m]["custo_fg"], 2),
                       s[m]["ent_cc"], s[m]["ent_fg"], s[m]["sai_cc"], s[m]["sai_fg"],
                       s[m]["troc_cc"], s[m]["troc_fg"]] for m in lista],
        })

    diag = collections.Counter()
    for m in lista:
        diag.update(meses[m]["diagnostico"]["rubricas"])
    json.dump({
        "mes": ultimo, "meses": lista,
        "colunasSerie": ["mes", "cc", "fg", "custoCC", "custoFG", "entCC", "entFG",
                         "saiCC", "saiFG", "trocCC", "trocFG"],
        "orgs": resumo_orgs,
        "orgaosExcluidos": regras.ORGAOS_EXCLUIDOS,
        "semPagamento": {m: sem_pagamento[m] for m in lista},
        "fonte": {
            "conjunto": "[Portal da Transparência] Pessoal — SEGER/ES",
            "url": "https://dados.es.gov.br/dataset/portal-da-transparencia-pessoal",
            "gerado": os.environ.get("GERADO_EM", ""),
        },
    }, open(os.path.join(SAIDA, "index.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    total = sum(1 for _ in glob.glob(os.path.join(SAIDA, "org", "*.json")))
    ocup = sum(len(v) for v in ocupantes_por_org.values())
    print(f"{len(lista)} meses ({lista[0]} a {ultimo}); {total} órgãos; {ocup} ocupações no último mês")
    mapeadas = {regras.R_VENC_PURO, regras.R_VENC_EFET, regras.R_OPCAO, *regras.COMPLEMENTOS_CC}
    nao_mapeadas = {k: v for k, v in diag.items() if "COMISS" in k and k not in mapeadas}
    if nao_mapeadas:
        print("rubricas com 'COMISS' no nome fora da regra de valor:", nao_mapeadas)


if __name__ == "__main__":
    main()
