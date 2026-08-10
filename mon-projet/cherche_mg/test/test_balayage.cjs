/**
 * Simulation bout-en-bout du balayage (Client.gs), hors ligne.
 *
 *   node test/test_balayage.cjs
 *
 * Apps Script est remplace par des faux services (Sheets, Properties, Cache,
 * UrlFetch, Triggers) et le reseau par les fixtures patro_*.html. On verifie
 * ce que le parsing seul ne dit pas : deduplication, idempotence, croissance
 * de la grille au-dela des 1000 lignes par defaut, et reprise apres coupure.
 *
 * Le faux Sheets reproduit volontairement la contrainte qui casse en vrai :
 * ecrire au-dela de getMaxRows() leve "range exceeds grid limits".
 *
 * Fixtures utilisees : toutes celles presentes parmi patro_a / patro_ou /
 * patro_sam (voir test_parser.cjs pour les regenerer). patro_sam suffit.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..') + path.sep;
const FIX = path.join(__dirname, 'fixtures') + path.sep;

/* ---------------------------------------------------------- faux Sheets --- */
class FakeSheet {
  constructor(nom) { this.nom = nom; this.cells = []; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.nom; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) {
      if (this.cells[r] && this.cells[r].some(v => v !== '' && v !== undefined && v !== null)) return r + 1;
    }
    return 0;
  }
  insertRowsAfter(apres, combien) { this.maxRows += combien; }
  setFrozenRows() { return this; }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (r + nr - 1 > sh.maxRows) {
      throw new Error(`range exceeds grid limits (ligne ${r + nr - 1} > ${sh.maxRows}) sur ${sh.nom}`);
    }
    if (c + nc - 1 > sh.maxCols) throw new Error('range exceeds grid limits (colonnes)');
    return {
      setValues(vals) {
        if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues: dimensions incoherentes');
        for (let i = 0; i < nr; i++) {
          const ligne = r - 1 + i;
          if (!sh.cells[ligne]) sh.cells[ligne] = [];
          for (let j = 0; j < nc; j++) sh.cells[ligne][c - 1 + j] = vals[i][j];
        }
        return this;
      },
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const ligne = sh.cells[r - 1 + i] || [];
          const row = [];
          for (let j = 0; j < nc; j++) { const v = ligne[c - 1 + j]; row.push(v === undefined ? '' : v); }
          out.push(row);
        }
        return out;
      },
      setFontWeight() { return this; }
    };
  }
}
class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getId() { return 'FAKE_ID'; }
  getUrl() { return 'https://docs.google.com/fake'; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new FakeSheet(n)); }
}
const classeur = new FakeSpreadsheet();

/* -------------------------------------------------------- faux services --- */
const propsStore = {};
const cacheStore = {};
let requetes = 0;
let siteEnPanne = false;   // bascule pour tester la suspension

// On ne balaye que les lettres dont la fixture est presente.
const FIXTURES = {};
for (const [lettre, f] of [['a', 'patro_a.html'], ['ou', 'patro_ou.html'], ['sam', 'patro_sam.html']]) {
  if (fs.existsSync(FIX + f)) FIXTURES[lettre] = f;
}
const LETTRES = Object.keys(FIXTURES);
if (!LETTRES.length) {
  console.error('Aucune fixture patro_*.html dans test/fixtures/ : rien a simuler.');
  process.exit(1);
}

const env = {
  console, JSON, Math, Date, String, Number, Array, Object, RegExp, isNaN, parseInt, parseFloat,
  Logger: { log: (...a) => {} },
  Utilities: { sleep() {}, formatDate: () => '10/08/2026 11:45' },
  Session: { getScriptTimeZone: () => 'Indian/Reunion' },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in propsStore ? propsStore[k] : null),
      setProperty: (k, v) => { propsStore[k] = String(v); }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: k => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; }
    })
  },
  SpreadsheetApp: {
    openById: () => classeur,
    getActive: () => classeur,
    create: () => classeur
  },
  ScriptApp: {
    newTrigger: () => ({ timeBased: () => ({ after: () => ({ create() {} }) }) }),
    getProjectTriggers: () => [],
    deleteTrigger() {}
  },
  UrlFetchApp: {
    fetch(url, params) {
      requetes++;
      if (siteEnPanne) return { getResponseCode: () => 503, getContentText: () => '' };
      const q = params && params.payload && params.payload.PatroChaine;
      const f = FIXTURES[q];
      if (!f) throw new Error('fixture absente pour "' + q + '"');
      const contenu = fs.readFileSync(FIX + f, 'utf8');
      return { getResponseCode: () => 200, getContentText: () => contenu };
    }
  }
};
const ctx = vm.createContext(env);
for (const f of ['Config.gs', 'Parser.gs', 'Client.gs', 'Api.gs', 'Stats.gs']) {
  vm.runInContext(fs.readFileSync(SRC + f, 'utf8'), ctx, { filename: f });
}

