#!/usr/bin/env node
/**
 * ============================================================================
 *  CROISEMENT MG x IDLR — le programme principal.
 *
 *  Repond aux deux questions, dans les deux sens :
 *    1. les matricules releves dans les actes IDLR sont-ils dans cherchemg.fr ?
 *    2. les matricules de cherchemg.fr apparaissent-ils dans les actes IDLR ?
 *
 *  Produit quatre fichiers dans CFG.DOSSIER :
 *    idlr_absents_de_mg.csv   ce qu'IDLR sait et que MG ignore (a signaler au
 *                             site : ce sont des matricules sourcees par un acte)
 *    mg_absents_didlr.csv     ce que MG sait et qu'aucun acte IDLR ne porte
 *    communs.csv              les deux cotes, avec un test de concordance du nom
 *    resume.json              les compteurs + le diagnostic
 *  et ajoute une entree a historique.json (evolution d'une execution a l'autre).
 *
 *  AVERTISSEMENT METIER — a lire avant d'interpreter les sorties.
 *  cherchemg.fr previent : « Ne confondez pas le numero de matricule general
 *  avec le numero de matricule communal. » Le « n°… » lu dans les observations
 *  IDLR n'est pas garanti etre une MG. Le taux de recouvrement calcule ici est
 *  precisement le test : un recouvrement eleve confirme qu'on parle de la meme
 *  serie ; un recouvrement quasi nul signifierait qu'on compare deux
 *  numerotations differentes, et rendrait les deux listes d'ecarts sans objet.
 *  Le resume affiche ce taux et son interpretation.
 *
 *  Usage :  node croiser.cjs
 *           node croiser.cjs --selftest    # hors ligne, jeux d'essai
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const CFG = require('./Config.js');
const { lireIndexMg, ageIndexMgJours, ligneCsv } = require('./mg.cjs');
const { lireIdlr } = require('./idlr.cjs');
const Env = require('./Env.js');

/* ------------------------------------------------- concordance des noms ---- */

const VIDES = new Set(['dit', 'dite', 'ou', 'de', 'du', 'des', 'la', 'le', 'les', 'ne', 'nee', 'veuve', 'epouse']);

/** Jetons significatifs d'un nom : sans accent, >= 3 lettres, mots outils ecartes. */
function jetons(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3 && !VIDES.has(t));
}

/**
 * L'identite MG et le nom IDLR designent-ils plausiblement la meme personne ?
 * @return {'oui'|'non'|'?'}  '?' si l'un des deux cotes n'a rien d'exploitable
 */
function concordance(identiteMg, nomIdlr, prenomIdlr) {
  const a = new Set(jetons(identiteMg));
  const b = jetons(nomIdlr + ' ' + prenomIdlr);
  if (!a.size || !b.length) return '?';
  return b.some((t) => a.has(t)) ? 'oui' : 'non';
}

/* ---------------------------------------------------------------- sortie --- */

function ecrireCsv(cle, colonnes, lignes) {
  const chemin = CFG.chemin(cle);
  const flux = fs.createWriteStream(chemin + '.tmp');
  flux.write(ligneCsv(colonnes));
  for (const l of lignes) flux.write(ligneCsv(l));
  return new Promise((res, rej) => flux.end((e) => {
    if (e) return rej(e);
    fs.renameSync(chemin + '.tmp', chemin);
    res(chemin);
  }));
}

/* -------------------------------------------------------------- croisement */

