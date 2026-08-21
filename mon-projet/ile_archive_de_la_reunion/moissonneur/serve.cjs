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
const Env = require('./Env.js');

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

/**
 * Combien d'actes la RÉCOLTE PRÉCÉDENTE avait rapportés.
 *
 * L'avancement en cases dit où on en est dans le travail ; il ne dit pas si
 * la moisson est normale. Comparer au relevé précédent le dit : à mi-parcours
 * on doit être à peu près à la moitié. Un écart franc signale un problème
 * (site qui a changé, filtre trop strict) avant qu'on ait perdu 28 h.
 *
 * Le fichier de référence est actes.csv, celui d'avant. On compte ses lignes
 * une fois, puis on retient le résultat tant que ni sa taille ni sa date ne
 * changent : le relire à chaque rafraîchissement coûterait 8 Mo toutes les
 * cinq secondes pour un nombre qui ne bouge pas.
 */
const REF = process.env.IDLR_REF || path.join(__dirname, 'actes.csv');
let memoRef = null;

function actesReference() {
  let s;
  try { s = fs.statSync(REF); } catch { return null; }
  const sig = s.size + ':' + s.mtimeMs;
  if (memoRef && memoRef.sig === sig) return memoRef.n;

  // Compte les sauts de ligne HORS guillemets : le champ obs en contient.
  let n = 0, dansGuillemets = false, reste = '';
  const fd = fs.openSync(REF, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    for (;;) {
      const lu = fs.readSync(fd, buf, 0, buf.length, null);
      if (!lu) break;
      const bloc = reste + buf.toString('utf8', 0, lu);
      reste = '';
      for (let i = 0; i < bloc.length; i++) {
        const c = bloc[i];
        if (c === '"') dansGuillemets = !dansGuillemets;
        else if (c === '\n' && !dansGuillemets) n++;
      }
    }
  } finally { fs.closeSync(fd); }

  n = Math.max(0, n - 1);                       // moins l'en-tête
  memoRef = { sig, n };
  return n;
}

/**
 * Le coût de chaque case, mesuré lors de la récolte précédente.
 *
 * Compter les cases faites traite un bucket de 400 actes comme un de 4 000.
 * Or c'est le nombre de PAGES qui coûte du temps : une case, c'est une
 * requête par tranche de 50 actes. Sur les premières communes — les plus
 * petites — l'avancement en cases est flatteur et l'heure de fin annoncée
 * bien trop optimiste : 15 h là où le calcul sur les vraies tailles donne
 * 28 h. Une estimation fausse dans ce sens est pire que pas d'estimation.
 *
 * Le relevé précédent donne la taille de chacune des 3 250 cases. On s'en
 * sert comme d'un devis : ce qui reste à faire est chiffré, pas extrapolé.
 */
const REF_CK = process.env.IDLR_REF_CK || path.join(__dirname, 'checkpoint.json');
const PAGE_SIZE = 50;
let memoCout = null;

