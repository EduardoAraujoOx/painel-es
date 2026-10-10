"""Regras do módulo de contratações: classificação do objeto e catálogo de alertas.

Os alertas são SINAIS DE TRIAGEM, não conclusões: indicam onde vale olhar primeiro. Cada um traz a
regra em linguagem simples, para que quem lê saiba o que está sendo apontado e por quê.
"""
import re
import unicodedata


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def norm_nome(s):
    return re.sub(r"\s+", " ", sem_acento(s).upper()).strip()


# --- instrumentos -----------------------------------------------------------------------------
INSTRUMENTOS_CONTRATUAIS = {"CONTRATO", "CARTA CONTRATO", "CARTA-CONTRATO", "TERMO DE ADESAO"}
SITUACOES_ENCERRADAS = {"RESCISAO CONTRATUAL", "INSTRUMENTO CONTRATUAL ANULADO", "ENCERRADO", "EXTINTO", "CANCELADO",
                        "INSTRUMENTO CONTRATUAL FINALIZADO"}


def tipo_instrumento(tipo_documento):
    return "contrato" if norm_nome(tipo_documento) in INSTRUMENTOS_CONTRATUAIS else "avulso"


def encerrado(situacao):
    return norm_nome(situacao) in SITUACOES_ENCERRADAS


# --- modalidade ---------------------------------------------------------------------------------
def modalidade(txt):
    n = norm_nome(txt)
    if not n:
        return "Não informada"
    for chave, rotulo in (("PREGAO", "Pregão"), ("DISPENSA", "Dispensa"), ("INEXIGIBILIDADE", "Inexigibilidade"),
                          ("CONCORRENCIA", "Concorrência"), ("TOMADA", "Tomada de preços"), ("CONVITE", "Convite"),
                          ("CREDENCIAMENTO", "Credenciamento"), ("CHAMAMENTO", "Chamamento público"),
                          ("COMPRA DIRETA", "Dispensa"), ("SHOPPING", "Dispensa"), ("DIALOGO", "Diálogo competitivo"),
                          ("CONCURSO", "Concurso"), ("LEILAO", "Leilão")):
        if chave in n:
            return rotulo
    return "Outra"


DIRETAS = {"Dispensa", "Inexigibilidade"}

