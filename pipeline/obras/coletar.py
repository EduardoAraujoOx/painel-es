#!/usr/bin/env python3
"""
Obras paralisadas e com contrato rescindido no Portal da Transparência do ES (módulo `obras`).

O Portal da Transparência do Poder Executivo (transparencia.es.gov.br/Obras) cadastra cada obra com a situação (em execução, concluída, paralisada,
contrato rescindido) e a DATA da situação ("Paralisada (29/08/2014)"). É a fonte que a imprensa usa para falar em "obras paralisadas" e é
diferente do cadastro de contratos (SIGA), que não informa a data da suspensão. Este script lista as obras com situação "Paralisada" e
"Contrato rescindido", lê a página de detalhe de cada uma (data, contrato, empresa, percentual executado, valor) e grava data/obras/index.json,
com o que é novo desde o levantamento anterior.

Atenção: o arquivo de dados abertos de obras (dados.es.gov.br) está parado desde 05/2026 e o histórico de situações de 2024 em diante veio vazio;
por isso a fonte é o próprio portal. O portal depende do registro do órgão: uma paralisação decidida e publicada no Diário Oficial pode demorar a aparecer.

Uso (sem dependências externas):
  python3 -I pipeline/obras/coletar.py             # lê o portal, compara e grava
  python3 -I pipeline/obras/coletar.py --dry-run   # só mostra o resumo
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SAIDA = RAIZ / "data" / "obras" / "index.json"
BASE = "https://transparencia.es.gov.br"
LISTA = BASE + "/Obras/ObrasGeral/ObterObras?Ordenar=Descricao&OrdenarCrescente=1&Situacao={cod}&page={pg}"
DETALHE = BASE + "/Obras/ObrasDetalhe?id={id}"
AGENTE = "Mozilla/5.0 (compatible; painel-es-obras/1.0; +https://github.com/EduardoAraujoOx/painel-es)"
SITUACOES = {"103": "paralisada", "104": "rescindida"}  # códigos do filtro "Situação" do portal
DESDE = "2026-10-04"  # primeiro turno das eleições de 2026: o painel destaca o que ocorreu desde então
PAUSA = 0.3
MAX_PAGINAS = 60
LIMITE_BYTES = 5_000_000


def agora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def baixar(url, tentativas=4):
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


def ids_da_pagina(texto):
    """ids das obras (atributo cont-id) e se há próxima página, num fragmento da lista de resultados."""
    return re.findall(r'cont-id="(\d+)"', texto)


def tem_proxima(texto, pg):
    return f"page={pg + 1}" in texto


def lista_valida(texto):
    """Um fragmento de resultados de verdade traz o cabeçalho da tabela (Descrição, Setor, Município, Órgão, Valor). Página de erro ou layout
    novo, mesmo com HTTP 200, não traz: tratar como lista vazia faria todas as obras parecerem ter saído da situação."""
    t = texto_plano(texto)
    return "Setor" in t and "Valor" in t and re.search(r"Munic[ií]pio", t) is not None


def ids_da_situacao(cod, baixar_fn=baixar):
    ids, pg = [], 1
    while pg <= MAX_PAGINAS:
        t = baixar_fn(LISTA.format(cod=cod, pg=pg))
        if not lista_valida(t):
            raise RuntimeError(f"lista da situação {cod} (página {pg}) com formato inesperado: nada foi alterado")
        novos = [i for i in ids_da_pagina(t) if i not in ids]
        if not novos:
            break
        ids += novos
        if not tem_proxima(t, pg):
            break
        pg += 1
        time.sleep(PAUSA)
    return ids


def texto_plano(h):
    h = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)
    t = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", h)))
    return re.sub(r"(\|\s*)+", "| ", t)


def campo(txt, rotulo):
    m = re.search(re.escape(rotulo) + r"\s*\|\s*([^|]*)", txt)
    return m.group(1).strip() if m else ""


def valor_br(s):
    s = re.sub(r"[^\d,]", "", s or "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def data_iso(s):
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def ler_detalhe(h, obra_id):
    """Extrai o que interessa da página de detalhe da obra. None se não houver situação com data (página inesperada)."""
    t = texto_plano(h)
    sit = campo(t, "Situação:")
    data = data_iso(sit)
    if not sit or not data:
        return None
    emp = campo(t, "Empresa Contratada:")
    cnpj, _, nome = emp.partition(" - ")
    v = re.search(r"Valor Contratado \| Inicial: \| [^|]*\| Aditado: \| [^|]*\| Total: \| ([^|]*)", t)
    exec_ = valor_br(campo(t, "Percentual de Execução:"))
    return {
        "id": str(obra_id), "objeto": re.sub(r"\s+", " ", campo(t, "Objeto:"))[:400], "descricao": campo(t, "Descrição:")[:80],
        "orgao": campo(t, "Órgão Responsável:"), "setor": campo(t, "Setor Beneficiado:"), "municipio": campo(t, "Município:"),
        "contrato": campo(t, "Contrato / Ano – Nº da Obra:"), "assinatura": data_iso(campo(t, "Data de Assinatura do Contrato:")),
        "cnpj": cnpj.strip(), "empresa": nome.strip() or cnpj.strip(), "situacao_texto": sit, "data_situacao": data,
        "execucao": exec_, "valor": valor_br(v.group(1)) if v else None, "url": DETALHE.format(id=obra_id),
    }


def tipo_da_situacao(sit):
    s = (sit or "").lower()
    return "paralisada" if "paralis" in s else "rescindida" if "rescin" in s or "rescis" in s else None


def comparar(atuais, anterior, hoje):
    """Aplica `visto_em` (primeira vez em que o coletor viu a obra nessa situação) e acha o que entrou e o que saiu da situação."""
    antes = {i["id"]: i for i in (anterior or {}).get("itens", [])}
    baseline = not anterior
    novos, saidas = [], list((anterior or {}).get("saidas", []))
    for i, it in atuais.items():
        velho = antes.get(i)
        if velho is None or velho.get("tipo") != it["tipo"]:
            it["visto_em"] = None if baseline else iso(hoje)
            if not baseline:
                novos.append(i)  # obra nova na lista, ou que mudou de situação (ex.: paralisada virou rescindida)
        else:
            it["visto_em"] = velho.get("visto_em")
    for i, velho in antes.items():
        if i not in atuais or atuais[i]["tipo"] != velho.get("tipo"):
            saidas.append({**velho, "saiu_em": iso(hoje)})  # retomada, concluída ou mudou de situação
    return novos, saidas[-300:], baseline


def montar(atuais, anterior, hoje, desde=DESDE):
    novos, saidas, baseline = comparar(atuais, anterior, hoje)
    itens = sorted(atuais.values(), key=lambda i: (i["data_situacao"], i["id"]), reverse=True)
    contagem = {t: sum(1 for i in itens if i["tipo"] == t) for t in ("paralisada", "rescindida")}
    valor = {t: round(sum(i["valor"] or 0 for i in itens if i["tipo"] == t), 2) for t in ("paralisada", "rescindida")}
    desde_n = {t: sum(1 for i in itens if i["tipo"] == t and i["data_situacao"] >= desde) for t in ("paralisada", "rescindida")}
    return {
        "ref": hoje.strftime("%Y-%m-%d"), "gerado_em": iso(hoje), "desde": desde,
        "primeiro_levantamento": (anterior or {}).get("primeiro_levantamento") or hoje.strftime("%Y-%m-%d"),
        "baseline": baseline, "contagem": contagem, "valor": valor, "desde_corte": desde_n, "novos": novos, "saidas": saidas, "itens": itens,
        "escopo": "Obras com situação Paralisada ou Contrato rescindido no Portal da Transparência do Poder Executivo; a data é a da situação registrada pelo órgão.",
    }


def queda_abrupta(anterior, atuais):
    """Mensagem se uma situação perdeu mais da metade das obras de uma vez (com pelo menos 10 guardadas): quase sempre é mudança no portal, não
    retomada em massa. Nesse caso o levantamento é recusado, em vez de publicar contagens erradas e saídas falsas."""
    for tipo in ("paralisada", "rescindida"):
        antes = sum(1 for i in (anterior or {}).get("itens", []) if i.get("tipo") == tipo)
        agora_ = sum(1 for i in atuais.values() if i["tipo"] == tipo)
        if antes >= 10 and agora_ < antes / 2:
            return f"{tipo}: {antes} obras guardadas e só {agora_} lidas agora"
    return None


def mudou(antes, depois):
    chaves = ("itens", "saidas", "contagem", "novos")
    return not antes or any(antes.get(k) != depois.get(k) for k in chaves)


def coletar(anterior, baixar_fn=baixar, pausa=PAUSA):
    """Lê as duas listas e o detalhe de cada obra. Paralisadas são relidas sempre (a data pode mudar); rescindidas já guardadas, não."""
    guardadas = {i["id"]: i for i in (anterior or {}).get("itens", [])}
    atuais, falhas = {}, []
    for cod, tipo in SITUACOES.items():
        for obra_id in ids_da_situacao(cod, baixar_fn):
            velho = guardadas.get(obra_id)
            if tipo == "rescindida" and velho and velho.get("tipo") == "rescindida":
                atuais[obra_id] = {k: v for k, v in velho.items() if k not in ("visto_em",)}
                continue
            try:
                d = ler_detalhe(baixar_fn(DETALHE.format(id=obra_id)), obra_id)
            except RuntimeError as e:
                d = None
                print(f"FALHA na obra {obra_id}: {str(e)[:100]}")
            time.sleep(pausa)
            if not d or tipo_da_situacao(d["situacao_texto"]) != tipo:
                falhas.append(obra_id)  # sem detalhe legível, ou a situação mudou entre a lista e o detalhe: tenta de novo na próxima coleta
                if velho and velho.get("tipo") == tipo:
                    atuais[obra_id] = {k: v for k, v in velho.items() if k != "visto_em"}
                continue
            atuais[obra_id] = {**d, "tipo": tipo}
    return atuais, falhas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    hoje = agora()
    anterior = None
    if SAIDA.exists():
        try:
            anterior = json.loads(SAIDA.read_text(encoding="utf-8"))
        except ValueError:
            anterior = None
    try:
        atuais, falhas = coletar(anterior)
    except RuntimeError as e:
        sys.exit(f"portal de obras indisponível ({str(e)[:100]}): nada foi alterado")
    if not atuais:
        sys.exit("nenhuma obra paralisada ou rescindida lida: nada foi alterado, para não confundir falha com ausência")
    queda = queda_abrupta(anterior, atuais)
    if queda:
        sys.exit(f"queda abrupta ({queda}): provável mudança no portal; nada foi alterado")
    saida = montar(atuais, anterior, hoje)
    c, v = saida["contagem"], saida["valor"]
    print(f"{c['paralisada']} paralisadas (R$ {v['paralisada'] / 1e6:.1f} mi) e {c['rescindida']} com contrato rescindido; "
          f"desde {saida['desde']}: {saida['desde_corte']['paralisada']} paralisadas e {saida['desde_corte']['rescindida']} rescindidas; "
          f"{'primeiro levantamento (base de comparação)' if saida['baseline'] else str(len(saida['novos'])) + ' novas, ' + str(len(saida['saidas'])) + ' saídas guardadas'}")
    for i in saida["itens"][:8]:
        print(f"  {i['data_situacao']} [{i['tipo']:10}] {i['orgao'][:22]:22} | {i['municipio'][:14]:14} | {(i['valor'] or 0) / 1e6:6.1f} mi | {i['objeto'][:60]}")
    if falhas:
        print(f"AVISO: {len(falhas)} obra(s) sem detalhe legível; a próxima coleta tenta de novo")
    if args.dry_run:
        return
    if not mudou(anterior, saida):
        print("sem mudanças: o arquivo não foi alterado")
        return
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
