#!/usr/bin/env python3
"""Monta os dados do módulo "organograma": unidades e pessoas por órgão.

Entradas (geradas pelo pipeline do módulo cargos):
    .cache/cargos/AAAA-MM.json   rubricas de cada ocupante (usa só o último mês)
    .cache/cargos/vinculos.json  setor de lotação, vínculo oficial e nome dos órgãos
Estrutura (de onde vem a subordinação), em ordem de prioridade:
    estrutura/oficial/<ORGAO>.json   retrato do Organograma ES, baixado por baixar_estrutura.py
    estrutura/<ORGAO>.csv            tabela manual, só para órgãos sem retrato oficial

Saídas, em data/organograma/ (servidas apenas depois do login):
    index.json            um registro por órgão, com totais por condição
    org/<SIGLA>.json      unidades (árvore) e pessoas do órgão

De onde vem a hierarquia, e o que NÃO se sabe:
  * A base de vínculos informa o setor de cada pessoa (código e nome), mas não diz quem é
    subordinado a quem. O código também não é confiável como nível hierárquico: na SEFAZ,
    a SUEFI tem código de nível 2 e o organograma a coloca na gerência GEARC (nível 4).
  * Por isso a subordinação vem de tabelas por órgão em estrutura/<ORGAO>.csv, transcritas
    de decretos e organogramas oficiais, com a fonte de cada linha. Hoje só a SEFAZ tem tabela.
  * Nos órgãos sem tabela, e nas unidades que não constam dela, a unidade aparece sob um
    agrupamento marcado como "subordinação não confirmada", ordenado pelo nível do código do
    setor. Nenhuma subordinação é inferida por nome ou sigla.
"""
import argparse
import collections
import csv
import glob
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "cargos"))
import regras  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(AQUI))
CACHE = os.path.join(RAIZ, ".cache", "cargos")
CACHE_ORG = os.path.join(RAIZ, ".cache", "organograma")
SAIDA = os.path.join(RAIZ, "data", "organograma")
ESTRUTURA = os.path.join(AQUI, "estrutura")
TIPO_COMPLETO = {"CC": regras.TIPO_CC, "FG": regras.TIPO_FG}

NIVEIS = {
    1: "Secretaria ou órgão (nível 1 do código)",
    2: "Gabinete, assessorias e subsecretarias (nível 2 do código)",
    3: "Gerências e grupos (nível 3 do código)",
    4: "Subgerências e agências (nível 4 do código)",
    5: "Núcleos e unidades (nível 5 do código)",
}


def seguro(sigla):
    return re.sub(r"[^A-Za-z0-9_-]", "_", sigla)


def limpar(texto):
    return re.sub(r"\s+", " ", texto or "").strip()


def norm(texto):
    return re.sub(r"[^A-Z0-9]+", " ", (texto or "").upper()).strip()


def nivel_do_codigo(codigo):
    """Nível hierárquico pelo código de 11 dígitos (dígitos 3 e 4); None se o formato é outro."""
    if re.fullmatch(r"\d{11}", codigo or ""):
        return int(codigo[2:4])
    return None


def carregar_estrutura(sigla_orgao):
    caminho = os.path.join(ESTRUTURA, sigla_orgao + ".csv")
    if not os.path.exists(caminho):
        return None
    with open(caminho, encoding="utf-8", newline="") as f:
        linhas = list(csv.DictReader(f, delimiter=";"))
    # o separador é ';': um ';' dentro de um texto desloca colunas e corrompe a estrutura
    for n, l in enumerate(linhas, start=2):
        codigo = (l.get("codigo") or "").strip()
        if None in l or (codigo and not codigo.isdigit()) or l["situacao"] not in ("confirmada", "a conferir"):
            sys.exit(f"{caminho}, linha {n}: formato inválido (há ';' dentro de um texto?): {l['sigla']}")
    return linhas


def carregar_oficial(sigla_orgao):
    """Retrato da árvore oficial (Organograma ES) baixado por baixar_estrutura.py, ou None."""
    caminho = os.path.join(ESTRUTURA, "oficial", seguro(sigla_orgao) + ".json")
    return json.load(open(caminho, encoding="utf-8")) if os.path.exists(caminho) else None


