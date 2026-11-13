'use strict';
/* global Local, criarQuadroAssinatura, $, esc, dataHora, hora, nomeMil, decorrido */
// Tela de controle do Sgt de Dia.

const STATUS = { disponivel: 'Disponível', em_uso: 'Em uso', manutencao: 'Manutenção', vaga: 'Vago' };

let servico = null;
let recarregarTela = null;
let timerPainel = null;

async function atualizarServico() {
  servico = (await api('GET', '/api/servico/atual')).servico;
  renderServico();
}

async function api(metodo, url, corpo) {
  return Local.chamar(metodo, url, corpo);
}
function aviso(msg, tipo = 'ok') {
  const el = $('#aviso');
  el.textContent = msg; el.className = `mostrar ${tipo}`;
  clearTimeout(el._t); el._t = setTimeout(() => { el.className = ''; }, 3500);
}

// ---------- modal ----------
function modal({ titulo, html, acoes = [], aoAbrir, largo }) {
  const dlg = $('#modal');
  $('#modal-titulo').textContent = titulo;
  $('#modal-conteudo').innerHTML = html;
  $('#modal-erro').textContent = '';
  dlg.classList.toggle('largo', !!largo);
  const rod = $('#modal-acoes'); rod.innerHTML = '';
  const temPrincipal = acoes.some((a) => a.classe?.includes('primario'));
  for (const a of [...acoes, { texto: temPrincipal ? 'Cancelar' : 'Fechar', fechar: true }]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${a.classe ?? ''}`; b.textContent = a.texto;
    b.onclick = async () => {
      if (a.fechar) return dlg.close();
      $('#modal-erro').textContent = ''; b.disabled = true;
      try { if ((await a.acao()) !== false && dlg.open && !a.manterAberto) dlg.close(); }
      catch (e) { $('#modal-erro').textContent = e.message; }
      finally { b.disabled = false; }
    };
    rod.appendChild(b);
  }
  $('.fechar', dlg).onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0; $('#modal-form').scrollTop = 0;
  aoAbrir?.($('#modal-conteudo'));
}
const valorForm = (raiz) => Object.fromEntries([...raiz.querySelectorAll('[name]')].filter((el) => !el.closest('.novo-militar')).map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value]));

/**
 * Seletor de militar com filtro e cadastro rápido (sem sair da tela).
 * Retorna () => id selecionado.
 */
async function seletorMilitar(container, { nome, rotulo, selecionado }) {
  let pessoas = await api('GET', '/api/pessoas');
  container.innerHTML = `<label>${esc(rotulo)}
      <input type="search" class="filtro" placeholder="Digite nome, posto ou SARAM…" autocomplete="off">
      <select name="${nome}" size="5"></select></label>
    <button type="button" class="btn link mais">+ Militar não cadastrado</button>
    <div class="novo-militar" hidden>
      <div class="tres"><label>Posto/Grad. <input data-n="posto" placeholder="Ex.: 3S"></label>
        <label>Nome de guerra <input data-n="nome"></label>
        <label>SARAM <input data-n="identificacao"></label></div>
      <label>Setor <input data-n="setor"></label>
      <button type="button" class="btn pequeno salvar">Cadastrar e selecionar</button>
    </div>`;
  const sel = $('select', container), filtro = $('.filtro', container), novo = $('.novo-militar', container);
  const render = () => {
    const t = filtro.value.toLowerCase(), atual = sel.value || selecionado;
    sel.innerHTML = pessoas.filter((p) => !t || `${p.posto} ${p.nome} ${p.identificacao} ${p.setor}`.toLowerCase().includes(t))
      .map((p) => `<option value="${p.id}" ${String(p.id) === String(atual) ? 'selected' : ''}>${esc(nomeMil(p.posto, p.nome))} — ${esc(p.identificacao)}${p.setor ? ' · ' + esc(p.setor) : ''}</option>`).join('');
    if (sel.options.length === 1) sel.selectedIndex = 0;
  };
  filtro.oninput = render;
  $('.mais', container).onclick = () => { novo.hidden = !novo.hidden; if (!novo.hidden) $('[data-n=posto]', novo).focus(); };
  $('.salvar', container).onclick = async () => {
    const d = Object.fromEntries([...novo.querySelectorAll('[data-n]')].map((i) => [i.dataset.n, i.value]));
    try {
      const p = await api('POST', '/api/pessoas', d);
      pessoas = await api('GET', '/api/pessoas');
      selecionado = p.id; filtro.value = ''; novo.hidden = true;
      novo.querySelectorAll('input').forEach((i) => { i.value = ''; });
      render(); aviso(`${nomeMil(p.posto, p.nome)} cadastrado`);
    } catch (e) { $('#modal-erro').textContent = e.message; }
  };
  render();
  return () => sel.value;
}

// ---------- início / sincronização entre janelas ----------
let monitorJanela = null;
$('#btn-monitor').onclick = () => {
  monitorJanela = window.open(new URL('monitor.html', location.href).href, 'claviculario-monitor', 'popup,width=1280,height=800');
};
const canal = 'BroadcastChannel' in window ? new BroadcastChannel('claviculario') : null;
function avisarOutrasJanelas() {
  canal?.postMessage('atualizar');
  try { localStorage.setItem('claviculario-ping', String(Date.now())); } catch { /* sem localStorage */ }
  try { monitorJanela && !monitorJanela.closed && monitorJanela.postMessage('atualizar', '*'); } catch { /* janela fechada */ }
}
Local.aoMudar = avisarOutrasJanelas;
function aoMudarFora() {
  atualizarServico().catch(() => {});
  if (!$('#modal').open) recarregarTela?.().catch(() => {});
}
canal && (canal.onmessage = aoMudarFora);
window.addEventListener('storage', (e) => { if (e.key === 'claviculario-ping') aoMudarFora(); });

function iniciar() {
  $('#tela-app').hidden = false;
  navegar();
}

// ---------- faixa do serviço ----------
function renderServico() {
  const el = $('#faixa-servico');
  if (!servico) {
    el.className = 'faixa-servico sem';
    el.innerHTML = `<span>⚠ Nenhum Sgt de Dia de serviço</span><button class="btn primario pequeno" id="btn-assumir">Assumir serviço</button>`;
  } else {
    el.className = 'faixa-servico';
    el.innerHTML = `<span>Sgt de Dia: <b>${esc(nomeMil(servico.sargento_posto, servico.sargento_nome))}</b> · desde ${dataHora(servico.inicio)}</span>
      <button class="btn pequeno" id="btn-assumir">Passagem de serviço</button>`;
  }
  $('#btn-assumir').onclick = () => abrirPassagem();
}

async function abrirPassagem() {
  const atual = await api('GET', '/api/servico/atual');
  let getSgt;
  const abertas = atual.cautelas_abertas || [];
  modal({
    titulo: atual.servico ? 'Passagem de serviço' : 'Assumir serviço de Sgt de Dia',
    html: `${atual.servico ? `<p>Sai de serviço: <b>${esc(nomeMil(atual.servico.sargento_posto, atual.servico.sargento_nome))}</b> (desde ${dataHora(atual.servico.inicio)})</p>
        <div class="conferencia"><b>Conferência — chaves fora do claviculário: ${abertas.length}</b>
        ${abertas.length ? `<ul>${abertas.map((c) => `<li>Pos. ${c.posicao} · <b>${esc(c.vtr_prefixo || c.vtr_placa)}</b> ${esc(c.vtr_modelo)} — ${esc(nomeMil(c.motorista_saida_posto, c.motorista_saida))} · ${esc(c.missao)} · saiu ${dataHora(c.saida_em)}</li>`).join('')}</ul>` : '<p class="sub">Todas as chaves estão no claviculário.</p>'}</div>
        <label>Observações da passagem <input name="obs_passagem" maxlength="500" placeholder="Alterações, pendências…"></label>` : ''}
      <div id="sel-sgt"></div>
      <label>Observação ao assumir <input name="obs_assuncao" maxlength="500"></label>`,
    aoAbrir: async (r) => { getSgt = await seletorMilitar($('#sel-sgt', r), { nome: 'sargento_id', rotulo: 'Sgt de Dia que assume' }); },
    acoes: [{ texto: atual.servico ? 'Confirmar passagem' : 'Assumir serviço', classe: 'primario', acao: async () => {
      if (!getSgt()) throw new Error('Selecione o Sgt de Dia que está assumindo');
      await api('POST', '/api/servico/assumir', { ...valorForm($('#modal-conteudo')), sargento_id: getSgt() });
      aviso('Serviço assumido'); await atualizarServico(); await recarregarTela?.();
    } }],
  });
}

// ---------- roteamento ----------
const telas = { painel: telaPainel, historico: telaHistorico, temporarias: telaTemporarias, servicos: telaServicos, militares: telaMilitares, viaturas: telaViaturas, backup: telaBackup, auditoria: telaAuditoria };
function navegar() {
    let nome = location.hash.slice(1) || 'painel';
  if (!telas[nome]) nome = 'painel';
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#${nome}`));
  recarregarTela = null;
  clearInterval(timerPainel);
  atualizarServico().catch(() => {});
  telas[nome]($('#conteudo')).catch((e) => aviso(e.message, 'erro'));
}
window.addEventListener('hashchange', navegar);

