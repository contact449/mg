#!/usr/bin/env node
/**
 * ============================================================================
 *  Moissonneur MG — récolte cherchemg.fr en deux phases, écrit deux CSV.
 *
 *  Pendant du moissonneur IDLR, même conception : dossier autonome (Node ≥ 20,
 *  rien à installer), throttle poli, reprise après coupure, conçu pour tourner
 *  détaché sur un VPS.
 *
 *  Réutilise TEL QUEL le parser reverse-engineeré : Config.js et Parser.js sont
 *  des copies conformes de ../Config.gs et ../Parser.gs, chargées dans un
 *  contexte vm. Seule la couche réseau est écrite pour Node. Pour les
 *  resynchroniser après une évolution du module Apps Script :
 *      cp ../Config.gs Config.js && cp ../Parser.gs Parser.js
 *  `node harvest.cjs --selftest` vérifie qu'elles n'ont pas dérivé.
 *
 *  ---------------------------------------------------------------------------
 *  PHASE 1 — l'index      POST /patro.php, 26 requêtes (une par lettre)
 *      -> mg_matricules.csv : matricule, identite, source, trouve_par
 *      Environ 90 s. La validation « 3 caractères minimum » de patro.php est
 *      purement côté client : le serveur accepte une lettre, et une lettre
 *      ramène une part énorme de l'index (voir ../README.md § 1).
 *
 *  PHASE 2 — les fiches   GET /mg.php?MgChaine=N, une requête PAR matricule
 *      -> mg_fiches.csv : origine, naissance, arrivée, convoi, immatriculation,
 *         notes, sources, contributeur, releveur
 *      C'est la raison d'être de ce dossier : à ~6 s par requête, une base de
 *      20 000 matricules demande ~33 h. Apps Script coupe à 6 min par exécution
 *      et ne peut pas s'en charger ; ici on tourne en continu et on reprend.
 *  ---------------------------------------------------------------------------
 *
 *  Usage :
 *      node harvest.cjs                 # index si nécessaire, puis fiches (reprise)
 *      node harvest.cjs --index         # phase 1 seule
 *      node harvest.cjs --fiches        # phase 2 seule
 *      node harvest.cjs --index --force # réécrit l'index même s'il est frais
 *      node harvest.cjs --limite 200    # borne la phase 2 (essai)
 *      node harvest.cjs --selftest      # vérifs hors ligne, aucune requête
 *
 *  Détaché, pour survivre à une déconnexion SSH :
 *      nohup node harvest.cjs > harvest.log 2>&1 &
 *      tail -f harvest.log
 *
 *  Réglages (env) :
 *      MG_OUT=mg_matricules.csv   MG_FICHES=mg_fiches.csv   MG_ETAT=mg_etat.json
 *      MG_THROTTLE_MS=3000        délai mini entre deux requêtes
 *      MG_UA=...                  User-Agent identifiant
 *
 *  Reprise : la phase 2 relit mg_fiches.csv au démarrage et saute les
 *  matricules déjà traités. Pas de checkpoint séparé à maintenir cohérent avec
 *  la sortie — le fichier de sortie EST le checkpoint. Pour tout refaire,
 *  supprime mg_fiches.csv.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Env = require('./Env.js');

/* ----------------------------------------------------------- réglages ---- */

const env = (n, d) => (process.env[n] === undefined || process.env[n] === '' ? d : process.env[n]);

const CFG = {
  BASE:        'https://cherchemg.fr',
  PATH_PATRO:  '/patro.php',
  PATH_MG:     '/mg.php',
  THROTTLE_MS: Number(env('MG_THROTTLE_MS', 3000)),
  MAX_RETRY:   3,
  BACKOFF_MS:  5000,
  UA:          env('MG_UA', 'OCI-EXPRESS-Genealogie/1.0 (+contact: contact@ociexpress.re)'),
  OUT_INDEX:   env('MG_OUT',    path.join(__dirname, 'mg_matricules.csv')),
  OUT_FICHES:  env('MG_FICHES', path.join(__dirname, 'mg_fiches.csv')),
  ETAT:        env('MG_ETAT',   path.join(__dirname, 'mg_etat.json')),
  /** Au-delà, l'index est considéré périmé (mise à jour semestrielle). */
  PEREMPTION_JOURS: 180
};

/* ------------------------------------------- parser MG (copies, via vm) --- */

