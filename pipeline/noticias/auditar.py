#!/usr/bin/env python3
"""
Auditoria do filtro de notícias: mostra o que ele DESCARTA e por quê.

Uma notícia relevante que o filtro recusa não deixa rastro, então este é o único jeito de achar esse tipo de
falha. Rode de vez em quando (ou depois de mudar o config.json) e leia a lista de descartes procurando o que
deveria ter entrado; cada achado vira termo no config.json e teste em testes/.

Uso:
  python3 -I pipeline/noticias/auditar.py                 # resumo por motivo e amostra de cada um
  python3 -I pipeline/noticias/auditar.py --dias 3 --todos   # lista todos os descartes
"""

import argparse
import collections
import importlib.util
import json
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("coletar", AQUI / "coletar.py")
coletar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coletar)

MOTIVOS = {
    "possivel": "parece assunto público capixaba mas não cita o Estado: fica guardada como POSSÍVEL (veja se alguma merece virar regra)",
    "sem_contexto_com_tema": "tem palavra de tema mas nenhum contexto do Estado (RISCO MAIOR de perder matéria relevante)",
    "sem_contexto": "nenhum contexto do Estado e nenhum tema (veio de busca sobre o ES, mas o título não diz nada do governo)",
    "excluir": "caiu numa palavra da lista 'excluir'",
    "outro_estado": "cita a sigla de outro estado (SP, DF...) sem nenhuma âncora do ES",
    "veiculo_excluido": "veio de site que só republica concursos",
    "caixa_alta": "aviso legal em caixa alta",
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, default=3)
    ap.add_argument("--amostra", type=int, default=25, help="quantos títulos mostrar por motivo")
    ap.add_argument("--todos", action="store_true", help="mostra todos os descartes")
    args = ap.parse_args()
    cfg = json.loads((AQUI / "config.json").read_text(encoding="utf-8"))
    desc = []
    aceitas, rel = coletar.coletar(cfg, args.dias, descartadas=desc)
    vistos, unicos = set(), []
    for d in desc:  # a mesma matéria aparece em várias buscas
        k = coletar.normalizar(d["titulo"])
        if k not in vistos:
            vistos.add(k)
            unicos.append(d)
    print(f"Janela de {args.dias} dias: {len(aceitas)} aceitas, {len(unicos)} descartadas distintas (fontes ok: {sum(r['ok'] for r in rel)} de {len(rel)}).\n")
    por = collections.defaultdict(list)
    for d in unicos:
        por[d["motivo"]].append(d)
    for motivo, texto in MOTIVOS.items():
        lista = por.get(motivo, [])
        print(f"== {motivo}: {len(lista)}  ({texto})")
        for d in (lista if args.todos else lista[: args.amostra]):
            print(f"   {d['data'].strftime('%d/%m %H:%M')} | {d['veiculo'][:16]:16} | {d['titulo'][:110]}")
        print()


if __name__ == "__main__":
    main()