// ---------- controle (painel do Sgt de Dia) ----------
async function telaPainel(el) {
  el.innerHTML = `
    <div class="cabecalho"><h1>Controle do claviculário</h1>
      <div class="filtros"><input type="search" id="busca" placeholder="Buscar prefixo, placa, modelo, motorista…">
        <select id="filtro"><option value="">Todas as posições</option><option value="disponivel">Disponíveis</option><option value="em_uso">Em uso</option>
          <option value="manutencao">Manutenção</option><option value="vaga">Vagas</option></select></div></div>
    <div class="totais" id="totais"></div>
    <div class="grade" id="grade"></div>
    <p class="legenda"><span class="bolinha disponivel"></span>Disponível <span class="bolinha em_uso"></span>Em uso <span class="bolinha manutencao"></span>Manutenção <span class="bolinha vaga"></span>Posição vaga · <b>TEMP</b> = viatura temporária de outro setor</p>`;
  let dados;
  const render = () => {
    const t = dados.totais;
    $('#totais').innerHTML = `<div class="total disponivel"><b>${t.disponiveis}</b><span>Disponíveis</span></div>
      <div class="total em_uso"><b>${t.em_uso}</b><span>Em uso</span></div>
      <div class="total manutencao"><b>${t.manutencao}</b><span>Manutenção</span></div>
      <div class="total vaga"><b>${t.vagas}</b><span>Posições vagas</span></div>`;
    const busca = $('#busca').value.toLowerCase(), st = $('#filtro').value;
    const lista = dados.posicoes.filter((p) => (!st || p.status === st)
      && (!busca || [p.numero, p.prefixo, p.placa, p.modelo, p.setor_origem, p.motorista_nome, p.missao].join(' ').toLowerCase().includes(busca)));
    $('#grade').innerHTML = lista.map((p) => `
      <button class="pos ${p.status}" data-n="${p.numero}">
        <span class="num">${p.numero}</span>
        ${p.viatura_id ? `
          <span class="pref">${esc(p.prefixo || p.placa)}${p.tipo === 'temporaria' ? ` <i class="temp">TEMP · ${esc(p.setor_origem)}</i>` : ''}</span>
          <span class="mod">${esc(p.modelo)} · ${esc(p.placa)}</span>
          <span class="estado">${STATUS[p.status]}</span>
          ${p.status === 'em_uso' ? `<span class="quem">${esc(nomeMil(p.motorista_posto, p.motorista_nome))}<br><small>${esc(p.missao)}</small><br><small>saiu ${hora(p.saida_em)} · há ${decorrido(p.saida_em)}</small></span>` : ''}
          ${p.status === 'manutencao' ? `<span class="quem"><small>${esc(p.manutencao_motivo)}</small></span>` : ''}`
        : '<span class="estado">Vago</span><span class="mod">toque para colocar viatura temporária</span>'}
      </button>`).join('') || '<p class="vazio">Nada encontrado.</p>';
  };
  const carregar = async () => { dados = await api('GET', '/api/painel'); servico = dados.servico; renderServico(); render(); };
  recarregarTela = carregar;
  $('#busca').oninput = render; $('#filtro').onchange = render;
  $('#grade').onclick = (e) => {
    const b = e.target.closest('.pos'); if (!b) return;
    const p = dados.posicoes.find((x) => x.numero === Number(b.dataset.n));
    if (!servico && p.status !== 'manutencao') { aviso('Assuma o serviço de Sgt de Dia antes de registrar movimentações', 'erro'); return abrirPassagem(); }
    ({ disponivel: abrirSaida, em_uso: abrirRetorno, manutencao: abrirManutencao, vaga: abrirEntradaTemp })[p.status](p, carregar)?.catch?.((er) => aviso(er.message, 'erro'));
  };
  await carregar();
  timerPainel = setInterval(() => { if (!$('#modal').open) carregar().catch(() => {}); }, 60000);
}

