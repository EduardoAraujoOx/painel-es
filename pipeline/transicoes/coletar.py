#!/usr/bin/env python3
"""
Transições de governo em outros estados (módulo `transicoes`, aba "Outros estados").

Os resultados de 25/10/2026 trocaram o governador em 14 estados; fora o ES, são 13 em transição (config.json). Este coletor lê o Google Notícias (buscas por
estado e algumas gerais), fica só com o que é transição de governo estadual de um desses estados e etiqueta cada notícia com a UF e com os temas que interessam
a quem quer saber o que dá para aproveitar no ES: economia de gastos, diagnóstico das contas, contratos e obras, estrutura administrativa, propostas
econômicas e fiscais, servidores. Notícia sem tema desses (nomes da equipe, reuniões de protocolo) entra como "equipe e protocolo".

Só guarda título, veículo, data e link, nunca o texto da matéria. A triagem é por regras de palavras no título, sem modelo de linguagem: indica onde olhar, e a
notícia é que vale. Reaproveita as funções de leitura de feeds do coletor de notícias.

Grava data/transicoes/index.json. Uso (sem dependências externas):
  python3 -I pipeline/transicoes/coletar.py             # coleta e grava
  python3 -I pipeline/transicoes/coletar.py --dry-run   # só mostra o resumo
"""

import argparse
import importlib.util
import json
import re
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
CONFIG = AQUI / "config.json"
SAIDA = RAIZ / "data" / "transicoes" / "index.json"
PAUSA = 1.0  # segundos entre consultas ao Google

_spec = importlib.util.spec_from_file_location("noticias_coletar", RAIZ / "pipeline" / "noticias" / "coletar.py")
N = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(N)


def preparar(cfg):
    """Compila uma vez tudo o que a triagem usa."""
    estados = []
    for e in cfg["estados"]:
        sig = re.compile(r"(?<![A-Za-z])(?:" + "|".join(re.escape(s) for s in e["siglas"]) + r")(?![A-Za-z])") if e.get("siglas") else None
        exatos = [re.compile(r"(?<![A-Za-zÀ-ú])" + re.escape(x) + r"(?![A-Za-zÀ-ú])") for x in e.get("cues_exatos", [])]
        estados.append({"uf": e["uf"], "cues": N.compilar_lista(e["cues"]), "siglas": sig, "exatos": exatos, "eleito": N.compilar_lista([e["eleito"]] + [b for b in e["buscas"][:1]])})
    return {"estados": estados, "transicao": N.compilar_lista(cfg["transicao"]), "excluir": N.compilar_lista(cfg["excluir"]),
            "temas": N.compilar_temas({"temas": cfg["temas"]}), "medida": set(cfg["temas_de_medida"]),
            "estadual": N.compilar_lista(cfg.get("contexto_estadual", [])), "tema_estadual": set(cfg.get("temas_com_contexto_estadual", []))}


def ufs_do_titulo(F, titulo):
    """UFs (entre as 13 em transição) que o título cita: pelo nome do estado, do governador eleito ou de quem sai, ou pela sigla."""
    n = N.normalizar(titulo)
    achadas = []
    for e in F["estados"]:
        if N.casa(e["cues"], n) or (e["siglas"] and e["siglas"].search(titulo)) or any(x.search(titulo) for x in e["exatos"]):
            achadas.append(e["uf"])
    return achadas


def classificar(cfg, titulo, F=None):
    """None se a notícia não é transição de governo estadual de um dos estados acompanhados; senão {ufs, temas, categoria}.
    categoria: "medida" (trata de gastos, contas, contratos, estrutura, economia ou pessoal) ou "equipe" (nomes, reuniões, protocolo)."""
    F = F or preparar(cfg)
    n = N.normalizar(titulo)
    if N.casa(F["excluir"], n):
        return None
    ufs = ufs_do_titulo(F, titulo)
    if not ufs:
        return None
    temas = [t for t, c in F["temas"].items() if N.casa(c["termos"], n) or any(all(N.casa(g, n) for g in comb) for comb in c["comb"])]
    medida = [t for t in temas if t in F["medida"]]
    transicao = N.casa(F["transicao"], n)
    # sem palavra de transição só vale quando cita o próprio governador eleito e trata de alguma medida ("Marcos Rogério prepara cortes profundos...")
    # ou quando trata de previdência ou FNDR do estado (com palavra de governo ou de estado no título), que são o que se quer comparar mesmo fora do clima de transição
    if not transicao:
        eleito = any(N.casa(e["eleito"], n) for e in F["estados"] if e["uf"] in ufs)
        tema_estadual = bool(F["tema_estadual"] & set(temas)) and N.casa(F["estadual"], n)
        if not ((eleito and medida) or tema_estadual):
            return None
    return {"ufs": ufs, "temas": temas, "categoria": "medida" if medida else "equipe"}


