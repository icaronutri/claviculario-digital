'use strict';
/* Monitor somente leitura para a segunda tela do Sgt de Dia. Atualiza em tempo real. */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const nomeMil = (posto, nome) => [posto, nome].filter(Boolean).join(' ');
function decorrido(iso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const STATUS = { disponivel: 'DISPONÍVEL', em_uso: 'EM USO', manutencao: 'MANUTENÇÃO', vaga: 'VAGO' };
let dados = null;

function relogio() {
  const d = new Date();
  $('#m-hora').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#m-data').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// escolhe o nº de colunas que deixa os cartões maiores sem rolar a tela
function ajustarGrade() {
  const g = $('#m-grade');
  const n = g.children.length || 1;
  const W = g.clientWidth, H = g.clientHeight, gap = 8;
  let melhor = { cols: 1, area: 0, h: 100 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = (W - gap * (cols - 1)) / cols, h = (H - gap * (rows - 1)) / rows;
    const hh = Math.min(h, w / 1.15); // não deixa o cartão ficar alto demais
    const ww = Math.min(w, hh * 2.2);
    if (ww * hh > melhor.area) melhor = { cols, area: ww * hh, h };
  }
  g.style.gridTemplateColumns = `repeat(${melhor.cols}, 1fr)`;
  g.style.gridAutoRows = `${Math.max(60, melhor.h)}px`;
  g.style.setProperty('--t', `${Math.max(60, melhor.h)}px`);
}

function render() {
  if (!dados) return;
  const s = dados.servico, t = dados.totais;
  $('#m-sgt').innerHTML = s ? `SGT DE DIA<b>${esc(nomeMil(s.sargento_posto, s.sargento_nome))}</b>` : '<b class="alerta">SEM SGT DE DIA DE SERVIÇO</b>';
  $('#m-totais').innerHTML = `<span class="c disponivel">${t.disponiveis}<small>disponíveis</small></span>
    <span class="c em_uso">${t.em_uso}<small>em uso</small></span><span class="c manutencao">${t.manutencao}<small>manutenção</small></span>
    <span class="c vaga">${t.vagas}<small>vagas</small></span>`;
  $('#m-grade').innerHTML = dados.posicoes.map((p) => `
    <div class="m-pos ${p.status}">
      <div class="m-num">${p.numero}</div>
      <div class="m-corpo">
        ${p.viatura_id ? `<div class="m-pref">${esc(p.prefixo || p.placa)}</div>
          <div class="m-mod">${p.tipo === 'temporaria' ? `<i>${esc(p.setor_origem)}</i> ` : ''}${esc(p.modelo)}</div>
          ${p.prefixo ? `<div class="m-placa">${esc(p.placa)}</div>` : ''}` : ''}
        <div class="m-est">${STATUS[p.status]}</div>
        ${p.status === 'em_uso' ? `<div class="m-info"><b>${esc(nomeMil(p.motorista_posto, p.motorista_nome))}</b><span>${esc(p.missao)}</span><span>Saída ${hora(p.saida_em)} · ${decorrido(p.saida_em)}</span></div>` : ''}
        ${p.status === 'manutencao' ? `<div class="m-info"><span>${esc(p.manutencao_motivo)}</span></div>` : ''}
      </div>
    </div>`).join('');
  ajustarGrade();
}

async function carregar() {
  try {
    const r = await fetch('/api/painel', { credentials: 'same-origin' });
    if (r.status === 401) { $('#m-status').innerHTML = 'Sessão encerrada — <a href="/">faça login no sistema</a> neste computador e reabra o monitor.'; $('#m-status').className = 'm-status erro'; return; }
    dados = await r.json();
    $('#m-status').className = 'm-status';
    render();
  } catch {
    $('#m-status').textContent = 'Sem conexão com o servidor — tentando novamente…';
    $('#m-status').className = 'm-status erro';
  }
}

function conectar() {
  const es = new EventSource('/api/eventos');
  let t;
  es.addEventListener('atualizar', () => { clearTimeout(t); t = setTimeout(carregar, 200); });
  es.onopen = carregar; // ao reconectar, sincroniza
}

$('#m-tela-cheia').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
document.addEventListener('fullscreenchange', () => { $('#m-tela-cheia').hidden = !!document.fullscreenElement; });
window.addEventListener('resize', ajustarGrade);
relogio(); setInterval(relogio, 1000);
setInterval(render, 30000);   // atualiza o "tempo fora"
setInterval(carregar, 60000); // garantia, caso o tempo real caia
carregar(); conectar();
