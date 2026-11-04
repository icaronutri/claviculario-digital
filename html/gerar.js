'use strict';
// Gera claviculario.html (arquivo único, sem servidor) a partir das telas do sistema.
// Uso: node html/gerar.js
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const icone = ler('public/icone.svg').trim();
// CSS do monitor só vale quando a página está em modo monitor
const cssMonitor = ler('public/monitor.css')
  .replace(/^:root\s*\{/m, 'body.modo-monitor {')
  .replace(/^html, body \{[^}]*\}/m, 'body.modo-monitor { height: 100vh; margin: 0; }')
  .replace(/^body \{/m, 'body.modo-monitor {')
  .replace(/^\* \{[^}]*\}/m, '')
  .replace(/^\[hidden\][^\n]*\n/m, '');
const cssExtra = `
body.modo-monitor #tela-monitor { display: flex; flex-direction: column; height: 100vh; }
body.modo-monitor #tela-monitor[hidden] { display: none !important; }
body.modo-monitor main.m-grade { max-width: none; margin: 0; width: 100%; }
.m-totais small { color: inherit; }
.marca svg, .m-titulo svg { width: 28px; height: 28px; flex: 0 0 auto; }
.m-titulo svg { width: 34px; height: 34px; }
.bloco { margin-bottom: 16px; }
.bloco h2 { margin: 0 0 8px; font-size: 1.1rem; }
.acoes-linha { display: flex; gap: 8px; flex-wrap: wrap; }
.ok-txt { color: var(--ok); } .alerta-txt { color: var(--perigo); font-weight: 600; }
.btn.perigo { background: var(--perigo); border-color: var(--perigo); color: #fff; }
`;
const css = [ler('public/style.css'), cssMonitor, cssExtra].join('\n');
const js = [ler('html/dados-local.js'), ler('public/assinatura.js'), ler('html/app-html.js'), ler('html/extras-html.js')]
  .join('\n;\n').replace(/<\/script/gi, '<\\/script');

const html = ler('html/modelo.html')
  .replace('{{ICONE_URL}}', () => encodeURIComponent(icone))
  .replace(/\{\{ICONE\}\}/g, () => icone)
  .replace('{{CSS}}', () => css)
  .replace('{{JS}}', () => js);

const destino = path.join(raiz, 'claviculario.html');
fs.writeFileSync(destino, html);
console.log(`Gerado ${path.relative(process.cwd(), destino)} (${Math.round(html.length / 1024)} KB)`);
