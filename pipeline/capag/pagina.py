#!/usr/bin/env python3
"""Gera public/diagnostico/dados.js a partir de data/capag/indicadores.json.

A página public/diagnostico/ é autônoma: usa só agregados públicos do Siconfi (receita, despesa e dívida do Estado),
sem nomes nem valores de pessoas. Os dados vão num arquivo .js (e não .json) porque a política de segurança do painel
(vercel.json) só admite scripts do próprio domínio, e assim a página também abre direto do arquivo, sem servidor.

Uso: python3 -I pipeline/capag/pagina.py   (depois de pipeline/capag/montar.py)
"""
import json
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ORIGEM = os.path.join(RAIZ, "data", "capag", "indicadores.json")
DESTINO = os.path.join(RAIZ, "public", "diagnostico", "dados.js")


def main():
    doc = json.load(open(ORIGEM, encoding="utf-8"))
    ex = {e["exercicio_base"]: e for e in doc["exercicios"]}
    base = max(a for a, e in ex.items() if e["liquidez"].get("lr") is not None and e["poupanca_corrente"]["pc"] is not None)
    e = ex[base]
    comp = e["poupanca_corrente"]["componentes"]
    bi = 1e9
    dados = {
        "ano_base": base,
        "rcl": e["endividamento"]["rcl"] / bi,
        "divida": e["endividamento"]["dc_bruta"] / bi,
        "dc_rcl": e["endividamento"]["dc_rcl"],
        "rca": comp["receita_corrente_ajustada"] / bi,
        "despesa": comp["despesa_corrente_ajustada"] / bi,
        "pc": e["poupanca_corrente"]["pc"],
        "lr": e["liquidez"]["lr"],
        "razoes": {str(a): ex[a]["poupanca_corrente"]["componentes"]["razao"] for a in (base - 2, base - 1, base)},
        "historico": [
            {"ano": a, "dc_rcl": ex[a]["endividamento"]["dc_rcl"], "pc": ex[a]["poupanca_corrente"]["pc"],
             "lr": ex[a]["liquidez"].get("lr"), "nota": ex[a]["nota_final"]}
            for a in sorted(ex) if ex[a]["nota_final"]
        ],
        "extras_padrao": {"emenda": 345, "poderes": 500},
    }
    with open(DESTINO, "w", encoding="utf-8") as f:
        f.write("// Gerado por pipeline/capag/pagina.py a partir de data/capag/indicadores.json. Valores monetários em R$ bilhões.\n")
        f.write("window.DADOS = " + json.dumps(dados, ensure_ascii=False, indent=1) + ";\n")
    print("gerado", DESTINO, "ano-base", base)


if __name__ == "__main__":
    main()
