// Gera public/compartilhar-img/noticias.jpg (1200x630), a imagem que o WhatsApp mostra ao compartilhar o link /noticias.
// Uso (precisa do Playwright com Chromium): node pipeline/noticias/cartao/gerar.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + path.join(__dirname, 'cartao.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ type: 'jpeg', quality: 88, path: path.join(__dirname, '..', '..', '..', 'public', 'compartilhar-img', 'noticias.jpg') });
  await b.close();
})();