async function croiser() {
  const t0 = Date.now();

  const mg = lireIndexMg();
  const idlr = await lireIdlr();

  const mgSet = mg.parMatricule;
  const idlrSet = idlr.parMatricule;

  /* --- sens 1 : IDLR -> MG ------------------------------------------------ */
  const absentsDeMg = [];
  const communs = [];
  let actesCouverts = 0, actesOrphelins = 0;

  for (const [num, e] of idlrSet) {
    const dansMg = mgSet.get(num);
    if (!dansMg) {
      actesOrphelins += e.n;
      for (const x of e.exemples) {
        absentsDeMg.push([num, e.n, x.nom, x.prenom, x.commune, x.date_iso, x.type_acte, x.numero, x.url]);
      }
      continue;
    }
    actesCouverts += e.n;
    const x = e.exemples[0] || {};
    for (const idm of dansMg) {
      communs.push([
        num,
        num < CFG.SEUIL_SERIE_AMBIGUE ? 'oui' : 'non',
        e.n, dansMg.length + (dansMg.enPlus || 0),
        idm.identite, x.nom || '', x.prenom || '', x.commune || '', x.date_iso || '',
        concordance(idm.identite, x.nom, x.prenom),
        idm.source
      ]);
    }
  }

  /* --- sens 2 : MG -> IDLR ------------------------------------------------ */
  const absentsDIdlr = [];
  for (const [num, identites] of mgSet) {
    if (idlrSet.has(num)) continue;
    for (const idm of identites) {
      absentsDIdlr.push([
        num, num < CFG.SEUIL_SERIE_AMBIGUE ? 'oui' : 'non',
        identites.length + (identites.enPlus || 0), idm.identite, idm.source
      ]);
    }
  }

  /* --- ecriture ----------------------------------------------------------- */
  absentsDeMg.sort((a, b) => a[0] - b[0]);
  absentsDIdlr.sort((a, b) => a[0] - b[0]);
  communs.sort((a, b) => a[0] - b[0]);

  await ecrireCsv('ABSENTS_MG',
    ['matricule', 'nb_actes_idlr', 'nom', 'prenom', 'commune', 'date_iso', 'type_acte', 'numero_photo', 'url_demande_photo'],
    absentsDeMg);
  await ecrireCsv('ABSENTS_IDLR',
    ['matricule', 'serie_ambigue', 'nb_identites_mg', 'identite', 'source'],
    absentsDIdlr);
  await ecrireCsv('COMMUNS',
    ['matricule', 'serie_ambigue', 'nb_actes_idlr', 'nb_identites_mg', 'identite_mg',
     'nom_idlr', 'prenom_idlr', 'commune', 'date_iso', 'concordance_nom', 'source_mg'],
    communs);

  /* --- compteurs et diagnostic ------------------------------------------- */
  const communsDistincts = new Set(communs.map((l) => l[0])).size;
  const idlrDistincts = idlrSet.size;
  const mgDistincts = mgSet.size;
  const recouvrementIdlr = idlrDistincts ? communsDistincts / idlrDistincts : 0;
  const recouvrementMg = mgDistincts ? communsDistincts / mgDistincts : 0;

  const discordants = communs.filter((l) => l[9] === 'non').length;
  const testables = communs.filter((l) => l[9] !== '?').length;

  // Texte destiné à l'écran (tableau de bord, Discord) : accentué, contrairement
  // aux fichiers .gs du module Apps Script qui restent volontairement en ASCII.
  let diagnostic;
  if (recouvrementIdlr >= 0.5) {
    diagnostic = 'Recouvrement élevé : les deux sources parlent bien de la même série de matricules.';
  } else if (recouvrementIdlr >= 0.15) {
    diagnostic = 'Recouvrement partiel : même série, mais les deux bases se complètent largement. ' +
                 'Les écarts sont exploitables.';
  } else {
    diagnostic = 'Recouvrement TRÈS FAIBLE. Avant d\'exploiter les écarts, vérifie que le ' +
                 '« n° » lu dans les observations IDLR est bien un matricule GÉNÉRAL et non ' +
                 'un matricule COMMUNAL : ce sont deux numérotations distinctes, et les ' +
                 'comparer n\'aurait alors aucun sens.';
  }

  const resume = {
    date: new Date().toISOString(),
    duree_s: Math.round((Date.now() - t0) / 1000),

    sources: {
      mg: {
        fichier: CFG.MG_INDEX,
        age_jours: Math.round(ageIndexMgJours()),
        matriculesDistincts: mgDistincts,
        lignes: mg.lignes
      },
      idlr: {
        type: idlr.source.type,
        fichier: idlr.source.chemin,
        date: idlr.source.date,
        actes: idlr.stats.actes,
        actesAvecMatricule: idlr.stats.avecMatricule,
        matriculesDistincts: idlrDistincts,
        horsPlage: idlr.stats.horsPlage,
        horsPlageDistincts: idlr.stats.horsPlageDistincts
      }
    },

    communs: communsDistincts,
    idlrAbsentsDeMg: idlrDistincts - communsDistincts,
    mgAbsentsDIdlr: mgDistincts - communsDistincts,
    actesIdlrCouverts: actesCouverts,
    actesIdlrOrphelins: actesOrphelins,

    recouvrement: {
      idlr_vers_mg: Math.round(recouvrementIdlr * 1000) / 10,
      mg_vers_idlr: Math.round(recouvrementMg * 1000) / 10
    },

    concordanceNoms: {
      testables,
      discordants,
      taux_discordance: testables ? Math.round(discordants / testables * 1000) / 10 : 0
    },

    serieAmbigue: {
      seuil: CFG.SEUIL_SERIE_AMBIGUE,
      communs: new Set(communs.filter((l) => l[1] === 'oui').map((l) => l[0])).size
    },

    diagnostic
  };

  fs.writeFileSync(CFG.chemin('RESUME'), JSON.stringify(resume, null, 2));

  // Historique : une entree par execution, pour suivre l'evolution.
  const fh = CFG.chemin('HISTORIQUE');
  let hist = [];
  if (fs.existsSync(fh)) { try { hist = JSON.parse(fs.readFileSync(fh, 'utf8')); } catch { hist = []; } }
  hist.push({
    date: resume.date,
    mg: mgDistincts, idlr: idlrDistincts, communs: communsDistincts,
    idlrAbsentsDeMg: resume.idlrAbsentsDeMg, mgAbsentsDIdlr: resume.mgAbsentsDIdlr,
    recouvrement_idlr_vers_mg: resume.recouvrement.idlr_vers_mg
  });
  fs.writeFileSync(fh, JSON.stringify(hist, null, 2));

  return resume;
}

