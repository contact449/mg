#!/usr/bin/env node
/**
 * ============================================================================
 *  Source A — lecture de l'index des matricules de cherchemg.fr.
 *
 *  Pendant exact de idlr.cjs : ce fichier ne fait que LIRE ce que le
 *  moissonneur a produit. La collecte appartient au module source :
 *      cherche_mg/moissonneur/harvest.cjs --index      (26 requetes, ~90 s)
 *
 *  Pourquoi lire un CSV plutot que la feuille Google de cherche_mg ? Parce que
 *  le croisement tourne sur le VPS, la ou vivent les actes IDLR : pas d'OAuth,
 *  pas de deploiement Apps Script a maintenir, pas de couplage.
 *
 *  Usage :  node mg.cjs            # ce que voit le cote MG (diagnostic)
 *           node mg.cjs --tete 20  # les 20 premiers matricules
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const CFG = require('./Config.js');

/* ---------------------------------------------------------------- CSV ---- */

function champCsv(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const ligneCsv = (vals) => vals.map(champCsv).join(',') + '\n';

/** Analyse CSV tolerante aux guillemets et aux retours a la ligne encadres. */
function* lignesDuCsv(texte) {
  let champ = '';
  let ligne = [];
  let dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; }
        else dansGuillemets = false;
      } else champ += c;
      continue;
    }
    if (c === '"') { dansGuillemets = true; continue; }
    if (c === ',') { ligne.push(champ); champ = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.length > 1 || ligne[0] !== '') yield ligne;
      ligne = [];
      continue;
    }
    champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); yield ligne; }
}

/* ------------------------------------------------------------- lecture ---- */

/**
 * Index MG en memoire.
 * @return {{parMatricule:Map<number,Array>, distincts:number, lignes:number}}
 */
function lireIndexMg(chemin = CFG.MG_INDEX) {
  if (!fs.existsSync(chemin)) {
    throw new Error(
      'Index MG absent : ' + chemin + '\n' +
      'Produis-le avec le moissonneur MG :\n' +
      '  cd ' + CFG.MOISSONNEUR_MG_HARVEST.replace(/[\\/]harvest\.cjs$/, '') + '\n' +
      '  node harvest.cjs --index          (26 requetes, ~90 s)\n' +
      'ou pointe MG_OUT vers un mg_matricules.csv existant.');
  }
  const texte = fs.readFileSync(chemin, 'utf8');
  const parMatricule = new Map();
  let lignes = 0;
  let entete = true;

  for (const l of lignesDuCsv(texte)) {
    if (entete) { entete = false; continue; }
    const mg = Number(l[0]);
    if (!mg) continue;
    lignes++;
    if (!parMatricule.has(mg)) parMatricule.set(mg, []);
    const liste = parMatricule.get(mg);
    if (liste.length < CFG.MAX_EXEMPLES) liste.push({ identite: l[1] || '', source: l[2] || '' });
    else liste.enPlus = (liste.enPlus || 0) + 1;
  }
  return { parMatricule, distincts: parMatricule.size, lignes };
}

/** Age de l'index en jours, Infinity s'il n'existe pas ou n'est pas date. */
function ageIndexMgJours() {
  if (!fs.existsSync(CFG.MG_ETAT)) return Infinity;
  try {
    const d = new Date(JSON.parse(fs.readFileSync(CFG.MG_ETAT, 'utf8')).date).getTime();
    return (Date.now() - d) / 86400000;
  } catch { return Infinity; }
}

/* --------------------------------------------------------------- CLI ---- */

function principal() {
  const args = process.argv.slice(2);
  const r = lireIndexMg();
  const age = ageIndexMgJours();

  console.log('source               : ' + CFG.MG_INDEX);
  console.log('age de l index       : ' + (age === Infinity ? 'inconnu' : Math.round(age) + ' j'));
  console.log('lignes               : ' + r.lignes);
  console.log('matricules distincts : ' + r.distincts);

  const nums = [...r.parMatricule.keys()];
  if (nums.length) {
    console.log('plage                : ' + Math.min(...nums) + ' a ' + Math.max(...nums));
    console.log('serie ambigue (<' + CFG.SEUIL_SERIE_AMBIGUE + ') : ' +
                nums.filter((n) => n < CFG.SEUIL_SERIE_AMBIGUE).length);
  }

  const i = args.indexOf('--tete');
  if (i !== -1) {
    const n = Number(args[i + 1] || 10);
    for (const mg of nums.sort((a, b) => a - b).slice(0, n)) {
      const e = r.parMatricule.get(mg);
      console.log('  ' + String(mg).padStart(6) + '  ' + e.map((x) => x.identite).join(' | '));
    }
  }
}

module.exports = { lireIndexMg, ageIndexMgJours, lignesDuCsv, ligneCsv, champCsv };

if (require.main === module) {
  try { principal(); }
  catch (e) { console.error('ECHEC : ' + (e && e.message ? e.message : e)); process.exit(1); }
}
