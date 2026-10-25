#!/usr/bin/env python3
"""Reconstrói, ano a ano, como o caixa livre do Poder Executivo do Espírito Santo foi formado, a partir do que
pipeline/capag/coletar.py guardou em .cache/capag, e grava data/capag/historico_caixa.json.

Para cada exercício de 2018 a 2025 reúne:
  - caixa livre comparável: caixa bruto das fontes não vinculadas, menos obrigações financeiras dessas fontes (restos a pagar
    liquidados e não pagos e restos não liquidados de anos anteriores), menos as insuficiências de caixa das fontes
    vinculadas (exceto previdência própria). É a mesma definição de montar.py. Antes de 2023 o Tesouro Nacional não usava
    esse indicador e a classificação de fontes era outra, de modo que a série serve para ler a trajetória, não para conferir nota.
  - resultado primário realizado (sem regime próprio de previdência), meta fixada na lei de diretrizes orçamentárias,
    execução da dotação (empenhado, liquidado e pago em relação à dotação atualizada), juros líquidos, operações de crédito,
    amortização da dívida, dívida consolidada e receita corrente líquida.

Uso: python3 -I pipeline/capag/historico.py
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "capag")
SAIDA = os.path.join(RAIZ, "data", "capag", "historico_caixa.json")

_memo = {}


def carregar(nome):
    if nome not in _memo:
        caminho = os.path.join(CACHE, nome + ".json")
        _memo[nome] = json.load(open(caminho, encoding="utf-8")) if os.path.exists(caminho) else []
    return _memo[nome]


def valor(linhas, anexo, conta, coluna):
    """Primeira linha do anexo cuja conta e coluna começam com os textos dados."""
    for x in linhas:
        if x["anexo"] == anexo and x["conta"].startswith(conta) and x["coluna"].startswith(coluna):
            return x["valor"]
    return None


def caixa_livre(ano, avisos):
    rgf = [x for x in carregar(f"rgf_{ano}_3") if x["anexo"] == "RGF-Anexo 05"]
    if not rgf:
        avisos.append(f"{ano}: anexo 05 do RGF ausente")
        return None
    cols = {"a": "DISPONIBILIDADE DE CAIXA BRUTA", "b": "De Exercícios Anteriores (b)", "c": "Do Exercício (c)",
            "d": "Restos a Pagar Empenhados e Não Liquidados de Exercícios Anteriores (d)",
            "e": "Demais Obrigações Financeiras (e)", "g": "DISPONIBILIDADE DE CAIXA LÍQUIDA (ANTES"}
    tabela, ordem = {}, []
    for x in rgf:
        for k, pref in cols.items():
            if x["coluna"].startswith(pref):
                if x["conta"] not in tabela:
                    tabela[x["conta"]] = {}
                    ordem.append(x["conta"])
                tabela[x["conta"]][k] = x["valor"] or 0.0
    nv = next((c for c in ordem if c.startswith("TOTAL DOS RECURSOS NÃO VINCULADOS")), None)
    ini = next((i for i, c in enumerate(ordem) if c.startswith("TOTAL DOS RECURSOS VINCULADOS")), None)
    fim = next((i for i, c in enumerate(ordem) if c.startswith("TOTAL (III)") or c.startswith("TOTAL DOS RECURSOS VINCULADOS AO RPPS")), None)
    if nv is None or ini is None or fim is None:
        avisos.append(f"{ano}: estrutura do anexo 05 não reconhecida")
        return None
    pais = ("Recursos Vinculados à Educação", "Recursos Vinculados à Saúde", "Demais Vinculações Decorrentes de Transferências", "Demais Vinculações Legais")
    caixa = tabela[nv].get("a", 0.0)
    obrig = tabela[nv].get("b", 0.0) + tabela[nv].get("c", 0.0) + tabela[nv].get("d", 0.0)
    insuf = 0.0
    for conta in ordem[ini + 1:fim]:
        if conta in pais or "RPPS" in conta:
            continue
        t = tabela[conta]
        liquida = t["g"] if "g" in t else t.get("a", 0.0) - (t.get("b", 0.0) + t.get("c", 0.0) + t.get("d", 0.0) + t.get("e", 0.0))
        if liquida < 0:
            insuf += -liquida
    return {"caixa_bruta_nv": caixa, "obrigacoes_nv": obrig, "insuficiencias_vinculadas": insuf, "caixa_livre": caixa - obrig - insuf}


def achar(linhas, anexo, prefixos, colunas, contem=None, sem=None):
    """Primeiro valor do anexo cuja conta começa por um dos prefixos (e contém/não contém os textos pedidos) e cuja coluna
    começa por uma das colunas. Os dois layouts do anexo 06 do RREO (antes e depois de 2023) usam nomes diferentes."""
    for x in linhas:
        if x["anexo"] != anexo or not x["conta"].startswith(tuple(prefixos)) or not x["coluna"].startswith(tuple(colunas)):
            continue
        if contem and contem not in x["conta"]:
            continue
        if sem and sem in x["conta"]:
            continue
        return x["valor"]
    return None


def execucao(ano, avisos, bim=6):
    rreo = carregar(f"rreo_{ano}_{bim}")
    an = "RREO-Anexo 06"
    if not rreo:
        avisos.append(f"{ano}: RREO do {bim}º bimestre ausente")
        return {}
    novo = any(x["anexo"] == an and "EXCETO FONTES RPPS" in x["conta"] for x in rreo)  # layout a partir de 2023
    out = {
        "base_sem_rpps": novo,
        "receita_primaria": achar(rreo, an, ["RECEITA PRIMÁRIA TOTAL"], ["RECEITAS REALIZADAS"], contem="EXCETO FONTES RPPS" if novo else None),
        "dotacao_primaria": achar(rreo, an, ["DESPESA PRIMÁRIA TOTAL"], ["DOTAÇÃO ATUALIZADA"], contem="EXCETO FONTES RPPS" if novo else None),
        "despesa_primaria_empenhada": achar(rreo, an, ["DESPESA PRIMÁRIA TOTAL"], ["DESPESAS EMPENHADAS"], contem="EXCETO FONTES RPPS" if novo else None),
        "despesa_primaria_liquidada": achar(rreo, an, ["DESPESA PRIMÁRIA TOTAL"], ["DESPESAS LIQUIDADAS"], contem="EXCETO FONTES RPPS" if novo else None),
        "despesa_primaria_paga": achar(rreo, an, ["DESPESA PRIMÁRIA TOTAL"], ["DESPESAS PAGAS"], contem="EXCETO FONTES RPPS" if novo else None),
        "resultado_primario": achar(rreo, an, ["RESULTADO PRIMÁRIO (SEM RPPS) - Acima" if novo else "RESULTADO PRIMÁRIO - Acima da Linha"], ["VALOR"]),
        "juros_ativos": achar(rreo, an, ["Juros, Encargos e Variações Monetárias Ativos"], ["VALOR"]),
        "juros_passivos": achar(rreo, an, ["Juros, Encargos e Variações Monetárias Passivos"], ["VALOR"]),
        "operacoes_credito": achar(rreo, an, ["Operações de Crédito (VIII)", "Operações de Crédito (VI)"], ["RECEITAS REALIZADAS"]),
        "amortizacao_divida": achar(rreo, an, ["Amortização da Dívida"], ["DESPESAS PAGAS"]),
        "superavit_financeiro_previsto": achar(rreo, an, ["Superávit Financeiro Utilizado"], ["PREVISÃO ORÇAMENTÁRIA"]),
        "meta_resultado_primario": None,
        "meta_resultado_nominal": None,
    }
    for x in rreo:
        if x["anexo"] == an and x["conta"].startswith("Meta fixada"):
            if "ResultadoPrimario" in x["cod_conta"]:
                out["meta_resultado_primario"] = x["valor"]
            elif "ResultadoNominal" in x["cod_conta"]:
                out["meta_resultado_nominal"] = x["valor"]
    return out


def parcial_2026(avisos):
    """O que já se sabe de 2026: receita corrente líquida de 12 meses, resultado primário até o 4º bimestre e meta da lei de diretrizes."""
    rgf2 = carregar("rgf_2026_2")
    rcl_ago = valor(rgf2, "RGF-Anexo 02", "RECEITA CORRENTE LÍQUIDA - RCL", "Até o 2º Quadrimestre")
    rreo3 = carregar("rreo_2026_3")
    meses = [x["valor"] for x in rreo3 if x["anexo"] == "RREO-Anexo 03" and x["conta"].startswith("RECEITA CORRENTE LÍQUIDA (III)") and x["coluna"].startswith("<MR")]
    rcl_jun = sum(meses) if len(meses) == 12 else None
    if rcl_jun is None:
        avisos.append("2026: RCL de 12 meses até junho não encontrada no RREO do 3º bimestre")
    e26, e25 = execucao(2026, avisos, 4), execucao(2025, avisos, 4)
    out = {"rcl_12m_agosto": rcl_ago, "rcl_12m_junho": rcl_jun, "resultado_primario_ate_agosto": e26.get("resultado_primario"),
           "resultado_primario_ate_agosto_2025": e25.get("resultado_primario"), "meta_resultado_primario": e26.get("meta_resultado_primario"),
           "receita_primaria_ate_agosto": e26.get("receita_primaria"), "despesa_primaria_paga_ate_agosto": e26.get("despesa_primaria_paga")}
    out.update(fechamento_2026(avisos))
    return out


def rcl_mensal(nome):
    """Os 12 valores mensais da RCL do anexo 3 do RREO (do mais antigo, <MR-11>, ao mais recente, <MR>)."""
    linhas = [x for x in carregar(nome) if x["anexo"] == "RREO-Anexo 03" and x["conta"].startswith("RECEITA CORRENTE LÍQUIDA (III)")
              and x["coluna"].startswith("<MR")]
    mapa = {x["coluna"]: x["valor"] for x in linhas}
    chaves = ["<MR-%d>" % k for k in range(11, 0, -1)] + ["<MR>"]
    return [mapa.get(k) for k in chaves] if all(mapa.get(k) is not None for k in chaves) else None


def corrente_ate_bimestre(nome):
    """Receitas correntes e despesas correntes empenhadas (com intraorçamentárias), acumuladas até o bimestre do RREO."""
    r = carregar(nome)
    def pegar(cod, col):
        for x in r:
            if x["anexo"] == "RREO-Anexo 01" and x["cod_conta"] == cod and x["coluna"].startswith(col):
                return x["valor"] or 0.0
        return 0.0
    rec = pegar("ReceitasCorrentes", "Até o Bimestre") + pegar("ReceitasCorrentesIntra", "Até o Bimestre")
    des = pegar("DespesasCorrentes", "DESPESAS EMPENHADAS ATÉ") + pegar("DespesasCorrentesIntra", "DESPESAS EMPENHADAS ATÉ")
    return rec, des


def fechamento_2026(avisos):
    """Insumos para estimar o fechamento de 2026: o que já foi arrecadado e empenhado até agosto contra o mesmo período de 2025,
    e o que 2025 fez de setembro a dezembro (a base que a projeção faz crescer)."""
    m26, m25_ago, m25_dez = rcl_mensal("rreo_2026_4"), rcl_mensal("rreo_2025_4"), rcl_mensal("rreo_2025_6")
    if not (m26 and m25_ago and m25_dez):
        avisos.append("2026: série mensal da RCL incompleta; fechamento de 2026 não estimado")
        return {}
    rec26, des26 = corrente_ate_bimestre("rreo_2026_4")
    rec25, des25 = corrente_ate_bimestre("rreo_2025_4")
    rec25a, des25a = corrente_ate_bimestre("rreo_2025_6")
    div26 = valor(carregar("rgf_2026_2"), "RGF-Anexo 02", "DÍVIDA CONSOLIDADA - DC (I)", "Até o 2º Quadrimestre")
    return {
        "rcl_jan_ago_2026": sum(m26[4:]), "rcl_jan_ago_2025": sum(m25_ago[4:]), "rcl_set_dez_2025": sum(m25_dez[8:]),
        "receita_corrente_ate_ago_2026": rec26, "receita_corrente_ate_ago_2025": rec25, "receita_corrente_2025": rec25a,
        "despesa_corrente_ate_ago_2026": des26, "despesa_corrente_ate_ago_2025": des25, "despesa_corrente_2025": des25a,
        "divida_consolidada_ago_2026": div26,
    }


def main():
    avisos, saida = [], []
    for ano in range(2018, 2026):
        rgf = carregar(f"rgf_{ano}_3")
        rcl = valor(rgf, "RGF-Anexo 02", "RECEITA CORRENTE LÍQUIDA - RCL", "Até o 3º Quadrimestre")
        dc = valor(rgf, "RGF-Anexo 02", "DÍVIDA CONSOLIDADA - DC", "Até o 3º Quadrimestre")
        cx = caixa_livre(ano, avisos) or {}
        ex = execucao(ano, avisos)
        linha = {"ano": ano, "rcl": rcl, "divida_consolidada": dc}
        linha.update(cx)
        linha.update(ex)
        if cx and rcl:
            linha["caixa_livre_rcl"] = cx["caixa_livre"] / rcl
        saida.append(linha)
    for i, l in enumerate(saida):
        if i and "caixa_livre" in l and "caixa_livre" in saida[i - 1]:
            l["variacao_caixa_livre"] = l["caixa_livre"] - saida[i - 1]["caixa_livre"]
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump({"gerado_de": "Siconfi (RREO e RGF do Espírito Santo), via pipeline/capag/coletar.py", "metodologia": __doc__,
                   "avisos": avisos, "parcial_2026": parcial_2026(avisos), "exercicios": saida}, f, ensure_ascii=False, indent=1)

    def bi(x):
        return "    n/d" if x is None else f"{x / 1e9:7.2f}"

    def pc(x):
        return "   n/d" if x is None else f"{x * 100:6.1f}"
    print("ano |   RCL  | caixaNV | obrigNV | insufV | CXLIVRE | %RCL | ΔCXLIVRE | rec.prim | desp.empen | desp.liq | desp.paga | dotação | res.prim | meta.prim | juros liq | op.créd | amort | DC")
    for l in saida:
        juros = None if l.get("juros_passivos") is None or l.get("juros_ativos") is None else l["juros_passivos"] - l["juros_ativos"]
        print(f"{l['ano']} |{bi(l['rcl'])} |{bi(l.get('caixa_bruta_nv'))} |{bi(l.get('obrigacoes_nv'))} |{bi(l.get('insuficiencias_vinculadas'))} |{bi(l.get('caixa_livre'))} |{pc(l.get('caixa_livre_rcl'))} |{bi(l.get('variacao_caixa_livre'))} |"
              f"{bi(l.get('receita_primaria'))} |{bi(l.get('despesa_primaria_empenhada'))} |{bi(l.get('despesa_primaria_liquidada'))} |{bi(l.get('despesa_primaria_paga'))} |{bi(l.get('dotacao_primaria'))} |"
              f"{bi(l.get('resultado_primario'))} |{bi(l.get('meta_resultado_primario'))} |{bi(juros)} |{bi(l.get('operacoes_credito'))} |{bi(l.get('amortizacao_divida'))} |{bi(l['divida_consolidada'])}")
    for a in avisos:
        print("aviso:", a, file=sys.stderr)


if __name__ == "__main__":
    main()
