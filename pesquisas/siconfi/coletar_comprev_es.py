#!/usr/bin/env python3
"""Coleta reprodutivel da compensacao financeira entre regimes nos municipios do ES.

Fonte: Siconfi (RREO, Anexo 04, 6o bimestre) e IBGE.
Ausencia de declaracao nao e tratada como receita zero.
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

YEAR = 2025
OUTPUT = Path("fontes/comprev_es")
API = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo"
IBGE = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/32/municipios"
CODES = ("ReceitasCompensacaoFinanceiraEntreOsRegimes",)
USER_AGENT = "Pesquisa-Fiscal-ES/1.0 (dados publicos)"
COLUMNS = ["municipio", "codigo_ibge", "ano", "situacao", "receita_realizada_r$", "fundo_capitalizacao_r$", "fundo_reparticao_r$", "outras_rubricas_r$", "rubricas_encontradas", "linhas_rreo", "erro", "url_siconfi"]


def get_json(url, tries=4):
    last = None
    for attempt in range(tries):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(req, timeout=45) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code in (400, 404):
                raise
            last = exc
        except (URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            last = exc
        time.sleep((attempt + 1) * 1.3)
    raise RuntimeError(f"Falha apos {tries} tentativas: {last}")


def url_rreo(codigo, offset=0):
    params = {
        "an_exercicio": YEAR,
        "nr_periodo": 6,
        "co_tipo_demonstrativo": "RREO",
        "no_anexo": "RREO-Anexo 04",
        "id_ente": codigo,
        "limit": 1000,
        "offset": offset,
    }
    return API + "?" + urlencode(params)


def gather(m):
    codigo = int(m["id"])
    r = {
        "municipio": m["nome"], "codigo_ibge": codigo, "ano": YEAR,
        "situacao": "", "receita_realizada_r$": "",
        "fundo_capitalizacao_r$": "", "fundo_reparticao_r$": "",
        "outras_rubricas_r$": "", "rubricas_encontradas": "",
        "linhas_rreo": 0, "erro": "", "url_siconfi": url_rreo(codigo)
    }
    items = []
    try:
        for page in range(15):
            resp = get_json(url_rreo(codigo, len(items)))
            chunk = resp.get("items", [])
            items.extend(chunk)
            if not resp.get("hasMore"):
                break
            if not chunk:
                raise RuntimeError("Resposta com hasMore e sem items")
        else:
            raise RuntimeError("Mais de 15 paginas; conferir paginacao")
    except HTTPError as exc:
        r["situacao"] = "sem_demonstrativo_api" if exc.code == 404 else "falha_http"
        r["erro"] = f"HTTP {exc.code}"
        return r
    except Exception as exc:
        r["situacao"] = "falha_consulta"
        r["erro"] = str(exc)[:200]
        return r

    r["linhas_rreo"] = len(items)
    if not items:
        r["situacao"] = "sem_demonstrativo_api"
        return r
    relevant = [
        x for x in items
        if (str(x.get("cod_conta") or "").startswith(CODES))
        and ("REALIZADAS" in (x.get("coluna") or "").upper())
    ]
    if not relevant:
        r["situacao"] = "rreo_sem_rubrica_realizada_comprev"
        return r

    seen = set()
    cap = rep = outros = 0.0
    names = []
    for x in relevant:
        key = (x.get("cod_conta"), x.get("rotulo"), x.get("coluna"))
        if key in seen:
            continue
        seen.add(key)
        code = str(x.get("cod_conta") or "")
        names.append(code)
        val = float(x.get("valor") or 0)
        if "FundoEmReparticao" in code or "Financeiro" in code:
            rep += val
        elif code == "ReceitasCompensacaoFinanceiraEntreOsRegimes" or "Previdenciario" in code:
            cap += val
        else:
            outros += val
    r["situacao"] = "receita_observada"
    r["fundo_capitalizacao_r$"] = round(cap, 2)
    r["fundo_reparticao_r$"] = round(rep, 2)
    r["outras_rubricas_r$"] = round(outros, 2)
    r["receita_realizada_r$"] = round(cap + rep + outros, 2)
    r["rubricas_encontradas"] = " | ".join(sorted(set(names)))
    return r


def main():
    municipios = get_json(IBGE)
    assert len(municipios) == 78, f"IBGE retornou {len(municipios)} municipios, esperado 78"
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(gather, municipios))
    rows.sort(key=lambda x: x["municipio"])
    out = OUTPUT / "compensacao_rpps_municipios_es_2025.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    observed = [r for r in rows if r["situacao"] == "receita_observada"]
    total = round(sum(r["receita_realizada_r$"] for r in observed), 2)
    counts = {}
    for r in rows:
        counts[r["situacao"]] = counts.get(r["situacao"], 0) + 1
    summary = {
        "fonte": "Siconfi, API RREO Anexo 04, sexto bimestre de 2025",
        "fonte_codigos": IBGE,
        "data_coleta_utc": datetime.now(timezone.utc).isoformat(),
        "municipios_consultados": len(rows),
        "status": counts,
        "total_receita_observada_r$": total,
        "observacao": "Somatorio apenas dos entes com rubrica observada. Nao extrapolar a totalidade. Nao inferir receita zero quando nao ha demonstrativo ou rubrica.",
        "municipios_receita": sorted(
            [{"municipio": r["municipio"], "valor_r$": r["receita_realizada_r$"]} for r in observed],
            key=lambda x: -x["valor_r$"]
        ),
    }
    (OUTPUT / "resumo_compensacao_rpps_es_2025.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lines = [
        "# Coleta da compensacao entre regimes nos municipios do ES",
        "",
        f"Exercicio: {YEAR}. RREO, Anexo 04, 6o bimestre. Fonte: Siconfi / Tesouro Nacional.",
        f"Entes consultados: {len(rows)}. Receitas observadas: {len(observed)}.",
        f"Total das receitas observadas: R$ {total:,.2f}.",
        "",
        "**Cuidado**: o total observado nao e automaticamente o total de todos os municipios.",
        "Ausencia do Anexo 04, ausencia da rubrica e falha de acesso sao classificadas separadamente.",
        "As receitas reportadas podem incluir compensacao entre RPPS distintos, nao apenas transferencias liquidas do INSS.",
        "",
        "## Contagem por situacao",
        "",
    ]
    lines.extend(f"- {k}: {v}" for k, v in sorted(counts.items()))
    lines.extend(["", "## Municipios com receita observada", "", "| Municipio | Receita realizada (R$) |", "|:--|--:|"])
    for r in sorted(observed, key=lambda x: -x["receita_realizada_r$"]):
        lines.append(f'| {r["municipio"]} | {r["receita_realizada_r$"]:,.2f} |')
    lines.extend(["", "## Reproducao", "", "Executar `python pesquisas/siconfi/coletar_comprev_es.py` em ambiente com acesso HTTPS.", ""])
    (OUTPUT / "LEIAME.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "municipios": len(rows), "status": counts, "total_observado": total,
        "maiores": summary["municipios_receita"][:15]
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