const cabVtr = (p) => `<div class="cab-vtr"><span class="num-g">${p.numero}</span><div><b>${esc(p.prefixo || '')}</b> ${esc(p.modelo)} · placa <b>${esc(p.placa)}</b>
  ${p.tipo === 'temporaria' ? `<br><span class="tag temp">Temporária · ${esc(p.setor_origem)}</span>` : ''}</div></div>`;

async function abrirSaida(p, depois) {
  let getMot, quadro;
  const acoesExtras = [{ texto: '🔧 Manutenção', classe: 'perigo-txt', manterAberto: true, acao: () => abrirManutencao(p, depois) }];
  if (p.tipo === 'temporaria') acoesExtras.push({ texto: '↩ Devolver ao setor de origem', manterAberto: true, acao: () => abrirSaidaTemp(p, depois) });
  modal({
    titulo: 'Saída de viatura',
    html: `${cabVtr(p)}
      <div id="sel-mot"></div>
      <label>Missão <input name="missao" maxlength="200" placeholder="Ex.: Transporte de pessoal ao HFA" required></label>
      <div class="duas"><label>Destino (opcional) <input name="destino" maxlength="120"></label>
        <label>Odômetro saída (km) <input name="km_saida" inputmode="numeric" pattern="[0-9]*"></label></div>
      <label>Observação <input name="obs" maxlength="300"></label>
      <div class="rotulo">Assinatura do motorista</div><div id="quadro"></div>
      <p class="sub">Horário de saída registrado automaticamente ao confirmar.</p>`,
    aoAbrir: async (r) => { quadro = criarQuadroAssinatura($('#quadro', r)); getMot = await seletorMilitar($('#sel-mot', r), { nome: 'motorista_id', rotulo: 'Motorista' }); },
    acoes: [...acoesExtras, { texto: 'Confirmar saída', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      if (!getMot()) throw new Error('Selecione o motorista');
      if (!v.missao.trim()) throw new Error('Informe a missão');
      if (quadro.vazio()) throw new Error('O motorista precisa assinar');
      await api('POST', '/api/cautelas/saida', { ...v, viatura_id: p.viatura_id, motorista_id: getMot(), assinatura: quadro.png() });
      aviso(`Saída da ${p.prefixo || p.placa} registrada`); await depois();
    } }],
  });
}

