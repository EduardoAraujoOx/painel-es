#!/usr/bin/env python3
"""Resume a execução dos cinco Poderes (Assembleia, Tribunal de Contas, Judiciário, Ministério Público e Defensoria, com seus fundos)
a partir do microdado do Sigefes publicado no portal de dados abertos do Estado (Despesas-<ano>.csv).

Mede o que importa para o diagnóstico de sustentabilidade fiscal: quanto os Poderes pagam com recursos não vinculados (fontes 500 e 501,
as mesmas que financiam o limite da LDO; nos exercícios de 2021 e 2022, a fonte correspondente da classificação anterior) e quanto o Estado
paga e empenha em emendas parlamentares (campo Emenda). O ano em curso é comparado com o mesmo dia do ano anterior, para não comparar um
ano incompleto com um ano fechado, e anualizado pelo perfil do ano anterior. Também guarda a série anual de 2021 em diante.

Lê os arquivos em fluxo (1,2 a 1,5 GB cada) e agrega durante a leitura; leva de 5 a 15 minutos conforme a rede.
Saída: data/capag/sigefes_poderes.json.

Uso: python3 -I pipeline/capag/sigefes_poderes.py [ano_corrente]
     python3 -I pipeline/capag/sigefes_poderes.py --agregados <pasta com agreg_<ano>.json, de 2021 ao ano corrente>   (reaproveita agregados já lidos)
"""
import collections
import csv
import datetime
import json
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESTINO = os.path.join(RAIZ, "data", "capag", "sigefes_poderes.json")
BASE = "https://dados.es.gov.br/dataset/99e16b13-0e6f-4504-8544-00de842ab1fd/resource/"
RECURSOS = {  # Despesas-<ano>.csv no portal de dados abertos do Estado
    2021: "3f0d341b-7c09-4b4a-83b1-bdf5ae26ec13/download/despesas-2021.csv",
    2022: "2dddb456-5481-43f7-ab09-5b0a0faa784f/download/despesas-2022.csv",
    2023: "2c3328bd-329e-4db6-b742-630619b0dd65/download/despesas-2023.csv",
    2024: "b34ae52a-a739-412a-9bab-80f53ba72f4f/download/despesas-2024.csv",
    2025: "b9c229f8-884c-4fa6-85a9-15469172d6a8/download/despesas-2025.csv",
    2026: "1d4a0ae2-5e0c-41d2-8e36-45e092afe109/download/despesas-2026.csv",
}
UGS = {  # código da unidade gestora: (órgão, nome)
    "10101": ("Assembleia Legislativa", "Assembleia Legislativa"),
    "20101": ("Tribunal de Contas", "Tribunal de Contas"),
    "30101": ("Poder Judiciário", "Tribunal de Justiça"),
    "30901": ("Poder Judiciário", "Fundo Especial do Poder Judiciário"),
    "50101": ("Ministério Público", "Ministério Público"),
    "50901": ("Ministério Público", "Fundo Estadual de Reparação dos Interesses Difusos Lesados"),
    "50902": ("Ministério Público", "Fundo Especial do Ministério Público"),
    "60101": ("Defensoria Pública", "Defensoria Pública"),
    "60901": ("Defensoria Pública", "Fundo de Aparelhamento da Defensoria Pública"),
}
LIVRES = ("500", "501")  # recursos não vinculados de impostos e outros recursos não vinculados (classificação de fontes em vigor desde 2023)
# Classificação anterior a 2023 (exercícios de 2021 e 2022): 101 recursos ordinários e 301 superávit financeiro de recursos ordinários. Na classificação
# nova a fonte 500 já inclui o superávit; as fontes 271 e 671 (arrecadado pelo órgão) correspondem aos fundos dos Poderes (fonte 759) e ficam de fora.
LIVRES_ANTIGAS = ("101", "301")


def livres(ano):
    return LIVRES if ano >= 2023 else LIVRES_ANTIGAS
csv.field_size_limit(10 ** 9)


def num(s):
    return float(s.replace(".", "").replace(",", ".")) if s else 0.0