# --- categoria do objeto (triagem por palavras-chave; a primeira regra que casar vale) ----------
CATEGORIAS = [
    ("Obras e engenharia", r"\b(obra|obras|construc|reforma|pavimenta|recapeamento|terraplen|drenagem|rodovia|ponte|"
                           r"edificac|engenharia|restaurac|duplicac|implantacao de|saneamento|projeto executivo|"
                           r"supervisao de obra|gerenciamento de obra|fiscalizacao de obra|contencao de encosta)"),
    ("Saúde", r"(medicament|hospitalar|cirurg|farmac|oxigenio|laborator|reagente|vacina|oncolog|enteral|material medico|"
              r"medico-hospitalar|dialise|ortese|protese|hemoder|\bsoro\b|seringa|luva|diagnostic|imunobiolog|"
              r"insumos? (de )?saude|clinic|exames?\b|filantrop|santa casa|leitos|hospital|ambulatorial|odontolog|"
              r"terapia|fisioterap|saude|servicos medicos|medicina)"),
    ("Alimentação", r"(aliment|refeic|merenda|generos|hortifruti|carne|\bpao\b|leite|agua mineral|cesta basica|"
                    r"quentinha|coffee|lanche)"),
    ("Transporte e logística", r"(transporte|passagen|passagem|frete|locomoc|agenciamento de viagem|translado|"
                               r"viagens|mudanca|carga e descarga)"),
    ("Máquinas e equipamentos pesados", r"(maquina|trator|escavadeira|retroescavadeira|motoniveladora|carregadeira|"
                                        r"aeronave|helicoptero|embarcacao|rolo compactador|ensiladeira|picadeira|"
                                        r"implemento agricola|colheitadeira|roçadeira|rocadeira)"),
    ("Tecnologia da informação", r"(software|licenc|informatic|computador|notebook|desktop|servidores? de|datacenter|"
                                r"data center|nuvem|cloud|internet|telecom|telefonia|sistema de informac|impressora|"
                                r"toner|rede de dados|ciberseg|tecnologia da informacao|\bti\b|sistemas? (web|integrado)|"
                                r"outsourcing|storage|switch|firewall|terminais? integrados|solucao de)"),
    ("Veículos e combustível", r"(veicul|combustiv|gasolina|diesel|etanol|pneu|automotiv|lubrific|onibus|viatura|"
                               r"ambulancia|caminh|frota|abastecimento de)"),
    ("Mão de obra e serviços de apoio", r"(vigilancia|limpeza|conservacao|portaria|mao de obra|terceiriz|copeira|motorista|"
                                       r"recepcion|apoio administrativo|apoio operacional|suporte operacional|jardinagem|"
                                       r"brigad|seguranca patrimonial|servicos continuados|dedicacao exclusiva|dedetiz|"
                                       r"chaveiro|lavanderia|controle de pragas|manutencao predial|secretariado|servicos administrativos|"
                                       r"suporte de nivel operacional)"),
    ("Publicidade, eventos e comunicação", r"(publicidade|propaganda|evento|divulgac|comunicacao|midia|campanha|"
                                          r"cerimonial|show|inscric)"),
    ("Locação de imóveis", r"(locacao de imovel|aluguel de imovel|locacao do imovel|imovel)"),
    ("Capacitação, ensino, estudos e consultoria", r"(consultoria|assessoria|treinamento|capacitac|auditoria|pericia|"
                                                  r"estudo|pesquisa|curso|palestra|workshop|ensino|vagas em|bolsa)"),
    ("Energia, água e utilidades", r"(energia eletrica|fornecimento de agua|esgoto|gas natural|gas canalizado|"
                                   r"concessionaria)"),
    ("Material de expediente, mobiliário e limpeza", r"(expediente|papel|mobiliario|movei|escolar|livro|didatic|"
                                                    r"escritorio|cadeira|mesa|armario|higiene|descartave|brinquedo)"),
    ("Equipamentos e manutenção", r"(equipamento|manutencao|reparo|ar condicionado|elevador|gerador|instalac|"
                                 r"locacao de|aquisicao de|medidor)"),
]
CATEGORIAS_C = [(n, re.compile(p)) for n, p in CATEGORIAS]
TIPOS_OBRAS = {"OBRAS", "SERVICOS DE ENGENHARIA", "REFORMA DE EDIFICIO OU EQUIPAMENTO", "OBRAS E SERVICOS DE ENGENHARIA"}


def categoria(objeto, tipo_aquisicao):
    if norm_nome(tipo_aquisicao) in TIPOS_OBRAS:
        return "Obras e engenharia"
    texto = sem_acento(objeto).lower()
    for nome, rx in CATEGORIAS_C:
        if rx.search(texto):
            return nome
    return "Outros"


# --- parâmetros dos alertas ---------------------------------------------------------------------
LIMITE_ADITIVO_MEDIO = 0.25        # acréscimo de valor acima de 25% do inicial (limite geral da Lei 14.133, art. 125)
LIMITE_ADITIVO_ALTO = 0.50         # 50% é o teto excepcional (reformas); acima disso, alta
PRORROGACOES_MUITAS = 3
DURACAO_LONGA_MESES = 60
DIRETA_VALOR_MEDIO = 500_000.0
DIRETA_VALOR_ALTO = 5_000_000.0
EMPRESA_RECENTE_DIAS = 365
VALOR_RELEVANTE = 100_000.0
CAPITAL_BAIXO_FRACAO = 0.05        # capital social menor que 5% do valor anual contratado
TETO_ME = 360_000.0                # LC 123/2006: microempresa; EPP até 4,8 milhões
TETO_EPP = 4_800_000.0
LIMITE_DISPENSA = 62_725.59        # limite de dispensa por valor (compras e serviços), Decreto 12.343/2024; conferir o vigente
REDE_GRANDE = 25                   # sócio com participação em 25 ou mais empresas

