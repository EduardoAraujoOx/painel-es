#!/usr/bin/env python3
"""Gera public/diagnostico/dados.js a partir de data/capag/indicadores.json e data/capag/historico_caixa.json.

A página public/diagnostico/ é autônoma: usa só agregados públicos do Siconfi (receita, despesa, caixa e dívida do Estado),
sem nomes nem valores de pessoas. Os dados vão num arquivo .js (e não .json) porque a política de segurança do painel
(vercel.json) só admite scripts do próprio domínio, e assim a página também abre direto do arquivo, sem servidor.

O bloco "externos" reúne números que não vêm do Siconfi (leis de diretrizes, emendas, Poderes, reforma tributária), cada um com
a fonte e a situação (verificado na imprensa, informado pelo usuário ou premissa). Quando o texto oficial da lei sair, é aqui que
se troca o número e a situação.

Uso: python3 -I pipeline/capag/pagina.py   (depois de montar.py e historico.py)
"""
import json
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ORIGEM = os.path.join(RAIZ, "data", "capag", "indicadores.json")
HISTORICO = os.path.join(RAIZ, "data", "capag", "historico_caixa.json")
SIGEFES = os.path.join(RAIZ, "data", "capag", "sigefes_poderes.json")
DESTINO = os.path.join(RAIZ, "public", "diagnostico", "dados.js")

BI = 1e9

