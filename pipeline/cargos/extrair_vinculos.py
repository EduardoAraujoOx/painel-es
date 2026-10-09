#!/usr/bin/env python3
"""Extrai da base VinculosServidores (dados abertos do ES, ~440 MB) o que o painel precisa:

  * o nome por extenso de cada órgão (campo OrgaoExt);
  * para cada ocupante ATIVO de cargo comissionado ou função gratificada, o tipo de vínculo
    oficial (EFETIVO, COMISSIONADO...), a data de exercício do vínculo e o setor de lotação
    (código e nome), de onde o módulo "organograma" tira a hierarquia de unidades.

O CPF vem mascarado na fonte e, de todo modo, não é lido nem guardado.
Resultado em .cache/cargos/vinculos.json. Uso: python3 pipeline/cargos/extrair_vinculos.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extrair  # noqa: E402
import regras  # noqa: E402


def main():
    url = extrair.listar_recursos()["vinculos"]
    orgaos = {}
    vinc = {}
    lidas = 0
    for r in extrair.linhas_csv(url):
        lidas += 1
        orgaos.setdefault(r["Orgao"], r["OrgaoExt"])
        if r["Situacao"] != "ATIVO" or r["TipoFuncao"] not in regras.TIPOS_ALVO:
            continue
        chave = f'{r["Orgao"]}|{r["NumFunc"]}|{r["NumVinc"]}'
        # [tipo de vínculo, exercício, código do setor, nome do setor, setor que a pessoa chefia]
        vinc[chave] = [r["TipoVinculo"], r["Exercicio"][:10], r["SiglaSetor"], r["NomeSetor"], r["ChefiaSetor"]]
    destino = os.path.join(extrair.CACHE, "vinculos.json")
    json.dump({"orgaos": orgaos, "vinculos": vinc}, open(destino, "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{lidas} linhas lidas; {len(orgaos)} órgãos; {len(vinc)} vínculos ativos com função")


if __name__ == "__main__":
    main()