async function abrirRetorno(p, depois) {
  let getMot, quadro;
  modal({
    titulo: 'Devolução da chave',
    html: `${cabVtr(p)}
      <p class="info">Saiu com <b>${esc(nomeMil(p.motorista_posto, p.motorista_nome))}</b> às ${dataHora(p.saida_em)} (há ${decorrido(p.saida_em)})<br>
        Missão: ${esc(p.missao)}${p.destino ? ` · ${esc(p.destino)}` : ''}${p.km_saida != null ? ` · km saída ${p.km_saida}` : ''}
        ${p.motorista_telefone ? `<br>Tel.: ${esc(p.motorista_telefone)}` : ''}</p>
      ${p.tipo === 'temporaria' ? `<label class="check destaque"><input type="checkbox" name="nao_retornou" id="nao-ret"> A viatura <b>não retornou à STS</b> (seguiu direto para ${esc(p.setor_origem)})</label>` : ''}
      <div id="bloco-ret">
        <div id="sel-mot"></div>
        <label>Odômetro retorno (km) <input name="km_retorno" inputmode="numeric" pattern="[0-9]*"></label>
        <div class="rotulo">Assinatura de quem devolve</div><div id="quadro"></div>
      </div>
      <div id="bloco-nao" hidden><label>Quem informou <input name="informado_por" placeholder="Ex.: Cb Rocha, por telefone"></label></div>
      <label>Observação (alterações, avarias…) <input name="obs" maxlength="300"></label>`,
    aoAbrir: async (r) => {
      quadro = criarQuadroAssinatura($('#quadro', r));
      getMot = await seletorMilitar($('#sel-mot', r), { nome: 'motorista_id', rotulo: 'Motorista que devolve a chave', selecionado: p.motorista_id });
      const nr = $('#nao-ret', r);
      if (nr) nr.onchange = () => { $('#bloco-ret', r).hidden = nr.checked; $('#bloco-nao', r).hidden = !nr.checked; };
    },
    acoes: [{ texto: 'Confirmar devolução', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      if (v.nao_retornou) {
        await api('POST', '/api/cautelas/retorno', { viatura_id: p.viatura_id, nao_retornou: true, obs: v.obs, informado_por: v.informado_por });
        aviso(`Posição ${p.numero} liberada`); return depois();
      }
      if (!getMot()) throw new Error('Selecione quem está devolvendo');
      if (quadro.vazio()) throw new Error('O motorista precisa assinar');
      await api('POST', '/api/cautelas/retorno', { viatura_id: p.viatura_id, motorista_id: getMot(), km_retorno: v.km_retorno, obs: v.obs, assinatura: quadro.png() });
      aviso(`Chave da ${p.prefixo || p.placa} devolvida`); await depois();
    } }],
  });
}

