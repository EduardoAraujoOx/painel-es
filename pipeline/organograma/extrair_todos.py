#!/usr/bin/env python3
"""Extrai da folha do último mês as pessoas ATIVAS que NÃO ocupam cargo em comissão nem função
gratificada (as que ocupam já vêm do módulo cargos), para o organograma mostrar quem está em
cada área e quanto recebe. Para cada vínculo: remuneração bruta, abate do teto e cargo efetivo.

Ficam de fora: estagiários e médicos residentes (bolsa não é salário); quem não tem nenhuma
rubrica de pagamento no mês (resíduos de acerto de quem foi desligado ou afastado).
Funções não remuneradas e "não especificadas" NÃO excluem: são servidores comuns.

Lê a folha em fluxo (nunca grava o arquivo bruto). Resultado: .cache/organograma/todos.json
Uso: python3 pipeline/organograma/extrair_todos.py
"""
import collections
import glob
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "cargos"))
import extrair  # noqa: E402
import regras  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(AQUI))
DESTINO = os.path.join(RAIZ, ".cache", "organograma")
FORA = {"ESTAGIARIO", "MEDICO RESIDENTE"}


def main():
    ultimo = os.path.basename(sorted(glob.glob(os.path.join(extrair.CACHE, "????-??.json")))[-1])[:7]
    mes_folha = f"{ultimo[5:7]}/{ultimo[:4]}"
    url = extrair.listar_recursos()[ultimo]
    pessoas = {}
    lidas = 0
    for r in extrair.linhas_csv(url):
        lidas += 1
        if r["Situacao_Folha"] != "ATIVO" or r["MesCompetencia"] != r["MesFolha"] or r["MesFolha"] != mes_folha:
            continue
        tipo = r["TipoFuncao"]
        if tipo in regras.TIPOS_ALVO or tipo in FORA or r["Orgao"] in regras.ORGAOS_EXCLUIDOS:
            continue
        k = (r["Orgao"], r["NumFunc"], r["NumVinc"])
        p = pessoas.get(k)
        if p is None:
            p = pessoas[k] = {"nome": r["Nome"], "cargo": r["Cargo"], "rub": collections.defaultdict(float)}
        v = regras.para_float(r["Valor"])
        p["rub"][r["Rubrica"]] += v if r["VantagemDesconto"] == "V" else -v
    saida = []
    for (org, nf, nv), p in pessoas.items():
        bruto, abate = regras.remuneracao(p["rub"])
        if bruto <= 0:
            continue
        saida.append([org, nf, nv, p["nome"], p["cargo"].strip(), bruto, abate])
    os.makedirs(DESTINO, exist_ok=True)
    json.dump({"mes": ultimo, "pessoas": saida}, open(os.path.join(DESTINO, "todos.json"), "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{lidas} linhas lidas; {len(saida)} pessoas sem cargo/função em {ultimo}")


if __name__ == "__main__":
    main()
