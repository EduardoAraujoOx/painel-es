#!/usr/bin/env python3
"""Pagamentos de pessoal feitos fora da folha, por fundos, e por isso fora da despesa de pessoal do órgão.

Caso típico: a indenização de transporte dos Auditores Fiscais da Receita Estadual é paga pelo Funsefaz (unidade
gestora própria, elemento 3.3.90.93), e não pela unidade gestora da SEFAZ; na PGE, o fundo da procuradoria paga parte
da folha (auxílio-saúde, licenças compensatórias, bolsas). A execução da despesa (SIGEFES, Portal da Transparência)
mostra esses pagamentos; este script os identifica por REGRAS declaradas abaixo (unidade gestora, elemento da despesa,
tipo de favorecido e texto do histórico) e gera data/cargos/complementos.json, que o módulo Cargos exibe como um cartão
a mais na página do órgão, sem mexer na estrutura do painel.

Para incluir outro caso (outro fundo, outro órgão), basta acrescentar uma regra em REGRAS.

Mede o PAGO (ValorPago) e os restos a pagar pagos (ValorRap) de cada mês e, quando o favorecido é pessoa física, quantos
favorecidos distintos receberam no mês (sem nomes nem CPFs).

Uso: python3 -I pipeline/cargos/complementos.py [anos...]    (padrão: 2024 2025 2026)
"""
import collections
import csv
import json
import os
import re
import subprocess
import sys
from multiprocessing import Pool

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(RAIZ, "pipeline", "contratos"))
import execucao as E  # noqa: E402

DESTINO = os.path.join(RAIZ, "data", "cargos", "complementos.json")
REGRAS = [
    {"id": "funsefaz-transporte", "sigla": "SEFAZ", "ug": "220901", "fundo": "Funsefaz",
     "titulo": "Indenização de transporte dos Auditores Fiscais",
     "descricao": "Paga pelo Funsefaz, e não pela unidade gestora da SEFAZ, aos ocupantes do cargo de Auditor Fiscal da Receita Estadual (histórico dos pagamentos: art. 58 da LC 737/2013). Não entra na despesa de pessoal da SEFAZ.",
     "elementos": {"93"}, "tipo_fav": {"1"}, "historico": r"TRANSPORTE", "componentes": {}, "beneficiarios": True},
    {"id": "pge-folha-fundo", "sigla": "PGE", "ug": "160901", "fundo": "fundo da PGE",
     "titulo": "Folha complementar paga pelo fundo da PGE",
     "descricao": "Pagamentos de folha feitos pela unidade gestora do fundo da Procuradoria, e não pela unidade gestora da PGE. A folha é paga em bloco (o favorecido é a própria folha), então não há como contar pessoas. Os componentes são identificados pelo elemento da despesa e pelo histórico do empenho.",
     "elementos": None, "tipo_fav": None, "historico": r"FOLHA",
     "componentes": {"8": "Auxílio-saúde dos procuradores", "11": "Licenças compensatórias dos procuradores", "36": "Bolsa de residência jurídica e estagiários",
                     "92": "Despesas de exercícios anteriores da folha"}, "beneficiarios": False},
]
UGS = {r["ug"].encode() for r in REGRAS}


def ler_fatia(args):
    """Lê uma fatia de bytes do CSV. Devolve None se o download falhar no meio (o chamador repete a fatia inteira)."""
    url, ini, fim, tam, idx = args
    agg = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])        # (regra, componente, mes) -> empenho, liquidado, pago, rap
    pessoas = collections.defaultdict(set)                               # (regra, mes) -> favorecidos pessoa física
    por_pessoa = collections.defaultdict(float)                          # (regra, nome, cpf mascarado, mes) -> pago + restos a pagar pagos
    ugnome, elemdesc, fora = {}, {}, collections.defaultdict(float)
    vistas = set()                                                       # linhas idênticas dentro da fatia contam uma vez só
    cmd = ["curl", "-sS", "-L", "--fail", "--retry", "4", "--retry-delay", "3", "-r", f"{max(0, ini - 1)}-{min(tam - 1, fim + E.SOBRA)}", url]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 20)
    pos = max(0, ini - 1)
    primeira = True
    for linha in p.stdout:
        inicio = pos
        pos += len(linha)
        if primeira:
            primeira = False
            if ini > 0 or inicio == 0:
                continue
        if inicio >= fim:
            continue                          # além da fatia: lê até o fim do pedido, para conferir que o download terminou bem
        if not any(u in linha for u in UGS):
            continue
        h = hash(linha)
        if h in vistas:
            continue
        vistas.add(h)
        try:
            c = next(csv.reader([linha.decode("utf-8", "replace")], delimiter=";"))
        except csv.Error:
            continue
        if len(c) < 71:
            continue
        ug = c[idx["CodigoUnidadeGestora"]]
        for r in REGRAS:
            if ug != r["ug"]:
                continue
            ugnome[ug] = c[idx["UnidadeGestora"]]
            el, tf, hist = c[idx["CodigoElementoDespesa"]], c[idx["TipoFavorecido"]], c[idx["HistoricoDocumento"]]
            pago = E.valor(c[4].encode()) + E.valor(c[5].encode())
            if (r["elementos"] is None or el in r["elementos"]) and (r["tipo_fav"] is None or tf in r["tipo_fav"]) and re.search(r["historico"], hist, re.I):
                mes = c[1][6:10] + "-" + c[1][3:5]
                comp = el if r["componentes"] else ""
                a = agg[(r["id"], comp, mes)]
                a[0] += E.valor(c[2].encode()); a[1] += E.valor(c[3].encode()); a[2] += E.valor(c[4].encode()); a[3] += E.valor(c[5].encode())
                elemdesc[el] = c[idx["DescricaoElementoDespesa"]]
                if r["beneficiarios"] and tf == "1":
                    pessoas[(r["id"], mes)].add(c[idx["IdFavorecido"]])
                    por_pessoa[(r["id"], c[idx["Favorecido"]].strip(), c[idx["CpfCnpjNis"]].strip(), mes)] += pago
            else:
                fora[(r["id"], el, tf)] += pago
    p.stdout.close()
    if p.wait() != 0:
        return None
    return dict(agg), {k: v for k, v in pessoas.items()}, ugnome, elemdesc, dict(fora), dict(por_pessoa)


