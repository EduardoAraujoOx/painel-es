#!/usr/bin/env python3
"""Contratos das empresas estatais do Espírito Santo (Banestes e empresas do Sistema Financeiro, Bandes, Cesan, Ceturb-GV, ES Gás, Ceasa) a partir do CidadES.

Essas empresas não são órgãos do SIGA nem pagadoras no SIGEFES, mas prestam contas ao TCE-ES pelo CidadES. O conjunto de dados abertos "[TCEES] Contratações -
Controle Externo" (https://dados.es.gov.br/dataset/tcees-contratacoes) traz, no arquivo "Instrumentos contratuais com medições e alterações", uma linha por
instrumento, termo de alteração e medição, com a data e o valor do pagamento de cada medição. Este script lê o arquivo (cerca de 1,5 GB, em fluxo, sem gravar
em disco), fica com as empresas estatais e grava data/estatais/index.json (resumo por empresa e por ano) e data/estatais/emp/<empresa>.json (instrumentos com
fornecedor, valor, vigência, alterações e o pago por ano).

Os dados são declaratórios (remessas das próprias empresas ao CidadES): vigência e situação podem não refletir termos posteriores, e o pago é a soma dos
pagamentos informados nas medições. Só leitura, sem login.

Uso: python3 -I pipeline/estatais/cidades.py [arquivo.csv]   (sem argumento, baixa pela API do portal de dados abertos)
"""
import collections
import csv
import datetime
import io
import json
import os
import re
import subprocess
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESTINO = os.path.join(RAIZ, "data", "estatais")
CKAN = "https://dados.es.gov.br/api/3/action/package_show?id=tcees-contratacoes"
RECURSO = "Instrumentos contratuais com medições e alterações"

# Unidades gestoras de empresas estatais: (id da tela, nome curto, padrão do nome da unidade no CidadES).
EMPRESAS = [
    ("cesan", "Cesan", r"^Companhia Esp.rito Santense de Saneamento"),
    ("banestes", "Banestes", r"^Banco do Estado do Esp.rito Santo"),
    ("banestes-seguros", "Banestes Seguros", r"^Banestes Seguros"),
    ("banestes-dtvm", "Banestes DTVM", r"^Banestes Distribuidora"),
    ("banestes-corretora", "Banestes Corretora", r"^Banestes Administradora"),
    ("banestes-loteria", "Banestes Loteria", r"^Banestes Loteria"),
    ("bandes", "Bandes", r"^Banco de Desenvolvimento do Esp.rito Santo"),
    ("ceturb", "Ceturb-GV", r"^Companhia Estadual de Transportes Coletivos"),
    ("esgas", "ES Gás", r"^Companhia de G.s do Esp.rito Santo"),
    ("ceasa", "Ceasa-ES", r"^Centrais de Abastecimento"),
]
EMPRESAS_C = [(i, n, re.compile(p, re.I)) for i, n, p in EMPRESAS]
PUBLICIDADE = re.compile(r"publicid|propaganda|ag[eê]ncia de (publ|prop|comun)", re.I)
CAMPOS = ("ChaveInstrumento CodigoUnidadeGestoraReferencia NumeroInstrumentoContratacao AnoInstrumentoContratacao TipoInstrumento SituacaoInstrumento NomeContratado "
          "NumeroIdentificacaoContratado ObjetoInstrumento ObjetoContratacao ModalidadeLicitacao NumeroEdital AnoEdital DataAssinaturaInstrumentoContratacao "
          "InicioVigenciaContrato FimVigenciaContrato ValorTotalContratacaoInstrumento ValorAtualContratacaoInstrumento UrlInstrumentoContratacao "
          "NumeroProcessoAdministrativo").split()


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def numero(s):
    """Valor do CSV ('9000000,00', '1.234,56', '12.5') como float; 0.0 se vazio ou inválido."""
    s = (s or "").strip().replace(" ", "")
    if not s:
        return 0.0
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def empresa_da_unidade(nome):
    """(id, nome curto) da empresa estatal a que pertence a unidade gestora, ou None."""
    for i, n, rx in EMPRESAS_C:
        if rx.search(nome or ""):
            return i, n
    return None


