#!/usr/bin/env node
/**
 * Moissonneur IDLR — récupère tous les actes (et leur n° de matricule) de
 * iledelareunion-archive.com et les écrit en CSV. Conçu pour tourner en continu
 * sur un VPS ; reprend après coupure via un checkpoint JSON.
 *
 * Réutilise TEL QUEL le parser reverse-engineeré (Parser.js) et les données
 * de communes (Config.js) — copiés dans CE dossier, chargés dans un contexte
 * vm. Seule la couche réseau (session PHP + throttle) est réécrite pour Node.
 * Dossier autonome : à copier tel quel sur le VPS.
 *
 * Flux réel (confirmé en live) :
 *   1. GET  recherche.php?rech=1&code=<7 chiffres commune>&phonex=0  -> form + PHPSESSID
 *   2. POST recherche.php  avec { code, rech:2, nom, choix, s, ta, ... }  -> page 1
 *      (les champs cachés `code` et `rech=2` sont OBLIGATOIRES dans le corps)
 *   3. GET  recherche.php?rech=4&x=<offset>&<critères>  -> pages suivantes
 * La recherche par SECTEUR (rech=3) est réservée aux responsables connectés :
 * on énumère donc commune par commune (accès public).
 *
 * Énumération : 26 initiales (a-z) × 5 types d'actes (N/D/M/PM/DIV) × 25
 * communes, chaque recherche paginée en entier. Pas de plafond -> rien n'est
 * perdu. Par défaut le CSV ne garde QUE les actes portant un n° de matricule
 * (le reste est lu mais pas écrit) ; IDLR_ALL=1 pour tout écrire.
 * NB : le filtre est à l'écriture — on lit quand même toutes les pages, donc
 * la durée est la même (~15-26 h), seul le CSV est plus petit.
 *
 * Usage :   node harvest.cjs               # lance / reprend la récolte
 *           node harvest.cjs --refresh     # actualise : ne récolte que les buckets
 *                                          #   dont le total a augmenté, dédoublonne par numéro
 *           node harvest.cjs --selftest    # vérifs logiques hors-ligne
 * Réglages (env) :
 *           IDLR_ALL=1                     # écrire TOUS les actes (défaut : matriculés seuls)
 *           IDLR_THROTTLE_MS=3000          # délai mini entre requêtes (défaut 3s)
 *           IDLR_OUT=actes.csv  IDLR_CK=checkpoint.json
 *
 * ponytail: initiales a-z seulement (patronymes à initiale accentuée rares) ;
 * si un jour une commune en manque, seeder aussi les initiales accentuées.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------------------ config */

const GS_DIR      = __dirname;   // Config.gs et Parser.gs sont dans ce dossier
const THROTTLE_MS = Number(process.env.IDLR_THROTTLE_MS || 3000);
const OUT_CSV     = process.env.IDLR_OUT || path.join(__dirname, 'actes.csv');
const CK_FILE     = process.env.IDLR_CK  || path.join(__dirname, 'checkpoint.json');
const HB_FILE     = process.env.IDLR_HB  || path.join(__dirname, 'heartbeat');  // battement de cœur (mtime rafraîchi à chaque requête)
const KEEP_ALL    = process.env.IDLR_ALL === '1';  // par défaut : seulement les actes matriculés
const PAGE_SIZE   = 50;
const MAX_PAGES   = 3000;   // garde-fou anti-boucle (150k actes/recherche : jamais atteint)
const REQ_TIMEOUT_MS = 30000;  // au-delà, on abandonne la requête et on réessaie
const MAX_RETRIES    = 5;      // essais avant d'abandonner sur une requête
const RETRY_BASE_MS  = 5000;   // backoff : 5s, 10s, 15s, 20s
const TYPES       = ['N', 'D', 'M', 'PM', 'DIV'];
const LETTERS     = 'abcdefghijklmnopqrstuvwxyz'.split('');
const USER_AGENT  = 'OCI-EXPRESS-Genealogie/1.0 (+contact: webmaster@oci-express.re)';
const BASE        = 'http://www.iledelareunion-archive.com';
const PATH        = '/recherche.php';

/* --------------------------- charge Config.gs + Parser.gs (code validé) --- */

