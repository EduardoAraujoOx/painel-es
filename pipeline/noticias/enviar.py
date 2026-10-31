#!/usr/bin/env python3
"""
Resumo das notícias por e-mail (módulo `noticias`).

Lê data/noticias/index.json, junta as notícias que apareceram desde o último envio, agrupa por
tema e manda um e-mail (HTML com versão em texto) a cada destinatário, um por vez, para que um
não veja o endereço do outro. Se não houver notícia nova, não envia nada.

Configuração por variáveis de ambiente (segredos do GitHub no Action; nada disso vai para o repositório):
  NOTICIAS_DESTINATARIOS  endereços separados por vírgula ou ponto e vírgula
  SMTP_USUARIO, SMTP_SENHA, SMTP_HOST (padrão smtp.gmail.com), SMTP_PORTA (padrão 587)
  SMTP_REMETENTE          opcional; padrão é o próprio SMTP_USUARIO
  PAINEL_URL              opcional; endereço do painel no botão "Abrir o painel" (padrão: https://painel-es.vercel.app)
Sem SMTP_USUARIO, SMTP_SENHA ou destinatários, o envio fica desativado e o script sai sem erro.

Uso (sem dependências externas):
  python3 -I pipeline/noticias/enviar.py                       # envia o que for novo e guarda o marco do envio
  python3 -I pipeline/noticias/enviar.py --prever resumo.html  # só grava o HTML do resumo, sem enviar
  python3 -I pipeline/noticias/enviar.py --teste               # envia as últimas 24 horas, sem guardar o marco
  python3 -I pipeline/noticias/enviar.py --devido              # imprime sim/nao: já passou um horário de resumo sem envio?
"""

import argparse
import html
import json
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "data" / "noticias" / "index.json"
MARCO = RAIZ / "data" / "noticias" / "ultimo-envio.json"
SUSPENSOS = RAIZ / "data" / "suspensos" / "index.json"
ATOS = RAIZ / "data" / "atos" / "index.json"
BRASILIA = timezone(timedelta(hours=-3))  # sem horário de verão desde 2019
ORDEM = ["restricao", "transicao", "financas", "contratos", "pessoal", "controle", "governador"]
MAX_ITENS = 40
COR = "#b3365f"
PAINEL_PADRAO = "https://painel-es.vercel.app"


