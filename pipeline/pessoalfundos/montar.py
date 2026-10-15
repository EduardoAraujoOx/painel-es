#!/usr/bin/env python3
"""Monta os dados do painel "Pessoal pago por fundos": pagamentos a pessoal feitos por fundos, fora da folha do órgão.

Entradas:
  data/cargos/complementos.json               séries mensais por regra (pipeline/cargos/complementos.py), com os componentes;
  .cache/fundos/complementos_pessoas.json     o pago a cada favorecido pessoa física por mês (mesmo script; nomes e CPF mascarado);
  folha do último mês (Remuneracoes-AAAA-MM.csv, dados abertos do ES), do órgão de cada regra.

O pago ao favorecido (SIGEFES) é ligado à folha pelo nome normalizado dentro do órgão. Para cada pessoa o painel mostra o que o fundo pagou
nos últimos 12 meses (média por mês) e a remuneração corrente da folha, e soma as duas para dar a noção de quanto o pagamento do fundo
acrescenta. Nomes sem correspondência na folha ficam listados sem a remuneração.

Saídas: data/pessoalfundos/index.json (fundos, séries e resumo) e data/pessoalfundos/pessoas.json (pessoas, com a composição da folha).
Uso: python3 -I pipeline/pessoalfundos/montar.py
"""
import collections
import json
import os
import re
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(RAIZ, "pipeline", "cargos"))
import extrair  # noqa: E402
import regras  # noqa: E402

SAIDA = os.path.join(RAIZ, "data", "pessoalfundos")
NAO_CORRENTE = re.compile(r"(\b13\b|DECIMO|FERIAS|RESCISAO|INSUFICIENCIA|DEVOLUCAO|DEBITO EXERC|INDENIZACAO FERIAS)")


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", "", s)).strip()


def meses_ate(mes, n):
    a, m = int(mes[:4]), int(mes[5:7])
    saida = []
    for _ in range(n):
        saida.append(f"{a:04d}-{m:02d}")
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return sorted(saida)


def folha_das_pessoas(nomes, sigla, mes):
    """Folha do mês das pessoas de `nomes` (nomes normalizados): n -> melhor registro, com a composição por rubrica.
    Procura em todos os órgãos, porque quem recebe do fundo pode estar cedido a outro órgão; prefere o órgão da regra."""
    recursos = extrair.listar_recursos()
    mes_folha = f"{mes[5:7]}/{mes[:4]}"
    alvo, decisao, reg = set(nomes), {}, {}
    for r in extrair.linhas_csv(recursos[mes]):
        if r["Situacao_Folha"] != "ATIVO" or r["MesCompetencia"] != r["MesFolha"] or r["MesFolha"] != mes_folha:
            continue
        k = (r["Orgao"], r["NumFunc"], r["NumVinc"])
        if k not in decisao:
            decisao[k] = norm(r["Nome"]) in alvo or r["Orgao"] == sigla          # as pessoas do fundo e, do órgão da regra, todas (para o programa de desempenho)
        if not decisao[k]:
            continue
        p = reg.setdefault(k, {"nome": r["Nome"], "cargo": r["Cargo"], "unidade": r["CentroCusto"], "funcao": r["Funcao"], "rub": collections.defaultdict(float)})
        v = regras.para_float(r["Valor"])
        p["rub"][r["Rubrica"]] += v if r["VantagemDesconto"] == "V" else -v
    por_nome = collections.defaultdict(list)
    for (org, nf, nv), p in reg.items():
        rub = {k: round(v, 2) for k, v in p["rub"].items() if round(v, 2) != 0}
        corrente = sum(v for k, v in rub.items() if v > 0 and not NAO_CORRENTE.search(k))
        por_nome[norm(p["nome"])].append({"id": f"{nf}-{nv}", "org": org, "nome": p["nome"], "cargo": p["cargo"], "unidade": p["unidade"], "corrente": round(corrente, 2),
                                          "rub": sorted(([k, v, 0] for k, v in rub.items()), key=lambda x: (-x[1], x[0]))})
    return {n: max(v, key=lambda x: (x["org"] == sigla, x["corrente"])) for n, v in por_nome.items()}


