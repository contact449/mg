/**
 * Tests hors ligne du parsing cherchemg.fr.
 *
 *   node test/test_parser.cjs
 *
 * Charge Config.gs + Parser.gs dans un contexte vm (ce sont du JS simple, sans
 * dependance Apps Script) et les confronte a des pages reelles enregistrees
 * dans test/fixtures/. Aucun appel reseau : ces tests tournent hors ligne et
 * servent de garde-fou si le site change sa mise en page.
 *
 * Pour regenerer / ajouter une fixture :
 *   curl -s "https://cherchemg.fr/mg.php?MgChaine=5" -o test/fixtures/mg_5.html
 *   curl -s -X POST -d "PatroChaine=sam" "https://cherchemg.fr/patro.php" \
 *        -o test/fixtures/patro_sam.html
 *
 * La fixture "patro_a" (6,5 Mo, PatroChaine=a) n'est pas versionnee : le test
 * qui l'utilise est saute si le fichier est absent. Pour l'activer :
 *   curl -s -X POST -d "PatroChaine=a" "https://cherchemg.fr/patro.php" \
 *        -o test/fixtures/patro_a.html
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');

const ctx = vm.createContext({ console, Logger: { log: console.log } });
for (const f of ['Config.gs', 'Parser.gs']) {
  vm.runInContext(fs.readFileSync(path.join(RACINE, f), 'utf8'), ctx, { filename: f });
}
const { mgParseFiche, mgParsePatro, mgNormTexte_, mgNormaliserNumero, mgHash_ } = ctx;

let ko = 0, ok = 0, sautes = 0;
function check(nom, reel, attendu) {
  const bon = JSON.stringify(reel) === JSON.stringify(attendu);
  bon ? ok++ : ko++;
  console.log(`${bon ? 'OK   ' : 'ECHEC'} ${nom}` + (bon ? '' :
    `\n        attendu ${JSON.stringify(attendu)}\n        obtenu  ${JSON.stringify(reel)}`));
}
const lire = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const existe = (f) => fs.existsSync(path.join(FIX, f));

/* ------------------------------------------------ 1. fiche : plusieurs engages */
console.log('\n=== FICHE MG=5 : 3 engages sans rapport (series ayant coexiste) ===');
const f5 = mgParseFiche(lire('mg_5.html'), 5);
check('statut', f5.statut, 'trouve');
check('mg', f5.mg, 5);
check('nb_engages', f5.nb_engages, 3);
check('serie_ambigue (< 11000)', f5.serie_ambigue, true);
check('engage[0].identite', f5.engages[0].identite, 'Ramsamy');
check('engage[0].origine', f5.engages[0].origine, 'Inde');
check('engage[0].arrivee', f5.engages[0].arrivee, '1839-12-22');
check('engage[0].annee_arrivee', f5.engages[0].annee_arrivee, 1839);
check('engage[0].naissance absente -> vide', f5.engages[0].naissance, '');
check('engage[0].contributeur', f5.engages[0].contributeur, 'Claude Rossignol');
check('engage[0].releveur', f5.engages[0].releveur, 'Laurent Coutaye');
check('engage[1].identite', f5.engages[1].identite, 'DJETTOU Soura');
check('engage[1].naissance annee seule conservee', f5.engages[1].naissance, '1844-00-00');
check('engage[1].annee_naissance', f5.engages[1].annee_naissance, 1844);
check('engage[2].identite', f5.engages[2].identite, 'AMADI dit Julien');
check('engage[2].origine', f5.engages[2].origine, 'Afrique');
check('engage[2].arrivee 0000-00-00 -> vide', f5.engages[2].arrivee, '');
check('aucun warning', f5.warnings, []);

/* ------------------------------------------- 2. fiche : trouvee + indice date */
console.log('\n=== FICHE MG=1 : trouvee, periode peu documentee ===');
const f1 = mgParseFiche(lire('mg_1.html'), 1);
check('statut', f1.statut, 'trouve');
check('mg', f1.mg, 1);
check('identite', f1.engages[0].identite, 'Tazana');
check('notes', f1.engages[0].notes, '5 ans de prison');
check('periode_peu_documentee', f1.periode_peu_documentee, { sens: 'avant', date: '1844-01-28' });
check('pas de table convois', f1.convois.length, 0);
check('aucun warning', f1.warnings, []);