function abrirManutencao(p, depois) {
  const em = p.status === 'manutencao';
  modal({
    titulo: em ? 'Viatura em manutenção' : 'Colocar em manutenção',
    html: `${cabVtr(p)}${em ? `<p class="info">Motivo: <b>${esc(p.manutencao_motivo)}</b><br>Desde ${dataHora(p.manutencao_desde)}</p>`
      : '<label>Motivo <input name="motivo" maxlength="200" placeholder="Ex.: Revisão, pneu furado, pane elétrica…"></label>'}`,
    acoes: [{ texto: em ? 'Liberar (voltar a disponível)' : 'Confirmar manutenção', classe: 'primario', acao: async () => {
      if (!servico) throw new Error('Assuma o serviço de Sgt de Dia primeiro');
      await api('POST', `/api/viaturas/${p.viatura_id}/manutencao`, { em_manutencao: !em, motivo: valorForm($('#modal-conteudo')).motivo });
      aviso(em ? 'Viatura liberada' : 'Viatura em manutenção'); await depois();
    } }],
  });
}

function abrirEntradaTemp(p, depois) {
  let quadro;
  modal({
    titulo: `Viatura temporária — posição ${p.numero}`,
    html: `<p class="sub">Viatura de outro setor que vai ficar temporariamente no claviculário.</p>
      <div class="duas"><label>Setor de origem <input name="setor_origem" placeholder="Ex.: Rancho" required></label>
        <label>Prefixo <input name="prefixo"></label></div>
      <div class="duas"><label>Modelo <input name="modelo" required></label><label>Placa <input name="placa" required style="text-transform:uppercase"></label></div>
      <label>Quem entregou a chave <input name="entregue_por" placeholder="Posto e nome" required></label>
      <label>Observação <input name="obs" maxlength="300"></label>
      <div class="rotulo">Assinatura de quem entregou (opcional)</div><div id="quadro"></div>`,
    aoAbrir: (r) => { quadro = criarQuadroAssinatura($('#quadro', r)); },
    acoes: [{ texto: 'Registrar entrada', classe: 'primario', acao: async () => {
      await api('POST', '/api/temporarias/entrada', { ...valorForm($('#modal-conteudo')), posicao: p.numero, assinatura: quadro.vazio() ? null : quadro.png() });
      aviso(`Viatura colocada na posição ${p.numero}`); await depois();
    } }],
  });
}

function abrirSaidaTemp(p, depois) {
  let quadro;
  modal({
    titulo: 'Devolver viatura ao setor de origem',
    html: `${cabVtr(p)}<p class="sub">A chave sai do claviculário e a posição ${p.numero} fica vaga.</p>
      <label>Quem recebeu a chave <input name="recebido_por" placeholder="Posto e nome"></label>
      <label>Observação <input name="obs" maxlength="300"></label>
      <div class="rotulo">Assinatura de quem recebeu</div><div id="quadro"></div>`,
    aoAbrir: (r) => { quadro = criarQuadroAssinatura($('#quadro', r)); },
    acoes: [{ texto: 'Confirmar', classe: 'primario', acao: async () => {
      if (quadro.vazio()) throw new Error('Quem recebeu precisa assinar');
      await api('POST', `/api/temporarias/${p.viatura_id}/saida`, { ...valorForm($('#modal-conteudo')), assinatura: quadro.png() });
      aviso(`Posição ${p.numero} liberada`); await depois();
    } }],
  });
}

