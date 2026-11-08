"""Funções puras da base ampla de contratos: cruzamento SIGA x PNCP, protocolo do e-Docs, gestão do contrato e corte de Pareto.

Sem rede e sem arquivos: recebem listas de dicionários e devolvem listas, para serem testadas à parte (testes/test_amplo.py).
"""
import datetime
import re

# Protocolo de processo do e-Docs: ano, hífen e 5 caracteres em base 30 (ex.: 2026-1QHD4).
PROTOCOLO = re.compile(r"^\d{4}-[0-9A-Z]{5}$")
URL_CONSULTA = "https://processoeletronico.es.gov.br/?protocolo="


def normaliza_processo(s):
    return re.sub(r"\s+", "", (s or "").strip().upper())


def protocolo_edocs(s):
    """O protocolo normalizado, se o texto tem o formato do e-Docs; senão None."""
    p = normaliza_processo(s)
    return p if PROTOCOLO.match(p) else None


def link_consulta(s):
    """Endereço da consulta pública de processos (abre a consulta já com o protocolo), ou None."""
    p = protocolo_edocs(s)
    return URL_CONSULTA + p if p else None


def casar(siga, pncp, tolerancia_dias=60):
    """Liga contratos do PNCP aos do SIGA.

    Cada item é um dicionário com 'cnpj' (só dígitos), 'processo' (texto) e 'data' (datetime.date ou None, a assinatura/celebração).
    Primeiro casa por CNPJ + processo (protocolo do e-Docs); o que sobra casa por CNPJ + data, dentro da tolerância.
    Em empate vale o par de datas mais próximas; cada contrato é usado uma só vez.
    Devolve (pares [(i_pncp, i_siga)], so_pncp [i_pncp], so_siga [i_siga])."""
    usados_siga, pares = set(), []
    por_cnpj = {}
    for j, s in enumerate(siga):
        por_cnpj.setdefault(s["cnpj"], []).append(j)

    def distancia(a, b):
        return abs((a - b).days) if a and b else 10 ** 6

    pendentes = []
    for i, p in enumerate(pncp):
        proc = normaliza_processo(p.get("processo"))
        cand = []
        if proc:
            cand = [j for j in por_cnpj.get(p["cnpj"], ()) if j not in usados_siga and normaliza_processo(siga[j].get("processo")) == proc]
        if cand:
            j = min(cand, key=lambda j: (distancia(p.get("data"), siga[j].get("data")), j))
            usados_siga.add(j)
            pares.append((i, j))
        else:
            pendentes.append(i)
    so_pncp = []
    for i in pendentes:
        p = pncp[i]
        cand = [j for j in por_cnpj.get(p["cnpj"], ()) if j not in usados_siga and distancia(p.get("data"), siga[j].get("data")) <= tolerancia_dias]
        if cand:
            j = min(cand, key=lambda j: (distancia(p.get("data"), siga[j].get("data")), j))
            usados_siga.add(j)
            pares.append((i, j))
        else:
            so_pncp.append(i)
    so_siga = [j for j in range(len(siga)) if j not in usados_siga]
    return sorted(pares), so_pncp, so_siga


def corte_pareto(valores, fracao=0.8):
    """Quantos dos maiores valores são necessários para somar a fração pedida do total (no mínimo 1; todos, se o total é zero)."""
    ordenados = sorted((v or 0.0 for v in valores), reverse=True)
    total = sum(ordenados)
    if not ordenados:
        return 0
    if total <= 0:
        return len(ordenados)
    acum = 0.0
    for n, v in enumerate(ordenados, 1):
        acum += v
        if acum >= fracao * total:
            return n
    return len(ordenados)


_FUNCOES = {"GESTOR": ("Gestor", 0), "GESTOR TITULAR": ("Gestor", 0), "SUPLENTE_GESTOR": ("Suplente de gestor", 1), "SUPLENTE GESTOR": ("Suplente de gestor", 1),
            "FISCAL": ("Fiscal", 2), "FISCAL TITULAR": ("Fiscal", 2), "SUPLENTE_FISCAL": ("Suplente de fiscal", 3), "SUPLENTE FISCAL": ("Suplente de fiscal", 3),
            "MEMBRO": ("Membro", 4)}


def _data_iso(s):
    try:
        return datetime.datetime.strptime((s or "")[:10], "%d/%m/%Y").date().isoformat()
    except ValueError:
        return ""


