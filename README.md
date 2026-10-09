# Painel Fiscal · Espírito Santo

Painel de acesso restrito para diagnósticos fiscais e de pessoal do Poder Executivo do Espírito Santo, a partir de dados abertos oficiais. Cada tema é um **módulo** (uma aba) com pipeline e dados próprios, de modo que novas pesquisas entram sem mexer nas existentes.

| Módulo | Conteúdo | Situação |
|---|---|---|
| `cargos` | Cargos em comissão e funções gratificadas: quadro, custo mensal, tempo na função, entradas e saídas | em operação |
| `organograma` | Árvore de unidades de um órgão com as pessoas de cada uma, a condição (sem vínculo efetivo, servidor de carreira, função gratificada) e a remuneração somando carreira e cargo | em operação, com a estrutura oficial de 55 órgãos |

## Módulo `cargos`

Navegação do governo para o órgão, do órgão para a função e da função para o ocupante: mapa de blocos por órgão (área proporcional ao custo mensal ou ao número de ocupantes), barras por cargo e função, série mensal de ocupantes, entradas e saídas por mês, e tabela de ocupantes com tempo na função, provimento e valor do cargo, exportável em CSV. SEFAZ e SEP aparecem em destaque.

### Fonte dos dados

Portal de Dados Abertos do ES, conjunto [Portal da Transparência — Pessoal](https://dados.es.gov.br/dataset/portal-da-transparencia-pessoal) (SEGER): folha mensal (`Remuneracoes-MM_AAAA.csv`) e base de vínculos (`VinculosServidores.csv`). O CPF vem mascarado na fonte e não é lido pelo pipeline.

**Limite de cobertura:** empresas públicas e sociedades de economia mista (Bandes, Banestes, Cesan e outras) **não constam** dessa base e exigem fonte própria.

**Escopo e qualidade:** `JUIZADO DE DIREITO` e `CGJES` (Poder Judiciário) constam da base só de out/2024 a set/2025 e são excluídos por regra (`ORGAOS_EXCLUIDOS`), para não gerar saídas fictícias. Só conta como ocupante quem tem rubrica de cargo na competência: sem isso, todo janeiro apareceriam cerca de mil comissionados fictícios (resíduos de "insuficiência de saldo" de quem foi desligado ou afastado). A classificação por rubricas foi conferida contra o tipo de vínculo oficial da base de vínculos (3.403 de 3.450 comissionados sem vínculo efetivo constam como `COMISSIONADO`; os demais não foram localizados na base de vínculos).

### Regras de cálculo (`pipeline/cargos/regras.py`)

A folha traz uma linha por rubrica; o valor do cargo é reconstruído somando só as rubricas do cargo na competência corrente. O princípio é que **valor do cargo é o que se paga por causa do cargo**; a remuneração que o servidor de carreira receberia de qualquer modo não é custo do cargo.

Para cargo em comissão: vencimento do cargo comissionado (puro ou de servidor com vínculo de origem), subsídio da função, gratificação de produtividade e gratificação especial de comissionado. Quando o servidor **opta** pelo cargo em comissão e mantém a remuneração de origem, entram só a rubrica de opção e as gratificações. O subsídio só conta quando é o subsídio padrão da função (a moda entre ocupantes sem cargo efetivo); servidor de carreira que recebe o subsídio da carreira, como um secretário que é Auditor Fiscal, fica com o valor do cargo restrito às gratificações, e o subsídio da carreira é exibido à parte, sem ser somado. Para função gratificada, entram só as rubricas "Função Gratificada". Ficam de fora 13º, férias, auxílios, descontos e ajustes de outras competências. O custo anualizado é o valor mensal × 12, sem 13º, férias e encargos.

O **tempo na função** é inferido pela primeira competência, dentro da janela extraída, em que a pessoa aparece de forma contínua na mesma função; "≤" indica que já ocupava a função na primeira competência da janela.

**Entradas e saídas** comparam cada mês com o anterior, por pessoa e tipo, dentro do órgão (mudança de órgão conta como saída num e entrada noutro).

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

## Acesso e implantação (Vercel)

Nada em `data/` é público: o arquivo só é entregue por `api/dados.js` a quem tem sessão válida. A página pública contém apenas o formulário de senha.

Variáveis de ambiente do projeto (configurar no Vercel, nunca no repositório):

| Variável | Uso |
|---|---|
| `PAINEL_SENHA` | senha compartilhada de acesso |
| `PAINEL_SEGREDO` | chave de assinatura da sessão (32+ caracteres aleatórios) |

Para trocar a senha, altere `PAINEL_SENHA` no painel do Vercel e faça um novo deploy; para derrubar todas as sessões abertas, altere também `PAINEL_SEGREDO`. A sessão dura 12 horas. O site envia `noindex`, `robots.txt` restritivo e cabeçalhos de segurança (`vercel.json`).

Teste local: `PAINEL_SENHA=x PAINEL_SEGREDO=<32+ caracteres> node dev-server.js 3000`.

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
