#!/usr/bin/env python3
"""Lê o Diário Oficial do Espírito Santo (Imprensa Oficial, DIO/ES) e guarda os atos que citam contratos: rescisões, aditivos, prorrogações,
apostilamentos, penalidades e extratos.

Por que existe: o SIGA e o PNCP atrasam ou omitem atos que só saem no Diário. Exemplo: o termo de rescisão unilateral do contrato
2024.000050.10109.01 (SEG × Gartner) foi publicado em 05/10/2026 (protocolo 1880890) e o SIGA ainda o mostra "em execução".

Como funciona (só leitura, sem login):
  1. a lista de edições vem de https://ioes.dio.es.gov.br/apifront/portal/edicoes/ultimas_edicoes.json (desde nov/2023);
  2. cada edição é o PDF de https://ioes.dio.es.gov.br/portal/edicoes/download/<id>; o texto sai por `pdftotext` e o PDF é apagado;
  3. no texto procuram-se duas chaves: o número de contrato no formato AAAA.NNNNNN.UG.SS (76% dos contratos do SIGA) e os CNPJs dos
     fornecedores do SIGA; cada citação vira um ato com tipo (por palavras-chave), protocolo da publicação, página e trecho;
  4. o resultado fica em .cache/contratos/dio_atos.json; edições já lidas não são baixadas de novo (o diário leva segundos).

O texto do PDF sai em colunas e atos vizinhos se misturam; por isso o tipo é classificado pelas palavras-chave mais próximas da citação,
o trecho é só o contexto e o link leva à edição para conferência. O montar.py liga os atos aos contratos do painel.

Uso: python3 -I pipeline/contratos/diario.py [--desde AAAA-MM-DD] [--max N]
     (padrão: desde 2023-11-01, todas as edições novas; --max limita as edições baixadas nesta execução)
Variável: DIO_PARALELO (padrão 6). Precisa do `pdftotext` (pacote poppler-utils).
"""
import concurrent.futures as cf
import datetime
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "contratos")
DESTINO = os.path.join(CACHE, "dio_atos.json")
LISTA = "https://ioes.dio.es.gov.br/apifront/portal/edicoes/ultimas_edicoes.json"
DOWNLOAD = "https://ioes.dio.es.gov.br/portal/edicoes/download/"
PARALELO = int(os.environ.get("DIO_PARALELO", "6"))

NUMERO = re.compile(r"\b(20\d{2}\.\d{6}\.\d{4,6}\.\d{2})\b")
CNPJ = re.compile(r"\b(\d{2})\.(\d{3})\.(\d{3})/(\d{4})-(\d{2})\b")
PROCESSO = re.compile(r"\b(20\d{2}-[0-9A-Z]{5})\b")
NUMERO_ANTIGO = re.compile(r"\b(\d{1,10})\s*/\s*(20\d{2})\b")
MARCA = re.compile(r"<#DIOES#(\d+)#\d+#\d+/?>")
LIMPAR = re.compile(r"<#DIOES#[^>]*>")

# do mais grave ao mais comum; vence o primeiro tipo cujo padrão aparece perto da citação
TIPOS = [("Rescisão", re.compile(r"TERMO DE RESCIS|RESCIS[ÃA]O (UNILATERAL|AMIG|CONTRATUAL|DO CONTRATO|DO TERMO)|RESCINDID|RESCINDIR|DISTRATO")),
         ("Penalidade", re.compile(r"PENALIDADE|SAN[CÇ][AÃ]O|MULTA|IMPEDIMENTO DE LICITAR|INIDONEIDADE|ADVERT[EÊ]NCIA")),
         ("Aditivo ou prorrogação", re.compile(r"ADITIV|ADITAMENTO|PRORROGA")),
         ("Apostilamento", re.compile(r"APOSTIL")),
         ("Reajuste ou repactuação", re.compile(r"REAJUST|REPACTUA")),
         ("Extrato de contrato", re.compile(r"EXTRATO|TERMO DE CONTRATO|CONTRATANTE|CONTRATADA"))]


def normalizar(s):
    return re.sub(r"\s+", " ", LIMPAR.sub(" ", s)).strip()


