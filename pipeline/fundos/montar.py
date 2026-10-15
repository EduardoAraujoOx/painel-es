#!/usr/bin/env python3
"""Monta os dados do painel "Fundos": o raio-x do que cada fundo arrecada e gasta e dos sinais de margem para realocar recursos.

Entrada: .cache/fundos/exec_<ano>.json (execucao_fundos.py), .cache/fundos/rec_<ano>.json (receita_fundos.py) e, opcional,
pipeline/fundos/cadastro.json (base legal de cada fundo, levantada à mão em fontes oficiais; ver README).
Saída: data/fundos/index.json (resumo de todos os fundos) e data/fundos/f/<ug>.json (detalhe de cada fundo em análise).

Escopo: ficam fora da análise, e aparecem numa nota com o motivo, os fundos previdenciários (benefício devido por lei), o Fundo
Estadual de Saúde (aplicação mínima constitucional e transferências do SUS) e os fundos de outros Poderes e de órgãos
autônomos, sobre os quais o Executivo não decide. O Fundo Soberano fica dentro: o Estado pode mudar a política.

Os sinais (fonte dos recursos, natureza da despesa, arrecadação própria contra gasto, restos a pagar) são leituras
automáticas dos dados, com limiares escritos abaixo; não substituem a leitura da lei do fundo.

Uso: python3 -I pipeline/fundos/montar.py
"""
import collections
import json
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "fundos")
SAIDA = os.path.join(RAIZ, "data", "fundos")
ANOS = (2024, 2025, 2026)

FORA = {
    "600210": ("previdenciario", "Fundo previdenciário: paga aposentadorias e pensões devidas por lei; não há margem de alteração."),
    "600211": ("previdenciario", "Fundo previdenciário: paga aposentadorias e pensões devidas por lei; não há margem de alteração."),
    "600212": ("previdenciario", "Fundo previdenciário dos militares: paga proventos e pensões devidos por lei; não há margem de alteração."),
    "440901": ("vinculado", "Fundo da Saúde: aplicação mínima constitucional em saúde e transferências carimbadas do SUS."),
    "30901": ("outro-poder", "Fundo do Poder Judiciário: o Executivo não decide sobre ele."),
    "50902": ("outro-poder", "Fundo do Ministério Público: o Executivo não decide sobre ele."),
    "60901": ("outro-poder", "Fundo da Defensoria Pública: órgão autônomo, o Executivo não decide sobre ele."),
}
ROTULO_GRUPO_FORA = {"previdenciario": "Previdenciários", "vinculado": "Vinculado à saúde", "outro-poder": "Outros Poderes e órgãos autônomos", "sem-movimento": "Sem pagamentos nem arrecadação no período"}
# leitura da margem que o painel não deduz só da fonte dos recursos: ug -> (leitura, nota)
RUBRICA_RENDIMENTO = "1321"     # receita patrimonial: valores mobiliários (rendimento de aplicações e de depósitos)
LEITURA_MANUAL = {
    "220902": ("verificar", "A política de poupança é do próprio Estado e muda por lei complementar (LC 914/2019). Pela lei atual, o Governo só resgata rendimentos depois que a poupança atinge R$ 1 bilhão corrigido, e só reverte saldo ao Tesouro após 15 anos da criação e acima de R$ 2 bilhões."),
}

# fonte de recursos -> grupo (códigos do SIGEFES). Os não listados caem em "outras".
FONTES = {
    "livre": {"500", "501", "502"},
    "federal": {"600", "601", "602", "603", "605", "631", "660", "703", "712", "713", "715", "716"},
    "royalties": {"704", "709", "721"},
    "propria": {"659", "669", "749", "753", "759", "761", "899"},
    "credito": {"634", "754", "755"},
    "prev": {"800", "801", "803"},
}
ROTULO_FONTE = {
    "livre": "Tesouro, sem vinculação",
    "federal": "Transferências federais com finalidade (SUS, FNAS, FSP, Funpen, cultura)",
    "royalties": "Royalties, compensações e cessão onerosa da União",
    "propria": "Receita própria vinculada ao fundo ou a lei",
    "credito": "Operações de crédito e alienação de bens",
    "prev": "Previdenciária",
    "outras": "Outras vinculações",
}
GRUPO_DA_FONTE = {c: g for g, cs in FONTES.items() for c in cs}

