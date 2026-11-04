'use strict';
/* global criarQuadroAssinatura */

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const STATUS = { disponivel: 'Disponível', retirada: 'Retirada', atrasada: 'Atrasada' };

let eu = null;
let timerPainel = null;

async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
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
  const textoFechar = acoes.length ? 'Cancelar' : 'Fechar';
  const dlg = $('#modal');
  $('#modal-titulo').textContent = titulo;
  $('#modal-conteudo').innerHTML = html;
  $('#modal-erro').textContent = '';
  dlg.classList.toggle('largo', !!largo);
  const rod = $('#modal-acoes'); rod.innerHTML = '';
  for (const a of [...acoes, { texto: textoFechar, classe: '', fechar: true }]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${a.classe ?? ''}`; b.textContent = a.texto;
    b.onclick = async () => {
      if (a.fechar) return dlg.close();
      $('#modal-erro').textContent = '';
      b.disabled = true;
      try { if ((await a.acao()) !== false) dlg.close(); }
      catch (e) { $('#modal-erro').textContent = e.message; }
      finally { b.disabled = false; }
    };
    rod.appendChild(b);
  }
  $('.fechar', dlg).onclick = () => dlg.close();
  dlg.showModal();
  aoAbrir?.($('#modal-conteudo'));
}
const valorForm = (raiz) => Object.fromEntries([...raiz.querySelectorAll('[name]')].map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value]));

// ---------- login ----------
function mostrarLogin() {
  clearInterval(timerPainel);
  $('#tela-app').hidden = true; $('#tela-login').hidden = false;
  $('#form-login [name=login]').focus();
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').textContent = '';
  try {
    eu = await api('POST', '/api/login', valorForm(e.target));
    e.target.reset();
    iniciar();
  } catch (err) { $('#erro-login').textContent = err.message; }
});

$('#btn-sair').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); eu = null; mostrarLogin(); };

$('#btn-senha').onclick = () => modal({
  titulo: 'Trocar minha senha',
  html: `<label>Senha atual <input type="password" name="atual" required></label>
         <label>Nova senha <input type="password" name="nova" minlength="6" required></label>`,
  acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => { await api('POST', '/api/minha-senha', valorForm($('#modal-conteudo'))); aviso('Senha alterada'); } }],
});

function iniciar() {
  $('#tela-login').hidden = true; $('#tela-app').hidden = false;
  $('#nome-usuario').textContent = `${eu.nome} (${eu.perfil})`;
  document.querySelectorAll('[data-admin]').forEach((el) => { el.hidden = eu.perfil !== 'admin'; });
  navegar();
}

// ---------- roteamento ----------
const telas = { painel: telaPainel, historico: telaHistorico, pessoas: telaPessoas, chaves: telaChaves, usuarios: telaUsuarios, auditoria: telaAuditoria };
function navegar() {
  if (!eu) return;
  clearInterval(timerPainel);
  let nome = location.hash.slice(1) || 'painel';
  if (!telas[nome]) nome = 'painel';
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#${nome}`));
  telas[nome]($('#conteudo')).catch((e) => aviso(e.message, 'erro'));
}
window.addEventListener('hashchange', navegar);