EXTERNOS = {
    "emendas": {
        "situacao": "imprensa",
        "valor_2027_mi": 435, "valor_antes_mi": 90, "por_deputado_mi": 14.5, "por_deputado_antes_mi": 3, "deputados": 30,
        "percentual_rcl": 1.55, "base": "RCL de 2025", "metade_saude": True,
        "texto": "A PEC 04/2026, aprovada em 13/10/2026, fixou em 1,55% da receita corrente líquida o teto das emendas, que passam a ter execução obrigatória.",
        "fontes": [
            ["A Gazeta, 'Emendas de deputados vão superar em R$ 110 milhões orçamento total da Ales'", "https://www.agazeta.com.br/es/politica/emendas-de-deputados-vao-superar-em-r-110-milhoes-orcamento-total-da-ales-1026"],
            ["Folha Vitória, 'Deputados aprovam LDO com emendas impositivas e aumento no orçamento dos Poderes'", "https://www.folhavitoria.com.br/politica/deputados-aprovam-ldo-com-emendas-impositivas-e-aumento-no-orcamento-dos-poderes/"],
        ],
    },
    "poderes": {
        "situacao": "tabela do autor, 2027 reproduzido",
        "percentuais_rcl": {"Judiciário": 6.131, "Ministério Público": 2.456, "Assembleia Legislativa": 1.281,
                            "Tribunal de Contas": 1.017, "Defensoria Pública": 0.750},
        # Limites globais em R$ milhões, da tabela de cálculo do autor (PLOA 2026, p. 41, para 2026; PL 286/2026 com a Emenda
        # Modificativa nº 2, aprovada em 21/10/2026, para 2027). Os de 2027 foram reproduzidos aqui: percentual x RCL de jul/2025 a jun/2026.
        "limites_mi": {"Poder Judiciário": [1648.04, 1847.03], "Assembleia Legislativa": [333.53, 385.92], "Tribunal de Contas": [258.80, 306.38],
                       "Ministério Público": [614.35, 739.90], "Defensoria Pública": [134.65, 225.95]},
        "base_rcl_texto": "RCL de julho de 2025 a junho de 2026",
        "regra_anterior": "dotação da LOA do ano anterior na fonte 500, corrigida pelo IPCA, mais 1,5% (texto da LDO 2026, art. 21, §1º)",
        "acrescimo_informado_vs_proposta_mi": 300,
        "texto": "A LDO 2027 troca a correção pelo IPCA por percentuais fixos da receita corrente líquida, e os limites passam de R$ 2.989 mi para R$ 3.505 mi.",
        "fontes": [
            ["Tabela de cálculo do autor (PLOA 2026, p. 41; PL 286/2026 com a Emenda Modificativa nº 2)", ""],
            ["Folha Vitória, 21/10/2026", "https://www.folhavitoria.com.br/politica/deputados-aprovam-ldo-com-emendas-impositivas-e-aumento-no-orcamento-dos-poderes/"],
            ["LDO 2026 (Planejamento-ES)", "https://planejamento.es.gov.br/media/Or%C3%A7amento/Lei%20de%20Diretrizes%20Or%C3%A7ament%C3%A1rias/LDO%202026.pdf"],
        ],
    },
    "ldo_2027": {
        "situacao": "imprensa",
        "receita_total_bi": 32.3, "despesa_total_bi": 32.7, "deficit_primario_bi": 1.6, "orcamento_2027_total_bi": 35.4,
        "aprovada_em": "21/10/2026",
        "fontes": [["Em Dia ES, 'Ales aprova projeto da LDO do ES para 2027'", "https://emdiaes.com.br/economia/ales-aprova-projeto-da-lei-de-diretrizes-orcamentarias-do-es-para-2027"],
                   ["ES Hoje, 'Assembleia Legislativa aprova proposta da lei orçamentária para 2027'", "https://eshoje.com.br/?p=904073"]],
    },
    "ploa_2027": {
        "situacao": "imprensa",
        "orcamento_fiscal_seguridade_bi": 35.4, "orcamento_global_bi": 36.1, "orcamento_2026_bi": 32.0, "crescimento_nominal": 0.106,
        "executivo_bi": 32.0, "investimento_direto_executivo_bi": 5.27, "receita_caixa_tesouro_bi": 26.6,
        "poderes_mi": {"Poder Judiciário": 2070.0, "Ministério Público": 635.1, "Assembleia Legislativa": 325.7, "Tribunal de Contas": 236.8, "Defensoria Pública": 156.7},
        "fontes": [["ES Hoje, 'Orçamento de R$ 36,1 bilhões para 2027 chega à análise da Assembleia'", "https://eshoje.com.br/politica/2026/10/r-361-bilhoes-assembleia/"],
                   ["ES Hoje, 'Governo capixaba entrega PLOA 2027 com previsão de R$ 35,4 bi na receita'", "https://eshoje.com.br/?p=899573"]],
    },
    "paf": {
        "situacao": "oficial",
        "revisao": "24ª revisão do Programa de Reestruturação e de Ajuste Fiscal, 2025 a 2027, assinada em 30/10/2025",
        "receita_propria_mi": {"2025": 25857, "2026": 28213, "2027": 30984},
        "resultado_primario_mi": {"2025": -3259, "2026": -2743, "2027": 1123},
        "dc_rcl_pct": {"2025": 34.60, "2026": 35.36, "2027": 33.83},
        "fontes": [["Programa de Reestruturação e de Ajuste Fiscal do Espírito Santo, 24ª revisão (SEFAZ-ES)", "https://sefaz.es.gov.br/Media/Sefaz/Tesouro%20Estadual/Programa-1.pdf"]],
    },
    "reforma": {
        "situacao": "imprensa e estudo próprio",
        "retencao_2029_2032": 0.80, "retencao_2033": 0.90, "reducao_gradual_ate": 2077,
        "coeficiente_es_pct": 1.5418, "receita_media_referencia_bi": 16.090,
        "estudo_setorial_perda_icms_bi": 8.3, "estudo_setorial_a_partir_de": 2033,
        # A trajetória anual da perda vem da nota técnica do autor (NOTA_TECNICA, abaixo).
        "texto": "Segundo resumo da LC 227/2026, de 2029 a 2032 retêm-se 80% da receita do IBS para distribuição pelo coeficiente histórico, 90% em 2033, com redução gradual até 2077.",
        "fontes": [
            ["Nota técnica do autor: Impactos da transição do ICMS para o IBS sobre a receita do Estado do Espírito Santo, 2029-2033 (materiais/nota-tecnica-es do site do autor)", ""],
            ["Radar da Reforma Tributária", "https://radardareformatributaria.com/ibs-coeficiente-municipios-estados-dados-2019-2026-arrecadacao/"],
            ["Tribuna Online, 'Reforma tributária: aliança para evitar prejuízo ao Espírito Santo'", "https://tribunaonline.com.br/economia/reforma-tributaria-alianca-para-evitar-prejuizo-ao-espirito-santo-302047"],
            ["Nota Técnica 02/2026, Unidade Fazendária da Reforma Tributária (SEFAZ-ES)", ""],
        ],
    },
}


