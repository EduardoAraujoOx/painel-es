#!/usr/bin/env python3
"""
Assinantes dos alertas por e-mail (cadastro pela página /alertas do painel, guardado no Supabase).

O fluxo do GitHub fala com a Edge Function "alertas" usando o token OIDC do próprio fluxo (sem segredo guardado em lugar nenhum): a função só
entrega a lista a um token assinado pelo GitHub para este repositório, no ramo main. Este módulo:
  listar()               -> {"confirmados": [{email, token_sair}], "pendentes": [{id, email, token_confirmar}]}; None sem token OIDC (execução local); RuntimeError se o token existe e a função não responde
  marcar_enviados(ids)   -> avisa a função que o e-mail de confirmação desses cadastros já foi enviado
  rodape_sair(url, tok)  -> link e texto para sair da lista, que vão em todo resumo
  enviar_confirmacoes()  -> manda o e-mail de confirmação aos pendentes (roda a cada coleta)
Sem o token OIDC (execução local, simulação de PR) nada é consultado e nada é enviado. Só biblioteca padrão.

Uso:
  python3 -I pipeline/noticias/assinantes.py            # envia as confirmações pendentes
  python3 -I pipeline/noticias/assinantes.py --dry-run  # só diz quantos há
"""

import argparse
import json
import os
import re
import smtplib
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

FUNCAO = os.environ.get("ALERTAS_FUNCAO_URL", "").strip() or "https://ecjeuwadpmtvbkcvrxoc.supabase.co/functions/v1/alertas"
AUDIENCIA = "painel-es-alertas"
PAINEL_PADRAO = "https://painel-es.vercel.app"
RE_TOKEN = re.compile(r"[0-9a-f]{64}")
RE_ID = re.compile(r"[0-9a-f-]{36}")
RE_EMAIL = re.compile(r"[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+")