// ---------- painel ----------
async function telaPainel(el) {
  el.innerHTML = `
    <div class="cabecalho">
      <h1>Painel de chaves</h1>
      <div class="filtros">
        <input type="search" id="busca-chave" placeholder="Buscar chave, sala ou pessoa…">
        <select id="filtro-status"><option value="">Todas</option><option value="disponivel">Disponíveis</option>
          <option value="retirada">Retiradas</option><option value="atrasada">Atrasadas</option></select>
      </div>
    </div>
    <div class="totais" id="totais"></div>
    <div class="grade" id="grade"></div>`;
  let dados;
  const render = () => {
    const t = dados.totais;
    $('#totais').innerHTML = `
      <div class="total"><b>${t.chaves}</b><span>Chaves</span></div>
      <div class="total disponivel"><b>${t.disponiveis}</b><span>Disponíveis</span></div>
      <div class="total retirada"><b>${t.retiradas}</b><span>Retiradas</span></div>
      <div class="total atrasada"><b>${t.atrasadas}</b><span>Atrasadas</span></div>`;
    const busca = $('#busca-chave').value.toLowerCase(), st = $('#filtro-status').value;
    const lista = dados.chaves.filter((c) => (!st || c.status === st)
      && (!busca || [c.codigo, c.descricao, c.local, c.pessoa_nome].join(' ').toLowerCase().includes(busca)));
    $('#grade').innerHTML = lista.length ? lista.map((c) => `
      <button class="chave ${c.status}" data-id="${c.id}">
        <span class="codigo">${esc(c.codigo)}${c.restrita ? ' <small title="Acesso restrito">🔒</small>' : ''}</span>
        <span class="desc">${esc(c.descricao)}</span>
        ${c.local ? `<span class="local">${esc(c.local)}</span>` : ''}
        <span class="estado">${STATUS[c.status]}</span>
        ${c.mov_id ? `<span class="quem">${esc([c.pessoa_posto, c.pessoa_nome].filter(Boolean).join(' '))}<br><small>desde ${dataHora(c.retirada_em)}${c.previsao_devolucao ? ` · prev. ${dataHora(c.previsao_devolucao)}` : ''}</small></span>` : ''}
      </button>`).join('') : '<p class="vazio">Nenhuma chave encontrada. ' + (eu.perfil === 'admin' ? 'Cadastre em <a href="#chaves">Chaves</a>.' : '') + '</p>';
  };
  const carregar = async () => { dados = await api('GET', '/api/painel'); render(); };
  $('#busca-chave').oninput = render; $('#filtro-status').onchange = render;
  $('#grade').onclick = (e) => {
    const b = e.target.closest('.chave'); if (!b) return;
    const c = dados.chaves.find((x) => x.id === Number(b.dataset.id));
    (c.mov_id ? abrirDevolucao : abrirRetirada)(c, carregar);
  };
  await carregar();
  timerPainel = setInterval(() => { if (!$('#modal').open) carregar().catch(() => {}); }, 30000);
}

async function abrirRetirada(chave, depois) {
  const pessoas = chave.restrita
    ? await api('GET', `/api/chaves/${chave.id}/autorizados`)
    : await api('GET', '/api/pessoas');
  if (!pessoas.length) {
    return aviso(chave.restrita ? 'Nenhuma pessoa autorizada para esta chave.' : 'Cadastre pessoas antes de registrar retiradas.', 'erro');
  }
  let quadro;
  modal({
    titulo: `Retirar chave ${chave.codigo}`,
    html: `<p class="sub">${esc(chave.descricao)}${chave.restrita ? ' · <b>acesso restrito</b> (só autorizados)' : ''}</p>
      <label>Quem está retirando
        <input type="search" id="filtra-pessoa" placeholder="Filtrar por nome ou identificação…">
        <select name="pessoa_id" id="sel-pessoa" size="5" required>
          ${pessoas.map((p) => `<option value="${p.id}">${esc([p.posto, p.nome].filter(Boolean).join(' '))} — ${esc(p.identificacao)}</option>`).join('')}
        </select></label>
      <label>Previsão de devolução (opcional) <input type="datetime-local" name="previsao_devolucao"></label>
      <label>Observação <input name="obs" maxlength="300"></label>
      <div class="rotulo">Assinatura de quem retira</div>
      <div id="quadro"></div>`,
    aoAbrir: (raiz) => {
      quadro = criarQuadroAssinatura($('#quadro', raiz));
      const sel = $('#sel-pessoa', raiz);
      $('#filtra-pessoa', raiz).oninput = (e) => {
        const t = e.target.value.toLowerCase();
        [...sel.options].forEach((o) => { o.hidden = !o.textContent.toLowerCase().includes(t); });
        const vis = [...sel.options].filter((o) => !o.hidden);
        if (vis.length === 1) sel.value = vis[0].value;
      };
    },
    acoes: [{
      texto: 'Confirmar retirada', classe: 'primario', acao: async () => {
        const v = valorForm($('#modal-conteudo'));
        if (!v.pessoa_id) throw new Error('Selecione quem está retirando');
        if (quadro.vazio()) throw new Error('Peça para a pessoa assinar no quadro');
        await api('POST', '/api/retiradas', { ...v, chave_id: chave.id, previsao_devolucao: v.previsao_devolucao || null, assinatura: quadro.png() });
        aviso(`Chave ${chave.codigo} retirada`); await depois();
      },
    }],
  });
}

