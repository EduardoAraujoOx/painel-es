#!/usr/bin/env python3
"""
Detector de contratos suspensos, rescindidos e anulados (módulo `suspensos`).

Lê os arquivos anuais de Contratos do Portal da Transparência do ES (sistema SIGA, atualizados todo dia),
separa os instrumentos cuja situação é de suspensão, rescisão ou anulação/revogação e compara com o
levantamento anterior para dizer o que é novo. Grava data/suspensos/index.json.

O cadastro CONFIRMA, não antecipa: o órgão registra a situação depois de decidir (o caso da Sejus, de 27/10/2026,
apareceu na imprensa antes de aparecer aqui). Por isso o detector convive com o módulo Notícias.

Escopo: suspensos de qualquer ano (são poucos); rescindidos e anulados/revogados só se celebrados desde
ANO_MANDATO ou com fim de vigência desde o início do ano corrente (rescisão antiga não é alerta).

Uso (sem dependências externas):
  python3 -I pipeline/contratos/suspensos.py            # baixa, compara e grava
  python3 -I pipeline/contratos/suspensos.py --dry-run  # só mostra o resumo
"""

import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SAIDA = RAIZ / "data" / "suspensos" / "index.json"
PACOTE = "https://dados.es.gov.br/api/3/action/package_show?id=portal-da-transparencia-contratos"
AGENTE = "Mozilla/5.0 (compatible; painel-es-contratos/1.0; +https://github.com/EduardoAraujoOx/painel-es)"
ANO_MANDATO = 2023
ANO_INICIAL = 2016
LIMITE_BYTES = 40_000_000
MAX_SAIDAS = 200
MAX_SERIE = 400


def agora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def baixar(url, tentativas=3):
    ultimo = None
    for n in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
            with urllib.request.urlopen(req, timeout=180) as r:
                dados = r.read(LIMITE_BYTES + 1)
            if len(dados) > LIMITE_BYTES:
                raise ValueError("resposta acima do limite de tamanho")
            return dados
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            ultimo = e
            time.sleep(3 * (n + 1))
    raise RuntimeError(str(ultimo))


def categoria(situacao):
    s = (situacao or "").lower()
    if "suspens" in s:
        return "suspenso"
    if s.startswith("rescis"):
        return "rescindido"
    if "anulad" in s or "revogad" in s:
        return "anulado"
    return None


