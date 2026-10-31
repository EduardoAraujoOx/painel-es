#!/usr/bin/env python3
"""
Cruzamento dos atos do Diário Oficial com o cadastro de contratos (SIGA) e com o Portal de Obras (módulo `atos`).

Para cada ato de contrato lido do Diário (data/atos/index.json: paralisação, suspensão, rescisão, anulação...), procura o contrato citado no título
(código do SIGA "2025.000105.32101.01", ou "CT094-2024", "Contrato 061.2021", "CONT. 25-2025", com o órgão para desambiguar) no cadastro de contratos do
SIGA e, se for obra paralisada ou rescindida, no Portal de Obras (data/obras/index.json). Grava data/atos/cruzamento.json com, por ato, o que cada fonte
registra e uma leitura: o SIGA já registra o ato, ainda não registra (o contrato consta como "em execução" ou "publicado") ou não encontrou o contrato.

É o que mostra onde o Diário antecipa o cadastro: a data do ato vem do Diário; o SIGA não informa a data da suspensão.

Uso (sem dependências externas; baixa só os arquivos anuais do SIGA que os atos citam):
  python3 -I pipeline/cruzamento/cruzar.py             # cruza e grava
  python3 -I pipeline/cruzamento/cruzar.py --dry-run   # só mostra o resumo
"""

import argparse
import importlib.util
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ATOS = RAIZ / "data" / "atos" / "index.json"
OBRAS = RAIZ / "data" / "obras" / "index.json"
SAIDA = RAIZ / "data" / "atos" / "cruzamento.json"
ANO_MIN = 2016
ESPERADO = {"paralisacao": "suspenso", "suspensao": "suspenso", "rescisao": "rescindido", "anulacao": "anulado"}  # categoria que o SIGA teria se já registrasse o ato
TIPOS_CONTRATO = {"contrato", "carta contrato", "carta-contrato"}
IGNORAR_NO_ORGAO = {"secretaria", "estado", "de", "da", "do", "dos", "das", "e", "em", "departamento", "instituto", "fundacao", "companhia", "o", "a"}