async function abrirDevolucao(chave, depois) {
  const pessoas = await api('GET', '/api/pessoas');
  let quadro;
  modal({
    titulo: `Devolver chave ${chave.codigo}`,
    html: `<p class="sub">${esc(chave.descricao)}</p>
      <p>Retirada por <b>${esc(chave.pessoa_nome)}</b> em ${dataHora(chave.retirada_em)}
      ${chave.pessoa_telefone ? ` · tel. ${esc(chave.pessoa_telefone)}` : ''}
      ${chave.status === 'atrasada' ? '<br><span class="tag atrasada">Devolução atrasada</span>' : ''}</p>
      <label>Quem está devolvendo
        <select name="devolvida_por_id">
          ${pessoas.map((p) => `<option value="${p.id}" ${p.id === chave.pessoa_id ? 'selected' : ''}>${esc([p.posto, p.nome].filter(Boolean).join(' '))} — ${esc(p.identificacao)}</option>`).join('')}
        </select></label>
      <label>Observação (avarias, etc.) <input name="obs" maxlength="300"></label>
      <div class="rotulo">Assinatura de quem devolve</div>
      <div id="quadro"></div>`,
    aoAbrir: (raiz) => { quadro = criarQuadroAssinatura($('#quadro', raiz)); },
    acoes: [{
      texto: 'Confirmar devolução', classe: 'primario', acao: async () => {
        if (quadro.vazio()) throw new Error('Peça para a pessoa assinar no quadro');
        await api('POST', '/api/devolucoes', { chave_id: chave.id, ...valorForm($('#modal-conteudo')), assinatura: quadro.png() });
        aviso(`Chave ${chave.codigo} devolvida`); await depois();
      },
    }],
  });
}