ROTULO_NATUREZA = {
    "pessoal": "Pessoal e encargos",
    "custeio": "Custeio, aplicação direta",
    "transf_mun": "Transferências a municípios",
    "transf_priv": "Transferências a instituições privadas",
    "transf_out": "Outras transferências",
    "invest": "Investimentos",
    "inversoes": "Inversões financeiras",
}
PISO_REND = 1_000_000   # rendimento anual mínimo para estimar o saldo aplicado
PISO = 100_000          # abaixo disso (por ano) os sinais de origem e natureza não são calculados
LIMIAR = {"livre": 0.5, "federal": 0.5, "pessoal": 0.5, "flexivel": 0.5, "rap": 0.25, "acumula": 1.2, "abastecido": 0.5}


def leitura(sinais, reversao):
    """Margem aparente, combinando a origem do dinheiro (dados) e o que a lei diz do saldo (cadastro)."""
    carimbado = "federal" in sinais or "royalties" in sinais
    if carimbado:
        return "verificar" if reversao == "permite" else "menos"
    if "tesouro" in sinais or reversao == "permite":
        return "mais"
    if reversao == "nao":
        return "menos"
    return "verificar"


def natureza(gnd, modal):
    if gnd == "1":
        return "pessoal"
    if gnd == "4":
        return "invest"
    if gnd == "5":
        return "inversoes"
    if modal in ("40", "41"):
        return "transf_mun"
    if modal in ("50", "60"):
        return "transf_priv"
    if modal in ("20", "22", "30", "70", "80"):
        return "transf_out"
    return "custeio"


def soma_dict(d, k, v):
    d[k] = d.get(k, 0.0) + v


def carregar(prefixo):
    achados = {}
    for a in ANOS:
        f = os.path.join(CACHE, f"{prefixo}_{a}.json")
        if os.path.exists(f):
            achados[a] = json.load(open(f, encoding="utf-8"))
    return achados


def r2(x):
    return round(x, 2)


