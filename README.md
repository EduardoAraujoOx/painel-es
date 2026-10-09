# Diagnóstico fiscal · Espírito Santo

Painel de acesso restrito para diagnosticar o quadro de **cargos em comissão** e **funções gratificadas** do Poder Executivo do Espírito Santo, a partir de dados abertos oficiais. A primeira fase cobre toda a administração direta, autarquias e fundações presentes na folha publicada; SEFAZ e SEP aparecem em destaque.

## O que o painel mostra

Do governo para o órgão, do órgão para a função e da função para o ocupante, com a mesma navegação por clique: mapa de blocos por órgão (área proporcional ao custo mensal ou ao número de ocupantes), barras por cargo e função, série mensal de ocupantes, entradas e saídas por mês, e tabela de ocupantes com tempo na função, provimento e valor do cargo, exportável em CSV.

## Fonte dos dados

Portal de Dados Abertos do ES, conjunto [Portal da Transparência — Pessoal](https://dados.es.gov.br/dataset/portal-da-transparencia-pessoal) (SEGER): folha mensal (`Remuneracoes-MM_AAAA.csv`) e base de vínculos (`VinculosServidores.csv`). O CPF vem mascarado na fonte e não é lido pelo pipeline.

**Escopo e qualidade:** `JUIZADO DE DIREITO` e `CGJES` (Poder Judiciário) constam da base só de out/2024 a set/2025 e são excluídos por regra (`ORGAOS_EXCLUIDOS`), para não gerar saídas fictícias. Só conta como ocupante quem tem rubrica de cargo na competência: sem isso, todo janeiro apareceriam cerca de mil comissionados fictícios (resíduos de "insuficiência de saldo" de quem foi desligado ou afastado). A classificação por rubricas foi conferida contra o tipo de vínculo oficial da base de vínculos (3.403 de 3.450 comissionados sem vínculo efetivo constam como `COMISSIONADO`; os demais não foram localizados na base de vínculos).

**Limite de cobertura:** empresas públicas e sociedades de economia mista (Bandes, Banestes, Cesan e outras) **não constam** dessa base e exigem fonte própria.

## Regras de cálculo (arquivo `pipeline/regras.py`)

A folha traz uma linha por rubrica; o valor do cargo é reconstruído somando só as rubricas do cargo na competência corrente.

O princípio é que **valor do cargo é o que se paga por causa do cargo**; a remuneração que o servidor de carreira receberia de qualquer modo não é custo do cargo. Para cargo em comissão: vencimento do cargo comissionado (puro ou de servidor com vínculo de origem), subsídio da função, gratificação de produtividade e gratificação especial de comissionado. Quando o servidor **opta** pelo cargo em comissão e mantém a remuneração de origem, entram só a rubrica de opção e as gratificações. O subsídio só conta quando é o subsídio padrão da função (a moda entre ocupantes sem cargo efetivo); servidor de carreira que recebe o subsídio da carreira, como um secretário que é Auditor Fiscal, fica com o valor do cargo restrito às gratificações, e o subsídio da carreira é exibido à parte, sem ser somado. Para função gratificada, entram só as rubricas "Função Gratificada". Ficam de fora 13º, férias, auxílios, descontos e ajustes de outras competências. O custo anualizado é o valor mensal × 12, sem 13º, férias e encargos.

O **tempo na função** é inferido pela primeira competência, dentro da janela extraída, em que a pessoa aparece de forma contínua na mesma função; "≤" indica que já ocupava a função na primeira competência da janela.

**Entradas e saídas** comparam cada mês com o anterior, por pessoa e tipo, dentro do órgão (mudança de órgão conta como saída num e entrada noutro).

## Como atualizar os dados

Requer Python 3.9+ e `curl`; nenhuma dependência externa.

```bash
python3 pipeline/extrair.py --meses 2024-10:2026-09 --jobs 6   # baixa em fluxo e guarda só CC/FG em .cache/
python3 pipeline/extrair_vinculos.py                            # nomes dos órgãos e vínculo oficial
GERADO_EM=$(date +%F) python3 pipeline/montar.py                # gera data/index.json e data/org/*.json
```

O cache (`.cache/`) guarda as rubricas de cada ocupante, então mudar uma regra em `regras.py` exige apenas rodar `montar.py` de novo, sem novo download. Cada mês pesa de 80 a 250 MB na origem e é lido em fluxo, sem ser gravado em disco.

## Acesso e implantação (Vercel)

Nada em `data/` é público: o arquivo só é entregue por `api/dados.js` a quem tem sessão válida. A página pública contém apenas o formulário de senha.

Variáveis de ambiente do projeto (configurar no Vercel, nunca no repositório):

| Variável | Uso |
|---|---|
| `PAINEL_SENHA` | senha compartilhada de acesso |
| `PAINEL_SEGREDO` | chave de assinatura da sessão (32+ caracteres aleatórios) |

Para trocar a senha, altere `PAINEL_SENHA` no painel do Vercel e faça um novo deploy; para derrubar todas as sessões abertas, altere também `PAINEL_SEGREDO`. A sessão dura 12 horas. O site envia `noindex`, `robots.txt` restritivo e cabeçalhos de segurança (`vercel.json`).

Teste local: `PAINEL_SENHA=x PAINEL_SEGREDO=<32+ caracteres> node dev-server.js 3000`.

## Estrutura

```
pipeline/   extração, regras de cálculo e montagem dos dados (Python, sem dependências)
api/        funções de servidor: login, entrega de dados com sessão, logout
public/     painel (HTML, CSS e JavaScript sem bibliotecas externas)
data/       dados processados, servidos só após o login
```
