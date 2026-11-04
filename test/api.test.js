'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco } = require('../src/db');
const { criarApp } = require('../src/app');

const ASS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';
let srv, base, cookie = '';

async function chamar(metodo, url, corpo, ck = cookie) {
  const r = await fetch(base + url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Cookie: ck },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  const txt = await r.text();
  let dados; try { dados = JSON.parse(txt); } catch { dados = txt; }
  return { status: r.status, dados, cookie: sc ? sc.split(';')[0] : null };
}

before(async () => {
  srv = criarApp(abrirBanco(':memory:'));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('exige login e autentica o admin inicial', async () => {
  assert.equal((await chamar('GET', '/api/painel')).status, 401);
  assert.equal((await chamar('POST', '/api/login', { login: 'admin', senha: 'errada' })).status, 401);
  const r = await chamar('POST', '/api/login', { login: 'admin', senha: 'admin123' });
  assert.equal(r.status, 200);
  cookie = r.cookie;
  assert.equal((await chamar('GET', '/api/me')).dados.perfil, 'admin');
});

test('fluxo completo: retirada com assinatura, bloqueio, devolução e histórico', async () => {
  const c = (await chamar('POST', '/api/chaves', { codigo: '01', descricao: 'Sala 1' })).dados;
  const p = (await chamar('POST', '/api/pessoas', { nome: 'Maria', identificacao: '123' })).dados;
  const p2 = (await chamar('POST', '/api/pessoas', { nome: 'João', identificacao: '456' })).dados;

  // sem assinatura -> recusado
  let r = await chamar('POST', '/api/retiradas', { chave_id: c.id, pessoa_id: p.id });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /assinatura/i);
  // assinatura inválida
  r = await chamar('POST', '/api/retiradas', { chave_id: c.id, pessoa_id: p.id, assinatura: 'javascript:alert(1)' });
  assert.equal(r.status, 400);

  r = await chamar('POST', '/api/retiradas', { chave_id: c.id, pessoa_id: p.id, assinatura: ASS, previsao_devolucao: '2000-01-01T10:00' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.assinada_retirada, 1);

  // chave já retirada
  r = await chamar('POST', '/api/retiradas', { chave_id: c.id, pessoa_id: p2.id, assinatura: ASS });
  assert.equal(r.status, 409);

  const painel = (await chamar('GET', '/api/painel')).dados;
  assert.equal(painel.totais.atrasadas, 1);
  assert.equal(painel.chaves[0].pessoa_nome, 'Maria');

  r = await chamar('POST', '/api/devolucoes', { chave_id: c.id, devolvida_por_id: p2.id, assinatura: ASS });
  assert.equal(r.status, 200);
  assert.equal((await chamar('POST', '/api/devolucoes', { chave_id: c.id, assinatura: ASS })).status, 409);

  const hist = (await chamar('GET', '/api/movimentacoes')).dados;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].devolvida_por_nome, 'João');
  assert.equal(hist[0].assinatura_retirada, undefined, 'listagem não carrega imagens');

  const det = (await chamar('GET', `/api/movimentacoes/${hist[0].id}`)).dados;
  assert.equal(det.assinatura_retirada, ASS);
  assert.equal(det.assinatura_devolucao, ASS);

  const csv = await chamar('GET', '/api/movimentacoes?formato=csv');
  assert.match(csv.dados, /Assinou retirada/);
  assert.match(csv.dados, /Maria/);
});

test('chave restrita só pode ser retirada por autorizados', async () => {
  const c = (await chamar('POST', '/api/chaves', { codigo: 'R1', descricao: 'Cofre', restrita: true })).dados;
  const p = (await chamar('POST', '/api/pessoas', { nome: 'Ana', identificacao: '789' })).dados;
  let r = await chamar('POST', '/api/retiradas', { chave_id: c.id, pessoa_id: p.id, assinatura: ASS });
  assert.equal(r.status, 403);
  await chamar('PUT', `/api/chaves/${c.id}/autorizados`, { pessoa_ids: [p.id] });
  r = await chamar('POST', '/api/retiradas', { chave_id: c.id, pessoa_id: p.id, assinatura: ASS });
  assert.equal(r.status, 200);
});

test('operador não acessa funções de administrador', async () => {
  await chamar('POST', '/api/usuarios', { login: 'op', nome: 'Operador', senha: 'senha123' });
  const ck = (await chamar('POST', '/api/login', { login: 'op', senha: 'senha123' })).cookie;
  assert.equal((await chamar('POST', '/api/chaves', { codigo: 'X', descricao: 'Y' }, ck)).status, 403);
  assert.equal((await chamar('GET', '/api/usuarios', null, ck)).status, 403);
  assert.equal((await chamar('GET', '/api/painel', null, ck)).status, 200);
});
