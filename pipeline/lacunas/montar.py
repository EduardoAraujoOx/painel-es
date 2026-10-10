#!/usr/bin/env python3
"""Catálogo de lacunas de informação: o que a análise do painel não consegue medir por falta de dado público
ou por dado incompleto, com a evidência calculada a partir dos próprios dados do painel, a decisão que a
informação habilitaria, o que solicitar e a quem.

Saída: data/lacunas/index.json.   Uso: python3 -I pipeline/lacunas/montar.py
Roda depois de pipeline/contratos/montar.py e de pipeline/organograma/montar.py (usa os dados deles).

Critério de prioridade (transparente, ajustável abaixo):
  alta   — afeta contratos da classe A (80% do valor) em R$ 500 milhões por ano ou mais, ou é questão de integridade;
  média  — afeta de R$ 50 milhões a R$ 500 milhões por ano, ou é informação transversal que melhora várias análises;
  baixa  — afeta menos que isso.
"""
import csv
import datetime
import glob
import json
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESTINO = os.path.join(RAIZ, "data", "lacunas")
CACHE = os.path.join(RAIZ, ".cache", "contratos")


def carregar():
    d = json.load(open(os.path.join(RAIZ, "data", "contratacoes", "diagnostico.json")))
    linhas = [dict(zip(d["campos"], r)) for r in d["contratos"]]
    idx = json.load(open(os.path.join(RAIZ, "data", "contratacoes", "index.json")))
    org = json.load(open(os.path.join(RAIZ, "data", "organograma", "index.json")))
    return linhas, idx, org


def classe_a(linhas):
    total = sum(x["anual"] for x in linhas) or 1.0
    acum, saida = 0.0, []
    for x in sorted(linhas, key=lambda x: -x["anual"]):
        saida.append(x)
        acum += x["anual"]
        if acum >= 0.8 * total:
            break
    return saida


def mi(v):
    return f"R$ {v / 1e6:,.0f} milhões".replace(",", ".")


def bi(v):
    return f"R$ {v / 1e9:,.2f} bilhões".replace(",", "X").replace(".", ",").replace("X", ".")


def com_alerta(l, cod):
    return [x for x in l if any(a.split(":")[0] == cod for a in x["alertas"])]


def soma(l):
    return sum(x["anual"] for x in l)


def cobertura_aditivos():
    """Parcela dos termos aditivos sem valor registrado nos dados abertos (alterações contratuais)."""
    tot = com = 0
    for f in glob.glob(os.path.join(CACHE, "a20[12]?.csv")):
        for r in csv.DictReader(open(f, encoding="utf-8-sig", newline=""), delimiter=";"):
            tot += 1
            com += bool((r.get("ValorAlteracao") or "").strip())
    return tot, com