def fatia(args):
    for _ in range(4):
        r = ler_fatia(args)
        if r is not None:
            return r
    raise RuntimeError(f"fatia {args[1]}-{args[2]} de {args[0][-40:]} falhou 4 vezes")


def main():
    anos = sys.argv[1:] or ["2024", "2025", "2026"]
    urls = E.resolver_recursos()
    agg = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
    pessoas = collections.defaultdict(set)
    ugnome, elemdesc, fora = {}, {}, collections.defaultdict(float)
    por_pessoa = collections.defaultdict(float)
    with Pool(14) as pool:
        for ano in anos:
            url = urls[ano]
            cab = E.cabecalho(url)
            idx = {n: cab.index(n) for n in ("CodigoUnidadeGestora", "UnidadeGestora", "CodigoElementoDespesa", "DescricaoElementoDespesa", "TipoFavorecido", "HistoricoDocumento", "IdFavorecido", "Favorecido", "CpfCnpjNis")}
            tam = E.tamanho(url)
            trabalhos = [(url, i, min(tam, i + E.FATIA), tam, idx) for i in range(0, tam, E.FATIA)]
            for a, p, un, ed, fo, pp in pool.imap_unordered(fatia, trabalhos):
                for k, v in a.items():
                    t = agg[k]
                    for j in range(4):
                        t[j] += v[j]
                for k, v in p.items():
                    pessoas[k] |= v
                ugnome.update(un); elemdesc.update(ed)
                for k, v in pp.items():
                    por_pessoa[k] += v
                for k, v in fo.items():
                    fora[k] += v
            print(f"{ano}: lido", flush=True)

    meses_todos = sorted({k[2] for k in agg})
    while meses_todos and all(abs(v[2] + v[3]) < 1 for k, v in agg.items() if k[2] == meses_todos[-1]):
        meses_todos.pop()                      # mês corrente só com empenho, ainda sem pagamento: fora da série
    itens = []
    for r in REGRAS:
        meses = [m for m in meses_todos if any(k[0] == r["id"] and k[2] == m for k in agg)]
        serie = {m: {"pago": round(sum(v[2] for k, v in agg.items() if k[0] == r["id"] and k[2] == m), 2),
                     "rap": round(sum(v[3] for k, v in agg.items() if k[0] == r["id"] and k[2] == m), 2),
                     "favorecidos": len(pessoas.get((r["id"], m), ()))} for m in meses}
        comps = []
        for cod, rotulo in r["componentes"].items():
            comps.append({"cod": cod, "rotulo": rotulo, "elemento": elemdesc.get(cod, ""),
                          "serie": {m: round(agg[(r["id"], cod, m)][2] + agg[(r["id"], cod, m)][3], 2) for m in meses if (r["id"], cod, m) in agg}})
        itens.append({"id": r["id"], "sigla": r["sigla"], "titulo": r["titulo"], "descricao": r["descricao"], "fundo": r["fundo"], "ug": r["ug"], "ugNome": ugnome.get(r["ug"], ""),
                      "serie": serie, "componentes": comps, "beneficiarios": r["beneficiarios"]})
        total = sum(v["pago"] + v["rap"] for v in serie.values())
        naofora = {k: v for k, v in fora.items() if k[0] == r["id"]}
        print(f"{r['id']}: {len(meses)} meses ({meses[0] if meses else '-'} a {meses[-1] if meses else '-'}), pago+RAP R$ {total / 1e6:,.2f} mi | fora da regra na mesma UG: R$ {sum(naofora.values()) / 1e6:,.2f} mi", flush=True)
        for k, v in sorted(naofora.items(), key=lambda x: -x[1])[:6]:
            print(f"    fora: elemento {k[1]} tipo favorecido {k[2]}: R$ {v / 1e6:,.2f} mi", flush=True)
    saida = {"fonte": "SIGEFES, despesas (Portal da Transparência do ES)", "anos": [int(a) for a in anos], "ate": meses_todos[-1] if meses_todos else "", "itens": itens}
    json.dump(saida, open(DESTINO, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("→", DESTINO)
    # pagamentos por favorecido pessoa física e mês (nomes e CPF mascarado), lidos por pipeline/pessoalfundos/montar.py; não vai para data/
    os.makedirs(os.path.join(RAIZ, ".cache", "fundos"), exist_ok=True)
    json.dump(sorted([list(k) + [round(v, 2)] for k, v in por_pessoa.items()]), open(os.path.join(RAIZ, ".cache", "fundos", "complementos_pessoas.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