/* --------------------------------------------------------------- tests --- */
let ko = 0, ok = 0;
function check(nom, reel, attendu) {
  const bon = JSON.stringify(reel) === JSON.stringify(attendu);
  bon ? ok++ : ko++;
  console.log(`${bon ? 'OK   ' : 'ECHEC'} ${nom}` + (bon ? '' :
    `\n        attendu ${JSON.stringify(attendu)}\n        obtenu  ${JSON.stringify(reel)}`));
}

// Verite terrain calculee independamment du code teste.
const { mgParsePatro, mgNormTexte_ } = ctx;
const triplesMg = new Set(), pairesSans = new Set(), mgDistincts = new Set();
for (const q of LETTRES) {
  for (const l of mgParsePatro(fs.readFileSync(FIX + FIXTURES[q], 'utf8')).lignes) {
    const e = mgNormTexte_(l.patronyme) + '|' + mgNormTexte_(l.source);
    if (l.mg !== null) { triplesMg.add(l.mg + '~' + e); mgDistincts.add(l.mg); }
    else pairesSans.add(e);
  }
}
console.log(`verite terrain : ${triplesMg.size} triples MG, ${mgDistincts.size} MG distincts, ${pairesSans.size} identites sans numero\n`);

console.log('=== BALAYAGE sur ' + LETTRES.join(', ') + ' ===');
const etat = ctx.mgDemarrerBalayage(LETTRES);
const shMg = classeur.getSheetByName('MG_Matricules');
const shSans = classeur.getSheetByName('MG_Sans_numero');

check('une requete par lettre', requetes, LETTRES.length);
check('balayage termine', etat.enCours, false);
check('lettres faites', etat.lettresFaites, LETTRES);
check('lignes MG ecrites = triples distincts', shMg.getLastRow() - 1, triplesMg.size);
check('identites sans numero = paires distinctes', shSans.getLastRow() - 1, pairesSans.size);
check('MG distincts comptes par le code', ctx.mgNombreMatricules(), mgDistincts.size);
check('feuille agrandie au-dela des 1000 lignes par defaut', shMg.getMaxRows() > 1000, true);

console.log('\n=== IDEMPOTENCE : on rejoue le meme balayage ===');
const avant = shMg.getLastRow(), avantSans = shSans.getLastRow();
ctx.mgDemarrerBalayage(LETTRES);
check('aucune ligne MG ajoutee', shMg.getLastRow(), avant);
check('aucune ligne sans-numero ajoutee', shSans.getLastRow(), avantSans);
check('requetes doublees', requetes, LETTRES.length * 2);

console.log('\n=== CONTENU DES LIGNES ===');
const l1 = shMg.getRange(2, 1, 1, 6).getValues()[0];
check('colonne MG numerique', typeof l1[0], 'number');
check('colonne identite non vide', l1[1].length > 0, true);
check('colonne "trouve par" renseignee', LETTRES.includes(l1[4]), true);
check('colonne cle = mg + hash', /^\d+-[0-9a-z]+$/.test(l1[5]), true);

const toutesLignes = shMg.getRange(2, 1, shMg.getLastRow() - 1, 6).getValues();
check('aucune ligne trouee', toutesLignes.filter(r => r[0] === '' || r[1] === '').length, 0);
check('cles toutes distinctes', new Set(toutesLignes.map(r => r[5])).size, toutesLignes.length);
check('tous les MG dans 1..130000',
      toutesLignes.filter(r => r[0] < 1 || r[0] > 130000).length, 0);

console.log('\n=== PAGINATION DE L API ===');
const page1 = ctx.mgListeMatricules(1, 10);
check('10 lignes', page1.count, 10);
check('total coherent', page1.total, shMg.getLastRow() - 1);
check('page au-dela de la fin -> vide', ctx.mgListeMatricules(99999, 10).count, 0);
const resume = ctx.mgResume();
check('resume : MG distincts', resume.matriculesDistincts, mgDistincts.size);
check('resume : plage min/max coherente',
      resume.plage.min >= 1 && resume.plage.max <= 130000, true);

