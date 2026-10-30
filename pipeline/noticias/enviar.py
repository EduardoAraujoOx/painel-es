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


def selecionar(itens, desde):
    """Notícias vistas pela coleta depois de `desde`, da mais recente para a mais antiga."""
    novos = [i for i in itens if lido(i["coletado_em"]) > desde]
    return sorted(novos, key=lambda i: (i["data"], i["id"]), reverse=True)


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


def assunto(n, ref, teste):
    return f"{'[TESTE] ' if teste else ''}Governo e transição no ES: {n} {'notícia nova' if n == 1 else 'notícias novas'}, {periodo(ref)}"


def link_seguro(u):
    return u if re.match(r"^https?://", u or "", re.I) else ""


def montar_html(grupos, total, restantes, ref, painel_url, desde_txt):
    e = html.escape
    blocos = []
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
<tr><td style="padding-top:6px;font:13px/1.5 Arial,Helvetica,sans-serif;color:#666">Painel Fiscal · análise para a transição. {total} {"notícia nova" if total == 1 else "notícias novas"} {e(desde_txt)}.</td></tr>
{botao}
{"".join(blocos)}
{mais}
<tr><td style="padding-top:20px;border-top:1px solid #ddd;font:12px/1.5 Arial,Helvetica,sans-serif;color:#888">
Triagem automática por palavras no título: indica onde olhar e pode errar. Os links levam à matéria no site do veículo.
Para sair desta lista ou incluir alguém, fale com Eduardo Araújo.</td></tr>
</table></td></tr></table></td></tr></table></body></html>"""


def montar_texto(grupos, total, restantes, ref, painel_url, desde_txt):
    out = [f"Governo e transição no ES\n{total} {'notícia nova' if total == 1 else 'notícias novas'} {desde_txt}.\n"]
    if painel_url:
        out.append(f"Painel: {painel_url}\n")
    for rotulo, lista in grupos:
        out.append(f"\n{rotulo.upper()} ({len(lista)})")
        for i in lista:
            out.append(f"- {i['titulo']}\n  {i['veiculo']} · {hora_brasilia(i['data'], ref)}\n  {link_seguro(i['url'])}")
    if restantes:
        out.append(f"\nE mais {restantes} no painel.")
    out.append("\n--\nTriagem automática por palavras no título: indica onde olhar e pode errar. Para sair da lista, fale com Eduardo Araújo.")
    return "\n".join(out)


def montar_conteudo(dados, itens, ref, painel_url, desde_txt):
    escolhidos = itens[:MAX_ITENS]
    restantes = len(itens) - len(escolhidos)
    grupos = agrupar(escolhidos, dados["temas"])
    return (montar_html(grupos, len(itens), restantes, ref, painel_url, desde_txt),
            montar_texto(grupos, len(itens), restantes, ref, painel_url, desde_txt))


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
    args = ap.parse_args()

    dados = json.loads(DADOS.read_text(encoding="utf-8"))
    ref = agora()
    marco = carregar_marco()
    ordenar = lambda lista: sorted(lista, key=lambda i: (i["data"], i["id"]), reverse=True)
    if args.teste or args.prever or marco is None:
        # sem marco de envio (primeiro envio, teste ou prévia): o que foi publicado nas últimas 24 horas
        desde_txt = "nas últimas 24 horas"
        itens = ordenar([i for i in dados["itens"] if lido(i["data"]) >= ref - timedelta(hours=24)])
    else:
        desde_txt = "desde o último resumo"
        itens = selecionar(dados["itens"], marco)
    painel = os.environ.get("PAINEL_URL", "").strip() or PAINEL_PADRAO
    corpo_html, corpo_txt = montar_conteudo(dados, itens, ref, painel if link_seguro(painel) else "", desde_txt) if itens else ("", "")

    if args.prever:
        Path(args.prever).write_text(corpo_html or "<p>Sem notícias novas.</p>", encoding="utf-8")
        print(f"{len(itens)} notícias no resumo; HTML gravado em {args.prever}")
        return

    usuario, senha = os.environ.get("SMTP_USUARIO", "").strip(), os.environ.get("SMTP_SENHA", "")
    lista = destinatarios(os.environ.get("NOTICIAS_DESTINATARIOS", ""))
    if not (usuario and senha and lista):
        print("envio desativado: faltam SMTP_USUARIO, SMTP_SENHA ou NOTICIAS_DESTINATARIOS (nada foi enviado)")
        return
    if not itens:
        print("sem notícias novas desde o último resumo: nada a enviar")
        return

    remetente = os.environ.get("SMTP_REMETENTE", "").strip() or usuario
    msgs = []
    for dest in lista:
        m = EmailMessage()
        m["Subject"] = assunto(len(itens), ref, args.teste)
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
    print(f"resumo enviado a {len(lista)} destinatário(s): {len(itens)} notícias")
    if not args.teste:
        MARCO.write_text(json.dumps({"ultimo_envio": iso(ref), "noticias": len(itens)}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