# Trajetória macroeconômica do estudo do autor sobre o IBS (Estudo 11 e 03 do site pessoal, arquivo data/ibs-projecao-longo-prazo.json):
# PIB real e IPCA do Boletim Focus (mediana, 2026 a 2030) e da IFI (RAF 107, dez/2025, 2031 a 2033). A receita de referência cresce com o
# PIB nominal, isto é, (1 + PIB real) x (1 + IPCA) - 1.
MACRO = {
    "anos": [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033],
    "pib_real": [0.0198, 0.0152, 0.0200, 0.0200, 0.0200, 0.0220, 0.0220, 0.0220],
    "ipca": [0.0502, 0.0422, 0.0380, 0.0350, 0.0350, 0.0300, 0.0300, 0.0300],
    "fonte": "Focus (BCB), mediana, 2026 a 2030; IFI, RAF 107, 2031 a 2033; arquivo data/ibs-projecao-longo-prazo.json do site do autor",
}

# Nota técnica do autor, "Impactos da transição do ICMS para o IBS sobre a receita do Estado do Espírito Santo, 2029-2033"
# (materiais/nota-tecnica-es/tabelas/tab-trajetoria.tex). Receita estadual de referência = ICMS líquido da cota-parte municipal mais FECOP,
# em R$ de 2025. A variação é a da receita com reforma contra o cenário sem reforma.
NOTA_TECNICA = {
    "base_2025_bi": 16.99,
    "anos": [2029, 2030, 2031, 2032, 2033],
    "sem_reforma_bi": [18.32, 18.69, 19.10, 19.52, 19.95],
    "com_reforma_bi": [18.10, 18.28, 18.49, 18.70, 18.43],
    "variacao_pct": [-1.19, -2.19, -3.20, -4.20, -7.60],
    "diferenca_mi": [-217, -409, -611, -820, -1515],
    "acumulado_bi": 3.57,
    "texto": "Perda crescente de 2029 a 2033, a preços de 2025, no cenário central da nota técnica (coeficientes estimados pelo autor).",
}

PODERES_2026_MI = 2989.37  # soma dos limites de 2026 (tabela do autor)



def crescimento_nominal(ano):
    i = MACRO["anos"].index(ano)
    return (1 + MACRO["pib_real"][i]) * (1 + MACRO["ipca"][i]) - 1


def extras_padrao():
    """Gasto novo acima da trajetória que existiria sem a nova regra, em R$ mi de 2027.
    Emendas: o valor antigo (R$ 90 mi) já cresceria com a receita. Poderes: pela regra antiga o limite de 2026 seria corrigido pelo IPCA
    (LDO 2026, art. 21); a nova regra fixa percentuais da RCL. O que excede a regra antiga é o gasto novo."""
    em = EXTERNOS["emendas"]
    pod26 = sum(v[0] for v in EXTERNOS["poderes"]["limites_mi"].values())
    pod27 = sum(v[1] for v in EXTERNOS["poderes"]["limites_mi"].values())
    i27 = MACRO["ipca"][MACRO["anos"].index(2027)]
    antiga27 = pod26 * (1 + i27)
    sg = resumo_sigefes()
    poderes_2026 = round(sg["poderes"]["pago_anualizado_mi"]) if sg else round(pod26)
    emendas_2026 = round(sg["emendas"]["pago_anualizado_mi"]) if sg else 115
    return {"emenda": round(em["valor_2027_mi"] - em["valor_antes_mi"] * (1 + crescimento_nominal(2027))),
            "poderes": round(pod27 - antiga27),
            "poderes_regra_antiga_2027": round(antiga27, 1),
            "emenda_bruto": em["valor_2027_mi"] - em["valor_antes_mi"], "poderes_bruto": round(pod27 - pod26),
            "poderes_2026": round(pod26, 2), "poderes_2027": round(pod27, 2), "poderes_menor": 100,
            # Gasto novo medido contra a execução de 2026 (modo "novo" do motor): o que se passa a gastar em cada ano menos a despesa executada em
            # 2026 levada pela receita. Emendas: 1,55% da RCL de dois anos antes (o defasamento depois de 2027 é premissa, a confirmar no texto
            # da PEC 04/2026), contra a execução de 2026 (Sigefes, valor pago, anualizado). Poderes: a fração poderes_exec_futura do limite,
            # contra a despesa de 2026 paga com recursos não vinculados (Sigefes, fontes 500 e 501, anualizada). Hipótese A: limite integral
            # (exec_futura = 1); B: limite executado como em 2026 (exec_futura = fração do limite que os Poderes executaram em 2026).
            "novo": {"emenda_pct_rcl": EXTERNOS["emendas"]["percentual_rcl"] / 100, "emenda_defasagem": 2, "emenda_base_mi": emendas_2026,
                     "poderes_pct_rcl": round(sum(EXTERNOS["poderes"]["percentuais_rcl"].values()) / 100, 5),
                     "poderes_limite_2026_mi": round(pod26, 2), "poderes_base_2026_mi": poderes_2026, "poderes_exec_futura": 1.0,
                     # Regra anterior (LDO 2026, art. 21, par. 1): limite do ano anterior corrigido pelo IPCA de julho a junho mais 1,5%.
                     # IPCA de julho de 2025 a junho de 2026 = 4,64% (BCB, SGS 433); nos anos seguintes, a média do IPCA dos dois anos-calendário.
                     "poderes_regra": "nova", "poderes_antiga_acrescimo": 0.015, "poderes_antiga_ipca_2027": 0.0464},
            # Trajetórias da receita (sem reforma): desvio anual da receita em relação ao PIB nominal e fração desse desvio que a despesa que já
            # existe acompanha. 2,2 pontos = média de 2019 a 2025 da RCL acima do PIB nominal (desvio-padrão de 6,2; erro-padrão de 2,4);
            # 0,4 = inclinação de 0,34 a 0,45 entre o desvio da despesa e o da receita no mesmo ano (erro-padrão de cerca de 0,3).
            "trajetorias": {"dif_pp": 2.2, "repasse": 0.4}}


