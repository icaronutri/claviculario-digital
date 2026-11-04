'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco } = require('../src/db');
const { criarApp } = require('../src/app');

const ASS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';
let srv, base, cookie = '';
const ids = {};

async function chamar(metodo, url, corpo, ck = cookie) {
  const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: ck }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie');
  const txt = await r.text();
  let dados; try { dados = JSON.parse(txt); } catch { dados = txt; }
  return { status: r.status, dados, cookie: sc ? sc.split(';')[0] : null };
}
const pos = async (n) => (await chamar('GET', '/api/painel')).dados.posicoes.find((p) => p.numero === n);

before(async () => {
  srv = criarApp(abrirBanco(':memory:'));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('login do admin inicial e bloqueio sem sessão', async () => {
  assert.equal((await chamar('GET', '/api/painel', null, '')).status, 401);
  assert.equal((await chamar('POST', '/api/login', { login: 'admin', senha: 'x' })).status, 401);
  const r = await chamar('POST', '/api/login', { login: 'admin', senha: 'admin123' });
  assert.equal(r.status, 200);
  cookie = r.cookie;
});

test('cadastros: militares e viatura fixa em posição', async () => {
  ids.sgt1 = (await chamar('POST', '/api/pessoas', { nome: 'Silva', posto: '2S', identificacao: '111' })).dados.id;
  ids.sgt2 = (await chamar('POST', '/api/pessoas', { nome: 'Costa', posto: '1S', identificacao: '222' })).dados.id;
  ids.mot1 = (await chamar('POST', '/api/pessoas', { nome: 'Souza', posto: 'CB', identificacao: '333' })).dados.id;
  ids.mot2 = (await chamar('POST', '/api/pessoas', { nome: 'Lima', posto: 'S1', identificacao: '444' })).dados.id;
  const v = await chamar('POST', '/api/viaturas', { prefixo: 'VTR-01', modelo: 'Hilux', placa: 'abc-1d23', posicao: 1 });
  assert.equal(v.status, 200);
  assert.equal(v.dados.placa, 'ABC1D23');
  ids.vtr1 = v.dados.id;
  assert.equal((await chamar('POST', '/api/viaturas', { modelo: 'X', placa: 'ZZZ9999', posicao: 1 })).status, 409, 'posição ocupada');
  assert.equal((await pos(1)).status, 'disponivel');
  assert.equal((await pos(2)).status, 'vaga');
});

test('sem Sgt de Dia de serviço não registra saída', async () => {
  const r = await chamar('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'X', assinatura: ASS });
  assert.equal(r.status, 409);
  assert.match(r.dados.erro, /Sgt de Dia/);
  assert.equal((await chamar('POST', '/api/servico/assumir', { sargento_id: ids.sgt1 })).status, 200);
});

test('saída da viatura (amarelo) e devolução por outro motorista no serviço seguinte', async () => {
  let r = await chamar('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'Transporte ao HFA' });
  assert.equal(r.status, 400, 'assinatura obrigatória');
  r = await chamar('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: '', assinatura: ASS });
  assert.equal(r.status, 400, 'missão obrigatória');
  r = await chamar('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'Transporte ao HFA', km_saida: 1000, assinatura: ASS });
  assert.equal(r.status, 200);
  const p1 = await pos(1);
  assert.equal(p1.status, 'em_uso');
  assert.equal(p1.missao, 'Transporte ao HFA');
  assert.equal((await chamar('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot2, missao: 'Y', assinatura: ASS })).status, 409);

  // passagem de serviço: a cautela continua aberta
  r = await chamar('POST', '/api/servico/assumir', { sargento_id: ids.sgt2, obs_passagem: 'VTR-01 em missão' });
  assert.equal(r.status, 200);
  const atual = (await chamar('GET', '/api/servico/atual')).dados;
  assert.equal(atual.servico.sargento_nome, 'Costa');
  assert.equal(atual.cautelas_abertas.length, 1);

  assert.equal((await chamar('POST', '/api/cautelas/retorno', { viatura_id: ids.vtr1, motorista_id: ids.mot2, km_retorno: 900, assinatura: ASS })).status, 400, 'km menor');
  r = await chamar('POST', '/api/cautelas/retorno', { viatura_id: ids.vtr1, motorista_id: ids.mot2, km_retorno: 1080, assinatura: ASS });
  assert.equal(r.status, 200);
  assert.equal((await pos(1)).status, 'disponivel');

  const hist = (await chamar('GET', '/api/cautelas')).dados;
  assert.equal(hist[0].motorista_saida, 'Souza');
  assert.equal(hist[0].motorista_retorno, 'Lima');
  assert.equal(hist[0].sgt_saida, '2S Silva');
  assert.equal(hist[0].sgt_retorno, '1S Costa');
  const det = (await chamar('GET', `/api/cautelas/${hist[0].id}`)).dados;
  assert.equal(det.assinatura_saida, ASS);
  const csv = (await chamar('GET', '/api/cautelas?formato=csv')).dados;
  assert.match(csv, /Km rodados/);
  assert.match(csv, /;80;/);
});

test('manutenção deixa vermelho e impede a saída', async () => {
  assert.equal((await chamar('POST', `/api/viaturas/${ids.vtr1}/manutencao`, { em_manutencao: true, motivo: 'Troca de pneu' })).status, 200);
  assert.equal((await pos(1)).status, 'manutencao');
  assert.equal((await chamar('POST', '/api/cautelas/saida', { viatura_id: ids.vtr1, motorista_id: ids.mot1, missao: 'X', assinatura: ASS })).status, 409);
  await chamar('POST', `/api/viaturas/${ids.vtr1}/manutencao`, { em_manutencao: false });
  assert.equal((await pos(1)).status, 'disponivel');
});

test('viatura temporária do Rancho: entra em posição vaga e pode não retornar', async () => {
  let r = await chamar('POST', '/api/temporarias/entrada', { modelo: 'Sprinter', placa: 'RAN0001', setor_origem: 'Rancho', posicao: 1, entregue_por: 'Sd Pereira' });
  assert.equal(r.status, 409, 'posição 1 é da fixa');
  r = await chamar('POST', '/api/temporarias/entrada', { prefixo: 'RAN-03', modelo: 'Sprinter', placa: 'RAN0001', setor_origem: 'Rancho', posicao: 20, entregue_por: 'Sd Pereira' });
  assert.equal(r.status, 200);
  const tmp = r.dados.id;
  let p20 = await pos(20);
  assert.equal(p20.status, 'disponivel');
  assert.equal(p20.tipo, 'temporaria');

  await chamar('POST', '/api/cautelas/saida', { viatura_id: tmp, motorista_id: ids.mot1, missao: 'Buscar gêneros', assinatura: ASS });
  assert.equal((await chamar('POST', '/api/cautelas/retorno', { viatura_id: ids.vtr1, nao_retornou: true })).status, 409);
  r = await chamar('POST', '/api/cautelas/retorno', { viatura_id: tmp, nao_retornou: true, obs: 'Seguiu direto para o Rancho' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.encerramento, 'nao_retornou');
  p20 = await pos(20);
  assert.equal(p20.status, 'vaga', 'posição liberada');

  // mesma viatura volta outro dia, em outra posição
  r = await chamar('POST', '/api/temporarias/entrada', { modelo: 'Sprinter', placa: 'RAN-0001', setor_origem: 'Rancho', posicao: 22, entregue_por: 'Sd Pereira' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.id, tmp);
  // devolvida ao setor de origem sem missão
  r = await chamar('POST', `/api/temporarias/${tmp}/saida`, { recebido_por: 'Cb Rocha (Rancho)', assinatura: ASS });
  assert.equal(r.status, 200);
  assert.equal((await pos(22)).status, 'vaga');
  const regs = (await chamar('GET', '/api/temporarias/registros')).dados.map((x) => x.tipo);
  assert.deepEqual(regs, ['saida', 'entrada', 'nao_retornou', 'entrada']);
});

test('operador (Sgt de Dia) não acessa funções de administrador', async () => {
  await chamar('POST', '/api/usuarios', { login: 'sgtdia', nome: 'Sgt de Dia', senha: 'senha123' });
  const ck = (await chamar('POST', '/api/login', { login: 'sgtdia', senha: 'senha123' })).cookie;
  assert.equal((await chamar('POST', '/api/viaturas', { modelo: 'X', placa: 'Y', posicao: 3 }, ck)).status, 403);
  assert.equal((await chamar('PUT', '/api/posicoes', { total: 10 }, ck)).status, 403);
  assert.equal((await chamar('GET', '/api/painel', null, ck)).status, 200);
});

test('não reduz posições abaixo de uma ocupada', async () => {
  assert.equal((await chamar('PUT', '/api/posicoes', { total: 0 })).status, 400);
  assert.equal((await chamar('PUT', '/api/posicoes', { total: 40 })).status, 200);
  assert.equal((await chamar('GET', '/api/painel')).dados.totais.posicoes, 40);
});
