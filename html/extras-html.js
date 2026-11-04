'use strict';
/* global Local, BancoLocal, api, aviso, modal, valorForm, esc, dataHora, hora, nomeMil, decorrido, recarregarTela, atualizarServico, navegar */

// ---------- exportação CSV (Excel) ----------
function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function baixarCsv(linhas) {
  const escCsv = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
  const cols = [['Nº', (l) => l.id], ['Posição', (l) => l.posicao], ['Prefixo', (l) => l.vtr_prefixo], ['Modelo', (l) => l.vtr_modelo], ['Placa', (l) => l.vtr_placa],
    ['Missão', (l) => l.missao], ['Destino', (l) => l.destino], ['Motorista (saída)', (l) => nomeMil(l.motorista_saida_posto, l.motorista_saida)],
    ['SARAM', (l) => l.motorista_saida_ident], ['Saída', (l) => dt(l.saida_em)], ['Km saída', (l) => l.km_saida], ['Sgt de Dia (saída)', (l) => l.sgt_saida],
    ['Situação', (l) => (!l.retorno_em ? 'Em uso' : l.encerramento === 'nao_retornou' ? 'Não retornou à STS' : 'Devolvida')],
    ['Motorista (devolução)', (l) => nomeMil(l.motorista_retorno_posto, l.motorista_retorno)], ['Devolução', (l) => dt(l.retorno_em)],
    ['Km retorno', (l) => l.km_retorno], ['Km rodados', (l) => (l.km_retorno != null && l.km_saida != null ? l.km_retorno - l.km_saida : '')],
    ['Sgt de Dia (devolução)', (l) => l.sgt_retorno], ['Obs. saída', (l) => l.obs_saida], ['Obs. devolução', (l) => l.obs_retorno]];
  const txt = '﻿' + [cols.map((c) => escCsv(c[0])).join(';'), ...linhas.map((l) => cols.map((c) => escCsv(c[1](l))).join(';'))].join('\r\n');
  baixarArquivo(`cautelas-${new Date().toISOString().slice(0, 10)}.csv`, txt, 'text/csv;charset=utf-8');
}

// ---------- backup ----------
const ultimoBackup = () => { try { return localStorage.getItem('claviculario-ultimo-backup'); } catch { return null; } };
async function fazerBackup() {
  const dados = await Local.exportar();
  baixarArquivo(`backup-claviculario-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`, JSON.stringify(dados), 'application/json');
  try { localStorage.setItem('claviculario-ultimo-backup', new Date().toISOString()); } catch { /* */ }
  aviso('Backup salvo na pasta Downloads');
}