// ---------- cautelas (livro) ----------
async function telaHistorico(el) {
  const [viaturas, servicos] = await Promise.all([api('GET', '/api/viaturas?todas=1'), api('GET', '/api/servicos')]);
  const hoje = new Date(), ini = new Date(hoje - 30 * 864e5), iso = (d) => d.toISOString().slice(0, 10);
  let preServ = ''; try { preServ = sessionStorage.getItem('filtro-servico') || ''; sessionStorage.removeItem('filtro-servico'); } catch { /* */ }
  el.innerHTML = `
    <div class="cabecalho"><h1>Livro de cautelas</h1><button class="btn" onclick="print()">🖨 Imprimir</button></div>
    <form class="filtros barra" id="f-hist">
      <label>De <input type="date" name="de" value="${preServ ? '' : iso(ini)}"></label>
      <label>Até <input type="date" name="ate" value="${preServ ? '' : iso(hoje)}"></label>
      <label>Viatura <select name="viatura_id"><option value="">Todas</option>${viaturas.map((v) => `<option value="${v.id}">${esc(v.prefixo || '')} ${esc(v.modelo)} ${esc(v.placa)}</option>`).join('')}</select></label>
      <label>Serviço <select name="servico_id"><option value="">Todos</option>${servicos.map((s) => `<option value="${s.id}" ${String(s.id) === preServ ? 'selected' : ''}>${dataHora(s.inicio)} — ${esc(s.sargento)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="abertas"> Só em uso</label>
      <button class="btn primario">Filtrar</button><button type="button" class="btn" id="btn-csv">Exportar Excel (CSV)</button>
    </form>
    <div class="tabela-wrap"><table><thead><tr><th>Pos.</th><th>Viatura</th><th>Motorista / Missão</th><th>Saída</th><th>Devolução</th><th>Km</th><th>Sgt de Dia</th><th></th></tr></thead>
    <tbody id="t-hist"></tbody></table></div>`;
  const carregar = async () => {
    const v = valorForm($('#f-hist')), prm = new URLSearchParams();
    for (const k of ['de', 'ate', 'viatura_id', 'servico_id']) if (v[k]) prm.set(k, v[k]);
    if (v.abertas) prm.set('abertas', '1');
    const linhas = await api('GET', `/api/cautelas?${prm}`);
    $('#btn-csv').onclick = () => baixarCsv(linhas);
    $('#t-hist').innerHTML = linhas.map((c) => `<tr>
      <td>${c.posicao ?? ''}</td>
      <td><b>${esc(c.vtr_prefixo || '')}</b> ${esc(c.vtr_modelo)}<br><small>${esc(c.vtr_placa)}</small></td>
      <td>${esc(nomeMil(c.motorista_saida_posto, c.motorista_saida))}<br><small>${esc(c.missao)}${c.destino ? ' · ' + esc(c.destino) : ''}</small></td>
      <td>${dataHora(c.saida_em)}</td>
      <td>${!c.retorno_em ? '<span class="tag em_uso">Em uso</span>' : c.encerramento === 'nao_retornou' ? `${dataHora(c.retorno_em)}<br><small>não retornou à STS</small>` : `${dataHora(c.retorno_em)}<br><small>${esc(nomeMil(c.motorista_retorno_posto, c.motorista_retorno))}</small>`}</td>
      <td><small>${c.km_saida ?? ''}${c.km_retorno != null ? ` → ${c.km_retorno}<br>(${c.km_retorno - c.km_saida} km)` : ''}</small></td>
      <td><small>${esc(c.sgt_saida)}${c.sgt_retorno && c.sgt_retorno !== c.sgt_saida ? ' / ' + esc(c.sgt_retorno) : ''}</small></td>
      <td><button class="btn pequeno" data-ver="${c.id}">Assinaturas</button></td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhuma cautela no período.</td></tr>';
  };
  recarregarTela = carregar;
  $('#f-hist').onsubmit = (e) => { e.preventDefault(); carregar().catch((er) => aviso(er.message, 'erro')); };
  $('#t-hist').onclick = async (e) => {
    const id = e.target.dataset.ver; if (!id) return;
    const c = await api('GET', `/api/cautelas/${id}`);
    const bloco = (tit, img, nome, quando) => `<figure class="ass-ver"><figcaption>${tit}: <b>${esc(nome)}</b> — ${dataHora(quando)}</figcaption>
      ${img ? `<img src="${img}" alt="Assinatura de ${esc(nome)}">` : '<p class="vazio">Sem assinatura</p>'}</figure>`;
    modal({
      titulo: `Cautela nº ${c.id} — ${c.vtr_prefixo || c.vtr_placa}`, largo: true,
      html: `<p>Missão: <b>${esc(c.missao)}</b>${c.obs_saida ? `<br>Obs.: ${esc(c.obs_saida)}` : ''}</p>`
        + bloco('Saída', c.assinatura_saida, c.motorista_saida, c.saida_em)
        + (!c.retorno_em ? '<p>Chave ainda não devolvida.</p>' : c.encerramento === 'nao_retornou' ? `<p>Não retornou à STS (${dataHora(c.retorno_em)}). ${esc(c.obs_retorno)}</p>`
          : bloco('Devolução', c.assinatura_retorno, c.motorista_retorno, c.retorno_em) + (c.obs_retorno ? `<p>Obs.: ${esc(c.obs_retorno)}</p>` : '')),
    });
  };
  await carregar();
}

