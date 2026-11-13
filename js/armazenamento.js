'use strict';
/*
 * Armazenamento dos dados no próprio navegador (IndexedDB).
 * Os dados ficam neste computador, neste navegador. Use o Backup!
 */
const BancoLocal = (() => {
  const NOME = 'claviculario-digital';
  let conexao;
  function abrir() {
    if (conexao) return conexao;
    conexao = new Promise((ok, erro) => {
      const r = indexedDB.open(NOME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('assinaturas'); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
    });
    return conexao;
  }
  async function op(loja, modo, fn) {
    const db = await abrir();
    return new Promise((ok, erro) => {
      const tx = db.transaction(loja, modo);
      const req = fn(tx.objectStore(loja));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error || new Error('Não foi possível gravar os dados'));
    });
  }
  return {
    ler: (k) => op('kv', 'readonly', (s) => s.get(k)),
    gravar: (k, v) => op('kv', 'readwrite', (s) => s.put(v, k)),
    lerAssinatura: (id) => op('assinaturas', 'readonly', (s) => s.get(id)),
    gravarAssinatura: (id, v) => op('assinaturas', 'readwrite', (s) => s.put(v, id)),
    todasAssinaturas: async () => {
      const db = await abrir();
      return new Promise((ok, erro) => {
        const out = {}, tx = db.transaction('assinaturas', 'readonly');
        tx.objectStore('assinaturas').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out[c.key] = c.value; c.continue(); } };
        tx.oncomplete = () => ok(out); tx.onerror = () => erro(tx.error);
      });
    },
    limparTudo: async () => { await op('kv', 'readwrite', (s) => s.clear()); await op('assinaturas', 'readwrite', (s) => s.clear()); },
  };
})();