ALTA, MEDIA, INFO = "alta", "média", "info"
ALERTAS = {
    # --- do contrato
    "vigencia_vencida": (ALTA, "Empenho após o fim da vigência",
                         "Há empenho em ano posterior ao do término da vigência registrada (já considerados os aditivos de prazo)."),
    "sem_prazo": (MEDIA, "Sem data de término",
                  "Contrato em execução sem data de fim de vigência registrada."),
    "aditivo_valor": (MEDIA, "Valor acima do inicial",
                      "O valor final supera o inicial em mais de 25% (acima de 50% é nível alto)."),
    "prorrogacoes": (MEDIA, "Prorrogações sucessivas",
                     "Três ou mais alterações de prazo no mesmo contrato."),
    "duracao_longa": (MEDIA, "Duração acima de 5 anos",
                      "Vigência total, com prorrogações, superior a 60 meses."),
    "direta_valor": (MEDIA, "Contratação direta de valor elevado",
                     "Dispensa ou inexigibilidade com valor igual ou superior a R$ 500 mil (R$ 5 milhões é nível alto): conferir a justificativa."),
    "empenho_acima": (MEDIA, "Empenhado acima do contratado",
                      "O total empenhado no contrato supera em mais de 10% o valor final registrado."),
    "sem_modalidade": (INFO, "Modalidade não informada",
                       "Contrato de valor relevante sem a modalidade do processo registrada."),
    "fora_siga": (INFO, "Processo fora do SIGA",
                  "O processo de contratação não foi realizado no sistema SIGA."),
    # --- do fornecedor
    "empresa_recente": (MEDIA, "Empresa recém-aberta",
                        "A empresa foi aberta menos de um ano antes de seu primeiro contrato relevante com o Estado."),
    "situacao_irregular": (ALTA, "Situação cadastral irregular",
                           "O CNPJ não consta como ativo na Receita Federal (suspenso, inapto, baixado ou nulo)."),
    "capital_baixo": (MEDIA, "Capital social baixo",
                      "Capital social inferior a 5% do valor anual contratado com o Estado."),
    "porte_acima_teto": (MEDIA, "Porte incompatível com o valor",
                         "Micro ou pequena empresa cujo valor anual contratado supera o teto de receita bruta do seu porte."),
    "socio_em_comum": (MEDIA, "Sócio em comum com outro fornecedor",
                       "Um mesmo sócio (nome e CPF parcial) consta em mais de um fornecedor do Estado. Nível alto: ganharam o mesmo processo; médio: atendem ao mesmo órgão; informativo: apenas coincidem no Estado."),
    "socio_servidor": (MEDIA, "Sócio com nome de servidor",
                       "O nome de um sócio coincide com o de servidor ativo do Poder Executivo estadual. Pode ser homonímia: confirmar."),
    "endereco_comum": (INFO, "Endereço compartilhado",
                       "Outro fornecedor do Estado registra o mesmo endereço (logradouro, número e CEP)."),
    "rede_grande": (INFO, "Sócio com muitas empresas",
                    "Sócio que consta em 25 ou mais empresas no país (comum em contadores e holdings)."),
    "pessoa_fisica": (INFO, "Fornecedor pessoa física",
                      "Contratado identificado por CPF, sem cadastro de CNPJ para cruzamento."),
    "sem_cadastro": (INFO, "CNPJ sem cadastro na Receita",
                     "O CNPJ não foi encontrado na base da Receita Federal usada no cruzamento."),
}

ALERTAS["fracionamento"] = (MEDIA, "Possível fracionamento de compras diretas",
                            "Três ou mais compras diretas abaixo do limite de dispensa, do mesmo fornecedor no mesmo órgão e ano, "
                            "cuja soma o ultrapassa.")


# --- essencialidade (classificação SUGERIDA do objeto; o gestor deve validar) ---------------------
# essencial: sem ele o serviço público para ou deixa de atender (saúde, alimentação, utilidades);
# suporte: necessário à operação, mas há margem de renegociação (apoio, TI, frota, manutenção);
# investimento: obras e equipamentos, que podem ser adiados ou reprogramados;
# discricionário: publicidade, eventos, consultorias e capacitação, onde o corte é possível;
# indefinido: o objeto não foi reconhecido.
ESSENCIALIDADE = {
    "Saúde": "essencial", "Alimentação": "essencial", "Energia, água e utilidades": "essencial",
    "Mão de obra e serviços de apoio": "suporte", "Tecnologia da informação": "suporte", "Transporte e logística": "suporte",
    "Veículos e combustível": "suporte", "Equipamentos e manutenção": "suporte", "Locação de imóveis": "suporte",
    "Material de expediente, mobiliário e limpeza": "suporte",
    "Obras e engenharia": "investimento", "Máquinas e equipamentos pesados": "investimento",
    "Publicidade, eventos e comunicação": "discricionario", "Capacitação, ensino, estudos e consultoria": "discricionario",
}
ESSENCIAL_POR_TEXTO = re.compile(r"(transporte escolar|ambulancia|pacientes|vigilancia|merenda|alimentacao escolar|"
                                 r"medicament|oncolog|dialise|oxigenio|energia eletrica|agua e esgoto)")
