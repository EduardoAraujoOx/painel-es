// Gera o convite de cada seção do painel, a partir de public/compartilhar-img/secoes.json:
//   public/compartilhar-img/<seção>.jpg   imagem 1200x630 que o WhatsApp mostra na prévia do link
//   public/<seção>/index.html             página do link (etiquetas Open Graph) que leva à seção; "painel" é a página inicial e não tem página própria
// Uso (precisa do Playwright com Chromium): node pipeline/compartilhamento/gerar.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const PUBLICO = path.join(RAIZ, 'public');
const SECOES = JSON.parse(fs.readFileSync(path.join(PUBLICO, 'compartilhar-img', 'secoes.json'), 'utf8'));
const MODELO = fs.readFileSync(path.join(__dirname, 'cartao.html'), 'utf8');
const SITE = 'https://painel-es.vercel.app';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pagina = (id, s) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>${esc(s.og_titulo)} · Painel Fiscal</title>
  <meta name="description" content="${esc(s.og_texto)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:site_name" content="Painel Fiscal ES">
  <meta property="og:title" content="${esc(s.og_titulo)}">
  <meta property="og:description" content="${esc(s.og_texto)}">
  <meta property="og:url" content="${SITE}/${id}">
  <meta property="og:image" content="${SITE}/compartilhar-img/${id}.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Painel Fiscal Espírito Santo: ${esc(s.titulo)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta http-equiv="refresh" content="0; url=/${s.hash}">
  <link rel="icon" href="data:,">
  <style>body{font-family:system-ui,sans-serif;margin:2rem;color:#0b0b0b}a{color:${esc(s.cor)}}</style>
</head>
<body>
  <p>Abrindo ${esc(s.rotulo)} no Painel Fiscal ES… <a href="/${s.hash}">Toque aqui se não abrir.</a></p>
</body>
</html>
`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const tmp = path.join(__dirname, '.cartao-tmp.html');
  for (const [id, s] of Object.entries(SECOES)) {
    const html = MODELO.replace(/{{cor}}/g, s.cor).replace('{{titulo}}', esc(s.titulo)).replace('{{sub}}', esc(s.sub))
      .replace('{{chips}}', s.chips.map((c) => `<span>${esc(c)}</span>`).join('')).replace('{{cta}}', esc(s.cta));
    fs.writeFileSync(tmp, html);
    await p.goto('file://' + tmp);
    await p.evaluate(() => document.fonts.ready);
    // o título cabe em até duas linhas: reduz a fonte até caber
    await p.evaluate(() => { const h = document.getElementById('titulo'); let t = 108; while (h.offsetHeight > 2 * t * 1.02 && t > 60) { t -= 4; h.style.fontSize = t + 'px'; } });
    await p.screenshot({ type: 'jpeg', quality: 88, path: path.join(PUBLICO, 'compartilhar-img', id + '.jpg') });
    if (id !== 'painel') {
      fs.mkdirSync(path.join(PUBLICO, id), { recursive: true });
      fs.writeFileSync(path.join(PUBLICO, id, 'index.html'), pagina(id, s));
    }
    console.log('ok', id);
  }
  fs.unlinkSync(tmp);
  await b.close();
})();