def spans_protocolo(texto):
    """[(início, fim, protocolo)]: cada publicação do Diário abre e fecha com marcas <#DIOES#protocolo#...>; o trecho entre a primeira e a última marca dela."""
    pos = {}
    for m in MARCA.finditer(texto):
        a, b = pos.get(m.group(1), (m.start(), m.end()))
        pos[m.group(1)] = (min(a, m.start()), max(b, m.end()))
    return sorted((a, b, p) for p, (a, b) in pos.items())


def protocolo_em(texto, spans, i):
    """Protocolo da publicação que contém a posição i, ou ''.

    Como o texto sai em colunas, os trechos de publicações vizinhas se cruzam. Vale a publicação cuja assinatura ("Protocolo 1880890", no fim
    do ato) aparece depois da citação; em empate, a de menor trecho."""
    cand = []
    for a, b, p in spans:
        if a <= i <= b:
            assina = re.search(r"Protocolo\s+" + p + r"\b", texto[i:b + 1]) is not None
            cand.append((0 if assina else 1, b - a, p))
    return min(cand)[2] if cand else ""


def classificar(janela, aceita_rescisao=True):
    j = janela.upper()
    for nome, padrao in TIPOS:
        if nome == "Rescisão" and not aceita_rescisao:
            continue
        if padrao.search(j):
            return nome
    return "Citação"


PROTOCOLO_TEXTO = re.compile(r"Protocolo\s+(\d{6,8})")


def refinar_ato(a):
    """Completa um ato já extraído. (1) Sem marca de publicação (edições antigas), o protocolo é o primeiro 'Protocolo NNNNNNN' impresso depois da
    citação no trecho. (2) Ato só 'Citação' (a palavra-chave não estava perto do número) é reclassificado pelo trecho inteiro, que é o texto da
    mesma publicação, mas sem aceitar 'Rescisão', que exige a palavra perto do número, já que o trecho pode trazer o ato vizinho."""
    if not a.get("p"):
        c = a.get("c") or ""
        chave = a.get("n") or (f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}" if len(c) == 14 else "")
        i = a["x"].find(chave) if chave else -1
        m = PROTOCOLO_TEXTO.search(a["x"], i) if i >= 0 else None      # sem a citação no trecho, não se adivinha o protocolo
        if m:
            a["p"] = m.group(1)
    if a["t"] == "Citação":
        a["t"] = classificar(a["x"], aceita_rescisao=False)
    return a


def pagina_em(texto, i):
    """O pdftotext separa as páginas com o caractere de avanço de página."""
    return texto.count("\f", 0, i) + 1


def atos_da_edicao(texto, cnpjs, antes=300, depois=900):
    """Atos que citam um número de contrato estruturado ou um CNPJ da lista. Cada ato: dicionário com
    n (número do contrato, ou ''), c (CNPJ, ou ''), t (tipo), p (protocolo da publicação), pg (página), x (trecho),
    np (protocolos de processo e-Docs no trecho) e nc (números 'N/AAAA' no trecho, para contratos de numeração antiga)."""
    spans = spans_protocolo(texto)
    saida, vistos = [], set()

    def registrar(i, fim_chave, n, c):
        proto = protocolo_em(texto, spans, i)
        chave = (proto, n, c, pagina_em(texto, i))
        if chave in vistos:
            return
        vistos.add(chave)
        pag_ini = texto.rfind("\f", 0, i) + 1
        pag_fim = texto.find("\f", fim_chave)
        pag_fim = len(texto) if pag_fim < 0 else pag_fim
        a, b = max(pag_ini, i - antes), min(pag_fim, fim_chave + depois)     # o contexto não atravessa a página
        for sa, sb, sp in spans:
            if sp == proto:
                a, b = max(a, sa), min(b, sb + 1)
        trecho = normalizar(texto[a:b])
        perto = normalizar(texto[max(pag_ini, i - 250):min(pag_fim, fim_chave + 250)])
        tipo = classificar(perto)
        if not n and tipo == "Citação":
            return                      # CNPJ solto (licitações, listas de empresas): não é ato de contrato
        saida.append(refinar_ato({"n": n, "c": c, "t": tipo, "p": proto, "pg": pagina_em(texto, i), "x": trecho[:760],
                                  "np": sorted(set(PROCESSO.findall(trecho)))[:4],
                                  "nc": sorted({f"{int(a_)}/{b_}" for a_, b_ in NUMERO_ANTIGO.findall(trecho)})[:6]}))

    for m in NUMERO.finditer(texto):
        registrar(m.start(), m.end(), m.group(1), "")
    for m in CNPJ.finditer(texto):
        c = "".join(m.groups())
        if c in cnpjs:
            registrar(m.start(), m.end(), "", c)
    return saida


