/**
 * Tests de l'import et de la recherche d'engagés, hors ligne.
 *
 *   node test/test_engages.cjs
 *
 * Apps Script est remplacé par de faux services, et la feuille MG_Engages est
 * chargée avec le VRAI fichier engages.csv (27 096 lignes) s'il est présent —
 * sinon avec un extrait de synthèse, pour que le test tourne partout.
 *
 * On vérifie ce qui casse en vrai : reconnaissance des colonnes par leur nom,
 * recherche insensible aux accents, combinaison des filtres, pagination, et
 * lecture d'un CSV dont un champ contient une virgule entre guillemets.
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CSV = path.join(RACINE, 'engages.csv');

/* --------------------------------------------------------- faux Sheets --- */
class FakeSheet {
  constructor(nom) { this.nom = nom; this.cells = []; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.nom; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(a, c) { this.maxRows += c; }
  insertColumnsAfter(a, c) { this.maxCols += c; }
  setFrozenRows() { return this; }
  clear() { this.cells = []; return this; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--)
      if (this.cells[r] && this.cells[r].some(v => v !== '' && v != null)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let n = 0;
    for (const l of this.cells) if (l) n = Math.max(n, l.length);
    return n;
  }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (r + nr - 1 > sh.maxRows) throw new Error('range exceeds grid limits');
    if (c + nc - 1 > sh.maxCols) throw new Error('range exceeds grid limits (colonnes)');
    const api = {
      setValues(v) {
        for (let i = 0; i < nr; i++) {
          const L = r - 1 + i; if (!sh.cells[L]) sh.cells[L] = [];
          for (let j = 0; j < nc; j++) sh.cells[L][c - 1 + j] = v[i][j];
        } return api;
      },
      getValues() {
        const o = [];
        for (let i = 0; i < nr; i++) {
          const L = sh.cells[r - 1 + i] || [], row = [];
          for (let j = 0; j < nc; j++) { const v = L[c - 1 + j]; row.push(v === undefined ? '' : v); }
          o.push(row);
        } return o;
      },
      getDisplayValues() { return api.getValues().map(l => l.map(v => String(v == null ? '' : v))); },
      setFontWeight() { return api; },
      setNumberFormat() { return api; }
    };
    return api;
  }
}
class FakeSS {
  constructor() { this.sheets = {}; this.actif = null; }
  getId() { return 'ID'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/EXEMPLE'; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new FakeSheet(n)); }
  setActiveSheet(s) { this.actif = s; return s; }
}

/* --------------------------------------------------- parseur CSV local --- */
function* rows(t) {
  let f = '', r = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { r.push(f); f = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      r.push(f); f = '';
      if (r.length > 1 || r[0] !== '') yield r;
      r = []; continue;
    }
    f += c;
  }
  if (f !== '' || r.length) { r.push(f); yield r; }
}

/* ------------------------------------------------------- environnement --- */
/** Faux HtmlOutput : retient le fichier demandé et le titre posé. */
function sortieHtml(nom) {
  const o = {
    nom, titre: null,
    setTitle(t) { o.titre = t; return o; },
    addMetaTag() { return o; },
    setWidth() { return o; },
    setHeight() { return o; }
  };
  return o;
}

// SpreadsheetApp SANS getUi : c'est exactement un script autonome, le cas qui
// levait « Cannot call SpreadsheetApp.getUi() from this context ».
const classeur = new FakeSS();
const props = {};
const env = {
  console, JSON, Math, Date, String, Number, Array, Object, RegExp, isNaN, parseInt, parseFloat,
  Logger: { log() {} },
  Utilities: {
    sleep() {},
    formatDate: () => '14/08/2026 10:00',
    parseCsv: (t) => [...rows(t)]
  },
  Session: { getScriptTimeZone: () => 'Indian/Reunion' },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); }
    })
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  SpreadsheetApp: { openById: () => classeur, getActive: () => classeur, create: () => classeur },
  ScriptApp: { newTrigger: () => ({ timeBased: () => ({ after: () => ({ create() {} }) }) }),
               getProjectTriggers: () => [], deleteTrigger() {} },
  UrlFetchApp: { fetch() { throw new Error('aucun appel reseau attendu'); } },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (t) => ({ type: 'text', contenu: t, setMimeType() { return this; } })
  },
  HtmlService: {
    createTemplateFromFile: (nom) => ({ donnees: null, evaluate: () => sortieHtml(nom) }),
    createHtmlOutputFromFile: (nom) => sortieHtml(nom)
  },
  DriveApp: {
    getFileById() { throw new Error('pas un id'); },
    getFilesByName(nom) {
      const chemin = path.join(RACINE, nom);
      let reste = fs.existsSync(chemin);
      return {
        hasNext: () => reste,
        next: () => {
          reste = false;
          return {
            getName: () => nom,
            getBlob: () => ({ getDataAsString: () => fs.readFileSync(chemin, 'utf8') })
          };
        }
      };
    }
  }
};
const ctx = vm.createContext(env);
for (const f of ['Config.gs', 'Parser.gs', 'Client.gs', 'Api.gs', 'Stats.gs', 'Engages.gs']) {
  vm.runInContext(fs.readFileSync(path.join(RACINE, f), 'utf8'), ctx, { filename: f });
}

