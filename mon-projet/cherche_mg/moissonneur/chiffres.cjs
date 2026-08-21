#!/usr/bin/env node
/**
 * ============================================================================
 *  CHIFFRES CLES DES ENGAGES — le tableau de bord, hors de Sheets.
 *
 *  Pendant de recherche.cjs : la meme page que le menu « Chiffres cles » du
 *  module Apps Script, servie en local sur le port 8095. Sur le VPS, ou
 *  pendant le developpement, on a les CSV sous la main et pas le classeur.
 *
 *  NI LE CALCUL NI LA VUE NE SONT REECRITS.
 *
 *  Stats.js et Vue.html sont des copies conformes de ../Stats.gs et
 *  ../Vue.html. `mgStatistiques()` s'execute ICI, inchange, et la page rendue
 *  est le meme fichier HTML : Apps Script y injecte ses chiffres par le
 *  scriptlet `<?!= donnees ?>`, Node y injecte les siens au meme endroit.
 *  Les deux tableaux de bord ne peuvent donc pas donner des nombres
 *  differents, ni afficher deux graphiques distincts.
 *
 *  Ce que Node fournit, c'est le CLASSEUR : trois fausses feuilles adossees
 *  aux CSV, et les quelques services Google que Stats.gs appelle au passage.
 *  Rien d'autre.
 *
 *  Pour resynchroniser apres une evolution du module :
 *      cp ../Stats.gs Stats.js && cp ../Vue.html Vue.html
 *  `node chiffres.cjs --selftest` refuse de passer si une copie a derive.
 *
 *  SOURCES — les memes variables d'environnement que le moissonneur
 *      MG_OUT     ou  mg_matricules.csv     l'index : MG_Matricules
 *      MG_FICHES  ou  mg_fiches.csv         la phase 2 : MG_Fiches
 *      MG_ETAT    ou  mg_etat.json          l'etat du dernier balayage
 *      MG_SANS    ou  mg_sans_numero.csv    MG_Sans_numero (voir plus bas)
 *  Faute d'index, ../engages.csv puis mg_fiches.csv prennent le relais : ils
 *  portent eux aussi un matricule et une identite, ce dont vit ce calcul.
 *
 *  Lancer :  npm run chiffres        # puis http://localhost:8095
 *  Reglages (env) : PORT=8095  HOST=0.0.0.0
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const Env = require('./Env.js');
const { parcourirCsv } = require('./harvest.cjs');

const PORT = Number(process.env.PORT || 8095);
const HOST = process.env.HOST || '0.0.0.0';

/* ------------------------------------------ moteur Apps Script (via vm) --- */