def ano(data):
    m = re.match(r"(\d{4})-\d\d-\d\d", data or "")
    return m.group(1) if m else ""


def ler(linhas):
    """Agrupa as linhas do arquivo por instrumento (só empresas estatais): {chave: {'dados': {...}, 'empresa': id, 'alteracoes': {...}, 'medicoes': {...}}}."""
    inst = {}
    for r in linhas:
        if r.get("NomeEsferaAdministrativa") != "Estado do Espírito Santo":
            continue
        emp = empresa_da_unidade(r.get("NomeUnidadeGestoraReferencia"))
        if not emp:
            continue
        k = r["ChaveInstrumento"]
        x = inst.get(k)
        if x is None:
            x = inst[k] = {"dados": {c: r.get(c, "") for c in CAMPOS}, "empresa": emp[0], "alteracoes": {}, "medicoes": {}}
        if r.get("NumeroTermoContratualAlteracao") or r.get("TipoTermoContratualAlteracao"):
            a = (r.get("NumeroTermoContratualAlteracao", ""), r.get("AnoTermoContratualAlteracao", ""), r.get("TipoTermoContratualAlteracao", ""), r.get("DataAssinaturaTermoAlteracaoContratual", ""))
            x["alteracoes"][a] = (r.get("DescricaoAlteracao", "")[:160], numero(r.get("ValorTotalContratacaoAlteracao")))
        if r.get("NumeroMedicao") or r.get("DataPagamento") or r.get("ValorPagamento"):
            m = (r.get("NumeroMedicao", ""), r.get("AnoMedicao", ""), r.get("DataInicioMedicao", ""), r.get("DataFimMedicao", ""), r.get("ValorTotalMedicao", ""), r.get("DataPagamento", ""), r.get("ValorPagamento", ""))
            x["medicoes"][m] = 1
    return inst


def compactar(x):
    """Instrumento no formato gravado: campos curtos, pago por ano de pagamento e as alterações (até 6)."""
    d = x["dados"]
    pago, ult, nmed = collections.defaultdict(float), "", 0
    for m in x["medicoes"]:
        v = numero(m[6])
        nmed += 1
        a = ano(m[5]) or ano(m[3]) or m[1][:4]
        if v and a:
            pago[a] += v
        if m[5] and m[5][:10] > ult and v:
            ult = m[5][:10]
    objeto = (d["ObjetoInstrumento"] or d["ObjetoContratacao"]).strip()
    alt = sorted(x["alteracoes"].items(), key=lambda kv: kv[0][3])
    return {"chave": d["ChaveInstrumento"], "numero": d["NumeroInstrumentoContratacao"].strip(), "ano": d["AnoInstrumentoContratacao"], "tipo": d["TipoInstrumento"], "situacao": d["SituacaoInstrumento"],
            "forn": d["NomeContratado"].strip(), "cnpj": re.sub(r"\D", "", d["NumeroIdentificacaoContratado"]), "objeto": objeto[:240],
            "modalidade": " ".join(filter(None, [d["ModalidadeLicitacao"].strip(), d["NumeroEdital"].strip().lstrip("0") and ("nº " + d["NumeroEdital"].strip() + ("/" + d["AnoEdital"] if d["AnoEdital"] else ""))])),
            "assinatura": d["DataAssinaturaInstrumentoContratacao"][:10], "ini": d["InicioVigenciaContrato"][:10], "fim": d["FimVigenciaContrato"][:10],
            "valorInicial": numero(d["ValorTotalContratacaoInstrumento"]), "valorAtual": numero(d["ValorAtualContratacaoInstrumento"]) or numero(d["ValorTotalContratacaoInstrumento"]),
            "url": d["UrlInstrumentoContratacao"], "processo": d["NumeroProcessoAdministrativo"], "publicidade": bool(PUBLICIDADE.search(objeto)),
            "pagoAno": {a: round(v, 2) for a, v in sorted(pago.items())}, "pago": round(sum(pago.values()), 2), "medicoes": nmed, "ultimoPagamento": ult,
            "alteracoes": [[a[2], a[3][:10], desc[:120], v] for a, (desc, v) in alt[:6]], "nAlteracoes": len(alt)}


