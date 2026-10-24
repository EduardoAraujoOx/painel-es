#!/usr/bin/env python3
"""Calcula os três indicadores da CAPAG do Espírito Santo (Portaria Normativa MF 1.583/2023, art. 2º a 4º) a partir do
que pipeline/capag/coletar.py guardou em .cache/capag, e grava data/capag/indicadores.json.

Regras codificadas (texto da portaria republicada no DOU de 15/12/2023):
  Endividamento  DC = Dívida Consolidada Bruta / Receita Corrente Líquida          A < 60%; B de 60% a 100%; C >= 100%
  Poupança corrente  PC = soma de (Despesa Corrente_t / Receita Corrente Ajustada_t) x P_t  nos três últimos exercícios
                 encerrados, com pesos 0,50 (t-1), 0,30 (t-2) e 0,20 (t-3)          A < 85%; B de 85% a 95%; C >= 95%
  Liquidez relativa  LR = (Disponibilidade de Caixa Bruta - Obrigações Financeiras) / RCL, só fontes não vinculadas,
                 menos as insuficiências de caixa das fontes vinculadas             A >= 5%; B entre 0 e 5%; C <= 0
  Nota final     tabela do art. 4º (combinação das três notas parciais); A ou B com "Aicf" no ranking de qualidade da
                 informação contábil e fiscal do Siconfi sobe para A+ ou B+ (o ranking não é calculado aqui).

Aproximações, todas declaradas no arquivo de saída (campo "metodologia"):
  - DC lê a Dívida Consolidada (I) e a RCL do RGF do Poder Executivo, 3º quadrimestre.
  - Despesa corrente = despesas correntes empenhadas do RREO (anexo 01, 6º bimestre, com intraorçamentárias), menos as
    transferências a municípios (elementos 3.3.40, 3.3.41 e 3.3.42) lidas na DCA (anexo I-D).
  - Receita corrente ajustada = receitas correntes do RREO (anexo 01, 6º bimestre, com intraorçamentárias), que já vêm
    líquidas dos repasses constitucionais a municípios e da formação do Fundeb e incluem o Fundeb recebido.
  - Obrigações financeiras = restos a pagar liquidados e não pagos (do exercício e anteriores) e restos a pagar não
    liquidados de exercícios anteriores. A variante com "demais obrigações financeiras" sai à parte (campo lr_com_demais).
Estas definições devem ser conferidas contra os valores que o Tesouro Nacional divulga (conjunto "CAPAG Estados" do
Tesouro Transparente) antes de qualquer conclusão; a portaria 1.764/2024 alterou a 1.583/2023 e seu texto não foi lido.

Uso: python3 -I pipeline/capag/montar.py
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "capag")
SAIDA = os.path.join(RAIZ, "data", "capag")

PESOS = (0.50, 0.30, 0.20)  # t-1, t-2, t-3
TRANSF_MUNICIPIOS = ("3.3.40.", "3.3.41.", "3.3.42.")  # elementos de despesa (DCA I-D)
PAIS_VINCULADOS = {  # linhas do anexo 05 do RGF que só somam as filhas (não entram como fonte)
    "Recursos Vinculados à Educação", "Recursos Vinculados à Saúde",
    "Demais Vinculações Decorrentes de Transferências", "Demais Vinculações Legais",
}
TABELA_FINAL = {  # (endividamento, poupança corrente, liquidez relativa) -> nota final; o resto é C
    ("A", "A", "A"): "A", ("A", "B", "A"): "A", ("A", "A", "B"): "A",
    ("B", "A", "A"): "B", ("C", "A", "A"): "B", ("B", "B", "A"): "B", ("C", "B", "A"): "B",
    ("B", "A", "B"): "B", ("C", "A", "B"): "B", ("A", "B", "B"): "B", ("B", "B", "B"): "B", ("C", "B", "B"): "B",
    ("C", "C", "C"): "D",
}


def nota_dc(x):
    return None if x is None else "A" if x < 0.60 else "B" if x < 1.00 else "C"


def nota_pc(x):
    return None if x is None else "A" if x < 0.85 else "B" if x < 0.95 else "C"


def nota_lr(x):
    return None if x is None else "A" if x >= 0.05 else "B" if x > 0 else "C"


def nota_final(dc, pc, lr):
    if None in (dc, pc, lr):
        return None
    return TABELA_FINAL.get((dc, pc, lr), "C")


_memo = {}


def carregar(nome):
    if nome not in _memo:
        caminho = os.path.join(CACHE, nome + ".json")
        _memo[nome] = json.load(open(caminho, encoding="utf-8")) if os.path.exists(caminho) else []
    return _memo[nome]


def pegar(linhas, anexo, conta=None, coluna=None, cod_conta=None, prefixo=True):
    """Valor da primeira linha do anexo que casa com conta (início do texto) e coluna (início do texto)."""
    for x in linhas:
        if x["anexo"] != anexo:
            continue
        if cod_conta is not None and x["cod_conta"] != cod_conta:
            continue
        if conta is not None and not (x["conta"].startswith(conta) if prefixo else x["conta"] == conta):
            continue
        if coluna is not None and not x["coluna"].startswith(coluna):
            continue
        return x["valor"]
    return None


def endividamento(ano, avisos):
    rgf = carregar(f"rgf_{ano}_3")
    col = "Até o 3º Quadrimestre"
    dc = pegar(rgf, "RGF-Anexo 02", "DÍVIDA CONSOLIDADA - DC", col)
    rcl = pegar(rgf, "RGF-Anexo 02", "RECEITA CORRENTE LÍQUIDA - RCL", col)
    if dc is None or rcl is None:
        avisos.append(f"{ano}: dívida consolidada ou RCL não encontradas no RGF")
        return {"dc_bruta": dc, "rcl": rcl, "dc_rcl": None}
    return {"dc_bruta": dc, "rcl": rcl, "dc_rcl": dc / rcl}


def razao_poupanca(ano, avisos):
    rreo = carregar(f"rreo_{ano}_6")
    rec = (pegar(rreo, "RREO-Anexo 01", cod_conta="ReceitasCorrentes", coluna="Até o Bimestre") or 0) + \
          (pegar(rreo, "RREO-Anexo 01", cod_conta="ReceitasCorrentesIntra", coluna="Até o Bimestre") or 0)
    desp = (pegar(rreo, "RREO-Anexo 01", cod_conta="DespesasCorrentes", coluna="DESPESAS EMPENHADAS ATÉ") or 0) + \
           (pegar(rreo, "RREO-Anexo 01", cod_conta="DespesasCorrentesIntra", coluna="DESPESAS EMPENHADAS ATÉ") or 0)
    transf = 0.0
    for x in carregar(f"dca_{ano}"):
        if x["anexo"] == "DCA-Anexo I-D" and x["coluna"] == "Despesas Empenhadas" and x["conta"].startswith(TRANSF_MUNICIPIOS):
            transf += x["valor"]
    if not rec or not desp:
        avisos.append(f"{ano}: receita ou despesa corrente não encontrada no RREO do 6º bimestre")
        return {"receita_corrente_ajustada": rec or None, "despesa_corrente": desp or None, "transferencias_municipios": transf, "razao": None}
    if not transf:
        avisos.append(f"{ano}: transferências a municípios não encontradas na DCA (despesa corrente não ajustada)")
    dc_ajustada = desp - transf
    return {"receita_corrente_ajustada": rec, "despesa_corrente": desp, "transferencias_municipios": transf,
            "despesa_corrente_ajustada": dc_ajustada, "razao": dc_ajustada / rec}


def liquidez(ano, avisos):
    rgf = [x for x in carregar(f"rgf_{ano}_3") if x["anexo"] == "RGF-Anexo 05"]
    rcl = pegar(carregar(f"rgf_{ano}_3"), "RGF-Anexo 02", "RECEITA CORRENTE LÍQUIDA - RCL", "Até o 3º Quadrimestre")
    if not rgf or not rcl:
        avisos.append(f"{ano}: anexo 05 do RGF ou RCL ausentes")
        return {"lr": None}
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
    def v(conta, k):
        return tabela.get(conta, {}).get(k, 0.0)
    nv = next((c for c in ordem if c.startswith("TOTAL DOS RECURSOS NÃO VINCULADOS")), None)
    ini = next((i for i, c in enumerate(ordem) if c.startswith("TOTAL DOS RECURSOS VINCULADOS (EXCETO AO RPPS)")), None)
    fim = next((i for i, c in enumerate(ordem) if c.startswith("TOTAL DOS RECURSOS VINCULADOS AO RPPS")), None)
    if nv is None or ini is None or fim is None:
        avisos.append(f"{ano}: estrutura do anexo 05 do RGF não reconhecida")
        return {"lr": None}
    caixa_nv = v(nv, "a")
    of_estrita = v(nv, "b") + v(nv, "c") + v(nv, "d")
    of_com_demais = of_estrita + v(nv, "e")
    insuf, fontes = 0.0, []
    for conta in ordem[ini + 1:fim]:
        if conta in PAIS_VINCULADOS:
            continue
        t = tabela[conta]
        liquida = t["g"] if "g" in t else t.get("a", 0.0) - (t.get("b", 0.0) + t.get("c", 0.0) + t.get("d", 0.0) + t.get("e", 0.0))
        if liquida < 0:
            insuf += -liquida
            fontes.append({"fonte": conta, "insuficiencia": -liquida})
    lr = (caixa_nv - of_estrita - insuf) / rcl
    lr_demais = (caixa_nv - of_com_demais - insuf) / rcl
    return {"caixa_bruta_nao_vinculada": caixa_nv, "obrigacoes_financeiras_nao_vinculadas": of_estrita,
            "demais_obrigacoes_nao_vinculadas": v(nv, "e"), "insuficiencias_fontes_vinculadas": insuf,
            "fontes_com_insuficiencia": fontes, "rcl": rcl, "lr": lr, "lr_com_demais": lr_demais}


def main():
    anos = sorted(int(f[:-5].split("_")[1]) for f in os.listdir(CACHE) if f.startswith("dca_") and carregar(f[:-5]))
    avisos, razoes, saida = [], {}, []
    for ano in anos:
        razoes[ano] = razao_poupanca(ano, avisos)
    for ano in anos:
        dc = endividamento(ano, avisos)
        lr = liquidez(ano, avisos)
        base = [razoes.get(ano - i) for i in range(3)]
        if all(b and b["razao"] is not None for b in base):
            pc = sum(b["razao"] * p for b, p in zip(base, PESOS))
        else:
            pc = None
        notas = {"endividamento": nota_dc(dc["dc_rcl"]), "poupanca_corrente": nota_pc(pc), "liquidez_relativa": nota_lr(lr["lr"])}
        saida.append({
            "exercicio_base": ano,
            "nota_divulgada_em": ano + 1,
            "endividamento": dc,
            "poupanca_corrente": {"pc": pc, "razoes": {str(ano - i): (razoes.get(ano - i) or {}).get("razao") for i in range(3)}, "componentes": razoes.get(ano)},
            "liquidez": lr,
            "notas_parciais": notas,
            "nota_final": nota_final(notas["endividamento"], notas["poupanca_corrente"], notas["liquidez_relativa"]),
        })
    os.makedirs(SAIDA, exist_ok=True)
    doc = {
        "gerado_de": "Siconfi (RREO, RGF e DCA do Espírito Santo), via pipeline/capag/coletar.py",
        "regra": "Portaria Normativa MF 1.583/2023, arts. 2º a 4º (faixas e tabela final); A+ depende do ranking ICF, não calculado aqui",
        "metodologia": __doc__,
        "avisos": avisos,
        "exercicios": saida,
    }
    with open(os.path.join(SAIDA, "indicadores.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    def pct(x):
        return "   n/d" if x is None else f"{x * 100:6.1f}%"
    print("exercício |   DC/RCL  nota |     PC  nota |     LR  nota | (LR c/ demais) | final")
    for s in saida:
        n = s["notas_parciais"]
        print(f"   {s['exercicio_base']}   | {pct(s['endividamento']['dc_rcl'])}  {n['endividamento'] or '-'}   | {pct(s['poupanca_corrente']['pc'])}  {n['poupanca_corrente'] or '-'}  | "
              f"{pct(s['liquidez'].get('lr'))}  {n['liquidez_relativa'] or '-'}  | {pct(s['liquidez'].get('lr_com_demais'))}        | {s['nota_final'] or '-'}")
    for a in avisos:
        print("aviso:", a, file=sys.stderr)


if __name__ == "__main__":
    main()