/* --------------------------------------------------------------- tests --- */
let ko = 0, ok = 0;
function check(nom, reel, attendu) {
  const bon = JSON.stringify(reel) === JSON.stringify(attendu);
  bon ? ok++ : ko++;
  console.log(`${bon ? 'OK   ' : 'ECHEC'} ${nom}` + (bon ? '' :
    `\n        attendu ${JSON.stringify(attendu)}\n        obtenu  ${JSON.stringify(reel)}`));
}

const vrai = fs.existsSync(CSV);
console.log(vrai
  ? '=== IMPORT du vrai engages.csv ==='
  : '=== IMPORT (engages.csv absent : extrait de synthese) ===');

if (!vrai) {
  // Extrait fidèle au format réel, y compris un champ contenant une virgule.
  fs.writeFileSync(path.join(RACINE, '__test_engages.csv'),
    'matricule,identite,origine,naissance,arrivee,convoi,immatriculation,notes,sources,contributeur\n' +
    '1,Tazana,Inde,,1838-08-31,,1838-08-31,5 ans de prison,Etat des indiens - IMG_9931.JPG,Claude Rossignol\n' +
    '2,MANDOVA,Afrique,1837-00-00,,,,"Epx N°2 R - S, épse N°66121",x Saint-Denis 08/12/1888,Xavier Lecoq\n' +
    '11000,Moutou,Inde,1821-00-00,,,,P : Pétan,+ St Benoît 22/10/1851,Christian Fontaine\n' +
    '20000,SINIVASSIN Moutoukichenin,Inde,1823-00-00,,,,,+ Saint-Denis 26/06/1876,Xavier Lecoq\n');
}
const nomCsv = vrai ? 'engages.csv' : '__test_engages.csv';

const cr = ctx.mgImporterEngages(nomCsv);
check('import : feuille creee', cr.feuille, 'MG_Engages');
check('import : 10 colonnes reconnues', cr.colonnes.length, 10);
check('import : premiere colonne', cr.colonnes[0], 'matricule');
if (vrai) check('import : 27 096 lignes', cr.lignes, 27096);

console.log('\n=== AMORCAGE ===');
const A = ctx.mgAmorcerRecherche();
check('lignes lues', A.lignes, cr.lignes);
check('colonnes affichables', A.colonnes.length, 10);
check('ordre : MG en premier', A.colonnes[0].titre, 'MG');
check('matricule typé nombre', A.colonnes[0].type, 'nombre');
check('url de fiche', A.urlFiche, 'https://cherchemg.fr/mg.php?MgChaine=');
check('listes non vides', A.origines.length > 0 && A.contributeurs.length > 0, true);
if (vrai) {
  check('matricules distincts', A.matriculesDistincts, 19545);
  check('plage', [A.plage.min, A.plage.max], [1, 126033]);
  check('origine la plus frequente', A.origines[0].valeur, 'Inde');
  check('21 contributeurs', A.contributeurs.length, 21);
}

console.log('\n=== RECHERCHE TEXTE ===');
const r1 = ctx.mgRechercherEngages({ texte: 'tazana' });
check('« tazana » trouve la MG 1', r1.lignes[0][0], '1');
check('un seul champ suffit', r1.total >= 1, true);

// Le point qui compte : les données sont pleines d'accents (Pétan, géôle,
// Saint-Benoît) et personne ne les tape.
const sansAccent = ctx.mgRechercherEngages({ texte: 'petan' });
const avecAccent = ctx.mgRechercherEngages({ texte: 'Pétan' });
check('recherche sans accent = avec accent', sansAccent.total, avecAccent.total);
check('« petan » trouve quelque chose', sansAccent.total >= 1, true);
check('casse ignoree',
      ctx.mgRechercherEngages({ texte: 'MOUTOU' }).total,
      ctx.mgRechercherEngages({ texte: 'moutou' }).total);

const deuxMots = ctx.mgRechercherEngages({ texte: 'moutou inde' });
const unMot = ctx.mgRechercherEngages({ texte: 'moutou' });
check('deux mots = ET (moins de resultats)', deuxMots.total <= unMot.total, true);

console.log('\n=== FILTRES ===');
const parMat = ctx.mgRechercherEngages({ matriculeMin: 1, matriculeMax: 2 });
check('plage de matricules respectee',
      parMat.lignes.every((l) => Number(l[0]) >= 1 && Number(l[0]) <= 2), true);
check('tri par matricule croissant',
      parMat.lignes.map((l) => Number(l[0])).every((v, i, a) => i === 0 || a[i - 1] <= v), true);

