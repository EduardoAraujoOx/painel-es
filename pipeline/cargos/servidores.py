#!/usr/bin/env python3
"""Quadro geral de servidores de cada órgão do Poder Executivo, para a visão geral do painel Pessoal.

Lê a folha do último mês (Remuneracoes-AAAA-MM.csv, dados abertos do ES, uma linha por rubrica) e, para cada órgão, conta as pessoas
ATIVAS na folha (matrícula + vínculo) e soma as vantagens correntes do mês (sem 13º, férias, rescisão e resíduos de acerto). O tipo de
vínculo (efetivo, comissionado, designação temporária...) vem da base de vínculos (vinculos_todos.json, de extrair_vinculos.py).

Resultado: .cache/cargos/servidores.json, lido por montar.py.   Uso: python3 -I pipeline/cargos/servidores.py [AAAA-MM]
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extrair  # noqa: E402
import regras  # noqa: E402

NAO_CORRENTE = re.compile(r"(\b13\b|DECIMO|FERIAS|RESCISAO|INSUFICIENCIA|DEVOLUCAO|DEBITO EXERC|INDENIZACAO FERIAS)")


def main():
    recursos = extrair.listar_recursos()
    mes = sys.argv[1] if len(sys.argv) > 1 else sorted(k for k in recursos if re.fullmatch(r"\d{4}-\d{2}", k))[-1]
    mes_folha = f"{mes[5:7]}/{mes[:4]}"
    vt = os.path.join(extrair.CACHE, "vinculos_todos.json")
    tipos_de = json.load(open(vt)) if os.path.exists(vt) else {}
    pessoas = {}                                   # (orgao, numfunc, numvinc) -> vantagens correntes
    situacoes = collections.Counter()
    for r in extrair.linhas_csv(recursos[mes]):
        situacoes[r["Situacao_Folha"]] += 1
        if r["Situacao_Folha"] != "ATIVO" or r["Orgao"] in regras.ORGAOS_EXCLUIDOS:
            continue
        chave = (r["Orgao"], r["NumFunc"], r["NumVinc"])
        pessoas.setdefault(chave, 0.0)
        if r["MesCompetencia"] != r["MesFolha"] or r["MesFolha"] != mes_folha or r["VantagemDesconto"] != "V":
            continue
        if NAO_CORRENTE.search(r["Rubrica"]):
            continue
        pessoas[chave] += regras.para_float(r["Valor"])
    orgs = {}
    for (org, nf, nv), v in pessoas.items():
        o = orgs.setdefault(org, {"n": 0, "bruto": 0.0, "tipos": collections.Counter()})
        o["n"] += 1
        o["bruto"] += v
        t = tipos_de.get(f"{org}|{nf}|{nv}")
        o["tipos"][t[0] if t else "SEM VÍNCULO NA BASE"] += 1
    saida = {"mes": mes, "situacoes": dict(situacoes),
             "orgs": {k: {"n": v["n"], "bruto": round(v["bruto"], 2), "tipos": dict(v["tipos"].most_common())} for k, v in sorted(orgs.items())}}
    with open(os.path.join(extrair.CACHE, "servidores.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, separators=(",", ":"))
    tot = sum(v["n"] for v in orgs.values())
    print(f"{mes}: {tot} pessoas ativas em {len(orgs)} órgãos; vantagens correntes R$ {sum(v['bruto'] for v in orgs.values()) / 1e6:,.1f} mi; situações: {dict(situacoes)}")


if __name__ == "__main__":
    main()
