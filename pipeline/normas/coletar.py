#!/usr/bin/env python3
"""
Atos normativos e fiscais no Diário Oficial do ES (módulo `normas`).

Lê o sumário de cada edição do Diário Oficial do Estado (ioes.dio.es.gov.br, endereços públicos; mesma leitura do módulo `atos`) e separa as matérias do
Poder Executivo que um monitoramento da transição precisa ver e que NÃO são ato de contrato:
  decreto     decreto regulamentar do Governador (série "R": encerramento de exercício, tributos, estrutura de cargos); os decretos de pessoa (série "S": nomeação,
              designação, reversão) ficam de fora, por serem a maioria e de pouca relevância;
  transicao   qualquer ato que trate da transição de governo (por exemplo, o decreto que cria a Equipe de Transição);
  fiscal      ato de gestão orçamentária e financeira pelo título: encerramento de exercício, contingenciamento, limitação de empenho, crédito adicional,
              restos a pagar, programação financeira, cota, LDO e LOA. Descentralização orçamentária, aditivos, extratos e atos de pessoa são rotina e ficam de fora;
  lei         lei estadual sancionada (ordinária ou complementar): o título traz só o número ("LEI Nº 12.968"), então a triagem é pela EMENTA, lida do texto da matéria
              (HTML; PDF, como o da LDO, por pdftotext, se houver). Leis honoríficas (utilidade pública, títulos de capital, dias e selos comemorativos) ficam de fora.
Grava data/normas/index.json com a data de publicação, o órgão, o link da matéria e a ementa ("Dispõe sobre...") lida do texto.

A triagem dos decretos e dos atos fiscais é pelo TÍTULO e a das leis pela ementa; indicam onde olhar e podem errar nos dois sentidos.

Uso (sem dependências externas):
  python3 -I pipeline/normas/coletar.py             # lê as edições novas desde 04/10/2026 e grava
  python3 -I pipeline/normas/coletar.py --dry-run   # só mostra o resumo
"""

import argparse
import importlib.util
import json
import re
import sys
import time
import html as html_lib
import shutil
import subprocess
import urllib.request
from datetime import timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SAIDA = RAIZ / "data" / "normas" / "index.json"

_spec = importlib.util.spec_from_file_location("diario_coletar", RAIZ / "pipeline" / "diario" / "coletar.py")
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)  # reaproveita a leitura do sumário e do Diário (endereços, download, datas)
normalizar, limpar_titulo, data_iso, agora, iso = D.normalizar, D.limpar_titulo, D.data_iso, D.agora, D.iso

DESDE = D.DESDE
ROTULOS = {"decreto": "Decreto regulamentar", "transicao": "Transição de governo", "fiscal": "Gestão fiscal", "lei": "Lei estadual"}
ROTULOS_TEMA = {"encerramento": "Encerramento do exercício", "tributario": "Tributos", "cargos": "Cargos e estrutura", "orcamento": "Orçamento e despesa", "fiscal": "Ajuste fiscal", "programa": "Programas e políticas", "transicao": "Transição", "outro": "Outros"}

TRANSICAO = re.compile(r"transicao (de|do) governo|equipe de transicao|comissao de transicao|gabinete de transicao|transicao governamental")
FISCAL = re.compile(
    r"encerramento (do |de )?exercicio|encerramento orcamentario|contingenciamento|limitacao de empenho|credito (suplementar|adicional|especial|extraordinario)|"
    r"restos a pagar|programacao financeira|cota (orcamentaria|financeira)|teto de gastos|contencao de (gastos|despesas)|corte de (gastos|despesas)|reducao de despesas|"
    r"equilibrio fiscal|ajuste fiscal|calendario de encerramento|lei de diretrizes orcamentarias|lei orcamentaria|\bldo\b|\bloa\b|execucao orcamentaria|"
    r"remanejamento orcamentario|bloqueio de (dotacao|despesa|recursos)|medidas de austeridade|reprogramacao orcamentaria")