def resumir_gestao(linhas):
    """Gestor e fiscal de um contrato, a partir das linhas do arquivo de comissões do SIGA (campos Funcao, Nome, Setor, Situacao, DataInicio, DataFim).

    Devolve [função, nome, setor, início ISO, fim ISO, situação], com gestor antes de fiscal, e sem repetir a mesma pessoa na mesma função."""
    vistos, saida = set(), []
    for r in linhas:
        chave = re.sub(r"\s+", " ", (r.get("Funcao") or "").strip().upper())
        funcao, ordem = _FUNCOES.get(chave, ((r.get("Funcao") or "").strip().title(), 9))
        nome = re.sub(r"\s+", " ", (r.get("Nome") or "").strip())
        if not nome or (funcao, nome.upper()) in vistos:
            continue
        vistos.add((funcao, nome.upper()))
        saida.append((ordem, [funcao, nome, (r.get("Setor") or "").strip(), _data_iso(r.get("DataInicio")), _data_iso(r.get("DataFim")), (r.get("Situacao") or "").strip()]))
    return [x for _, x in sorted(saida, key=lambda t: (t[0], t[1][1]))]


# --- atos do Diário Oficial (diario.py) ligados aos contratos ---------------------------------------------------------------------------------
NUMERO_CONTRATO = re.compile(r"\b(20\d{2}\.\d{6}\.\d{4,6}\.\d{2})\b")
NUMERO_ANTIGO = re.compile(r"(\d{1,10})\s*/\s*(\d{4})")


def numero_estruturado(doc):
    """Número no formato AAAA.NNNNNN.UG.SS dentro do texto do documento do SIGA (ex.: 'Contrato 2024.000050.10109.01/2024'), ou None."""
    m = NUMERO_CONTRATO.search(doc or "")
    return m.group(1) if m else None


def numero_antigo(doc):
    """Numeração antiga 'N/AAAA' (ex.: 'Contrato 023/2022' -> '23/2022'), ou None."""
    m = NUMERO_ANTIGO.search(doc or "")
    return f"{int(m.group(1))}/{m.group(2)}" if m else None


def indexar_atos(atos):
    """Índices dos atos do Diário por número de contrato e por CNPJ."""
    por_n, por_c = {}, {}
    for a in atos:
        if a.get("n"):
            por_n.setdefault(a["n"], []).append(a)
        if a.get("c"):
            por_c.setdefault(a["c"], []).append(a)
    return por_n, por_c


def atos_do_contrato(doc, cnpj, proc, por_n, por_c, maximo=12):
    """Atos do Diário que dizem respeito ao contrato.

    Liga pelo número estruturado do contrato (único: traz o ano, a unidade gestora e a sequência). Só quando o contrato não tem esse número,
    liga pelo CNPJ do fornecedor quando o trecho cita também o mesmo protocolo de processo ou a mesma numeração antiga N/AAAA; com número
    estruturado essa via não vale, porque um mesmo fornecedor e um mesmo processo de origem alcançam contratos de órgãos diferentes. Devolve [[data, tipo, protocolo, página, edição, trecho, campos]] por data (campos: termo, objeto e valor do ato, quando o extrato os traz),
    sem repetir o mesmo ato (data, tipo e protocolo) e ficando com os `maximo` mais recentes."""
    achados = []
    n = numero_estruturado(doc)
    if n:
        achados += por_n.get(n, [])
    antigo, p = numero_antigo(doc), normaliza_processo(proc)
    for a in ([] if n else por_c.get(cnpj, [])):
        if (p and p in a.get("np", ())) or (antigo and antigo in a.get("nc", ())):
            achados.append(a)
    vistos, saida = set(), []
    for a in sorted(achados, key=lambda a: (a["d"], a["p"], -len(a["x"]))):
        chave = (a["d"], a["t"], a["p"])
        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append([a["d"], a["t"], a["p"], a["pg"], a["e"], a["x"][:520], a.get("f") or {}])
    return saida[-maximo:]


def rescisao_publicada(atos, celebracao_iso=""):
    """Data (ISO) da rescisão mais recente publicada no Diário depois da celebração do contrato, ou ''."""
    datas = [a[0] for a in atos if a[1] == "Rescisão" and a[0] >= (celebracao_iso or "")]
    return max(datas) if datas else ""