// ---------- histórico ----------
async function telaHistorico(el) {
  const chaves = await api('GET', '/api/chaves?todas=1');
  const hoje = new Date(), ini = new Date(hoje - 30 * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="cabecalho"><h1>Histórico de movimentações</h1></div>
    <form class="filtros barra" id="f-hist">
      <label>De <input type="date" name="de" value="${iso(ini)}"></label>
      <label>Até <input type="date" name="ate" value="${iso(hoje)}"></label>
      <label>Chave <select name="chave_id"><option value="">Todas</option>${chaves.map((c) => `<option value="${c.id}">${esc(c.codigo)} — ${esc(c.descricao)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="abertas"> Só em aberto</label>
      <button class="btn primario">Filtrar</button>
      <a class="btn" id="btn-csv">Exportar CSV</a>
    </form>
    <div class="tabela-wrap"><table><thead><tr>
      <th>Chave</th><th>Retirada por</th><th>Retirada</th><th>Devolução</th><th>Operadores</th><th>Obs.</th><th></th>
    </tr></thead><tbody id="t-hist"></tbody></table></div>`;
  const params = () => {
    const v = valorForm($('#f-hist')), p = new URLSearchParams();
    for (const k of ['de', 'ate', 'chave_id']) if (v[k]) p.set(k, v[k]);
    if (v.abertas) p.set('abertas', '1');
    return p;
  };
  const carregar = async () => {
    const p = params();
    $('#btn-csv').href = `/api/movimentacoes?${p}&formato=csv`;
    const linhas = await api('GET', `/api/movimentacoes?${p}`);
    $('#t-hist').innerHTML = linhas.length ? linhas.map((m) => `<tr>
      <td><b>${esc(m.chave_codigo)}</b><br><small>${esc(m.chave_descricao)}</small></td>
      <td>${esc([m.pessoa_posto, m.pessoa_nome].filter(Boolean).join(' '))}<br><small>${esc(m.pessoa_identificacao)}${m.pessoa_setor ? ' · ' + esc(m.pessoa_setor) : ''}</small></td>
      <td>${dataHora(m.retirada_em)}${m.previsao_devolucao ? `<br><small>prev. ${dataHora(m.previsao_devolucao)}</small>` : ''}</td>
      <td>${m.devolvida_em ? `${dataHora(m.devolvida_em)}<br><small>${esc(m.devolvida_por_nome)}</small>` : '<span class="tag retirada">Em aberto</span>'}</td>
      <td><small>${esc(m.operador_retirada)}${m.operador_devolucao ? ' / ' + esc(m.operador_devolucao) : ''}</small></td>
      <td><small>${esc([m.obs_retirada, m.obs_devolucao].filter(Boolean).join(' | '))}</small></td>
      <td><button class="btn pequeno" data-ver="${m.id}">Assinaturas</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="vazio">Nenhuma movimentação no período.</td></tr>';
  };
  $('#f-hist').onsubmit = (e) => { e.preventDefault(); carregar().catch((er) => aviso(er.message, 'erro')); };
  $('#t-hist').onclick = async (e) => {
    const id = e.target.dataset.ver; if (!id) return;
    const m = await api('GET', `/api/movimentacoes/${id}`);
    const bloco = (tit, img, nome, quando) => `<figure class="ass-ver"><figcaption>${tit}: <b>${esc(nome)}</b> — ${dataHora(quando)}</figcaption>
      ${img ? `<img src="${img}" alt="Assinatura de ${esc(nome)}">` : '<p class="vazio">Sem assinatura</p>'}</figure>`;
    modal({
      titulo: `Chave ${m.chave_codigo} — registro nº ${m.id}`, largo: true,
      html: bloco('Retirada', m.assinatura_retirada, m.pessoa_nome, m.retirada_em)
        + (m.devolvida_em ? bloco('Devolução', m.assinatura_devolucao, m.devolvida_por_nome, m.devolvida_em) : '<p>Chave ainda não devolvida.</p>'),
    });
  };
  await carregar();
}

// ---------- pessoas ----------
async function telaPessoas(el) {
  el.innerHTML = `
    <div class="cabecalho"><h1>Pessoas</h1>
      <div class="filtros"><input type="search" id="busca-p" placeholder="Buscar…"><button class="btn primario" id="nova-p">+ Nova pessoa</button></div></div>
    <div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Identificação</th><th>Posto/Cargo</th><th>Setor</th><th>Telefone</th><th>Situação</th><th></th></tr></thead>
    <tbody id="t-p"></tbody></table></div>`;
  let lista = [];
  const render = () => {
    const t = $('#busca-p').value.toLowerCase();
    $('#t-p').innerHTML = lista.filter((p) => [p.nome, p.identificacao, p.setor].join(' ').toLowerCase().includes(t)).map((p) => `<tr class="${p.ativo ? '' : 'inativo'}">
      <td>${esc(p.nome)}</td><td>${esc(p.identificacao)}</td><td>${esc(p.posto)}</td><td>${esc(p.setor)}</td><td>${esc(p.telefone)}</td>
      <td>${p.ativo ? 'Ativo' : 'Inativo'}</td><td><button class="btn pequeno" data-ed="${p.id}">Editar</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="vazio">Nenhuma pessoa cadastrada.</td></tr>';
  };
  const carregar = async () => { lista = await api('GET', '/api/pessoas?todas=1'); render(); };
  const form = (p = {}) => modal({
    titulo: p.id ? 'Editar pessoa' : 'Nova pessoa',
    html: `<label>Nome completo <input name="nome" value="${esc(p.nome)}" required></label>
      <label>Identificação (matrícula, SARAM, CPF…) <input name="identificacao" value="${esc(p.identificacao)}" required></label>
      <div class="duas"><label>Posto/Cargo <input name="posto" value="${esc(p.posto)}"></label>
      <label>Setor <input name="setor" value="${esc(p.setor)}"></label></div>
      <label>Telefone <input name="telefone" value="${esc(p.telefone)}" inputmode="tel"></label>
      ${p.id ? `<label class="check"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo</label>` : ''}`,
    acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      await (p.id ? api('PUT', `/api/pessoas/${p.id}`, v) : api('POST', '/api/pessoas', v));
      aviso('Pessoa salva'); await carregar();
    } }],
  });
  $('#busca-p').oninput = render;
  $('#nova-p').onclick = () => form();
  $('#t-p').onclick = (e) => { const id = Number(e.target.dataset.ed); if (id) form(lista.find((p) => p.id === id)); };
  await carregar();
}

// ---------- chaves (admin) ----------
async function telaChaves(el) {
  el.innerHTML = `
    <div class="cabecalho"><h1>Chaves</h1><button class="btn primario" id="nova-c">+ Nova chave</button></div>
    <div class="tabela-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>Local</th><th>Acesso</th><th>Situação</th><th></th></tr></thead>
    <tbody id="t-c"></tbody></table></div>`;
  let lista = [];
  const carregar = async () => {
    lista = await api('GET', '/api/chaves?todas=1');
    $('#t-c').innerHTML = lista.map((c) => `<tr class="${c.ativa ? '' : 'inativo'}">
      <td><b>${esc(c.codigo)}</b></td><td>${esc(c.descricao)}</td><td>${esc(c.local)}</td>
      <td>${c.restrita ? `🔒 Restrito (${c.n_autorizados})` : 'Livre'}</td><td>${c.ativa ? 'Ativa' : 'Inativa'}</td>
      <td class="acoes"><button class="btn pequeno" data-ed="${c.id}">Editar</button>
        <button class="btn pequeno" data-aut="${c.id}">Autorizados</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="vazio">Nenhuma chave cadastrada.</td></tr>';
  };
  const form = (c = {}) => modal({
    titulo: c.id ? `Editar chave ${c.codigo}` : 'Nova chave',
    html: `<div class="duas"><label>Código / nº no quadro <input name="codigo" value="${esc(c.codigo)}" required></label>
      <label>Local / prédio <input name="local" value="${esc(c.local)}"></label></div>
      <label>Descrição <input name="descricao" value="${esc(c.descricao)}" placeholder="Ex.: Sala 12 — Almoxarifado" required></label>
      <label class="check"><input type="checkbox" name="restrita" ${c.restrita ? 'checked' : ''}> Acesso restrito (só pessoas autorizadas podem retirar)</label>
      ${c.id ? `<label class="check"><input type="checkbox" name="ativa" ${c.ativa ? 'checked' : ''}> Ativa</label>` : ''}`,
    acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      await (c.id ? api('PUT', `/api/chaves/${c.id}`, v) : api('POST', '/api/chaves', v));
      aviso('Chave salva'); await carregar();
    } }],
  });
  const autorizados = async (c) => {
    const [todas, atuais] = await Promise.all([api('GET', '/api/pessoas'), api('GET', `/api/chaves/${c.id}/autorizados`)]);
    const marcados = new Set(atuais.map((p) => p.id));
    modal({
      titulo: `Autorizados — chave ${c.codigo}`,
      html: `${c.restrita ? '' : '<p class="sub">Esta chave está com acesso livre; a lista só vale se marcar “acesso restrito”.</p>'}
        <input type="search" id="f-aut" placeholder="Filtrar…">
        <div class="lista-check" id="l-aut">${todas.map((p) => `<label class="check"><input type="checkbox" value="${p.id}" ${marcados.has(p.id) ? 'checked' : ''}>
          ${esc([p.posto, p.nome].filter(Boolean).join(' '))} <small>${esc(p.identificacao)}</small></label>`).join('') || '<p class="vazio">Nenhuma pessoa cadastrada.</p>'}</div>`,
      aoAbrir: (r) => { $('#f-aut', r).oninput = (e) => { const t = e.target.value.toLowerCase(); r.querySelectorAll('#l-aut label').forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(t); }); }; },
      acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
        const ids = [...document.querySelectorAll('#l-aut input:checked')].map((i) => Number(i.value));
        await api('PUT', `/api/chaves/${c.id}/autorizados`, { pessoa_ids: ids });
        aviso('Autorizações salvas'); await carregar();
      } }],
    });
  };
  $('#nova-c').onclick = () => form();
  $('#t-c').onclick = (e) => {
    const ed = Number(e.target.dataset.ed), au = Number(e.target.dataset.aut);
    if (ed) form(lista.find((c) => c.id === ed));
    if (au) autorizados(lista.find((c) => c.id === au)).catch((er) => aviso(er.message, 'erro'));
  };
  await carregar();
}

// ---------- usuários (admin) ----------
async function telaUsuarios(el) {
  el.innerHTML = `
    <div class="cabecalho"><h1>Usuários do sistema</h1><button class="btn primario" id="novo-u">+ Novo usuário</button></div>
    <p class="sub">Operadores registram retiradas e devoluções. Administradores também gerenciam chaves, usuários e auditoria.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody id="t-u"></tbody></table></div>`;
  let lista = [];
  const carregar = async () => {
    lista = await api('GET', '/api/usuarios');
    $('#t-u').innerHTML = lista.map((u) => `<tr class="${u.ativo ? '' : 'inativo'}"><td>${esc(u.nome)}</td><td>${esc(u.login)}</td>
      <td>${u.perfil === 'admin' ? 'Administrador' : 'Operador'}</td><td>${u.ativo ? 'Ativo' : 'Inativo'}</td>
      <td><button class="btn pequeno" data-ed="${u.id}">Editar</button></td></tr>`).join('');
  };
  const form = (u = {}) => modal({
    titulo: u.id ? `Editar ${u.login}` : 'Novo usuário',
    html: `<label>Nome <input name="nome" value="${esc(u.nome)}" required></label>
      ${u.id ? '' : '<label>Login <input name="login" required autocomplete="off"></label>'}
      <label>${u.id ? 'Nova senha (deixe em branco para manter)' : 'Senha'} <input type="password" name="senha" minlength="6" autocomplete="new-password"></label>
      <label>Perfil <select name="perfil"><option value="operador">Operador</option><option value="admin" ${u.perfil === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
      ${u.id ? `<label class="check"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Ativo</label>` : ''}`,
    acoes: [{ texto: 'Salvar', classe: 'primario', acao: async () => {
      const v = valorForm($('#modal-conteudo'));
      await (u.id ? api('PUT', `/api/usuarios/${u.id}`, v) : api('POST', '/api/usuarios', v));
      aviso('Usuário salvo'); await carregar();
    } }],
  });
  $('#novo-u').onclick = () => form();
  $('#t-u').onclick = (e) => { const id = Number(e.target.dataset.ed); if (id) form(lista.find((u) => u.id === id)); };
  await carregar();
}

// ---------- auditoria (admin) ----------
async function telaAuditoria(el) {
  const linhas = await api('GET', '/api/auditoria');
  el.innerHTML = `<div class="cabecalho"><h1>Auditoria</h1></div><p class="sub">Últimas 300 ações registradas no sistema.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${linhas.map((a) => `<tr><td>${dataHora(a.em.includes('T') ? a.em : a.em.replace(' ', 'T') + 'Z')}</td><td>${esc(a.usuario || '—')}</td><td>${esc(a.acao)}</td><td><small>${esc(a.detalhe)}</small></td></tr>`).join('')}
    </tbody></table></div>`;
}

// ---------- início ----------
api('GET', '/api/me').then((u) => { eu = u; iniciar(); }).catch(() => mostrarLogin());