ROTINA = re.compile(r"\b(aditivo|termo|contrato|convenio|resumo|extrato|edital|licitac\w*|pregao|ata|designa\w*|nomea\w*|ferias|licenca|aposentad\w*|pensao|descentralizacao orcamentaria|rescisao|apostilamento)\b")
TEMAS = [
    ("encerramento", re.compile(r"encerramento (do |de )?exercicio|encerramento orcamentario|calendario de encerramento")),
    ("tributario", re.compile(r"\bicms\b|\bricms\b|\bipva\b|\bitcmd\b|tribut|isencao|aliquota|\bipm\b|beneficio fiscal|incentivo fiscal")),
    ("cargos", re.compile(r"cargos|quadro de pessoal|reestrutur|extincao de|gratificacao|subsidio")),
    ("orcamento", re.compile(r"credito|orcament|dotacao|restos a pagar|\bcota\b|empenho|programacao financeira|\bldo\b|\bloa\b|contingenc|despesa")),
    ("transicao", TRANSICAO),
]
EMENTA = re.compile(r"\b(Dispõe|Altera|Regulamenta|Estabelece|Institui|Autoriza|Abre|Aprova|Fixa|Prorroga|Revoga|Cria|Transforma|Transfere|Retifica|Define|Declara|Cancela|Convoca)\b")


def classificar(titulo, caminho):
    """(tipo, temas) se o título trata de ato normativo ou fiscal do Poder Executivo estadual; None caso contrário."""
    if not caminho or normalizar(caminho[0]) != "poder executivo":
        return None  # prefeituras, câmaras e publicações de terceiros ficam de fora
    n = normalizar(limpar_titulo(titulo))
    eh_decreto_r = any(normalizar(x) == "decreto r" for x in caminho)
    if any(normalizar(x).startswith("leis") for x in caminho):
        return "lei", ["outro"]  # o título é só o número: os temas e o descarte das honoríficas saem da ementa (ver `qualificar_lei`)
    if TRANSICAO.search(n):
        tipo = "transicao"
    elif eh_decreto_r:
        tipo = "decreto"
    elif FISCAL.search(n) and not ROTINA.search(n):
        tipo = "fiscal"
    else:
        return None
    temas = [t for t, p in TEMAS if p.search(n)] or ["outro"]
    return tipo, temas


CABECALHO = re.compile(r"(DECRETO|LEI COMPLEMENTAR|LEI)\s+N[ºo°]\s*[\d.\-A-Z]+(?:\s*\(\d+\))?(?:,?\s+DE\s+\d+\s+DE\s+[A-ZÇa-zç]+\s+DE\s+\d{4})?\.?", re.I)
FIM_EMENTA = re.compile(r"\s+(O GOVERNADOR|A GOVERNADORA|O VICE|A ASSEMBLEIA|CONSIDERANDO|Faço saber)\b")
HONORIFICA = re.compile(
    r"declara de utilidade publica|utilidade publica|titulo de capital|capital estadual|confere (ao|a|o)? ?(municipio|cidade)|denomina|da (o )?nome|"
    r"institui (o|a) (dia|semana|mes|selo|medalha|premio|comenda)\b|dia estadual|semana estadual|mes estadual|acrescenta item ao anexo i da lei|patrimonio (cultural|historico|imaterial)|"
    r"inclui no calendario|calendario oficial|homenagem")
TEMAS_LEI = [
    ("fiscal", re.compile(r"ajuste fiscal|transparencia fiscal|responsabilidade fiscal|equilibrio fiscal|divida|endividamento|refinanciamento|programa de acompanhamento")),
    ("orcamento", re.compile(r"orcament|diretrizes orcamentarias|credito (suplementar|adicional|especial)|emendas? parlamentares?|dotacao|fundo estadual|\bfundo\b|execucao financeira")),
    ("tributario", re.compile(r"\bicms\b|\bipva\b|\bitcmd\b|tribut|isencao (de|do|da|dos|das) (icms|ipva|itcmd|imposto|impostos|taxa|taxas|tributo)|aliquota|incentivo fiscal|beneficio fiscal|remissao de (credito|debito)|anistia (de|do|da) (credito|debito|multa)")),
    ("cargos", re.compile(r"cargos?|quadro de pessoal|servidores?|remuneracao|subsidio|concurso|plano de cargos|gratificacao|reestrutur|carreira|vencimentos")),
    ("programa", re.compile(r"institui (o |a )?(programa|politica)|politica estadual|programa estadual|autoriza o poder executivo")),
]


def plano_do_texto(texto):
    return re.sub(r"\s+", " ", html_lib.unescape(re.sub(r"<style.*?</style>|<[^>]+>", " ", texto, flags=re.S))).strip()