def variantes(nome, sigla_org):
    """Formas normalizadas de um nome de unidade, da mais específica à mais genérica: o nome
    inteiro, sem o sufixo do órgão (' - SEP') e sem o último segmento depois do hífen (a sigla)."""
    n = norm(nome)
    saida = [n]
    s = norm(sigla_org)
    if s and n.endswith(" " + s):
        saida.append(n[: -len(s)].strip())
    base = re.sub(r"\s*-\s*[A-Z0-9][A-Z0-9 ./-]*$", "", (nome or "").upper()).strip()
    if base and norm(base) not in saida:
        saida.append(norm(base))
    return [v for v in saida if v]


def sem_sufixo(nome, sigla, sigla_org):
    """Tira do fim do nome oficial a sigla da unidade e a do órgão (a interface mostra a sigla à parte)."""
    n = limpar(nome)
    for sg in (sigla, sigla_org):
        if sg:
            n = re.sub(r"\s*-\s*" + re.escape(sg) + r"\s*$", "", n, flags=re.I)
    return n.strip(" -")


def sigla_do_setor(nome_setor, siglas_conhecidas):
    """Sigla da estrutura com que o nome do setor TERMINA (ex.: '... - SUGOV'); a mais longa vence."""
    n = norm(nome_setor)
    achada = None
    for sigla in siglas_conhecidas:
        s = norm(sigla)
        if n == s or n.endswith(" " + s):
            if achada is None or len(s) > len(norm(achada)):
                achada = sigla
    return achada