async function telaBackup(el) {
  const E = await Local.carregar();
  const ult = ultimoBackup();
  let persistente = false;
  try { persistente = await navigator.storage?.persisted?.(); } catch { /* */ }
  el.innerHTML = `
    <div class="cabecalho"><h1>Backup e configurações</h1></div>
    <div class="cartao bloco">
      <h2>💾 Backup dos dados</h2>
      <p>Os dados ficam guardados <b>dentro deste navegador, neste computador</b>. Se alguém limpar o histórico ou os dados do navegador, eles se perdem.
        Por isso, <b>salve um backup pelo menos uma vez por semana</b> (ex.: na passagem de serviço de segunda-feira) e guarde o arquivo num pendrive ou na rede.</p>
      <p class="${ult && Date.now() - new Date(ult) < 7 * 864e5 ? 'ok-txt' : 'alerta-txt'}">Último backup: <b>${ult ? dataHora(ult) : 'nunca feito'}</b></p>
      <div class="acoes-linha">
        <button class="btn primario" id="b-backup">Salvar backup agora</button>
        <label class="btn" for="f-restaurar">Restaurar um backup…</label><input type="file" id="f-restaurar" accept=".json,application/json" hidden>
      </div>
    </div>
    <div class="cartao bloco">
      <h2>📊 Situação</h2>
      <p>${E.viaturas.filter((v) => v.ativa && v.tipo === 'fixa').length} viaturas fixas · ${E.pessoas.length} militares · ${E.cautelas.length} cautelas · ${E.servicos.length} serviços registrados</p>
      <p class="sub">Armazenamento protegido contra limpeza automática do navegador: <b>${persistente ? 'sim' : 'não'}</b>${persistente ? '' : ' <button class="btn pequeno" id="b-persist">Proteger</button>'}</p>
    </div>
    <div class="cartao bloco">
      <h2>🧪 Teste</h2>
      <p>Carrega 12 viaturas, militares, cautelas e uma viatura do Rancho para testar o sistema. Só funciona com o sistema vazio.</p>
      <div class="acoes-linha">
        <button class="btn" id="b-exemplo" ${E.viaturas.length ? 'disabled' : ''}>Carregar dados de exemplo</button>
        <button class="btn perigo-txt" id="b-apagar">Apagar TODOS os dados</button>
      </div>
    </div>`;
  $('#b-backup').onclick = () => fazerBackup().then(() => telaBackup(el)).catch((e) => aviso(e.message, 'erro'));
  $('#b-persist') && ($('#b-persist').onclick = async () => { await navigator.storage.persist?.(); telaBackup(el); });
  $('#f-restaurar').onchange = async (e) => {
    const arq = e.target.files[0]; if (!arq) return;
    try {
      const dados = JSON.parse(await arq.text());
      modal({
        titulo: 'Restaurar backup',
        html: `<p>Isto vai <b>substituir todos os dados atuais</b> pelos do arquivo <b>${esc(arq.name)}</b> (gerado em ${dataHora(dados.gerado_em)}).</p>`,
        acoes: [{ texto: 'Substituir e restaurar', classe: 'primario', acao: async () => { await Local.importar(dados); aviso('Backup restaurado'); await atualizarServico(); telaBackup(el); } }],
      });
    } catch (er) { aviso(er.message.includes('JSON') ? 'Arquivo inválido' : er.message, 'erro'); }
    e.target.value = '';
  };
  $('#b-exemplo').onclick = async () => { await carregarExemplo(); aviso('Dados de exemplo carregados'); location.hash = '#painel'; };
  $('#b-apagar').onclick = () => modal({
    titulo: 'Apagar todos os dados',
    html: '<p>Isto apaga <b>viaturas, militares, cautelas, assinaturas e serviços</b> deste computador. Faça um backup antes.</p><label>Para confirmar, digite <b>APAGAR</b> <input name="conf" autocomplete="off"></label>',
    acoes: [{ texto: 'Apagar tudo', classe: 'primario perigo', acao: async () => {
      if (valorForm($('#modal-conteudo')).conf.trim().toUpperCase() !== 'APAGAR') throw new Error('Digite APAGAR para confirmar');
      await Local.apagarTudo(); aviso('Dados apagados'); await atualizarServico(); telaBackup(el);
    } }],
  });
}