def _suspensos():
    """Reaproveita o download e a leitura do SIGA do detector de contratos suspensos."""
    spec = importlib.util.spec_from_file_location("suspensos_siga", RAIZ / "pipeline" / "contratos" / "suspensos.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def normalizar(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


def agora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


CODIGO = re.compile(r"\b(\d{4})\.(\d{6})\.(\d{5})\.(\d{2})\b")
NUMANO = [re.compile(p, re.I) for p in (
    r"\bCT\s*0*(\d{1,5})\s*[-/.]\s*(\d{4})\b",
    r"\bcontrato\s*(?:n[ºo°.]*\s*)?0*(\d{1,5})\s*[-/.]\s*(\d{4})\b",
    r"\bcont\.?\s*0*(\d{1,5})\s*[-/]\s*(\d{4})\b",
    r"\bTO\s*(?:n[ºo°.]*\s*)?0*(\d{1,5})\s*[-/.]\s*(\d{4})\b",
)]


def referencias(titulo):
    """Códigos do SIGA e pares (número, ano) citados no título do ato."""
    codigos = [m.group(0) for m in CODIGO.finditer(titulo)]
    sem_codigos = CODIGO.sub(" ", titulo)
    pares = []
    for padrao in NUMANO:
        for m in padrao.finditer(sem_codigos):
            par = (int(m.group(1)), int(m.group(2)))
            if 2000 <= par[1] <= 2100 and par not in pares:
                pares.append(par)
    return codigos, pares


# palavras de título de ato que não são nome de empresa
GENERICAS = set("""extrato contrato contratos termo termos aditivo aditivos rescisao distrato unilateral amigavel paralisacao ordem anulacao suspensao vigencia prazo
publicacao processo errata dio segundo primeiro terceiro quarto quinto ata arp cancelamento cont resumo minuta cooperacao""".split())


# sufixos legais e palavras genéricas de razão social: não identificam a empresa ("LTDA" não faz duas empresas serem a mesma)
GENERICAS_EMPRESA = set("""ltda eireli epp mei sociedade anonima limitada individual microempresa empresa empresas comercio comercial servico servicos industria industrial
construcoes construcao construtora engenharia consultoria tecnologia tecnologias treinamento treinamentos solucoes solucao distribuidora materiais equipamentos saude medica
medicos hospitalar projetos gestao brasil brasileira nacional grupo associados participacoes instituto associacao fundacao cooperativa companhia transportes transporte
locacao locacoes representacoes assessoria sistemas informatica eventos educacional educacao ambiental ambientais capixaba espirito santo""".split())


def tokens_nome(s):
    """Palavras que identificam uma empresa: sem sufixo legal, sem termo genérico de razão social, sem palavras de ato."""
    return {w for w in re.findall(r"[a-z]+", normalizar(s)) if len(w) >= 3 and w not in GENERICAS_EMPRESA and w not in GENERICAS}


def nomes_no_titulo(titulo):
    """Tokens dos trechos do título que parecem nome de empresa (separados por ' - ', sem número de contrato e sem só palavras de ato)."""
    toks = set()
    for seg in re.split(r"\s+-\s+", titulo):
        if re.search(r"\d", seg):
            continue  # trecho com número (contrato, processo, ata): não é nome
        toks |= tokens_nome(seg)
    return toks


def tokens_orgao(s):
    return {t for t in re.findall(r"[a-z0-9]+", normalizar(s)) if t not in IGNORAR_NO_ORGAO and len(t) > 2}


def similaridade(a, b):
    ta, tb = tokens_orgao(a), tokens_orgao(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def numero_ano_do_siga(doc):
    """(número, ano) de um NumeroDocumento do SIGA: 'Contrato 2024.000094.42101.01/2024' ou 'CONTRATO/SEAG/00025/2021'."""
    m = re.search(r"\d{4}\.(\d{6})\.\d{5}\.\d{2}/(\d{4})\s*$", doc or "")
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"/0*(\d+)/(\d{4})\s*$", doc or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def indexar_siga(linhas):
    """Índices só de contratos (não de autorizações de compra, empenhos ou ordens de serviço): por código e por (número, ano)."""
    por_codigo, por_par = {}, {}
    for r in linhas:
        if normalizar(r.get("TipoDocumento")) not in TIPOS_CONTRATO:
            continue
        doc = r.get("NumeroDocumento") or ""
        m = CODIGO.search(doc)
        if m:
            por_codigo.setdefault(m.group(0), []).append(r)
        par = numero_ano_do_siga(doc)
        if par:
            por_par.setdefault(par, []).append(r)
    return por_codigo, por_par


def melhor_por_orgao(candidatos, orgao, nome_orgao, titulo=""):
    """Entre candidatos de mesmo número e ano, o de órgão mais parecido com o do ato (e, empatando, o de fornecedor citado no título). None se ambíguo."""
    if not candidatos:
        return None
    pont = []
    for c in candidatos:
        s = similaridade(orgao, nome_orgao(c))
        tit = normalizar(titulo)
        forn = sorted(tokens_nome(c.get("Fornecedor", "") if isinstance(c, dict) else ""))[:2]
        bonus = 0.25 if forn and all(t in tit for t in forn) else 0.0
        pont.append((s + bonus, s, c))
    pont.sort(key=lambda x: -x[0])
    if pont[0][1] < 0.34:
        return None  # nenhum candidato de órgão compatível
    if len(pont) > 1 and pont[0][0] - pont[1][0] < 0.15:
        return None  # empate: não adivinha
    return pont[0][2]


def casar_siga(ato, por_codigo, por_par, categoria_fn, valor_fn):
    codigos, pares = referencias(ato["titulo"])
    achado, como = None, None
    for cod in codigos:
        cands = por_codigo.get(cod, [])
        if len(cands) == 1:
            achado, como = cands[0], "código do contrato"
            break
    if achado is None:
        nomes = nomes_no_titulo(ato["titulo"])
        for par in pares:
            c = melhor_por_orgao(por_par.get(par, []), ato["orgao"], lambda r: r.get("NomeOrgao", ""), ato["titulo"])
            if c and nomes:
                # o título cita uma empresa: o contrato achado por número, ano e órgão só vale se for a mesma empresa (senão é outro contrato)
                forn = tokens_nome(c.get("Fornecedor", ""))
                if not (forn & nomes):
                    c = None
            if c:
                achado, como = c, "número e ano, com o órgão"
                break
    if achado is None:
        return None
    return {"documento": achado.get("NumeroDocumento", "").strip(), "fornecedor": (achado.get("Fornecedor") or "").strip(), "orgao": (achado.get("NomeOrgao") or "").strip(),
            "situacao": (achado.get("Situacao") or "").strip(), "categoria": categoria_fn(achado.get("Situacao")), "valor": valor_fn(achado.get("ValorInicial")),
            "celebracao": _data(achado.get("DataCelebracao")), "objeto": re.sub(r"\s+", " ", achado.get("Objeto") or "").strip()[:200], "como": como}


def _data(s):
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def casar_obras(ato, obras):
    """Obra paralisada ou rescindida do Portal de Obras com o mesmo número e ano de contrato e órgão compatível."""
    _, pares = referencias(ato["titulo"])
    for n, ano in pares:
        cands = []
        for o in obras:
            m = re.match(r"\s*0*(\d+)\s*/\s*(\d{4})", o.get("contrato") or "")
            if m and (int(m.group(1)), int(m.group(2))) == (n, ano):
                cands.append(o)
        c = melhor_por_orgao(cands, ato["orgao"], lambda o: o.get("orgao", ""))
        if c:
            return {"id": c["id"], "tipo": c["tipo"], "data_situacao": c["data_situacao"], "url": c.get("url")}
    return None


def leitura(ato, siga):
    """O SIGA já registra o ato? 'registrado', 'nao_registrado' (o contrato consta com outra situação), 'nao_encontrado' ou None (tipo sem leitura)."""
    esperado = ESPERADO.get(ato["tipo"])
    if esperado is None:
        return None
    if not siga:
        return "nao_encontrado"
    return "registrado" if siga["categoria"] == esperado else "nao_registrado"


def cruzar(atos, linhas_siga, obras, categoria_fn, valor_fn):
    por_codigo, por_par = indexar_siga(linhas_siga)
    saida = {}
    for a in atos:
        s = casar_siga(a, por_codigo, por_par, categoria_fn, valor_fn)
        saida[a["id"]] = {"siga": s, "leitura": leitura(a, s), "obras": casar_obras(a, obras) if obras else None}
    return saida


def anos_necessarios(atos):
    anos = set()
    for a in atos:
        codigos, pares = referencias(a["titulo"])
        anos |= {int(c[:4]) for c in codigos} | {ano for _, ano in pares}
    return sorted({y for ano in anos for y in (ano, ano + 1) if ANO_MIN <= y <= agora().year})


def resumo(cruz):
    r = {"total": len(cruz), "com_siga": sum(1 for v in cruz.values() if v["siga"]), "registrado": 0, "nao_registrado": 0, "nao_encontrado": 0}
    for v in cruz.values():
        if v["leitura"] in ("registrado", "nao_registrado", "nao_encontrado"):
            r[v["leitura"]] += 1
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not ATOS.exists():
        sys.exit("sem data/atos/index.json: nada a cruzar")
    atos = json.loads(ATOS.read_text(encoding="utf-8")).get("itens", [])
    if not atos:
        sys.exit("nenhum ato no Diário: nada a cruzar")
    obras = []
    if OBRAS.exists():
        try:
            obras = json.loads(OBRAS.read_text(encoding="utf-8")).get("itens", [])
        except ValueError:
            obras = []
    S = _suspensos()
    anos = anos_necessarios(atos)
    try:
        recursos = json.loads(S.baixar(S.PACOTE))["result"]["resources"]
    except (RuntimeError, ValueError, KeyError) as e:
        sys.exit(f"pacote do SIGA indisponível ({str(e)[:100]}): nada foi alterado")
    alvo = {}
    for r in recursos:
        m = re.match(r"Contratos-(20\d\d)\.csv$", r["name"])
        if m and int(m.group(1)) in anos:
            alvo[int(m.group(1))] = r["url"]
    linhas, falhas = [], []
    for ano, url in sorted(alvo.items()):
        try:
            linhas.extend(S.ler_csv(S.baixar(url), ano))
        except RuntimeError as e:
            falhas.append(ano)
            print(f"FALHA em {ano}: {str(e)[:100]}")
    if falhas or not linhas:
        sys.exit(f"arquivos do SIGA não baixaram ({', '.join(map(str, falhas)) or 'nenhum'}): nada foi alterado, para não confundir falha com ausência")
    cruz = cruzar(atos, linhas, obras, S.categoria, S.valor_br)
    r = resumo(cruz)
    print(f"{r['total']} atos cruzados com {len(linhas)} contratos do SIGA (anos {anos[0]}-{anos[-1]}) e {len(obras)} obras do portal: "
          f"{r['com_siga']} localizados no SIGA; SIGA já registra {r['registrado']}, ainda não registra {r['nao_registrado']}, não encontrou {r['nao_encontrado']}")
    por_id = {a["id"]: a for a in atos}
    for i, v in cruz.items():
        if v["leitura"] in ("nao_registrado", "registrado"):
            a = por_id[i]
            print(f"  {a['data']} [{a['tipo']:12}] {v['leitura']:15} | SIGA: {v['siga']['situacao'][:34]:34} | {v['siga']['fornecedor'][:28]} | {a['titulo'][:50]}")
    if args.dry_run:
        return
    saida = {"gerado_em": iso(agora()), "resumo": r, "itens": cruz}
    antigo = None
    if SAIDA.exists():
        try:
            antigo = json.loads(SAIDA.read_text(encoding="utf-8"))
        except ValueError:
            antigo = None
    if antigo and antigo.get("itens") == cruz:
        print("sem mudanças: o arquivo não foi alterado")
        return
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gravado: {SAIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
