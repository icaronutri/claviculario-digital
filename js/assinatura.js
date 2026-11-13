'use strict';
/**
 * Quadro de assinatura com o dedo (touch), caneta ou mouse.
 * Uso: const a = criarQuadroAssinatura(elementoContainer);
 *      a.vazio()  -> true se ninguém assinou
 *      a.limpar()
 *      a.png()    -> data URL "data:image/png;base64,..."
 */
function criarQuadroAssinatura(container) {
  container.classList.add('assinatura');
  container.innerHTML = `
    <canvas aria-label="Assine aqui com o dedo"></canvas>
    <span class="assinatura-dica">Assine aqui com o dedo</span>
    <button type="button" class="btn link assinatura-limpar">Limpar</button>`;
  const canvas = container.querySelector('canvas');
  const dica = container.querySelector('.assinatura-dica');
  const ctx = canvas.getContext('2d');
  let desenhando = false, tracos = 0, ultimo = null;

  function ajustar() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    const copia = tracos ? canvas.toDataURL() : null;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f3a';
    if (copia) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = copia; }
  }

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5 }; };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    desenhando = true; ultimo = pos(e);
    ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    tracos++; dica.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!desenhando) return;
    e.preventDefault();
    const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of eventos) {
      const atual = pos(ev);
      ctx.lineWidth = 1.5 + atual.p * 2;
      ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(atual.x, atual.y); ctx.stroke();
      ultimo = atual;
    }
  });
  const parar = () => { desenhando = false; };
  canvas.addEventListener('pointerup', parar);
  canvas.addEventListener('pointercancel', parar);

  const api = {
    vazio: () => tracos === 0,
    limpar() { ctx.clearRect(0, 0, canvas.width, canvas.height); tracos = 0; dica.hidden = false; },
    png() {
      // exporta com fundo branco para ficar legível em qualquer visualizador
      const out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height;
      const o = out.getContext('2d');
      o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    },
  };
  container.querySelector('.assinatura-limpar').addEventListener('click', () => api.limpar());
  new ResizeObserver(ajustar).observe(canvas);
  requestAnimationFrame(ajustar);
  return api;
}