// ---------- temporárias ----------
async function telaTemporarias(el) {
  const TIPO = { entrada: 'Entrada no claviculário', saida: 'Devolvida ao setor', nao_retornou: 'Não retornou (foi direto ao setor)' };
  const carregar = async () => {
    const linhas = await api('GET', '/api/temporarias/registros');
    el.innerHTML = `<div class="cabecalho"><h1>Viaturas temporárias</h1></div>
      <p class="sub">Viaturas de outros setores colocadas em posições vagas. Para registrar uma nova, toque numa posição vaga no Controle.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Movimento</th><th>Pos.</th><th>Viatura</th><th>Setor</th><th>Entregou / recebeu</th><th>Sgt de Dia</th><th></th></tr></thead><tbody>
      ${linhas.map((r) => `<tr><td>${dataHora(r.em)}</td><td>${TIPO[r.tipo]}</td><td>${r.posicao ?? ''}</td>
        <td><b>${esc(r.prefixo || '')}</b> ${esc(r.modelo)}<br><small>${esc(r.placa)}</small></td><td>${esc(r.setor_origem)}</td>
        <td>${esc(r.pessoa_nome)}${r.obs ? `<br><small>${esc(r.obs)}</small>` : ''}</td><td><small>${esc(r.sargento)}</small></td>
        <td>${r.assinado ? `<button class="btn pequeno" data-ver="${r.id}">Assinatura</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum registro.</td></tr>'}
      </tbody></table></div>`;
    el.querySelector('tbody').onclick = async (e) => {
      const id = e.target.dataset.ver; if (!id) return;
      const r = await api('GET', `/api/temporarias/registros/${id}`);
      modal({ titulo: `${TIPO[r.tipo]} — ${r.pessoa_nome || ''}`, largo: true, html: `<figure class="ass-ver"><figcaption>${dataHora(r.em)}</figcaption><img src="${r.assinatura}" alt="Assinatura"></figure>` });
    };
  };
  recarregarTela = carregar;
  await carregar();
}

// ---------- serviços ----------
async function telaServicos(el) {
  const carregar = async () => {
    const linhas = await api('GET', '/api/servicos');
    el.innerHTML = `<div class="cabecalho"><h1>Serviços de Sgt de Dia</h1><button class="btn primario" id="b-pass">Passagem de serviço</button></div>
      <div class="tabela-wrap"><table><thead><tr><th>Sgt de Dia</th><th>Início</th><th>Término</th><th>Saídas</th><th>Devoluções</th><th>Observações</th><th></th></tr></thead><tbody>
      ${linhas.map((s) => `<tr><td><b>${esc(s.sargento)}</b></td><td>${dataHora(s.inicio)}</td><td>${s.fim ? dataHora(s.fim) : '<span class="tag disponivel">De serviço</span>'}</td>
        <td>${s.saidas}</td><td>${s.retornos}</td><td><small>${esc([s.obs_assuncao, s.obs_passagem && 'Passagem: ' + s.obs_passagem].filter(Boolean).join(' · '))}</small></td>
        <td><a class="btn pequeno" href="#historico" onclick="sessionStorage.setItem('filtro-servico','${s.id}')">Ver cautelas</a></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum serviço registrado.</td></tr>'}
      </tbody></table></div>`;
    $('#b-pass').onclick = () => abrirPassagem();
  };
  recarregarTela = carregar;
  await carregar();
}

// ---------- militares ----------
async function telaMilitares(el) {
  el.innerHTML = `<div class="cabecalho"><h1>Militares</h1><div class="filtros"><input type="search" id="busca-p" placeholder="Buscar…"><button class="btn primario" id="nova-p">+ Novo militar</button></div></div>
    <div class="tabela-wrap"><table><thead><tr><th>Posto</th><th>Nome</th><th>SARAM</th><th>Setor</th><th>Telefone</th><th>Situação</th><th></th></tr></thead><tbody id="t-p"></tbody></table></div>`;
  let lista = [];
  const render = () => {
    const t = $('#busca-p').value.toLowerCase();
    $('#t-p').innerHTML = lista.filter((p) => `${p.posto} ${p.nome} ${p.identificacao} ${p.setor}`.toLowerCase().includes(t)).map((p) => `<tr class="${p.ativo ? '' : 'inativo'}">
      <td>${esc(p.posto)}</td><td>${esc(p.nome)}</td><td>${esc(p.identificacao)}</td><td>${esc(p.setor)}</td><td>${esc(p.telefone)}</td>
      <td>${p.ativo ? 'Ativo' : 'Inativo'}</td><td><button class="btn pequeno" data-ed="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum militar cadastrado.</td></tr>';
  };
  const carregar = async () => { lista = await api('GET', '/api/pessoas?todas=1'); render(); };
  const form = (p = {}) => modal({
    titulo: p.id ? 'Editar militar' : 'Novo militar',
    html: `<div class="duas"><label>Posto/Graduação <input name="posto" value="${esc(p.posto)}" placeholder="Ex.: 3S, CB, S1"></label>
      <label>SARAM / identificação <input name="identificacao" value="${esc(p.identificacao)}"></label></div>
      <label>Nome de guerra ou completo <input name="nome" value="${esc(p.nome)}"></label>
      <div class="duas"><label>Setor <input name="setor" value="${esc(p.setor)}"></label><label>Telefone <input name="telefone" value="${esc(p.telefone)}" inputmode="tel"></label></div>
      ${p.id ? `<label class="check"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo</label>` : ''}`,
    acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      await (p.id ? api('PUT', `/api/pessoas/${p.id}`, v) : api('POST', '/api/pessoas', v));
      aviso('Militar salvo'); await carregar();
    } }],
  });
  recarregarTela = carregar;
  $('#busca-p').oninput = render; $('#nova-p').onclick = () => form();
  $('#t-p').onclick = (e) => { const id = Number(e.target.dataset.ed); if (id) form(lista.find((p) => p.id === id)); };
  await carregar();
}