def resumo_sigefes():
    """Execução de 2026 dos Poderes e das emendas, em R$ milhões, do microdado do Sigefes (pipeline/capag/sigefes_poderes.py). Sem o arquivo, None."""
    if not os.path.exists(SIGEFES):
        return None
    s = json.load(open(SIGEFES, encoding="utf-8"))
    a = s["ano_corrente"]
    lv = s["poderes"]["fontes_livres"]
    lim = sum(v[0] for v in EXTERNOS["poderes"]["limites_mi"].values())
    em = s["emendas"]
    return {"fonte": s["fonte"], "corte": s["corte"], "ano": a,
            "poderes": {"pago_ate_corte_mi": lv["pago"]["ate_corte_%d_mi" % a], "pago_mesmo_corte_anterior_mi": lv["pago"]["ate_corte_%d_mi" % (a - 1)],
                        "variacao": lv["pago"]["variacao_mesmo_corte"], "pago_anualizado_mi": lv["pago"]["anualizado_%d_mi" % a],
                        "empenhado_anualizado_mi": lv["empenhado"]["anualizado_%d_mi" % a], "limite_mi": lim,
                        "fracao_do_limite_pago": lv["pago"]["anualizado_%d_mi" % a] / lim,
                        "fracao_do_limite_empenhado": lv["empenhado"]["anualizado_%d_mi" % a] / lim},
            "emendas": {"empenhado_ate_corte_mi": em[str(a)]["empenhado_mi"], "empenhado_ano_anterior_mi": em[str(a - 1)]["empenhado_mi"],
                        "pago_ate_corte_mi": em[str(a)]["pago_mi"], "pago_ano_anterior_mi": em[str(a - 1)]["pago_mi"],
                        "pago_anualizado_mi": em[str(a)]["pago_anualizado_mi"], "fonte_500_mi": em[str(a)]["por_fonte_mi"].get("500", 0.0),
                        "prefixo_r_mi": em[str(a)]["por_prefixo_mi"].get("R", 0.0), "prefixo_e_mi": em[str(a)]["por_prefixo_mi"].get("E", 0.0)},
            # série anual (R$ mi, valor pago): exercícios fechados de 2021 em diante e o ano corrente anualizado pelo perfil do ano anterior
            "historico": s["historico"]}


