# Painel Fiscal · Espírito Santo

Painel de acesso restrito para diagnósticos fiscais e de pessoal do Poder Executivo do Espírito Santo, a partir de dados abertos oficiais. Cada tema é um **módulo** (uma aba) com pipeline e dados próprios, de modo que novas pesquisas entram sem mexer nas existentes.

| Módulo | Conteúdo | Situação |
|---|---|---|
| `cargos` | Servidores e cargos de confiança: quadro de servidores do Executivo, cargos em comissão e funções gratificadas, custo mensal, tempo na função e a ficha da folha de cada pessoa | em operação |
| `organograma` | Árvore de unidades de um órgão com as pessoas de cada uma, a condição (sem vínculo efetivo, servidor de carreira, função gratificada) e a remuneração somando carreira e cargo | em operação, com a estrutura oficial de 55 órgãos |

## Módulo `cargos`

Navegação do governo para o órgão, do órgão para a função e da função para o ocupante: mapa de blocos por órgão (área proporcional ao custo mensal ou ao número de ocupantes), barras por cargo e função, série mensal de ocupantes, e tabela de ocupantes com tempo na função, provimento e valor do cargo, exportável em CSV. SEFAZ e SEP aparecem em destaque.

### Fonte dos dados

Portal de Dados Abertos do ES, conjunto [Portal da Transparência — Pessoal](https://dados.es.gov.br/dataset/portal-da-transparencia-pessoal) (SEGER): folha mensal (`Remuneracoes-MM_AAAA.csv`) e base de vínculos (`VinculosServidores.csv`). O CPF vem mascarado na fonte e não é lido pelo pipeline.

**Limite de cobertura:** empresas públicas e sociedades de economia mista (Bandes, Banestes, Cesan e outras) **não constam** dessa base e exigem fonte própria.

**Escopo e qualidade:** `JUIZADO DE DIREITO` e `CGJES` (Poder Judiciário) constam da base só de out/2024 a set/2025 e são excluídos por regra (`ORGAOS_EXCLUIDOS`), para não gerar saídas fictícias. Só conta como ocupante quem tem rubrica de cargo na competência: sem isso, todo janeiro apareceriam cerca de mil comissionados fictícios (resíduos de "insuficiência de saldo" de quem foi desligado ou afastado). A classificação por rubricas foi conferida contra o tipo de vínculo oficial da base de vínculos (3.403 de 3.450 comissionados sem vínculo efetivo constam como `COMISSIONADO`; os demais não foram localizados na base de vínculos).

### Regras de cálculo (`pipeline/cargos/regras.py`)

A folha traz uma linha por rubrica; o valor do cargo é reconstruído somando só as rubricas do cargo na competência corrente. O princípio é que **valor do cargo é o que se paga por causa do cargo**; a remuneração que o servidor de carreira receberia de qualquer modo não é custo do cargo.

Para cargo em comissão: vencimento do cargo comissionado (puro ou de servidor com vínculo de origem), subsídio da função, gratificação de produtividade e gratificação especial de comissionado. Quando o servidor **opta** pelo cargo em comissão e mantém a remuneração de origem, entram só a rubrica de opção e as gratificações. O subsídio só conta quando é o subsídio padrão da função (a moda entre ocupantes sem cargo efetivo); servidor de carreira que recebe o subsídio da carreira, como um secretário que é Auditor Fiscal, fica com o valor do cargo restrito às gratificações, e o subsídio da carreira é exibido à parte, sem ser somado. Para função gratificada, entram só as rubricas "Função Gratificada". Ficam de fora 13º, férias, auxílios, descontos e ajustes de outras competências. O custo anualizado é o valor mensal × 12, sem 13º, férias e encargos.

O **tempo na função** é inferido pela primeira competência, dentro da janela extraída, em que a pessoa aparece de forma contínua na mesma função; "≤" indica que já ocupava a função na primeira competência da janela.

As entradas e saídas por mês continuam calculadas em `montar.py` (campos da série), mas não são mais exibidas: não ajudavam a decidir nada.

### Como atualizar os dados

Requer Python 3.9+ e `curl`; nenhuma dependência externa.

```bash
python3 pipeline/cargos/extrair.py --meses 2024-10:2026-09 --jobs 6   # lê em fluxo e guarda só CC/FG em .cache/cargos/
python3 pipeline/cargos/extrair_vinculos.py                            # nomes dos órgãos e vínculo oficial
GERADO_EM=$(date +%F) python3 pipeline/cargos/montar.py                # gera data/cargos/index.json e data/cargos/org/*.json
```

O cache (`.cache/cargos/`) guarda as rubricas de cada ocupante, então mudar uma regra em `regras.py` exige apenas rodar `montar.py` de novo, sem novo download. Cada mês pesa de 80 a 250 MB na origem e é lido em fluxo, sem ser gravado em disco.

## Módulo `organograma`

Escolha um órgão e abra a árvore por toque: Secretaria, subsecretarias, gerências, subgerências e as pessoas de cada unidade. Cada pessoa traz a condição por **cor e rótulo escrito** (azul: comissionado sem vínculo efetivo; laranja: servidor de carreira em cargo em comissão; verde: servidor de carreira com função gratificada), o valor do cargo e a **remuneração bruta**, que soma carreira e cargo. Cada unidade mostra uma barra com a proporção das condições. É possível filtrar por condição, buscar por nome ou função e exportar o resultado em CSV.

### De onde vem a hierarquia

A subordinação vem do **Organograma ES** ([organograma.es.gov.br](https://organograma.es.gov.br)), a plataforma oficial de organogramas do Governo do ES; é a mesma que os sites das secretarias incorporam na página de organograma (por exemplo, `planejamento.es.gov.br/organograma`). O coletor `baixar_estrutura.py` usa as duas rotas públicas que a página chama no navegador (`/home/organizacoes/<Estado>` e `/organograma/detalhes/<órgão>`) e guarda um **retrato datado** de cada órgão em `pipeline/organograma/estrutura/oficial/<SIGLA>.json`, com pausa entre os pedidos. Cobre 55 dos 56 órgãos do painel (só a ES-Previdência não consta).

A base de vínculos informa o setor de cada pessoa (código e nome), mas **não diz quem é subordinado a quem**, e o código do setor **não é confiável como nível hierárquico**. As pessoas são ligadas às unidades do organograma por camadas: código igual à sigla da unidade, nome idêntico ou equivalente, e sigla ao final do nome do setor, sempre exigindo que o casamento seja único. Quem não casa fica num agrupamento **"subordinação não confirmada"**, ordenado pelo nível do código; nada é inferido por palpite. A cobertura passa de 95% em quase todos os órgãos; as exceções, por limite da base, são **IASES** (4%) e **SESP** (0%), em que o nome do setor repete o nome do órgão e o código é numérico, e o **CBMES** (89%).

Validação: comparada com a transcrição manual do Anexo III do Decreto 6005-R e do Decreto 6160-R (arquivada em `estrutura/historico/`), a plataforma coincide em 82 de 98 unidades da SEFAZ e é mais atual nas demais: GETEC, GEATE e GERAG ficam diretamente sob a Secretaria, a UFAR é unidade direta com as assessorias da reforma tributária abaixo dela, e unidades como SUBAD, SUDES, SUINF, SUMOP, SUAUC e GECON já não existem. Isso também confirma as ligações informadas pelo titular do painel em out/2026 (SUDEP e SUOPT na GETEC, SUAFI e SUCOM na GEINF, SUCOP na GEFAP, GELOG na SUBSAD).

Para órgãos sem retrato oficial vale ainda a tabela manual `estrutura/<ORGAO>.csv` (colunas `sigla;nome;pai;situacao;fonte;codigo`, sem ponto e vírgula dentro dos textos; o montador valida o formato).

### Duas formas de ver

No computador, o **organograma** mostra caixas ligadas por linhas: o número na base de cada caixa abre ou fecha o ramo, unidades-folha ficam penduradas em coluna sob o pai, e tocar numa caixa mostra no painel lateral o caminho, a fonte, os totais e as pessoas da unidade (com a opção de listar também as das subunidades). A **lista** traz a mesma árvore em formato expansível e é a visão padrão no celular. A escolha é lembrada no navegador.

### Como atualizar

```bash
python3 pipeline/cargos/extrair_vinculos.py          # setor de cada ocupante (requer o cache do módulo cargos)
python3 pipeline/organograma/baixar_estrutura.py     # retrato da estrutura oficial (rode quando a estrutura mudar)
python3 pipeline/organograma/montar.py               # gera data/organograma/index.json e data/organograma/org/*.json (e mostra a cobertura por órgão)
```

A estrutura muda por decreto e a plataforma é atualizada pelos órgãos: rode `baixar_estrutura.py` de tempos em tempos e confira o resultado de `montar.py`.

### Quem não ocupa cargo ou função

Além de quem ocupa cargo em comissão ou função gratificada, o organograma pode mostrar os **demais servidores ativos** de cada unidade, numa quarta condição em cinza ("sem cargo ou função"), com cargo efetivo e remuneração bruta. Vem **desligada** por padrão, e o arquivo do órgão (`data/organograma/todos/<SIGLA>.json`, em formato compacto) só é carregado quando o filtro é ligado. Na folha de setembro/2026 são cerca de 51 mil vínculos. Ficam de fora estagiários e médicos residentes (bolsa não é salário) e vínculos sem nenhuma rubrica de pagamento no mês; funções não remuneradas entram, por serem servidores comuns.

```bash
python3 pipeline/cargos/extrair_vinculos.py          # agora guarda também o setor de TODOS os vínculos ativos (vinculos_todos.json)
python3 pipeline/organograma/extrair_todos.py        # remuneração bruta e cargo efetivo de quem não ocupa cargo (.cache/organograma/todos.json)
python3 pipeline/organograma/montar.py
```

Os dados nominais de todos os órgãos, inclusive os de segurança pública e do sistema prisional e socioeducativo, são exibidos por decisão do titular do painel. O acesso é restrito por senha, mas o conteúdo é sensível; se isso mudar, basta deixar de gerar `todos/<SIGLA>.json` para os órgãos escolhidos.

### Remuneração bruta

Soma das rubricas de pagamento do mês, sem auxílios e indenizações, 13º, férias e resíduos de acerto financeiro (regra em `pipeline/cargos/regras.py`, função `remuneracao`). O abate do teto constitucional aparece à parte, no detalhe da pessoa.

## Módulo `contratacoes`

Raio-x dos contratos do Poder Executivo, por órgão: quanto cada um tem comprometido, com quem, em que objeto, por qual modalidade, e com que sinais de alerta. Serve para quem assume um governo e precisa saber o que herda e o que revisar primeiro. A tela vai do governo ao órgão e deste à ficha do fornecedor, com o quadro societário.

### Fontes

Contratos, alterações contratuais e empenhos do Portal da Transparência do ES (dados abertos, sistema SIGA, arquivos anuais desde 2016), e o cadastro de CNPJ da Receita Federal (dados abertos: empresas, estabelecimentos e sócios), lido de um espelho público da publicação mensal. O CPF dos sócios já vem mascarado pela Receita. O nome dos sócios é cruzado com a folha do módulo `cargos` e `organograma` (nomes de servidores ativos); como não há CPF aberto na folha, o resultado é só um indício de homonímia a conferir.

### Definições

Contrato vigente é o instrumento do tipo contrato, carta-contrato ou termo de adesão cuja data final (com aditivos de prazo) não passou e cuja situação não é de encerramento. Valor final é o valor total do instrumento (em registro de preços, costuma ser o máximo estimado). Compromisso anual é o valor final dividido pela duração em meses (mínimo 12) vezes 12. Saldo a executar é o valor final menos o empenhado. **Os empenhos do SIGA não cobrem toda a execução** (obras do DER, por exemplo, quase não aparecem): a tela avisa quando a cobertura é baixa.

### Execução: o que foi pago (SIGEFES)

Os empenhos do SIGA cobrem só parte da execução. Para medir o dinheiro que de fato saiu, o módulo lê a execução da despesa do Portal da Transparência (SIGEFES, arquivos anuais de 0,5 a 1,5 GB) e guarda só as linhas cujo favorecido é um CNPJ presente nos contratos (CPF não é lido). O arquivo não é baixado por inteiro: `execucao.py` lê fatias de bytes em paralelo e termina um ano em poucos minutos. O vínculo com o contrato é o número do empenho (`NumeroEmpenho` no SIGA e `DocumentoEmpenho` no SIGEFES, par com o CNPJ; 97% dos empenhos do SIGA casam). A unidade gestora que paga é ligada ao órgão do SIGA pela maioria dos empenhos vinculados e, na falta, pelo nome. Pago é o valor de `ValorPago` somado; cobre os exercícios de 2021 em diante.

No **contrato**, o pago soma só os empenhos que o SIGA vincula a ele. No **órgão** e na **ficha do fornecedor**, é tudo o que o órgão (ou o Estado) pagou ao CNPJ, com ou sem contrato, o que inclui compras diretas e repasses; por isso a curva de Pareto por pago esconde por padrão bancos, empresas públicas, autarquias e prefeituras (há um botão para incluí-los). Novos alertas: pago acima do contratado, execução em ritmo acelerado, pagamentos sem contrato vigente e contrato sem pagamento identificado.

### Visão por empresa e regra de Pareto

Para cada fornecedor a tela responde: quanto recebe por ano (compromisso anual dos contratos vigentes, e o empenhado recente), desde quando (data do primeiro instrumento no SIGA; a base começa em 2016), por mais quanto tempo (data final dos contratos vigentes) e quanto ainda tem a receber (estimativa linear: valor anual vezes o tempo restante, limitado ao valor final). A **essencialidade** do objeto é uma classificação sugerida pelo tipo de objeto (`ESSENCIALIDADE` em `regras.py`): essencial (saúde, alimentação, utilidades, vigilância, transporte escolar), suporte, investimento (obras e equipamentos, que podem ser adiados) e discricionário (publicidade, eventos, consultoria e capacitação). Serve para orientar a conversa com o gestor e deve ser validada por ele.

A **curva de Pareto** (governo e cada órgão) ordena os fornecedores pela medida escolhida (compromisso anual, empenhado ou o que ainda têm a receber), mostra quantos concentram o corte (80% por padrão, ajustável de 50% a 95%) e lista os fornecedores principais (o grupo que atinge o corte), com filtro por essencialidade. Os dados globais ficam em `data/contratacoes/fornecedores.json`.

### Dívidas, sanções e vínculos políticos (`externos.py`)

A ficha de cada fornecedor mostra o quadro societário (Receita Federal) e o cruza com três bases públicas:

- **Dívida ativa da União** (PGFN, dados abertos: previdenciária, FGTS e não previdenciária), somada por CNPJ-raiz (todas as filiais), com a parte em cobrança, a ajuizada e a data da primeira inscrição.
- **Sanções** do CEIS e do CNEP (CGU), para a empresa e para os sócios. O alerta é de nível alto para inidoneidade ou sanção aplicada por órgão do Espírito Santo, e médio quando aplicada em outro estado ou esfera (o alcance deve ser conferido).
- **Vínculos eleitorais** (TSE, prestação de contas de candidatos e de órgãos partidários, eleições de 2018, 2020, 2022 e 2024): doações de sócios a candidatos e partidos (com destaque para candidatos a governador e vice no ES), sócios que foram candidatos, empresas contratadas por campanhas no ES e a própria empresa como doadora.

**Grau de confiança de cada vínculo.** Além de nome e seis dígitos do CPF, o painel usa dados oficiais para confirmar o vínculo. Candidatos: o cadastro de candidaturas do TSE (`consulta_cand`) traz data de nascimento, ocupação e resultado, e a Receita informa a faixa etária do sócio; faixa igual dá "Confirmado", vizinha dá "Provável" e divergente dá "A conferir". Para 2024, em que o TSE oculta o CPF dos candidatos, só se aproxima por nome, em candidaturas no ES, e o vínculo é sempre "A conferir". Doações: "Confirmado" quando o município do doador é o da sede da empresa; "Provável" nos demais casos. Cada doação mostra também se o candidato foi eleito. Os alertas não sobem de nível pela confiança; ela aparece no detalhe de cada vínculo.

**Como o sócio é reconhecido.** A Receita mascara o CPF dos sócios (`***123456**`, dígitos 4 a 9), enquanto o TSE e a CGU trazem o CPF inteiro. Dá-se o sócio como a mesma pessoa só quando o nome é igual e os seis dígitos conferem. O critério é forte, mas a conferência final é humana. Em sociedades anônimas, "sócio" inclui administradores. Doação eleitoral é ato legal e público: o painel aponta proximidade a conferir, não irregularidade. Não aparecem vínculos por parentesco, doações por terceiros e eleições anteriores a 2018 (nas de 2014 e antes, empresas podiam doar; os arquivos têm outro formato e não foram incluídos).

```bash
python3 -I pipeline/contratos/externos.py sancoes pgfn tse2018 tse2020 tse2022 tse2024   # rode os anos do TSE em processos separados para ir mais rápido
```

### Contratos principais (diagnóstico)

A análise cuidadosa parte sempre dos contratos que, ordenados do maior para o menor valor, somam 80% do compromisso anual dos contratos vigentes do Estado (os "contratos principais", o que a literatura chama de classe A da curva ABC; o corte é ajustável de 50% a 95%, e a medida pode ser o compromisso anual, o que ainda falta receber ou o valor total). O botão "Diagnóstico dos contratos", no topo do módulo, abre a tela com a curva de Pareto por contrato, o resumo dos alertas entre os contratos principais (quantos contratos, quanto valem e o que esclarecer em cada tipo), os contratos principais por órgão e a lista completa, com filtros por órgão, objeto, modalidade, essencialidade e alerta. Cada contrato abre com os motivos dos alertas e a orientação "o que esclarecer" (`ESCLARECER` em `regras.py`, uso interno; os alertas de vínculo político são marcados como triagem interna e não motivam pedido formal por si sós). Há também a colocação em lote dos contratos filtrados na lista de revisão, a exportação em CSV e o "Relatório de diagnóstico" para impressão, em versão de circulação ampla ou restrita. Os dados ficam em `data/contratacoes/diagnostico.json`. A tabela "Contratos para olhar primeiro" do painel do governo e a lista de cada órgão também partem dos contratos principais.

**Contagens e seguir o dinheiro.** A visão geral conta contratos vigentes (2.799 em 14/10/2026); a regra de Pareto de fornecedores conta CNPJs (1.073 com valor anual, 1.048 sem bancos, entes públicos e prefeituras); os contratos principais contam contratos com valor anual registrado (2.775, porque 24 não têm valor). O filtro de entes públicos é único para as duas telas e vem ligado. O pago vem do SIGEFES e é lido em dois níveis: o pago nos empenhos que o SIGA liga ao contrato (`pago`, `pago23`) e o pago pelo órgão ao CNPJ, com ou sem contrato (`pagoForn23`). Na ficha do fornecedor, cada órgão abre o pago mês a mês desde jan/2025 e os contratos do fornecedor ali, com objeto e número do processo do SIGA. O fiscal do contrato não consta nos dados abertos (item da lista de informações a solicitar). "Pago desde 2023" marca o início da gestão atual (`MANDATO_DESDE` em `pipeline/contratos/montar.py`).

### Lista de revisão e relatório

Qualquer contrato pode ser marcado para revisão (botão "Marcar" na tabela "Contratos para olhar primeiro", ou "Colocar na lista" no detalhe de um contrato do órgão), com motivo (renegociar, objeto dispensável ou adiável, rescindir ou não renovar, substituir por licitação, apurar indício, rever fornecedor), situação (a revisar, em análise, decidido) e anotação. A tela "Lista de revisão" (botão no topo do módulo) permite editar tudo, filtrar, exportar em CSV, salvar e reabrir a lista em arquivo JSON e atualizar os valores para a posição de dados mais recente. "Gerar relatório para imprimir" monta um documento com título e introdução editáveis, resumo por órgão e por motivo, o detalhe de cada contrato (valores, vigência, situação da empresa na Receita, sócios, alertas e anotação) e notas metodológicas; o botão "Imprimir ou salvar em PDF" usa a impressão do navegador, com estilo próprio (A4, preto e branco).

**Onde a lista fica guardada:** no navegador de quem marcou (`localStorage`), não no servidor. Ela não é compartilhada entre pessoas nem entre computadores; para isso, use "Salvar lista (arquivo)" e "Abrir lista salva". Se for preciso uma lista única e compartilhada, será necessário um banco de dados (por exemplo, Supabase ou Vercel KV), com a mesma sessão de acesso do painel.

### Alertas (`pipeline/contratos/regras.py`)

São regras objetivas de triagem, listadas na própria tela (rodapé "Fonte e método"): empenho após o fim da vigência, valor acima do inicial (25% e 50%), prorrogações sucessivas, duração acima de 5 anos, contratação direta de valor elevado, empenhado acima do contratado, empresa recém-aberta, situação cadastral irregular, capital social baixo, porte (ME/EPP) incompatível com o valor, sócio em comum com outro fornecedor, sócio com nome de servidor, endereço compartilhado, possível fracionamento de compras diretas, entre outros. **Indicam onde olhar primeiro; não provam irregularidade.** Os limites ficam em constantes no topo de `regras.py` (o limite de dispensa por valor deve ser conferido contra o decreto vigente).

### Como atualizar

```bash
python3 -I pipeline/contratos/baixar.py                 # contratos, alterações e empenhos (.cache/contratos)
python3 -I pipeline/contratos/receita.py 2026-09-14     # cadastro da Receita para os CNPJs dos contratos (data da publicação mensal)
python3 -I pipeline/contratos/execucao.py 2021 2022 2023 2024 2025 2026   # pagamentos (SIGEFES) aos CNPJs dos contratos
python3 -I pipeline/contratos/montar.py                 # gera data/contratacoes/ (index, org/, forn/, busca)
```

Limites conhecidos: a classificação do objeto é por palavras-chave; não há comparação de preços entre contratações; o pago do contrato depende de o SIGA vincular os empenhos a ele; empresas públicas e fundos fora do SIGA não aparecem.

## Módulo `lacunas` (Informações a solicitar)

Catálogo das lacunas de dados e de transparência que a análise encontrou, para compor o pedido de informações da equipe de transição. Cada item traz o que falta, a evidência calculada a partir dos próprios dados do painel (por exemplo, quantos contratos principais não têm pagamento ligado, quantas contratações foram conduzidas fora do SIGA, o fim da cobertura do conjunto de obras), a decisão que a informação habilitaria, o que solicitar, a quem e a prioridade. O catálogo está em `pipeline/lacunas/montar.py`; para incluir ou ajustar um item, edite a lista `itens` desse arquivo e rode o script depois de `pipeline/contratos/montar.py` e `pipeline/organograma/montar.py`.

**Critério de prioridade.** Alta: afeta contratos principais em R$ 500 milhões por ano ou mais, ou é questão de integridade ou de urgência da transição. Média: de R$ 50 milhões a R$ 500 milhões por ano, ou informação transversal. Baixa: menos que isso. Os itens cuja existência a equipe ainda precisa confirmar com o Estado aparecem marcados "a validar".

Na tela, cada item pode ter situação (a decidir, no pedido, enviado, recebido, recebido em parte, descartado) e anotação, salvas no navegador. "Gerar lista para o pedido" monta um documento imprimível com as informações marcadas "No pedido", agrupadas por destinatário, com finalidade e, opcionalmente, o contexto observado nos dados. O texto é neutro e factual: não faz juízo sobre a regularidade de contratos.

```bash
python3 -I pipeline/lacunas/montar.py
```

## Acesso e implantação (Vercel)

Nada em `data/` é servido como arquivo estático: os dados só saem por `api/dados.js`, que exige sessão válida (senha) ou, no modo de teste, o acesso aberto descrito abaixo.

**Modo de teste sem senha.** O arquivo `acesso.json` na raiz liga e desliga a senha: `{"modo": "aberto"}` dispensa a senha (qualquer pessoa com o endereço entra e a página mostra um aviso); `{"modo": "senha"}` volta a exigi-la. A variável de ambiente `PAINEL_ACESSO` (`aberto` ou qualquer outro valor) prevalece sobre o arquivo. Na dúvida, vale a senha. Enquanto o modo aberto estiver ligado, os dados, que incluem nomes e valores de pessoas, ficam acessíveis a quem tiver o link: só use com o endereço em circulação restrita e volte para `senha` antes de qualquer divulgação.

Variáveis de ambiente do projeto (configurar no Vercel, nunca no repositório):

| Variável | Uso |
|---|---|
| `PAINEL_SENHA` | senha compartilhada de acesso |
| `PAINEL_SEGREDO` | chave de assinatura da sessão (32+ caracteres aleatórios) |
| `PAINEL_ACESSO` | opcional: `aberto` desliga a senha; prevalece sobre `acesso.json` |

Para trocar a senha, altere `PAINEL_SENHA` no painel do Vercel e faça um novo deploy; para derrubar todas as sessões abertas, altere também `PAINEL_SEGREDO`. A sessão dura 12 horas. O site envia `noindex`, `robots.txt` restritivo e cabeçalhos de segurança (`vercel.json`).

Teste local: `PAINEL_SENHA=x PAINEL_SEGREDO=<32+ caracteres> node dev-server.js 3000`.

## Navegação

O site tem uma chave de painéis no topo (Pessoal, Contratos, Fundos, Transição). Cada painel tem sua cor e, quando reúne mais de uma tela, um menu de telas logo abaixo do cabeçalho; ao trocar de painel o site volta à última tela vista nele, e ao reabrir o endereço sem destino retoma de onde se parou. Os painéis ficam na lista `PAINEIS` de `public/core.js`: cada item aponta para um módulo e, se quiser, para uma tela dele (`sub`), com `casa(resto)` para marcar quando está ativo e `selo` para um contador. A cor de cada painel (`--ac-pessoal`, `--ac-contratos`, `--ac-fundos`, `--ac-transicao`) está em `public/style.css`. Um módulo registrado e não listado em `PAINEIS` aparece num painel "Outros". A marca é só tipográfica, sem brasão, para não sugerir publicação oficial; o título usa a fonte Barlow Condensed (licença SIL OFL), hospedada em `public/fontes/` para o site não depender de servidores externos.

## Como acrescentar um módulo

1. **Dados:** crie `pipeline/<id>/` com os scripts que gerem arquivos JSON em `data/<id>/` (precisa existir ao menos `index.json`; arquivos adicionais em subpasta de um nível, por exemplo `data/<id>/item/X.json`).
2. **Interface:** crie `public/modulos/<id>.js`, que se registra com `PF.registrar({ id, titulo, montar(ctx), aoNavegar(resto), desmontar() })`. `ctx.container` é a área da aba, `ctx.api('index')` lê `data/<id>/index.json` com a sessão, e `ctx.irPara('resto')` navega para `#/<id>/resto`. Utilidades e gráficos reutilizáveis (`PF.graficoLinhas`, `PF.graficoBarras`, `PF.mapaDeBlocos`, dicas, formatação) estão em `core.js` e `graficos.js`.
3. Inclua o `<script src="modulos/<id>.js">` em `public/index.html`. A aba aparece sozinha.

Nenhuma outra parte muda: a API de dados (`/api/dados?mod=<id>&arq=...`) e o controle de acesso já servem qualquer módulo.

## Estrutura

```
pipeline/<módulo>/   extração, regras de cálculo e montagem dos dados (Python, sem dependências)
api/                 funções de servidor: login, sessão, entrega de dados com sessão, logout
public/              casca do painel (core.js, graficos.js) e módulos (modulos/<id>.js)
data/<módulo>/       dados processados, servidos só após o login
```

### Compartilhar listas, celular e desempenho

No fim das listas filtradas (ocupantes de um órgão, contratos de um órgão e contratos principais) há o bloco "Compartilhar esta lista": um PDF com título, filtros aplicados, tabela e data de geração, e um resumo em texto. No celular, o PDF vai direto ao menu de compartilhamento do aparelho (WhatsApp, e-mail); no computador, é baixado. O PDF é gerado no próprio aparelho com a biblioteca jsPDF (MIT), guardada em `public/vendor/` e baixada só quando necessária; o código está em `public/compartilhar.js`. O arquivo sai marcado como uso interno e traz até 600 linhas. Como leva nomes e valores de pessoas para fora do painel, vale a regra de sempre: compartilhar só com quem precisa.

Em telas estreitas, os órgãos aparecem por padrão em lista ordenada, com o nome inteiro e a barra proporcional, em vez do mapa de blocos (o mapa e a tabela continuam disponíveis nas abas Lista, Mapa e Tabela). Para reduzir a espera, os arquivos de dados são guardados pelo navegador por 5 minutos (`Cache-Control` em `api/dados.js`), as telas de contratos pré-carregam em segundo plano os arquivos grandes que as outras telas usam (exceto com economia de dados ativada) e uma barra fina no cabeçalho indica que há dados sendo baixados.

### Onde ficam os dados e por que não há banco de dados (por ora)

Os dados são arquivos JSON versionados em `data/`, gerados pelos scripts de `pipeline/` e entregues por `api/dados.js`. Para um painel de leitura com cerca de 16 MB, isso é mais rápido e barato que um banco: a resposta é um arquivo pronto, sem consulta. Para diminuir a espera, a função roda em São Paulo (`regions: ["gru1"]` em `vercel.json`), o navegador guarda cada arquivo por 5 minutos e, com o painel aberto (sem senha), a rede da Vercel também o guarda (`s-maxage`), de modo que a função não precisa "acordar" a cada pedido. Com senha, o cache é só do navegador (`private`). Um banco passa a valer a pena em dois casos: guardar o que as pessoas escrevem (lista de revisão, situação das informações a solicitar, pedidos), hoje preso a cada navegador, e consultar bases grandes demais para enviar inteiras ao celular (folha completa, pagamentos por contrato).

### Fim de mandato

Tela do painel Contratos (módulo `fimmandato`, dados em `data/fimmandato/index.json`, gerados por `pipeline/contratos/fimmandato.py`) com o que o governo que sai assumiu desde 1º de maio de 2026, início dos dois últimos quadrimestres do mandato (LRF, art. 42). Há só dois alertas, escolhidos por serem verificáveis nos dados públicos. Cada um abre numa página com a base legal, o que esclarecer, o critério e os cuidados de leitura (recolhidos), os indicadores e a lista em ordem de valor, com filtros e o bloco de compartilhar em PDF. O primeiro reúne os contratos celebrados desde 1º de maio com vigência depois de 31/12/2026 (parcela posterior a 2026 estimada: valor anual vezes os dias depois de 31/12 sobre 365, limitada ao valor final). O segundo reúne aditivos de prazo (prorrogação) e de valor (acréscimo ou supressão quantitativa) registrados no SIGA desde a mesma data em contratos vigentes; reajustes, repactuações e mudanças de cadastro ficam de fora, por serem rotina, e acréscimos acima de 25% do valor inicial são destacados. O marco e a data de fim do mandato estão em `pipeline/contratos/fimmandato.py`. O empenhado e ainda não pago só passa a ter sentido em 31/12 e entrará nessa época; o saldo de caixa, que decide o cumprimento do art. 42, não é público e consta em Informações a solicitar.

### Vínculos políticos

Tela do painel Pessoal (módulo `politico`, dados em `data/politico/`, gerados por `pipeline/cargos/politico.py`) que cruza os ocupantes de cargo em comissão e função gratificada (folha mais recente) com as doações de pessoa física a candidatos registradas na prestação de contas do TSE em 2018, 2022 e 2026 (esta parcial, até a data de geração do arquivo). A base de vínculos dos servidores traz o CPF mascarado com os seis dígitos do meio visíveis, e o TSE traz o CPF do doador inteiro: é a mesma pessoa quando o nome normalizado e esses seis dígitos coincidem (nos 7.573 ocupantes testados não houve chave repetida, o que afasta homônimos). Executivo = governador do ES e presidente; Legislativo = deputados estadual e federal e senador pelo ES. Ficam de fora doações a partidos, de pessoa jurídica e do próprio candidato a si (em 2026 o CPF do candidato não vem no arquivo, então vale o nome). O resultado de 2022 do 2º turno é tratado em `ELEITOS_NO_2_TURNO`, porque o arquivo do TSE não o atualiza.

Privacidade. É dado pessoal sensível (opinião política de pessoas identificadas), construído sobre fontes públicas (folha, base de vínculos e prestação de contas do TSE). Por decisão do dono do painel, enquanto o endereço não é divulgado, tanto o agregado (`data/politico/index.json`) quanto a lista nominal (`data/politico/pessoas.json`) estão versionados em repositório público e são entregues com o painel aberto. Isso significa que qualquer pessoa que encontre o repositório pode lê-los, com ou sem senha, e que o que já foi publicado não pode ser recolhido por completo (histórico, cópias e índices). Antes de divulgar o link, o caminho prudente é tornar o repositório privado, religar a senha (`acesso.json`) e voltar a restringir a lista nominal (`SO_COM_SENHA` em `api/dados.js`).

### Servidores, ficha da pessoa e pagamentos por fundos

Visão geral. A tela inicial do painel Pessoal abre com o quadro de servidores do Poder Executivo, e não só com os cargos de confiança: `pipeline/cargos/servidores.py` lê a folha do último mês (uma linha por rubrica) e conta as pessoas ativas de cada órgão (matrícula e vínculo, sem inativos e pensionistas), soma as vantagens correntes do mês (sem 13º, férias, rescisão e resíduos de acerto) e classifica o tipo de vínculo pela base de vínculos (efetivo, contrato temporário, comissionado...). O seletor "Servidores" alterna entre todos os servidores e só os cargos em comissão e funções gratificadas; no órgão, o quadro aparece no topo. A lista nominal continua só para quem tem cargo ou função. Parte dos servidores (cerca de 10%) não tem o tipo de vínculo identificado na base, e a tela diz isso.

Ficha da pessoa. Ao clicar num ocupante (em Servidores e cargos, em Vínculos políticos ou em Pagamentos por fundos), abre a ficha (`public/ficha.js`) com a composição da folha do mês, rubrica por rubrica, em vantagens e descontos, agrupadas (cargo ou função, carreira, desempenho, gratificações, auxílios, 13º e férias). As rubricas que entram no valor do cargo (`regras.rubricas_do_cargo`) vêm em destaque e saem de `montar.py` junto de cada ocupante (`rub`). A ficha mostra quanto o cargo representa na remuneração corrente e uma estimativa do efeito de retirá-lo: como o abate do teto constitucional (rubrica "Abate teto EC 41") encolhe primeiro quando a remuneração sujeita ao teto cai, a redução real pode ser menor do que o valor do cargo. A folha não traz CPF, então um segundo vínculo da mesma pessoa em outro órgão não é somado.

Pagamentos por fundos. Alguns pagamentos a pessoal saem de fundos, com unidade gestora própria, e por isso não entram na despesa de pessoal do órgão. Dois casos: a indenização de transporte dos Auditores Fiscais da Receita Estadual, paga pelo Funsefaz (UG 220901, elemento 3.3.90.93, favorecido pessoa física), e a folha complementar paga pelo fundo da PGE (UG 160901). `pipeline/cargos/complementos.py` lê a execução da despesa (SIGEFES) de 2024 em diante, aplica as regras de `REGRAS` e gera `data/cargos/complementos.json` (séries mensais e componentes) e, em `.cache/fundos/`, o pago a cada favorecido pessoa física por mês. `pipeline/pessoalfundos/montar.py` liga cada favorecido do Funsefaz à folha da SEFAZ pelo nome normalizado, dentro do órgão, e gera `data/pessoalfundos/` com a média mensal dos últimos 12 meses, o último mês, a remuneração corrente da folha e a soma dos dois, por pessoa. A tela "Pagamentos por fundos" lista quem recebe, a lotação e quanto o pagamento acrescenta, com a ficha da pessoa ao clicar. O programa de remuneração por desempenho da SEFAZ não vem do fundo: é a rubrica "Bonificação por desempenho", paga pela folha, e aparece na ficha de cada pessoa. Na PGE a folha é paga em bloco (o favorecido é a própria folha), então só há séries e componentes; o pagamento nominal está em Informações a solicitar. A leitura da execução confere o término de cada download e repete a fatia que falhar.

Privacidade. A ficha e a lista de pagamentos por fundos expõem nomes e a composição da folha de agentes públicos, a partir de fontes públicas (Portal da Transparência e SIGEFES). Valem os mesmos cuidados já descritos em Vínculos políticos: repositório público, endereço ainda não divulgado.

### Atribuição do pago a órgãos: regra determinística

O pago de cada fornecedor (SIGEFES) é atribuído ao órgão do SIGA pela unidade gestora (UG) que pagou. A UG de cada empenho é a que mais movimentou valor nele (em empate, a de menor código), e cada UG é associada ao órgão do SIGA que tem a maioria dos empenhos de contratos pagos por ela. Em empate de votos, vale o órgão cujo nome é o da própria UG; sem isso, a UG fica sem órgão: seus pagamentos continuam contando por fornecedor, mas não são atribuídos a nenhum órgão (8 UGs hoje). Antes, o desempate dependia da ordem de iteração de um conjunto do Python e da ordem de chegada das fatias de download, e o resultado mudava entre execuções (diferenças de até R$ 170 milhões por órgão e de R$ 0,4 bilhão no pago atribuído). Agora duas execuções com sementes diferentes geram arquivos idênticos. As leituras da execução também conferem o fim de cada download e repetem a fatia que falhar.

### Fundos

Painel Fundos (módulo `fundos`, dados em `data/fundos/`, gerados por `pipeline/fundos/`). Pergunta que ele ajuda a responder: onde o Estado tem margem para realocar recursos de fundos para outras políticas e onde não tem. O foco é de propósito estreito. A lista traz, por fundo, o pago no último ano e no ano corrente, o saldo e uma "margem aparente". A página de cada fundo tem três blocos: para onde foram os pagamentos (do maior para o menor valor, por favorecido ou por ação do orçamento, por ano), o saldo (caixa, comprometido e disponível) e um quadro único da lei, com como o fundo foi criado, para que serve, como é financiado, o nível de margem do gasto e o link para o texto legal.

Escopo. Ficam dentro os fundos de unidades gestoras com "FUNDO" no nome (37 com pagamento ou arrecadação entre 2024 e 2026), inclusive o Fundo Soberano, porque o Estado pode mudar essa política. Ficam fora, com nota e motivo na própria tela, os fundos previdenciários (Financeiro, Previdenciário e de Proteção Social dos Militares: benefício devido por lei), o Fundo Estadual de Saúde (aplicação mínima constitucional e transferências do SUS) e os fundos do Judiciário, do Ministério Público e da Defensoria (outros Poderes e órgãos autônomos). A lista de exclusões está em `FORA` de `pipeline/fundos/montar.py`. Fundos executados pela unidade gestora do próprio órgão não têm "FUNDO" no nome e não entram.

Dados e scripts. `execucao_fundos.py` lê a despesa (SIGEFES) em fatias de bytes, como o pipeline de contratos, e guarda em `.cache/fundos/exec_<ano>.json` o empenhado, o liquidado, o pago e os restos a pagar pagos por mês, grupo de despesa, elemento, fonte de recursos e modalidade de aplicação, mais programas e ações e os favorecidos que são empresas ou órgãos (CPF não é lido; o que não é empresa nem órgão aparece somado como "pessoas físicas e pagamentos sem empresa ou órgão identificado"). `receita_fundos.py` faz o mesmo com as receitas. `montar.py` combina tudo e grava `data/fundos/index.json` (resumo) e `data/fundos/f/<ug>.json` (detalhe, carregado ao abrir o fundo). Valor = pago mais restos a pagar pagos; os anos são 2024, 2025 e 2026 até o último mês com pagamento. Uso: `python3 -I pipeline/fundos/execucao_fundos.py`, depois `receita_fundos.py`, `saldos_tcees.py` e `montar.py`.

Margem aparente. É uma leitura automática com três valores (maior, a verificar, menor) que combina a origem do dinheiro que o fundo pagou no último ano completo (fonte de recursos do SIGEFES: Tesouro sem vinculação, transferência federal, royalties, receita própria) com o que a lei diz sobre o saldo (campo `reversao` do cadastro). Os limiares estão em `LIMIAR` e a regra em `leitura()` de `montar.py`; é um ponto de partida para as perguntas, não uma conclusão. O Fundo Soberano tem leitura manual (`LEITURA_MANUAL`), porque os royalties que ele recebe são do Estado e a política de poupança muda por lei complementar do próprio Estado.

Base legal (`pipeline/fundos/cadastro.json`). Levantada à mão, fundo a fundo, em fontes oficiais (sites das secretarias gestoras, Diário Oficial, legislação consolidada), com o texto aberto e conferido sempre que possível. Cada fundo traz a lei de criação e as alterações, a finalidade, as receitas previstas, quem administra, o que a lei diz sobre vinculação, saldo e quem pode alterar, os links dos textos que foram abertos, o nível de confiança do levantamento (alta, média ou baixa) e o que ficou por confirmar. O campo `reversao` é a leitura do painel sobre o saldo: `permite` (a lei do fundo ou a LC 947/2020 permite reverter o superávit financeiro ao Tesouro de forma desvinculada, exceto recursos vinculados por Constituição, lei federal, convênio ou operação de crédito), `nao` (o saldo fica no fundo), `condicionada` ou `informa` (a lei não trata). O portal da Assembleia Legislativa esteve inacessível durante o levantamento, então parte dos textos veio de cópias em sites de apoio; o painel mostra a confiança e as lacunas, e a conferência final cabe à PGE.

Saldo. Vem do balancete contábil que o Estado remete ao TCE-ES (CidadES), publicado no portal de dados abertos como "[TCEES] Informações Patrimoniais - Controle Externo" (arquivos semestrais, saldo de cada conta por unidade gestora e mês; dado declaratório). `saldos_tcees.py` lê esses arquivos e, para cada fundo, guarda o caixa e equivalentes de caixa (contas 1.1.1), o saldo disponível (conta 8.2.1.1.1, "recursos disponíveis para o exercício", que é o caixa depois dos compromissos e equivale ao superávit financeiro: ativo financeiro menos passivo financeiro), o que está comprometido por empenhos a liquidar (8.2.1.1.2) e por demais obrigações (8.2.1.1.3), em dezembro de 2024, dezembro de 2025 e no último mês disponível. Conferência: no Fundo Soberano, o saldo disponível de junho de 2026 (R$ 1.812.525.506,59) coincide ao centavo com o superávit financeiro do balanço publicado pelo próprio fundo (`pipeline/fundos/saldos.json`, com o link do relatório), e a identidade caixa menos compromissos igual a saldo disponível fecha em todos os fundos, exceto no Soberano, onde o ativo financeiro inclui aplicações de longo prazo. O arquivo traz o nome da unidade gestora e não o código, então a correspondência com o código do SIGEFES está em `NOMES` no script. O que o dado não traz é o saldo por fonte de recursos (parte livre e parte vinculada), que decide o quanto pode ser realocado; está em Informações a solicitar. O SICONFI (Tesouro Nacional) não ajuda aqui: as declarações são consolidadas por ente, não por fundo. Como pano de fundo, a lista traz, recolhida, a disponibilidade de caixa do Estado por tipo de recurso, do Anexo 5 do Relatório de Gestão Fiscal (`pipeline/fundos/rgf.json`, transcrito do PDF, com o link); ela não separa fundo por fundo. O pedido do saldo por fonte de recursos, o das transferências financeiras do Tesouro e o de parecer da PGE sobre vinculação estão em Informações a solicitar.
