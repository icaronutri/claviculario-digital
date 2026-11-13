'use strict';
/* global Local, $, esc, hora, nomeMil, decorrido */
// Monitor (segunda tela): somente leitura, atualiza sozinho.

function iniciarMonitor() {
  const STATUS = { disponivel: 'DISPONÍVEL', em_uso: 'EM USO', manutencao: 'MANUTENÇÃO', vaga: 'VAGO' };
  let dados = null, assinaturaDados = '';
  const relogio = () => {
    const d = new Date();
    $('#m-hora').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#m-data').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  function ajustarGrade() {
    const g = $('#m-grade'), n = g.children.length || 1, W = g.clientWidth, H = g.clientHeight, gap = 8;
    let melhor = { cols: 1, area: 0, h: 100 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), w = (W - gap * (cols - 1)) / cols, h = (H - gap * (rows - 1)) / rows;
      const hh = Math.min(h, w / 1.15), ww = Math.min(w, hh * 2.2);
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
      <div class="m-pos ${p.status}"><div class="m-num">${p.numero}</div><div class="m-corpo">
        ${p.viatura_id ? `<div class="m-pref">${esc(p.prefixo || p.placa)}</div>
          <div class="m-mod">${p.tipo === 'temporaria' ? `<i>${esc(p.setor_origem)}</i> ` : ''}${esc(p.modelo)}</div>
          ${p.prefixo ? `<div class="m-placa">${esc(p.placa)}</div>` : ''}` : ''}
        <div class="m-est">${STATUS[p.status]}</div>
        ${p.status === 'em_uso' ? `<div class="m-info"><b>${esc(nomeMil(p.motorista_posto, p.motorista_nome))}</b><span>${esc(p.missao)}</span><span>Saída ${hora(p.saida_em)} · ${decorrido(p.saida_em)}</span></div>` : ''}
        ${p.status === 'manutencao' ? `<div class="m-info"><span>${esc(p.manutencao_motivo)}</span></div>` : ''}
      </div></div>`).join('');
    ajustarGrade();
  }
  async function carregar() {
    try {
      const novo = await Local.chamar('GET', '/api/painel');
      const chave = JSON.stringify({ s: novo.servico, p: novo.posicoes });
      if (chave !== assinaturaDados) { assinaturaDados = chave; dados = novo; render(); }
    } catch (e) { console.error(e); }
  }
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('claviculario') : null;
  canal && (canal.onmessage = carregar);
  window.addEventListener('storage', (e) => { if (e.key === 'claviculario-ping') carregar(); });
  window.addEventListener('message', (e) => { if (e.data === 'atualizar') carregar(); });
  $('#m-tela-cheia').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  document.addEventListener('fullscreenchange', () => { $('#m-tela-cheia').hidden = !!document.fullscreenElement; });
  window.addEventListener('resize', ajustarGrade);
  relogio(); setInterval(relogio, 1000);
  setInterval(render, 30000);   // atualiza o "tempo fora"
  setInterval(carregar, 3000);  // garantia: confere o banco a cada 3 s
  carregar();
}

(async () => {
  try { await Local.carregar(); } catch (e) {
    document.body.innerHTML = `<p style="padding:24px">Não foi possível abrir os dados (${esc(e.message)}). Use o Chrome ou o Edge, fora da janela anônima.</p>`;
    return;
  }
  iniciarMonitor();
})();
