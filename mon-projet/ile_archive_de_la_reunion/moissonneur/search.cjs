#!/usr/bin/env node
/**
 * Mini moteur de recherche sur la base SQLite des actes (actes.db).
 * Aucune dépendance : utilise le SQLite intégré de Node (node:sqlite).
 *
 * Lancer :  node --experimental-sqlite search.cjs
 *           (Node 22 exige le flag ; Node 24+ n'en a pas besoin)
 * Réglages (env) : PORT=8091  HOST=0.0.0.0  IDLR_DB=actes.db
 * Accès :  http://10.0.0.1:8091  (via WireGuard)  ou tunnel SSH -L 8091:localhost:8091
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const Env = require('./Env.js');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch { console.error('node:sqlite indisponible — lance avec :  node --experimental-sqlite search.cjs'); process.exit(1); }

const PORT = Number(process.env.PORT || 8091);
const HOST = process.env.HOST || '0.0.0.0';
const DB   = process.env.IDLR_DB || path.join(__dirname, 'actes.db');
const PAGE = 100;

if (!fs.existsSync(DB)) { console.error('Base introuvable : ' + DB); process.exit(1); }
const db = new DatabaseSync(DB, { readOnly: true });

// Liste des communes pour le menu déroulant (depuis Config.js).
function communes() {
  const ctx = { console, Math, Number, String, Array, Object, JSON, parseInt, RegExp, Date };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Config.js'), 'utf8'), ctx, { filename: 'Config.js' });
  return ctx.COMMUNES.map(c => c.nom);
}
const COMMUNES = communes();

function search(q) {
  const cond = [], args = [];
  if (q.nom)     { cond.push('nom LIKE ?');       args.push(String(q.nom).toUpperCase() + '%'); }
  if (q.prenom)  { cond.push('prenom LIKE ?');    args.push('%' + q.prenom + '%'); }
  if (q.commune) { cond.push('commune = ?');      args.push(q.commune); }
  if (q.type)    { cond.push('type_acte = ?');    args.push(q.type); }
  if (q.mat)     { cond.push('matricule = ?');    args.push(String(q.mat).replace(/\D/g, '')); }
  else if (q.matonly) cond.push("matricule <> ''");
  if (q.anneeMin || q.anneeMax) {              // année lue dans date_iso (AAAA-MM-JJ)
    cond.push("date_iso <> ''");
    if (q.anneeMin) { cond.push('CAST(substr(date_iso,1,4) AS INTEGER) >= ?'); args.push(parseInt(q.anneeMin, 10) || 0); }
    if (q.anneeMax) { cond.push('CAST(substr(date_iso,1,4) AS INTEGER) <= ?'); args.push(parseInt(q.anneeMax, 10) || 9999); }
  }

  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const page = Math.max(0, parseInt(q.page, 10) || 0);
  const sql = `SELECT type_acte,commune,date_iso,nom,prenom,sexe,age,conjoint_nom,conjoint_prenom,matricule,obs
               FROM actes ${where} ORDER BY nom,prenom LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, PAGE + 1, page * PAGE);
  const hasMore = rows.length > PAGE;
  return { rows: rows.slice(0, PAGE), page, hasMore };
}

/**
 * Compteurs affiches dans le formulaire.
 *
 * On compte dans actes.csv, PAS dans actes.db : le CSV est ce que harvest.cjs
 * ecrit au fil de la recolte, la base n'en est qu'une copie figee au dernier
 * importer.cjs. Afficher la base donnerait des chiffres en retard, parfois de
 * plusieurs heures, sans que rien ne le signale.
 *
 *   actes       lignes de donnees du CSV
 *   matricules  numeros DISTINCTS ; ce n'est pas le nombre d'actes matricules,
 *               un meme matricule revenant sur la naissance, le mariage et le
 *               deces d'une meme personne. L'infobulle donne les deux.
 */
const CSV = process.env.IDLR_OUT || path.join(__dirname, 'actes.csv');