/* ------------------------------------------------------------- affichage --- */

function afficher(r) {
  const n = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  console.log('');
  console.log('  SOURCE MG   : ' + n(r.sources.mg.matriculesDistincts) + ' matricules distincts' +
              '  (index vieux de ' + r.sources.mg.age_jours + ' j)');
  console.log('  SOURCE IDLR : ' + n(r.sources.idlr.matriculesDistincts) + ' matricules distincts' +
              '  sur ' + n(r.sources.idlr.actesAvecMatricule) + ' actes matriculés');
  if (r.sources.idlr.horsPlage) {
    console.log('                ' + n(r.sources.idlr.horsPlage) + ' actes portent un n° hors 1..' +
                CFG.MG_MAX + ' (ignorés)');
  }
  console.log('');
  console.log('  COMMUNS                      ' + n(r.communs).padStart(8));
  console.log('  dans IDLR, absents de MG     ' + n(r.idlrAbsentsDeMg).padStart(8) +
              '   -> ' + CFG.FICHIERS.ABSENTS_MG);
  console.log('  dans MG, absents d\'IDLR      ' + n(r.mgAbsentsDIdlr).padStart(8) +
              '   -> ' + CFG.FICHIERS.ABSENTS_IDLR);
  console.log('');
  console.log('  recouvrement IDLR -> MG      ' + String(r.recouvrement.idlr_vers_mg).padStart(7) + ' %');
  console.log('  recouvrement MG -> IDLR      ' + String(r.recouvrement.mg_vers_idlr).padStart(7) + ' %');
  console.log('  noms discordants (communs)   ' + String(r.concordanceNoms.taux_discordance).padStart(7) +
              ' %   (' + n(r.concordanceNoms.discordants) + ' sur ' + n(r.concordanceNoms.testables) + ')');
  console.log('');
  console.log('  ' + r.diagnostic);
  console.log('');
}