# --- contato cadastral do fornecedor (Receita Federal) ------------------------------------------------------------------------------------------
def telefone(ddd, numero):
    """'(27) 3331-3100' a partir do DDD e do número da Receita; '' se não houver número utilizável."""
    ddd, numero = re.sub(r"\D", "", ddd or ""), re.sub(r"\D", "", numero or "")
    if len(numero) not in (8, 9) or len(ddd) not in (2, 3):
        return ""
    return f"({ddd}) {numero[:-4]}-{numero[-4:]}"


def contato_cadastral(natureza, email, ddd1="", tel1="", ddd2="", tel2=""):
    """E-mail e telefones do cadastro do CNPJ, ou None se a empresa é individual (empresário individual, inclusive MEI, e EIRELI), cujo contato
    costuma ser pessoal, ou se o cadastro não traz nenhum dos dois."""
    if "individual" in (natureza or "").lower():
        return None
    email = (email or "").strip().lower()
    telefones = []
    for t in (telefone(ddd1, tel1), telefone(ddd2, tel2)):
        if t and t not in telefones:
            telefones.append(t)
    if "@" not in email:
        email = ""
    return {"email": email, "telefones": telefones} if email or telefones else None


# --- pagamentos do SIGEFES sem documento do SIGA: contratos conhecidos só pelo sistema financeiro e fornecedores recorrentes sem contrato registrado ----------
# Elementos de despesa que são compra de bens e contratação de serviços e obras (os que um contrato sustenta). Ficam de fora transferências
# (auxílios, subvenções, contribuições), contratos de gestão com organizações sociais, dívida, tributos, sentenças, pessoal e imóveis.
ELEMENTOS_CONTRATACAO = {"30": "material de consumo", "32": "material de distribuição gratuita", "33": "passagens e locomoção", "34": "terceirização de pessoal",
                         "35": "serviços de consultoria", "37": "locação de mão de obra", "38": "arrendamento mercantil", "39": "outros serviços de terceiros, pessoa jurídica",
                         "40": "serviços de tecnologia da informação e comunicação", "51": "obras e instalações", "52": "equipamentos e material permanente"}
# Seguir o dinheiro: além da contratação, o SIGEFES paga a CNPJs por repasse (parcerias, subvenções, auxílios, contribuições e contratos de gestão com
# organizações sociais) e por pagamentos eventuais (sentenças, despesas de exercícios anteriores, indenizações, aquisição de imóveis). Tributos, obrigações
# patronais, dívida e pessoal ficam de fora: o favorecido é o próprio setor público ou uma instituição financeira e não há o que rever em contrato.
ELEMENTOS_REPASSE = {"41": "contribuições", "42": "auxílios", "43": "subvenções sociais", "45": "subvenções econômicas", "85": "contrato de gestão"}
ELEMENTOS_OUTROS = {"91": "sentenças judiciais", "92": "despesas de exercícios anteriores", "93": "indenizações e restituições", "61": "aquisição de imóveis"}
ELEMENTOS_RASTREAVEIS = {**ELEMENTOS_CONTRATACAO, **ELEMENTOS_REPASSE, **ELEMENTOS_OUTROS}


def classe_do_elemento(el):
    """'contratacao', 'repasse' ou 'outro' conforme o elemento de despesa; None se o elemento não é rastreado."""
    return "contratacao" if el in ELEMENTOS_CONTRATACAO else "repasse" if el in ELEMENTOS_REPASSE else "outro" if el in ELEMENTOS_OUTROS else None


# Natureza jurídica do favorecido (tabela de naturezas da Receita): só empresas privadas e entidades sem fins lucrativos são tratadas como contratadas passíveis de
# revisão. Pagamento a ente público (órgão, autarquia, fundação pública, município, outro poder) ou a estatal é transferência, tributo, dívida, sentença ou
# reembolso, e não contrato: fica de fora da lista e aparece só como resumo.
CLASSES_FORA_DA_LISTA = ("publico", "estatal")
GRUPO_DO_ELEMENTO = {"41": "transferências", "42": "transferências", "43": "transferências", "45": "transferências", "85": "transferências",
                     "47": "tributos e encargos", "13": "tributos e encargos", "04": "tributos e encargos",
                     "71": "dívida", "21": "dívida", "91": "sentenças, exercícios anteriores e indenizações", "92": "sentenças, exercícios anteriores e indenizações",
                     "93": "sentenças, exercícios anteriores e indenizações"}      # os demais (compras, serviços, obras, imóveis): "compras e serviços"


