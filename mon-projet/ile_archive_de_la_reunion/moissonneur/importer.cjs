#!/usr/bin/env node
/**
 * actes.csv  ->  actes.db   (le chainon manquant du dossier)
 *
 * harvest.cjs ecrit un CSV ; search.cjs et fixmat.cjs travaillent sur SQLite.
 * Rien ne faisait la conversion : ce script la fait, et pose les index dont
 * search.cjs a besoin pour rester rapide sur une base d'un million de lignes.
 *
 * Lancer :  node importer.cjs                  # actes.csv -> actes.db
 *           node importer.cjs --selftest       # verifs hors ligne
 * Reglages (env) : IDLR_OUT=actes.csv   IDLR_DB=actes.db
 *
 * Rejouable : la table est recreee a chaque fois. Le CSV reste la source de
 * verite, la base n'est qu'un index de consultation qu'on peut jeter.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch {
  console.error('node:sqlite indisponible - lance avec :  node --experimental-sqlite importer.cjs');
  process.exit(1);
}

const LOT = 5000;

/** Analyse CSV en flux : guillemets et retours a la ligne encadres compris. */
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
            if (i + 1 < bloc.length) {
              if (bloc[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false;
            } else guillemetEnAttente = true;
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
    flux.on('end', () => {
      if (champ !== '' || ligne.length) { ligne.push(champ); onLigne(ligne); }
      resolve();
    });
  });
}

/**
 * Index poses APRES l'insertion : les tenir a jour pendant la coulee est
 * nettement plus lent. Ils suivent exactement les filtres de search.cjs.
 *
 * nom est indexe COLLATE NOCASE, et ce n'est pas cosmetique : le LIKE de
 * SQLite ignore la casse par defaut, donc un index ordinaire ne serait PAS
 * utilise par le `nom LIKE 'DUPONT%'` de search.cjs.
 */
const INDEX = [
  'CREATE INDEX IF NOT EXISTS idx_nom ON actes(nom COLLATE NOCASE)',
  'CREATE INDEX IF NOT EXISTS idx_matricule ON actes(matricule)',
  'CREATE INDEX IF NOT EXISTS idx_commune ON actes(commune)',
  'CREATE INDEX IF NOT EXISTS idx_type ON actes(type_acte)'
];

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

/**
 * Convertit un CSV d'actes en base SQLite consultable.
 * Les chemins sont des PARAMETRES (defauts pris dans l'environnement) : sans
 * ca, le selftest ne pourrait pas travailler sur ses propres fichiers.
 */
async function importer(cheminCsv, cheminDb, opts) {
  opts = opts || {};
  const csv = cheminCsv || process.env.IDLR_OUT || path.join(__dirname, 'actes.csv');
  const base = cheminDb || process.env.IDLR_DB || path.join(__dirname, 'actes.db');
  const dire = opts.silencieux ? function () {} : console.log;

  if (!fs.existsSync(csv)) {
    throw new Error('CSV introuvable : ' + csv +
                    '\nLance d\'abord le moissonneur :  node harvest.cjs');
  }

  const t0 = Date.now();
  dire('Lecture  : ' + csv);
  dire('Ecriture : ' + base);

  try { fs.unlinkSync(base); } catch (e) { /* premiere fois */ }
  const db = new DatabaseSync(base);
  db.exec('PRAGMA journal_mode = OFF');
  db.exec('PRAGMA synchronous = OFF');

  let entete = null, ins = null, n = 0, reparees = 0, transaction = false;

  // Le moissonneur ecrit certaines lignes plusieurs fois : un acte remonte
  // dans plusieurs buckets et les recoltes successives se recouvrent.
  //
  // La cle d'unicite est la LIGNE ENTIERE, surtout pas `numero` : celui-ci
  // identifie une PHOTO, et une meme photo porte souvent plusieurs personnes
  // (les deux epoux d un mariage), chacune avec son matricule. Dedoublonner
  // sur `numero` detruirait 6 647 matricules sur 22 399.
  //
  // Mesure sur la base actuelle : 39 369 lignes, dont 5 160 doublons
  // parfaits, soit 34 209 releves reels pour 22 960 photos.
  const vues = new Set();
  let doublons = 0;

  await parcourirCsv(csv, function (l) {
    if (!entete) {
      entete = l.map(function (h) { return h.trim(); });
      db.exec('CREATE TABLE actes (' +
              entete.map(function (c) { return '"' + c + '" TEXT'; }).join(', ') + ')');
      ins = db.prepare('INSERT INTO actes VALUES (' +
                       entete.map(function () { return '?'; }).join(',') + ')');
      db.exec('BEGIN'); transaction = true;
      return;
    }
    // Ligne au mauvais gabarit : on complete ou on tronque plutot que de la
    // perdre. Le compteur final dit combien ont ete rattrapees.
    if (l.length !== entete.length) {
      reparees++;
      while (l.length < entete.length) l.push('');
      if (l.length > entete.length) l = l.slice(0, entete.length);
    }
    const cle = empreinte(l);
    if (vues.has(cle)) { doublons++; return; }
    vues.add(cle);
    ins.run.apply(ins, l);
    n++;
    if (n % LOT === 0) {
      db.exec('COMMIT'); db.exec('BEGIN');
      if (n % 100000 === 0) dire('  ' + n + ' actes...');
    }
  });

  if (transaction) db.exec('COMMIT');
  if (!entete) { db.close(); throw new Error('CSV vide : ' + csv); }

  dire('Index...');
  for (var i = 0; i < INDEX.length; i++) db.exec(INDEX[i]);

  const total = db.prepare('SELECT COUNT(*) AS n FROM actes').get().n;
  const mats = db.prepare(
    'SELECT COUNT(DISTINCT matricule) AS n FROM actes WHERE matricule <> \'\'').get().n;
  db.close();

  dire('\nTermine en ' + Math.round((Date.now() - t0) / 1000) + ' s');
  dire('  ' + total + ' actes');
  dire('  ' + mats + ' matricules distincts');
  if (doublons) dire('  ' + doublons + ' doublons parfaits ecartes');
  if (reparees) dire('  ' + reparees + ' lignes au gabarit inattendu (completees)');
  dire('\nConsulter :  node search.cjs');

  return { actes: total, matricules: mats, reparees: reparees, doublons: doublons, base: base };
}