const inde = ctx.mgRechercherEngages({ origine: 'Inde' });
check('origine = prefixe (attrape « Inde | Calcutta »)',
      inde.lignes.every((l) => /^inde/i.test(l[2])), true);
if (vrai) check('« Inde » ratisse plus large que la valeur exacte', inde.total > 8881, true);

const contrib = ctx.mgRechercherEngages({ contributeur: 'Xavier Lecoq' });
check('contributeur = valeur exacte',
      contrib.lignes.every((l) => l[9] === 'Xavier Lecoq'), true);

const annees = ctx.mgRechercherEngages({ anneeMin: 1838, anneeMax: 1838 });
check('filtre par annee', annees.total >= 1, true);

const combine = ctx.mgRechercherEngages({ texte: 'moutou', origine: 'Inde' });
check('filtres combines (ET)', combine.total <= unMot.total, true);

console.log('\n=== PAGINATION ===');
const p1 = ctx.mgRechercherEngages({ taille: 10, page: 1 });
check('taille de page respectee', p1.lignes.length <= 10, true);
if (p1.pages > 1) {
  const p2 = ctx.mgRechercherEngages({ taille: 10, page: 2 });
  check('page 2 differente de la page 1', p2.lignes[0][0] !== p1.lignes[0][0], true);
  check('meme total sur les deux pages', p2.total, p1.total);
}
const horsBornes = ctx.mgRechercherEngages({ taille: 10, page: 99999 });
check('page au-dela de la fin : ramenee a la derniere', horsBornes.page, horsBornes.pages);
check('plafond de page applique', ctx.mgRechercherEngages({ taille: 5000 }).taille, 100);

console.log('\n=== CHAMP CONTENANT UNE VIRGULE ===');
const virgule = ctx.mgRechercherEngages({ matriculeMin: 2, matriculeMax: 2 });
const mandova = virgule.lignes.find((l) => /MANDOVA/i.test(l[1]));
if (mandova) {
  check('les notes n ont pas ete coupees sur la virgule',
        /epse|épse/i.test(mandova[7]), true);
  check('la colonne suivante est intacte', /Saint-Denis/.test(mandova[8]), true);
} else {
  console.log('SAUTE  MG 2 / MANDOVA absent du jeu de donnees');
}

console.log('\n=== EXPORT VERS UNE FEUILLE ===');
const exp = ctx.mgExporterRecherche({ matriculeMin: 1, matriculeMax: 3 });
const shExp = classeur.getSheetByName('MG_Recherche');
check('feuille MG_Recherche creee', !!shExp, true);
check('toutes les lignes ecrites, sans pagination', shExp.getLastRow() - 1, exp.lignes);
check('export = total de la recherche', exp.lignes, exp.total);
check('entete pose', shExp.getRange(1, 1, 1, 1).getValues()[0][0], 'MG');

console.log('\n=== SANS FEUILLE ===');
delete classeur.sheets['MG_Engages'];
let messageClair = false;
try { ctx.mgAmorcerRecherche(); }
catch (e) { messageClair = /MG_Engages/.test(e.message) && /Importe/.test(e.message); }
check('message d erreur qui dit quoi faire', messageClair, true);

console.log('\n=== SCRIPT AUTONOME (pas de SpreadsheetApp.getUi) ===');
// Le classeur est recréé : les tests précédents ont supprimé MG_Engages.
ctx.mgImporterEngages(nomCsv);

check('mgUi_ renvoie null au lieu de lever', ctx.mgUi_(), null);
check('installer le menu ne casse rien', ctx.mgInstallerMenu_(), undefined);

function messageDe(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}
const msgRech = messageDe(ctx.mgOuvrirRecherche);
const msgTab = messageDe(ctx.mgAfficherTableauDeBord);
check('recherche : message explicite, pas l erreur Google',
      /pas lie a un classeur/.test(msgRech || ''), true);
check('recherche : indique la route web', /action=recherche/.test(msgRech || ''), true);
check('tableau : indique la route web', /action=tableau/.test(msgTab || ''), true);
check('le message donne l URL du classeur',
      /docs\.google\.com/.test(msgRech || ''), true);

console.log('\n=== LES DEUX ECRANS SERVIS EN APPLICATION WEB ===');
const pageRech = ctx.mgDoGet({ parameter: { action: 'recherche' } });
check('sert le fichier Recherche', pageRech.nom, 'Recherche');
check('titre pose', /recherche/i.test(pageRech.titre || ''), true);

const pageTab = ctx.mgDoGet({ parameter: { action: 'tableau' } });
check('sert le fichier Vue', pageTab.nom, 'Vue');
check('titre pose', /chiffres/i.test(pageTab.titre || ''), true);

if (!vrai) fs.rmSync(path.join(RACINE, '__test_engages.csv'), { force: true });
console.log(`\n${ok} OK, ${ko} echec(s)`);
process.exit(ko === 0 ? 0 : 1);
