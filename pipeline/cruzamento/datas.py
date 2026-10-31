#!/usr/bin/env python3
"""
Datas dos contratos suspensos e rescindidos (módulo `suspensos`).

O cadastro de contratos (SIGA) não informa a data da suspensão ou da rescisão: só a situação atual. Este passo, sem rede, procura a melhor data disponível
para cada instrumento de data/suspensos/index.json, em três fontes, da mais precisa para a menos precisa:

  1. Diário Oficial: um ato de paralisação/suspensão, rescisão ou anulação (data/atos/index.json) que o cruzamento ligou a este contrato no SIGA
     (data/atos/cruzamento.json); vale a data de publicação.
  2. Portal de Obras: a obra paralisada ou rescindida de mesmo número e ano de contrato e da mesma empresa (data/obras/index.json); vale a data da
     situação ("Paralisada (dd/mm/aaaa)"). O CNPJ decide quando os dois lados o trazem; sem CNPJ, vale órgão e nome da empresa.
  3. Painel: a primeira vez em que este coletor viu o instrumento nessa situação (`visto_em`), que só existe depois do primeiro levantamento e é a data
     em que o painel soube, não a da decisão.

Grava data/suspensos/datas.json: {gerado_em, itens: {id do instrumento: {data, fonte, texto, url?}}}. Instrumento sem data em nenhuma fonte não entra.

Uso (sem dependências externas):
  python3 -I pipeline/cruzamento/datas.py             # calcula e grava
  python3 -I pipeline/cruzamento/datas.py --dry-run   # só mostra o resumo
"""

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SUSPENSOS = RAIZ / "data" / "suspensos" / "index.json"
ATOS = RAIZ / "data" / "atos" / "index.json"
CRUZAMENTO = RAIZ / "data" / "atos" / "cruzamento.json"
OBRAS = RAIZ / "data" / "obras" / "index.json"
SAIDA = RAIZ / "data" / "suspensos" / "datas.json"

_spec = importlib.util.spec_from_file_location("cruzar", Path(__file__).resolve().parent / "cruzar.py")
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)

ATO_PARA_CATEGORIA = C.ESPERADO  # categoria que o SIGA teria se registrasse o ato: paralisacao/suspensao -> suspenso, rescisao -> rescindido, anulacao -> anulado
OBRA_PARA_CATEGORIA = {"paralisada": "suspenso", "rescindida": "rescindido"}
ROTULO_ATO = {"paralisacao": "Paralisação", "suspensao": "Suspensão", "rescisao": "Rescisão", "anulacao": "Anulação"}
ROTULO_OBRA = {"paralisada": "Obra paralisada", "rescindida": "Obra com contrato rescindido"}


def digitos(s):
    return re.sub(r"\D", "", s or "")


def mesmo_instrumento(item, siga):
    """O contrato do SIGA citado pelo cruzamento é este instrumento: mesmo documento, órgão e fornecedor (a chave do instrumento no painel)."""
    return (C.normalizar(item.get("documento")) == C.normalizar(siga.get("documento"))
            and C.normalizar(item.get("orgao")) == C.normalizar(siga.get("orgao"))
            and C.normalizar(item.get("fornecedor")) == C.normalizar(siga.get("fornecedor")))


def data_do_diario(item, atos, cruz):
    """Publicação mais recente de um ato que o cruzamento ligou a este instrumento e que corresponde à situação dele."""
    melhor = None
    for a in atos:
        esperado = ATO_PARA_CATEGORIA.get(a.get("tipo"))
        siga = (cruz.get(a["id"]) or {}).get("siga")
        if esperado is None or esperado != item.get("categoria") or not siga or not mesmo_instrumento(item, siga):
            continue
        if melhor is None or a["data"] > melhor["data"]:
            melhor = a
    if not melhor:
        return None
    return {"data": melhor["data"], "fonte": "diario", "texto": f"{ROTULO_ATO.get(melhor['tipo'], 'Ato')} publicada no Diário Oficial", "url": melhor.get("url")}