/* ------------------------------------------------------------- selftest -- */

async function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idlr-import-'));
  const csv = path.join(tmp, 'a.csv');
  const base = path.join(tmp, 'a.db');

  // Un acte piegeux : virgule, guillemets doubles et saut de ligne DANS obs.
  fs.writeFileSync(csv,
    'matricule,type_acte,commune,date_iso,nom,prenom,sexe,conjoint_nom,' +
    'conjoint_prenom,age,origine,obs,numero,url_demande_photo\n' +
    '537,N,Saint-Denis,1855-08-06,HOARAU,Jean,M,,,,,' +
    '"acte N537, dit ""le jeune"",\nfils de",P1,http://x/P1\n' +
    ',D,Le Tampon,1890-01-01,PAYET,Marie,F,,,,,sans numero,P2,http://x/P2\n' +
    '537,M,Saint-Paul,1875-02-02,HOARAU,Jean,M,,,,,meme matricule,P3,http://x/P3\n' +
    // copie EXACTE de la 1re ligne : doit disparaitre
    '537,N,Saint-Denis,1855-08-06,HOARAU,Jean,M,,,,,' +
    '"acte N537, dit ""le jeune"",\nfils de",P1,http://x/P1\n' +
    // MEME photo P1, mais une AUTRE personne : doit etre CONSERVEE
    '900,N,Saint-Denis,1855-08-06,PAYET,Anne,F,,,,,epouse,P1,http://x/P1\n');

  let ko = 0;
  function check(nom, reel, attendu) {
    const ok = JSON.stringify(reel) === JSON.stringify(attendu);
    if (!ok) ko++;
    console.log((ok ? 'OK   ' : 'ECHEC') + ' ' + nom + (ok ? '' :
      '\n        attendu ' + JSON.stringify(attendu) +
      '\n        obtenu  ' + JSON.stringify(reel)));
  }

  const r = await importer(csv, base, { silencieux: true });
  check('4 lignes conservees (le doublon parfait saute)', r.actes, 4);
  check('1 doublon parfait detecte', r.doublons, 1);
  // Le point qui compte : une meme photo peut porter deux personnes.
  check('meme photo, deux personnes : les deux sont gardees',
        r.matricules, 2);

  check('aucune ligne au mauvais gabarit', r.reparees, 0);

  const db = new DatabaseSync(base, { readOnly: true });
  const l = db.prepare('SELECT * FROM actes WHERE numero = \'P1\'').get();
  check('virgule, guillemets et saut de ligne conserves',
        /le jeune/.test(l.obs) && /fils de/.test(l.obs), true);
  check('la colonne suivante n a pas glisse', l.numero, 'P1');
  check('4 index poses',
        db.prepare('SELECT COUNT(*) AS n FROM sqlite_master ' +
                   'WHERE type = \'index\' AND name LIKE \'idx_%\'').get().n, 4);

  // Le point qui justifie COLLATE NOCASE : sans lui, ce plan ferait un SCAN.
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM actes ' +
                          'WHERE nom LIKE \'HOA%\'').all()
    .map(function (x) { return x.detail; }).join(' ');
  check('le LIKE prefixe passe par idx_nom', /idx_nom/.test(plan), true);
  db.close();

  // Rejouable : deux imports d'affilee donnent la meme base, pas le double.
  const r2 = await importer(csv, base, { silencieux: true });
  check('import rejouable, resultat identique', r2.actes, 4);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ko === 0 ? '\nTOUS LES TESTS PASSENT' : '\n' + ko + ' ECHEC(S)');
  process.exit(ko === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ CLI -- */

if (require.main === module) {
  if (process.argv.indexOf('--selftest') !== -1) {
    selftest().catch(function (e) { console.error(e); process.exit(1); });
  } else {
    importer().catch(function (e) {
      console.error('ECHEC : ' + (e && e.message ? e.message : e));
      process.exit(1);
    });
  }
}

module.exports = { importer: importer, parcourirCsv: parcourirCsv };