function coutParCase() {
  let s;
  try { s = fs.statSync(REF_CK); } catch { return null; }
  const sig = s.size + ':' + s.mtimeMs;
  if (memoCout && memoCout.sig === sig) return memoCout.v;

  let totaux;
  try { totaux = JSON.parse(fs.readFileSync(REF_CK, 'utf8')).totals; } catch { return null; }
  if (!totaux || !Object.keys(totaux).length) return null;

  const cout = {};
  let somme = 0;
  for (const [cle, n] of Object.entries(totaux)) {
    const req = Math.max(1, Math.ceil((n || 0) / PAGE_SIZE));
    cout[cle] = req;
    somme += req;
  }
  const v = { cout, somme, cases: Object.keys(totaux).length };
  memoCout = { sig, v };
  return v;
}

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

  // Avancement pondéré par le coût réel de chaque case, quand on le connaît.
  const devis = coutParCase();
  let reqFaites = 0;
  if (devis) for (const k of done) reqFaites += devis.cout[k] || 1;
  const reqTotal = devis ? devis.somme : 0;

  if (!base && done.length) {
    base = { t: now, done: done.length, actes: ck.actes || 0, req: reqFaites };
  }
  let keyRate = 0, etaMin = null;   // cases/min et ETA
  if (base && now > base.t) {
    const min = (now - base.t) / 60000;
    keyRate = (done.length - base.done) / min;

    if (devis && reqTotal > reqFaites) {
      // Rythme en REQUÊTES : le seul qui reste stable d'une commune à l'autre.
      const reqRate = (reqFaites - base.req) / min;
      if (reqRate > 0 && !finished) etaMin = Math.round((reqTotal - reqFaites) / reqRate);
    } else if (keyRate > 0 && !finished) {
      etaMin = Math.round((TOTAL - done.length) / keyRate);
    }
  }

  const last = done[done.length - 1] || '';
  const [lastCommune, lastType, lastLetter] = last.split('|');

  const actes = ck.actes || 0;
  const ref = actesReference();

  return {
    finished, alive, ageSec,
    actes,
    // Deux lectures différentes, et il faut les deux : `pct` dit où on en est
    // dans le TRAVAIL, `pctActes` si la MOISSON est normale. Une récolte peut
    // être à 50 % du travail et n'avoir rapporté que 10 % des actes attendus.
    ref,
    pctActes: ref ? Math.round((actes / ref) * 1000) / 10 : null,
    doneKeys: done.length, totalKeys: TOTAL,
    // `pct` est pondéré par le coût des cases dès qu'on connaît leurs tailles.
    // Sans devis on retombe sur le comptage brut, qui reste mieux que rien.
    pct: reqTotal
      ? Math.round((reqFaites / reqTotal) * 1000) / 10
      : Math.round((done.length / TOTAL) * 1000) / 10,
    pondere: !!reqTotal,
    reqFaites, reqTotal,
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
/* Sous-titre d une carte : le contexte sans voler la vedette au chiffre. */
.card .sub{font-size:11.5px;color:#8a92a3;margin-top:3px;line-height:1.35}
</style></head><body><div class=wrap>
<h1><span class=dot id=dot></span><span id=status>…</span></h1>
<div class=cards>
  <div class=card><div class=k>Actes récoltés</div><div class=v id=actes>—</div><div class=sub id=actesRef></div></div>
  <div class=card><div class=k>Avancement</div><div class=v id=pct>—</div><div class=sub id=pctSub></div></div>
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
  /* Rapport a la recolte precedente : dit si la moisson est normale, la ou
     l avancement en cases ne dit que le chemin parcouru. */
  document.getElementById('actesRef').textContent = s.ref
    ? s.pctActes.toString().replace('.',',')+' % des '+s.ref.toLocaleString('fr-FR')+' du relevé précédent'
    : '';
    /* Virgule decimale : on est en francais, et le contraste avec les autres
     nombres de la page sautait aux yeux. */
  const vg=x=>String(x).replace('.',',');
  document.getElementById('pct').textContent=vg(s.pct)+' %';
  /* Dire sur quoi porte le pourcentage : ponderé par le coût reel des cases
     quand on connait leurs tailles, sinon simple comptage. */
  document.getElementById('pctSub').textContent = s.pondere
    ? s.reqFaites.toLocaleString('fr-FR')+' / '+s.reqTotal.toLocaleString('fr-FR')+' requêtes'
    : s.doneKeys+' / '+s.totalKeys+' cases';
  document.getElementById('cur').textContent=s.last.commune+(s.last.type?' · '+s.last.type+' · '+(s.last.letter||'').toUpperCase():'');
  document.getElementById('rate').textContent=s.keyRate>0?vg(s.keyRate)+' cases/min':'—';
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
  Env.banniere('tableau de bord IDLR');
  console.log(`Ouvrir : ${Env.urlLocale(HOST, PORT)}  (${TOTAL} cases à traiter)`);
  if (HOST === '0.0.0.0') console.log(`Depuis le reseau : http://<ip-du-serveur>:${PORT}`);
});