/* -------------------------------------------------------------- selftest --- */

/**
 * Une copie conforme doit le rester. Sans ce controle, deux dossiers
 * divergent en silence et on debogue longtemps la mauvaise version.
 */
function verifierCopie(nom, reference) {
  if (!fs.existsSync(reference)) { console.log("SAUTE  reference absente : " + nom); return; }
  const ok = fs.readFileSync(require("path").join(__dirname, nom), "utf8")
           === fs.readFileSync(reference, "utf8");
  console.log((ok ? "OK   " : "ECHEC") + " " + nom + " identique a la reference");
  if (!ok) process.exitCode = 1;
}

function selftest() {
  let ko = 0;
  const check = (nom, reel, attendu) => {
    const ok = JSON.stringify(reel) === JSON.stringify(attendu);
    if (!ok) ko++;
    console.log(`${ok ? 'OK   ' : 'ECHEC'} ${nom}` + (ok ? '' :
      `\n        attendu ${JSON.stringify(attendu)}\n        obtenu  ${JSON.stringify(reel)}`));
  };

  console.log('=== concordance des noms ===');
  check('meme patronyme', concordance('KICHENIN', 'KICHENIN', 'Nicolas'), 'oui');
  check('identite composee', concordance('DJETTOU Soura', 'DJETTOU', 'Soura'), 'oui');
  check('« dit » ignore', concordance('AMADI dit Julien', 'AMADI', ''), 'oui');
  check('accents ignores', concordance('AGREPATA', 'AGRÉPATA', 'Marie'), 'oui');
  check('sans rapport', concordance('Tazana', 'HOARAU', 'Jean'), 'non');
  check('identite MG vide', concordance('', 'HOARAU', 'Jean'), '?');
  check('nom IDLR vide', concordance('Tazana', '', ''), '?');
  check('jeton trop court ignore', concordance('Li', 'Li', ''), '?');

  console.log('');
  console.log('=== environnement ===');
  check('OCI_ENV reconnu', ['dev', 'prod'].indexOf(Env.NOM) !== -1, true);
  check('reseau ferme en dev sans autorisation',
        (Env.DEV && !process.env.OCI_RESEAU) ? Env.RESEAU === false : true, true);
  verifierCopie('Env.js',
    path.join(__dirname, '..', 'ile_archive_de_la_reunion', 'moissonneur', 'Env.js'));
  console.log('\n=== chaine de lecture ===');
  // Cette application ne parse plus rien : elle lit deux sorties de moissonneur.
  // La non-derive des copies du parser MG est verifiee chez son proprietaire,
  // par `cherche_mg/moissonneur/harvest.cjs --selftest`.
  check('index MG resolu', typeof CFG.MG_INDEX === 'string' && CFG.MG_INDEX.length > 0, true);
  check('sources IDLR resolues',
        typeof CFG.IDLR_DB === 'string' && typeof CFG.IDLR_CSV === 'string', true);
  // Etat des sources : une information, pas une assertion. Leur absence n'est
  // pas un bug — c'est le moissonnage qui n'a pas encore tourne.
  const etat = (f) => (fs.existsSync(f) ? 'present' : 'ABSENT');
  console.log(`       index MG   : ${etat(CFG.MG_INDEX)}  ${CFG.MG_INDEX}`);
  console.log(`       actes IDLR : ${etat(CFG.IDLR_CSV)}  ${CFG.IDLR_CSV}`);
  console.log(`                    ${etat(CFG.IDLR_DB)}  ${CFG.IDLR_DB}`);

  console.log(ko === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${ko} ECHEC(S)`);
  return ko;
}

/* ------------------------------------------------------------------ CLI --- */

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() === 0 ? 0 : 1);
  }
  croiser()
    .then(afficher)
    .catch((e) => { console.error('ECHEC : ' + (e && e.message ? e.message : e)); process.exit(1); });
}

module.exports = { croiser, concordance, jetons };