def classe_juridica(codigo, descricao=""):
    """'publico', 'estatal', 'sem fins lucrativos', 'empresa privada' ou 'outro' pelo código de natureza jurídica da Receita (e a descrição, quando há)."""
    codigo, descricao = (codigo or "").strip(), (descricao or "").lower()
    if codigo in ("2011", "2038") or "economia mista" in descricao or "empresa pública" in descricao:
        return "estatal"
    if codigo.startswith("1"):
        return "publico"
    if codigo.startswith("3"):
        return "sem fins lucrativos"
    if codigo.startswith("2"):
        return "empresa privada"
    return "outro"


VALOR_RELEVANTE_SIGEFES = 100_000.0       # pago nos dois últimos exercícios, em elementos de contratação
MESES_RECORRENTE = 3                      # meses distintos com pagamento ao mesmo fornecedor pela mesma unidade gestora


def fornecedores_relevantes(linhas, cnpjs_siga, elementos=None, minimo_valor=VALOR_RELEVANTE_SIGEFES, minimo_meses=MESES_RECORRENTE):
    """CNPJs pagos pelo SIGEFES em elementos rastreáveis que não aparecem em nenhum documento do SIGA e têm pagamento relevante: ao menos
    `minimo_valor` e, ou pagamentos em `minimo_meses` meses distintos, ou algum pagamento que cita código de contrato do SIGEFES, ou algum repasse ou
    pagamento eventual (esses não precisam ser recorrentes: um repasse único alto já é motivo de olhar).

    linhas: [cnpj, ug, elemento, contrato, licitação, 'AAAA-MM', empenhado, liquidado, pago] (despesas.py). Serve para ampliar a Receita, as bases
    externas (PGFN, CEIS, TSE) e o Diário Oficial a quem o SIGA não conhece."""
    elementos = ELEMENTOS_RASTREAVEIS if elementos is None else elementos
    pago, meses, motivo = {}, {}, set()
    for cnpj, _ug, el, ct, _lic, mes, _e, _l, p in linhas:
        if el not in elementos or p <= 0 or cnpj in cnpjs_siga:
            continue
        pago[cnpj] = pago.get(cnpj, 0.0) + p
        meses.setdefault(cnpj, set()).add(mes)
        if (ct or "").strip().strip("0") or classe_do_elemento(el) != "contratacao":
            motivo.add(cnpj)
    return {c for c, v in pago.items() if v >= minimo_valor and (len(meses[c]) >= minimo_meses or c in motivo)}


