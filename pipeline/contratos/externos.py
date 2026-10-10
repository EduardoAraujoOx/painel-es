#!/usr/bin/env python3
"""Cruza os fornecedores do Estado com três bases públicas externas e guarda o resultado em .cache/contratos/ext/:

  pgfn.json     dívida ativa com a União (PGFN: previdenciária, FGTS e não previdenciária), por raiz de CNPJ;
  sancoes.json  sanções do CEIS (inidôneas e suspensas) e do CNEP (Lei Anticorrupção), por CNPJ e por sócio;
  tse.json      doações eleitorais de sócios (candidatos e órgãos partidários, 2018 a 2024), sócios que foram
                candidatos e fornecedores pagos por campanhas.

Ligação com os sócios: a Receita mascara o CPF (***123456**: dígitos 4 a 9) e o TSE e a CGU trazem o CPF
inteiro. Um sócio só é dado como o mesmo doador, candidato ou sancionado quando NOME IGUAL e OS SEIS DÍGITOS
conferem. É um critério forte, mas não infalível: a conferência final é humana.

Os arquivos grandes são baixados para uma pasta temporária (que é apagada) e lidos em fluxo.
Uso: python3 -I pipeline/contratos/externos.py [pgfn] [sancoes] [tse2018 tse2020 tse2022 tse2024]   (sem argumentos: tudo; rode os anos do TSE em processos separados para ir mais rápido)
"""
import csv
import datetime
import glob
import io
import json
import os
import re
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regras as R  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
EXT = os.path.join(CACHE, "ext")
TMP = os.path.join(EXT, "tmp")
PGFN = "https://dadosabertos.pgfn.gov.br"
TSE = "https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas"
CGU = "https://portaldatransparencia.gov.br/download-de-dados"
ANOS_TSE = (2018, 2020, 2022, 2024)
csv.field_size_limit(1 << 24)


def baixar(url, destino):
    p = subprocess.run(["curl", "-sSL", "--fail", "-m", "3000", "--retry", "3", "--retry-delay", "5", "-o", destino, url], capture_output=True)
    if p.returncode:
        raise RuntimeError(f"{url}: {p.stderr.decode()[:200]}")


def digitos(s):
    return re.sub(r"\D", "", s or "")


def carregar_receita():
    return json.load(open(os.path.join(CACHE, "receita.json")))


def chaves_socios(receita):
    """(nome, seis dígitos do meio do CPF) -> CNPJs-raiz dos fornecedores em que a pessoa é sócia."""
    chaves = {}
    for raiz, socios in receita["socios"].items():
        for ident, nome, cpf, *_ in socios:
            m = re.fullmatch(r"\*\*\*(\d{6})\*\*", cpf or "")
            if ident == "2" and m:
                chaves.setdefault((R.norm_nome(nome), m.group(1)), set()).add(raiz)
    return chaves


def chave_cpf(nome, cpf):
    d = digitos(cpf)
    return (R.norm_nome(nome), d[3:9]) if len(d) == 11 else None


def leitor(zf, nome):
    return csv.reader(io.TextIOWrapper(zf.open(nome), encoding="latin-1", newline=""), delimiter=";")


