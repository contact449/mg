#!/usr/bin/env node
/**
 * Suivi Discord du moissonneur — poste l'avancement sur un webhook Discord.
 * Service indépendant : il ne fait que LIRE checkpoint.json / heartbeat, il ne
 * touche jamais à la récolte.
 *
 * - Résumé périodique tant que ça tourne (défaut : toutes les 30 min).
 * - Alerte IMMÉDIATE quand l'état change : démarré / arrêté / terminé.
 *
 * Usage :  IDLR_DISCORD_WEBHOOK="https://discord.com/api/webhooks/…" node notify.cjs
 *          node notify.cjs --dry     # affiche les messages au lieu de les poster (test)
 * Réglages (env) :
 *          IDLR_DISCORD_WEBHOOK   URL du webhook (obligatoire, sinon mode --dry)
 *          IDLR_NOTIFY_MIN=30     intervalle du résumé périodique (minutes)
 *          IDLR_STALE_SEC=300     sans battement depuis N s => considéré arrêté
 *          IDLR_CK / IDLR_HB / IDLR_OUT   chemins (mêmes défauts que harvest.cjs)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEBHOOK   = process.env.IDLR_DISCORD_WEBHOOK || '';
const DRY       = process.argv.includes('--dry') || !WEBHOOK;
const PERIOD_MS = Number(process.env.IDLR_NOTIFY_MIN || 30) * 60000;
const STALE_SEC = Number(process.env.IDLR_STALE_SEC || 300);
const CK  = process.env.IDLR_CK  || path.join(__dirname, 'checkpoint.json');
const HB  = process.env.IDLR_HB  || path.join(__dirname, 'heartbeat');
const OUT = process.env.IDLR_OUT || path.join(__dirname, 'actes.csv');

function communesCount() {
  const ctx = { console, Math, Number, String, Array, Object, JSON, parseInt, RegExp, Date };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Config.js'), 'utf8'), ctx, { filename: 'Config.js' });
  return ctx.COMMUNES.length;
}
const TOTAL = communesCount() * 5 * 26;   // 3250 cases

function stats() {
  let ck = { done: [], actes: 0 }, mtime = 0, csvMo = 0;
  try { ck = JSON.parse(fs.readFileSync(CK, 'utf8')); } catch {}
  try { mtime = fs.statSync(CK).mtimeMs; } catch {}
  try { mtime = Math.max(mtime, fs.statSync(HB).mtimeMs); } catch {}
  try { csvMo = Math.round(fs.statSync(OUT).size / 1048576 * 10) / 10; } catch {}

  const done = ck.done || [];
  const ageSec = mtime ? Math.round((Date.now() - mtime) / 1000) : null;
  const finished = done.length >= TOTAL;
  const started = done.length > 0 || ageSec !== null;
  const alive = started && !finished && ageSec !== null && ageSec < STALE_SEC;
  const state = finished ? 'fini' : alive ? 'vivant' : started ? 'mort' : 'attente';

  const [commune, type, letter] = (done[done.length - 1] || '').split('|');
  return {
    state, ageSec, csvMo,
    actes: ck.actes || 0,
    pct: Math.round(done.length / TOTAL * 1000) / 10,
    commune: commune || '—', type: type || '', letter: (letter || '').toUpperCase(),
  };
}

function fmt(s) {
  const n = s.actes.toLocaleString('fr-FR');
  const pos = s.commune + (s.type ? ` (${s.type}·${s.letter})` : '');
  if (s.state === 'fini')    return `✅ **Terminé** · ${n} actes · ${s.csvMo} Mo`;
  if (s.state === 'vivant')  return `🟢 **En cours** · ${n} actes · ${s.pct}% · ${pos}`;
  if (s.state === 'mort')    return `🔴 **Arrêté** (rien depuis ${Math.round(s.ageSec / 60)} min) · dernier : ${pos} · ${n} actes`;
  return `⚪ En attente (pas encore démarré)`;
}

async function post(content) {
  if (DRY) { console.log('[dry]', content); return; }
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Moissonneur IDLR', content }),
    });
  } catch (e) { console.error('webhook Discord KO :', e.message); }
}

let prev = null, lastPeriodic = 0;
async function tick() {
  const s = stats();
  const now = Date.now();
  const changed = prev !== null && s.state !== prev;
  const periodic = s.state === 'vivant' && now - lastPeriodic >= PERIOD_MS;

  if (prev === null) { await post('👀 Suivi démarré — ' + fmt(s)); lastPeriodic = now; }
  else if (changed)  { await post(fmt(s)); if (s.state === 'vivant') lastPeriodic = now; }
  else if (periodic) { await post(fmt(s)); lastPeriodic = now; }

  prev = s.state;
}

if (process.argv.includes('--selftest')) {
  const assert = (c, m) => { if (!c) throw new Error('SELFTEST: ' + m); };
  assert(fmt({ state: 'vivant', actes: 176826, pct: 12.3, commune: 'Saint-Paul', type: 'N', letter: 'H', csvMo: 40 }).includes('En cours'), 'vivant');
  assert(fmt({ state: 'mort', ageSec: 360, commune: 'Saint-Paul', type: 'N', letter: 'H', actes: 5 }).includes('Arrêté'), 'mort');
  assert(fmt({ state: 'fini', actes: 1500000, csvMo: 150 }).includes('Terminé'), 'fini');
  assert(TOTAL === 3250, 'total cases');
  console.log('selftest OK');
} else {
  console.log(DRY ? '(mode --dry : messages affichés, pas postés)' : 'Suivi Discord actif.');
  tick();
  setInterval(tick, 60000);   // vérifie l'état chaque minute
}