function chargerMoteur() {
  const ctx = vm.createContext({ console });
  for (const f of ['Config.js', 'Stats.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const MOTEUR = chargerMoteur();
const norm = MOTEUR.mgNormTexte_;

/**
 * La cle d'une colonne : sans accent, minuscules, tout le reste en tirets bas.
 * « Immat. entre le » et « immat_entre_le » doivent tomber sur la meme cle,
 * sinon la feuille et le CSV ne se reconnaissent pas.
 */
const cleColonne = (h) => norm(h).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Le seul nom qui differe vraiment entre les deux mondes : la feuille appelle
 * « MG » ce que le CSV appelle « matricule ». Tout le reste se deduit.
 */
const ALIAS = { mg: 'matricule' };

/* ------------------------------------------------------------- sources ---- */

function premierPresent(liste) {
  for (const f of liste) if (f && fs.existsSync(f)) return f;
  return null;
}

/** L'index. A defaut, tout fichier portant matricule + identite fait l'affaire. */
const SRC_INDEX = () => premierPresent([
  process.env.MG_OUT,
  path.join(__dirname, 'mg_matricules.csv'),
  process.env.MG_ENGAGES,
  path.join(__dirname, '..', 'engages.csv'),
  path.join(__dirname, 'mg_fiches.csv')
]);

/** Les fiches de la phase 2. Absentes : la tuile dira « phase 2 non lancee ». */
const SRC_FICHES = () => premierPresent([
  process.env.MG_FICHES,
  path.join(__dirname, 'mg_fiches.csv')
]);

/**
 * Les identites relevees SANS numero de matricule.
 *
 * Le balayage Apps Script les enregistre dans MG_Sans_numero — environ 27 %
 * des lignes de patro.php. La phase 1 du moissonneur, elle, ne les ecrit
 * nulle part : elle ne garde que les lignes portant un numero. La tuile
 * afficherait donc un « 0 » qui voudrait dire « aucune », alors qu'il veut
 * dire « pas collectees ». Faute de fichier, on corrige son libelle plutot
 * que de laisser lire un chiffre faux (voir SUBSTITUTIONS).
 */
const SRC_SANS = () => premierPresent([
  process.env.MG_SANS,
  path.join(__dirname, 'mg_sans_numero.csv')
]);

const SRC_ETAT = () => process.env.MG_ETAT || path.join(__dirname, 'mg_etat.json');

/* ---------------------------------------------------------- chargement ---- */

/** Lit un CSV : en-tetes normalisees + lignes brutes. */
async function lireCsv(chemin) {
  let entete = null;
  const lignes = [];
  if (!chemin) return { cles: [], lignes: [] };
  await parcourirCsv(chemin, (l) => {
    if (!entete) { entete = l.map((h) => cleColonne(String(h == null ? '' : h))); return; }
    if (l.length === 1 && !l[0]) return;
    lignes.push(l);
  });
  return { cles: entete || [], lignes };
}

/**
 * Une fausse feuille : exactement ce que Stats.gs demande d'une Sheet, soit
 * `getLastRow()` et `getRange(...).getValues()`.
 *
 * Les colonnes sont remises dans l'ordre de MG_ENTETES, par leur NOM. Ce
 * realignement n'est pas cosmetique : `mgTopReleveurs_` lit « Releveur » par
 * sa POSITION dans MG_ENTETES, or mg_fiches.csv porte en plus une colonne
 * `statut` en deuxieme position. Sans realignement, le classement des
 * releveurs compterait des contributeurs.
 *
 * Une colonne que le CSV n'a pas (« URL source », « Cle ») ressort vide : la
 * feuille garde sa forme, et le calcul ne sait meme pas qu'elle manquait.
 */
function feuille(entetes, csv) {
  const pos = entetes.map((h) => {
    const c = cleColonne(h);
    let i = csv.cles.indexOf(c);
    if (i === -1 && ALIAS[c]) i = csv.cles.indexOf(ALIAS[c]);
    return i;
  });
  const table = [entetes.slice()];
  for (const l of csv.lignes) {
    table.push(pos.map((i) => (i === -1 || l[i] == null ? '' : l[i])));
  }
  return {
    getLastRow: () => table.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const ligne = table[r - 1 + i] || [];
          const bout = [];
          for (let j = 0; j < nc; j++) bout.push(ligne[c - 1 + j] === undefined ? '' : ligne[c - 1 + j]);
          out.push(bout);
        }
        return out;
      }
    })
  };
}

/**
 * L'etat du balayage, traduit depuis mg_etat.json vers la forme que
 * mgEtatBalayage() rend dans Apps Script — c'est celle que la vue lit.
 *
 * Le moissonneur fait ses 26 lettres d'une traite et n'ecrit son etat qu'a la
 * fin : il n'y a donc jamais de « en cours » ici, contrairement au balayage
 * Apps Script qui se replanifie toutes les 4 minutes.
 *
 * DEUX FORMES DE FICHIER. Les versions recentes de harvest.cjs ecrivent le
 * NOMBRE de lettres (`lettres: 26`) ; une version anterieure ecrivait le
 * detail par lettre (`parLettre`). Les mg_etat.json des postes qui ont
 * moissonne il y a longtemps portent encore la seconde forme. Lire seulement
 * `parLettre` afficherait « 0 / 26 lettres » apres chaque nouveau balayage —
 * une jauge a zero sur un travail termine. On accepte donc les deux, le
 * detail d'abord parce qu'il en dit plus.
 */
