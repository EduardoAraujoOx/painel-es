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
        "situacao": "imprensa e informado",
        "percentuais_rcl": {"Judiciário": 6.131, "Ministério Público": 2.456, "Assembleia Legislativa": 1.281,
                            "Tribunal de Contas": 1.017, "Defensoria Pública": 0.750},
        "acrescimo_explicito_pp_rcl": 0.1,
        "base_rcl_texto": "RCL de julho de 2025 a junho de 2026",
        "regra_anterior": "dotação da LOA do ano anterior na fonte 500, corrigida pelo IPCA, mais 1,5% (texto da LDO 2026, art. 21, §1º)",
        "acrescimo_informado_mi": 500, "acrescimo_informado_vs_proposta_mi": 300,
        "texto": "A LDO 2027 troca a correção pelo IPCA por percentuais fixos da receita corrente líquida. O acréscimo de R$ 300 mi sobre a proposta original e de R$ 500 mi sobre a lei anterior foi informado por Eduardo e ainda não foi conferido com a proposta do Executivo.",
        "fontes": [
            ["Folha Vitória, 21/10/2026", "https://www.folhavitoria.com.br/politica/deputados-aprovam-ldo-com-emendas-impositivas-e-aumento-no-orcamento-dos-poderes/"],
            ["LDO 2026 (Planejamento-ES)", "https://planejamento.es.gov.br/media/Or%C3%A7amento/Lei%20de%20Diretrizes%20Or%C3%A7ament%C3%A1rias/LDO%202026.pdf"],
        ],
    },
    "ldo_2027": {
        "situacao": "imprensa",
        "receita_total_bi": 32.3, "despesa_total_bi": 32.7, "deficit_primario_bi": 1.6, "orcamento_2027_total_bi": 35.4,
        "aprovada_em": "21/10/2026",
        "fontes": [["Em Dia ES, 'Ales aprova projeto da LDO do ES para 2027'", "https://emdiaes.com.br/economia/ales-aprova-projeto-da-lei-de-diretrizes-orcamentarias-do-es-para-2027"]],
    },
    "reforma": {
        "situacao": "imprensa e estudo próprio",
        "retencao_2029_2032": 0.80, "retencao_2033": 0.90, "reducao_gradual_ate": 2077,
        "coeficiente_es_pct": 1.5418, "receita_media_referencia_bi": 16.090,
        "estudo_setorial_perda_icms_bi": 8.3, "estudo_setorial_a_partir_de": 2033,
        "texto": "Segundo resumo da LC 227/2026, de 2029 a 2032 retêm-se 80% da receita do IBS para distribuição pelo coeficiente histórico, 90% em 2033, com redução gradual até 2077.",
        "fontes": [
            ["Radar da Reforma Tributária", "https://radardareformatributaria.com/ibs-coeficiente-municipios-estados-dados-2019-2026-arrecadacao/"],
            ["Tribuna Online, 'Reforma tributária: aliança para evitar prejuízo ao Espírito Santo'", "https://tribunaonline.com.br/economia/reforma-tributaria-alianca-para-evitar-prejuizo-ao-espirito-santo-302047"],
            ["Nota Técnica 02/2026, Unidade Fazendária da Reforma Tributária (SEFAZ-ES)", ""],
        ],
    },
}


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
            "dotacao": bi(dot), "empenhada": bi(emp), "paga": bi(paga),
            "exec_paga": (paga / dot) if dot and paga else None, "exec_empenhada": (emp / dot) if dot and emp else None,
        })
    p26 = hist["parcial_2026"]
    dados = {
        "ano_base": base,
        "rcl": bi(e["endividamento"]["rcl"]),
        "divida": bi(e["endividamento"]["dc_bruta"]),
        "dc_rcl": e["endividamento"]["dc_rcl"],
        "rca": bi(comp["receita_corrente_ajustada"]),
        "despesa": bi(comp["despesa_corrente_ajustada"]),
        "pc": e["poupanca_corrente"]["pc"],
        "lr": e["liquidez"]["lr"],
        "razoes": {str(a): ex[a]["poupanca_corrente"]["componentes"]["razao"] for a in (base - 2, base - 1, base)},
        "historico": [
            {"ano": a, "dc_rcl": ex[a]["endividamento"]["dc_rcl"], "pc": ex[a]["poupanca_corrente"]["pc"],
             "lr": ex[a]["liquidez"].get("lr"), "nota": ex[a]["nota_final"]}
            for a in sorted(ex) if ex[a]["nota_final"]
        ],
        "historico_caixa": historico_caixa,
        "parcial_2026": {k: bi(v) for k, v in p26.items()},
        "externos": EXTERNOS,
        "extras_padrao": {"emenda": EXTERNOS["emendas"]["valor_2027_mi"] - EXTERNOS["emendas"]["valor_antes_mi"],
                          "poderes": EXTERNOS["poderes"]["acrescimo_informado_mi"]},
        "crescimento_padrao": 6,
    }
    with open(DESTINO, "w", encoding="utf-8") as f:
        f.write("// Gerado por pipeline/capag/pagina.py a partir de data/capag. Valores monetários em R$ bilhões.\n")
        f.write("window.DADOS = " + json.dumps(dados, ensure_ascii=False, indent=1) + ";\n")
    print("gerado", DESTINO, "ano-base", base)


if __name__ == "__main__":
    main()
