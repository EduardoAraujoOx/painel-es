#!/usr/bin/env python3
"""Complementa RREO com DCA anual do Siconfi para os 78 municipios do ES.

Natureza de receita: 1.9.9.9.03.0.0, Compensacoes Financeiras entre os Regimes
de Previdencia. Nunca soma DCA e RREO, porque representam a mesma receita.
"""
import concurrent.futures
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OUT = Path("fontes/comprev_es")
BASE = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt/dca"
YEAR = 2025
CODE = "RO1.9.9.9.03.0.0"
SOURCE = OUT / "compensacao_rpps_municipios_es_2025.csv"
DEST = OUT / "compensacao_rpps_municipios_es_2025_conciliado.csv"


def url_dca(ibge, offset=0):
    params = dict(an_exercicio=YEAR, no_anexo="DCA-Anexo I-C", id_ente=ibge, limit=1000, offset=offset)
    return BASE + "?" + urlencode(params)


def read_json(url):
    for i in range(4):
        try:
            req = Request(url, headers={"User-Agent": "Pesquisa-Fiscal-ES/1.0", "Accept": "application/json"})
            with urlopen(req, timeout=45) as f:
                return json.load(f)
        except HTTPError as e:
            if e.code in (400, 404):
                raise
            if i == 3: raise
        except (URLError, TimeoutError, OSError, json.JSONDecodeError):
            if i == 3: raise
        time.sleep((i+1)*1.2)


def dca(row):
    ibge = int(row["codigo_ibge"])
    result = {"dca": "", "dca_status": "", "dca_erro": "", "url_dca": url_dca(ibge)}
    items = []
    try:
        for i in range(15):
            page = read_json(url_dca(ibge, len(items)))
            new = page.get("items", [])
            items.extend(new)
            if not page.get("hasMore"):
                break
            if not new: raise ValueError("Paginacao sem itens")
        else:
            raise ValueError("Paginacao incompleta (>15 paginas)")
    except HTTPError as e:
        result["dca_status"] = "sem_dca_api" if e.code == 404 else "falha_http"
        result["dca_erro"] = f"HTTP {e.code}"
        return result
    except Exception as e:
        result["dca_status"] = "falha_consulta"
        result["dca_erro"] = str(e)[:140]
        return result

    if not items:
        result["dca_status"] = "sem_dca_api"
        return result
    matches = [x for x in items if x.get("cod_conta") == CODE and x.get("coluna") == "Receitas Brutas Realizadas"]
    if not matches:
        result["dca_status"] = "dca_sem_rubrica"
    elif len(matches) == 1:
        result["dca_status"] = "dca_com_rubrica"
        result["dca"] = round(float(matches[0].get("valor") or 0), 2)
    else:
        result["dca_status"] = "rubrica_duplicada"
        result["dca_erro"] = f"{len(matches)} linhas em {CODE}"
    return result


def main():
    with SOURCE.open(encoding="utf-8-sig", newline="") as f:
        original = list(csv.DictReader(f, delimiter=";"))
    assert len(original) == 78
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        extra = list(pool.map(dca, original))
    result = []
    for row, ed in zip(original, extra):
        rr = float(row["receita_realizada_r$"]) if row["receita_realizada_r$"] else None
        dv = ed["dca"] if isinstance(ed["dca"], (int, float)) else None
        if rr is not None and dv is not None:
            diff = round(dv-rr,2)
            status = "conciliado" if abs(diff) < 1 else "divergencia_rreo_dca"
            use = rr if abs(diff) < 1 else None
        elif rr is not None:
            diff = None
            status = "somente_rreo"
            use = rr
        elif dv is not None:
            diff = None
            status = "somente_dca"
            use = dv
        else:
            diff = None
            status = "sem_valor_observado"
            use = None
        result.append({
            "municipio": row["municipio"], "codigo_ibge": row["codigo_ibge"],
            "rreo_2025_r$": "" if rr is None else rr,
            "dca_2025_r$": "" if dv is None else dv,
            "valor_conciliado_2025_r$": "" if use is None else use,
            "situacao": status, "diferenca_dca_rreo_r$": "" if diff is None else diff,
            "status_rreo": row["situacao"], "status_dca": ed["dca_status"],
            "erro_dca": ed["dca_erro"], "fonte_rreo": row["url_siconfi"],
            "fonte_dca": ed["url_dca"],
        })
    with DEST.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=result[0].keys(), delimiter=";")
        writer.writeheader()
        writer.writerows(result)
    counts = {}
    for r in result:
        counts[r["situacao"]] = counts.get(r["situacao"],0)+1
    usable = [r for r in result if isinstance(r["valor_conciliado_2025_r$"], (int,float))]
    total = round(sum(r["valor_conciliado_2025_r$"] for r in usable), 2)
    summary = {
        "data_coleta_utc": datetime.now(timezone.utc).isoformat(),
        "base": "Siconfi 2025, RREO Anexo 04, 6o bimestre; DCA Anexo I-C",
        "conta_dca": CODE,
        "total_municipios": len(result),
        "status": counts,
        "receita_conciliada_observada_r$": total,
        "municipios_com_valor": len(usable),
        "observacoes": [
            "RREO e DCA sao fontes alternativas para a mesma receita, nunca somadas.",
            "Divergencias impedem uso automatico do valor no total, ate conciliacao.",
            "A receita contabel pode incluir ajustes entre RPPS, nao apenas transferencias federais do INSS.",
            "Municipios sem valor nao sao tratados como receita zero.",
            "O total e observado, nao representa uma previsao de reducao proporcional de pagamentos por parte do INSS.",
        ],
        "municipios_com_valor": sorted([{"nome":r["municipio"],"valor":r["valor_conciliado_2025_r$"],"situacao":r["situacao"]} for r in usable],key=lambda x:-x["valor"])
    }
    (OUT/"resumo_conciliado_es_2025.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    report=[
        "# Receita de compensacao previdenciaria entre regimes nos municipios do ES",
        "",
        "Ano de 2025. Fontes oficiais: Siconfi, RREO Anexo 4 e DCA Anexo I-C.",
        f"Total de municipios consultados: {len(result)}.",
        f"Municipios com receita observada: {len(usable)}.",
        f"Receita observada conciliada: R$ {total:,.2f}.",
        "",
        "**Importante**: RREO e DCA nao sao somados. Um substitui o outro quando falta.",
        "Municipios sem demonstrativos ou sem a rubrica nao sao considerados receita zero.",
        "",
        "## Status", ""
    ]
    report.extend(f"- {k}: {v}" for k,v in sorted(counts.items()))
    report.extend(["", "## Valores municipais", "", "| Municipio | Receita (R$) | Origem |", "|:--|--:|:--|"])
    for r in sorted(usable,key=lambda x:-x["valor_conciliado_2025_r$"]):
        report.append(f'| {r["municipio"]} | {r["valor_conciliado_2025_r$"]:,.2f} | {r["situacao"]} |')
    (OUT/"LEIAME_CONCILIADO.md").write_text("\n".join(report)+"\n",encoding="utf-8")
    print(json.dumps({"municipios":len(result),"contagem":counts,"total":total,"com_valor":len(usable)},ensure_ascii=False))


if __name__=="__main__":
    main()