console.log('\n=== STATISTIQUES (tableau de bord) ===');
const st = ctx.mgStatistiques();
// Verite terrain recalculee ici, independamment de Stats.gs.
const parMg = new Map();
for (const q of LETTRES) {
  for (const l of mgParsePatro(fs.readFileSync(FIX + FIXTURES[q], 'utf8')).lignes) {
    if (l.mg === null) continue;
    if (!parMg.has(l.mg)) parMg.set(l.mg, new Set());
    parMg.get(l.mg).add(mgNormTexte_(l.patronyme));
  }
}
const engagesAttendus = [...parMg.values()].reduce((n, s) => n + s.size, 0);
const distribAttendue = [1, 2, 3, 4].map(k => [...parMg.values()]
  .filter(s => (k === 4 ? s.size >= 4 : s.size === k)).length);

check('MG distincts', st.matriculesDistincts, parMg.size);
check('engages distincts (couples MG x identite)', st.engagesDistincts, engagesAttendus);
check('distribution 1/2/3/4+', st.distribution.map(d => d.n), distribAttendue);
check('distribution couvre tous les MG',
      st.distribution.reduce((a, d) => a + d.n, 0), parMg.size);
check('somme des tranches = MG distincts',
      st.tranches.reduce((a, t) => a + t.n, 0), parMg.size);
check('13 tranches de 10 000', st.tranches.length, 13);
check('1re tranche = MG 1 a 10 000', [st.tranches[0].debut, st.tranches[0].fin], [1, 10000]);
check('ambigue + principale = total', st.serieAmbigue + st.seriePrincipale, parMg.size);
check('ambigue = MG < 11000', st.serieAmbigue, [...parMg.keys()].filter(m => m < 11000).length);
check('aucun releveur (phase 2 non lancee)', st.releveurs, []);

console.log('\n=== REPRISE APRES INTERRUPTION ===');
for (const k of Object.keys(propsStore)) delete propsStore[k];
classeur.sheets = {};
requetes = 0;
ctx.mgDemarrerBalayage(LETTRES);
const etatPartiel = JSON.parse(propsStore['MG_BALAYAGE']);
// on remet 'sam' dans la file comme si l'execution avait ete coupee avant
etatPartiel.enCours = true;
etatPartiel.restant = LETTRES.slice(-1);
etatPartiel.faits = LETTRES.slice(0, -1);
propsStore['MG_BALAYAGE'] = JSON.stringify(etatPartiel);
const lignesAvant = classeur.getSheetByName('MG_Matricules').getLastRow();
const r2 = ctx.mgBalayage();
check('reprise terminee', r2.enCours, false);
check('reprise n a rien duplique',
      classeur.getSheetByName('MG_Matricules').getLastRow(), lignesAvant);
check('une requete de plus (la lettre rejouee)', requetes, LETTRES.length + 1);

console.log('\n=== SITE EN PANNE : suspension puis reprise manuelle ===');
for (const k of Object.keys(propsStore)) delete propsStore[k];
classeur.sheets = {};
siteEnPanne = true;
requetes = 0;

let e = ctx.mgDemarrerBalayage(LETTRES);
check('1er echec : toujours en cours', e.enCours, true);
check('1er echec : pas encore suspendu', e.suspendu, false);
check('compteur d echecs a 1', e.echecsConsecutifs, 1);

const MAX = ctx.MG_CFG.MAX_ECHECS;
for (let i = 2; i <= MAX; i++) e = ctx.mgBalayage();
check(`suspendu apres ${MAX} echecs`, e.suspendu, true);
check('mais pas termine : la file est conservee', e.enCours, true);
check('lettres restantes intactes', e.lettresRestantes, LETTRES);
check('aucune ligne ecrite', classeur.getSheetByName('MG_Matricules').getLastRow(), 1);
check('le compteur ne repart pas a zero entre deux declencheurs',
      e.echecsConsecutifs, MAX);

siteEnPanne = false;
const eRepris = ctx.mgBalayage();
check('reprise manuelle : compteur remis a zero', eRepris.echecsConsecutifs, 0);
check('reprise manuelle : plus suspendu', eRepris.suspendu, false);
check('reprise manuelle : balayage termine', eRepris.enCours, false);
check('donnees enfin ecrites',
      classeur.getSheetByName('MG_Matricules').getLastRow() - 1, triplesMg.size);

console.log(`\n${ok} OK, ${ko} echec(s)`);
process.exit(ko === 0 ? 0 : 1);