FINANCAS_A = '(Fazenda OR Tesouro OR dívida OR precatórios OR arrecadação OR caixa OR "folha de pagamento" OR Propag)'
FINANCAS_B = '(gastos OR despesas OR "ajuste fiscal" OR "equilíbrio fiscal" OR "contas públicas" OR déficit OR superávit OR orçamento)'


def consultas(cfg):
    """(rótulo, consulta) sem o recorte de datas, que o coletor acrescenta (when:Nd, ou after/before quando a consulta bate no teto do Google)."""
    for e in cfg["estados"]:
        a, b = e["buscas"]
        yield f"{e['uf']}: transição", f'"{a}" (transição OR "governo eleito" OR "governador eleito")'
        yield f"{e['uf']}: medidas", f'"{a}" (corte OR cortes OR auditoria OR contratos OR rombo OR déficit OR secretarias OR orçamento OR servidores OR "reforma administrativa")'
        yield f"{e['uf']}: contas", f'transição governo "{b}" (corte OR auditoria OR rombo OR déficit OR contratos OR secretarias OR "situação fiscal")'
        yield f"{e['uf']}: finanças 1", f'"{a}" governo {FINANCAS_A}'
        yield f"{e['uf']}: finanças 2", f'"{a}" governo {FINANCAS_B}'
        yield f"{e['uf']}: previdência e FNDR", f'("{a}" previdência) OR (intitle:previdência "{b}") OR (FNDR "{b}")'
    for i, q in enumerate(cfg["buscas_gerais"], 1):
        yield f"geral {i}", q


def com_recorte(q, dias, desde=None, ate=None):
    """Consulta com o recorte: os últimos `dias` dias, ou (desde, ate) como after/before, usado para dividir a consulta que bate no teto de ~100 resultados."""
    if desde and ate:
        return f"{q} after:{desde:%Y-%m-%d} before:{ate:%Y-%m-%d}"
    return f"{q} when:{dias}d"


def metades(dias, hoje, inicio):
    """Divide a janela de coleta em duas, no meio: [(início, meio), (meio, amanhã)]."""
    ini = max(hoje - timedelta(days=dias), inicio)
    meio = ini + (hoje - ini) / 2
    return [(ini, meio), (meio, hoje + timedelta(days=1))]


def _ler(q):
    """Lê uma consulta do Google Notícias; devolve (itens, erro)."""
    try:
        return N.ler_feed(N.baixar(N.GOOGLE.format(q=urllib.parse.quote(q)))), ""
    except (RuntimeError, ValueError, Exception) as e:  # uma consulta que falha não derruba as outras
        return [], str(e)[:160]


def coletar(cfg, dias, hoje, max_consultas=None):
    F = preparar(cfg)
    inicio = datetime.fromisoformat(cfg["desde"] + "T00:00:00-03:00").astimezone(timezone.utc)
    limite = max(hoje - timedelta(days=dias), inicio)
    teto = cfg.get("janela_dividir_acima_de", 90)
    coletados, relatorio = [], []

    def aceitar(itens):
        aceitos = 0
        for it in itens:
            veiculo = it["veiculo"] or "Google Notícias"
            titulo = N.tirar_veiculo_do_titulo(it["titulo"], veiculo)
            data = it["data"] or hoje
            if data < limite:
                continue
            if classificar(cfg, titulo, F):
                aceitos += 1
                coletados.append({"titulo": titulo, "veiculo": veiculo, "url": it["url"], "data": data})
        return aceitos

    for n, (rotulo, q) in enumerate(consultas(cfg)):
        if max_consultas is not None and n >= max_consultas:
            break
        itens, erro = _ler(com_recorte(q, dias))
        lidos, aceitos = len(itens), aceitar(itens)
        extra = ""
        # o Google devolve no máximo cerca de 100 resultados: consulta que chega perto do teto perdeu as notícias mais antigas, então é refeita em duas janelas de datas
        if not erro and lidos >= teto:
            for de, ate in metades(dias, hoje, inicio):
                time.sleep(PAUSA)
                it2, erro2 = _ler(com_recorte(q, dias, de, ate))
                lidos += len(it2)
                aceitos += aceitar(it2)
                erro = erro or erro2
            extra = " (dividida em duas janelas)"
        relatorio.append({"consulta": rotulo + extra, "ok": not erro, "lidos": lidos, "aceitos": aceitos, **({"erro": erro} if erro else {})})
        time.sleep(PAUSA)
    return coletados, relatorio