def contratos_do_sigefes(linhas, nomes, subs, meta, ug_org, pares_com_doc, anos, elementos=None, minimo_valor=VALOR_RELEVANTE_SIGEFES, minimo_meses=MESES_RECORRENTE, classe_cnpj=None):
    """Agrupa os pagamentos do SIGEFES a fornecedores que não têm documento algum do SIGA no órgão pagador, por órgão, fornecedor, unidade gestora,
    código de contrato do SIGEFES e natureza do pagamento.

    Tipos (todos com ao menos `minimo_valor` pago): 'contrato' (despesa de contratação que cita código de contrato do SIGEFES); 'recorrente' (contratação sem código, mas paga em
    `minimo_meses` meses distintos: despesa continuada, passível de revisão contratual embora sem instrumento no SIGA);
    'repasse' (contribuição, auxílio, subvenção ou contrato de gestão, com ao menos `minimo_valor`); 'outro' (sentença, exercício anterior, indenização
    ou imóvel, com ao menos `minimo_valor`).
    nomes: nomes dos fornecedores e dos elementos ('EL<código>'); subs: {'ug|cnpj|contrato': {'subelemento|subfunção': pago}}; meta: {'ug|cnpj|contrato':
    [licitação, processo, embasamento, ação]}; ug_org: unidade gestora -> órgão do SIGA; pares_com_doc: {(órgão, cnpj)} que têm documento no SIGA;
    anos: anos de interesse (texto); classe_cnpj: {cnpj: natureza} de classe_juridica (favorecidos de classes_fora_da_lista não entram; sem a informação, entram).
    Devolve {órgão: [grupo]} com os de maior pago primeiro."""
    elementos = ELEMENTOS_RASTREAVEIS if elementos is None else elementos
    classe_cnpj = classe_cnpj or {}
    grupos = {}
    for cnpj, ug, el, ct, lic, mes, _emp, _liq, pago in linhas:
        ct = (ct or "").strip()
        if not ct.strip("0"):
            ct = ""
        org = ug_org.get(ug)
        classe = classe_do_elemento(el)
        if org is None or el not in elementos or classe is None or (org, cnpj) in pares_com_doc or mes[:4] not in anos or pago <= 0:
            continue
        if classe_cnpj.get(cnpj) in CLASSES_FORA_DA_LISTA:
            continue
        g = grupos.setdefault((org, cnpj, ct, ug, classe), {"cnpj": cnpj, "forn": nomes.get(cnpj, cnpj), "codigo": ct, "classe": classe, "licitacao": lic or "", "ug": ug,
                                                            "pago": {a: 0.0 for a in anos}, "meses": set(), "desde": mes, "ate": mes, "elementos": {}})
        g["pago"][mes[:4]] += pago
        g["meses"].add(mes)
        g["elementos"][el] = g["elementos"].get(el, 0.0) + pago
        g["desde"], g["ate"] = min(g["desde"], mes), max(g["ate"], mes)
    saida = {}
    for (org, cnpj, ct, ug, classe), g in grupos.items():
        total = sum(g["pago"].values())
        if classe == "contratacao":
            g["tipo"] = "contrato" if ct else "recorrente"
            if total < minimo_valor or (not ct and len(g["meses"]) < minimo_meses):
                continue
        else:
            g["tipo"] = classe
            if total < minimo_valor:
                continue
        chave = f"{ug}|{cnpj}|{ct}"
        sub = max((subs or {}).get(chave, {}).items(), key=lambda kv: kv[1], default=("|", 0.0))[0]
        objeto, _, subfuncao = sub.partition("|")
        licit, processo, embasamento, acao = (list((meta or {}).get(chave, [])) + ["", "", "", ""])[:4]
        el_principal = max(g["elementos"].items(), key=lambda kv: kv[1])[0]
        g.update(objeto=objeto.strip(), subfuncao=subfuncao.strip(), numeroLicitacao=licit, processo=processo, embasamento=embasamento, acao=acao,
                 elemento=el_principal, elementoNome=(nomes or {}).get("EL" + el_principal, ""), total=round(total, 2), meses=len(g["meses"]), mesesLista=sorted(g["meses"]))
        del g["elementos"]
        g["pago"] = {a: round(v, 2) for a, v in g["pago"].items()}
        saida.setdefault(org, []).append(g)
    for lista in saida.values():
        lista.sort(key=lambda g: -g["total"])
    return saida


# --- qualificação: o pagamento do SIGEFES indica uma relação contratual passível de revisão? ----------------------------------------------------------------------
PROCEDIMENTOS = ("CONCORR", "PREGÃO", "PREGAO", "RDC", "REGIME DIFERENCIADO", "TOMADA", "CONVITE", "LEIL", "DIÁLOGO", "DIALOGO", "CONCURSO", "ADESÃO", "ADESAO")
DIRETAS_SIGEFES = ("DISPENSA", "INEXIGIBILIDADE")
TIPOS_ATO_CONTRATUAL = ("Extrato de contrato", "Aditivo ou prorrogação", "Apostilamento", "Reajuste ou repactuação", "Parceria")


def _indice_mes(m):
    return int(m[:4]) * 12 + int(m[5:7])


def periodicidade(meses):
    """Rótulo da cadência de pagamento a partir dos meses ('AAAA-MM') com pagamento: 'pagamento único', 'poucas parcelas', 'mensal contínuo',
    'frequente' ou 'esporádico'. Pagamento contínuo ao longo de meses é o que a execução de um contrato costuma deixar; um pagamento isolado, não."""
    ms = sorted(set(meses))
    if not ms:
        return "sem pagamento"
    if len(ms) == 1:
        return "pagamento único"
    vao = _indice_mes(ms[-1]) - _indice_mes(ms[0]) + 1
    cobertura = len(ms) / vao
    if len(ms) <= 3 and vao <= 6:
        return "poucas parcelas"
    if len(ms) >= 6 and cobertura >= 0.8:
        return "mensal contínuo"
    if len(ms) >= 4 and cobertura >= 0.5:
        return "frequente"
    return "esporádico"