// ---------- viaturas (admin) ----------
async function telaViaturas(el) {
  let lista = [], painel;
  const carregar = async () => {
    [lista, painel] = await Promise.all([api('GET', '/api/viaturas?todas=1'), api('GET', '/api/painel')]);
    const fixas = lista.filter((v) => v.tipo === 'fixa');
    el.innerHTML = `<div class="cabecalho"><h1>Viaturas fixas da STS</h1><div class="filtros"><button class="btn" id="b-pos">Posições do claviculário (${painel.totais.posicoes})</button><button class="btn primario" id="nova-v">+ Nova viatura</button></div></div>
      <p class="sub">Cada viatura fixa tem sua posição no claviculário. As posições sem viatura fixa ficam vagas para viaturas temporárias de outros setores.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Pos.</th><th>Prefixo</th><th>Modelo</th><th>Placa</th><th>Setor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${fixas.map((v) => `<tr class="${v.ativa ? '' : 'inativo'}"><td><b>${v.posicao ?? '—'}</b></td><td>${esc(v.prefixo)}</td><td>${esc(v.modelo)}</td><td>${esc(v.placa)}</td><td>${esc(v.setor_origem)}</td>
        <td>${!v.ativa ? 'Desativada' : v.manutencao ? '<span class="tag manutencao">Manutenção</span>' : 'Ativa'}</td><td><button class="btn pequeno" data-ed="${v.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma viatura cadastrada.</td></tr>'}
      </tbody></table></div>`;
    $('#nova-v').onclick = () => form();
    $('#b-pos').onclick = () => modal({
      titulo: 'Posições do claviculário',
      html: `<label>Quantidade de posições (números) no claviculário <input type="number" name="total" min="1" max="500" value="${painel.totais.posicoes}"></label>`,
      acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => { await api('PUT', '/api/posicoes', valorForm($('#modal-conteudo'))); aviso('Posições atualizadas'); await carregar(); } }],
    });
    el.querySelector('tbody').onclick = (e) => { const id = Number(e.target.dataset.ed); if (id) form(lista.find((v) => v.id === id)); };
  };
  const form = (v = { ativa: 1 }) => {
    const livres = painel.posicoes.filter((p) => p.status === 'vaga' || p.viatura_id === v.id).map((p) => p.numero);
    modal({
      titulo: v.id ? `Editar ${v.prefixo || v.placa}` : 'Nova viatura fixa',
      html: `<div class="duas"><label>Prefixo <input name="prefixo" value="${esc(v.prefixo)}" placeholder="Ex.: VTR-12"></label>
        <label>Placa <input name="placa" value="${esc(v.placa)}" style="text-transform:uppercase"></label></div>
        <div class="duas"><label>Modelo <input name="modelo" value="${esc(v.modelo)}" placeholder="Ex.: Toyota Hilux"></label>
        <label>Setor <input name="setor_origem" value="${esc(v.setor_origem || 'STS')}"></label></div>
        <label>Posição no claviculário <select name="posicao"><option value="">—</option>${livres.map((n) => `<option ${n === v.posicao ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${v.id ? `<label class="check"><input type="checkbox" name="ativa" ${v.ativa ? 'checked' : ''}> Ativa (desmarque para baixar a viatura e liberar a posição)</label>` : ''}`,
      acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
        const d = valorForm($('#modal-conteudo'));
        await (v.id ? api('PUT', `/api/viaturas/${v.id}`, d) : api('POST', '/api/viaturas', d));
        aviso('Viatura salva'); await carregar();
      } }],
    });
  };
  recarregarTela = carregar;
  await carregar();
}

async function telaAuditoria(el) {
  const linhas = await api('GET', '/api/auditoria');
  el.innerHTML = `<div class="cabecalho"><h1>Auditoria</h1></div><p class="sub">Últimas 500 ações registradas.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Sgt de Dia</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${linhas.map((a) => `<tr><td>${dataHora(a.em)}</td><td><small>${esc(a.sargento)}</small></td><td>${esc(a.acao.replace(/_/g, ' '))}</td><td><small>${esc(a.detalhe)}</small></td></tr>`).join('')}
    </tbody></table></div>`;
}

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
  try { navigator.storage?.persist?.(); } catch { /* */ }
  iniciar();
  const ult = ultimoBackup(), E = Local.estado();
  if (E.cautelas.length && (!ult || Date.now() - new Date(ult) > 7 * 864e5)) setTimeout(() => aviso('Lembrete: faça o backup semanal em "Backup"', 'erro'), 1500);
})();