def agregar(linhas_csv):
    """Soma por (data, unidade, grupo de despesa, fonte, elemento) para os Poderes e por (mês, unidade, número da emenda, fonte) para as emendas."""
    rd = csv.reader(linhas_csv, delimiter=";")
    h = [c.lstrip("﻿") for c in next(rd)]
    ix = {c: i for i, c in enumerate(h)}
    P = collections.defaultdict(lambda: [0.0] * 4)
    M = collections.defaultdict(lambda: [0.0] * 4)
    n = 0
    for r in rd:
        if len(r) < len(h):
            continue
        n += 1
        d, ug, fo = r[ix["Data"]][:10], r[ix["CodigoUnidadeGestora"]], r[ix["CodigoFonte"]]
        v = [num(r[ix["ValorEmpenho"]]), num(r[ix["ValorLiquidado"]]), num(r[ix["ValorPago"]]), num(r[ix["ValorRap"]])]
        if ug in UGS:
            a = P[(d, ug, r[ix["CodigoGrupoDespesa"]], fo, r[ix["CodigoElementoDespesa"]])]
            for i in range(4):
                a[i] += v[i]
        em = r[ix["Emenda"]].strip()
        if em and em != "0":
            a = M[(d[6:10] + "-" + d[3:5], ug, em, fo)]
            for i in range(4):
                a[i] += v[i]
    return {"linhas": n, "P": [list(k) + vv for k, vv in P.items()], "M": [list(k) + vv for k, vv in M.items()]}