def cnpjs_do_siga():
    """CNPJs dos fornecedores nos CSVs de contratos do SIGA (coluna 9)."""
    s = set()
    for f in glob.glob(os.path.join(CACHE, "c20*.csv")):
        for linha in open(f, encoding="utf-8", errors="replace"):
            p = linha.split(";")
            if len(p) > 8 and re.fullmatch(r"\d{14}", p[8]):
                s.add(p[8])
    return s


def get(url, destino=None, tentativas=4):
    for _ in range(tentativas):
        cmd = ["curl", "-sS", "-L", "-m", "180", "--fail", url] + (["-o", destino] if destino else [])
        p = subprocess.run(cmd, capture_output=True)
        if p.returncode == 0:
            return p.stdout
    return None


def ler_edicao(ed):
    with tempfile.TemporaryDirectory() as d:
        pdf = os.path.join(d, "e.pdf")
        if get(DOWNLOAD + str(ed["id"]), pdf) is None:
            return ed, None
        p = subprocess.run(["pdftotext", pdf, "-"], capture_output=True)
        if p.returncode != 0:
            return ed, None
        return ed, p.stdout.decode("utf-8", "replace")


def iso(d):
    return f"{d[6:]}-{d[3:5]}-{d[:2]}"


def main():
    args = sys.argv[1:]
    desde = args[args.index("--desde") + 1] if "--desde" in args else "2023-11-01"
    limite = int(args[args.index("--max") + 1]) if "--max" in args else 10 ** 9
    bruto = get(LISTA)
    if bruto is None:
        sys.exit("falha ao ler a lista de edições do Diário Oficial")
    edicoes = [{"id": x["id"], "data": iso(x["data"]), "numero": x["numero"], "sup": x["suplemento"]} for x in json.loads(bruto)["itens"] if iso(x["data"]) >= desde]
    estado = json.load(open(DESTINO)) if os.path.exists(DESTINO) else {"edicoes": {}, "atos": []}
    lidas = estado["edicoes"]
    faltam = sorted((e for e in edicoes if str(e["id"]) not in lidas), key=lambda e: e["data"], reverse=True)[:limite]
    cnpjs = cnpjs_do_siga()
    print(f"{len(edicoes)} edições desde {desde}; {len(lidas)} já lidas; {len(faltam)} a ler; {len(cnpjs)} CNPJs do SIGA como chave", flush=True)
    falhas = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for k, (ed, texto) in enumerate(ex.map(ler_edicao, faltam), 1):
            if texto is None:
                falhas += 1
                print(f"AVISO: edição {ed['id']} ({ed['data']}) não pôde ser lida", file=sys.stderr)
                continue
            atos = atos_da_edicao(texto, cnpjs)
            for a in atos:
                a["e"], a["d"] = ed["id"], ed["data"]
            estado["atos"] += atos
            lidas[str(ed["id"])] = {"data": ed["data"], "numero": ed["numero"], "sup": ed["sup"], "atos": len(atos)}
            if k % 25 == 0 or k == len(faltam):
                print(f"  {k}/{len(faltam)} edições; {len(estado['atos'])} atos", flush=True)
    estado["geradoEm"] = datetime.date.today().isoformat()
    os.makedirs(CACHE, exist_ok=True)
    with open(DESTINO, "w") as f:
        json.dump(estado, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(lidas)} edições lidas no total, {len(estado['atos'])} atos → {DESTINO}" + (f"; {falhas} edições falharam (serão tentadas de novo na próxima execução)" if falhas else ""))
    if falhas:
        sys.exit(1)


if __name__ == "__main__":
    main()
