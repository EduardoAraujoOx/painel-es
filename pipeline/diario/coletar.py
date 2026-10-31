#!/usr/bin/env python3
"""
Atos de contrato no Diário Oficial do ES (módulo `atos`).

Lê o sumário de cada edição do Diário Oficial do Estado (ioes.dio.es.gov.br, endereços públicos), separa as matérias do Poder Executivo
cujo título trata de paralisação, suspensão, rescisão, cancelamento (de ata ou contrato) ou anulação/revogação de licitação ou contrato e
grava data/atos/index.json, com a data de publicação, o órgão e o link da matéria.

Por que o Diário: o cadastro de contratos (SIGA) não informa a data da suspensão e demora a registrá-la; o Diário publica alguns desses atos
com data (por exemplo, "Extrato de Ordem de Paralisação"). Não publica tudo: a suspensão em si costuma ser ato interno. A triagem é pelo
TÍTULO da matéria (não pelo texto) e indica onde olhar; pode errar.

Uso (sem dependências externas):
  python3 -I pipeline/diario/coletar.py             # lê as edições novas desde 04/10/2026 e grava
  python3 -I pipeline/diario/coletar.py --dry-run   # só mostra o resumo
  python3 -I pipeline/diario/coletar.py --desde 2026-09-01
"""

import argparse
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SAIDA = RAIZ / "data" / "atos" / "index.json"
BASE = "https://ioes.dio.es.gov.br"
ULTIMAS = BASE + "/apifront/portal/edicoes/ultimas_edicoes.json"
SUMARIO = BASE + "/portal/visualizacoes/view_html_diario/{ed}"
MATERIA = BASE + "/apifront/portal/edicoes/publicacoes_ver_conteudo/{mid}/{ed}"
AGENTE = "Mozilla/5.0 (compatible; painel-es-diario/1.0; +https://github.com/EduardoAraujoOx/painel-es)"
DESDE = "2026-10-04"  # primeiro turno das eleições de 2026: o painel acompanha o que foi publicado desde então
BRASILIA = timezone(timedelta(hours=-3))
PAUSA = 0.4  # segundos entre edições, para não sobrecarregar o servidor
LIMITE_BYTES = 20_000_000

ROTULOS = {"paralisacao": "Paralisação", "suspensao": "Suspensão", "rescisao": "Rescisão", "cancelamento": "Cancelamento", "anulacao": "Anulação ou revogação"}


def agora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def baixar(url, tentativas=3):
    ultimo = None
    for n in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = r.read(LIMITE_BYTES + 1)
            if len(dados) > LIMITE_BYTES:
                raise ValueError("resposta acima do limite de tamanho")
            return dados.decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            ultimo = e
            time.sleep(2 * (n + 1))
    raise RuntimeError(str(ultimo))