def montar(inst):
    """(index, {empresa: [instrumentos]}) a partir do agrupamento de `ler`."""
    por = collections.defaultdict(list)
    for x in inst.values():
        por[x["empresa"]].append(compactar(x))
    nomes = {i: n for i, n, _ in EMPRESAS}
    resumo = []
    for i, n, _ in EMPRESAS:
        lista = sorted(por.get(i, []), key=lambda c: (-c["pago"], -c["valorAtual"]))
        if not lista:
            continue
        pago_ano = collections.defaultdict(float)
        for c in lista:
            for a, v in c["pagoAno"].items():
                pago_ano[a] += v
        pub = [c for c in lista if c["publicidade"]]
        resumo.append({"id": i, "nome": n, "instrumentos": len(lista), "fornecedores": len({c["cnpj"] or c["forn"] for c in lista}), "valorAtual": round(sum(c["valorAtual"] for c in lista), 2),
                       "pago": round(sum(c["pago"] for c in lista), 2), "pagoAno": {a: round(v, 2) for a, v in sorted(pago_ano.items())},
                       "publicidade": {"instrumentos": len(pub), "pago": round(sum(c["pago"] for c in pub), 2)}, "arquivo": f"emp/{i}"})
        por[i] = lista
    return resumo, por


def recurso_url():
    p = subprocess.run(["curl", "-sS", "-m", "90", CKAN], capture_output=True, text=True)
    for r in json.loads(p.stdout)["result"]["resources"]:
        if r["name"].strip() == RECURSO:
            return r["url"]
    raise RuntimeError(f"recurso '{RECURSO}' não encontrado")


def linhas_de(origem):
    if os.path.exists(origem):
        yield from csv.DictReader(open(origem, encoding="cp1252", errors="replace", newline=""), delimiter=";")
        return
    p = subprocess.Popen(["curl", "-sS", "-L", "--fail", origem], stdout=subprocess.PIPE)
    yield from csv.DictReader(io.TextIOWrapper(p.stdout, encoding="cp1252", errors="replace", newline=""), delimiter=";")
    if p.wait() != 0:
        raise RuntimeError("falha no download do arquivo de medições do CidadES")


def main():
    csv.field_size_limit(10 ** 9)
    origem = sys.argv[1] if len(sys.argv) > 1 else recurso_url()
    inst = ler(linhas_de(origem))
    resumo, por = montar(inst)
    if not resumo:
        sys.exit("nenhuma empresa estatal encontrada no arquivo")
    os.makedirs(os.path.join(DESTINO, "emp"), exist_ok=True)
    for i, lista in por.items():
        with open(os.path.join(DESTINO, "emp", i + ".json"), "w", encoding="utf-8") as f:
            json.dump({"empresa": next(n for e, n, _ in EMPRESAS if e == i), "instrumentos": lista}, f, ensure_ascii=False, separators=(",", ":"))
    index = {"geradoEm": datetime.date.today().isoformat(), "fonte": "TCE-ES, CidadES (dados abertos: Contratações - Controle Externo, instrumentos com medições e alterações)",
             "aviso": "Dados declaratórios das empresas ao CidadES: vigência e situação podem não refletir termos posteriores; o pago é a soma dos pagamentos informados nas medições.",
             "empresas": resumo}
    with open(os.path.join(DESTINO, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    for r in resumo:
        print(f"{r['nome']}: {r['instrumentos']} instrumentos, {r['fornecedores']} fornecedores, valor R$ {r['valorAtual']:,.0f}, pago R$ {r['pago']:,.0f}; publicidade {r['publicidade']['instrumentos']} (R$ {r['publicidade']['pago']:,.0f})")
    print("→", DESTINO)


if __name__ == "__main__":
    main()