def main():
    exe, rec = carregar("exec"), carregar("rec")
    if not exe:
        raise SystemExit("falta .cache/fundos/exec_<ano>.json (rode execucao_fundos.py)")
    selic = json.load(open(os.path.join(RAIZ, "pipeline", "fundos", "selic.json"), encoding="utf-8"))
    cadastro = {}
    pc = os.path.join(RAIZ, "pipeline", "fundos", "cadastro.json")
    if os.path.exists(pc):
        cadastro = {c["ug"]: c for c in json.load(open(pc, encoding="utf-8"))}

    nomes = {}
    for d in list(exe.values()) + list(rec.values()):
        for k, v in d["nomes"].items():
            if k.startswith("ug:"):
                nomes[k[3:].lstrip("0")] = v.strip()
    N = {}
    for d in exe.values():
        N.update(d["nomes"])

    # mês mais recente com pagamento no último ano lido
    ult = max(exe)
    meses_pagos = sorted({r[1] for r in exe[ult]["principal"] if abs(r[8]) + abs(r[9]) > 1})
    ate = meses_pagos[-1] if meses_pagos else f"{ult}-12"

    por = {}      # ug -> estrutura

    def novo_ano():
        return {"emp": 0.0, "liq": 0.0, "pago": 0.0, "rap": 0.0, "nat": {}, "fonte": {}, "fonteDet": {}, "elem": {}, "mes": {}}

    for ano, d in exe.items():
        for ug, mes, gnd, el, fonte, modal, emp, liq, pago, rap, n in d["principal"]:
            if mes > ate:
                continue
            f = por.setdefault(ug, {"anos": {}})
            a = f["anos"].setdefault(ano, novo_ano())
            a["emp"] += emp; a["liq"] += liq; a["pago"] += pago; a["rap"] += rap
            v = pago + rap
            soma_dict(a["nat"], natureza(gnd, modal), v)
            soma_dict(a["fonte"], GRUPO_DA_FONTE.get(fonte, "outras"), v)
            soma_dict(a["fonteDet"], fonte, v)
            soma_dict(a["elem"], (gnd, el), v)
            soma_dict(a["mes"], mes, v)
        for ug, prog, acao, pago, rap in d["programa"]:
            por.setdefault(ug, {"anos": {}}).setdefault("prog", {})
            soma_dict(por[ug]["prog"].setdefault(ano, {}), (prog, acao), pago + rap)
        for ug, tf, doc, nome, pago, rap in d["favorecido"]:
            por.setdefault(ug, {"anos": {}}).setdefault("fav", {})
            soma_dict(por[ug]["fav"].setdefault(ano, {}), (tf, nome), pago + rap)
    for ano, d in rec.items():
        for ug, mes, origem, rubrica, fonte, prev, arrec in d["linhas"]:
            if f"{ano}-{int(mes):02d}" > ate:
                continue
            ug = ug.lstrip("0")                    # a base de receitas completa o código com zeros à esquerda
            f = por.setdefault(ug, {"anos": {}})
            f["anos"].setdefault(ano, novo_ano())
            f.setdefault("rec", {}).setdefault(ano, {"arrec": 0.0, "prev": 0.0, "orig": {}, "rub": {}})
            r = f["rec"][ano]
            r["arrec"] += arrec; r["prev"] += prev
            soma_dict(r["orig"], origem, arrec)
            soma_dict(r["rub"], rubrica, arrec)

    resumo, fora = [], []
    os.makedirs(os.path.join(SAIDA, "f"), exist_ok=True)
    for ug in sorted(por):
        f = por[ug]
        nome = nomes.get(ug, ug)
        tot = {a: r2(v["pago"] + v["rap"]) for a, v in f["anos"].items()}
        if ug in FORA:
            grupo, motivo = FORA[ug]
            fora.append({"ug": ug, "nome": nome, "grupo": grupo, "motivo": motivo, "total": tot})
            continue
        recebeu = any(abs(r["arrec"]) >= 1 for r in f.get("rec", {}).values())
        if sum(tot.values()) < 1 and not recebeu:
            fora.append({"ug": ug, "nome": nome, "grupo": "sem-movimento", "motivo": "Sem pagamentos nem arrecadação de 2024 a 2026.", "total": tot})
            continue
        anos_out, det_anos = {}, {}
        for ano, v in sorted(f["anos"].items()):
            t = v["pago"] + v["rap"]
            anos_out[str(ano)] = {
                "emp": r2(v["emp"]), "liq": r2(v["liq"]), "pago": r2(v["pago"]), "rap": r2(v["rap"]), "total": r2(t),
                "nat": {k: r2(x) for k, x in sorted(v["nat"].items())},
                "fonte": {k: r2(x) for k, x in sorted(v["fonte"].items())},
            }
            if ano in f.get("rec", {}):
                r = f["rec"][ano]
                anos_out[str(ano)]["rec"] = {"arrec": r2(r["arrec"]), "prev": r2(r["prev"]), "rend": r2(r["rub"].get(RUBRICA_RENDIMENTO, 0.0))}
            # detalhe para onde foi o dinheiro: favorecidos (empresas e órgãos), ações e o resto
            fav = sorted(((k, x) for k, x in f.get("fav", {}).get(ano, {}).items() if x > 0.5), key=lambda kv: -kv[1])
            acoes = sorted(((k, x) for k, x in f.get("prog", {}).get(ano, {}).items() if x > 0.5), key=lambda kv: -kv[1])
            det_anos[str(ano)] = {
                "total": r2(t), "pago": r2(v["pago"]), "rap": r2(v["rap"]),
                "fav": [[("Órgão ou entidade" if tf == "3" else "Empresa"), nm, r2(x)] for (tf, nm), x in fav[:30]],
                "favResto": {"n": max(0, len(fav) - 30), "valor": r2(sum(x for _, x in fav[30:]))},
                "pf": r2(max(0.0, t - sum(x for _, x in fav))),
                "acao": [[N.get("pg:" + p_, p_), N.get(f"ac:{ug}:{a_}", a_), r2(x)] for (p_, a_), x in acoes[:15]],
                "acaoResto": r2(sum(x for _, x in acoes[15:])),
                "rec": anos_out[str(ano)].get("rec"),
            }
        # sinais, lidos nos dois últimos períodos: o último ano completo (ult-1) e o ano corrente até o mês
        base = anos_out.get(str(ult - 1)) or anos_out.get(str(ult))
        atual = anos_out.get(str(ult))
        ref = base if base and (base["total"] > 0 or ((base.get("rec") or {}).get("arrec") or 0) >= PISO) else atual
        sinais = []
        if ref and ref["total"] >= PISO:
            t = ref["total"]
            livre = ref["fonte"].get("livre", 0) / t
            fed = (ref["fonte"].get("federal", 0)) / t
            prop = (ref["fonte"].get("propria", 0)) / t
            roy = (ref["fonte"].get("royalties", 0)) / t
            pessoal = ref["nat"].get("pessoal", 0) / t
            flex = (ref["nat"].get("invest", 0) + ref["nat"].get("inversoes", 0) + ref["nat"].get("transf_mun", 0) + ref["nat"].get("transf_priv", 0) + ref["nat"].get("transf_out", 0)) / t
            rapp = ref["rap"] / t if t else 0
            if livre >= LIMIAR["livre"]:
                sinais.append("tesouro")
            if fed >= LIMIAR["federal"]:
                sinais.append("federal")
            if roy >= LIMIAR["federal"]:
                sinais.append("royalties")
            if prop >= LIMIAR["federal"]:
                sinais.append("propria")
            if pessoal >= LIMIAR["pessoal"]:
                sinais.append("pessoal")
            if flex >= LIMIAR["flexivel"]:
                sinais.append("flexivel")
            if rapp >= LIMIAR["rap"]:
                sinais.append("rap")
        if ref:
            t = ref["total"]
            rr = (ref.get("rec") or {}).get("arrec")
            if rr is not None:
                if rr >= max(PISO, LIMIAR["acumula"] * t):
                    sinais.append("acumula")
                elif t >= PISO and rr <= LIMIAR["abastecido"] * t:
                    sinais.append("abastecido")
        cad = cadastro.get(ug, {})
        item = {"ug": ug, "nome": nome, "anos": {a: {"total": v["total"], "pago": v["pago"], "rap": v["rap"], "emp": v["emp"], "fonte": v["fonte"], "nat": v["nat"],
                                                         "arrec": (v.get("rec") or {}).get("arrec")} for a, v in anos_out.items()},
                "sinais": sinais, "ref": str(ult - 1) if base and ref is base else str(ult)}
        for k in ("leiCriacao", "nomeOficial", "sigla", "reversao"):
            if cad.get(k):
                item[k] = cad[k]
        item["leitura"] = leitura(sinais, cad.get("reversao"))
        item["cadastro"] = bool(cad)
        refa = anos_out.get(item["ref"]) or {}
        rend = (refa.get("rec") or {}).get("rend", 0)
        taxa = selic["media"].get(item["ref"])
        if rend >= PISO_REND and taxa:
            item["implicito"] = {"ano": item["ref"], "rend": r2(rend), "taxa": taxa, "valor": r2(rend / (taxa / 100))}
        if ug in LEITURA_MANUAL:
            item["leitura"], item["leituraNota"] = LEITURA_MANUAL[ug]
        resumo.append(item)
        det = {"ug": ug, "nome": nome, "anos": det_anos, "cadastro": cad or None}
        with open(os.path.join(SAIDA, "f", f"{ug}.json"), "w", encoding="utf-8") as fh:
            json.dump(det, fh, ensure_ascii=False, separators=(",", ":"))
    resumo.sort(key=lambda x: -(x["anos"].get(x["ref"], {}).get("total", 0)))

    validacao = []
    for sl in json.load(open(os.path.join(RAIZ, "pipeline", "fundos", "saldos.json"), encoding="utf-8")):
        it = next((x for x in resumo if x["ug"] == sl["ug"]), None)
        if it and it.get("implicito") and sl.get("anterior"):
            validacao.append({"ug": sl["ug"], "sigla": sl.get("sigla", ""), "ano": it["implicito"]["ano"], "estimado": it["implicito"]["valor"], "real": sl["anterior"]["valor"],
                              "data": sl["anterior"]["data"], "razao": round(it["implicito"]["valor"] / sl["anterior"]["valor"], 2)})
    saida = {
        "validacaoImplicito": validacao, "selic": selic["media"],
        "ate": ate, "anos": [str(a) for a in sorted(exe)], "anoCorrente": str(ult),
        "fontes": ROTULO_FONTE, "naturezas": ROTULO_NATUREZA, "limiares": LIMIAR,
        "fundos": resumo, "fora": fora, "rotuloFora": ROTULO_GRUPO_FORA,
        "caixaRGF": json.load(open(os.path.join(RAIZ, "pipeline", "fundos", "rgf.json"), encoding="utf-8")),
        "saldos": json.load(open(os.path.join(RAIZ, "pipeline", "fundos", "saldos.json"), encoding="utf-8")),
        "fonteDados": "SIGEFES: despesas e receitas do Portal da Transparência do ES; valor = pago + restos a pagar pagos",
    }
    with open(os.path.join(SAIDA, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, separators=(",", ":"))
    tot_esc = sum(x["anos"].get(str(ult - 1), {}).get("total", 0) for x in resumo)
    tot_fora = sum(x["total"].get(ult - 1, 0) for x in fora)
    print(f"{len(resumo)} fundos em análise (R$ {tot_esc / 1e6:,.1f} mi em {ult - 1}); {len(fora)} fora do escopo (R$ {tot_fora / 1e6:,.1f} mi); dados até {ate}")


if __name__ == "__main__":
    main()