def main():
    linhas, idx, orgidx = carregar()
    A = classe_a(linhas)
    ref = datetime.date.fromisoformat(idx["ref"])
    sem_pago = [x for x in A if x["pago"] <= 0]
    der = lambda l: [x for x in l if "Edifica" in x["orgNome"]]
    obras_a = [x for x in A if x["cat"] == "Obras e engenharia"]
    fora = com_alerta(linhas, "fora_siga")
    adit = com_alerta(linhas, "aditivo_valor")
    diretas = com_alerta(linhas, "direta_valor")
    rp = [x for x in linhas if x["rp"]]
    recentes = [x for x in linhas if x["cel"] and x["cel"] >= (ref - datetime.timedelta(days=90)).isoformat()]
    socserv = com_alerta(linhas, "socio_servidor")
    sanc = com_alerta(linhas, "sancao_vigente")
    divida = com_alerta(linhas, "divida_ativa")
    ta, tc = cobertura_aditivos()
    forn = json.load(open(os.path.join(RAIZ, "data", "contratacoes", "fornecedores.json")))
    C = forn["campos"]
    estatais = [dict(zip(C, r)) for r in forn["fornecedores"] if re.search(r"economia mista|empresa p[uú]blica", r[C.index("natureza")] or "", re.I)]
    orgs_sem = {o["sigla"]: o for o in orgidx["orgs"]}
    iases, sesp = orgs_sem.get("IASES"), orgs_sem.get("SESP")
    DER = "Departamento de Edificações e de Rodovias (DER-ES)"

    itens = [
        dict(id="execucao-contrato", area="Execução financeira", verificado=True,
             titulo="Execução financeira ligada a cada contrato (empenho, liquidação e pagamento)",
             lacuna="Os dados abertos não ligam todos os pagamentos ao contrato que os originou. O SIGEFES usa um código de contrato próprio, sem correspondência publicada com o número do instrumento no SIGA, e vários órgãos quase não registram empenhos no SIGA.",
             evidencia=f"{len(sem_pago)} dos {len(A)} contratos da classe A ({mi(soma(sem_pago))} por ano) não têm pagamento ligado ao contrato; no DER, {len(der(sem_pago))} de {len(der(A))}. Os empenhos do SIGA cobrem menos de 1% do compromisso anual do DER.",
             decisao="Saber quanto de cada contrato já foi executado, quanto resta e se há execução acima ou abaixo do contratado, para decidir sobre prorrogar, renegociar, reduzir ou encerrar.",
             solicitar="Tabela de correspondência entre o código de contrato do SIGEFES e o número do instrumento no SIGA e, para cada contrato vigente, o empenhado, o liquidado, o pago e os restos a pagar por exercício desde a assinatura.",
             destinatarios=["SEFAZ (SIGEFES)", "SEGER (SIGA)"], valorAfetado=soma(sem_pago), fonteEvidencia="SIGA e SIGEFES (Portal da Transparência), cruzamento do painel"),
        dict(id="obras-medicoes", area="Obras", verificado=True,
             titulo="Avanço físico, medições e cronograma das obras",
             lacuna="Não há dado público atual sobre o andamento das obras. O conjunto de obras do Portal da Transparência (Geoobras) tem 223 obras em 2021, 178 em 2022, 20 em 2023 e praticamente nenhuma em 2024.",
             evidencia=f"{len(obras_a)} contratos de obras e engenharia estão na classe A ({mi(soma(obras_a))} por ano); {len(der(obras_a))} são do DER ({mi(soma(der(obras_a)))}). Para eles só se vê o valor contratado e o pago, não o avanço físico.",
             decisao="Comparar o que foi pago com o que foi efetivamente construído, identificar obras atrasadas, paralisadas ou com pagamento adiantado e decidir quais continuar, reprogramar ou rescindir.",
             solicitar="Relação de obras em curso por contrato, com situação, percentual físico e financeiro executado, boletins de medição, cronograma físico-financeiro, ordens de serviço, aditivos e data prevista de conclusão.",
             destinatarios=[DER, "SEDU", "SEMOBI"], valorAfetado=soma(obras_a), fonteEvidencia="SIGA, Geoobras (Portal da Transparência)"),
        dict(id="fora-siga", area="Contratos", verificado=True,
             titulo="Contratações conduzidas fora do SIGA",
             lacuna="O processo de contratação não foi realizado no SIGA e, por isso, os dados abertos mostram o contrato mas não o processo que o originou.",
             evidencia=f"{len(fora)} contratos vigentes ({mi(soma(fora))} por ano) têm o processo fora do SIGA; {len(com_alerta(A, 'fora_siga'))} deles estão na classe A ({mi(soma(com_alerta(A, 'fora_siga')))} por ano).",
             decisao="Verificar a regularidade das contratações de maior valor cujo processo não pode ser conferido nos dados abertos.",
             solicitar="Relação dos processos conduzidos fora do SIGA, com o sistema de origem, o número do processo, a justificativa e acesso aos autos dos contratos da classe A.",
             destinatarios=["SEGER (SIGA)", "Órgãos contratantes"], valorAfetado=soma(com_alerta(A, "fora_siga")), fonteEvidencia="SIGA (campo \"processo realizado no SIGA\")"),
        dict(id="aditivos", area="Contratos", verificado=True,
             titulo="Termos aditivos: valor, justificativa e parecer",
             lacuna=f"Os dados abertos listam as alterações contratuais, mas {100 * (1 - tc / ta):.0f}% delas não trazem valor, e não há justificativa nem parecer.",
             evidencia=f"{len(adit)} contratos vigentes têm valor final acima do inicial em 25% ou mais ({mi(soma(adit))} por ano); {len(com_alerta(A, 'aditivo_valor'))} estão na classe A ({mi(soma(com_alerta(A, 'aditivo_valor')))}).",
             decisao="Avaliar se os acréscimos respeitam os limites legais e se foram justificados, e decidir sobre renegociação ou limitação de novos aditivos.",
             solicitar="Lista completa de termos aditivos dos contratos da classe A, com tipo, data, valor, justificativa técnica e econômica e parecer jurídico.",
             destinatarios=["Órgãos contratantes", "PGE"], valorAfetado=soma(com_alerta(A, "aditivo_valor")), fonteEvidencia="SIGA (contratos e alterações contratuais)"),
        dict(id="contratacao-direta", area="Contratos", verificado=True,
             titulo="Justificativas de dispensa e inexigibilidade de valor elevado",
             lacuna="Os dados abertos mostram a modalidade, mas não a justificativa, a pesquisa de preços nem o parecer jurídico da contratação direta.",
             evidencia=f"{len(diretas)} contratos vigentes por dispensa ou inexigibilidade de R$ 500 mil ou mais ({mi(soma(diretas))} por ano); {len(com_alerta(A, 'direta_valor'))} estão na classe A ({mi(soma(com_alerta(A, 'direta_valor')))}).",
             decisao="Decidir se mantém, relicita ou rescinde contratos grandes celebrados sem competição.",
             solicitar="Processos de contratação direta de maior valor, com justificativa, pesquisa de preços, razão da escolha do fornecedor e parecer jurídico.",
             destinatarios=["Órgãos contratantes", "PGE"], valorAfetado=soma(com_alerta(A, "direta_valor")), fonteEvidencia="SIGA"),
        dict(id="registro-precos", area="Contratos", verificado=True,
             titulo="Atas de registro de preços: saldo, quantidades e adesões",
             lacuna="Nos registros de preços, o valor publicado é o máximo estimado. Os dados abertos não informam o que foi realmente consumido, o saldo por item nem as adesões de outros órgãos.",
             evidencia=f"{len(rp)} contratos vigentes são de registro de preços ({mi(soma(rp))} por ano de valor máximo); {len([x for x in A if x['rp']])} estão na classe A ({mi(soma([x for x in A if x['rp']]))}).",
             decisao="Medir o compromisso real, evitar nova aquisição onde há saldo e decidir sobre a renovação das atas.",
             solicitar="Por ata: itens, quantidades registradas e consumidas, saldo, preços, adesões de outros órgãos e entes e vigência.",
             destinatarios=["SEGER (SIGA)", "Órgãos gerenciadores"], valorAfetado=soma([x for x in A if x["rp"]]), fonteEvidencia="SIGA"),
        dict(id="processos-andamento", area="Contratos", verificado=True,
             titulo="Contratações em andamento e planejadas (licitações e plano de contratações)",
             lacuna="Não há conjunto de licitações nos dados abertos do Estado, e a análise só enxerga contratos já assinados.",
             evidencia=f"Nos últimos 90 dias foram celebrados {len(recentes)} contratos vigentes ({mi(soma(recentes))} por ano), o que indica movimento relevante às vésperas da transição.",
             decisao="Conhecer o que está para ser assinado e decidir sobre suspender, rever ou concluir processos antes que gerem compromissos para o novo governo.",
             solicitar="Relação dos processos de contratação em andamento (fase, objeto, valor estimado, data prevista de assinatura) e o plano de contratações anual; informar assinaturas previstas até o fim do exercício.",
             destinatarios=["SEGER (SIGA)", "Órgãos contratantes"], valorAfetado=soma(recentes), prioridadeFixa="alta", fonteEvidencia="SIGA; busca por conjuntos de licitação no portal de dados abertos"),
        dict(id="precos-referencia", area="Contratos", verificado=True,
             titulo="Dados por item e pesquisas de preços das compras",
             lacuna="Os dados abertos descrevem o objeto em texto livre, sem código de item, quantidade e preço unitário. Por isso o painel não consegue comparar preços entre contratações.",
             evidencia="A comparação de preços do mesmo objeto entre órgãos ainda não foi feita por essa limitação.",
             decisao="Identificar contratações com preço acima da referência e orientar renegociações e novas licitações.",
             solicitar="Itens das compras e contratações dos últimos três anos, com código de catálogo, quantidade, unidade e preço unitário, e a pesquisa de preços de cada licitação.",
             destinatarios=["SEGER (SIGA)"], valorAfetado=0.0, prioridadeFixa="média", fonteEvidencia="Dicionário de dados do SIGA"),
        dict(id="fiscais-contratos", area="Contratos", verificado=True,
             titulo="Gestores e fiscais de contratos e relatórios de fiscalização",
             lacuna="Os dados abertos não identificam o gestor nem o fiscal de cada contrato nem os relatórios de fiscalização.",
             evidencia=f"Os {len(A)} contratos da classe A ({bi(soma(A))} por ano) não têm responsável identificado nos dados públicos.",
             decisao="Saber quem responde pela execução e qual a qualidade da fiscalização dos contratos mais relevantes.",
             solicitar="Nome, cargo e ato de designação do gestor e do fiscal de cada contrato da classe A e os relatórios de fiscalização do último ano.",
             destinatarios=["Órgãos contratantes"], valorAfetado=0.0, prioridadeFixa="média", fonteEvidencia="Dicionário de dados do SIGA"),
        dict(id="garantias", area="Contratos", verificado=True,
             titulo="Garantias contratuais",
             lacuna="Não há dado público sobre garantias (seguro-garantia, caução, fiança) dos contratos.",
             evidencia=f"{len(obras_a)} contratos de obras na classe A ({mi(soma(obras_a))} por ano) não permitem ver se há garantia vigente.",
             decisao="Verificar a proteção do Estado em obras e contratos de maior risco.",
             solicitar="Tipo, valor, seguradora ou instituição e vigência da garantia de cada contrato de obras e de serviços continuados da classe A.",
             destinatarios=["Órgãos contratantes"], valorAfetado=0.0, prioridadeFixa="baixa", fonteEvidencia="Dicionário de dados do SIGA"),
        dict(id="cruzamento-cpf", area="Integridade", verificado=True,
             titulo="Cruzamento por CPF entre servidores e sócios de fornecedores",
             lacuna="A folha aberta não traz CPF e o cadastro da Receita mascara o dos sócios. Só é possível comparar nomes, o que mistura homônimos com os casos reais.",
             evidencia=f"{len(socserv)} contratos vigentes ({mi(soma(socserv))} por ano) têm fornecedor com sócio de nome igual ao de servidor ativo; sem CPF não se separa homonímia de conflito de interesses.",
             decisao="Identificar conflito de interesses e vedações de contratar com a administração.",
             solicitar="Cruzamento por CPF entre a folha de pessoal e o quadro societário dos fornecedores, feito pela Controladoria com acesso à base cadastral, e a relação dos casos confirmados.",
             destinatarios=["CGE", "SEGER (pessoal)"], valorAfetado=soma(socserv), prioridadeFixa="alta", fonteEvidencia="Folha (Portal da Transparência) e quadro societário (Receita Federal)"),
        dict(id="sancoes-estaduais", area="Integridade", verificado=False,
             titulo="Cadastro estadual de fornecedores sancionados",
             lacuna="O painel usa o CEIS e o CNEP, nacionais. Não encontrei publicado o cadastro de penalidades aplicadas por órgãos do Estado nem a confirmação de que todas foram enviadas ao CEIS.",
             evidencia=f"{len(sanc)} contratos vigentes ({mi(soma(sanc))} por ano) têm fornecedor com sanção em vigor no CEIS ou no CNEP; o alcance de cada uma sobre o Estado precisa ser conferido.",
             decisao="Impedir pagamentos e novos contratos com fornecedores impedidos e verificar o cumprimento da obrigação de registrar sanções.",
             solicitar="Cadastro estadual de penalidades (impedimentos, suspensões e inidoneidades) e a validação dos contratos vigentes cujos fornecedores constam no CEIS ou no CNEP.",
             destinatarios=["CGE", "PGE", "SEGER (SIGA)"], valorAfetado=soma(sanc), prioridadeFixa="média", fonteEvidencia="CEIS e CNEP (CGU)"),
        dict(id="regularidade-fiscal", area="Integridade", verificado=False,
             titulo="Regularidade fiscal estadual e trabalhista dos fornecedores",
             lacuna="Os dados públicos mostram a dívida ativa federal dos fornecedores, mas não a situação perante o Estado (ICMS) nem certidões vigentes na contratação e nos pagamentos.",
             evidencia=f"{len(divida)} contratos vigentes ({mi(soma(divida))} por ano) têm fornecedor com dívida ativa da União; {len(com_alerta(A, 'divida_ativa'))} estão na classe A ({mi(soma(com_alerta(A, 'divida_ativa')))}).",
             decisao="Verificar se contratos e pagamentos mantêm a exigência de regularidade fiscal.",
             solicitar="Situação de regularidade fiscal estadual e certidões dos fornecedores da classe A, em base agregada e respeitado o sigilo fiscal.",
             destinatarios=["SEFAZ"], valorAfetado=soma(com_alerta(A, "divida_ativa")), fonteEvidencia="PGFN (dados abertos)"),
        dict(id="estatais", area="Entes e empresas públicas", verificado=True,
             titulo="Empresas públicas e sociedades de economia mista: contratos, folha e dívida",
             lacuna="Essas empresas aparecem como fornecedoras ou favorecidas do Estado, mas os próprios contratos e a folha delas não estão nas bases do SIGA nem da folha aberta.",
             evidencia=f"{len(estatais)} entes dessa natureza receberam {mi(sum(x['pago'] for x in estatais))} em {'–'.join(map(str, idx['anosGasto']))}, sem que se veja o que contratam ou quanto pagam de pessoal.",
             decisao="Ter a visão completa do gasto do setor público estadual, inclusive das estatais, e dos riscos fiscais que elas representam.",
             solicitar="Relação de contratos vigentes, quadro de pessoal e remuneração (inclusive cargos de direção e conselhos) e endividamento das empresas públicas e sociedades de economia mista.",
             destinatarios=["SEFAZ", "Estatais"], valorAfetado=sum(x["pago"] for x in estatais) / 2, prioridadeFixa="média", fonteEvidencia="SIGEFES e Receita Federal (natureza jurídica)"),
        dict(id="lotacao", area="Pessoal", verificado=True,
             titulo="Lotação e estrutura organizacional do IASES e da SESP",
             lacuna="O código de lotação da base de vínculos não permite identificar a unidade em alguns órgãos, e o organograma oficial não os cobre por esse código.",
             evidencia=f"No IASES, {iases['semUnidade']} dos {iases['pessoas']} ocupantes de cargo ou função ficam sem unidade identificada; na SESP, {sesp['semUnidade']} dos {sesp['pessoas']}." if iases and sesp else "Há órgãos cujos servidores não podem ser ligados a uma unidade.",
             decisao="Distribuir corretamente cargos e custos por unidade e avaliar a estrutura de comissionados.",
             solicitar="Tabela de correspondência entre o código de setor da folha e a unidade do organograma oficial, com os decretos de estrutura vigentes.",
             destinatarios=["SEGER (pessoal)", "SESP", "IASES"], valorAfetado=0.0, prioridadeFixa="média", fonteEvidencia="Base de vínculos (Portal da Transparência) e Organograma ES"),
    ]
    for i in itens:
        v = i["valorAfetado"]
        auto = "alta" if v >= 500e6 else "média" if v >= 50e6 else "baixa"
        i["prioridade"] = i.pop("prioridadeFixa", auto)
        i["criterio"] = ("fixada por critério qualitativo (integridade, urgência da transição ou informação transversal)" if i["prioridade"] != auto or v == 0
                         else f"calculada: afeta {mi(v)} por ano em contratos da classe A")
        i["valorAfetado"] = round(v, 2)
    ordem = {"alta": 0, "média": 1, "baixa": 2}
    itens.sort(key=lambda i: (ordem[i["prioridade"]], -i["valorAfetado"]))
    os.makedirs(DESTINO, exist_ok=True)
    json.dump({"ref": idx["ref"], "classeA": {"contratos": len(A), "valor": round(soma(A), 2)}, "itens": itens,
               "criterioPrioridade": "Alta: afeta contratos da classe A em R$ 500 milhões por ano ou mais, ou é questão de integridade ou urgência da transição. Média: de R$ 50 milhões a R$ 500 milhões por ano, ou informação transversal. Baixa: menos que isso."},
              open(os.path.join(DESTINO, "index.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(itens)} itens → {DESTINO}/index.json")
    for i in itens:
        print(f"  [{i['prioridade']:5}] {i['titulo'][:62]:62} {i['evidencia'][:80]}")


if __name__ == "__main__":
    main()
