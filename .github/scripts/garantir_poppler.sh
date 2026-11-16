#!/usr/bin/env bash
# Garante o pdftotext (pacote poppler-utils) no computador do GitHub, que não o traz instalado.
# Até 3 tentativas, cada uma com atualização do índice de pacotes e limite de tempo, para que uma falha passageira
# de rede do servidor de pacotes do Ubuntu não derrube o passo nem gaste vários minutos em tentativas internas do apt.
# Sai com erro só se, ao fim das tentativas, o pdftotext continuar ausente.
command -v pdftotext >/dev/null && exit 0
for tentativa in 1 2 3; do
  if sudo timeout 120 apt-get update -qq \
     && sudo timeout 180 apt-get install -y -qq -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 poppler-utils; then
    command -v pdftotext >/dev/null && exit 0
  fi
  echo "poppler-utils: tentativa $tentativa falhou."
  sleep $((tentativa * 15))
done
echo "Não foi possível instalar o poppler-utils (pdftotext)." >&2
exit 1
