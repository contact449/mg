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
const Env = require('./Env.js');

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
// L'entourage relevé dans l'acte. Le parser lisait déjà `pere.nom`,
// `pere.prenom`, `mere.nom` et `mere.prenom` — c'est recordToRow() qui les
// jetait. Ces quatre colonnes ne se remplissent que pour les actes qui les
// portent (mariages surtout) ; ailleurs elles restent vides, comme le
// conjoint l'est déjà pour les naissances et les décès.
// `pere_decede` / `mere_decede` viennent des colonnes « + » du site, et
// `parrain` / `marraine` du tableau des naissances. Sur un acte de NAISSANCE
// le site ne donne rien d'autre sur les parents : pas de nom, seulement la
// marque « décédé » — les noms n'existent que sur les mariages (voir
// SCHEMA.md, « Colonnes vues par type »). Le parrain et la marraine sont donc
// les seuls noms d'entourage qu'une naissance apporte, et en généalogie
// réunionnaise ce sont très souvent des proches de la famille.
const COLS = ['matricule', 'type_acte', 'commune', 'date_iso', 'nom', 'prenom',
  'sexe', 'conjoint_nom', 'conjoint_prenom',
  'pere_nom', 'pere_prenom', 'mere_nom', 'mere_prenom',
  'pere_decede', 'mere_decede', 'parrain', 'marraine',
  'age', 'origine', 'obs', 'numero', 'url_demande_photo'];

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
  // Les parents sont ceux de la personne PRINCIPALE. Un acte de mariage en
  // porte deux jeux — ceux de l'époux et ceux de l'épouse ; on garde le
  // premier, celui qui va avec le nom affiché dans la ligne. Prendre les deux
  // demanderait deux lignes par acte et casserait le dédoublonnage par photo.
  const pere = p.pere || {};
  const mere = p.mere || {};
  // Le parser rend un booleen pour les colonnes « + ». On ecrit 1 ou rien :
  // « false » dans un CSV se relit comme une chaine non vide, donc comme un
  // vrai — le genre d'inversion qui ne se voit qu'a l'affichage.
  const oui = (v) => (v === true ? '1' : '');
  return [matriculeNum(rec.obs), rec.type_acte, rec.commune, rec.date_iso, p.nom || '',
    p.prenom || '', p.sexe || '', c.nom || '', c.prenom || '',
    pere.nom || '', pere.prenom || '', mere.nom || '', mere.prenom || '',
    oui(pere.decede), oui(mere.decede), p.parrain || '', p.marraine || '',
    p.age || '', p.origine || '', rec.obs || '', rec.numero || '',
    rec.url_demande_photo || ''];
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

/* ---------------------------------------------- migration de l'en-tête ---- */

/**
 * Découpe un CSV entier en lignes, en respectant les guillemets.
 *
 * `parseCsvLine` ne voit qu'une ligne : découper le fichier sur `\n` avant de
 * l'appeler coupe en deux tout champ `obs` contenant un saut de ligne — et il
 * y en a. La migration réécrit le fichier, elle ne peut pas se permettre ça.
 */
function lignesCsv(texte) {
  const out = [];
  let ligne = [], champ = '', q = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (q) {
      if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else q = false; }
      else champ += c;
    } else if (c === '"') q = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); out.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); out.push(ligne); }
  return out;
}

/**
 * Aligne un actes.csv écrit avec un jeu de colonnes plus ancien.
 *
 * Le moissonneur ÉCRIT EN FIN DE FICHIER : sans cette étape, ajouter une
 * colonne produirait des lignes plus larges que l'en-tête, et le fichier
 * deviendrait incohérent en silence — le pire des dégâts, parce qu'il ne se
 * voit qu'au moment de relire.
 *
 * Les colonnes sont remises en place PAR NOM, jamais par position : une
 * colonne ancienne inconnue de COLS serait perdue, donc on refuse plutôt que
 * de la jeter. L'original est conservé en `.avant-migration`.
 */
