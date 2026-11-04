'use strict';
/* global criarQuadroAssinatura */

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const nomeMil = (posto, nome) => [posto, nome].filter(Boolean).join(' ');
const vtrNome = (v) => v.prefixo || v.vtr_prefixo || v.placa || v.vtr_placa;
function decorrido(iso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const STATUS = { disponivel: 'Disponível', em_uso: 'Em uso', manutencao: 'Manutenção', vaga: 'Vago' };

let eu = null;
let servico = null;
let fonteEventos = null;
let recarregarTela = null;
let timerPainel = null;

async function atualizarServico() {
  servico = (await api('GET', '/api/servico/atual')).servico;
  renderServico();
}

async function api(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { mostrarLogin(); throw new Error(dados.erro || 'Sessão expirada'); }
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
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

// ---------- login / sessão ----------
function mostrarLogin() {
  fonteEventos?.close(); fonteEventos = null;
  $('#tela-app').hidden = true; $('#tela-login').hidden = false;
  $('#form-login [name=login]').focus();
}
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#erro-login').textContent = '';
  try { eu = await api('POST', '/api/login', valorForm(e.target)); e.target.reset(); iniciar(); }
  catch (err) { $('#erro-login').textContent = err.message; }
});
$('#btn-sair').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); eu = null; mostrarLogin(); };
$('#btn-monitor').onclick = () => window.open('/monitor', 'claviculario-monitor', 'popup,width=1280,height=800');
$('#btn-senha').onclick = () => modal({
  titulo: 'Trocar minha senha',
  html: `<label>Senha atual <input type="password" name="atual"></label><label>Nova senha <input type="password" name="nova" minlength="6"></label>`,
  acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => { await api('POST', '/api/minha-senha', valorForm($('#modal-conteudo'))); aviso('Senha alterada'); } }],
});

function iniciar() {
  $('#tela-login').hidden = true; $('#tela-app').hidden = false;
  $('#nome-usuario').textContent = eu.nome;
  document.querySelectorAll('[data-admin]').forEach((el) => { el.hidden = eu.perfil !== 'admin'; });
  conectarEventos();
  navegar();
}
function conectarEventos() {
  fonteEventos?.close();
  fonteEventos = new EventSource('/api/eventos');
  let t;
  fonteEventos.addEventListener('atualizar', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      atualizarServico().catch(() => {});
      if (!$('#modal').open) recarregarTela?.().catch(() => {});
    }, 300);
  });
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
const telas = { painel: telaPainel, historico: telaHistorico, temporarias: telaTemporarias, servicos: telaServicos, militares: telaMilitares, viaturas: telaViaturas, usuarios: telaUsuarios, auditoria: telaAuditoria };
function navegar() {
  if (!eu) return;
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
  const preServ = new URLSearchParams(location.search).get('servico') || '';
  el.innerHTML = `
    <div class="cabecalho"><h1>Livro de cautelas</h1><button class="btn" onclick="print()">🖨 Imprimir</button></div>
    <form class="filtros barra" id="f-hist">
      <label>De <input type="date" name="de" value="${preServ ? '' : iso(ini)}"></label>
      <label>Até <input type="date" name="ate" value="${preServ ? '' : iso(hoje)}"></label>
      <label>Viatura <select name="viatura_id"><option value="">Todas</option>${viaturas.map((v) => `<option value="${v.id}">${esc(v.prefixo || '')} ${esc(v.modelo)} ${esc(v.placa)}</option>`).join('')}</select></label>
      <label>Serviço <select name="servico_id"><option value="">Todos</option>${servicos.map((s) => `<option value="${s.id}" ${String(s.id) === preServ ? 'selected' : ''}>${dataHora(s.inicio)} — ${esc(s.sargento)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="abertas"> Só em uso</label>
      <button class="btn primario">Filtrar</button><a class="btn" id="btn-csv">Exportar Excel (CSV)</a>
    </form>
    <div class="tabela-wrap"><table><thead><tr><th>Pos.</th><th>Viatura</th><th>Motorista / Missão</th><th>Saída</th><th>Devolução</th><th>Km</th><th>Sgt de Dia</th><th></th></tr></thead>
    <tbody id="t-hist"></tbody></table></div>`;
  const carregar = async () => {
    const v = valorForm($('#f-hist')), prm = new URLSearchParams();
    for (const k of ['de', 'ate', 'viatura_id', 'servico_id']) if (v[k]) prm.set(k, v[k]);
    if (v.abertas) prm.set('abertas', '1');
    $('#btn-csv').href = `/api/cautelas?${prm}&formato=csv`;
    const linhas = await api('GET', `/api/cautelas?${prm}`);
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
        <td><a class="btn pequeno" href="?servico=${s.id}#historico">Ver cautelas</a></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum serviço registrado.</td></tr>'}
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

// ---------- usuários (admin) ----------
async function telaUsuarios(el) {
  let lista = [];
  const carregar = async () => {
    lista = await api('GET', '/api/usuarios');
    el.innerHTML = `<div class="cabecalho"><h1>Usuários do sistema</h1><button class="btn primario" id="novo-u">+ Novo usuário</button></div>
      <p class="sub">Dica: crie um login <b>operador</b> para o computador do Sgt de Dia. Quem está de serviço é registrado na passagem de serviço, não no login.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((u) => `<tr class="${u.ativo ? '' : 'inativo'}"><td>${esc(u.nome)}</td><td>${esc(u.login)}</td><td>${u.perfil === 'admin' ? 'Administrador' : 'Operador'}</td>
        <td>${u.ativo ? 'Ativo' : 'Inativo'}</td><td><button class="btn pequeno" data-ed="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#novo-u').onclick = () => form();
    el.querySelector('tbody').onclick = (e) => { const id = Number(e.target.dataset.ed); if (id) form(lista.find((u) => u.id === id)); };
  };
  const form = (u = {}) => modal({
    titulo: u.id ? `Editar ${u.login}` : 'Novo usuário',
    html: `<label>Nome <input name="nome" value="${esc(u.nome)}"></label>
      ${u.id ? '' : '<label>Login <input name="login" autocomplete="off"></label>'}
      <label>${u.id ? 'Nova senha (em branco = manter)' : 'Senha'} <input type="password" name="senha" autocomplete="new-password"></label>
      <label>Perfil <select name="perfil"><option value="operador">Operador (Sgt de Dia)</option><option value="admin" ${u.perfil === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
      ${u.id ? `<label class="check"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Ativo</label>` : ''}`,
    acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      await (u.id ? api('PUT', `/api/usuarios/${u.id}`, v) : api('POST', '/api/usuarios', v));
      aviso('Usuário salvo'); await carregar();
    } }],
  });
  await carregar();
}

async function telaAuditoria(el) {
  const linhas = await api('GET', '/api/auditoria');
  el.innerHTML = `<div class="cabecalho"><h1>Auditoria</h1></div><p class="sub">Últimas 300 ações registradas.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Sgt de Dia</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${linhas.map((a) => `<tr><td>${dataHora(a.em)}</td><td>${esc(a.usuario || '—')}</td><td><small>${esc(a.sargento)}</small></td><td>${esc(a.acao.replace(/_/g, ' '))}</td><td><small>${esc(a.detalhe)}</small></td></tr>`).join('')}
    </tbody></table></div>`;
}

api('GET', '/api/me').then((u) => { eu = u; iniciar(); }).catch(() => mostrarLogin());