def main():
    global SAIDA
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", help="pasta de saída (padrão: data/organograma/)")
    a = ap.parse_args()
    if a.saida:
        SAIDA = os.path.abspath(a.saida)

    meses = sorted(glob.glob(os.path.join(CACHE, "????-??.json")))
    if not meses:
        sys.exit("sem extrações mensais em .cache/cargos/")
    ultimo = json.load(open(meses[-1]))
    vinc_path = os.path.join(CACHE, "vinculos.json")
    extra = json.load(open(vinc_path))
    if not extra["vinculos"] or len(next(iter(extra["vinculos"].values()))) < 5:
        sys.exit("vinculos.json sem campos de setor: rode pipeline/cargos/extrair_vinculos.py")

    todos_vinc = json.load(open(os.path.join(CACHE, "vinculos_todos.json")))
    todos = json.load(open(os.path.join(CACHE_ORG, "todos.json")))
    if todos["mes"] != os.path.basename(meses[-1])[:7]:
        sys.exit("todos.json é de outro mês: rode extrair_todos.py")
    sem_por_org = collections.defaultdict(list)
    for org_, nf, nv, nome, cargo, bruto, abate in todos["pessoas"]:
        sem_por_org[org_].append((nf, nv, nome, cargo, bruto, abate))

    # --- pessoas do último mês, com condição e remuneração -----------------------------
    pessoas_por_org = collections.defaultdict(list)
    # padrão do subsídio da função (mesma regra do módulo cargos)
    sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "cargos"))
    import montar as montar_cargos  # noqa: E402
    registros = [r for r in ultimo["registros"] if r[0] not in regras.ORGAOS_EXCLUIDOS]
    padrao = montar_cargos.subsidio_padrao_por_funcao(registros)
    for org, nf, nv, nome, funcao, tipo, unidade, cargo_ef, rub in registros:
        funcao = limpar(funcao)
        valor, prov, ocupante, subs_carreira = regras.valor_e_provimento(
            TIPO_COMPLETO[tipo], rub, cargo_ef, padrao.get(funcao))
        if not ocupante:
            continue
        bruto, abate = regras.remuneracao(rub)
        v = extra["vinculos"].get(f"{org}|{nf}|{nv}")
        pessoas_por_org[org].append({
            "id": f"{nf}-{nv}", "nome": nome, "funcao": funcao, "tipo": tipo,
            "cond": regras.condicao(prov, cargo_ef, tipo), "prov": prov,
            "valor": valor, "bruto": bruto, "abate": abate or None,
            "subsidioCarreira": subs_carreira or None, "cargoEfetivo": cargo_ef.strip(),
            "vinculo": v[0] if v else None,
            "_cod": v[2] if v else "", "_setor": limpar(v[3]) if v else "",
        })

    for pasta in ("org", "todos"):
        os.makedirs(os.path.join(SAIDA, pasta), exist_ok=True)
        for antigo in glob.glob(os.path.join(SAIDA, pasta, "*.json")):
            os.remove(antigo)

    resumo = []
    for org in sorted(pessoas_por_org):
        pessoas = pessoas_por_org[org]
        nome_org = limpar(extra["orgaos"].get(org, org))
        oficial = carregar_oficial(org)
        estrutura = None if oficial else carregar_estrutura(org)
        unidades = {}   # id -> dict
        ordem = []

        def nova(uid, **kw):
            unidades[uid] = {"id": uid, **kw}
            ordem.append(uid)

        # raiz = o próprio órgão
        nova(org, nome=nome_org, sigla=org, pai=None, situacao="raiz", fonte="")
        siglas = {}
        por_codigo = {}
        por_nome = collections.defaultdict(set)      # variante do nome -> ids (estrutura oficial)
        por_sigla_of = collections.defaultdict(set)  # sigla normalizada -> ids (estrutura oficial)
        fonte_oficial = ""
        if oficial:
            fonte_oficial = f"Organograma ES (organograma.es.gov.br), retrato de {oficial['capturadoEm']}"

            def adicionar(u, pai_id):
                uid = "o:" + u["id"]
                nova(uid, nome=sem_sufixo(u["nome"], u["sigla"], org), sigla=u["sigla"], pai=pai_id,
                     situacao="oficial", fonte=fonte_oficial)
                for v in variantes(u["nome"], org):
                    por_nome[v].add(uid)
                if u["sigla"]:
                    por_sigla_of[norm(u["sigla"])].add(uid)
                for f in u["filhas"]:
                    adicionar(f, uid)
            topos = oficial["unidades"]
            if len(topos) == 1:       # a unidade de topo é o próprio órgão
                for v in variantes(topos[0]["nome"], org):
                    por_nome[v].add(org)
                for f in topos[0]["filhas"]:
                    adicionar(f, org)
            else:
                for t in topos:
                    adicionar(t, org)
        if estrutura:
            for linha in estrutura:
                cod_fixo = (linha.get("codigo") or "").strip()
                if cod_fixo:
                    por_codigo[cod_fixo] = "u:" + linha["sigla"]   # casamento direto pelo código do setor
                else:
                    siglas[linha["sigla"]] = linha
                nova("u:" + linha["sigla"], nome=linha["nome"], sigla="" if cod_fixo else linha["sigla"],
                     pai=linha["pai"] if linha["pai"] == org else "u:" + linha["pai"],
                     situacao=linha["situacao"], fonte=linha["fonte"])

        # --- atribui cada pessoa a uma unidade ---------------------------------------
        def agrupamento(nivel):
            chave = f"n:{nivel}"
            if chave not in unidades:
                rotulo = NIVEIS.get(nivel, "Unidades sem nível identificado no código")
                nova(chave, nome=rotulo, sigla="", pai=org, situacao="nao-confirmada",
                     fonte="Subordinação não confirmada: agrupado pelo nível do código do setor")
            return chave

        def atribuir(cod, setor):
            """Unidade (id) em que uma pessoa se encaixa, criando agrupamentos de reserva quando preciso."""
        nivel = nivel_do_codigo(cod)
        uid = None
        if oficial:
            # 0) o código do setor é a própria sigla da unidade (ocorre, por exemplo, no CBMES)
            if cod and len(por_sigla_of.get(norm(cod), ())) == 1:
                uid = next(iter(por_sigla_of[norm(cod)]))
            # 1) nome idêntico ou equivalente (sem o sufixo do órgão), se aponta para uma só unidade
            for v in ([] if uid else variantes(setor, org)):
                if len(por_nome.get(v, ())) == 1:
                    uid = next(iter(por_nome[v]))
                    break
            # 2) sigla da unidade ao final do nome do setor (a mais longa), se for única
            if uid is None and setor:
                n = norm(setor)
                achados = [(len(sg), next(iter(ids))) for sg, ids in por_sigla_of.items()
                           if len(sg) >= 2 and len(ids) == 1 and (n == sg or n.endswith(" " + sg))]
                if achados:
                    uid = max(achados)[1]
        if uid is None and estrutura:
            uid = por_codigo.get(cod)
            if uid is None:
                s = sigla_do_setor(setor, siglas)
                if s:
                    uid = "u:" + s
        # raiz: o setor de nível 1 do código que leva o nome do próprio órgão (ex.: o gabinete
        # do titular da pasta); as demais unidades de nível 1 ficam como unidades à parte
        if uid is None and nivel == 1 and norm(setor).endswith(" " + norm(org)):
            uid = org
        if uid is None:
            uid = "s:" + (cod or "sem-setor")
            if uid not in unidades:
                # setor homônimo do órgão (comum na base) não pode se passar pela raiz
                rotulo = setor or "Setor não informado"
                if cod and norm(setor) == norm(nome_org):
                    rotulo = f"Setor {cod} (a base só informa o nome do órgão)"
                nova(uid, nome=rotulo, sigla="",
                     pai=agrupamento(nivel), situacao="nao-confirmada",
                     fonte=("Setor da base de vínculos que não foi encontrado no Organograma ES; subordinação não confirmada"
                            if oficial else "Unidade fora da estrutura transcrita; subordinação não confirmada"))
            return uid

        for p in pessoas:
            p["unidade"] = atribuir(p.pop("_cod"), p.pop("_setor"))

        # pessoas SEM cargo em comissão nem função gratificada (extrair_todos.py)
        sem = []
        for nf, nv, nome, cargo, bruto, abate in sem_por_org.get(org, []):
            v = todos_vinc.get(f"{org}|{nf}|{nv}")
            sem.append([f"{nf}-{nv}", nome, cargo, v[0] if v else None, bruto, abate or None,
                        atribuir(v[1] if v else "", limpar(v[2]) if v else "")])

        # agrupamentos por nível do código em ordem numérica, depois das unidades da estrutura
        posicao = {i: k for k, i in enumerate(ordem)}

        def chave_ordem(i):
            if i.startswith("n:"):
                n = i[2:]
                return (1, int(n) if n.isdigit() else 99, 0)
            return (0, 0, posicao[i])
        ordem.sort(key=chave_ordem)

        # contagem para o resumo
        cont = collections.Counter(p["cond"] for p in pessoas)
        resumo.append({"sigla": org, "arquivo": seguro(org), "nome": nome_org,
                       "pessoas": len(pessoas), "puro": cont["puro"], "carreira": cont["carreira"],
                       "fg": cont["fg"], "valor": round(sum(p["valor"] for p in pessoas), 2),
                       "bruto": round(sum(p["bruto"] for p in pessoas), 2),
                       "estruturaOficial": bool(oficial or estrutura),
                       "estruturaFonte": "oficial" if oficial else ("manual" if estrutura else None),
                       "semUnidade": sum(1 for p in pessoas if unidades[p["unidade"]]["situacao"] == "nao-confirmada"),
                       "sem": len(sem), "semBruto": round(sum(x[4] for x in sem), 2),
                       "semSemUnidade": sum(1 for x in sem if unidades[x[6]]["situacao"] == "nao-confirmada")})
        pessoas.sort(key=lambda p: (-p["valor"], p["nome"]))
        # quem não ocupa cargo: formato compacto (lista de listas), unidade pelo índice no arranjo "unidades"
        indice_un = {i: k for k, i in enumerate(ordem)}
        sem.sort(key=lambda x: (-x[4], x[1]))
        json.dump({"sigla": org, "mes": meses[-1][-12:-5],
                   "colunas": ["id", "nome", "cargoEfetivo", "vinculo", "bruto", "abate", "unidade"],
                   "pessoas": [x[:6] + [indice_un[x[6]]] for x in sem]},
                  open(os.path.join(SAIDA, "todos", seguro(org) + ".json"), "w"),
                  ensure_ascii=False, separators=(",", ":"))
        json.dump({"sigla": org, "nome": nome_org, "mes": meses[-1][-12:-5],
                   "unidades": [unidades[i] for i in ordem], "pessoas": pessoas},
                  open(os.path.join(SAIDA, "org", seguro(org) + ".json"), "w"),
                  ensure_ascii=False, separators=(",", ":"))

    json.dump({"mes": os.path.basename(meses[-1])[:7], "orgs": resumo,
               "fonte": {"folha": "Portal da Transparência — Pessoal (SEGER/ES)",
                         "estrutura": "Organograma ES (organograma.es.gov.br), plataforma oficial do Governo do ES; "
                                      "tabelas manuais só para órgãos sem retrato oficial"}},
              open(os.path.join(SAIDA, "index.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(resumo)} órgãos; {sum(r['pessoas'] for r in resumo)} pessoas com cargo/função; "
          f"{sum(r['sem'] for r in resumo)} sem cargo/função ({sum(r['semSemUnidade'] for r in resumo)} sem unidade)")
    print(f"{'órgão':16}{'pessoas':>8}{'sem unidade':>13}{'cobertura':>11}")
    for r in sorted(resumo, key=lambda r: -r["pessoas"]):
        cob = 100 * (r["pessoas"] - r["semUnidade"]) / r["pessoas"]
        print(f"{r['sigla']:16}{r['pessoas']:>8}{r['semUnidade']:>13}{cob:>10.0f}%  {r['estruturaFonte'] or 'sem estrutura'}")


if __name__ == "__main__":
    main()
