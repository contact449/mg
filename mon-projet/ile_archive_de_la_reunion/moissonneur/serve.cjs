#!/usr/bin/env node
/**
 * Tableau de bord du moissonneur — petit serveur HTTP sans dépendance.
 * Lit checkpoint.json / actes.csv et affiche l'avancement en direct.
 *
 * Usage :  node serve.cjs              # écoute sur http://<vps>:8080
 * Réglages (env) : PORT=8080  HOST=0.0.0.0  IDLR_CK=checkpoint.json  IDLR_OUT=actes.csv
 *
 * Accès depuis le Mac (VPS derrière WireGuard) : http://10.0.0.1:8080
 * Sinon, tunnel SSH :  ssh -p 2222 -L 8080:localhost:8080 ubuntu@10.0.0.1
 *                      puis http://localhost:8080 sur le Mac.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const CK   = process.env.IDLR_CK  || path.join(__dirname, 'checkpoint.json');
const HB   = process.env.IDLR_HB  || path.join(__dirname, 'heartbeat');
const OUT  = process.env.IDLR_OUT || path.join(__dirname, 'actes.csv');
const TYPES = 5, LETTERS = 26;

// Liste ordonnée des 25 communes (réutilise Config.js du moissonneur).
function communes() {
  const ctx = { console, Math, Number, String, Array, Object, JSON, parseInt, RegExp, Date };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Config.js'), 'utf8'), ctx, { filename: 'Config.js' });
  return ctx.COMMUNES.map(c => c.nom);
}
const COMMUNES = communes();
const PER_COMMUNE = TYPES * LETTERS;            // 130 cases par commune
const TOTAL = COMMUNES.length * PER_COMMUNE;    // 3250 cases au total

let base = null;   // repère mémoire pour calculer le rythme (rempli au 1er /stats)

function stats() {
  let ck = { done: [], actes: 0 }, mtime = 0, csvSize = 0;
  try { ck = JSON.parse(fs.readFileSync(CK, 'utf8')); } catch {}
  try { mtime = fs.statSync(CK).mtimeMs; } catch {}
  try { mtime = Math.max(mtime, fs.statSync(HB).mtimeMs); } catch {}  // battement = activité réelle (même en plein gros bucket)
  try { csvSize = fs.statSync(OUT).size; } catch {}

  const done = ck.done || [];
  const per = {};
  for (const k of done) { const c = k.split('|')[0]; per[c] = (per[c] || 0) + 1; }

  const now = Date.now();
  const ageSec = mtime ? Math.round((now - mtime) / 1000) : null;
  const finished = done.length >= TOTAL;
  const alive = !finished && ageSec !== null && ageSec < 120;

  if (!base && done.length) base = { t: now, done: done.length, actes: ck.actes || 0 };
  let keyRate = 0, etaMin = null;   // cases/min et ETA
  if (base && now > base.t) {
    keyRate = (done.length - base.done) / ((now - base.t) / 60000);
    if (keyRate > 0 && !finished) etaMin = Math.round((TOTAL - done.length) / keyRate);
  }

  const last = done[done.length - 1] || '';
  const [lastCommune, lastType, lastLetter] = last.split('|');

  return {
    finished, alive, ageSec,
    actes: ck.actes || 0,
    doneKeys: done.length, totalKeys: TOTAL,
    pct: Math.round((done.length / TOTAL) * 1000) / 10,
    csvMo: Math.round((csvSize / 1048576) * 10) / 10,
    keyRate: Math.round(keyRate * 10) / 10,
    etaMin,
    last: { commune: lastCommune || '—', type: lastType || '', letter: lastLetter || '' },
    communes: COMMUNES.map(c => ({ nom: c, done: per[c] || 0, total: PER_COMMUNE })),
  };
}

const PAGE = `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Moissonneur IDLR</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#0f1115;color:#e6e6e6}
.wrap{max-width:900px;margin:0 auto;padding:24px}
h1{font-size:18px;margin:0 0 16px;font-weight:600}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:#1a1d24;border:1px solid #262a33;border-radius:10px;padding:14px}
.card .k{font-size:12px;color:#8a92a3;text-transform:uppercase;letter-spacing:.04em}
.card .v{font-size:24px;font-weight:700;margin-top:4px}
.bar{height:10px;background:#262a33;border-radius:6px;overflow:hidden;margin:6px 0 20px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);width:0;transition:width .4s}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.cm{background:#1a1d24;border:1px solid #262a33;border-radius:8px;padding:8px 10px}
.cm .n{display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px}
.cm .n b{color:#8a92a3;font-weight:500}
.cm .mini{height:6px;background:#262a33;border-radius:4px;overflow:hidden}
.cm .mini>i{display:block;height:100%;background:#22c55e;width:0}
.muted{color:#8a92a3;font-size:13px}
</style></head><body><div class=wrap>
<h1><span class=dot id=dot></span><span id=status>…</span></h1>
<div class=cards>
  <div class=card><div class=k>Actes récoltés</div><div class=v id=actes>—</div></div>
  <div class=card><div class=k>Avancement</div><div class=v id=pct>—</div></div>
  <div class=card><div class=k>En cours</div><div class=v id=cur style=font-size:18px>—</div></div>
  <div class=card><div class=k>Rythme</div><div class=v id=rate style=font-size:18px>—</div></div>
  <div class=card><div class=k>Fin estimée</div><div class=v id=eta style=font-size:18px>—</div></div>
  <div class=card><div class=k>CSV</div><div class=v id=csv style=font-size:18px>—</div></div>
</div>
<div class=bar><i id=barfill></i></div>
<div class=grid id=grid></div>
<p class=muted id=foot></p>
</div><script>
function fmtEta(m){if(m==null)return '—';if(m<60)return m+' min';const h=Math.floor(m/60);return h+' h '+(m%60)+' min';}
async function tick(){
 try{
  const s=await (await fetch('/stats')).json();
  const dot=document.getElementById('dot'),st=document.getElementById('status');
  if(s.finished){dot.style.background='#3b82f6';st.textContent='Terminé ✓';}
  else if(s.alive){dot.style.background='#22c55e';st.textContent='En cours';}
  else{dot.style.background='#ef4444';st.textContent='Inactif'+(s.ageSec!=null?' (rien depuis '+s.ageSec+'s)':' (pas démarré)');}
  document.getElementById('actes').textContent=s.actes.toLocaleString('fr-FR');
  document.getElementById('pct').textContent=s.pct+' %';
  document.getElementById('cur').textContent=s.last.commune+(s.last.type?' · '+s.last.type+' · '+(s.last.letter||'').toUpperCase():'');
  document.getElementById('rate').textContent=s.keyRate>0?s.keyRate+' cases/min':'—';
  document.getElementById('eta').textContent=fmtEta(s.etaMin);
  document.getElementById('csv').textContent=s.csvMo+' Mo';
  document.getElementById('barfill').style.width=s.pct+'%';
  document.getElementById('grid').innerHTML=s.communes.map(c=>{
   const p=Math.round(c.done/c.total*100);
   return '<div class=cm><div class=n><span>'+c.nom+'</span><b>'+c.done+'/'+c.total+'</b></div><div class=mini><i style=width:'+p+'%></i></div></div>';
  }).join('');
  document.getElementById('foot').textContent='Mise à jour '+new Date().toLocaleTimeString('fr-FR')+' · '+s.doneKeys+'/'+s.totalKeys+' cases';
 }catch(e){document.getElementById('status').textContent='serveur injoignable';}
}
tick();setInterval(tick,3000);
</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  }
}).listen(PORT, HOST, () => {
  console.log(`Tableau de bord sur http://${HOST}:${PORT}  (${TOTAL} cases à traiter)`);
});