function chargerParser() {
  const ctx = vm.createContext({ console });
  for (const f of ['Config.js', 'Parser.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

/* ------------------------------------------------------------- réseau ---- */

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let dernierAppel = 0;

async function throttle() {
  const attente = CFG.THROTTLE_MS - (Date.now() - dernierAppel);
  if (attente > 0) await dormir(attente);
  dernierAppel = Date.now();
}

async function requete(url, options = {}) {
  let derniere = null;
  for (let essai = 1; essai <= CFG.MAX_RETRY; essai++) {
    await throttle();
    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers: Object.assign({
          'User-Agent': CFG.UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'fr-FR,fr;q=0.9'
        }, options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        body: options.body,
        redirect: 'follow'
      });
      if (res.status === 200) return await res.text();
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new Error('HTTP ' + res.status);
      derniere = new Error('HTTP ' + res.status);
    } catch (e) { derniere = e; }
    if (essai < CFG.MAX_RETRY) await dormir(CFG.BACKOFF_MS * essai);
  }
  throw derniere || new Error('échec : ' + url);
}

/* ---------------------------------------------------------------- CSV ---- */

function champCsv(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const ligneCsv = (vals) => vals.map(champCsv).join(',') + '\n';

/** Analyse CSV en flux (guillemets et retours à la ligne encadrés gérés). */
function parcourirCsv(chemin, onLigne) {
  return new Promise((resolve, reject) => {
    let champ = '', ligne = [], dansGuillemets = false, guillemetEnAttente = false;
    const flux = fs.createReadStream(chemin, { encoding: 'utf8', highWaterMark: 1 << 20 });
    flux.on('data', (bloc) => {
      for (let i = 0; i < bloc.length; i++) {
        const c = bloc[i];
        if (guillemetEnAttente) {
          guillemetEnAttente = false;
          if (c === '"') { champ += '"'; continue; }
          dansGuillemets = false;
        }
        if (dansGuillemets) {
          if (c === '"') {
            if (i + 1 < bloc.length) { if (bloc[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false; }
            else guillemetEnAttente = true;
          } else champ += c;
          continue;
        }
        if (c === '"') { dansGuillemets = true; continue; }
        if (c === ',') { ligne.push(champ); champ = ''; continue; }
        if (c === '\n' || c === '\r') {
          if (c === '\r' && bloc[i + 1] === '\n') i++;
          ligne.push(champ); champ = '';
          if (ligne.length > 1 || ligne[0] !== '') onLigne(ligne);
          ligne = [];
          continue;
        }
        champ += c;
      }
    });
    flux.on('error', reject);
    flux.on('end', () => { if (champ !== '' || ligne.length) { ligne.push(champ); onLigne(ligne); } resolve(); });
  });
}

const COLS_INDEX = ['matricule', 'identite', 'source', 'trouve_par'];
const COLS_FICHES = ['matricule', 'statut', 'identite', 'origine', 'naissance', 'arrivee',
  'convoi', 'immatriculation', 'notes', 'sources', 'contributeur', 'releveur',
  'immat_entre_le', 'immat_et_le', 'recupere_le'];

/* ================================================== PHASE 1 — l'index ==== */

const ALPHABET = 'a e i o u n r s t m l c d p v g b h y f j k q w x z'.split(' ');

async function phaseIndex() {
  const ctx = chargerParser();
  const t0 = Date.now();
  const vus = new Set();
  const lignes = [];
  let lues = 0;

  console.log(`Phase 1 — index : ${ALPHABET.length} requêtes vers ${CFG.BASE}`);
  for (const lettre of ALPHABET) {
    const html = await requete(CFG.BASE + CFG.PATH_PATRO, {
      method: 'POST',
      body: new URLSearchParams({ PatroChaine: lettre }).toString()
    });
    const r = ctx.mgParsePatro(html);
    lues += r.total;
    let nouveaux = 0;
    for (const l of r.lignes) {
      if (l.mg === null) continue;
      const cle = l.mg + '\n' + ctx.mgNormTexte_(l.patronyme);
      if (vus.has(cle)) continue;
      vus.add(cle);
      lignes.push([l.mg, l.patronyme, l.source, lettre]);
      nouveaux++;
    }
    console.log(`  "${lettre}" : ${r.total} lues, ${nouveaux} nouvelles (cumul ${lignes.length})`);
  }

  const flux = fs.createWriteStream(CFG.OUT_INDEX + '.tmp');
  flux.write(ligneCsv(COLS_INDEX));
  for (const l of lignes) flux.write(ligneCsv(l));
  await new Promise((res, rej) => flux.end((e) => (e ? rej(e) : res())));
  fs.renameSync(CFG.OUT_INDEX + '.tmp', CFG.OUT_INDEX);

  const distincts = new Set(lignes.map((l) => l[0])).size;
  const etat = {
    date: new Date().toISOString(),
    duree_s: Math.round((Date.now() - t0) / 1000),
    lettres: ALPHABET.length,
    lignesLues: lues,
    lignesEcrites: lignes.length,
    matriculesDistincts: distincts
  };
  fs.writeFileSync(CFG.ETAT, JSON.stringify(etat, null, 2));
  console.log(`Phase 1 terminée en ${etat.duree_s} s — ${distincts} matricules distincts.`);
  return etat;
}

function ageIndexJours() {
  if (!fs.existsSync(CFG.ETAT)) return Infinity;
  try { return (Date.now() - new Date(JSON.parse(fs.readFileSync(CFG.ETAT, 'utf8')).date).getTime()) / 86400000; }
  catch { return Infinity; }
}

/* ================================================== PHASE 2 — les fiches = */

/** Matricules distincts de l'index, triés. */
async function matriculesDeLIndex() {
  if (!fs.existsSync(CFG.OUT_INDEX)) {
    throw new Error('Index absent : ' + CFG.OUT_INDEX + '\nLance d\'abord : node harvest.cjs --index');
  }
  const set = new Set();
  let entete = true;
  await parcourirCsv(CFG.OUT_INDEX, (l) => {
    if (entete) { entete = false; return; }
    const n = Number(l[0]);
    if (n) set.add(n);
  });
  return [...set].sort((a, b) => a - b);
}

/** Matricules déjà présents dans la sortie : le fichier EST le checkpoint. */
async function matriculesDejaFaits() {
  if (!fs.existsSync(CFG.OUT_FICHES)) return new Set();
  const set = new Set();
  let entete = true;
  await parcourirCsv(CFG.OUT_FICHES, (l) => {
    if (entete) { entete = false; return; }
    const n = Number(l[0]);
    if (n) set.add(n);
  });
  return set;
}

async function phaseFiches(limite) {
  const ctx = chargerParser();
  const tous = await matriculesDeLIndex();
  const faits = await matriculesDejaFaits();
  const aFaire = tous.filter((n) => !faits.has(n));

  if (!aFaire.length) {
    console.log(`Phase 2 — rien à faire : les ${tous.length} matricules ont leur fiche.`);
    return { traites: 0, reste: 0 };
  }

  const cible = limite ? Math.min(limite, aFaire.length) : aFaire.length;
  const heures = (cible * CFG.THROTTLE_MS / 3600000).toFixed(1);
  console.log(`Phase 2 — fiches : ${aFaire.length} à récupérer` +
              (limite ? ` (borné à ${cible})` : '') +
              `, ${faits.size} déjà faits. Estimation : ~${heures} h.`);

  const nouveau = !fs.existsSync(CFG.OUT_FICHES);
  const flux = fs.createWriteStream(CFG.OUT_FICHES, { flags: 'a' });
  if (nouveau) flux.write(ligneCsv(COLS_FICHES));

  const t0 = Date.now();
  let traites = 0, trouves = 0, absents = 0;

  for (const num of aFaire.slice(0, cible)) {
    let f;
    try {
      f = ctx.mgParseFiche(await requete(CFG.BASE + CFG.PATH_MG + '?MgChaine=' + num), num);
    } catch (e) {
      console.error(`  MG ${num} : ${e.message} — on s'arrête ici, relance pour reprendre.`);
      break;
    }
    const immat = f.immatriculation || {};
    const horodatage = new Date().toISOString();

    if (!f.engages || !f.engages.length) {
      // Trace la tentative : sans elle, on redemanderait ce numéro à chaque reprise.
      absents++;
      flux.write(ligneCsv([num, f.statut, '', '', '', '', '', '', '', '', '', '',
        immat.entre_le || '', immat.et_le || '', horodatage]));
    } else {
      trouves++;
      for (const g of f.engages) {
        flux.write(ligneCsv([num, f.statut, g.identite, g.origine, g.naissance, g.arrivee,
          g.convoi, g.immatriculation, g.notes, g.sources, g.contributeur, g.releveur,
          immat.entre_le || '', immat.et_le || '', horodatage]));
      }
    }
    traites++;

    if (traites % 50 === 0 || traites === cible) {
      const parHeure = traites / ((Date.now() - t0) / 3600000);
      const reste = aFaire.length - traites;
      console.log(`  ${traites}/${cible}  (${trouves} avec fiche, ${absents} sans)  ` +
                  `${Math.round(parHeure)}/h  reste ${reste}` +
                  (parHeure > 0 ? ` ~${(reste / parHeure).toFixed(1)} h` : ''));
    }
  }

  await new Promise((res, rej) => flux.end((e) => (e ? rej(e) : res())));
  console.log(`Phase 2 : ${traites} fiches écrites, reste ${aFaire.length - traites}.`);
  return { traites, reste: aFaire.length - traites };
}

/* ------------------------------------------------------------ selftest --- */

function selftest() {
  let ko = 0;
  const check = (nom, reel, attendu) => {
    const ok = JSON.stringify(reel) === JSON.stringify(attendu);
    if (!ok) ko++;
    console.log(`${ok ? 'OK   ' : 'ECHEC'} ${nom}` + (ok ? '' :
      `\n        attendu ${JSON.stringify(attendu)}\n        obtenu  ${JSON.stringify(reel)}`));
  };
  const fix = (f) => fs.readFileSync(path.join(__dirname, 'test', 'fixtures', f), 'utf8');
  const ctx = chargerParser();

  console.log('=== copies du parser ===');
  const amont = path.join(__dirname, '..');
  if (fs.existsSync(path.join(amont, 'Config.gs'))) {
    for (const [copie, source] of [['Config.js', 'Config.gs'], ['Parser.js', 'Parser.gs']]) {
      check(`${copie} identique à ../${source}`,
            fs.readFileSync(path.join(__dirname, copie), 'utf8') ===
            fs.readFileSync(path.join(amont, source), 'utf8'), true);
    }
  } else console.log('SAUTE  ../Config.gs absent (normal sur le VPS)');

  const refEnv = path.join(__dirname, '..', '..', 'ile_archive_de_la_reunion', 'moissonneur', 'Env.js');
  if (fs.existsSync(refEnv)) {
    check('Env.js identique a la reference',
          fs.readFileSync(path.join(__dirname, 'Env.js'), 'utf8') === fs.readFileSync(refEnv, 'utf8'),
          true);
  }
  console.log('\n=== phase 1 : parsing de l\'index ===');
  const p = ctx.mgParsePatro(fix('patro_sam.html'));
  check('lignes', p.total, 3574);
  check('avec matricule', p.avecMg, 2491);
  check('matricules distincts', new Set(p.lignes.filter((l) => l.mg).map((l) => l.mg)).size, 2041);

  console.log('\n=== phase 2 : parsing d\'une fiche ===');
  const f5 = ctx.mgParseFiche(fix('mg_5.html'), 5);
  check('statut', f5.statut, 'trouve');
  check('3 engagés', f5.nb_engages, 3);
  check('identité', f5.engages[0].identite, 'Ramsamy');
  check('releveur', f5.engages[0].releveur, 'Laurent Coutaye');
  const fAbs = ctx.mgParseFiche(fix('mg_123999_absent.html'), 123999);
  check('numéro absent', fAbs.statut, 'absent');
  check('0 engagé', fAbs.nb_engages, 0);

  console.log('\n=== CSV ===');
  check('échappement des guillemets', ligneCsv(['a"b', 'c,d']), '"a""b","c,d"\n');
  check('champ simple', ligneCsv(['x', 'y']), 'x,y\n');

  console.log(ko === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${ko} ECHEC(S)`);
  return ko;
}

/* ----------------------------------------------------------------- CLI --- */

async function principal() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest() === 0 ? 0 : 1);

  // Tout le reste interroge cherchemg.fr. En dev il faut l'autoriser :
  // le site est tenu par un benevole et s'auto-limite deja a 1 requete / 6 s.
  try {
    Env.exigerReseau('cherchemg.fr',
      args.indexOf('--fiches') !== -1
        ? 'La phase 2 demande une requete par matricule, soit ~33 h.'
        : 'Le balayage de l index represente 26 requetes de plusieurs Mo.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  Env.banniere('moissonneur MG');

  const veutIndex = args.includes('--index');
  const veutFiches = args.includes('--fiches');
  const iLim = args.indexOf('--limite');
  const limite = iLim !== -1 ? Number(args[iLim + 1]) : 0;

  // Sans option : index si absent ou périmé, puis fiches.
  const faireIndex = veutIndex || (!veutFiches &&
    (args.includes('--force') || ageIndexJours() > CFG.PEREMPTION_JOURS));
  const faireFiches = veutFiches || !veutIndex;

  if (faireIndex) {
    await phaseIndex();
  } else if (!veutFiches) {
    console.log(`Index vieux de ${Math.round(ageIndexJours())} j (< ${CFG.PEREMPTION_JOURS} j) : conservé. ` +
                `--index --force pour le refaire.`);
  }
  if (faireFiches) await phaseFiches(limite);
}

module.exports = { phaseIndex, phaseFiches, matriculesDeLIndex, parcourirCsv, ligneCsv, CFG };

if (require.main === module) {
  principal().catch((e) => { console.error('ECHEC : ' + (e && e.message ? e.message : e)); process.exit(1); });
}