def ementa_do_texto(texto):
    """Ementa do ato (decreto ou lei) a partir do texto da matéria (HTML do Diário, ou texto de PDF): o que vem depois do cabeçalho "LEI Nº 12.968" ou
    "DECRETO Nº 6518-R, DE 03 DE NOVEMBRO DE 2026." e antes do preâmbulo ("O GOVERNADOR..."). None se não houver (PDF sem leitor, texto estranho)."""
    if not texto or texto.lstrip().startswith("%PDF"):
        return None
    plano = plano_do_texto(texto)
    m = CABECALHO.search(plano)
    trecho = None
    if m:
        resto = plano[m.end():m.end() + 700].strip()
        trecho = FIM_EMENTA.split(resto)[0].strip()
        if not EMENTA.match(trecho) and not re.match(r"[A-ZÁÉÍÓÚÂÊÔÃÕÇ]", trecho):
            trecho = None
    if not trecho:  # sem cabeçalho reconhecível: primeira frase que começa por um verbo de ementa
        m = EMENTA.search(plano)
        if not m:
            return None
        trecho = FIM_EMENTA.split(plano[m.start():m.start() + 600])[0].strip()
    return trecho[:360].rstrip(" ,;") if len(trecho) > 12 else None


def qualificar_lei(ementa):
    """Para uma lei: None se for honorífica (utilidade pública, título de capital, dia ou selo comemorativo); senão, os temas pela ementa."""
    n = normalizar(ementa or "")
    if n and HONORIFICA.search(n):
        return None
    return [t for t, p in TEMAS_LEI if p.search(n)] or ["outro"]


def pdf_para_texto(url):
    """Texto das duas primeiras páginas de um PDF do Diário, com pdftotext (poppler), se estiver instalado. None se não der."""
    exe = shutil.which("pdftotext")
    if not exe:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": D.AGENTE})
        with urllib.request.urlopen(req, timeout=60) as r:
            dados = r.read(30_000_000)
        saida = subprocess.run([exe, "-f", "1", "-l", "2", "-layout", "-", "-"], input=dados, capture_output=True, timeout=60, check=True).stdout
        return saida.decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def ler_ementa(url):
    """Ementa da matéria: texto HTML direto; PDF por pdftotext. Lança RuntimeError se o download falhar."""
    texto = D.baixar(url)
    if texto.lstrip().startswith("%PDF"):
        texto = pdf_para_texto(url)
    return ementa_do_texto(texto) if texto else None


def extrair(edicao, materias):
    out = []
    for mid, titulo, caminho in materias:
        c = classificar(titulo, caminho)
        if not c:
            continue
        out.append({
            "id": str(mid), "edicao": edicao["id"], "data": data_iso(edicao["data"]), "tipo": c[0], "temas": c[1], "titulo": limpar_titulo(titulo),
            "orgao": caminho[1] if len(caminho) > 1 else caminho[0], "ementa": None, "url": D.MATERIA.format(mid=mid, ed=edicao["id"]),
        })
    return out


def montar(anterior, itens_novos, edicoes_lidas, desde, hoje, ignoradas=()):
    """Junta o que já havia com o lido agora. `visto_em` é a primeira vez em que o coletor viu o ato (None na primeira carga). `ignoradas`: ids de leis
    honoríficas já lidas, para não baixar a matéria de novo a cada coleta."""
    baseline = not anterior
    por_id = {i["id"]: i for i in (anterior or {}).get("itens", [])}
    novos = []
    for it in itens_novos:
        if it["id"] in por_id:
            continue
        it["visto_em"] = None if baseline else iso(hoje)
        por_id[it["id"]] = it
        if not baseline:
            novos.append(it["id"])
    itens = sorted((i for i in por_id.values() if (i["data"] or "") >= desde), key=lambda i: (i["data"] or "", int(i["id"])), reverse=True)
    return {
        "ref": hoje.astimezone(D.BRASILIA).strftime("%Y-%m-%d"), "gerado_em": iso(hoje), "desde": desde,
        "primeiro_levantamento": (anterior or {}).get("primeiro_levantamento") or hoje.astimezone(D.BRASILIA).strftime("%Y-%m-%d"),
        "baseline": baseline, "contagem": {t: sum(1 for i in itens if i["tipo"] == t) for t in ROTULOS}, "novos": novos,
        "edicoes_lidas": sorted(set(edicoes_lidas)), "ignoradas": sorted(set((anterior or {}).get("ignoradas", [])) | set(ignoradas), key=int), "itens": itens,
        "escopo": "Matérias do Poder Executivo estadual: decretos regulamentares (série R), atos da transição de governo, atos de gestão fiscal (encerramento de exercício, "
                  "contingenciamento, crédito adicional, restos a pagar, LDO e LOA), pelo título, e leis estaduais não honoríficas, pela ementa.",
    }


