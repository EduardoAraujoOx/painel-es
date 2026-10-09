"""Regras de classificação e de valor dos cargos em comissão e funções gratificadas.

Fonte: Portal de Dados Abertos do ES, conjunto "[Portal da Transparência] Pessoal"
(SEGER). A folha é publicada com UMA LINHA POR RUBRICA, e não por servidor; o valor
de um cargo precisa, portanto, ser reconstruído a partir das rubricas que o remuneram.

Todas as regras ficam aqui, num único lugar, para que possam ser auditadas e alteradas
sem tocar no restante do pipeline.
"""

# Órgãos fora do escopo (Poder Executivo). Constam da base apenas por um período; mantê-los
# criaria "saídas" fictícias quando deixam de aparecer no arquivo.
ORGAOS_EXCLUIDOS = {
    "JUIZADO DE DIREITO": "Poder Judiciário; presente na base só de out/2024 a set/2025",
    "CGJES": "Corregedoria Geral da Justiça (Poder Judiciário); presente só de out/2024 a set/2025",
}

TIPO_CC = "CARGO COMISSIONADO"
TIPO_FG = "FUNCAO GRATIFICADA"
TIPOS_ALVO = {TIPO_CC: "CC", TIPO_FG: "FG"}

# Rubricas que compõem o valor de um CARGO COMISSIONADO.
R_VENC_PURO = "VENC CARGO COMISSIONADO"        # ocupante sem vínculo efetivo (livre nomeação)
R_VENC_EFET = "VENC CARGO COMISS EFET"         # servidor efetivo que ocupa o cargo e recebe o vencimento dele
R_OPCAO = "OPCAO CARGO COMISSIONADO"           # servidor efetivo que MANTÉM a remuneração do cargo de origem e opta por parte do cargo em comissão
R_SUBSIDIO = "SUBSIDIO"                        # secretários, subsecretários e similares
R_PRODUTIVIDADE = "GRATIF PRODUTIVIDADE C.COMISS"
R_GRAT_ESP = "GRAT ESP AAS COMISSIONADO"      # gratificação especial de comissionado (hoje, só SESA)
COMPLEMENTOS_CC = (R_PRODUTIVIDADE, R_GRAT_ESP)

# Provimento (derivado das rubricas; rótulo exibido no painel)
PROV_PURO = "Comissionado sem vínculo efetivo"
PROV_EFET = "Servidor com vínculo de origem (vencimento do cargo)"
PROV_OPCAO = "Servidor com vínculo de origem (opção pelo cargo)"
PROV_SUBSIDIO = "Subsídio"
PROV_CARREIRA = "Servidor com vínculo de origem (subsídio da carreira)"
PROV_SEM_PAG = "Sem pagamento no mês"
PROV_FG = "Função gratificada"


def para_float(texto):
    """Converte '1.234,56' (ou '1234.56') em float. Vazio vale zero."""
    if not texto:
        return 0.0
    texto = texto.strip()
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    return float(texto)


def valor_e_provimento(tipo, rubricas, cargo_efetivo="", subsidio_padrao=None):
    """Devolve (valor_do_cargo, provimento, ocupante, subsidio_da_carreira).

    `rubricas` é um dict {nome_da_rubrica: valor_liquido_de_ajustes}, em que vantagens
    entram com sinal positivo e descontos com sinal negativo, apenas da competência
    corrente (ajustes retroativos de outros meses ficam de fora).

    Princípio: valor do cargo é o que se paga POR CAUSA do cargo. A remuneração que o
    servidor de carreira receberia de qualquer modo não é custo do cargo.

      * OPÇÃO pelo cargo comissionado: o servidor mantém a remuneração do cargo de origem
        (SUBSIDIO ou vencimento). Entra só a rubrica de opção e as gratificações; contar
        a remuneração de origem faria um Auditor Fiscal em chefia parecer custar R$ 40 mil
        só pela função.
      * SUBSÍDIO: só é valor do cargo quando é o subsídio da própria função. É o caso de
        quem não tem cargo efetivo (cargo_efetivo vazio) ou de quem recebe exatamente o
        subsídio padrão da função (`subsidio_padrao`, a moda entre os ocupantes sem cargo
        efetivo). Servidor de carreira com subsídio diferente do padrão recebe a remuneração
        da carreira: o valor do cargo fica só com as gratificações, e o subsídio é devolvido
        em `subsidio_da_carreira` para exibição.
      * FUNÇÃO GRATIFICADA: só entram as rubricas "FUNCAO GRAT...". Em muitas dessas linhas o
        SUBSIDIO é o vencimento-base (militares, por exemplo).

    `ocupante` é False quando não há nenhuma rubrica de cargo na competência (por exemplo,
    só "insuficiência de saldo", resíduo de acerto de quem foi desligado ou afastado).
    """
    if tipo == TIPO_FG:
        valor = sum(v for r, v in rubricas.items() if r.startswith("FUNCAO GRAT"))
        return round(valor, 2), PROV_FG, valor != 0, 0.0

    complementos = sum(rubricas.get(r, 0.0) for r in COMPLEMENTOS_CC)
    opcao = rubricas.get(R_OPCAO, 0.0)
    puro = rubricas.get(R_VENC_PURO, 0.0)
    efet = rubricas.get(R_VENC_EFET, 0.0)
    subs = rubricas.get(R_SUBSIDIO, 0.0)

    if opcao != 0:
        return round(opcao + complementos, 2), PROV_OPCAO, True, 0.0
    if puro != 0:
        return round(puro + complementos, 2), PROV_PURO, True, 0.0
    if efet != 0:
        return round(efet + complementos, 2), PROV_EFET, True, 0.0
    if subs != 0:
        e_do_cargo = (not cargo_efetivo.strip()) or (
            subsidio_padrao is not None and abs(subs - subsidio_padrao) < 0.01)
        if e_do_cargo:
            return round(subs + complementos, 2), PROV_SUBSIDIO, True, 0.0
        return round(complementos, 2), PROV_CARREIRA, True, round(subs, 2)
    return round(complementos, 2), PROV_SEM_PAG, complementos != 0, 0.0