function loadGs() {
  const ctx = { console, Math, Number, String, Array, Object, JSON, parseInt, RegExp, Date };
  vm.createContext(ctx);
  for (const f of ['Config.js', 'Parser.js']) {
    vm.runInContext(fs.readFileSync(path.join(GS_DIR, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

/* --------------------------------------------------------------- réseau ---- */

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
async function throttle() {
  const wait = THROTTLE_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

function cookieHeader(session) {
  return Object.keys(session.cookies).map(k => k + '=' + session.cookies[k]).join('; ');
}
function absorbCookies(session, res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of list) {
    const kv = String(line).split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) session.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
}

async function fetchHtml(session, url, opts = {}) {
  await throttle();
  try { fs.writeFileSync(HB_FILE, ''); } catch {}   // battement : prouve l'activité même sur un gros bucket
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  };
  const cookie = cookieHeader(session);
  if (cookie) headers['Cookie'] = cookie;
  if (opts.referer) headers['Referer'] = opts.referer;

  const init = { method: opts.method || 'GET', headers, redirect: 'follow' };
  if (opts.payload) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(opts.payload).toString();
  }

  // Reprise sur aléas réseau (ECONNRESET, timeout, 5xx) : un serveur associatif
  // qui coupe une connexion ne doit pas tuer une récolte de plusieurs heures.
  let buf, lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
      absorbCookies(session, res);
      if (res.status >= 500) throw new Error('HTTP ' + res.status);   // transitoire -> retry
      if (res.status >= 400) throw Object.assign(new Error('HTTP ' + res.status + ' sur ' + url), { fatal: true });
      buf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      if (e.fatal || attempt === MAX_RETRIES) throw e;
      lastErr = e;
      const backoff = RETRY_BASE_MS * attempt;   // 5s, 10s, 15s...
      console.warn(`réseau KO (${e.cause?.code || e.code || e.message}) — tentative ${attempt}/${MAX_RETRIES}, nouvel essai dans ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
  if (!buf) throw lastErr;

  let html = buf.toString('utf8');
  if (/Ã©|Ã¨|Ã |Â°/.test(html)) html = buf.toString('latin1');  // vieilles pages en ISO-8859-1
  return html;
}

/* ---------------------------------------------- recherche (1 commune) ----- */

function formUrl(code) { return BASE + PATH + '?rech=1&code=' + code + '&phonex=0'; }

function pageUrl(code, type, nom, x) {
  const p = { x, rech: 4, choix: 2, nom, s: 'T', ta: type, code,
    prenom: '', mere: '', ordre: 'alpha', dateinf: '', datesup: '', phonex: 0 };
  return BASE + PATH + '?' + Object.keys(p)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
}

function payload(code, type, nom) {
  return { code, rech: 2, nom, choix: 2, prenom: '', dateinf: '', datesup: '',
    mere: '', ordre: 'alpha', s: 'T', ta: type };
}

async function openCommune(gs, communeNom) {
  const c = gs.findCommune(communeNom);
  if (!c) throw new Error('Commune inconnue : ' + communeNom);
  const session = { cookies: {}, code: c.code };
  await fetchHtml(session, formUrl(c.code));  // pose PHPSESSID + périmètre
  return session;
}

/** POST page 1. Rétablit la session si le site a oublié le périmètre. */
async function probe(gs, session, type, nom) {
  const post = () => fetchHtml(session, BASE + PATH,
    { method: 'POST', payload: payload(session.code, type, nom), referer: formUrl(session.code) });
  let data = gs.parseResultsPage(await post(), BASE);
  if (data.isForm) {                                   // session expirée -> on rouvre
    await fetchHtml(session, formUrl(session.code));
    data = gs.parseResultsPage(await post(), BASE);
  }
  return data;
}

/** Récupère les pages 2..n (page 1 déjà dans acc). */
async function fetchRest(gs, session, type, nom, total, acc) {
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
  for (let i = 1; i < pages; i++) {
    let data = gs.parseResultsPage(
      await fetchHtml(session, pageUrl(session.code, type, nom, i * PAGE_SIZE),
        { referer: formUrl(session.code) }), BASE);
    if (data.isForm) {                                 // session perdue -> rouvre + rejoue la page
      await fetchHtml(session, formUrl(session.code));
      data = gs.parseResultsPage(
        await fetchHtml(session, pageUrl(session.code, type, nom, i * PAGE_SIZE),
          { referer: formUrl(session.code) }), BASE);
      if (data.isForm) break;
    }
    acc.push(...data.results);
  }
  if (Math.ceil(total / PAGE_SIZE) > MAX_PAGES) {
    console.warn(`[${nom}/${type}] PLAFOND ${MAX_PAGES} pages atteint (total ${total}) — reste tronqué`);
  }
}

/* -------------------------------------------------------------------- CSV - */

// Matricule dans l'obs : « n°2-537 », « N° 89446 »… Le numéro peut être découpé
// par un tiret ou un point (« 2-537 » = 2537) -> on capture les séparateurs puis
// on ne garde que les chiffres. Pas d'espace dans la classe (éviterait d'avaler
// le texte/l'année qui suit, ex. « N°537 °1833 »).
const MATRICULE_RE = /[nN]\s*°\s*(\d+(?:[.\-]\d+)*)/;
const COLS = ['matricule', 'type_acte', 'commune', 'date_iso', 'nom', 'prenom',
  'sexe', 'conjoint_nom', 'conjoint_prenom', 'age', 'origine', 'obs', 'numero',
  'url_demande_photo'];

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvLine(vals) { return vals.map(csvField).join(',') + '\n'; }

function hasMatricule(rec) { return MATRICULE_RE.test(rec.obs || ''); }
function matriculeNum(obs) {                       // « N°2-537 » -> « 2537 »
  const m = MATRICULE_RE.exec(obs || '');
  return m ? m[1].replace(/\D/g, '') : '';
}

function recordToRow(rec) {
  const p = (rec.personnes && rec.personnes.principal) || {};
  const c = (rec.personnes && rec.personnes.conjoint) || {};
  return [matriculeNum(rec.obs), rec.type_acte, rec.commune, rec.date_iso, p.nom || '',
    p.prenom || '', p.sexe || '', c.nom || '', c.prenom || '', p.age || '',
    p.origine || '', rec.obs || '', rec.numero || '', rec.url_demande_photo || ''];
}

/* -------------------------------------------------------------- checkpoint */

function loadCk() {
  try {
    const j = JSON.parse(fs.readFileSync(CK_FILE, 'utf8'));
    return { done: new Set(j.done), actes: j.actes || 0, totals: j.totals || {} };
  } catch { return { done: new Set(), actes: 0, totals: {} }; }
}
function saveCk(ck) {
  fs.writeFileSync(CK_FILE, JSON.stringify(
    { done: [...ck.done], actes: ck.actes, totals: ck.totals }));
}

/* ------------------------------------------------ dédoublonnage (--refresh) */

// Parse une ligne CSV (gère les champs entre guillemets et les "" échappés).
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === ',') { out.push(cur); cur = ''; }
    else if (ch === '"') q = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Ensemble des `numero` déjà écrits dans le CSV, pour ne pas les réécrire.
// ponytail: charge tous les numéros en RAM (~200 Mo pour 1,5 M lignes) ; si le
// VPS est trop juste, dédoublonner par bucket au lieu du fichier entier.
function loadSeen() {
  const seen = new Set();
  if (!fs.existsSync(OUT_CSV)) return seen;
  const iNum = COLS.indexOf('numero');
  const lines = fs.readFileSync(OUT_CSV, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const num = parseCsvLine(lines[i])[iNum];
    if (num) seen.add(num);
  }
  return seen;
}

/* ------------------------------------------------------------------- main - */

async function harvest() {
  const gs = loadGs();
  const ck = loadCk();
  // --refresh : on ne saute plus les buckets déjà faits ; on relit leur total
  // annoncé et on ne re-récolte que ceux qui ont grossi, en dédoublonnant.
  const REFRESH = process.argv.includes('--refresh');
  const seen = REFRESH ? loadSeen() : null;
  if (REFRESH) console.log(`--refresh : ${seen.size} numéros déjà connus, on ne récolte que les nouveautés`);

  const newFile = !fs.existsSync(OUT_CSV) || fs.statSync(OUT_CSV).size === 0;
  const csv = fs.createWriteStream(OUT_CSV, { flags: 'a' });
  if (newFile) csv.write(csvLine(COLS));

  for (const commune of gs.COMMUNES.map(c => c.nom)) {
    let session = null;  // ouvert paresseusement (rien si toute la commune est déjà faite)
    for (const type of TYPES) {
      for (const letter of LETTERS) {
        const key = commune + '|' + type + '|' + letter;
        if (!REFRESH && ck.done.has(key)) continue;

        if (!session) session = await openCommune(gs, commune);
        const data = await probe(gs, session, type, letter);
        const total = data.total || data.results.length;

        // Faut-il paginer ce bucket ? En récolte normale : oui (nouveau bucket).
        // En refresh : seulement s'il est nouveau ou si le total a augmenté.
        const base = ck.totals[key];
        const need = !REFRESH || !ck.done.has(key) || (base !== undefined && total > base);

        if (need) {
          const acc = data.results.slice();
          if (total > acc.length) await fetchRest(gs, session, type, letter, total, acc);

          let kept = KEEP_ALL ? acc : acc.filter(hasMatricule);  // par défaut : matriculés seuls
          if (REFRESH) kept = kept.filter(r => {          // ne réécrit pas un numéro déjà vu
            const n = r.numero;
            if (n && seen.has(n)) return false;
            if (n) seen.add(n);
            return true;
          });
          for (const r of kept) csv.write(csvLine(recordToRow(r)));
          ck.actes += kept.length;
          if (kept.length) console.log(`[${key}] ${kept.length} ${REFRESH ? 'nouveaux' : 'gardés'} / ${total} lus (cumul ${ck.actes})`);
        }

        ck.totals[key] = total; ck.done.add(key); saveCk(ck);
      }
    }
    console.log(`=== ${commune} terminé (cumul ${ck.actes}) ===`);
  }
  csv.end();
  const quoi = KEEP_ALL ? 'actes' : 'actes matriculés';
  console.log(`FINI. ${ck.actes} ${quoi} dans ${OUT_CSV}.`);
}

/* --------------------------------------------------------------- selftest - */

function selftest() {
  const assert = (c, m) => { if (!c) throw new Error('SELFTEST: ' + m); };
  assert(LETTERS.length === 26 && LETTERS[0] === 'a' && LETTERS[25] === 'z', 'initiales a-z');
  assert(matriculeNum('engagé n°89446 au registre') === '89446', 'matricule n°');
  assert(matriculeNum('permission N°2-537 bis') === '2537', 'matricule avec tiret -> concat');
  assert(matriculeNum('N° 537 °1833 Mx') === '537', 'n’avale pas l’année qui suit');
  assert(matriculeNum('N °12 bis') === '12', 'matricule variantes');
  assert(matriculeNum('°14 P°CHINE 32a') === '', 'le ° de naissance n’est pas un matricule');
  assert(matriculeNum('rien ici') === '', 'pas de matricule');
  assert(csvField('a,b') === '"a,b"' && csvField('he said "x"') === '"he said ""x"""', 'csv quoting');
  assert(csvField('simple') === 'simple', 'csv nu');
  assert(payload('9741211', 'N', 'ho').code === '9741211', 'payload contient code caché');
  assert(payload('9741211', 'N', 'ho').rech === 2, 'payload contient rech=2 caché');
  const rec = { type_acte: 'N', commune: 'St-Denis', date_iso: '1901-02-03', obs: 'n°77',
    numero: 'X1', url_demande_photo: 'u', personnes: { principal: { nom: 'HOARAU', prenom: 'Jean', sexe: 'M' } } };
  const row = recordToRow(rec);
  assert(row[0] === '77' && row[4] === 'HOARAU' && COLS.length === row.length, 'record -> row');
  assert(hasMatricule({ obs: 'engagé n°77' }) === true, 'hasMatricule vrai');
  assert(hasMatricule({ obs: '°14 P°CHINE' }) === false && hasMatricule({}) === false, 'hasMatricule faux');
  // parseCsvLine doit être l'inverse de csvLine (indispensable au dédoublonnage --refresh)
  const rt = parseCsvLine(csvLine(row).replace(/\n$/, ''));
  assert(rt.length === row.length && rt[4] === 'HOARAU', 'parseCsvLine round-trip simple');
  const tricky = ['a,b', 'il a dit "x"', 'multi\nligne', ''];
  const back = parseCsvLine(csvLine(tricky).replace(/\n$/, ''));
  assert(back[0] === 'a,b' && back[1] === 'il a dit "x"' && back[3] === '', 'parseCsvLine champs délicats');
  const gs = loadGs();
  assert(gs.COMMUNES.length === 25 && typeof gs.parseResultsPage === 'function', 'gs chargé');
  assert(gs.findCommune('Saint-Denis').code === '9741211', 'findCommune');
  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) { selftest(); }
else { harvest().catch(e => { console.error(e); process.exit(1); }); }