def mudou(antes, depois):
    chaves = ("itens", "edicoes_lidas", "novos", "contagem", "ignoradas")
    return not antes or any(antes.get(k) != depois.get(k) for k in chaves)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--desde", default=DESDE, help="data inicial (AAAA-MM-DD); padrão: 04/10/2026")
    args = ap.parse_args()
    hoje = agora()
    hoje_brt = hoje.astimezone(D.BRASILIA).strftime("%Y-%m-%d")
    ontem_brt = (hoje.astimezone(D.BRASILIA) - timedelta(days=1)).strftime("%Y-%m-%d")

    anterior = None
    if SAIDA.exists():
        try:
            anterior = json.loads(SAIDA.read_text(encoding="utf-8"))
        except ValueError:
            anterior = None
    lidas = set((anterior or {}).get("edicoes_lidas", []))

    try:
        lista = json.loads(D.baixar(D.ULTIMAS))["itens"]
    except (RuntimeError, ValueError, KeyError) as e:
        sys.exit(f"lista de edições indisponível ({str(e)[:100]}): nada foi alterado")
    alvo = [e for e in lista if (data_iso(e["data"]) or "") >= args.desde]
    ler = [e for e in alvo if e["id"] not in lidas or data_iso(e["data"]) in (hoje_brt, ontem_brt)]
    print(f"{len(lista)} edições na lista; {len(alvo)} desde {args.desde}; {len(ler)} a ler")

    itens_novos, ok, falhas = [], set(lidas), []
    for e in sorted(ler, key=lambda e: e["id"]):
        try:
            materias = D.ler_sumario(D.baixar(D.SUMARIO.format(ed=e["id"])))
        except RuntimeError as err:
            falhas.append(e["id"])
            print(f"FALHA na edição {e['id']} ({e['data']}): {str(err)[:100]}")
            continue
        if not materias:
            falhas.append(e["id"])
            print(f"edição {e['id']} ({e['data']}) sem matérias no sumário")
            continue
        ok.add(e["id"])
        itens_novos += extrair(e, materias)
        time.sleep(D.PAUSA)
    if ler and len(falhas) == len(ler):
        sys.exit("nenhuma edição pôde ser lida: nada foi alterado")

    conhecidos = {i["id"] for i in (anterior or {}).get("itens", [])}
    ja_ignoradas = set((anterior or {}).get("ignoradas", []))
    ignoradas, mantidos = [], []
    for it in itens_novos:  # a ementa só se lê uma vez, para o que é novo (decreto, transição ou lei); falha de leitura deixa sem ementa
        if it["id"] in ja_ignoradas:
            continue  # lei honorífica já lida
        if it["id"] in conhecidos:
            mantidos.append(it)
            continue
        if it["tipo"] in ("decreto", "transicao", "lei") and not it["ementa"]:
            try:
                it["ementa"] = ler_ementa(it["url"])
            except RuntimeError:
                it["ementa"] = None
            time.sleep(D.PAUSA)
        if it["tipo"] == "lei":
            temas = qualificar_lei(it["ementa"])
            if temas is None:
                ignoradas.append(it["id"])  # lei honorífica: não entra
                continue
            it["temas"] = temas
        mantidos.append(it)
    itens_novos = mantidos

    saida = montar(anterior, itens_novos, ok, args.desde, hoje, ignoradas)
    c = saida["contagem"]
    print(f"{len(saida['itens'])} atos desde {args.desde}: " + ", ".join(f"{ROTULOS[t]}={n}" for t, n in c.items())
          + f"; {'primeira carga (base de comparação)' if saida['baseline'] else str(len(saida['novos'])) + ' novos'}")
    for i in saida["itens"][:12]:
        print(f"  {i['data']} [{i['tipo']:9}] {i['titulo'][:80]}" + (f" | {i['ementa'][:70]}" if i.get("ementa") else ""))
    if args.dry_run:
        return
    if not mudou(anterior, saida):
        print("sem mudanças: o arquivo não foi alterado")
        return
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")
    if falhas:
        print(f"AVISO: {len(falhas)} edição(ões) não lidas; a próxima coleta tenta de novo")


if __name__ == "__main__":
    main()