def qualificar_relacao(g, atos=(), pncp_contratos=0, edocs=None):
    """Indícios, a favor e contra, de que os pagamentos do SIGEFES de um grupo (AM.contratos_do_sigefes) decorrem de relação contratual passível de revisão.

    Não prova nada: ajuda a separar contratação continuada (código de contrato, licitação, pagamento mensal, ato no Diário, contrato no PNCP, processo no
    e-Docs) de pagamento isolado, indenização ou imóvel. atos: atos do Diário que citam o CNPJ ([{'t': tipo, ...}]); pncp_contratos: quantos contratos
    do mesmo CNPJ constam do PNCP; edocs: resumo do processo no e-Docs ({'assunto', 'resumo'}) quando há.
    Devolve {'nivel': 'forte'|'média'|'fraca', 'pontos', 'periodicidade', 'motivos': [...], 'duvidas': [...]}."""
    pontos, motivos, duvidas = 0, [], []
    per = periodicidade(g.get("mesesLista") or [])
    if g.get("codigo"):
        pontos += 2
        motivos.append(f"cita o código de contrato {g['codigo']} no SIGEFES")
    lic = (g.get("licitacao") or "").upper()
    num = g.get("numeroLicitacao") or ""
    if any(x in lic for x in PROCEDIMENTOS):
        pontos += 2
        motivos.append(f"licitação: {g['licitacao'].title()}" + (f" nº {num}" if num else ""))
    elif any(x in lic for x in DIRETAS_SIGEFES):
        pontos += 1
        motivos.append(f"contratação direta: {g['licitacao'].title()}")
    else:
        duvidas.append("não informa licitação nem contratação direta")
    if per == "mensal contínuo":
        pontos += 2
        motivos.append(f"pagamento mensal contínuo ({g['meses']} meses, de {g['desde']} a {g['ate']})")
    elif per == "frequente":
        pontos += 1
        motivos.append(f"pagamentos frequentes ({g['meses']} meses, de {g['desde']} a {g['ate']})")
    elif per == "pagamento único":
        pontos -= 1
        duvidas.append("pagamento em um único mês")
    elif per == "esporádico":
        duvidas.append(f"pagamentos esporádicos ({g['meses']} meses entre {g['desde']} e {g['ate']})")
    contratuais = [a for a in atos if a.get("t") in TIPOS_ATO_CONTRATUAL]
    if contratuais:
        pontos += 2
        motivos.append(f"{len(contratuais)} ato(s) no Diário Oficial que citam o CNPJ (extrato, termo, aditivo ou parceria)")
    else:
        duvidas.append("nenhum extrato, termo ou aditivo localizado no Diário Oficial pelo CNPJ (leitura desde nov/2023)")
    for i in (g.get("instrumento") or [])[:1]:
        pontos += 3
        motivos.append("contrato publicado pelo órgão em seu site: " + " ou ".join(f"nº {x['numero']} (lote {x['lote']})" for x in g["instrumento"]))
        if len(g["instrumento"]) > 1:
            duvidas.append("a empresa consta de mais de um lote; o código do SIGEFES não diz qual")
    if pncp_contratos:
        pontos += 1
        motivos.append(f"o CNPJ tem {pncp_contratos} contrato(s) no PNCP")
    if g.get("processo"):
        pontos += 1
        motivos.append(f"processo {g['processo']}")
    if edocs and not edocs.get("naoEncontrado"):
        texto = f"{edocs.get('assunto', '')} {edocs.get('resumo', '')}".upper()
        if any(x in texto for x in ("CONTRAT", "TERMO", "CONV", "ATA DE REGISTRO", "ADITIV", "GESTÃO", "FOMENTO", "COLABORA")):
            pontos += 1
            motivos.append("a descrição do processo no e-Docs cita contrato, termo ou convênio")
    if g.get("tipo") == "outro":
        pontos -= 2
        duvidas.append("pagamento eventual (sentença, exercício anterior, indenização ou imóvel): em regra não há contrato a rever")
    if g.get("tipo") == "repasse":
        duvidas.append("repasse a entidade: o instrumento é convênio, termo de fomento ou colaboração, subvenção ou contrato de gestão, e não contrato de fornecimento")
    nivel = "forte" if pontos >= 5 else "média" if pontos >= 3 else "fraca"
    return {"nivel": nivel, "pontos": pontos, "periodicidade": per, "motivos": motivos, "duvidas": duvidas}


