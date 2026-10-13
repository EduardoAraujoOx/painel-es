#!/usr/bin/env python3
"""Cruza os ocupantes de cargo em comissão e função gratificada com as doações de campanha (TSE).

Identificação. A base de vínculos dos servidores (dados abertos do ES) traz o CPF mascarado, mas com os seis dígitos
do meio visíveis (***.123.456-**); a prestação de contas do TSE traz o CPF do doador inteiro. Considera-se a mesma
pessoa quando o nome normalizado é igual E os seis dígitos do meio são iguais. É uma regra forte: nos ocupantes
testados não houve nenhuma chave repetida (nenhum homônimo com o mesmo miolo de CPF).

O que se mede. Só doações de pessoa física a candidatos (arquivos receitas_candidatos), em 2018, 2022 e 2026 (esta
parcial, até a data de geração do arquivo do TSE). Doações a partidos, doação do próprio candidato a si e
doações de pessoa jurídica ficam de fora. Executivo = governador (ES) e presidente; Legislativo = deputado estadual,
deputado federal e senador (ES).

Saídas:
  data/politico/index.json   agregados, sem nomes de pessoas;
  data/politico/pessoas.json lista nominal (dado pessoal sensível). Por decisão do dono, é versionada e servida com o painel
                             aberto; para restringir à senha, ver SO_COM_SENHA em api/dados.js.

Uso: python3 -I pipeline/cargos/politico.py [--atualizar-mascaras]
Antes: pipeline/cargos/extrair.py (folha) e downloads em .cache/politico (ver baixar() abaixo).
"""
import collections
import csv
import glob
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extrair  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "politico")
CACHE_CARGOS = os.path.join(RAIZ, ".cache", "cargos")
DESTINO = os.path.join(RAIZ, "data", "politico")
TSE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
ANOS = (2018, 2022, 2026)
EXECUTIVO = ("Governador", "Presidente")
LEGISLATIVO = ("Deputado Estadual", "Deputado Federal", "Senador")
# O arquivo consulta_cand do TSE não atualiza o resultado final de quem foi eleito no 2º turno (em 2022 o governador
# eleito ainda consta como "2º TURNO"). Resultados do 2º turno já encerrados, conferidos na divulgação do TSE:
ELEITOS_NO_2_TURNO = {"80001649123"}   # 2022: José Renato Casagrande (PSB), governador do ES


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z ]", "", s).strip()


def baixar(url, destino):
    if not os.path.exists(destino):
        subprocess.run(["curl", "-sSL", "--retry", "5", "--fail", "-C", "-", "-o", destino, url], check=True)
    return destino


def ocupantes():
    """Ocupantes (cargo em comissão ou função gratificada) na folha do último mês extraído."""
    arq = sorted(glob.glob(os.path.join(CACHE_CARGOS, "20??-??.json")))[-1]
    f = json.load(open(arq, encoding="utf-8"))
    return f["mes"], {(r[1], r[2]): {"sigla": r[0], "nome": r[3], "cargo": r[4], "tipo": r[5], "orgao": r[6]} for r in f["registros"]}


def mascaras(chaves, atualizar=False):
    """(NumFunc, NumVinc) -> (nome normalizado, 6 dígitos do meio do CPF), da base de vínculos."""
    caminho = os.path.join(CACHE_CARGOS, "mascaras.json")
    if os.path.exists(caminho) and not atualizar:
        return {tuple(k.split("|")): tuple(v) for k, v in json.load(open(caminho)).items()}
    url = extrair.listar_recursos()["vinculos"]
    saida = {}
    for r in extrair.linhas_csv(url):
        k = (r["NumFunc"], r["NumVinc"])
        if k in chaves and r["Situacao"] == "ATIVO":
            m = re.match(r"\*\*\*\.(\d{3})\.(\d{3})-\*\*", r["Cpf"] or "")
            if m:
                saida[k] = (norm(r["Nome"]), m.group(1) + m.group(2))
    json.dump({"|".join(k): v for k, v in saida.items()}, open(caminho, "w"))
    return saida


def abrir_csv(z, nome):
    amostra = z.open(nome).read(65536)
    try:
        amostra.decode("utf-8")
        enc = "utf-8"
    except UnicodeDecodeError:
        enc = "latin-1"
    return csv.reader(io.TextIOWrapper(z.open(nome), encoding=enc, newline=""), delimiter=";")


def num(s):
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def zip_do_ano(ano):
    if ano == 2022 and os.path.exists(os.path.join(RAIZ, ".cache", "contratos", "ext", "tse22.zip")):
        return os.path.join(RAIZ, ".cache", "contratos", "ext", "tse22.zip")
    return baixar(f"{TSE}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{ano}.zip", os.path.join(CACHE, f"pc{ano}.zip"))


