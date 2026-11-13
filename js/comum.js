'use strict';
// Funções usadas pela tela de controle e pelo monitor.
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
