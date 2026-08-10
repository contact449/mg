#!/usr/bin/env node
/**
 * ============================================================================
 *  Source B — matricules releves dans les actes de iledelareunion-archive.com,
 *  tels que le moissonneur IDLR les a extraits du champ « observations ».
 *
 *  Le moissonneur ecrit actes.csv ; search.cjs et fixmat.cjs travaillent sur
 *  actes.db. On lit CE QUI EXISTE, le plus recent des deux, sans rien imposer
 *  au VPS. SQLite passe par node:sqlite (Node 22 : --experimental-sqlite ;
 *  Node 24+ : rien a faire) ; si le module manque, on retombe sur le CSV.
 *
 *  Usage :  node idlr.cjs            # compte et resume la source detectee
 *           node idlr.cjs --tete 20  # montre les 20 premiers matricules
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const CFG = require('./Config.js');

/** « N°2-537 » -> 2537. Regex reprise telle quelle de harvest.cjs / fixmat.cjs. */
const MATRICULE_RE = /[nN]\s*°\s*(\d+(?:[.\-]\d+)*)/;
function matriculeDepuisObs(obs) {
  const m = MATRICULE_RE.exec(obs || '');
  return m ? m[1].replace(/\D/g, '') : '';
}

/* ------------------------------------------------------- choix de la source */

/** Renvoie { type:'sqlite'|'csv', chemin, mtime } ou null si rien n'est lisible. */
function detecterSource() {
  const candidats = [];
  if (fs.existsSync(CFG.IDLR_DB)) {
    candidats.push({ type: 'sqlite', chemin: CFG.IDLR_DB, mtime: fs.statSync(CFG.IDLR_DB).mtimeMs });
  }
  if (fs.existsSync(CFG.IDLR_CSV)) {
    candidats.push({ type: 'csv', chemin: CFG.IDLR_CSV, mtime: fs.statSync(CFG.IDLR_CSV).mtimeMs });
  }
  if (!candidats.length) return null;
  candidats.sort((a, b) => b.mtime - a.mtime);          // le plus recent gagne

  if (candidats[0].type === 'sqlite') {
    try { require('node:sqlite'); }
    catch {
      const csv = candidats.find((c) => c.type === 'csv');
      if (csv) { csv.repli = 'node:sqlite indisponible'; return csv; }
      throw new Error('actes.db trouve mais node:sqlite indisponible — lance avec ' +
                      '`node --experimental-sqlite`, ou fournis actes.csv (IDLR_OUT=...)');
    }
  }
  return candidats[0];
}

/* ------------------------------------------------- lecture CSV en flux ---- */

/**
 * Analyse un CSV en flux, sans jamais charger le fichier entier.
 * Gere les guillemets et les retours a la ligne encadres (le champ `obs` en
 * contient). Appelle onLigne(tableauDeChamps) pour chaque ligne.
 */