def pagamentos_a_entes_publicos(linhas, nomes, ug_org, pares_com_doc, anos, classe_cnpj, maiores=5):
    """Resumo, por órgão pagador, do que o SIGEFES pagou a entes públicos e estatais sem documento do SIGA: transferências a outros órgãos, municípios e
    fundações públicas, tributos e encargos, dívida, sentenças e indenizações. Não são contratos; o resumo existe para mostrar para onde vai o dinheiro.

    Devolve {órgão: {'total', 'cnpjs', 'porGrupo': {grupo: pago}, 'porClasse': {classe: pago}, 'maiores': [{'cnpj', 'nome', 'classe', 'pago'}]}}."""
    por = {}
    for cnpj, ug, el, ct, lic, mes, _e, _l, pago in linhas:
        org = ug_org.get(ug)
        classe = classe_cnpj.get(cnpj)
        if org is None or classe not in CLASSES_FORA_DA_LISTA or (org, cnpj) in pares_com_doc or mes[:4] not in anos or pago <= 0:
            continue
        x = por.setdefault(org, {"total": 0.0, "porGrupo": {}, "porClasse": {}, "cnpj": {}})
        grupo = GRUPO_DO_ELEMENTO.get(el, "compras e serviços")
        x["total"] += pago
        x["porGrupo"][grupo] = x["porGrupo"].get(grupo, 0.0) + pago
        x["porClasse"][classe] = x["porClasse"].get(classe, 0.0) + pago
        x["cnpj"][cnpj] = x["cnpj"].get(cnpj, 0.0) + pago
    saida = {}
    for org, x in por.items():
        top = sorted(x["cnpj"].items(), key=lambda kv: -kv[1])[:maiores]
        saida[org] = {"total": round(x["total"], 2), "cnpjs": len(x["cnpj"]), "porGrupo": {k: round(v, 2) for k, v in sorted(x["porGrupo"].items(), key=lambda kv: -kv[1])},
                      "porClasse": {k: round(v, 2) for k, v in x["porClasse"].items()},
                      "maiores": [{"cnpj": c, "nome": nomes.get(c, c), "classe": classe_cnpj[c], "pago": round(v, 2)} for c, v in top]}
    return saida


def cnpjs_relevantes_do_cache(cnpjs_siga, pasta, anos=None):
    """fornecedores_relevantes lendo os despesas_AAAA.json de `pasta` (todos, ou só os `anos` pedidos, em texto). Conjunto vazio se não há arquivo."""
    import glob
    import json
    import os
    linhas = []
    for f in sorted(glob.glob(os.path.join(pasta, "despesas_20??.json"))):
        try:
            d = json.load(open(f))
        except (OSError, ValueError):
            continue
        if anos is None or str(d.get("ano")) in anos:
            linhas += d["linhas"]
    return fornecedores_relevantes(linhas, cnpjs_siga) if linhas else set()


def instrumentos_publicados(g, contratos):
    """Contratos publicados pelo próprio órgão (secom.py) que correspondem a um pagamento do SIGEFES sem documento no SIGA.

    A ligação é pela licitação (número e ano) e pelo CNPJ-raiz de uma das agências ou empresas contratadas; o código de contrato do SIGEFES não é o número do
    instrumento, então, quando a mesma empresa está em mais de um contrato (como uma agência com dois lotes), todos os candidatos são devolvidos."""
    lic = (g.get("numeroLicitacao") or "").strip()
    raiz = (g.get("cnpj") or "")[:8]
    saida = []
    for c in contratos or []:
        if lic and c.get("licitacao") == lic and any(raiz in p.get("raizes", []) for p in c.get("partes", [])):
            saida.append({"numero": c["numero"], "lote": c["lote"], "valorAnual": c["valorAnual"], "inicio": c["inicio"], "vigenciaPublicadaAte": c["vigenciaPublicadaAte"],
                          "limiteLegalAte": c["limiteLegalAte"], "aditivos": len(c.get("aditivos", [])), "url": c["url"]})
    return saida