ROTULO_ESSENCIALIDADE = {"essencial": "Essencial", "suporte": "Suporte", "investimento": "Investimento", "discricionario": "Discricionário",
                         "indefinido": "Não classificado"}


def essencialidade(cat, objeto):
    if ESSENCIAL_POR_TEXTO.search(sem_acento(objeto).lower()):
        return "essencial"
    return ESSENCIALIDADE.get(cat, "indefinido")

ALERTAS["pago_acima"] = (MEDIA, "Pago acima do contratado",
                         "O total pago nos empenhos exclusivos do contrato supera em mais de 10% o valor final registrado (pode indicar valor final subestimado no cadastro ou empenho usado em outro contrato).")
ALERTAS["ritmo_acelerado"] = (MEDIA, "Execução em ritmo acelerado",
                              "Já foram pagos 80% ou mais do valor do contrato com menos de metade do prazo decorrido.")
ALERTAS["pago_sem_contrato"] = (MEDIA, "Pagamentos sem contrato vigente",
                                "O fornecedor recebeu R$ 1 milhão ou mais nos últimos dois exercícios deste órgão sem ter contrato vigente nele (pode ser compra direta, ata ou contrato vencido).")
ALERTAS["sem_pagamento"] = (INFO, "Contrato sem pagamento identificado",
                            "Contrato vigente há mais de um ano, de valor relevante, sem nenhum pagamento do órgão ao fornecedor desde 2021.")

# --- cruzamentos externos (PGFN, CEIS/CNEP, TSE) --------------------------------------------------
ALERTAS["divida_ativa"] = (MEDIA, "Dívida ativa com a União",
                           "O CNPJ (qualquer filial) tem inscrições em dívida ativa da União (PGFN) em cobrança. Nível médio: R$ 500 mil ou mais, ou 10% do valor anual contratado; alto: R$ 5 milhões ou mais e acima do valor anual contratado.")
ALERTAS["sancao_vigente"] = (ALTA, "Sanção vigente (CEIS/CNEP)",
                             "Consta no cadastro de empresas sancionadas (CEIS ou CNEP) com sanção em vigor. Nível alto: inidoneidade ou sanção aplicada por órgão do Espírito Santo; médio: aplicada em outro estado ou esfera, cujo alcance sobre o Estado deve ser conferido.")
ALERTAS["sancao_encerrada"] = (INFO, "Sanção anterior (CEIS/CNEP)",
                               "Consta no CEIS ou CNEP com sanção já encerrada.")
ALERTAS["socio_sancionado"] = (MEDIA, "Sócio sancionado",
                               "Um sócio (nome e seis dígitos do CPF) consta no CEIS ou CNEP. Conferir a vigência e o alcance da sanção.")
ALERTAS["doacao_governador"] = (MEDIA, "Sócio doou a candidato ao governo do ES",
                                "Sócio ou administrador (nome e seis dígitos do CPF) doou a campanha de candidato a governador ou vice no Espírito Santo. Nível médio a partir de R$ 10 mil no total. Doação é ato legal e público; o dado indica proximidade a conferir.")
ALERTAS["doacao_eleitoral"] = (INFO, "Sócio doador de campanhas",
                               "Sócio (nome e seis dígitos do CPF) aparece como doador na prestação de contas de candidatos ou partidos (2018–2024).")
ALERTAS["doacao_pj"] = (MEDIA, "Empresa consta como doadora",
                        "O próprio CNPJ aparece como doador na prestação de contas de candidatos ou partidos (2018–2024).")
ALERTAS["socio_candidato"] = (INFO, "Sócio foi candidato",
                              "Sócio (nome e seis dígitos do CPF) concorreu a cargo eletivo em 2018–2024.")
ALERTAS["fornecedor_campanha"] = (INFO, "Fornecedor de campanhas eleitorais",
                                  "A empresa foi contratada por campanhas de candidatos no Espírito Santo (2018–2024), conforme a prestação de contas.")