function migrerEntete(chemin) {
  const OUT = chemin || OUT_CSV;
  if (!fs.existsSync(OUT) || fs.statSync(OUT).size === 0) return null;

  const texte = fs.readFileSync(OUT, 'utf8');
  const rows = lignesCsv(texte);
  if (!rows.length) return null;

  const ancienne = rows[0].map((h) => h.trim());
  if (ancienne.join(',') === COLS.join(',')) return null;       // déjà à jour

  const perdues = ancienne.filter((c) => c && COLS.indexOf(c) === -1);
  if (perdues.length) {
    throw new Error(
      'actes.csv porte des colonnes que ce moissonneur ne connaît pas : ' +
      perdues.join(', ') + '\n' +
      'Migrer automatiquement les perdrait. Vérifie la version du moissonneur.');
  }

  const sauvegarde = OUT + '.avant-migration';
  fs.writeFileSync(sauvegarde, texte);

  const pos = COLS.map((c) => ancienne.indexOf(c));   // -1 = colonne nouvelle
  const lignes = [];
  for (let i = 1; i < rows.length; i++) {
    const l = rows[i];
    if (l.length === 1 && !l[0]) continue;                      // ligne vide finale
    lignes.push(pos.map((j) => (j === -1 ? '' : (l[j] == null ? '' : l[j]))));
  }
  fs.writeFileSync(OUT, csvLine(COLS) + lignes.map(csvLine).join(''));

  const ajoutees = COLS.filter((c) => ancienne.indexOf(c) === -1);
  console.log(path.basename(OUT) + ' migré : ' + lignes.length + ' lignes, ' +
              ajoutees.length + ' colonne(s) ajoutée(s) — ' + ajoutees.join(', '));
  console.log('  vides tant qu\'un moissonnage ne les a pas remplies.');
  console.log('  original conservé : ' + path.basename(sauvegarde));
  return { entete: COLS, lignes, ajoutees };
}

/* ------------------------------------------------------------------- main - */

/**
 * Les types d'actes à récolter, éventuellement restreints.
 *
 *   node harvest.cjs --refresh --types=M,PM,DIV
 *
 * Les noms de parents ne figurent que sur les actes qui portent ces colonnes
 * — les mariages, pour l'essentiel, soit 7,5 % du fonds. Les rattraper sans
 * cette option imposerait de repasser sur les 39 000 actes, dont 36 000 qui
 * n'apprendraient rien.
 */
function typesDemandes(argv) {
  const arg = (argv || process.argv).find((x) => String(x).indexOf('--types=') === 0);
  if (!arg) return TYPES;
  const voulus = arg.slice(8).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const inconnus = voulus.filter((t) => TYPES.indexOf(t) === -1);
  if (inconnus.length) {
    throw new Error('Type d\'acte inconnu : ' + inconnus.join(', ') +
                    '\nTypes valides : ' + TYPES.join(', '));
  }
  return voulus;
}