def main():
    compl = json.load(open(os.path.join(RAIZ, "data", "cargos", "complementos.json"), encoding="utf-8"))
    pp = json.load(open(os.path.join(RAIZ, ".cache", "fundos", "complementos_pessoas.json"), encoding="utf-8"))
    sv = os.path.join(RAIZ, ".cache", "cargos", "servidores.json")
    mes_folha = json.load(open(sv))["mes"] if os.path.exists(sv) else sorted(k for k in extrair.listar_recursos() if re.fullmatch(r"\d{4}-\d{2}", k))[-1]
    janela = meses_ate(min(compl["ate"], mes_folha), 12)
    fundos, pessoas = [], []
    for it in compl["itens"]:
        serie = {m: {"pago": round(v["pago"] + v["rap"], 2), "favorecidos": v["favorecidos"]} for m, v in it["serie"].items()}
        total12 = sum(serie.get(m, {"pago": 0})["pago"] for m in janela)
        f = {"id": it["id"], "sigla": it["sigla"], "titulo": it["titulo"], "descricao": it["descricao"], "fundo": it["fundo"], "ugNome": it["ugNome"], "ug": it["ug"],
             "serie": serie, "componentes": it["componentes"], "beneficiarios": it["beneficiarios"], "total12": round(total12, 2), "janela": [janela[0], janela[-1]]}
        if it["beneficiarios"]:
            por = collections.defaultdict(lambda: collections.defaultdict(float))
            nomes = {}
            for regra, nome, cpf, mes, valor in pp:
                if regra != it["id"] or mes not in janela:
                    continue
                n = norm(nome)
                por[n][mes] += valor
                nomes[n] = (nome, cpf)
            folha = folha_das_pessoas(list(por), it["sigla"], mes_folha)
            lista = []
            for n, meses in por.items():
                total = sum(meses.values())
                if total < 1:
                    continue
                fo = folha.get(n)
                lista.append({"n": n, "nome": nomes[n][0], "sigla": it["sigla"], "fundo": it["id"], "total": round(total, 2), "media": round(total / 12, 2),
                              "meses": sum(1 for v in meses.values() if v > 0), "ultimo": round(meses.get(janela[-1], 0.0), 2),
                              "folha": fo})
            lista.sort(key=lambda p: -p["total"])
            ligadas = [p for p in lista if p["folha"]]
            f["resumo"] = {"pessoas": len(lista), "ligadasAFolha": len(ligadas),
                           "mediaMensal": round(sum(p["media"] for p in lista) / max(1, len(lista)), 2),
                           "mediaFolha": round(sum(p["folha"]["corrente"] for p in ligadas) / max(1, len(ligadas)), 2),
                           "mediaComFundo": round(sum(p["folha"]["corrente"] + p["media"] for p in ligadas) / max(1, len(ligadas)), 2)}
            # programa de remuneração por desempenho: pago pela folha (rubrica de bonificação), não pelo fundo; mostrado para dar a noção do conjunto
            doorgao = {n: p for n, p in folha.items() if p["org"] == it["sigla"]}
            valores = [v for p in doorgao.values() for r, v, c in p["rub"] if "BONIFICACAO DESEMPENHO" in r and v > 0]
            nomes_ben = {p["n"] for p in lista}
            nos_beneficiarios = [v for n, p in folha.items() if n in nomes_ben for r, v, c in p["rub"] if "BONIFICACAO DESEMPENHO" in r and v > 0]
            f["bonificacao"] = {"rubrica": "BONIFICACAO DESEMPENHO", "pessoas": len(valores), "mensal": round(sum(valores), 2),
                                "pessoasNosBeneficiarios": len(nos_beneficiarios), "mediaNosBeneficiarios": round(sum(nos_beneficiarios) / max(1, len(nos_beneficiarios)), 2)}
            pessoas += lista
            print(f"{it['id']}: {len(lista)} pessoas pagas nos 12 meses; {len(ligadas)} ligadas à folha de {mes_folha}; total R$ {total12 / 1e6:,.2f} mi")
        fundos.append(f)
    os.makedirs(SAIDA, exist_ok=True)
    with open(os.path.join(SAIDA, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"ate": compl["ate"], "folhaMes": mes_folha, "janela": [janela[0], janela[-1]], "fundos": fundos, "fonte": compl["fonte"]}, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(SAIDA, "pessoas.json"), "w", encoding="utf-8") as fh:
        json.dump({"folhaMes": mes_folha, "fundos": {f["id"]: {"titulo": f["titulo"], "fundo": f["fundo"]} for f in fundos}, "pessoas": pessoas}, fh, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