def num(s):
    try:
        return float((s or "0").replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


# ----------------------------------------------------------------------------------------- PGFN
def pgfn(receita):
    raizes = {r for r in receita["empresas"]}
    formatados = {f"{r[:2]}.{r[2:5]}.{r[5:8]}".encode() for r in raizes}
    por_raiz = {}
    linhas = 0
    for nome, tipo in (("Dados_abertos_FGTS", "fgts"), ("Dados_abertos_Previdenciario", "prev"), ("Dados_abertos_Nao_Previdenciario", "naoprev")):
        destino = os.path.join(TMP, nome + ".zip")
        print(f"PGFN: baixando {nome}…", flush=True)
        baixar(f"{PGFN}/{nome}.zip", destino)
        with zipfile.ZipFile(destino) as z:
            for arq in z.namelist():
                if not arq.lower().endswith(".csv"):
                    continue
                with z.open(arq) as f:
                    cab = f.readline().decode("latin-1").rstrip("\r\n").split(";")
                    cab = [c.strip().strip('"') for c in cab]
                    i = {c: cab.index(c) for c in ("CPF_CNPJ", "TIPO_SITUACAO_INSCRICAO", "INDICADOR_AJUIZADO", "VALOR_CONSOLIDADO", "DATA_INSCRICAO")}
                    for linha in f:
                        linhas += 1
                        ini = linha.lstrip(b'"')[:10]
                        if ini not in formatados:
                            continue
                        c = linha.decode("latin-1").rstrip("\r\n").split(";")
                        c = [x.strip('"') for x in c]
                        raiz = digitos(c[i["CPF_CNPJ"]])[:8]
                        d = por_raiz.setdefault(raiz, {"total": 0.0, "n": 0, "tipos": {}, "situ": {}, "ajuizado": 0.0, "primeira": ""})
                        v = num(c[i["VALOR_CONSOLIDADO"]].replace(".", ",")) if "," in c[i["VALOR_CONSOLIDADO"]] else float(c[i["VALOR_CONSOLIDADO"]] or 0)
                        d["total"] += v
                        d["n"] += 1
                        d["tipos"][tipo] = d["tipos"].get(tipo, 0.0) + v
                        s = c[i["TIPO_SITUACAO_INSCRICAO"]]
                        d["situ"][s] = d["situ"].get(s, 0.0) + v
                        if c[i["INDICADOR_AJUIZADO"]].upper().startswith("S"):
                            d["ajuizado"] += v
                        dt = c[i["DATA_INSCRICAO"]]
                        iso = f"{dt[6:10]}-{dt[3:5]}-{dt[:2]}" if len(dt) >= 10 else ""
                        if iso and (not d["primeira"] or iso < d["primeira"]):
                            d["primeira"] = iso
        os.remove(destino)
        print(f"PGFN: {nome} lido; {len(por_raiz)} raízes com dívida até agora ({linhas} linhas)", flush=True)
    for d in por_raiz.values():
        d["total"] = round(d["total"], 2)
        d["ajuizado"] = round(d["ajuizado"], 2)
        d["tipos"] = {k: round(v, 2) for k, v in d["tipos"].items()}
        d["situ"] = {k: round(v, 2) for k, v in d["situ"].items()}
    json.dump({"base": "Dívida ativa da União — PGFN, dados abertos (arquivos de " + datetime.date.today().isoformat() + ")", "raizes": por_raiz},
              open(os.path.join(EXT, "pgfn.json"), "w"), ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------------------------------- CEIS / CNEP
def sancoes(receita, chaves):
    cnpjs = {c for c in receita["estab"]}
    raizes = {c[:8] for c in cnpjs}
    achados = {"cnpj": {}, "socio": {}}
    hoje = datetime.date.today()
    for tentativa in range(0, 12):
        dia = (hoje - datetime.timedelta(days=tentativa)).strftime("%Y%m%d")
        ok = True
        arquivos = {}
        for cad in ("ceis", "cnep"):
            destino = os.path.join(TMP, f"{cad}.zip")
            try:
                baixar(f"{CGU}/{cad}/{dia}", destino)
                arquivos[cad] = destino
            except RuntimeError:
                ok = False
                break
        if ok:
            break
    else:
        raise RuntimeError("CEIS/CNEP: nenhuma data recente disponível")
    for cad, destino in arquivos.items():
        with zipfile.ZipFile(destino) as z:
            for arq in z.namelist():
                rd = leitor(z, arq)
                cab = next(rd)
                ix = {c.strip().upper(): n for n, c in enumerate(cab)}
                def g(c, nome):
                    for k, n in ix.items():
                        if k.startswith(nome):
                            return c[n]
                    return ""
                for c in rd:
                    doc = digitos(g(c, "CPF OU CNPJ"))
                    item = {"cad": cad.upper(), "tipo": g(c, "CATEGORIA DA SAN"), "ini": g(c, "DATA INÍCIO SAN") or g(c, "DATA IN"), "fim": g(c, "DATA FINAL SAN") or g(c, "DATA FIM"),
                            "orgao": g(c, "ÓRGÃO SANCIONADOR")[:90], "esfera": g(c, "ESFERA"), "uf": g(c, "UF ÓRGÃO"), "proc": g(c, "NÚMERO DO PROCESSO"), "nome": g(c, "NOME DO SANCIONADO")}
                    if len(doc) == 14 and (doc in cnpjs or doc[:8] in raizes):
                        achados["cnpj"].setdefault(doc, []).append(item)
                    elif len(doc) == 11:
                        k = chave_cpf(item["nome"], doc)
                        if k and k in chaves:
                            achados["socio"].setdefault("|".join(k), []).append(item)
        os.remove(destino)
    json.dump({"base": f"CEIS e CNEP — Portal da Transparência (CGU), arquivo de {dia}", "dia": dia, **achados}, open(os.path.join(EXT, "sancoes.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"sanções: {len(achados['cnpj'])} CNPJs e {len(achados['socio'])} sócios sancionados ({dia})", flush=True)


# ----------------------------------------------------------------------------------------- TSE
def tse(receita, chaves, anos=ANOS_TSE):
    cnpjs = {c for c in receita["estab"]}
    raizes = {c[:8] for c in cnpjs}
    for ano in anos:
        doacoes, candidatos, despesas, doacoes_pj = {}, {}, {}, {}
        for tipo, nome in (("candidatos", f"prestacao_de_contas_eleitorais_candidatos_{ano}"), ("partidos", f"prestacao_de_contas_eleitorais_orgaos_partidarios_{ano}")):
            destino = os.path.join(TMP, nome + ".zip")
            print(f"TSE {ano} ({tipo}): baixando…", flush=True)
            baixar(f"{TSE}/{nome}.zip", destino)
            with zipfile.ZipFile(destino) as z:
                nomes = z.namelist()
                def escolher(prefixo):
                    todos = [n for n in nomes if re.match(rf"^{prefixo}_{ano}_BRASIL\.csv$", n)]
                    return todos or [n for n in nomes if re.match(rf"^{prefixo}_{ano}_[A-Z]{{2}}\.csv$", n)]
                for arq in escolher("receitas_candidatos" if tipo == "candidatos" else "receitas_orgaos_partidarios"):
                    rd = leitor(z, arq)
                    cab = next(rd)
                    ix = {c: n for n, c in enumerate(cab)}
                    n_ = len(cab)
                    for c in rd:
                        if len(c) < n_:
                            continue
                        doc = digitos(c[ix["NR_CPF_CNPJ_DOADOR"]])
                        valor = num(c[ix["VR_RECEITA"]])
                        cand = c[ix["NM_CANDIDATO"]] if "NM_CANDIDATO" in ix else ""
                        cargo = c[ix["DS_CARGO"]] if "DS_CARGO" in ix else "Órgão partidário"
                        uf = c[ix["SG_UF"]]
                        partido = c[ix["SG_PARTIDO"]] if "SG_PARTIDO" in ix else ""
                        if len(doc) == 14 and (doc in cnpjs or doc[:8] in raizes):
                            k = (doc, ano, cand, cargo, uf, partido, tipo)
                            doacoes_pj[k] = doacoes_pj.get(k, 0.0) + valor
                            continue
                        if len(doc) != 11:
                            continue
                        d3 = doc[3:9]
                        chave = None
                        for campo in ("NM_DOADOR_RFB", "NM_DOADOR"):
                            k = (R.norm_nome(c[ix[campo]]), d3)
                            if k in chaves:
                                chave = k
                                break
                        if chave:
                            k = (chave, ano, cand, cargo, uf, partido, tipo)
                            a = doacoes.setdefault(k, [0.0, 0])
                            a[0] += valor
                            a[1] += 1
                if tipo == "candidatos":
                    # candidatos que são sócios de fornecedores (CPF do candidato nas próprias receitas)
                    for arq in escolher("receitas_candidatos"):
                        rd = leitor(z, arq)
                        cab = next(rd)
                        ix = {c: n for n, c in enumerate(cab)}
                        vistos = set()
                        for c in rd:
                            if len(c) < len(cab):
                                continue
                            k = chave_cpf(c[ix["NM_CANDIDATO"]], c[ix["NR_CPF_CANDIDATO"]])
                            if k and k in chaves:
                                reg = (k, ano, c[ix["DS_CARGO"]], c[ix["SG_UF"]], c[ix["SG_PARTIDO"]], c[ix["NM_CANDIDATO"]])
                                if reg not in vistos:
                                    vistos.add(reg)
                                    candidatos[reg] = 1
                    for arq in escolher("despesas_contratadas_candidatos"):
                        rd = leitor(z, arq)
                        cab = next(rd)
                        ix = {c: n for n, c in enumerate(cab)}
                        for c in rd:
                            if len(c) < len(cab):
                                continue
                            doc = digitos(c[ix["NR_CPF_CNPJ_FORNECEDOR"]])
                            if len(doc) == 14 and doc in cnpjs:
                                k = (doc, ano, c[ix["NM_CANDIDATO"]], c[ix["DS_CARGO"]], c[ix["SG_UF"]], c[ix["SG_PARTIDO"]])
                                despesas[k] = despesas.get(k, 0.0) + num(c[ix["VR_DESPESA_CONTRATADA"]])
            os.remove(destino)
        print(f"TSE {ano}: {len(doacoes)} grupos de doação de sócios, {len(candidatos)} candidatos-sócios, {len(despesas)} pagamentos de campanha a fornecedores", flush=True)
        json.dump({"base": f"TSE — prestação de contas eleitorais (candidatos e órgãos partidários), eleição de {ano}", "ano": ano,
                   "doacoes": [[list(k[0]), *k[1:], round(v[0], 2), v[1]] for k, v in doacoes.items()],
                   "doacoes_pj": [[*k, round(v, 2)] for k, v in doacoes_pj.items()],
                   "candidatos": [[list(k[0]), *k[1:]] for k in candidatos],
                   "despesas": [[*k, round(v, 2)] for k, v in despesas.items()]},
                  open(os.path.join(EXT, f"tse_{ano}.json"), "w"), ensure_ascii=False, separators=(",", ":"))


def main():
    partes = sys.argv[1:] or ["sancoes", "tse", "pgfn"]
    os.makedirs(TMP, exist_ok=True)
    receita = carregar_receita()
    chaves = chaves_socios(receita)
    print(f"{len(receita['empresas'])} empresas e {len(chaves)} sócios (pessoa física) a procurar", flush=True)
    if "sancoes" in partes:
        sancoes(receita, chaves)
    for p in partes:
        if p.startswith("tse"):
            tse(receita, chaves, [int(p[3:])] if p[3:] else ANOS_TSE)
    if "pgfn" in partes:
        pgfn(receita)


if __name__ == "__main__":
    main()