def situacao_candidatos(ano):
    """SQ_CANDIDATO -> {eleito}, de consulta_cand (ES e presidente)."""
    z = zipfile.ZipFile(baixar(f"{TSE}/consulta_cand/consulta_cand_{ano}.zip", os.path.join(CACHE, f"cc{ano}.zip")))
    saida = {}
    for nome in (f"consulta_cand_{ano}_ES.csv", f"consulta_cand_{ano}_BR.csv", f"consulta_cand_{ano}_BRASIL.csv"):
        if nome not in z.namelist():
            continue
        rd = abrir_csv(z, nome)
        cab = next(rd)
        ix = {c: i for i, c in enumerate(cab)}
        for c in rd:
            if len(c) < len(cab):
                continue
            sit = c[ix["DS_SIT_TOT_TURNO"]].upper() if "DS_SIT_TOT_TURNO" in ix else ""
            sq = c[ix["SQ_CANDIDATO"]]
            if sq in ELEITOS_NO_2_TURNO or ("ELEITO" in sit and "NÃO" not in sit and "NAO" not in sit):
                resultado = "eleito"
            elif "NÃO ELEITO" in sit or "NAO ELEITO" in sit:
                resultado = "nao"
            elif "2º TURNO" in sit or "2 TURNO" in sit:
                resultado = "segundo-turno"
            else:
                resultado = "sem-resultado"
            saida[sq] = {"resultado": resultado}
    return saida


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(DESTINO, exist_ok=True)
    mes, ocup = ocupantes()
    masc = mascaras(ocup, "--atualizar-mascaras" in sys.argv)
    indice = collections.defaultdict(list)
    for k, (nome, m6) in masc.items():
        indice[(nome, m6)].append(k)
    repetidas = sum(1 for v in indice.values() if len(v) > 1)
    print(f"ocupantes na folha {mes}: {len(ocup)} | com máscara de CPF: {len(masc)} | chaves repetidas: {repetidas}", flush=True)

    doacoes = collections.defaultdict(float)     # (chave pessoa, ano, sq) -> valor
    contagem = collections.Counter()
    candidatos = {}                              # (ano, sq) -> dados do candidato
    tse_info = {}
    for ano in ANOS:
        z = zipfile.ZipFile(zip_do_ano(ano))
        situ = situacao_candidatos(ano)
        for nome in (f"receitas_candidatos_{ano}_ES.csv", f"receitas_candidatos_{ano}_BR.csv"):
            if nome not in z.namelist():
                continue
            rd = abrir_csv(z, nome)
            cab = next(rd)
            ix = {c: i for i, c in enumerate(cab)}
            lidas = achadas = 0
            for c in rd:
                if len(c) < len(cab):
                    continue
                if ano not in tse_info and "DT_GERACAO" in ix:
                    tse_info[ano] = c[ix["DT_GERACAO"]]
                cargo, uf = c[ix["DS_CARGO"]], c[ix["SG_UF"]]
                if not ((cargo == "Governador" and uf == "ES") or cargo == "Presidente" or (cargo in LEGISLATIVO and uf == "ES")):
                    continue
                doc = re.sub(r"\D", "", c[ix["NR_CPF_CNPJ_DOADOR"]])
                if len(doc) != 11:
                    continue
                lidas += 1
                if doc == re.sub(r"\D", "", c[ix["NR_CPF_CANDIDATO"]]) or norm(c[ix["NM_DOADOR"]]) == norm(c[ix["NM_CANDIDATO"]]):
                    continue                              # doação do candidato a si mesmo (em 2026 o CPF do candidato não vem no arquivo: vale o nome)
                for campo in ("NM_DOADOR_RFB", "NM_DOADOR"):
                    k = (norm(c[ix[campo]]), doc[3:9])
                    if k in indice:
                        sq = c[ix["SQ_CANDIDATO"]]
                        v = num(c[ix["VR_RECEITA"]])
                        for pessoa in indice[k]:
                            doacoes[(pessoa, ano, sq)] += v
                            contagem[(pessoa, ano, sq)] += 1
                        candidatos.setdefault((ano, sq), {"ano": ano, "cargo": cargo, "uf": uf, "nome": c[ix["NM_CANDIDATO"]], "partido": c[ix["SG_PARTIDO"]],
                                                          "grupo": "executivo" if cargo in EXECUTIVO else "legislativo", **situ.get(sq, {"resultado": "sem-resultado"})})
                        achadas += 1
                        break
            print(f"TSE {ano} {nome}: doações de pessoa física lidas {lidas}, de ocupantes {achadas}", flush=True)

    # pessoas
    por_pessoa = collections.defaultdict(list)
    for (pessoa, ano, sq), v in doacoes.items():
        por_pessoa[pessoa].append((ano, sq, v, contagem[(pessoa, ano, sq)]))
    pessoas = []
    for pessoa, lista in por_pessoa.items():
        o = ocup[pessoa]
        pessoas.append({"nome": o["nome"], "sigla": o["sigla"], "orgao": o["orgao"], "cargo": o["cargo"], "tipo": o["tipo"],
                        "doacoes": sorted([[ano, sq, round(v, 2), n] for ano, sq, v, n in lista])})
    pessoas.sort(key=lambda p: -sum(d[2] for d in p["doacoes"]))

    # agregados (sem nomes de pessoas)
    por_cand = {}
    for (pessoa, ano, sq), v in doacoes.items():
        c = por_cand.setdefault((ano, sq), {"pessoas": set(), "valor": 0.0, "doacoes": 0})
        c["pessoas"].add(pessoa)
        c["valor"] += v
        c["doacoes"] += contagem[(pessoa, ano, sq)]
    cands = []
    for (ano, sq), info in candidatos.items():
        a = por_cand[(ano, sq)]
        cands.append({"sq": sq, **info, "pessoas": len(a["pessoas"]), "valor": round(a["valor"], 2), "doacoes": a["doacoes"]})
    cands.sort(key=lambda c: (c["grupo"] != "executivo", -c["ano"], -c["valor"]))

    def grupo(g, ano=None):
        ps = {p for (p, a, sq) in doacoes if candidatos[(a, sq)]["grupo"] == g and (ano is None or a == ano)}
        v = sum(x for (p, a, sq), x in doacoes.items() if candidatos[(a, sq)]["grupo"] == g and (ano is None or a == ano))
        return {"pessoas": len(ps), "valor": round(v, 2)}

    # governadores: a mesma pessoa pode ter disputado mais de uma eleição; conta-se cada ocupante uma vez por candidato
    chefes = {}
    for (pessoa, ano, sq), v in doacoes.items():
        c = candidatos[(ano, sq)]
        if c["cargo"] != "Governador":
            continue
        h = chefes.setdefault(norm(c["nome"]), {"nome": c["nome"], "partido": c["partido"], "anos": set(), "pessoas": set(), "valor": 0.0, "resultados": {}})
        h["anos"].add(ano)
        h["pessoas"].add(pessoa)
        h["valor"] += v
        h["resultados"][ano] = c["resultado"]
    chefes = sorted(({"nome": h["nome"], "partido": h["partido"], "anos": sorted(h["anos"]), "pessoas": len(h["pessoas"]), "valor": round(h["valor"], 2), "resultados": {str(a): r for a, r in h["resultados"].items()}}
                     for h in chefes.values()), key=lambda h: (-max(h["anos"]), -h["pessoas"]))
    total_orgao = collections.Counter(o["sigla"] for o in ocup.values())
    nome_orgao = {o["sigla"]: o["orgao"] for o in ocup.values()}
    por_orgao = {g: collections.Counter() for g in ("executivo", "legislativo")}
    por_orgao_valor = {g: collections.defaultdict(float) for g in ("executivo", "legislativo")}
    vistos = set()
    for (pessoa, ano, sq), v in doacoes.items():
        g = candidatos[(ano, sq)]["grupo"]
        if (pessoa, g) not in vistos:
            vistos.add((pessoa, g))
            por_orgao[g][ocup[pessoa]["sigla"]] += 1
        por_orgao_valor[g][ocup[pessoa]["sigla"]] += v
    orgaos = sorted({s for g in por_orgao for s in por_orgao[g]}, key=lambda s: -por_orgao["executivo"][s] - por_orgao["legislativo"][s])
    saida = {
        "folha": mes, "tse": {str(a): tse_info.get(a, "") for a in ANOS}, "parcial": [2026],
        "universo": {"ocupantes": len(ocup), "comMascara": len(masc), "cc": sum(1 for o in ocup.values() if o["tipo"] == "CC"), "fg": sum(1 for o in ocup.values() if o["tipo"] == "FG")},
        "executivo": grupo("executivo"), "legislativo": grupo("legislativo"),
        "executivoPorAno": {str(a): grupo("executivo", a) for a in ANOS}, "legislativoPorAno": {str(a): grupo("legislativo", a) for a in ANOS},
        "pessoasDistintas": len(pessoas),
        "candidatos": cands, "governadores": chefes,
        "orgaos": [{"sigla": s, "nome": nome_orgao[s], "ocupantes": total_orgao[s], "executivo": por_orgao["executivo"][s], "legislativo": por_orgao["legislativo"][s],
                    "valorExecutivo": round(por_orgao_valor["executivo"][s], 2), "valorLegislativo": round(por_orgao_valor["legislativo"][s], 2)} for s in orgaos],
    }
    json.dump(saida, open(os.path.join(DESTINO, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"folha": mes, "candidatos": {f"{a}|{sq}": c["nome"] for (a, sq), c in candidatos.items()}, "pessoas": pessoas},
              open(os.path.join(DESTINO, "pessoas.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"pessoas distintas: {len(pessoas)} | executivo: {saida['executivo']} | legislativo: {saida['legislativo']}")
    for c in cands:
        if c["grupo"] == "executivo":
            print(f"  {c['ano']} {c['cargo']:<10} {c['nome'][:38]:<38} {c['partido']:<8} {c['resultado']:<13} pessoas={c['pessoas']:>3} R$ {c['valor']:>10.0f}")


if __name__ == "__main__":
    main()