def normalizar(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


class Sumario(HTMLParser):
    """Lê a árvore do sumário (pastas aninhadas e links de matéria) e devolve (id da matéria, título, caminho de pastas)."""

    def __init__(self):
        super().__init__()
        self.profundidade, self.nomes, self.captura, self.buf, self.saida = 0, {}, None, "", []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "ul":
            self.profundidade += 1
        elif tag == "span" and "folder" in (a.get("class") or ""):
            self.captura, self.buf = "pasta", ""
        elif tag == "a" and a.get("identificador"):
            self.captura, self.buf = ("materia", a["identificador"]), ""

    def handle_data(self, data):
        if self.captura:
            self.buf += data

    def handle_endtag(self, tag):
        if tag == "ul":
            self.profundidade -= 1
        elif tag == "span" and self.captura == "pasta":
            self.nomes[self.profundidade] = re.sub(r"\s+", " ", html.unescape(self.buf)).strip()
            self.captura = None
            for k in [k for k in self.nomes if k > self.profundidade]:
                del self.nomes[k]
        elif tag == "a" and isinstance(self.captura, tuple):
            caminho = [self.nomes[k] for k in sorted(self.nomes) if k <= self.profundidade]
            self.saida.append((self.captura[1], re.sub(r"\s+", " ", html.unescape(self.buf)).strip(), caminho))
            self.captura = None


def ler_sumario(texto_html):
    p = Sumario()
    p.feed(texto_html)
    return p.saida


# Atos de pessoa, e não de contrato (férias, portarias individuais, estágio, cessão de servidor, monitores de ressocialização...)
# (com limite de palavra: "suspensão" contém "pensão" e "concessão" contém "cessão")
EXCLUI = re.compile(r"\b(ferias|licenca|aposentad\w*|pensao|servidor\w*|estagi\w*|cessao|monitor\w*|portaria|exonera\w*|nomea\w*|designa\w*|cnh|habilitac\w*|disciplinar|mandado|vacancia|reajuste|repactuac\w*)\b")
# suspensão de penalidade, multa ou sanção é alívio dado à empresa, não suspensão do contrato
SUSPENDE_SANCAO = re.compile(r"suspens\w*\s+(de\s+|da\s+|do\s+)?(penalidade|multa|sancao|impedimento|direito)")
CONTEXTO = re.compile(r"contrat|\bct\s?\d|termo|\bata\b|\barp\b|ordem de|licitac|pregao|concorrencia|dispensa|fornecimento|convenio|aditiv|execucao|obra|servico|credenciamento|chamamento")
TIPOS = [
    ("paralisacao", re.compile(r"paralisa|sobrestamento|ordem de parada")),
    ("suspensao", re.compile(r"suspens")),
    ("rescisao", re.compile(r"rescis|distrato")),
    ("anulacao", re.compile(r"\b(anulacao|anula\w*|revogacao|revoga\w*)\b")),
    ("cancelamento", re.compile(r"termo de cancelamento|cancelamento (de|da|do|dos|das) (ata|arp|registro|contrato|empenho|nota)|apostilamento de cancelamento")),
]
LICITACAO = re.compile(r"licitac|pregao|concorrencia|dispensa|chamamento|credenciamento")
ATA = re.compile(r"\barp\b|ata de registro|\bata\b")


def classificar(titulo, caminho):
    """(tipo, alvo) se o título trata de ato de contrato do Poder Executivo; None caso contrário. `alvo`: contrato, licitação, ata ou outro."""
    if not caminho or normalizar(caminho[0]) != "poder executivo":
        return None  # prefeituras, câmaras e publicações de terceiros ficam de fora
    n = normalizar(limpar_titulo(titulo))
    if EXCLUI.search(n) or SUSPENDE_SANCAO.search(n) or not CONTEXTO.search(n):
        return None
    for tipo, padrao in TIPOS:
        if padrao.search(n):
            if tipo == "anulacao" and not (LICITACAO.search(n) or re.search(r"contrat|ata|arp", n)):
                return None
            alvo = "licitação" if LICITACAO.search(n) else "ata" if ATA.search(n) else "contrato" if re.search(r"contrat|\bct\s?\d|termo|convenio|aditiv", n) else "outro"
            return tipo, alvo
    return None


def limpar_titulo(t):
    return re.sub(r"^\s*#\d+\s*-\s*", "", t or "").strip()


def data_iso(br):
    try:
        return datetime.strptime(br, "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def extrair(edicao, materias):
    """Atos de contrato de uma edição: lista de itens prontos para gravar (sem `visto_em`)."""
    out = []
    for mid, titulo, caminho in materias:
        c = classificar(titulo, caminho)
        if not c:
            continue
        out.append({
            "id": str(mid), "edicao": edicao["id"], "data": data_iso(edicao["data"]), "tipo": c[0], "alvo": c[1], "titulo": limpar_titulo(titulo),
            "orgao": caminho[1] if len(caminho) > 1 else caminho[0], "setor": caminho[-1] if len(caminho) > 2 else "",
            "url": MATERIA.format(mid=mid, ed=edicao["id"]),
        })
    return out


def montar(anterior, itens_novos, edicoes_lidas, desde, hoje):
    """Junta o que já havia com o lido agora. `visto_em` é a primeira vez em que o coletor viu o ato (None na primeira carga: tudo o que já estava publicado)."""
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
    contagem = {t: sum(1 for i in itens if i["tipo"] == t) for t in ROTULOS}
    return {
        "ref": hoje.astimezone(BRASILIA).strftime("%Y-%m-%d"), "gerado_em": iso(hoje), "desde": desde,
        "primeiro_levantamento": (anterior or {}).get("primeiro_levantamento") or hoje.astimezone(BRASILIA).strftime("%Y-%m-%d"),
        "baseline": baseline, "contagem": contagem, "novos": novos, "edicoes_lidas": sorted(set(edicoes_lidas)), "itens": itens,
        "escopo": "Matérias do Poder Executivo estadual cujo título trata de paralisação, suspensão, rescisão, cancelamento de ata ou contrato, ou anulação/revogação de licitação ou contrato.",
    }


def mudou(antes, depois):
    chaves = ("itens", "edicoes_lidas", "novos", "contagem")
    return not antes or any(antes.get(k) != depois.get(k) for k in chaves)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--desde", default=DESDE, help="data inicial (AAAA-MM-DD) do que se acompanha; padrão: 04/10/2026")
    args = ap.parse_args()
    hoje = agora()
    hoje_brt = hoje.astimezone(BRASILIA).strftime("%Y-%m-%d")
    ontem_brt = (hoje.astimezone(BRASILIA) - timedelta(days=1)).strftime("%Y-%m-%d")

    anterior = None
    if SAIDA.exists():
        try:
            anterior = json.loads(SAIDA.read_text(encoding="utf-8"))
        except ValueError:
            anterior = None
    lidas = set((anterior or {}).get("edicoes_lidas", []))

    try:
        lista = json.loads(baixar(ULTIMAS))["itens"]
    except (RuntimeError, ValueError, KeyError) as e:
        sys.exit(f"lista de edições indisponível ({str(e)[:100]}): nada foi alterado")
    alvo = [e for e in lista if (data_iso(e["data"]) or "") >= args.desde]
    # edições ainda não lidas, mais as de hoje e de ontem (uma edição extra pode ganhar matérias depois da primeira leitura)
    ler = [e for e in alvo if e["id"] not in lidas or data_iso(e["data"]) in (hoje_brt, ontem_brt)]
    print(f"{len(lista)} edições na lista; {len(alvo)} desde {args.desde}; {len(ler)} a ler")

    itens_novos, ok, falhas = [], set(lidas), []
    for e in sorted(ler, key=lambda e: e["id"]):
        try:
            materias = ler_sumario(baixar(SUMARIO.format(ed=e["id"])))
        except RuntimeError as err:
            falhas.append(e["id"])
            print(f"FALHA na edição {e['id']} ({e['data']}): {str(err)[:100]}")
            continue
        if not materias:
            falhas.append(e["id"])  # sumário vazio: não marca como lida, para tentar de novo
            print(f"edição {e['id']} ({e['data']}) sem matérias no sumário")
            continue
        ok.add(e["id"])
        itens_novos += extrair(e, materias)
        time.sleep(PAUSA)
    if ler and len(falhas) == len(ler):
        sys.exit("nenhuma edição pôde ser lida: nada foi alterado")

    saida = montar(anterior, itens_novos, ok, args.desde, hoje)
    c = saida["contagem"]
    print(f"{len(saida['itens'])} atos desde {args.desde}: " + ", ".join(f"{ROTULOS[t]}={n}" for t, n in c.items())
          + f"; {'primeira carga (base de comparação)' if saida['baseline'] else str(len(saida['novos'])) + ' novos'}")
    for i in saida["itens"][:12]:
        print(f"  {i['data']} [{i['tipo']:12}] {i['orgao'][:32]:32} | {i['titulo'][:85]}")
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