/**
 * Parcourt le CSV en lecture synchrone par blocs : jamais tout le fichier en
 * memoire (il depasse 200 Mo sur une base complete), et stats() reste
 * synchrone comme le reste du serveur.
 *
 * L'analyse respecte les guillemets : le champ obs contient des virgules et
 * des sauts de ligne, compter les retours chariot donnerait un faux total.
 */
/**
 * Empreinte 64 bits d une ligne (djb2 + sdbm concatenes).
 * On ne garde pas les lignes elles-memes : sur une base complete, 1,2 M de
 * lignes de 200 caracteres feraient 240 Mo en memoire.
 */
function empreinte(champs) {
  var s = champs.join(String.fromCharCode(1));
  var djb2 = 5381, sdbm = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + c) | 0;
    sdbm = (c + (sdbm << 6) + (sdbm << 16) - sdbm) | 0;
  }
  return (djb2 >>> 0).toString(36) + (sdbm >>> 0).toString(36);
}

function compterCsv(chemin) {
  const StringDecoder = require('string_decoder').StringDecoder;
  const dec = new StringDecoder('utf8');
  const fd = fs.openSync(chemin, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);

  let champ = '', col = 0, dansGuillemets = false, guillemetEnAttente = false;
  let entete = null, iMat = 0, iNum = -1, premiere = [], matricule = '', numero = '';
  let champsLigne = [];
  let lignes = 0, actesMatricules = 0;
  const vus = new Set();          // matricules distincts
  const vusNumero = new Set();    // photos distinctes
  const vues = new Set();         // lignes distinctes (empreinte 64 bits)

  function finChamp() {
    if (entete === null) premiere.push(champ);
    else { champsLigne.push(champ); if (col === iMat) matricule = champ; }
    if (entete !== null && col === iMat) matricule = champ;
    if (entete !== null && col === iNum) numero = champ;
    champ = '';
    col++;
  }
  function finLigne() {
    finChamp();
    if (entete === null) {
      entete = premiere.map(function (h) { return h.trim(); });
      const i = entete.indexOf('matricule');
      iMat = i === -1 ? 0 : i;
      iNum = entete.indexOf('numero');
    } else {
      lignes++;
      // Le fichier contient des doublons PARFAITS (memes valeurs partout) :
      // un acte remonte dans plusieurs buckets du moissonneur. On les ecarte.
      // Attention : la cle est la ligne entiere, pas `numero` — une photo
      // porte souvent deux personnes (les epoux d un mariage).
      if (!vues.has(empreinte(champsLigne))) {
        vues.add(empreinte(champsLigne));
        const num = numero.trim();
        if (num) vusNumero.add(num);
        const m = matricule.trim();
        if (m) { actesMatricules++; vus.add(m); }
      }
      matricule = ''; numero = ''; champsLigne = [];
    }
    col = 0;
  }
  function avaler(bloc) {
    for (let i = 0; i < bloc.length; i++) {
      const c = bloc[i];
      if (guillemetEnAttente) {
        guillemetEnAttente = false;
        if (c === '"') { champ += '"'; continue; }
        dansGuillemets = false;
      }
      if (dansGuillemets) {
        if (c === '"') {
          if (i + 1 < bloc.length) {
            if (bloc[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false;
          } else guillemetEnAttente = true;
        } else champ += c;
        continue;
      }
      if (c === '"') { dansGuillemets = true; continue; }
      if (c === ',') { finChamp(); continue; }
      if (c === '\n') { finLigne(); continue; }
      if (c === '\r') continue;              // CRLF : le \n suffit a fermer la ligne
      champ += c;
    }
  }

  try {
    let lu;
    while ((lu = fs.readSync(fd, buf, 0, buf.length, null)) > 0) avaler(dec.write(buf.subarray(0, lu)));
    avaler(dec.end());
  } finally {
    fs.closeSync(fd);
  }
  if (champ !== '' || col > 0) finLigne();    // derniere ligne sans saut final

  return {
    actes: vues.size,                  // releves uniques (doublons parfaits otes)
    photos: vusNumero.size,            // une photo peut porter plusieurs personnes
    lignes: lignes,
    actesMatricules: actesMatricules,
    matricules: vus.size,
    source: 'actes.csv'
  };
}

/** Repli quand le CSV n'est pas la : la base, en le disant. */
function compterBase() {
  const un = function (sql) { try { return db.prepare(sql).get().n; } catch (e) { return null; } };
  return {
    actes:           un('SELECT COUNT(*) AS n FROM actes'),
    actesMatricules: un("SELECT COUNT(*) AS n FROM actes WHERE matricule <> ''"),
    matricules:      un("SELECT COUNT(DISTINCT matricule) AS n FROM actes WHERE matricule <> ''"),
    photos:          un("SELECT COUNT(DISTINCT numero) AS n FROM actes WHERE numero <> ''"),
    source:          'actes.db (actes.csv absent)'
  };
}

/**
 * Memoire indexee sur la taille ET la date du CSV : tant que le fichier n'a
 * pas bouge, les chiffres non plus, on ne relit rien.
 *
 * Quand il a bouge, on relit — sauf si la lecture precedente a coute cher. Le
 * plancher vaut 20 fois cette duree, plafonne a 60 s : on ne passe donc jamais
 * plus de 5 % du temps a recompter. Sur une petite base la lecture est
 * instantanee, le plancher s'evanouit et l'affichage suit le fichier en direct ;
 * sur 250 Mo il protege le serveur pendant une recolte.
 *
 * Un plancher fixe serait le pire des deux : figer une petite base pendant une
 * minute sans raison, et rester trop court pour une grosse.
 */
let memo = null;
function stats() {
  if (!fs.existsSync(CSV)) return compterBase();
  const st = fs.statSync(CSV);
  const cle = st.mtimeMs + ':' + st.size;
  if (memo && memo.cle === cle) return memo.v;

  const plancher = memo ? Math.min(60000, memo.duree * 20) : 0;
  if (memo && Date.now() - memo.t < plancher) return memo.v;

  const t0 = Date.now();
  const v = compterCsv(CSV);
  memo = { cle: cle, v: v, t: Date.now(), duree: Date.now() - t0 };
  return v;
}

/** 39362 -> "39 362" (espace fine insecable, U+202F). */
const fr = (n) => {
  if (n === null || n === undefined) return '?';
  const s = String(n), bouts = [];
  for (let i = s.length; i > 0; i -= 3) bouts.unshift(s.slice(Math.max(0, i - 3), i));
  return bouts.join('\u202f');
};

const PAGEHTML = `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Recherche actes IDLR</title><style>
:root{--background:#ffffff;--foreground:#333333;--card:#ffffff;--border:#e5e7eb;--input:#e5e7eb;
 --muted:#f9fafb;--muted-foreground:#6b7280;--primary:#3b82f6;--primary-foreground:#ffffff;
 --secondary:#f3f4f6;--secondary-foreground:#4b5563;--accent:#e0f2fe;--accent-foreground:#1e3a8a;
 --ring:#3b82f6;--radius:0.375rem}
@media (prefers-color-scheme:dark){:root{--background:#171717;--foreground:#e5e5e5;--card:#262626;
 --border:#404040;--input:#404040;--muted:#1f1f1f;--muted-foreground:#a3a3a3;--primary:#3b82f6;
 --primary-foreground:#ffffff;--secondary:#262626;--secondary-foreground:#e5e5e5;--accent:#1e3a8a;
 --accent-foreground:#bfdbfe;--ring:#3b82f6}}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:14px/1.55 Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:none;margin:0;padding:24px 28px}
h1{font-size:19px;font-weight:650;margin:0 0 3px;letter-spacing:-.01em}
.sub{color:var(--muted-foreground);font-size:13px;margin:0 0 18px}
form{display:flex;flex-wrap:wrap;gap:14px;align-items:end;background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:16px 18px;margin-bottom:16px}
label{display:flex;flex-direction:column;font-size:11px;font-weight:500;color:var(--muted-foreground);gap:5px;text-transform:uppercase;letter-spacing:.03em}
input[type=text],select{background:var(--background);border:1px solid var(--input);color:var(--foreground);border-radius:var(--radius);padding:8px 10px;font-size:14px;font-family:inherit;transition:border-color .12s,box-shadow .12s}
input[type=text]{width:160px}
input.yr{width:78px}
input.yr::placeholder{color:var(--muted-foreground);opacity:.55}
input[type=text]:focus,select:focus{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 25%,transparent)}
.chk{flex-direction:row;align-items:center;gap:7px;color:var(--foreground);font-size:13px;font-weight:500;text-transform:none;letter-spacing:0}
.chk input{accent-color:var(--primary);width:15px;height:15px}
button{font-family:inherit;font-size:14px;font-weight:550;border-radius:var(--radius);padding:9px 18px;cursor:pointer;border:1px solid transparent;transition:filter .12s,background .12s}
button[type=submit]{background:var(--primary);color:var(--primary-foreground)}
button[type=submit]:hover{filter:brightness(1.08)}
button.sec{background:var(--secondary);color:var(--secondary-foreground);border-color:var(--border)}
button.sec:hover{background:var(--muted)}
.meta{color:var(--muted-foreground);font-size:13px;margin:10px 2px 12px}
.tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);background:var(--card)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 14px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
th{color:var(--muted-foreground);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card)}
tbody tr{border-bottom:1px solid var(--border)}
tbody tr:last-child{border-bottom:0}
tbody tr:hover{background:var(--muted)}
/* compteurs de la base : rejetes a droite du formulaire pour qu'on ne les
   prenne pas pour des champs de saisie */
.compteurs{display:flex;gap:8px;margin-left:auto;align-self:center;flex-wrap:wrap}
.compteur{display:inline-flex;align-items:baseline;gap:5px;background:var(--muted);border:1px solid var(--border);border-radius:999px;padding:6px 13px;font-size:12.5px;color:var(--muted-foreground);white-space:nowrap}
.compteur b{color:var(--foreground);font-weight:650;font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
/* Repere d'environnement : visible sans etre criard, absent en prod. */
.envdev{display:inline-block;background:#f59e0b;color:#1f1300;font-weight:700;font-size:10.5px;letter-spacing:.06em;padding:2px 7px;border-radius:4px;vertical-align:1px;margin-right:7px}
.mat{display:inline-block;background:var(--accent);color:var(--accent-foreground);font-weight:600;padding:1px 9px;border-radius:999px;font-size:12px}
.pg{display:flex;gap:8px;align-items:center;margin-top:14px}
.pg button{background:var(--secondary);color:var(--secondary-foreground);border-color:var(--border);padding:7px 14px}
.pg button:hover{background:var(--muted)}
.pg button:disabled{opacity:.45;pointer-events:none}
/* données : chiffres alignés, nom = ancre de lecture, texte secondaire atténué */
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.center{text-align:center}
td.strong{font-weight:600;color:var(--foreground)}
td.muted{color:var(--muted-foreground)}
td.obs{color:var(--muted-foreground);max-width:520px}
/* type d'acte : libellé lisible + pastille de catégorie (repère visuel discret) */
.tag{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted-foreground)}
.dot-N{background:#22c55e}.dot-D{background:#94a3b8}.dot-M{background:#3b82f6}.dot-PM{background:#f59e0b}.dot-DIV{background:#ef4444}
.mat.num{letter-spacing:.02em}
/* bouton en cours de requête */
button[type=submit]{position:relative}
button.busy{color:transparent!important;pointer-events:none}
button.busy::after{content:"";position:absolute;inset:0;margin:auto;width:15px;height:15px;border:2px solid color-mix(in srgb,var(--primary-foreground) 40%,transparent);border-top-color:var(--primary-foreground);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.is-loading{opacity:.5;transition:opacity .15s ease}
/* états vides / chargement / sans résultat */
.state{display:flex;flex-direction:column;align-items:center;gap:5px;padding:56px 24px;color:var(--muted-foreground);text-align:center}
.state svg{width:34px;height:34px;stroke:var(--muted-foreground);stroke-width:1.6;fill:none;opacity:.5;margin-bottom:6px}
.state b{color:var(--foreground);font-weight:600;font-size:14px}
.state p{margin:0;font-size:13px;max-width:360px;line-height:1.5}
.meta b{color:var(--foreground);font-weight:600}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important}}
</style></head><body><div class=wrap>
<h1>Recherche dans les actes IDLR</h1>
<p class=sub>__BADGE__Base généalogique de l'Île de la Réunion — relevés de l'association Arbre</p>
<form id=f onsubmit="go(0);return false">
 <label>Nom (commence par)<input type=text name=nom id=nom autofocus></label>
 <label>Prénom (contient)<input type=text name=prenom id=prenom></label>
 <label>Commune<select name=commune id=commune><option value="">Toutes</option>__COMM__</select></label>
 <label>Type<select name=type id=type><option value="">Tous</option><option value=N>Naissance</option><option value=D>Décès</option><option value=M>Mariage</option><option value=PM>Promesse</option><option value=DIV>Divorce</option></select></label>
 <label>Année (de)<input type=text class=yr name=anneeMin id=anneeMin inputmode=numeric maxlength=4 placeholder=1800></label>
 <label>à<input type=text class=yr name=anneeMax id=anneeMax inputmode=numeric maxlength=4 placeholder=1950></label>
 <label>N° matricule<input type=text name=mat id=mat></label>
 <label class=chk><input type=checkbox id=matonly> matriculés seulement</label>
 <button type=submit>Rechercher</button>
 <button type=button class=sec onclick="document.getElementById('f').reset()">Effacer</button>
 <div class=compteurs>
  <span class=compteur title="Relevés uniques de __SRC__ (doublons parfaits ôtés), portés par __PHOTOS__ photos">__ACTES__&nbsp;actes dans Archives</span>
  <span class=compteur title="Numéros distincts, portés par __ACTESMAT__ actes — source : __SRC__">__MATS__&nbsp;matricules dans Archives</span>
 </div>
</form>
<div class=meta id=meta></div>
<div class=tablewrap id=tw><table><thead><tr>
<th>Type</th><th>Commune</th><th>Date</th><th>Nom</th><th>Prénom</th><th>Sexe</th><th>Âge</th><th>Matricule</th><th>Obs</th><th>Conjoint</th>
</tr></thead><tbody id=tb></tbody></table></div>
<div class=pg id=pg></div>
</div><script>
let cur=0;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
const TYPE={N:'Naissance',D:'Décès',M:'Mariage',PM:'Promesse',DIV:'Divorce'};
const IC_SEARCH='<svg viewBox="0 0 24 24" fill=none stroke-linecap=round stroke-linejoin=round><circle cx=11 cy=11 r=7/><path d="m21 21-4.35-4.35"/></svg>';
const IC_EMPTY='<svg viewBox="0 0 24 24" fill=none stroke-linecap=round stroke-linejoin=round><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11.2V21"/></svg>';
const state=(ic,t,s)=>'<tr><td colspan=10><div class=state>'+ic+'<b>'+t+'</b><p>'+s+'</p></div></td></tr>';
function qs(page){
 const p=new URLSearchParams();
 if($('nom').value)p.set('nom',$('nom').value.trim());
 if($('prenom').value)p.set('prenom',$('prenom').value.trim());
 if($('commune').value)p.set('commune',$('commune').value);
 if($('type').value)p.set('type',$('type').value);
 if($('mat').value)p.set('mat',$('mat').value.trim());
 if($('anneeMin').value)p.set('anneeMin',$('anneeMin').value.trim());
 if($('anneeMax').value)p.set('anneeMax',$('anneeMax').value.trim());
 if($('matonly').checked)p.set('matonly','1');
 p.set('page',page);
 return p.toString();
}
function row(x){
 const conj=[x.conjoint_nom,x.conjoint_prenom].filter(Boolean).join(' ');
 const t=x.type_acte||'';
 const tag='<span class=tag><i class="dot dot-'+esc(t)+'"></i>'+(TYPE[t]||esc(t))+'</span>';
 const mat=x.matricule?'<span class="mat num">'+esc(x.matricule)+'</span>':'';
 return '<tr><td>'+tag+'</td><td>'+esc(x.commune)+'</td><td class=num>'+esc(x.date_iso)
  +'</td><td class=strong>'+esc(x.nom)+'</td><td>'+esc(x.prenom)+'</td><td class=center>'+esc(x.sexe)
  +'</td><td class="num center">'+esc(x.age)+'</td><td>'+mat
  +'</td><td class=obs title="'+esc(x.obs)+'">'+esc(x.obs)+'</td><td class=muted>'+esc(conj)+'</td></tr>';
}
async function go(page){
 cur=page;
 const btn=document.querySelector('button[type=submit]'), tw=$('tw'), tb=$('tb');
 btn.classList.add('busy'); tw.classList.add('is-loading');
 try{
  const r=await(await fetch('/api?'+qs(page))).json();
  if(r.error){tb.innerHTML=state(IC_EMPTY,'Erreur',esc(r.error));$('meta').textContent='';$('pg').innerHTML='';return;}
  if(!r.rows.length){tb.innerHTML=state(IC_EMPTY,'Aucun résultat','Essaie une autre orthographe, retire un critère, ou élargis la commune.');$('meta').textContent='0 résultat';$('pg').innerHTML='';return;}
  tb.innerHTML=r.rows.map(row).join('');
  if(!reduce)tb.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:220,easing:'cubic-bezier(.22,.7,.24,1)'});
  history.replaceState(null,'','?'+qs(page));
 $('meta').innerHTML='<b>'+r.rows.length+'</b> résultat'+(r.rows.length>1?'s':'')+(r.hasMore?' · page '+(page+1)+' — d\\'autres existent, affine ou continue':(page>0?' · page '+(page+1):''));
  const pg=$('pg');pg.innerHTML='';
  if(page>0)pg.innerHTML+='<button class=sec onclick=go('+(page-1)+')>← Précédent</button>';
  if(r.hasMore)pg.innerHTML+='<button class=sec onclick=go('+(page+1)+')>Suivant →</button>';
 }catch(e){tb.innerHTML=state(IC_EMPTY,'Connexion perdue','Le serveur n’a pas répondu. Réessaie dans un instant.');$('meta').textContent='';}
 finally{btn.classList.remove('busy'); tw.classList.remove('is-loading');}
}
/* Une recherche doit pouvoir se partager : ?nom=HOARAU&commune=Saint-Paul
   remplit le formulaire et lance la requete. L URL suit ensuite chaque
   recherche (history.replaceState), donc un signet ramene le meme resultat. */
const P=new URLSearchParams(location.search);
const CHAMPS=['nom','prenom','commune','type','mat','anneeMin','anneeMax'];
let amorce=false;
for(const c of CHAMPS) if(P.get(c)){ $(c).value=P.get(c); amorce=true; }
if(P.get('matonly')==='1'){ $('matonly').checked=true; amorce=true; }
if(amorce) go(Number(P.get('page')||0));
else $('tb').innerHTML=state(IC_SEARCH,'Lance une recherche','Un nom, une commune ou un n° de matricule — puis Rechercher.');
</script></body></html>`.replace('__COMM__', COMMUNES.map(c => `<option>${c}</option>`).join(''));

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api') {
    try {
      const q = Object.fromEntries(u.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(search(q)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, rows: [] }));
    }
  } else {
    // Recalcule a chaque affichage : la base grossit pendant une recolte.
    const s = stats();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGEHTML
      .replace('__ACTES__', '<b>' + fr(s.actes) + '</b>')
      .replace('__MATS__', '<b>' + fr(s.matricules) + '</b>')
      .replace('__ACTESMAT__', fr(s.actesMatricules))
      .replace('__PHOTOS__', fr(s.photos))
      .replace(/__SRC__/g, s.source)
      .replace('__BADGE__', Env.PROD ? '' : '<span class=envdev>DEV</span> '));
  }
}).listen(PORT, HOST, () => {
  Env.banniere('recherche IDLR');
  console.log(`Ouvrir : ${Env.urlLocale(HOST, PORT)}  (base ${DB})`);
  if (HOST === '0.0.0.0') console.log(`Depuis le reseau : http://<ip-du-serveur>:${PORT}`);
});