function parcourirCsv(chemin, onLigne) {
  return new Promise((resolve, reject) => {
    let champ = '';
    let ligne = [];
    let dansGuillemets = false;
    let guillemetEnAttente = false;   // un '"' vu en fin de chunk

    const flux = fs.createReadStream(chemin, { encoding: 'utf8', highWaterMark: 1 << 20 });

    flux.on('data', (bloc) => {
      for (let i = 0; i < bloc.length; i++) {
        const c = bloc[i];
        if (guillemetEnAttente) {
          guillemetEnAttente = false;
          if (c === '"') { champ += '"'; continue; }     // guillemet echappe
          dansGuillemets = false;                        // fin de champ encadre
        }
        if (dansGuillemets) {
          if (c === '"') {
            if (i + 1 < bloc.length) {
              if (bloc[i + 1] === '"') { champ += '"'; i++; }
              else dansGuillemets = false;
            } else guillemetEnAttente = true;            // trancher au chunk suivant
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

/* ------------------------------------------------------------ lecture ---- */

function ajouter(index, mg, acte, stats) {
  if (!Number.isInteger(mg) || mg <= 0) return;
  stats.avecMatricule++;
  if (mg < CFG.MG_MIN || mg > CFG.MG_MAX) {
    stats.horsPlage++;
    if (!index.horsPlage.has(mg)) index.horsPlage.set(mg, 0);
    index.horsPlage.set(mg, index.horsPlage.get(mg) + 1);
    return;                                   // ne peut pas etre une MG
  }
  let e = index.parMatricule.get(mg);
  if (!e) { e = { n: 0, exemples: [] }; index.parMatricule.set(mg, e); }
  e.n++;
  if (e.exemples.length < CFG.MAX_EXEMPLES) e.exemples.push(acte);
}

/**
 * Charge les matricules IDLR.
 * @return {Promise<{parMatricule:Map, horsPlage:Map, source:Object, stats:Object}>}
 */
async function lireIdlr() {
  const source = detecterSource();
  if (!source) {
    throw new Error(
      'Aucune source IDLR.\n' +
      '  cherche : ' + CFG.IDLR_DB + '\n' +
      '        et : ' + CFG.IDLR_CSV + '\n' +
      'Lance le moissonneur (ile_archive_de_la_reunion/moissonneur/harvest.cjs) ' +
      'ou pointe IDLR_DB / IDLR_OUT vers les fichiers du VPS.');
  }

  const index = { parMatricule: new Map(), horsPlage: new Map() };
  const stats = { actes: 0, avecMatricule: 0, horsPlage: 0 };

  if (source.type === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(source.chemin, { readOnly: true });
    const rows = db.prepare(
      "SELECT matricule, obs, type_acte, commune, date_iso, nom, prenom, numero, url_demande_photo " +
      "FROM actes WHERE matricule <> '' OR obs LIKE '%°%'").all();
    for (const r of rows) {
      stats.actes++;
      // On refait l'extraction depuis `obs` : c'est la seule facon d'etre
      // insensible a une colonne `matricule` remplie par une ancienne regex.
      const brut = matriculeDepuisObs(r.obs) || String(r.matricule || '').replace(/\D/g, '');
      if (!brut) continue;
      ajouter(index, Number(brut), {
        type_acte: r.type_acte || '', commune: r.commune || '', date_iso: r.date_iso || '',
        nom: r.nom || '', prenom: r.prenom || '', numero: r.numero || '',
        url: r.url_demande_photo || ''
      }, stats);
    }
    db.close();
  } else {
    let entete = null;
    await parcourirCsv(source.chemin, (l) => {
      if (!entete) { entete = l.map((x) => x.trim()); return; }
      stats.actes++;
      const col = (nom) => { const i = entete.indexOf(nom); return i === -1 ? '' : (l[i] || ''); };
      const brut = matriculeDepuisObs(col('obs')) || col('matricule').replace(/\D/g, '');
      if (!brut) return;
      ajouter(index, Number(brut), {
        type_acte: col('type_acte'), commune: col('commune'), date_iso: col('date_iso'),
        nom: col('nom'), prenom: col('prenom'), numero: col('numero'),
        url: col('url_demande_photo')
      }, stats);
    });
  }

  return {
    parMatricule: index.parMatricule,
    horsPlage: index.horsPlage,
    source: { ...source, date: new Date(source.mtime).toISOString() },
    stats: { ...stats, matriculesDistincts: index.parMatricule.size,
             horsPlageDistincts: index.horsPlage.size }
  };
}

/* --------------------------------------------------------------- CLI ---- */

async function principal() {
  const args = process.argv.slice(2);
  const r = await lireIdlr();
  console.log(`source   : ${r.source.type} — ${r.source.chemin}`);
  console.log(`          modifiee le ${r.source.date.slice(0, 10)}` +
              (r.source.repli ? `  (repli : ${r.source.repli})` : ''));
  console.log(`actes lus            : ${r.stats.actes}`);
  console.log(`actes avec matricule : ${r.stats.avecMatricule}`);
  console.log(`matricules distincts : ${r.stats.matriculesDistincts}`);
  console.log(`hors plage 1..${CFG.MG_MAX}   : ${r.stats.horsPlage} actes ` +
              `(${r.stats.horsPlageDistincts} numeros) — ne peuvent pas etre des MG`);

  const i = args.indexOf('--tete');
  if (i !== -1) {
    const n = Number(args[i + 1] || 10);
    const cles = [...r.parMatricule.keys()].sort((a, b) => a - b).slice(0, n);
    for (const mg of cles) {
      const e = r.parMatricule.get(mg);
      const x = e.exemples[0] || {};
      console.log(`  ${String(mg).padStart(6)}  ${e.n} acte(s)  ${x.nom || ''} ${x.prenom || ''} ` +
                  `${x.commune || ''} ${x.date_iso || ''}`);
    }
  }
}

module.exports = { lireIdlr, detecterSource, matriculeDepuisObs, parcourirCsv };

if (require.main === module) {
  principal().catch((e) => { console.error('ECHEC : ' + (e && e.message ? e.message : e)); process.exit(1); });
}