def base_2026(ex, p26):
    """Fechamento estimado de 2026: o que foi realizado de janeiro a agosto mais setembro a dezembro de 2025 corrigido pelo PIB nominal
    de 2026 (Focus). Despesa corrente ajustada = despesa corrente menos as transferências a municípios, que acompanham a despesa."""
    g = crescimento_nominal(2026)
    rcl = p26["rcl_jan_ago_2026"] + p26["rcl_set_dez_2025"] * (1 + g)
    rca = p26["receita_corrente_ate_ago_2026"] + (p26["receita_corrente_2025"] - p26["receita_corrente_ate_ago_2025"]) * (1 + g)
    desp = p26["despesa_corrente_ate_ago_2026"] + (p26["despesa_corrente_2025"] - p26["despesa_corrente_ate_ago_2025"]) * (1 + g)
    c25 = ex[2025]["poupanca_corrente"]["componentes"]
    transf = c25["transferencias_municipios"] * desp / p26["despesa_corrente_2025"]
    desp_aj = desp - transf
    caixa = ex[2025]["liquidez"]["caixa_bruta_nao_vinculada"] - ex[2025]["liquidez"]["obrigacoes_financeiras_nao_vinculadas"] - ex[2025]["liquidez"]["insuficiencias_fontes_vinculadas"]
    razoes = {"2024": ex[2024]["poupanca_corrente"]["componentes"]["razao"], "2025": ex[2025]["poupanca_corrente"]["componentes"]["razao"],
              "2026": desp_aj / rca}
    pc = 0.5 * razoes["2026"] + 0.3 * razoes["2025"] + 0.2 * razoes["2024"]
    return {
        "ano": 2026, "estimado": True, "rcl": rcl / BI, "rca": rca / BI, "despesa": desp_aj / BI, "divida": p26["divida_consolidada_ago_2026"] / BI,
        "caixa": caixa / BI, "razoes": razoes, "pc": pc, "dc_rcl": p26["divida_consolidada_ago_2026"] / rcl, "lr": caixa / rcl,
        "crescimento_receita_set_dez": g,
        "crescimento_ate_agosto": {"rcl": p26["rcl_jan_ago_2026"] / p26["rcl_jan_ago_2025"] - 1,
                                   "receita_corrente": p26["receita_corrente_ate_ago_2026"] / p26["receita_corrente_ate_ago_2025"] - 1,
                                   "despesa_corrente": p26["despesa_corrente_ate_ago_2026"] / p26["despesa_corrente_ate_ago_2025"] - 1},
        "crescimento_ano": {"rcl": rcl / ex[2025]["endividamento"]["rcl"] - 1, "receita_corrente": rca / c25["receita_corrente_ajustada"] - 1,
                            "despesa_corrente": desp / p26["despesa_corrente_2025"] - 1},
    }


def crescimento_medio(ex, de, ate, chave):
    """Taxa média anual composta entre dois exercícios, para a receita ou a despesa corrente ajustadas."""
    a, b = ex[de]["poupanca_corrente"]["componentes"][chave], ex[ate]["poupanca_corrente"]["componentes"][chave]
    return (b / a) ** (1 / (ate - de)) - 1


def ponte_caixa(historico):
    """Ponte entre o resultado primário e a variação do caixa livre, de 2019 a 2025, em R$ bilhões.

    variação do caixa livre = resultado primário + juros líquidos (ativos menos passivos) + operações de crédito menos amortização + resíduo.
    O resíduo reúne o que a série não separa: movimento das fontes vinculadas, restos a pagar, reclassificações de fontes e diferenças
    entre o resultado de competência e o de caixa. O resultado primário neutro para o caixa (o que deixa o caixa livre constante) é o
    simétrico da soma dos juros líquidos, do crédito líquido e do resíduo."""
    por_ano = {h["ano"]: h for h in historico}
    linhas = []
    for a in range(2019, max(por_ano) + 1):
        h, ant = por_ano[a], por_ano.get(a - 1)
        if ant is None or None in (h["caixa_livre"], ant["caixa_livre"], h["resultado_primario"], h["juros_ativos"], h["juros_passivos"],
                                    h["operacoes_credito"], h["amortizacao"]):
            continue
        var = h["caixa_livre"] - ant["caixa_livre"]
        juros = h["juros_ativos"] - h["juros_passivos"]
        credito = h["operacoes_credito"] - h["amortizacao"]
        residuo = var - (h["resultado_primario"] + juros + credito)
        linhas.append({"ano": a, "variacao_caixa": var, "resultado_primario": h["resultado_primario"], "juros_liquidos": juros,
                       "credito_liquido": credito, "residuo": residuo, "neutro": -(juros + credito + residuo), "rcl": h["rcl"]})
    return linhas