async function harvest() {
  const gs = loadGs();
  // Avant toute écriture : le fichier doit avoir l'en-tête d'aujourd'hui,
  // sans quoi les lignes ajoutées seraient plus larges que leur en-tête.
  migrerEntete();
  const ck = loadCk();
  // --refresh : on ne saute plus les buckets déjà faits ; on relit leur total
  // annoncé et on ne re-récolte que ceux qui ont grossi, en dédoublonnant.
  const REFRESH = process.argv.includes('--refresh');
  const seen = REFRESH ? loadSeen() : null;
  if (REFRESH) console.log(`--refresh : ${seen.size} numéros déjà connus, on ne récolte que les nouveautés`);

  const newFile = !fs.existsSync(OUT_CSV) || fs.statSync(OUT_CSV).size === 0;
  const csv = fs.createWriteStream(OUT_CSV, { flags: 'a' });
  if (newFile) csv.write(csvLine(COLS));

  const types = typesDemandes();
  if (types.length !== TYPES.length) {
    console.log(`--types : ${types.join(', ')} seulement (sur ${TYPES.join(', ')})`);
  }

  for (const commune of gs.COMMUNES.map(c => c.nom)) {
    let session = null;  // ouvert paresseusement (rien si toute la commune est déjà faite)
    for (const type of types) {
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
  // ---- entourage (conjoint, père, mère) ----
  const marie = { type_acte: 'M', commune: 'St-Paul', date_iso: '1892-01-05', obs: 'n°300',
    numero: 'X2', url_demande_photo: '',
    personnes: {
      principal: { nom: 'GOVINDIN', prenom: 'Paul', sexe: 'M',
        pere: { nom: 'GOVINDIN', prenom: 'Ary' }, mere: { nom: 'MOUTOU', prenom: 'Rose' } },
      conjoint: { nom: 'SINNAMA', prenom: 'Marie Rose' }
    } };
  const rm = recordToRow(marie);
  const col = (nom) => rm[COLS.indexOf(nom)];
  assert(col('conjoint_nom') === 'SINNAMA' && col('conjoint_prenom') === 'Marie Rose', 'conjoint écrit');
  assert(col('pere_nom') === 'GOVINDIN' && col('pere_prenom') === 'Ary', 'père écrit');
  assert(col('mere_nom') === 'MOUTOU' && col('mere_prenom') === 'Rose', 'mère écrit');
  assert(col('nom') === 'GOVINDIN' && col('obs') === 'n°300', 'colonnes voisines non décalées');
  // Un acte sans parents ne doit pas décaler les colonnes suivantes.
  assert(row[COLS.indexOf('obs')] === 'n°77' && row[COLS.indexOf('pere_nom')] === '',
         'parents absents -> cases vides, pas de décalage');

  // ---- naissance : ce que le site donne VRAIMENT sur les parents ----
  // Pas de nom, seulement la marque « + » (décédé), plus parrain et marraine.
  const naiss = { type_acte: 'N', commune: 'St-Denis', date_iso: '1892-06-16', obs: 'n°18',
    numero: 'X3', url_demande_photo: '',
    personnes: { principal: { nom: 'APASSAMY', prenom: 'Amélie', sexe: 'F',
      parrain: 'MOUTOU Jean', marraine: 'NAIKEN Rose',
      pere: { decede: true }, mere: { decede: false } } } };
  const rn = recordToRow(naiss);
  const cn = (nom) => rn[COLS.indexOf(nom)];
  assert(cn('pere_decede') === '1', 'naissance : père décédé -> 1');
  assert(cn('mere_decede') === '', 'naissance : mère vivante -> case vide, pas « false »');
  assert(cn('parrain') === 'MOUTOU Jean' && cn('marraine') === 'NAIKEN Rose', 'parrain et marraine écrits');
  assert(cn('pere_nom') === '' && cn('mere_nom') === '',
         'naissance : aucun nom de parent (le site n’en donne pas)');
  assert(cn('nom') === 'APASSAMY' && cn('obs') === 'n°18', 'naissance : colonnes voisines non décalées');
  assert(COLS.length === rn.length && COLS.length === rm.length, 'toutes les lignes ont la largeur de COLS');

  // ---- découpage d'un CSV entier, guillemets et sauts de ligne compris ----
  const brut = csvLine(['a', 'b']) + csvLine(['x,1', 'il a dit "y"']) + csvLine(['multi\nligne', 'z']);
  const rows = lignesCsv(brut);
  assert(rows.length === 3, 'lignesCsv : 3 lignes');
  assert(rows[1][0] === 'x,1' && rows[1][1] === 'il a dit "y"', 'lignesCsv : virgule et guillemets');
  assert(rows[2][0] === 'multi\nligne', 'lignesCsv : saut de ligne dans un champ');

  // ---- migration d'en-tête ----
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idlr-mig-'));
  const f = path.join(tmp, 'actes.csv');
  try {
    // Un fichier à l'ancien format, avec un champ piégeux et une ligne à
    // saut de ligne : c'est exactement ce qu'un découpage naïf détruirait.
    fs.writeFileSync(f,
      csvLine(['matricule', 'type_acte', 'nom', 'obs', 'numero']) +
      csvLine(['77', 'N', 'HOARAU', 'a,b "c"', 'X1']) +
      csvLine(['78', 'D', 'PETAN', 'multi\nligne', 'X2']));

    const m = migrerEntete(f);
    assert(m && m.entete.join(',') === COLS.join(','), 'migration : nouvel en-tête');
    assert(m.lignes.length === 2, 'migration : lignes conservées');
    assert(m.lignes[0][COLS.indexOf('nom')] === 'HOARAU', 'migration : valeur remise PAR NOM');
    assert(m.lignes[0][COLS.indexOf('obs')] === 'a,b "c"', 'migration : virgule et guillemets intacts');
    assert(m.lignes[1][COLS.indexOf('obs')] === 'multi\nligne', 'migration : saut de ligne intact');
    assert(m.lignes[0][COLS.indexOf('pere_nom')] === '', 'migration : colonne neuve vide');
    assert(m.ajoutees.indexOf('pere_nom') !== -1, 'migration : parents annoncés comme ajoutés');
    assert(fs.existsSync(f + '.avant-migration'), 'migration : original sauvegardé');
    assert(migrerEntete(f) === null, 'migration : rejouable sans effet');
    assert(lignesCsv(fs.readFileSync(f, 'utf8'))[0].join(',') === COLS.join(','),
           'migration : le fichier sur disque porte le nouvel en-tête');

    let refuse = false;
    fs.writeFileSync(f, csvLine(['matricule', 'colonne_inconnue']) + csvLine(['1', 'x']));
    try { migrerEntete(f); } catch { refuse = true; }
    assert(refuse, 'migration : colonne inconnue -> refus plutôt que perte silencieuse');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- filtre --types ----
  assert(typesDemandes([]).join(',') === TYPES.join(','), '--types absent -> tous les types');
  assert(typesDemandes(['--types=M,PM']).join(',') === 'M,PM', '--types restreint');
  assert(typesDemandes(['--types=m']).join(',') === 'M', '--types insensible à la casse');
  let typeKo = false;
  try { typesDemandes(['--types=X']); } catch { typeKo = true; }
  assert(typeKo, '--types inconnu -> erreur explicite');

  const gs = loadGs();
  assert(gs.COMMUNES.length === 25 && typeof gs.parseResultsPage === 'function', 'gs chargé');
  assert(gs.findCommune('Saint-Denis').code === '9741211', 'findCommune');
  console.log('selftest OK');
}

if (process.argv.includes('--selftest')) {
  selftest();                       // hors ligne : aucune autorisation requise
} else if (process.argv.includes('--migrer')) {
  // Aligner l'en-tête ne touche pas au réseau : la récolte le fait de toute
  // façon au démarrage, mais pouvoir le lancer seul permet de vérifier le
  // résultat avant d'engager des heures de requêtes.
  try { migrerEntete(); console.log('actes.csv est à jour.'); }
  catch (e) { console.error(e.message); process.exit(1); }
} else {
  // Une recolte complete represente des heures de trafic sur un serveur
  // associatif. En dev, il faut l'autoriser explicitement.
  // Message lisible plutot qu'une pile d'appels : c'est une decision de
  // configuration, pas un plantage.
  try {
    Env.exigerReseau('iledelareunion-archive.com',
      'harvest.cjs va parcourir 3 250 buckets, soit 15 a 26 h de requetes.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  Env.banniere('moissonneur IDLR');
  harvest().catch(e => { console.error(e); process.exit(1); });
}