/* --------------------------------------------------- 3. fiche : numero absent */
console.log('\n=== FICHE MG=123999 : numero absent de la base ===');
const fAbs = mgParseFiche(lire('mg_123999_absent.html'), 123999);
check('statut', fAbs.statut, 'absent');
check('trouve', fAbs.trouve, false);
check('numero relu dans le HTML', fAbs.mg, 123999);
check('0 engage', fAbs.nb_engages, 0);
check('indice', fAbs.periode_peu_documentee, { sens: 'apres', date: '1911-06-06' });

/* --------------------------------------------------- 4. index par identite */
console.log('\n=== PATRO "sam" ===');
const p = mgParsePatro(lire('patro_sam.html'));
// 3574 et non 3571 : trois lignes sont coupees par un retour a la ligne, un
// regex sans [\s\S] les raterait. C'est exactement le piege que ce test garde.
check('total lignes de donnees', p.total, 3574);
check('avec numero de MG', p.avecMg, 2491);
check('sans numero de MG', p.sansMg, 1083);
check('aucun warning', p.warnings, []);
check('ligne[0].patronyme', p.lignes[0].patronyme, '#eyen Ramsamy');
check('ligne[0].mg', p.lignes[0].mg, 75544);
check('ligne[0].source sans URL', p.lignes[0].sourceUrl, '');
const avecLien = p.lignes.find(l => l.sourceUrl);
check('source bibliographique -> URL extraite',
      avecLien.sourceUrl.startsWith('http://cherchemg.fr/bibliocard.php'), true);
check('cette ligne n a pas de MG', avecLien.mg, null);
check('MG distincts', new Set(p.lignes.filter(l => l.mg).map(l => l.mg)).size, 2041);

/* ------------------------------- 5. gros volume (fixture non versionnee) */
console.log('\n=== PATRO "a" : 6,5 Mo (saute si la fixture est absente) ===');
if (existe('patro_a.html')) {
  const t0 = Date.now();
  const pa = mgParsePatro(lire('patro_a.html'));
  const ms = Date.now() - t0;
  check('total', pa.total, 34315);
  check('avec numero de MG', pa.avecMg, 25039);
  check('MG distincts', new Set(pa.lignes.filter(l => l.mg).map(l => l.mg)).size, 18145);
  check('aucun warning', pa.warnings, []);
  check('aucun MG hors bornes 1..130000',
        pa.lignes.filter(l => l.mg !== null && (l.mg < 1 || l.mg > 130000)).length, 0);
  check('aucun patronyme vide', pa.lignes.filter(l => !l.patronyme).length, 0);
  console.log(`        (parse en ${ms} ms)`);
} else {
  sautes++;
  console.log('SAUTE  fixture patro_a.html absente (voir l en-tete de ce fichier)');
}

/* ------------------------------------------------------------ 6. cas limites */
console.log('\n=== CAS LIMITES ===');
check('page vide (MG=0)', mgParseFiche('<html><body>rien</body></html>', 0).statut, 'vide');
check('patro sans table', mgParsePatro('<html></html>').warnings, ['TABLE_ABSENTE']);
check('numero 0 refuse', mgNormaliserNumero(0), null);
check('numero 130001 refuse', mgNormaliserNumero(130001), null);
check('numero "11000" accepte', mgNormaliserNumero('11000'), 11000);
check('numero " 42 " accepte', mgNormaliserNumero(' 42 '), 42);
check('numero "12a" refuse', mgNormaliserNumero('12a'), null);
check('apostrophe typo + accents normalises',
      mgNormTexte_('Nombre d’engagés'), "nombre d'engages");

/* ------------------------------------ 7. cle de deduplication du balayage */
console.log('\n=== CLE DE DEDUPLICATION (collisions) ===');
const paires = new Set();
for (const l of p.lignes) paires.add(mgNormTexte_(l.patronyme) + '|' + mgNormTexte_(l.source));
const hashs = new Set([...paires].map(mgHash_));
check('un hash distinct par paire distincte', hashs.size, paires.size);
check('hash stable entre deux appels', mgHash_('KICHENIN|St-Andre'), mgHash_('KICHENIN|St-Andre'));
check('hash sensible a un caractere', mgHash_('abc') === mgHash_('abd'), false);

console.log(`\n${ok} OK, ${ko} echec(s), ${sautes} saute(s)`);
process.exit(ko === 0 ? 0 : 1);