def main():
    doc = json.load(open(ORIGEM, encoding="utf-8"))
    hist = json.load(open(HISTORICO, encoding="utf-8"))
    ex = {e["exercicio_base"]: e for e in doc["exercicios"]}
    base = max(a for a, e in ex.items() if e["liquidez"].get("lr") is not None and e["poupanca_corrente"]["pc"] is not None)
    e = ex[base]
    comp = e["poupanca_corrente"]["componentes"]

    def bi(x):
        return None if x is None else x / BI

    historico_caixa = []
    for h in hist["exercicios"]:
        dot, emp, paga = h.get("dotacao_primaria"), h.get("despesa_primaria_empenhada"), h.get("despesa_primaria_paga")
        historico_caixa.append({
            "ano": h["ano"], "rcl": bi(h["rcl"]), "caixa_livre": bi(h.get("caixa_livre")), "caixa_livre_rcl": h.get("caixa_livre_rcl"),
            "resultado_primario": bi(h.get("resultado_primario")), "meta_resultado_primario": bi(h.get("meta_resultado_primario")),
            "divida": bi(h["divida_consolidada"]), "operacoes_credito": bi(h.get("operacoes_credito")), "amortizacao": bi(h.get("amortizacao_divida")),
            "juros_ativos": bi(h.get("juros_ativos")), "juros_passivos": bi(h.get("juros_passivos")),
            "dotacao": bi(dot), "empenhada": bi(emp), "paga": bi(paga),
            "exec_paga": (paga / dot) if dot and paga else None, "exec_empenhada": (emp / dot) if dot and emp else None,
        })
    ponte = ponte_caixa(historico_caixa)
    p26 = hist["parcial_2026"]
    b26 = base_2026(ex, p26)
    hc = {h["ano"]: h for h in hist["exercicios"]}

    def componentes(a):
        c = ex[a]["poupanca_corrente"]["componentes"]
        caixa = hc[a].get("caixa_livre")
        return {"ano": a, "divida": bi(ex[a]["endividamento"]["dc_bruta"]), "rcl": bi(ex[a]["endividamento"]["rcl"]),
                "dc_rcl": ex[a]["endividamento"]["dc_rcl"], "despesa": bi(c["despesa_corrente_ajustada"]),
                "rca": bi(c["receita_corrente_ajustada"]), "razao": c["razao"], "pc": ex[a]["poupanca_corrente"]["pc"],
                "caixa": bi(caixa), "lr": (caixa / ex[a]["endividamento"]["rcl"]) if caixa is not None else None,
                "nota_dc": ex[a]["notas_parciais"]["endividamento"], "nota_pc": ex[a]["notas_parciais"]["poupanca_corrente"],
                "nota_lr": ex[a]["notas_parciais"]["liquidez_relativa"], "nota_final": ex[a]["nota_final"]}

    crescimento = {"de": 2019, "ate": 2025,
                   "receita": crescimento_medio(ex, 2019, 2025, "receita_corrente_ajustada"),
                   "despesa": crescimento_medio(ex, 2019, 2025, "despesa_corrente_ajustada"),
                   "receita_2021_2025": crescimento_medio(ex, 2021, 2025, "receita_corrente_ajustada"),
                   "despesa_2021_2025": crescimento_medio(ex, 2021, 2025, "despesa_corrente_ajustada"),
                   "razoes": {str(a): ex[a]["poupanca_corrente"]["componentes"]["razao"] for a in range(2018, 2026)}}
    dados = {
        "ano_base": 2026,
        "ano_ultimo_real": base,
        "rcl": b26["rcl"], "divida": b26["divida"], "dc_rcl": b26["dc_rcl"], "rca": b26["rca"], "despesa": b26["despesa"],
        "pc": b26["pc"], "lr": b26["lr"], "razoes": b26["razoes"], "base": b26,
        "macro": MACRO,
        "reforma_nota": NOTA_TECNICA,
        "tabela_historica": [componentes(a) for a in range(2021, base + 1)],
        "crescimento_historico": crescimento,
        "historico": [
            {"ano": a, "dc_rcl": ex[a]["endividamento"]["dc_rcl"], "pc": ex[a]["poupanca_corrente"]["pc"],
             "lr": ex[a]["liquidez"].get("lr"), "nota": ex[a]["nota_final"]}
            for a in sorted(ex) if ex[a]["nota_final"]
        ],
        "historico_caixa": historico_caixa,
        "ponte_caixa": ponte,
        "parcial_2026": {k: bi(v) for k, v in p26.items()},
        "externos": EXTERNOS,
        "extras_padrao": extras_padrao(),
        "sigefes": resumo_sigefes(),
    }
    with open(DESTINO, "w", encoding="utf-8") as f:
        f.write("// Gerado por pipeline/capag/pagina.py a partir de data/capag. Valores monetários em R$ bilhões.\n")
        f.write("window.DADOS = " + json.dumps(dados, ensure_ascii=False, indent=1) + ";\n")
    print("gerado", DESTINO, "ano-base", base)


if __name__ == "__main__":
    main()