function balayage() {
  const f = SRC_ETAT();
  if (!fs.existsSync(f)) return { ok: true, enCours: false, message: 'Jamais lance' };

  let e;
  try { e = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (err) { return { ok: true, enCours: false, message: 'mg_etat.json illisible' }; }

  const alphabet = MOTEUR.MG_ALPHABET || [];
  let faites, restantes;
  if (e.parLettre) {
    faites = Object.keys(e.parLettre);
    restantes = alphabet.filter((l) => faites.indexOf(l) === -1);
  } else {
    // `lettres` compte les requetes faites ; la vue n'en lit que la longueur.
    const n = Math.min(Number(e.lettres) || 0, alphabet.length);
    faites = alphabet.slice(0, n);
    restantes = alphabet.slice(n);
  }
  return {
    ok: true,
    enCours: false,
    suspendu: false,
    lettresFaites: faites,
    lettresRestantes: restantes,
    lignesLues: e.lignesLues,
    lignesEnregistrees: e.lignesEcrites,
    matriculesDistincts: e.matriculesDistincts,
    debut: e.date,
    maj: e.date,
    fin: e.date
  };
}

/** Deux chiffres a la francaise, comme Utilities.formatDate les rend. */
function horodate(d) {
  const p = (v) => String(v).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/**
 * Branche le moteur sur les CSV et lance le calcul.
 *
 * Les services Google sont poses ICI, pas dans les copies : Stats.js reste
 * identique a Stats.gs, et tout ce qui differe entre les deux mondes tient
 * dans ces quelques lignes.
 */
async function construire() {
  const fIndex = SRC_INDEX();
  if (!fIndex) {
    throw new Error(
      'Aucune source de matricules.\n' +
      '  cherche : ' + path.join(__dirname, 'mg_matricules.csv') + '\n' +
      '        et : ' + path.join(__dirname, '..', 'engages.csv') + '\n' +
      '        et : ' + path.join(__dirname, 'mg_fiches.csv') + '\n\n' +
      'Fabrique l\'index : npm run index  (26 requetes, ~90 s).');
  }
  const fFiches = SRC_FICHES();
  const fSans = SRC_SANS();

  const [cIndex, cFiches, cSans] = await Promise.all([
    lireCsv(fIndex), lireCsv(fFiches), lireCsv(fSans)
  ]);

  const feuilles = {
    [MOTEUR.MG_SHEETS.MATRICULES]: feuille(MOTEUR.MG_ENTETES.MATRICULES, cIndex),
    [MOTEUR.MG_SHEETS.SANS]:       feuille(MOTEUR.MG_ENTETES.SANS, cSans),
    [MOTEUR.MG_SHEETS.FICHES]:     feuille(MOTEUR.MG_ENTETES.FICHES, cFiches)
  };

  MOTEUR.mgFeuille_ = (nom) => feuilles[nom];
  MOTEUR.mgEnv = () => (Env.PROD ? 'prod' : 'dev');
  MOTEUR.mgClasseur_ = () => ({ getUrl: () => dossierUrl(fIndex) });
  MOTEUR.mgEtatBalayage = balayage;
  MOTEUR.Session = { getScriptTimeZone: () => 'local' };
  MOTEUR.Utilities = { formatDate: (d) => horodate(d) };

  const stats = MOTEUR.mgStatistiques();
  return { stats, sources: { index: fIndex, fiches: fFiches, sans: fSans, etat: SRC_ETAT() } };
}

/** file:// du dossier contenant un fichier — ce qui remplace l'URL du classeur. */
function dossierUrl(fichier) {
  const d = path.resolve(path.dirname(fichier)).replace(/\\/g, '/');
  return 'file:///' + encodeURI(d.replace(/^\/+/, ''));
}

/* ------------------------------------------------------------ memoire ----- */

let memo = null;

function signature() {
  return [SRC_INDEX(), SRC_FICHES(), SRC_SANS(), SRC_ETAT()].map((f) => {
    if (!f || !fs.existsSync(f)) return 'absent';
    const s = fs.statSync(f);
    return f + ':' + s.mtimeMs + ':' + s.size;
  }).join('|');
}

function oublier() { memo = null; }

/**
 * Meme regle que partout : on relit quand un fichier a change, mais pas plus
 * souvent qu'un plancher valant 20 fois la lecture precedente. Le calcul
 * parcourt l'index entier — il coute, et une page rechargee en boucle ne doit
 * pas le refaire a chaque fois.
 */
async function etat() {
  const sig = signature();
  if (memo && memo.sig === sig) return memo.v;
  const plancher = memo ? Math.min(60000, memo.duree * 20) : 0;
  if (memo && Date.now() - memo.t < plancher) return memo.v;

  const t0 = Date.now();
  const v = await construire();
  memo = { sig, v, t: Date.now(), duree: Date.now() - t0 };
  return v;
}

/* ---------------------------------------------------------------- vue ----- */

/**
 * Ce que la vue partagee dit et qui n'existe pas hors de Sheets.
 *
 * Vue.html est servie telle quelle, a ces libelles pres. Chacun nomme une
 * chose qui n'a pas d'equivalent local — un menu du classeur, le classeur
 * lui-meme, une feuille que le moissonneur ne remplit pas. Les laisser serait
 * envoyer le lecteur vers un bouton qui n'existe pas.
 *
 * `garde` est verifie par le selftest : si le module reformule une de ces
 * phrases, la substitution ne portera plus et le test le dira, plutot que de
 * laisser passer un libelle trompeur.
 */
const SUBSTITUTIONS = [
  {
    de: 'Ouvrir le classeur',
    a: 'Ouvrir le dossier des données',
    garde: true
  },
  {
    de: 'Lance <b>Cherche MG &rsaquo; Lancer le balayage complet</b> : environ 26 requêtes, ',
    a: 'Lance <b>npm run index</b> depuis cherche_mg : environ 26 requêtes, ',
    garde: true
  },
  {
    // Seulement quand rien ne peuple MG_Sans_numero : le 0 affiche voudrait
    // alors dire « aucune », quand il veut dire « pas collectees ».
    de: "'relevées, matricule inconnu'",
    a: "'non collectées par le moissonneur'",
    garde: false,
    si: (s) => !s.sources.sans
  }
];

/**
 * La page : Vue.html, ses chiffres injectes la ou Apps Script injecte les
 * siens. Le `<` est neutralise comme dans mgPageTableauDeBord() — une valeur
 * contenant « </script> » fermerait la balise et casserait la page.
 */
function page(e) {
  let html = fs.readFileSync(path.join(__dirname, 'Vue.html'), 'utf8');

  for (const s of SUBSTITUTIONS) {
    if (s.si && !s.si(e)) continue;
    html = html.split(s.de).join(s.a);
  }

  const donnees = JSON.stringify(e.stats).replace(/</g, '\\u003c');
  return html.replace('<?!= donnees ?>', donnees);
}

/* ------------------------------------------------------------- serveur ---- */

function demarrer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = u.pathname === '/api';

    try {
      const e = await etat();
      const corps = json ? JSON.stringify(e.stats) : page(e);
      res.writeHead(200, {
        'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(corps);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': json ? 'application/json' : 'text/plain; charset=utf-8' });
      res.end(json ? JSON.stringify({ ok: false, error: err.message }) : 'ECHEC : ' + err.message);
    }
  }).listen(PORT, HOST, () => {
    Env.banniere('chiffres cles des engages');
    console.log('Ouvrir : ' + Env.urlLocale(HOST, PORT));
    if (HOST === '0.0.0.0') console.log('Depuis le reseau : http://<ip-du-serveur>:' + PORT);
    console.log('Index  : ' + (SRC_INDEX() || 'absent'));
    console.log('Fiches : ' + (SRC_FICHES() || 'absentes'));
  });
}