def valor_br(s):
    s = (s or "").strip().replace(".", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def data_iso(s):
    try:
        return datetime.strptime((s or "")[:10], "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def relevante(cat, celebracao, fim, ano_corrente):
    """Suspenso: sempre. Rescindido/anulado: só do mandato atual ou ainda em vigência no ano corrente."""
    if cat == "suspenso":
        return True
    if celebracao and int(celebracao[:4]) >= ANO_MANDATO:
        return True
    return bool(fim and int(fim[:4]) >= ano_corrente)


def ler_csv(dados, ano):
    texto = dados.decode("utf-8-sig", "replace")
    dialeto = ";" if texto[:600].count(";") > texto[:600].count(",") else ","
    for linha in csv.DictReader(io.StringIO(texto), delimiter=dialeto):
        yield {**linha, "_ano": ano}


def extrair(linhas, ano_corrente):
    itens = {}
    for r in linhas:
        cat = categoria(r.get("Situacao"))
        if not cat:
            continue
        cel, fim = data_iso(r.get("DataCelebracao")), data_iso(r.get("DataFimVigencia"))
        if not relevante(cat, cel, fim, ano_corrente):
            continue
        i = str(r.get("Id") or f"{r.get('IdOrgao')}|{r.get('NumeroDocumento')}")
        itens[i] = {
            "id": i, "orgao": (r.get("NomeOrgao") or "").strip(), "orgao_id": str(r.get("IdOrgao") or ""),
            "documento": (r.get("NumeroDocumento") or "").strip(), "tipo": (r.get("TipoDocumento") or "").strip(),
            "fornecedor": (r.get("Fornecedor") or "").strip(), "cnpj": (r.get("CnpjFornecedor") or "").strip(),
            "objeto": re.sub(r"\s+", " ", (r.get("Objeto") or "")).strip()[:300],
            "valor_inicial": valor_br(r.get("ValorInicial")), "valor_final": valor_br(r.get("ValorFinal")),
            "celebracao": cel, "fim": fim, "situacao": (r.get("Situacao") or "").strip(), "categoria": cat, "ano": str(r.get("_ano")),
        }
    return itens


def comparar(atuais, anterior, hoje):
    """Aplica `visto_em` (primeira vez em que o detector viu o item) e acha o que entrou e o que saiu desde o levantamento anterior."""
    antes = {i["id"]: i for i in (anterior or {}).get("itens", [])}
    baseline = not anterior
    novos, saidas = [], list((anterior or {}).get("saidas", []))
    for i, it in atuais.items():
        velho = antes.get(i)
        if velho is None:
            it["visto_em"] = None if baseline else iso(hoje)  # None: já estava no primeiro levantamento
            if not baseline:
                novos.append(i)
        else:
            it["visto_em"] = velho.get("visto_em")
            if velho.get("categoria") != it["categoria"] or velho.get("situacao") != it["situacao"]:
                it["visto_em"] = iso(hoje)  # mudou de situação (ex.: suspenso virou rescindido): é novidade
                novos.append(i)
    for i, velho in antes.items():
        if i not in atuais:
            saidas.append({**velho, "saiu_em": iso(hoje)})
    return novos, saidas[-MAX_SAIDAS:], baseline


def contagem(itens):
    c = {"suspenso": 0, "rescindido": 0, "anulado": 0}
    for it in itens.values():
        c[it["categoria"]] += 1
    return c


def por_orgao(itens):
    agr = {}
    for it in itens.values():
        o = agr.setdefault(it["orgao"], {"orgao": it["orgao"], "suspenso": 0, "rescindido": 0, "anulado": 0, "valor": 0.0})
        o[it["categoria"]] += 1
        o["valor"] += it["valor_final"] or it["valor_inicial"] or 0
    return sorted(({**o, "valor": round(o["valor"], 2)} for o in agr.values()), key=lambda o: (-(o["suspenso"] + o["rescindido"] + o["anulado"]), o["orgao"]))


def montar(atuais, anterior, hoje):
    novos, saidas, baseline = comparar(atuais, anterior, hoje)
    c = contagem(atuais)
    serie = list((anterior or {}).get("serie", []))
    if not serie or {k: serie[-1][k] for k in c} != c:
        serie.append({"data": hoje.strftime("%Y-%m-%d"), **c})
    itens = sorted(atuais.values(), key=lambda it: (it["categoria"] != "suspenso", -(it["valor_final"] or it["valor_inicial"] or 0)))
    return {
        "ref": hoje.strftime("%Y-%m-%d"), "gerado_em": iso(hoje),
        "primeiro_levantamento": (anterior or {}).get("primeiro_levantamento") or hoje.strftime("%Y-%m-%d"),
        "baseline": baseline, "contagem": c, "serie": serie[-MAX_SERIE:], "por_orgao": por_orgao(atuais),
        "novos": novos, "saidas": saidas, "itens": itens,
        "escopo": f"Suspensos de qualquer ano; rescindidos e anulados/revogados celebrados desde {ANO_MANDATO} ou com fim de vigência no ano corrente.",
    }


def mudou(antes, depois):
    """Compara o que importa (sem a data de geração), para o Action só publicar quando algo muda."""
    chaves = ("itens", "saidas", "contagem", "novos")
    return not antes or any(antes.get(k) != depois.get(k) for k in chaves)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    hoje = agora()
    recursos = json.loads(baixar(PACOTE))["result"]["resources"]
    alvo = []
    for r in recursos:
        m = re.match(r"Contratos-(20\d\d)\.csv$", r["name"])
        if m and ANO_INICIAL <= int(m.group(1)) <= hoje.year + 2:
            alvo.append((m.group(1), r["url"]))
    if not alvo:
        sys.exit("nenhum arquivo de contratos encontrado no pacote: nada foi alterado")
    linhas, falhas = [], []
    for ano, url in sorted(alvo):
        try:
            linhas.extend(ler_csv(baixar(url), ano))
        except RuntimeError as e:
            falhas.append(ano)
            print(f"FALHA em {ano}: {str(e)[:100]}")
    if falhas:
        sys.exit(f"{len(falhas)} arquivo(s) não baixaram ({', '.join(falhas)}): nada foi alterado, para não confundir ausência com saída")
    atuais = extrair(linhas, hoje.year)
    anterior = None
    if SAIDA.exists():
        try:
            anterior = json.loads(SAIDA.read_text(encoding="utf-8"))
        except ValueError:
            anterior = None
    saida = montar(atuais, anterior, hoje)
    c = saida["contagem"]
    print(f"{len(linhas)} contratos lidos; suspensos={c['suspenso']} rescindidos={c['rescindido']} anulados={c['anulado']}; "
          f"{'primeiro levantamento (base de comparação)' if saida['baseline'] else str(len(saida['novos'])) + ' novos, ' + str(len(saida['saidas'])) + ' saídas guardadas'}")
    for i in saida["novos"]:
        it = atuais[i]
        print(f"  NOVO [{it['categoria']}] {it['orgao'][:40]} | {it['fornecedor'][:30]} | {it['objeto'][:60]}")
    if args.dry_run:
        return
    if not mudou(anterior, saida):
        print("sem mudanças: o arquivo não foi alterado")
        return
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
