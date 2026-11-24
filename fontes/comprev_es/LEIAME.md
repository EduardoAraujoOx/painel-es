# Coleta da compensacao entre regimes nos municipios do ES

Exercicio: 2025. RREO, Anexo 04, 6o bimestre. Fonte: Siconfi / Tesouro Nacional.
Entes consultados: 78. Receitas observadas: 11.
Total das receitas observadas: R$ 89,487,148.90.

**Cuidado**: o total observado nao e automaticamente o total de todos os municipios.
Ausencia do Anexo 04, ausencia da rubrica e falha de acesso sao classificadas separadamente.
As receitas reportadas podem incluir compensacao entre RPPS distintos, nao apenas transferencias liquidas do INSS.

## Contagem por situacao

- receita_observada: 11
- rreo_sem_rubrica_realizada_comprev: 2
- sem_demonstrativo_api: 65

## Municipios com receita observada

| Municipio | Receita realizada (R$) |
|:--|--:|
| Vitória | 27,376,705.44 |
| Serra | 13,940,728.07 |
| Vila Velha | 12,882,470.69 |
| Aracruz | 10,166,447.20 |
| Cachoeiro de Itapemirim | 7,528,146.61 |
| Viana | 6,880,770.35 |
| Cariacica | 4,000,070.35 |
| Conceição da Barra | 2,453,366.07 |
| Linhares | 2,448,328.08 |
| Guarapari | 1,680,179.32 |
| São José do Calçado | 129,936.72 |

## Reproducao

Executar `python pesquisas/siconfi/coletar_comprev_es.py` em ambiente com acesso HTTPS.