# ---------------------------------------------------------------- consolidação

def consolidar(cfg, coletados, hoje, existentes=None):
    """Junta o coletado ao já guardado, deduplica pelo título e reclassifica tudo pelas regras de hoje (mudar o config vale para o que já foi guardado)."""
    F = preparar(cfg)
    desde = datetime.fromisoformat(cfg["desde"] + "T00:00:00-03:00").astimezone(timezone.utc)
    por_id = {i["id"]: i for i in (existentes or [])}
    for c in coletados:
        i = N.id_de(c["titulo"])
        atual = por_id.get(i)
        reg = {"veiculo": c["veiculo"], "url": c["url"]}
        if atual is None:
            # no primeiro levantamento nada é "novo": a data de coleta é a da própria notícia
            por_id[i] = {"id": i, "titulo": c["titulo"], "veiculo": c["veiculo"], "url": c["url"], "data": N.iso(c["data"]), "coletado_em": N.iso(hoje if existentes else c["data"]), "outras": []}
            continue
        if N.eh_redirecionador(atual["url"]) and not N.eh_redirecionador(c["url"]):
            reg, atual["veiculo"], atual["url"] = {"veiculo": atual["veiculo"], "url": atual["url"]}, c["veiculo"], c["url"]
        if reg["url"] != atual["url"] and all(o["url"] != reg["url"] for o in atual["outras"]) and len(atual["outras"]) < N.MAX_OUTRAS \
                and N.normalizar(reg["veiculo"]) != N.normalizar(atual["veiculo"]):
            atual["outras"].append(reg)
    itens = []
    for it in por_id.values():
        if datetime.fromisoformat(it["data"].replace("Z", "+00:00")) < desde:
            continue
        c = classificar(cfg, it["titulo"], F)
        if not c:
            continue
        it.update(c)
        itens.append(it)
    itens.sort(key=lambda x: (x["data"], x["id"]), reverse=True)
    return itens


def montar(cfg, itens, hoje):
    por_uf = {e["uf"]: sum(1 for i in itens if e["uf"] in i["ufs"]) for e in cfg["estados"]}
    return {"gerado_em": N.iso(hoje), "ref": N.iso(hoje)[:10], "desde": cfg["desde"],
            "estados": [{k: e[k] for k in ("uf", "nome", "eleito", "partido")} | {"total": por_uf[e["uf"]]} for e in cfg["estados"]],
            "temas": {k: v["rotulo"] for k, v in cfg["temas"].items()},
            "contagem": {"total": len(itens), "medidas": sum(1 for i in itens if i["categoria"] == "medida"), "equipe": sum(1 for i in itens if i["categoria"] == "equipe")},
            "itens": itens}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, help="janela de coleta em dias (padrão: janela_dias do config.json)")
    ap.add_argument("--dry-run", action="store_true", help="só mostra o resumo")
    ap.add_argument("--amostra", type=int, metavar="N", help="só as N primeiras consultas (para a verificação do PR: prova que o Google responde sem gastar minutos)")
    args = ap.parse_args()
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    hoje = N.agora()
    coletados, relatorio = coletar(cfg, args.dias or cfg["janela_dias"], hoje, args.amostra)
    existentes = []
    if SAIDA.exists():
        try:
            existentes = json.loads(SAIDA.read_text(encoding="utf-8")).get("itens", [])
        except ValueError:
            pass
    falhas = [r for r in relatorio if not r["ok"]]
    for r in relatorio:
        print(f"{'ok  ' if r['ok'] else 'FALHA'} {r['consulta']:<22} lidos={r['lidos']:<4} aceitos={r['aceitos']}" + (f"  {r.get('erro', '')}" if not r["ok"] else ""))
    if relatorio and len(falhas) == len(relatorio):
        sys.exit("nenhuma consulta respondeu: nada foi gravado")
    itens = consolidar(cfg, coletados, hoje, existentes)
    saida = montar(cfg, itens, hoje)
    c = saida["contagem"]
    print(f"\n{c['total']} notícias guardadas ({c['medidas']} de medidas e diagnósticos, {c['equipe']} de equipe e protocolo); " + ", ".join(f"{e['uf']} {e['total']}" for e in saida["estados"]))
    if args.dry_run:
        return
    if existentes and [i["id"] for i in itens] == [i["id"] for i in existentes] and all(a.get("temas") == b.get("temas") and a.get("ufs") == b.get("ufs") for a, b in zip(itens, existentes)):
        print("sem novidades: o arquivo não foi alterado")
        return
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