// ---------- dados de exemplo ----------
async function carregarExemplo() {
  const post = (u, d) => api('POST', u, d);
  const vtrs = [['VTR-01', 'Toyota Hilux', 'QWE1A23'], ['VTR-02', 'Toyota Hilux', 'QWE1A24'], ['VTR-03', 'Mitsubishi L200', 'RTY2B11'],
    ['VTR-04', 'Renault Master', 'UIO3C45'], ['VTR-05', 'Fiat Ducato', 'PAS4D67'], ['VTR-06', 'VW Gol', 'DFG5E89'],
    ['VTR-07', 'Chevrolet S10', 'HJK6F01'], ['VTR-08', 'Marcopolo Volare', 'LZX7G23'], ['VTR-09', 'Fiat Strada', 'CVB8H45'],
    ['VTR-10', 'Iveco Daily', 'NMQ9I67'], ['VTR-11', 'Ford Ranger', 'WER0J89'], ['VTR-12', 'Toyota Corolla', 'TYU1K01']];
  const v = {};
  for (const [i, [prefixo, modelo, placa]] of vtrs.entries()) v[prefixo] = (await post('/api/viaturas', { prefixo, modelo, placa, posicao: i + 1 })).id;
  const p = {};
  for (const [posto, nome, identificacao, setor, telefone] of [['2S', 'Silva', '1001', 'STS', '(35) 99999-1001'], ['1S', 'Costa', '1002', 'STS'],
    ['3S', 'Alves', '1003', 'STS'], ['CB', 'Souza', '2001', 'STS', '(35) 99999-2001'], ['S1', 'Lima', '2002', 'STS'], ['S2', 'Ramos', '2003', 'STS'], ['CB', 'Rocha', '3001', 'Rancho']])
    p[nome] = (await post('/api/pessoas', { posto, nome, identificacao, setor, telefone })).id;
  // assinatura de exemplo (rabisco)
  const c = document.createElement('canvas'); c.width = 400; c.height = 120;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 120); x.strokeStyle = '#0b1f3a'; x.lineWidth = 3; x.beginPath();
  for (let i = 0; i <= 60; i++) x.lineTo(30 + i * 5.5, 60 + Math.sin(i / 3) * 25 * Math.cos(i / 11)); x.stroke();
  const ass = c.toDataURL('image/png');
  await post('/api/servico/assumir', { sargento_id: p.Costa });
  await post('/api/cautelas/saida', { viatura_id: v['VTR-06'], motorista_id: p.Lima, missao: 'Correio no centro', km_saida: 30500, assinatura: ass });
  await post('/api/cautelas/retorno', { viatura_id: v['VTR-06'], motorista_id: p.Lima, km_retorno: 30542, assinatura: ass });
  await post('/api/cautelas/saida', { viatura_id: v['VTR-03'], motorista_id: p.Souza, missao: 'Transporte de material ao Hangar 2', assinatura: ass });
  await post('/api/servico/assumir', { sargento_id: p.Silva, obs_passagem: 'VTR-03 em missão' });
  await post('/api/cautelas/saida', { viatura_id: v['VTR-08'], motorista_id: p.Ramos, missao: 'Transporte de cadetes', assinatura: ass });
  await post(`/api/viaturas/${v['VTR-05']}/manutencao`, { em_manutencao: true, motivo: 'Revisão 50.000 km' });
  await post('/api/temporarias/entrada', { prefixo: 'RAN-03', modelo: 'Fiat Fiorino', placa: 'RAN3A33', setor_origem: 'Rancho', posicao: 20, entregue_por: 'CB Rocha' });
}

// ---------- monitor (segunda tela) ----------
function iniciarMonitor() {
  document.body.classList.add('modo-monitor');
  document.title = 'Monitor do Claviculário';
  $('#tela-monitor').hidden = false;
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

// ---------- partida ----------
(async () => {
  if (!('indexedDB' in window)) {
    document.body.innerHTML = '<p style="padding:24px;font:18px system-ui">Este navegador não permite guardar dados. Abra o arquivo no <b>Google Chrome</b> ou no <b>Microsoft Edge</b>.</p>';
    return;
  }
  try { await Local.carregar(); } catch (e) {
    document.body.innerHTML = `<p style="padding:24px;font:18px system-ui">Não foi possível abrir o banco de dados do navegador (${esc(e.message)}).<br>Abra o arquivo no <b>Google Chrome</b> ou no <b>Microsoft Edge</b>, fora do modo anônimo.</p>`;
    return;
  }
  if (location.hash === '#monitor') return iniciarMonitor();
  try { navigator.storage?.persist?.(); } catch { /* */ }
  iniciar();
  const ult = ultimoBackup(), E = Local.estado();
  if (E.cautelas.length && (!ult || Date.now() - new Date(ult) > 7 * 864e5)) setTimeout(() => aviso('Lembrete: faça o backup semanal em "Backup"', 'erro'), 1500);
})();
