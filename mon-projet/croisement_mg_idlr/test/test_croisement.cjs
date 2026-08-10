/**
 * Test bout-en-bout du croisement, hors ligne.
 *
 *   node test/test_croisement.cjs
 *
 * Fabrique un index MG et un actes.csv de synthese dans un dossier temporaire,
 * lance croiser(), puis verifie les compteurs ET le contenu des trois CSV.
 * Les cas piegeux sont volontaires : serie ambigue, matricule « N°2-537 »,
 * numero hors plage, champ `obs` contenant virgule, guillemets et saut de ligne.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* L'environnement doit etre pose AVANT de charger Config.js. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'croisement-'));
process.env.CROIS_OUT = TMP;
process.env.IDLR_OUT = path.join(TMP, 'actes.csv');
process.env.IDLR_DB = path.join(TMP, 'inexistant.db');
// L'index MG est desormais une ENTREE, produite par cherche_mg/moissonneur.
process.env.MG_OUT = path.join(TMP, 'mg_matricules.csv');
process.env.MG_ETAT = path.join(TMP, 'mg_etat.json');

const { croiser } = require('../croiser.cjs');
const { lignesDuCsv } = require('../mg.cjs');

let ko = 0, ok = 0;
function check(nom, reel, attendu) {
  const bon = JSON.stringify(reel) === JSON.stringify(attendu);
  bon ? ok++ : ko++;
  console.log(`${bon ? 'OK   ' : 'ECHEC'} ${nom}` + (bon ? '' :
    `\n        attendu ${JSON.stringify(attendu)}\n        obtenu  ${JSON.stringify(reel)}`));
}
const lire = (f) => [...lignesDuCsv(fs.readFileSync(path.join(TMP, f), 'utf8'))];

/* ------------------------------------------------------------- fixtures --- */

fs.writeFileSync(path.join(TMP, 'mg_matricules.csv'),
  'matricule,identite,source,trouve_par\n' +
  '5,Ramsamy,Etat des indiens detenus,a\n' +               // + concordance oui
  '5,DJETTOU Soura,+ Saint-Denis 18/01/1887,a\n' +         // + concordance non
  '11000,Moutou,+ St Benoit 22/10/1851,o\n' +
  '50000,KICHENIN Nicolas,STDE_1939_1656,i\n' +
  '60000,HOARAU Jean,acte quelconque,o\n');                // absent d'IDLR

fs.writeFileSync(path.join(TMP, 'mg_etat.json'),
  JSON.stringify({ date: new Date().toISOString() }));

const COLS = 'matricule,type_acte,commune,date_iso,nom,prenom,sexe,conjoint_nom,' +
             'conjoint_prenom,age,origine,obs,numero,url_demande_photo';
const acte = (obs, nom, prenom, commune, date, numero) =>
  `,N,${commune},${date},${nom},${prenom},M,,,,,"${obs.replace(/"/g, '""')}",${numero},http://x/${numero}`;

fs.writeFileSync(process.env.IDLR_OUT,
  COLS + '\n' +
  acte('engage N°5', 'RAMSAMY', 'Pierre', 'Saint-Denis', '1887-01-18', 'P1') + '\n' +
  acte('N°11000 et suite', 'MOUTOU', 'Jean', 'Saint-Benoit', '1851-10-22', 'P2') + '\n' +
  acte('MG N°50000', 'PAYET', 'Louis', 'Saint-Paul', '1900-05-05', 'P3') + '\n' +
  acte('n° 70000', 'GRONDIN', 'Marie', 'Le Tampon', '1902-03-01', 'P4') + '\n' +
  // meme matricule 70000, et un obs qui contient virgule, guillemets, saut de ligne
  acte('voir N°70000, dit "le jeune",\nfils de', 'GRONDIN', 'Paul', 'Le Tampon', '1903-04-02', 'P5') + '\n' +
  acte('livret N°2-537', 'TAZANA', '', 'Saint-Louis', '1855-08-06', 'P6') + '\n' +
  acte('matricule communal N°999999', 'INCONNU', '', 'Cilaos', '1880-01-01', 'P7') + '\n' +
  acte('sans numero ici', 'SANSMAT', '', 'Salazie', '1890-01-01', 'P8') + '\n');

/* --------------------------------------------------------------- tests --- */