def agora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def lido(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def carregar_marco():
    try:
        return lido(json.loads(MARCO.read_text(encoding="utf-8"))["ultimo_envio"])
    except (OSError, ValueError, KeyError):
        return None


HORARIOS_RESUMO = ((11, 17), (15, 17), (21, 17))  # UTC: 08h17, 12h17 e 18h17 em Brasília


def resumo_devido(marco, ref):
    """Há um horário de resumo já passado sem envio depois dele? Assim, se o GitHub pular o horário, a próxima coleta do dia envia."""
    passados = [datetime(d.year, d.month, d.day, h, m, tzinfo=timezone.utc) for d in (ref - timedelta(days=1), ref) for h, m in HORARIOS_RESUMO]
    ultimo = max(p for p in passados if p <= ref)
    return marco is None or marco < ultimo


def selecionar(itens, desde):
    """Notícias vistas pela coleta depois de `desde`, da mais recente para a mais antiga."""
    novos = [i for i in itens if lido(i["coletado_em"]) > desde and not i.get("possivel")]
    return sorted(novos, key=lambda i: (i["data"], i["id"]), reverse=True)


ROTULO_CONTRATO = {"suspenso": "Suspenso", "rescindido": "Rescindido", "anulado": "Anulado ou revogado"}


def contratos_novos(desde):
    """Contratos que o detector viu suspensos, rescindidos ou anulados depois de `desde` (módulo suspensos). Sem o arquivo, lista vazia."""
    try:
        d = json.loads(SUSPENSOS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    novos = [i for i in d.get("itens", []) if i.get("visto_em") and lido(i["visto_em"]) > desde]
    return sorted(novos, key=lambda i: (i["categoria"] != "suspenso", -(i.get("valor_final") or i.get("valor_inicial") or 0)))


ROTULO_ATO = {"paralisacao": "Paralisação", "suspensao": "Suspensão", "rescisao": "Rescisão", "cancelamento": "Cancelamento", "anulacao": "Anulação ou revogação"}


def atos_novos(desde):
    """Atos de contrato que o coletor do Diário Oficial viu depois de `desde` (módulo atos). Sem o arquivo, lista vazia."""
    try:
        d = json.loads(ATOS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    novos = [i for i in d.get("itens", []) if i.get("visto_em") and lido(i["visto_em"]) > desde]
    return sorted(novos, key=lambda i: (i["data"], i["id"]), reverse=True)


def valor_curto(v):
    if not v:
        return "valor não informado"
    return f"R$ {v / 1e6:.1f} mi".replace(".", ",") if v >= 1e6 else f"R$ {v / 1e3:.0f} mil" if v >= 1e3 else f"R$ {v:.0f}"


def agrupar(itens, temas):
    """Cada notícia aparece uma vez, no tema de maior prioridade; quem não tem tema vai para 'Outras'."""
    grupos = {t: [] for t in ORDEM}
    grupos["outras"] = []
    for i in itens:
        tema = next((t for t in ORDEM if t in i["temas"]), "outras")
        grupos[tema].append(i)
    rotulos = {**temas, "outras": "Outras notícias do governo"}
    return [(rotulos.get(t, t), lista) for t, lista in grupos.items() if lista]


def hora_brasilia(iso_s, ref):
    """Só a hora, se for do mesmo dia do resumo; com a data, se for de outro dia."""
    d = lido(iso_s).astimezone(BRASILIA)
    return d.strftime("%H:%M") if d.date() == ref.astimezone(BRASILIA).date() else d.strftime("%d/%m %H:%M")


def periodo(ref):
    h = ref.astimezone(BRASILIA)
    return f"{'manhã' if h.hour < 12 else 'tarde'} de {h.strftime('%d/%m')}"


def assunto(n, ref, teste, nc=0, na=0):
    partes = []
    if n or not (nc or na):
        partes.append(f"{n} {'notícia nova' if n == 1 else 'notícias novas'}")
    if nc:
        partes.append(f"{nc} {'contrato suspenso, rescindido ou anulado' if nc == 1 else 'contratos suspensos, rescindidos ou anulados'}")
    if na:
        partes.append(f"{na} {'ato de contrato no Diário Oficial' if na == 1 else 'atos de contrato no Diário Oficial'}")
    return f"{'[TESTE] ' if teste else ''}Governo e transição no ES: {' e '.join(partes)}, {periodo(ref)}"


def link_seguro(u):
    return u if re.match(r"^https?://", u or "", re.I) else ""


def data_br(iso_dia):
    return "/".join(reversed((iso_dia or "").split("-")))


def montar_html(grupos, total, restantes, ref, painel_url, desde_txt, contratos=(), atos=()):
    e = html.escape
    blocos = []
    if atos:
        linhas = []
        for a in atos[:15]:
            href = link_seguro(a["url"])
            titulo = f'<a href="{e(href, quote=True)}" style="color:#111;text-decoration:none">{e(a["titulo"][:170])}</a>' if href else e(a["titulo"][:170])
            linhas.append(f'<tr><td style="padding:9px 0;border-bottom:1px solid #eee">'
                          f'<div style="font:600 15px/1.35 Georgia,\'Times New Roman\',serif;color:#111">{titulo}</div>'
                          f'<div style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#666;margin-top:2px"><b style="color:#b32424">{e(ROTULO_ATO.get(a["tipo"], a["tipo"]))}</b> · {e(a["orgao"])} · publicado em {data_br(a["data"])}</div>'
                          f'</td></tr>')
        blocos.append(f'<tr><td style="padding:18px 0 4px;font:700 12px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#b32424">'
                      f'Atos de contrato no Diário Oficial ({len(atos)})</td></tr>' + "".join(linhas)
                      + (f'<tr><td style="padding:8px 0;font:12px Arial,Helvetica,sans-serif;color:#666">E mais {len(atos) - 15} no painel.</td></tr>' if len(atos) > 15 else ""))
    if contratos:
        linhas = [f'<tr><td style="padding:9px 0;border-bottom:1px solid #eee">'
                  f'<div style="font:600 15px/1.35 Georgia,\'Times New Roman\',serif;color:#111">{e(c["fornecedor"] or "Fornecedor não informado")} · {e(c["orgao"])}</div>'
                  f'<div style="font:13px/1.45 Arial,Helvetica,sans-serif;color:#444;margin-top:2px">{e(c["objeto"][:160])}</div>'
                  f'<div style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#666;margin-top:2px"><b style="color:#b32424">{e(ROTULO_CONTRATO[c["categoria"]])}</b> · {e(c.get("tipo") or "Instrumento")} · {e(valor_curto(c.get("valor_final") or c.get("valor_inicial")))}</div>'
                  f'</td></tr>' for c in contratos[:15]]
        blocos.append(f'<tr><td style="padding:18px 0 4px;font:700 12px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#b32424">'
                      f'Contratos suspensos, rescindidos ou anulados ({len(contratos)})</td></tr>' + "".join(linhas)
                      + (f'<tr><td style="padding:8px 0;font:12px Arial,Helvetica,sans-serif;color:#666">E mais {len(contratos) - 15} no painel.</td></tr>' if len(contratos) > 15 else ""))
    for rotulo, lista in grupos:
        linhas = []
        for i in lista:
            href = link_seguro(i["url"])
            titulo = f'<a href="{e(href, quote=True)}" style="color:#111;text-decoration:none">{e(i["titulo"])}</a>' if href else e(i["titulo"])
            linhas.append(
                f'<tr><td style="padding:9px 0;border-bottom:1px solid #eee">'
                f'<div style="font:600 16px/1.35 Georgia,\'Times New Roman\',serif;color:#111">{titulo}</div>'
                f'<div style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#666;margin-top:2px">{e(i["veiculo"])} · {hora_brasilia(i["data"], ref)}</div>'
                f'</td></tr>')
        blocos.append(
            f'<tr><td style="padding:18px 0 4px;font:700 12px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.08em;'
            f'text-transform:uppercase;color:{COR}">{e(rotulo)} ({len(lista)})</td></tr>' + "".join(linhas))
    mais = (f'<tr><td style="padding:14px 0;font:14px/1.5 Arial,Helvetica,sans-serif;color:#444">'
            f'E mais {restantes} {"notícia" if restantes == 1 else "notícias"} no painel.</td></tr>') if restantes else ""
    botao = (f'<tr><td style="padding:18px 0 6px"><a href="{e(painel_url, quote=True)}" style="display:inline-block;background:{COR};color:#fff;'
             f'font:600 14px Arial,Helvetica,sans-serif;padding:10px 18px;border-radius:6px;text-decoration:none">Abrir o painel</a></td></tr>') if painel_url else ""
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f3ef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-top:4px solid {COR}"><tr><td style="padding:22px 26px 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font:700 26px/1.1 Georgia,'Times New Roman',serif;color:#111">Governo e transição no ES</td></tr>
<tr><td style="padding-top:6px;font:13px/1.5 Arial,Helvetica,sans-serif;color:#666">Painel Fiscal · análise para a transição. {f"{total} " + ("notícia nova" if total == 1 else "notícias novas") if total else "Nenhuma notícia nova"} {e(desde_txt)}{f", e {len(contratos)} " + ("contrato com mudança de situação" if len(contratos) == 1 else "contratos com mudança de situação") if contratos else ""}{f", e {len(atos)} " + ("ato de contrato no Diário Oficial" if len(atos) == 1 else "atos de contrato no Diário Oficial") if atos else ""}.</td></tr>
{botao}
{"".join(blocos)}
{mais}
<tr><td style="padding-top:20px;border-top:1px solid #ddd;font:12px/1.5 Arial,Helvetica,sans-serif;color:#888">
Triagem automática por palavras no título: indica onde olhar e pode errar. Os links levam à matéria no site do veículo.
Para sair desta lista ou incluir alguém, fale com Eduardo Araújo.</td></tr>
</table></td></tr></table></td></tr></table></body></html>"""


def montar_texto(grupos, total, restantes, ref, painel_url, desde_txt, contratos=(), atos=()):
    out = [f"Governo e transição no ES\n{(str(total) + ' ' + ('notícia nova' if total == 1 else 'notícias novas')) if total else 'Nenhuma notícia nova'} {desde_txt}.\n"]
    if painel_url:
        out.append(f"Painel: {painel_url}\n")
    if atos:
        out.append(f"\nATOS DE CONTRATO NO DIÁRIO OFICIAL ({len(atos)})")
        for a in atos[:15]:
            out.append(f"- {a['titulo'][:170]}\n  {ROTULO_ATO.get(a['tipo'], a['tipo'])} · {a['orgao']} · publicado em {data_br(a['data'])}\n  {link_seguro(a['url'])}")
    if contratos:
        out.append(f"\nCONTRATOS SUSPENSOS, RESCINDIDOS OU ANULADOS ({len(contratos)})")
        for c in contratos[:15]:
            out.append(f"- {c['fornecedor'] or 'Fornecedor não informado'} · {c['orgao']}\n  {c['objeto'][:160]}\n  {ROTULO_CONTRATO[c['categoria']]} · {c.get('tipo') or 'Instrumento'} · {valor_curto(c.get('valor_final') or c.get('valor_inicial'))}")
    for rotulo, lista in grupos:
        out.append(f"\n{rotulo.upper()} ({len(lista)})")
        for i in lista:
            out.append(f"- {i['titulo']}\n  {i['veiculo']} · {hora_brasilia(i['data'], ref)}\n  {link_seguro(i['url'])}")
    if restantes:
        out.append(f"\nE mais {restantes} no painel.")
    out.append("\n--\nTriagem automática por palavras no título: indica onde olhar e pode errar. Para sair da lista, fale com Eduardo Araújo.")
    return "\n".join(out)


def montar_conteudo(dados, itens, ref, painel_url, desde_txt, contratos=(), atos=()):
    escolhidos = itens[:MAX_ITENS]
    restantes = len(itens) - len(escolhidos)
    grupos = agrupar(escolhidos, dados["temas"])
    return (montar_html(grupos, len(itens), restantes, ref, painel_url, desde_txt, contratos, atos),
            montar_texto(grupos, len(itens), restantes, ref, painel_url, desde_txt, contratos, atos))


def destinatarios(bruto):
    achados = [x.strip() for x in re.split(r"[,;\s]+", bruto or "") if x.strip()]
    validos, vistos = [], set()
    for x in achados:
        if re.fullmatch(r"[^@\s<>\",]+@[^@\s<>\",]+\.[^@\s<>\",]+", x) and x.lower() not in vistos:
            vistos.add(x.lower())
            validos.append(x)
    return validos


def enviar(msgs, host, porta, usuario, senha):
    ctx = ssl.create_default_context()
    if porta == 465:
        servidor = smtplib.SMTP_SSL(host, porta, context=ctx, timeout=60)
    else:
        servidor = smtplib.SMTP(host, porta, timeout=60)
        servidor.starttls(context=ctx)
    with servidor:
        servidor.login(usuario, senha)
        for m in msgs:
            servidor.send_message(m)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prever", metavar="ARQ.html", help="grava o HTML do resumo e sai, sem enviar")
    ap.add_argument("--teste", action="store_true", help="considera as últimas 24 horas e não guarda o marco do envio")
    ap.add_argument("--devido", action="store_true", help="só diz 'sim' ou 'nao': há horário de resumo vencido sem envio? (não envia nada)")
    args = ap.parse_args()

    ref = agora()
    marco = carregar_marco()
    if args.devido:
        print("sim" if resumo_devido(marco, ref) else "nao")
        return
    dados = json.loads(DADOS.read_text(encoding="utf-8"))
    ordenar = lambda lista: sorted(lista, key=lambda i: (i["data"], i["id"]), reverse=True)
    if args.teste or args.prever or marco is None:
        # sem marco de envio (primeiro envio, teste ou prévia): o que foi publicado nas últimas 24 horas
        desde_txt = "nas últimas 24 horas"
        desde = ref - timedelta(hours=24)
        itens = ordenar([i for i in dados["itens"] if lido(i["data"]) >= desde and not i.get("possivel")])
    else:
        desde_txt = "desde o último resumo"
        desde = marco
        itens = selecionar(dados["itens"], marco)
    contratos = contratos_novos(desde)
    atos = atos_novos(desde)
    painel = os.environ.get("PAINEL_URL", "").strip() or PAINEL_PADRAO
    corpo_html, corpo_txt = montar_conteudo(dados, itens, ref, painel if link_seguro(painel) else "", desde_txt, contratos, atos) if (itens or contratos or atos) else ("", "")

    if args.prever:
        Path(args.prever).write_text(corpo_html or "<p>Sem notícias novas.</p>", encoding="utf-8")
        print(f"{len(itens)} notícias, {len(contratos)} contratos e {len(atos)} atos do Diário no resumo; HTML gravado em {args.prever}")
        return

    usuario, senha = os.environ.get("SMTP_USUARIO", "").strip(), os.environ.get("SMTP_SENHA", "")
    lista = destinatarios(os.environ.get("NOTICIAS_DESTINATARIOS", ""))
    if not (usuario and senha and lista):
        print("envio desativado: faltam SMTP_USUARIO, SMTP_SENHA ou NOTICIAS_DESTINATARIOS (nada foi enviado)")
        return
    if not itens and not contratos and not atos:
        print("sem notícias, contratos nem atos do Diário novos desde o último resumo: nada a enviar")
        return

    remetente = os.environ.get("SMTP_REMETENTE", "").strip() or usuario
    msgs = []
    for dest in lista:
        m = EmailMessage()
        m["Subject"] = assunto(len(itens), ref, args.teste, len(contratos), len(atos))
        m["From"] = formataddr(("Painel Fiscal ES", remetente))
        m["To"] = dest
        m["Date"] = formatdate(localtime=False)
        m["Message-ID"] = make_msgid(domain=remetente.split("@")[-1])
        m.set_content(corpo_txt)
        m.add_alternative(corpo_html, subtype="html")
        msgs.append(m)
    try:
        enviar(msgs, os.environ.get("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com", int(os.environ.get("SMTP_PORTA", "587") or 587), usuario, senha)
    except (smtplib.SMTPException, OSError) as erro:
        sys.exit(f"falha no envio: {type(erro).__name__}")  # sem detalhes: a mensagem de erro pode ecoar o usuário
    print(f"resumo enviado a {len(lista)} destinatário(s): {len(itens)} notícias, {len(contratos)} contratos e {len(atos)} atos do Diário")
    if not args.teste:
        MARCO.write_text(json.dumps({"ultimo_envio": iso(ref), "noticias": len(itens), "contratos": len(contratos), "atos": len(atos)}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