/* ------------------------------------------------------------ selftest ---- */

async function selftest() {
  const os = require('os');
  let ok = 0, ko = 0;
  const dit = (b, t, d) => {
    if (b) { ok++; console.log('OK    ' + t); }
    else { ko++; console.log('ECHEC ' + t + (d !== undefined ? '  -> ' + d : '')); }
  };

  console.log('=== copies conformes ===');
  const amont = path.join(__dirname, '..');
  if (fs.existsSync(path.join(amont, 'Stats.gs'))) {
    for (const [copie, source] of [['Config.js', 'Config.gs'], ['Stats.js', 'Stats.gs'],
                                   ['Vue.html', 'Vue.html']]) {
      dit(fs.readFileSync(path.join(__dirname, copie), 'utf8') ===
          fs.readFileSync(path.join(amont, source), 'utf8'),
          copie + ' identique a ../' + source);
    }
  } else {
    console.log('(module Apps Script absent : comparaison sautee)');
  }
  dit(typeof MOTEUR.mgStatistiques === 'function', 'le calcul de Stats.gs est charge');

  console.log('');
  console.log('=== les libelles substitues existent encore dans la vue ===');
  const vue = fs.readFileSync(path.join(__dirname, 'Vue.html'), 'utf8');
  for (const s of SUBSTITUTIONS) {
    if (!s.garde) continue;
    dit(vue.indexOf(s.de) !== -1, 'la vue dit toujours « ' + s.de.slice(0, 40) + '… »');
  }
  dit(vue.indexOf('<?!= donnees ?>') !== -1, 'le point d injection des chiffres est la');

  console.log('');
  console.log('=== sur des CSV de synthese ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-chiffres-'));
  const fIndex = path.join(tmp, 'mg_matricules.csv');
  const fFiches = path.join(tmp, 'mg_fiches.csv');

  // 5 lignes, 4 matricules : 7 (serie ambigue) porte DEUX identites, 20000 est
  // repete a l'identique sur deux sources — le doublon ne doit compter qu'une
  // fois comme engage, mais deux fois comme ligne d'index.
  fs.writeFileSync(fIndex, [
    'matricule,identite,source,trouve_par',
    '7,Petan Jean,patro.php,p',
    '7,Moutou Samy,patro.php,m',
    '20000,Naiken Pierre,patro.php,n',
    '20000,Naiken Pierre,bibliocard.php,n',
    '125000,Ramassamy Marie,patro.php,r'
  ].join('\n') + '\n', 'utf8');

  // La colonne statut, en 2e position, decale tout : c'est elle qui casserait
  // le classement des releveurs si la feuille n'etait pas realignee par nom.
  fs.writeFileSync(fFiches, [
    'matricule,statut,identite,origine,naissance,arrivee,convoi,immatriculation,' +
      'notes,sources,contributeur,releveur,immat_entre_le,immat_et_le,recupere_le',
    '7,trouve,Petan Jean,Inde,,,,,,,Xavier Lecoq,Laurent Coutaye,,,2026-08-10',
    '20000,trouve,Naiken Pierre,Inde,,,,,,,Xavier Lecoq,Laurent Coutaye,,,2026-08-10',
    '125000,trouve,Ramassamy Marie,Afrique,,,,,,,Christian Fontaine,Virginie Chaillou,,,2026-08-10'
  ].join('\n') + '\n', 'utf8');

  process.env.MG_OUT = fIndex;
  process.env.MG_FICHES = fFiches;
  process.env.MG_ETAT = path.join(tmp, 'mg_etat.json');
  process.env.MG_SANS = path.join(tmp, 'absent.csv');
  oublier();

  let e = await etat();
  let s = e.stats;

  dit(s.matriculesDistincts === 3, '3 matricules distincts', s.matriculesDistincts);
  dit(s.lignesIndex === 5, '5 lignes d index', s.lignesIndex);
  dit(s.engagesDistincts === 4, '4 engages : le doublon exact ne compte qu une fois',
      s.engagesDistincts);
  dit(s.plage.min === 7 && s.plage.max === 125000, 'plage des matricules',
      s.plage.min + '-' + s.plage.max);
  dit(s.serieAmbigue === 1 && s.seriePrincipale === 2,
      'la serie ambigue est celle sous ' + s.seuilSerie,
      s.serieAmbigue + ' / ' + s.seriePrincipale);
  dit(s.lignesFiches === 3, '3 fiches detaillees', s.lignesFiches);
  dit(s.identitesSansNumero === 0, 'aucune identite sans numero sans fichier pour les porter');

  const d = s.distribution;
  dit(d[0].n === 2 && d[1].n === 1, 'distribution : deux matricules a 1 engage, un a 2',
      JSON.stringify(d.map((x) => x.n)));

  dit(s.tranches.length === 13, '13 tranches de 10 000', s.tranches.length);
  dit(s.tranches[0].n === 1 && s.tranches[1].n === 1 && s.tranches[12].n === 1,
      'chaque matricule tombe dans sa tranche');

  // Le piege du realignement : Releveur, pas Contributeur.
  dit(s.releveurs.length === 2 && s.releveurs[0].nom === 'Laurent Coutaye' &&
      s.releveurs[0].n === 2,
      'classement par RELEVEUR malgre la colonne statut du CSV',
      JSON.stringify(s.releveurs));
  dit(!s.releveurs.some((x) => x.nom === 'Xavier Lecoq'),
      'un contributeur n est pas compte comme releveur');

  dit(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(s.genere_le), 'horodatage a la francaise',
      s.genere_le);
  dit(s.env === (Env.PROD ? 'prod' : 'dev'), 'l environnement vient de Env.js', s.env);

  console.log('');
  console.log('=== etat du balayage ===');
  dit(s.balayage.message === 'Jamais lance', 'sans mg_etat.json : jamais lance');
  fs.writeFileSync(process.env.MG_ETAT, JSON.stringify({
    date: '2026-08-10T10:52:07.486Z', lignesLues: 324541, lignesEcrites: 23892,
    matriculesDistincts: 19541, parLettre: { a: { lues: 1 }, e: { lues: 1 } }
  }), 'utf8');
  oublier();
  s = (await etat()).stats;
  dit(s.balayage.lettresFaites.length === 2, '2 lettres faites',
      s.balayage.lettresFaites.length);
  dit(s.balayage.lettresRestantes.length === MOTEUR.MG_ALPHABET.length - 2,
      'les autres lettres sont annoncees restantes',
      s.balayage.lettresRestantes.length);
  dit(s.balayage.lettresRestantes.indexOf('a') === -1, 'une lettre faite n est pas restante');

  // La forme ecrite par harvest.cjs aujourd hui : un compte, pas un detail.
  fs.writeFileSync(process.env.MG_ETAT, JSON.stringify({
    date: '2026-08-10T10:52:07.486Z', lettres: 26, lignesLues: 324541,
    lignesEcrites: 23892, matriculesDistincts: 19541
  }), 'utf8');
  oublier();
  s = (await etat()).stats;
  dit(s.balayage.lettresFaites.length === MOTEUR.MG_ALPHABET.length,
      'sans parLettre : les 26 lettres comptent comme faites',
      s.balayage.lettresFaites.length);
  dit(s.balayage.lettresRestantes.length === 0, 'et il n en reste aucune',
      s.balayage.lettresRestantes.length);
  fs.writeFileSync(process.env.MG_ETAT, JSON.stringify({ date: 'x', lettres: 10 }), 'utf8');
  oublier();
  s = (await etat()).stats;
  dit(s.balayage.lettresFaites.length === 10 &&
      s.balayage.lettresRestantes.length === MOTEUR.MG_ALPHABET.length - 10,
      'un balayage partiel se voit encore comme partiel');

  console.log('');
  console.log('=== rendu ===');
  const html = page(await etat());
  dit(html.indexOf('<?!= donnees ?>') === -1, 'le scriptlet est remplace');
  dit(html.indexOf('var D = {') !== -1, 'les chiffres sont injectes');
  dit(html.indexOf('"matriculesDistincts":3') !== -1, 'et ce sont les bons');
  dit(html.indexOf('Ouvrir le classeur') === -1 &&
      html.indexOf('Ouvrir le dossier des données') !== -1, 'le lien du classeur est adapte');
  dit(html.indexOf('Cherche MG &rsaquo; Lancer le balayage') === -1,
      'le menu Sheets n est plus cite');
  dit(html.indexOf("'non collectées par le moissonneur'") !== -1,
      'sans fichier, la tuile ne dit pas « aucune »');
  dit(html.indexOf('Matricules par tranche de') !== -1, 'la vue est bien celle du module');

  // Avec un fichier d'identites sans numero, le libelle d'origine revient.
  const fSans = path.join(tmp, 'mg_sans_numero.csv');
  fs.writeFileSync(fSans, 'identite,source,trouve_par\nPetan,patro.php,p\n', 'utf8');
  process.env.MG_SANS = fSans;
  oublier();
  const e2 = await etat();
  dit(e2.stats.identitesSansNumero === 1, 'les identites sans numero sont comptees',
      e2.stats.identitesSansNumero);
  dit(page(e2).indexOf("'relevées, matricule inconnu'") !== -1,
      'et le libelle d origine reprend sa place');

  console.log('');
  console.log('=== ordre des sources ===');
  process.env.MG_OUT = fIndex;
  oublier();
  dit((await etat()).sources.index === fIndex, 'MG_OUT passe avant tout le reste');

  // Un chemin declare mais introuvable ne doit pas bloquer : la liste
  // continue jusqu au premier fichier qui existe vraiment.
  process.env.MG_OUT = path.join(tmp, 'nexiste-pas.csv');
  process.env.MG_ENGAGES = path.join(tmp, 'engages.csv');
  fs.writeFileSync(process.env.MG_ENGAGES,
    'matricule,identite,origine\n42,Petan Jean,Inde\n', 'utf8');
  oublier();
  const e3 = await etat();
  dit(e3.sources.index !== process.env.MG_OUT,
      'un MG_OUT introuvable ne bloque pas : on passe au suivant');
  dit(fs.existsSync(e3.sources.index), 'la source retenue existe', e3.sources.index);

  // Le repli sur engages.csv ne se constate que si le dossier n a pas son
  // propre mg_matricules.csv — sur un poste qui a deja moissonne, il l a.
  if (fs.existsSync(path.join(__dirname, 'mg_matricules.csv'))) {
    console.log('SAUTE mg_matricules.csv present : repli sur engages.csv non observable ici');
  } else {
    dit(e3.sources.index === process.env.MG_ENGAGES, 'sans index, engages.csv prend le relais');
    dit(e3.stats.matriculesDistincts === 1, 'et le calcul tourne dessus',
        e3.stats.matriculesDistincts);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  for (const v of ['MG_OUT', 'MG_FICHES', 'MG_ETAT', 'MG_SANS', 'MG_ENGAGES']) delete process.env[v];
  oublier();

  console.log('');
  console.log(ok + ' OK, ' + ko + ' echec(s)');
  return ko === 0;
}

/* --------------------------------------------------------------- main ----- */

module.exports = { construire, etat, oublier, page, feuille, balayage, SUBSTITUTIONS,
                   SRC_INDEX, SRC_FICHES, selftest };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    selftest().then((bon) => process.exit(bon ? 0 : 1));
  } else {
    demarrer();
  }
}