croiser().then((r) => {
  console.log('=== LECTURE DES SOURCES ===');
  check('actes IDLR lus', r.sources.idlr.actes, 8);
  // 7 et non 6 : le compteur inclut le n° hors plage, rapporte a part ci-dessous.
  check('actes portant un n°', r.sources.idlr.actesAvecMatricule, 7);
  check('matricules IDLR dans la plage', r.sources.idlr.matriculesDistincts, 5);   // 5,11000,50000,70000,2537
  check('actes hors plage ecartes', r.sources.idlr.horsPlage, 1);                  // 999999
  check('matricules MG', r.sources.mg.matriculesDistincts, 4);
  check('lignes MG', r.sources.mg.lignes, 5);

  console.log('\n=== LES DEUX SENS ===');
  check('communs', r.communs, 3);                       // 5, 11000, 50000
  check('dans IDLR, absents de MG', r.idlrAbsentsDeMg, 2);   // 70000, 2537
  check('dans MG, absents d IDLR', r.mgAbsentsDIdlr, 1);     // 60000
  check('recouvrement IDLR -> MG', r.recouvrement.idlr_vers_mg, 60);
  check('recouvrement MG -> IDLR', r.recouvrement.mg_vers_idlr, 75);
  check('actes IDLR couverts', r.actesIdlrCouverts, 3);
  check('actes IDLR orphelins', r.actesIdlrOrphelins, 3);    // 2 x 70000 + 1 x 2537

  console.log('\n=== idlr_absents_de_mg.csv ===');
  const abs = lire('idlr_absents_de_mg.csv');
  check('entete', abs[0][0], 'matricule');
  const mats = abs.slice(1).map((l) => Number(l[0]));
  check('matricules listes, tries', [...new Set(mats)], [2537, 70000]);
  check('« N°2-537 » lu comme 2537', mats.includes(2537), true);
  const l70 = abs.slice(1).filter((l) => l[0] === '70000');
  check('70000 : 2 exemples d actes', l70.length, 2);
  check('70000 : nb_actes correct', l70[0][1], '2');
  check('champ avec virgule/guillemet/saut de ligne relu intact',
        abs.slice(1).some((l) => l[3] === 'Paul'), true);

  console.log('\n=== mg_absents_didlr.csv ===');
  const absI = lire('mg_absents_didlr.csv');
  check('une seule ligne', absI.length - 1, 1);
  check('c est bien 60000', absI[1][0], '60000');
  check('identite conservee', absI[1][3], 'HOARAU Jean');
  check('serie non ambigue', absI[1][1], 'non');

  console.log('\n=== communs.csv ===');
  const com = lire('communs.csv').slice(1);
  check('4 lignes (MG 5 porte 2 identites)', com.length, 4);
  const parMat = (m) => com.filter((l) => l[0] === String(m));
  check('MG 5 marque serie ambigue', parMat(5)[0][1], 'oui');
  check('MG 11000 non ambigu', parMat(11000)[0][1], 'non');
  check('Ramsamy vs RAMSAMY -> oui', parMat(5).find((l) => l[4] === 'Ramsamy')[9], 'oui');
  check('DJETTOU vs RAMSAMY -> non', parMat(5).find((l) => l[4] === 'DJETTOU Soura')[9], 'non');
  check('Moutou vs MOUTOU -> oui', parMat(11000)[0][9], 'oui');
  check('KICHENIN vs PAYET -> non', parMat(50000)[0][9], 'non');
  check('taux de discordance', r.concordanceNoms.taux_discordance, 50);
  check('communs en serie ambigue', r.serieAmbigue.communs, 1);

  console.log('\n=== resume et historique ===');
  check('diagnostic « recouvrement élevé »',
        /Recouvrement élevé/.test(r.diagnostic), true);
  const hist = JSON.parse(fs.readFileSync(path.join(TMP, 'historique.json'), 'utf8'));
  check('une entree d historique', hist.length, 1);
  check('historique coherent', hist[0].communs, 3);

  return croiser();                     // deuxieme passage : idempotent + historique
}).then((r2) => {
  const hist = JSON.parse(fs.readFileSync(path.join(TMP, 'historique.json'), 'utf8'));
  check('2e execution : historique cumule', hist.length, 2);
  check('2e execution : memes compteurs', r2.communs, 3);

  console.log(`\n${ok} OK, ${ko} echec(s)`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ko === 0 ? 0 : 1);
}).catch((e) => {
  console.error('ECHEC : ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