def ler_agregado(ano):
    url = BASE + RECURSOS[ano]
    p = subprocess.Popen(["curl", "-sS", "-L", "--retry", "3", url], stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    return agregar(p.stdout)


def md(d):
    return (int(d[3:5]), int(d[0:2]))


def resumir(A):
    """A: {ano: agregado}. Corte = último dia com lançamento dos Poderes no ano corrente; o ano anterior é cortado no mesmo dia e mês."""
    anos = sorted(A)
    atual, ant = anos[-1], anos[-2]
    corte = max(md(r[0]) for r in A[atual]["P"] if r[0].endswith(str(atual)))

    def soma(ano, ix, ate_corte, filtro):
        t = 0.0
        for d, ug, gr, fo, el, *v in A[ano]["P"]:
            if not d.endswith(str(ano)) or (ate_corte and md(d) > corte) or not filtro(ug, gr, fo):
                continue
            t += v[ix]
        return t / 1e6

    livre = lambda ug, gr, fo: fo in LIVRES
    todas = lambda ug, gr, fo: True
    out = {"fonte": "Portal de dados abertos do Espírito Santo, Despesas-%d.csv a Despesas-%d.csv (Sigefes)" % (anos[0], atual),
           "gerado_em": datetime.date.today().isoformat(), "ano_corrente": atual,
           "corte": "%d-%02d-%02d" % (atual, corte[0], corte[1]), "fontes_livres": list(LIVRES), "fontes_livres_2021_2022": list(LIVRES_ANTIGAS),
           "unidades": {k: v[1] for k, v in UGS.items()}, "poderes": {}, "emendas": {}}
    for nome, filtro in (("fontes_livres", livre), ("todas_as_fontes", todas)):
        b = {}
        for rot, ix in (("pago", 2), ("empenhado", 0)):
            ate_atual, ate_ant, ano_ant = soma(atual, ix, True, filtro), soma(ant, ix, True, filtro), soma(ant, ix, False, filtro)
            frac = ate_ant / ano_ant
            b[rot] = {"ate_corte_%d_mi" % atual: ate_atual, "ate_corte_%d_mi" % ant: ate_ant, "ano_%d_mi" % ant: ano_ant,
                      "fracao_do_ano_ate_corte_%d" % ant: frac, "variacao_mesmo_corte": ate_atual / ate_ant - 1,
                      "anualizado_%d_mi" % atual: ate_atual / frac}
        out["poderes"][nome] = b
    orgaos = collections.defaultdict(lambda: collections.defaultdict(float))
    for ug, (org, _) in UGS.items():
        for ano, rot in ((atual, "ate_corte_%d" % atual), (ant, "ate_corte_%d" % ant)):
            orgaos[org][rot] += soma(ano, 2, True, lambda u, g, f, ug=ug: f in LIVRES and u == ug)
        orgaos[org]["ano_%d" % ant] += soma(ant, 2, False, lambda u, g, f, ug=ug: f in LIVRES and u == ug)
    out["poderes"]["por_orgao_pago_fontes_livres_mi"] = {k: dict(v) for k, v in orgaos.items()}

    # Série anual dos Poderes (recursos não vinculados): exercícios fechados e, para o ano corrente, o valor anualizado.
    hist = {"poderes_pago_mi": {}, "poderes_empenhado_mi": {}, "emendas_pago_mi": {}, "emendas_empenhado_mi": {}}
    for ano in anos:
        fl = livres(ano)
        f_ano = lambda ug, gr, fo, fl=fl: fo in fl
        if ano < atual:
            hist["poderes_pago_mi"][str(ano)] = soma(ano, 2, False, f_ano)
            hist["poderes_empenhado_mi"][str(ano)] = soma(ano, 0, False, f_ano)
    hist["poderes_pago_mi"][str(atual)] = out["poderes"]["fontes_livres"]["pago"]["anualizado_%d_mi" % atual]
    hist["poderes_empenhado_mi"][str(atual)] = out["poderes"]["fontes_livres"]["empenhado"]["anualizado_%d_mi" % atual]

    # Emendas parlamentares (campo Emenda do Sigefes). Agregado por mês: o corte do ano anterior usa os meses inteiros mais a fração do mês do corte.
    em = {}
    for ano in anos:
        e = collections.defaultdict(float)
        por_fonte, por_prefixo, por_mes = collections.defaultdict(float), collections.defaultdict(float), collections.defaultdict(float)
        pago_mes = collections.defaultdict(float)
        for mes, ug, num_em, fo, emp, liq, pago, rap in A[ano]["M"]:
            if not mes.startswith(str(ano)):
                continue
            e["empenhado"] += emp; e["pago"] += pago
            por_fonte[fo] += emp
            por_prefixo[num_em.split("/")[-1].strip()[:1]] += emp
            por_mes[mes] += emp
            pago_mes[mes] += pago
        em[str(ano)] = {"empenhado_mi": e["empenhado"] / 1e6, "pago_mi": e["pago"] / 1e6,
                        "por_fonte_mi": {k: v / 1e6 for k, v in por_fonte.items()},
                        "por_prefixo_mi": {k: v / 1e6 for k, v in por_prefixo.items()},
                        "por_mes_mi": {k: v / 1e6 for k, v in sorted(por_mes.items())},
                        "pago_por_mes_mi": {k: v / 1e6 for k, v in sorted(pago_mes.items())}}
        hist["emendas_pago_mi"][str(ano)] = e["pago"] / 1e6
        hist["emendas_empenhado_mi"][str(ano)] = e["empenhado"] / 1e6
    # Fração do ano anterior já paga no corte: meses anteriores ao do corte inteiros e o mês do corte proporcional aos dias.
    mes_c, dia_c = corte
    dias_mes = (datetime.date(atual + (mes_c == 12), mes_c % 12 + 1, 1) - datetime.date(atual, mes_c, 1)).days
    pm = em[str(ant)]["pago_por_mes_mi"]
    ate = sum(v for k, v in pm.items() if int(k[5:7]) < mes_c) + pm.get("%d-%02d" % (ant, mes_c), 0.0) * dia_c / dias_mes
    frac_em = ate / em[str(ant)]["pago_mi"]
    pm_a = em[str(atual)]["pago_por_mes_mi"]
    em[str(atual)]["pago_anualizado_mi"] = em[str(atual)]["pago_mi"] / frac_em
    em[str(atual)]["fracao_do_ano_ate_corte_%d" % ant] = frac_em
    hist["emendas_pago_mi"][str(atual)] = em[str(atual)]["pago_anualizado_mi"]
    hist["emendas_empenhado_mi"][str(atual)] = em[str(atual)]["empenhado_mi"] / frac_em
    out["emendas"] = em
    out["historico"] = hist
    return out


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--agregados":
        A = {a: json.load(open(os.path.join(sys.argv[2], "agreg_%d.json" % a), encoding="utf-8")) for a in RECURSOS}
    else:
        A = {a: ler_agregado(a) for a in RECURSOS}
    res = resumir(A)
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("gerado", DESTINO)
    pl = res["poderes"]["fontes_livres"]
    print("pago nas fontes 500 e 501: ate o corte %.0f mi (%.0f no mesmo corte de %d), anualizado %.0f mi"
          % (pl["pago"]["ate_corte_%d_mi" % res["ano_corrente"]], pl["pago"]["ate_corte_%d_mi" % (res["ano_corrente"] - 1)], res["ano_corrente"] - 1,
             pl["pago"]["anualizado_%d_mi" % res["ano_corrente"]]))


if __name__ == "__main__":
    main()