def token_oidc():
    """Token OIDC do fluxo (precisa de `permissions: id-token: write`). None fora do GitHub Actions."""
    url, req_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", ""), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not (url and req_token):
        return None
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(f"{url}{sep}audience={urllib.parse.quote(AUDIENCIA)}", headers={"Authorization": f"Bearer {req_token}", "User-Agent": "painel-es-alertas/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read(100_000)).get("value")
    except (urllib.error.URLError, OSError, ValueError):
        return None


def chamar(corpo, token):
    req = urllib.request.Request(FUNCAO, data=json.dumps(corpo).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "painel-es-alertas/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read(1_000_000))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def limpar(lista, campos):
    """Descarta o que não tem o formato esperado (a resposta vem de fora: nada de cabeçalho ou endereço estranho entra no e-mail)."""
    saida = []
    for x in lista or []:
        if not isinstance(x, dict):
            continue
        e = str(x.get("email", ""))
        if not RE_EMAIL.fullmatch(e) or len(e) > 254:
            continue
        item = {"email": e}
        ok = True
        for campo, padrao in campos.items():
            v = str(x.get(campo, ""))
            if not padrao.fullmatch(v):
                ok = False
                break
            item[campo] = v
        if ok:
            saida.append(item)
    return saida


def listar():
    tok = token_oidc()
    if not tok:
        return None
    r = chamar({"acao": "lista"}, tok)
    if not r or not r.get("ok"):
        raise RuntimeError("a função de alertas não entregou a lista (token recusado ou função fora do ar)")  # com token e sem lista é falha, não ausência
    return {"confirmados": limpar(r.get("confirmados"), {"token_sair": RE_TOKEN}), "pendentes": limpar(r.get("pendentes"), {"id": RE_ID, "token_confirmar": RE_TOKEN})}


def marcar_enviados(ids):
    tok = token_oidc()
    ids = [i for i in ids if RE_ID.fullmatch(str(i))]
    if not (tok and ids):
        return False
    r = chamar({"acao": "marcar", "ids": ids}, tok)
    return bool(r and r.get("ok"))


def link_pagina(painel, acao, token):
    return f"{painel.rstrip('/')}/alertas/?acao={acao}&t={token}"


def rodape_sair(painel, token):
    """(html, texto) do rodapé dos resumos enviados a assinantes."""
    url = link_pagina(painel, "sair", token)
    html = f'<p style="margin:18px 0 0;font:12px/1.5 Arial,sans-serif;color:#777">Você recebe este resumo porque se cadastrou nos alertas do Painel Fiscal ES. <a href="{url}" style="color:#777">Sair da lista</a>.</p>'
    texto = f"\n\nVocê recebe este resumo porque se cadastrou nos alertas do Painel Fiscal ES. Para sair da lista: {url}"
    return html, texto


def montar_confirmacao(dest, painel, token, remetente):
    url = link_pagina(painel, "confirmar", token)
    m = EmailMessage()
    m["Subject"] = "Confirme seu cadastro nos alertas do Painel Fiscal ES"
    m["From"] = formataddr((os.environ.get("SMTP_NOME", "").strip()[:80] or "Painel ES · Monitoramento da transição", remetente))
    m["To"] = dest
    m["Date"] = formatdate(localtime=False)
    m["Message-ID"] = make_msgid(domain=remetente.split("@")[-1])
    m.set_content(f"Alguém (provavelmente você) pediu para receber os resumos do Painel Fiscal ES neste endereço.\n\nPara confirmar, abra o link e aperte o botão:\n{url}\n\nSe não foi você, ignore esta mensagem: sem confirmação, nada é enviado e o pedido expira em 7 dias.")
    m.add_alternative(f'<div style="font:15px/1.5 Arial,sans-serif;color:#222"><p>Alguém (provavelmente você) pediu para receber os resumos do <b>Painel Fiscal ES</b> neste endereço.</p>'
                      f'<p><a href="{url}" style="display:inline-block;padding:10px 18px;background:#1f6bc4;color:#fff;text-decoration:none;border-radius:6px">Confirmar cadastro</a></p>'
                      f'<p style="color:#777;font-size:13px">Se não foi você, ignore esta mensagem: sem confirmação, nada é enviado e o pedido expira em 7 dias.</p></div>', subtype="html")
    return m


def enviar_confirmacoes(dry_run=False):
    try:
        dados = listar()
    except RuntimeError as erro:
        sys.exit(f"alertas: {erro}")  # deixa o passo vermelho: o aviso de falha do fluxo chega, em vez de a falha passar em silêncio
    if dados is None:
        print("alertas: sem token OIDC (execução fora do GitHub Actions): nada a fazer")
        return 0
    pend = dados["pendentes"]
    print(f"alertas: {len(dados['confirmados'])} confirmados, {len(pend)} aguardando e-mail de confirmação")
    if dry_run or not pend:
        return 0
    usuario, senha = os.environ.get("SMTP_USUARIO", "").strip(), os.environ.get("SMTP_SENHA", "")
    if not (usuario and senha):
        print("alertas: faltam SMTP_USUARIO ou SMTP_SENHA (confirmações não enviadas)")
        return 0
    painel = os.environ.get("PAINEL_URL", "").strip() or PAINEL_PADRAO
    if not re.match(r"https?://", painel):
        painel = PAINEL_PADRAO
    remetente = os.environ.get("SMTP_REMETENTE", "").strip() or usuario
    msgs = [montar_confirmacao(p["email"], painel, p["token_confirmar"], remetente) for p in pend]
    import ssl
    host, porta = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com", int(os.environ.get("SMTP_PORTA", "587") or 587)
    ctx = ssl.create_default_context()
    try:
        servidor = smtplib.SMTP_SSL(host, porta, context=ctx, timeout=60) if porta == 465 else smtplib.SMTP(host, porta, timeout=60)
        if porta != 465:
            servidor.starttls(context=ctx)
        with servidor:
            servidor.login(usuario, senha)
            for m in msgs:
                servidor.send_message(m)
    except (smtplib.SMTPException, OSError) as erro:
        sys.exit(f"falha no envio das confirmações: {type(erro).__name__}")
    marcar_enviados([p["id"] for p in pend])
    print(f"alertas: {len(msgs)} e-mail(s) de confirmação enviado(s)")
    return len(msgs)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    enviar_confirmacoes(ap.parse_args().dry_run)
