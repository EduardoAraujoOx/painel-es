#!/usr/bin/env python3
"""Saldo de cada fundo estadual a partir do balancete contábil que o Estado remete ao TCE-ES (CidadES), publicado no portal de
dados abertos como "[TCEES] Informações Patrimoniais - Controle Externo" (arquivos semestrais, saldo de cada conta contábil por
unidade gestora e mês). Os dados são declaratórios.

Para cada fundo (unidade gestora do tipo "Fundos", esfera Estado do Espírito Santo) e mês, guarda:
  caixa        caixa e equivalentes de caixa (contas 1.1.1.x, saldo devedor);
  disponivel   "recursos disponíveis para o exercício" (conta 8.2.1.1.1.xx, disponibilidade por destinação de recursos): o caixa já
               descontados os compromissos. É igual ao superávit financeiro (ativo financeiro menos passivo financeiro) e pode ser
               negativo quando os compromissos passam do caixa;
  empenhos     parte do caixa comprometida por empenhos a liquidar (conta 8.2.1.1.2.xx);
  obrigacoes   parte comprometida por demais obrigações (conta 8.2.1.1.3.xx).
Conferência: no Fundo Soberano, o "disponivel" de junho de 2026 (R$ 1.812.525.506,59) coincide ao centavo com o superávit financeiro do
balanço publicado pelo próprio fundo (ativo financeiro R$ 1.846.900.754,33 menos passivo financeiro R$ 34.375.247,74).

O arquivo traz o nome da unidade gestora, não o código; a correspondência com o código do SIGEFES está em NOMES abaixo.
Resultado: .cache/fundos/saldos.json.   Uso: python3 -I pipeline/fundos/saldos_tcees.py
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(RAIZ, ".cache", "fundos")
PACOTE = "https://dados.es.gov.br/api/3/action/package_show?id=tcees-informacoes-patrimoniais"
MESES_GUARDADOS = ("2024-12", "2025-12", "2026-06")      # além do último mês de cada arquivo mais recente

# trecho do nome da unidade gestora (sem acento, minúsculo) -> código da UG no SIGEFES
NOMES = {
    "fundo estadual de saude": "440901", "fundo especial do poder judiciario": "30901", "fundo estadual de assistencia social": "470901",
    "fundo de aparelhamento da defensoria": "60901", "fundo rotativo do sistema penitenciario": "460901", "fundo estadual de defesa do consumidor": "460904",
    "fundo de modernizacao e incentivo a cobranca": "160901", "fundo especial do ministerio publico": "50902", "fundo estadual sobre drogas": "100905",
    "fundo estadual de combate e erradicacao da pobreza": "470904", "fundo especial de reequipamento do corpo de bombeiros": "450904",
    "fundo estadual de recursos hidricos": "410902", "fundo de protecao social dos militares": "600212", "fundo estadual de seguranca publica": "450906",
    "fundo estadual de habitacao de interesse social": "360901", "fundo de cultura": "400901", "fundo estadual do trabalho": "470906",
    "fundo estadual de combate a corrupcao": "100904", "fundo estadual de ciencia e tecnologia": "320901", "fundo de protecao e defesa civil": "450905",
    "fundo de modernizacao e desenvolvimento fazendario": "220901", "fundo de fomento do turismo": "370901", "fundo especial de reequipamento da policia civil": "450901",
    "fundo de protecao ao emprego": "220904", "fundo penitenciario estadual": "460903", "fundo especial de reequipamento da policia militar": "450902",
    "fundo soberano": "220902", "fundo estadual de apoio ao desenvolvimento municipal": "100906", "fundo de defesa e desenvolvimento do meio ambiente": "410901",
    "fundo estadual dos direitos da pessoa idosa": "480902", "fundo especial de apoio ao programa estadual de desenvolvimento rural": "310903",
    "fundo de incentivo ao esporte e lazer": "390901", "fundo estadual de apoio a ampliacao e melhoria": "420901", "fundo para a infancia e adolescencia": "480901",
    "fundo de aval do microcredito": "490901", "fundo estadual para o financiamento de obras": "350903", "fundo especial para construcao, reforma e ampliacao": "350901",
    "fundo social de apoio a agricultura familiar": "310902", "fundo estadual de reparacao de interesses difusos": "50901",
    "fundo especial de apoio ao programa caminhos do campo": "310901", "fundo metropolitano de desenvolvimento": "270901",
    "fundo estadual de apoio a conservacao e manutencao das estradas": "310904", "fundo de apoio a estruturacao de projetos de parcerias": "490902",
    "fundo estadual para as juventudes": "480904",
}


def sem_acento(s):
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower().strip()


def ug_do_nome(nome):
    n = sem_acento(nome)
    achados = [(len(k), cod) for k, cod in NOMES.items() if n.startswith(k) or k in n]
    return max(achados)[1] if achados else None


def numero(s):
    s = s.strip()
    return float(s.replace(".", "").replace(",", ".")) if s else 0.0


def baixar(url, destino):
    if os.path.exists(destino):
        return
    p = subprocess.run(["curl", "-sSL", "--fail", "-m", "600", "--retry", "3", "-o", destino, url])
    if p.returncode:
        raise SystemExit(f"falha ao baixar {url}")


def main():
    os.makedirs(CACHE, exist_ok=True)
    pacote = json.loads(subprocess.run(["curl", "-sSL", "--fail", "-m", "90", PACOTE], capture_output=True, check=True).stdout)["result"]
    urls = {r["name"]: r["url"] for r in pacote["resources"] if r["name"].startswith("Patrimônio")}
    alvo = ["Patrimônio 2024 - 2º semestre", "Patrimônio 2025 - 2º semestre", "Patrimônio 2026 - 1º semestre", "Patrimônio 2026 - 2º semestre"]
    saldos = {}      # ug -> ym -> {...}
    nomes = {}
    sem_codigo = set()
    for nome in alvo:
        if nome not in urls:
            continue
        zp = os.path.join(CACHE, re.sub(r"\W+", "_", sem_acento(nome)) + ".zip")
        baixar(urls[nome], zp)
        with zipfile.ZipFile(zp) as z, z.open(z.namelist()[0]) as bruto:
            texto = io.TextIOWrapper(bruto, encoding="cp1252", errors="replace", newline="")
            linhas = csv.DictReader(texto, delimiter=";")
            for r in linhas:
                if r["NomeEsferaAdministrativa"] != "Estado do Espírito Santo" or r["TipoUnidadeGestora"] != "Fundos":
                    continue
                cod = r["CodigoCompleto"]
                if not (cod.startswith("111") or cod.startswith("8211")):
                    continue
                ug = ug_do_nome(r["NomeUnidadeGestora"])
                if not ug:
                    sem_codigo.add(r["NomeUnidadeGestora"])
                    continue
                ym = f"{r['Ano']}-{int(r['Mes']):02d}"
                v = numero(r["SaldoFinal"])
                credora = r["IdNaturezaSaldoFinal"] == "1"
                a = saldos.setdefault(ug, {}).setdefault(ym, {"caixa": 0.0, "disponivel": 0.0, "empenhos": 0.0, "obrigacoes": 0.0})
                nomes[ug] = r["NomeUnidadeGestora"].strip()
                if cod.startswith("111"):
                    a["caixa"] += -v if credora else v
                elif cod.startswith("8211"):
                    v = v if credora else -v              # conta de controle de natureza credora: positivo é saldo normal
                    if cod.startswith("82111"):
                        a["disponivel"] += v
                    elif cod.startswith("82112"):
                        a["empenhos"] += v
                    elif cod.startswith("82113"):
                        a["obrigacoes"] += v
        print(nome, "lido", flush=True)
    if sem_codigo:
        print("SEM CÓDIGO:", sorted(sem_codigo), file=sys.stderr)
    ultimo = max(ym for d in saldos.values() for ym in d)
    saida = {"fonte": "TCE-ES, Informações Patrimoniais (remessas contábeis do Estado ao CidadES; dados declaratórios)", "ultimo": ultimo, "meses": list(MESES_GUARDADOS),
             "fundos": {ug: {"nome": nomes[ug], "meses": {ym: {k: round(x, 2) for k, x in v.items()} for ym, v in sorted(d.items()) if ym in MESES_GUARDADOS or ym == ultimo}}
                        for ug, d in sorted(saldos.items())}}
    with open(os.path.join(CACHE, "saldos.json"), "w", encoding="utf-8") as fh:
        json.dump(saida, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(saldos)} fundos; último mês {ultimo}")


if __name__ == "__main__":
    main()
