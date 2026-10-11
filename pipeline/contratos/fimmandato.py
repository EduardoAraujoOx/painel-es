#!/usr/bin/env python3
"""Monta os dados da tela "Fim de mandato": o que o governo que sai assumiu nos dois últimos quadrimestres.

Parte de data/contratacoes/diagnostico.json (todos os contratos vigentes, já com valores e alertas) e dos
arquivos de alterações do SIGA (.cache/contratos/a20*.csv). Gera data/fimmandato/index.json com dois conjuntos:

  novos    contratos celebrados a partir do marco (1º de maio de 2026) com vigência que passa de 31/12/2026
           (LRF, art. 42: obrigação contraída nos dois últimos quadrimestres com parcelas no exercício seguinte);
  aditivos alterações registradas a partir do marco, em contratos vigentes, de prazo (prorrogação) ou de valor
           (acréscimo ou supressão quantitativa).

A parcela estimada depois de 2026 é o valor anual do contrato vezes os dias após 31/12/2026, sobre 365, limitada
ao valor final. É estimativa de ordem de grandeza: em obras e registros de preços o valor é um teto.

Uso: python3 -I pipeline/contratos/fimmandato.py
"""
import csv
import glob
import json
import os
from datetime import date

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MARCO = "2026-05-01"
FIM_MANDATO = "2026-12-31"
CORTE = 0.80


def iso_br(s):
    s = (s or "")[:10]
    return s[6:10] + "-" + s[3:5] + "-" + s[0:2] if len(s) == 10 else ""


def num_br(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def dias_apos(fim):
    if not fim or fim <= FIM_MANDATO:
        return 0
    a, b = date.fromisoformat(fim), date.fromisoformat(FIM_MANDATO)
    return (a - b).days


def main():
    diag = json.load(open(os.path.join(RAIZ, "data", "contratacoes", "diagnostico.json"), encoding="utf-8"))
    ix = {k: i for i, k in enumerate(diag["campos"])}
    contratos = diag["contratos"]
    indice = json.load(open(os.path.join(RAIZ, "data", "contratacoes", "index.json"), encoding="utf-8"))

    # contratos principais: os que, do maior para o menor valor anual, somam 80% do total dos vigentes
    ordem = sorted(contratos, key=lambda r: -(r[ix["anual"]] or 0))
    total = sum(r[ix["anual"]] or 0 for r in ordem)
    principais, acum = set(), 0
    for r in ordem:
        principais.add((r[ix["proc"]], r[ix["doc"]]))
        acum += r[ix["anual"]] or 0
        if acum >= CORTE * total:
            break

    def base(r):
        return [r[ix["org"]], r[ix["orgNome"]], r[ix["doc"]], r[ix["proc"]], r[ix["cnpj"]], r[ix["forn"]], (r[ix["objeto"]] or "")[:240], r[ix["cat"]]]

    novos_todos = [r for r in contratos if (r[ix["cel"]] or "") >= MARCO]
    novos = []
    for r in novos_todos:
        fim = r[ix["fimef"]] or ""
        d = dias_apos(fim)
        if not d:
            continue
        anual, vfin = r[ix["anual"]] or 0, r[ix["vfin"]] or 0
        alem = min(vfin, anual * d / 365) if vfin else anual * d / 365
        novos.append(base(r) + [r[ix["modal"]], r[ix["cel"]], fim, round(vfin, 2), round(anual, 2), round(alem, 2), 1 if r[ix["rp"]] else 0,
                                1 if (r[ix["proc"]], r[ix["doc"]]) in principais else 0])
    novos.sort(key=lambda x: -x[12])

    por_chave = {(r[ix["proc"]], r[ix["doc"]]): r for r in contratos}
    aditivos, ignoradas, sem_contrato = [], {}, 0
    for f in sorted(glob.glob(os.path.join(RAIZ, ".cache", "contratos", "a20*.csv"))):
        with open(f, encoding="utf-8-sig", newline="") as fh:
            for a in csv.DictReader(fh, delimiter=";"):
                data = iso_br(a["DataAlteracao"])
                if data < MARCO:
                    continue
                tipo = a["TipoAlteracao"] or ""
                prazo, valor = "Prorrogação de prazo" in tipo, "acréscimos" in tipo
                if not (prazo or valor):
                    ignoradas[tipo] = ignoradas.get(tipo, 0) + 1
                    continue
                r = por_chave.get((a["NumeroProcesso"], a["NumeroDocumento"]))
                if not r:
                    sem_contrato += 1
                    continue
                vini = r[ix["vini"]] or 0
                va = num_br(a["ValorAlteracao"])
                aditivos.append(base(r) + [data, 1 if prazo else 0, 1 if valor else 0, iso_br(a["DataFimVigencia"]), va, round(vini, 2), round(r[ix["vfin"]] or 0, 2),
                                           round(r[ix["anual"]] or 0, 2), 1 if (r[ix["proc"]], r[ix["doc"]]) in principais else 0, a["TipoFormalizacao"]])
    aditivos.sort(key=lambda x: -x[15])

    saida = {
        "ref": indice["ref"], "marco": MARCO, "fimMandato": FIM_MANDATO,
        "camposNovos": ["org", "orgNome", "doc", "proc", "cnpj", "forn", "objeto", "cat", "modal", "cel", "fimef", "vfin", "anual", "alem", "rp", "principal"],
        "novos": novos,
        "camposAditivos": ["org", "orgNome", "doc", "proc", "cnpj", "forn", "objeto", "cat", "data", "prazo", "valor", "novoFim", "valorAlt", "vini", "vfin", "anual", "principal", "formal"],
        "aditivos": aditivos,
        "universo": {"celebradosDesdeMarco": len(novos_todos), "anualCelebrados": round(sum(r[ix["anual"]] or 0 for r in novos_todos), 2),
                     "contratosPrincipais": len(principais), "ignoradas": ignoradas, "semContrato": sem_contrato},
    }
    os.makedirs(os.path.join(RAIZ, "data", "fimmandato"), exist_ok=True)
    with open(os.path.join(RAIZ, "data", "fimmandato", "index.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"contratos principais: {len(principais)} | novos desde {MARCO}: {len(novos_todos)}, com vigência além de 2026: {len(novos)} | aditivos de prazo/valor: {len(aditivos)} | "
          f"ignoradas: {sum(ignoradas.values())} | sem contrato vigente: {sem_contrato}")


if __name__ == "__main__":
    main()