def numero_ano(item):
    """(número, ano) do contrato, nos formatos do SIGA: 'Contrato 102/2022', 'Contrato 00016/2023' e 'Contrato 2026.000005.60201.01/2026'. Só contratos:
    ordens de execução, autorizações de compra e empenhos têm outra numeração."""
    if C.normalizar(item.get("tipo")) not in C.TIPOS_CONTRATO:
        return None
    par = C.numero_ano_do_siga(item.get("documento"))
    if par:
        return par
    m = re.search(r"\b0*(\d+)\s*/\s*(\d{4})\s*$", item.get("documento") or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def data_das_obras(item, obras):
    """Data da situação da obra do portal com o mesmo contrato, na situação equivalente à do instrumento. Mais de uma obra: vale a mais recente."""
    par = numero_ano(item)
    if not par:
        return None
    achadas = []
    for o in obras:
        if OBRA_PARA_CATEGORIA.get(o.get("tipo")) != item.get("categoria"):
            continue
        m = re.match(r"\s*0*(\d+)\s*/\s*(\d{4})", o.get("contrato") or "")
        if not m or (int(m.group(1)), int(m.group(2))) != par:
            continue
        cnpj_i, cnpj_o = digitos(item.get("cnpj")), digitos(o.get("cnpj"))
        if cnpj_i and cnpj_o:
            if cnpj_i != cnpj_o:
                continue
        else:  # sem CNPJ de um dos lados: órgão compatível e alguma palavra do nome da empresa em comum
            if C.similaridade(item.get("orgao", ""), o.get("orgao", "")) < 0.34 or not (C.tokens_nome(item.get("fornecedor", "")) & C.tokens_nome(o.get("empresa", ""))):
                continue
        achadas.append(o)
    if not achadas:
        return None
    o = max(achadas, key=lambda x: x["data_situacao"])
    extra = f" ({len(achadas)} obras do contrato; a mais recente)" if len(achadas) > 1 else ""
    return {"data": o["data_situacao"], "fonte": "obras", "texto": f"{ROTULO_OBRA[o['tipo']]} no Portal de Obras{extra}", "url": o.get("url")}


def data_do_painel(item):
    v = item.get("visto_em")
    return {"data": v[:10], "fonte": "painel", "texto": "Detectado pelo painel (o cadastro não informa a data da decisão)"} if v else None


def calcular(itens, atos, cruz, obras):
    saida = {}
    for it in itens:
        d = data_do_diario(it, atos, cruz) or data_das_obras(it, obras) or data_do_painel(it)
        if d:
            saida[it["id"]] = d
    return saida


def resumo(datas, itens):
    r = {"total": len(itens), "com_data": len(datas), "diario": 0, "obras": 0, "painel": 0}
    for d in datas.values():
        r[d["fonte"]] += 1
    return r


def _ler(caminho, padrao):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    susp = _ler(SUSPENSOS, None)
    if not susp or not susp.get("itens"):
        sys.exit("sem data/suspensos/index.json: nada a datar")
    atos = _ler(ATOS, {}).get("itens", [])
    cruz = _ler(CRUZAMENTO, {}).get("itens", {})
    obras = _ler(OBRAS, {}).get("itens", [])
    datas = calcular(susp["itens"], atos, cruz, obras)
    r = resumo(datas, susp["itens"])
    print(f"{r['total']} instrumentos: {r['com_data']} com data (Diário {r['diario']}, Portal de Obras {r['obras']}, detectado pelo painel {r['painel']}); "
          f"{r['total'] - r['com_data']} sem data (o SIGA não informa). Fontes lidas: {len(atos)} atos, {len(obras)} obras.")
    if args.dry_run:
        return
    antigo = _ler(SAIDA, None)
    if antigo and antigo.get("itens") == datas:
        print("sem mudanças: o arquivo não foi alterado")
        return
    SAIDA.write_text(json.dumps({"gerado_em": C.iso(C.agora()), "resumo": r, "itens": datas}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
