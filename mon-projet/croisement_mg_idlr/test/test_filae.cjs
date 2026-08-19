/**
 * Test bout-en-bout de la provenance Filae, hors ligne.
 *
 *   node test/test_filae.cjs
 *
 * Fabrique un actes.csv et un engages.csv de synthese, saisit des matricules
 * Filae par le meme chemin que le formulaire, puis verifie que la saisie
 * ressort dans les quatre endroits qui doivent rester d'accord : les lignes de
 * resultat, la legende, la barre d'ensemble et la frise par tranche.
 *
 * Le piege principal est le plancher de 2 px : un matricule vaut 0,01 % d'une
 * tranche, donc un segment calcule sans plancher serait invisible a l'ecran
 * tout en etant present dans le HTML. Les tests verifient la valeur CSS, pas
 * seulement la presence de la couleur.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* L'environnement doit etre pose AVANT de charger Config.js. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'filae-e2e-'));
process.env.CROIS_OUT = TMP;
process.env.IDLR_OUT = path.join(TMP, 'actes.csv');
process.env.IDLR_DB = path.join(TMP, 'inexistant.db');
process.env.MG_ENGAGES = path.join(TMP, 'engages.csv');
process.env.FILAE_CSV = path.join(TMP, 'filae.csv');

const Filae = require('../filae.cjs');
const R = require('../recherche.cjs');

let ok = 0, ko = 0;
function check(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('OK    ' + titre); }
  else { ko++; console.log('ECHEC ' + titre + '\n        attendu ' + JSON.stringify(attendu) +
                           '\n        obtenu  ' + JSON.stringify(obtenu)); }
}
function vrai(titre, cond, detail) {
  if (cond) { ok++; console.log('OK    ' + titre); }
  else { ko++; console.log('ECHEC ' + titre + (detail !== undefined ? '  -> ' + detail : '')); }
}

/* ------------------------------------------------------------ fixtures --- */

fs.writeFileSync(process.env.IDLR_OUT, [
  'matricule,nom,prenom,commune,date_iso,type_acte,obs,origine,url_demande_photo',
  '100,Petan,Jean,Saint-Denis,1887-03-02,N,,Inde,http://www.iledelareunion-archive.com/a/100',
  '200,Naiken,Marie,Saint-Paul,1890-07-14,D,,Inde,',
  '300,Govindin,Paul,Saint-Louis,1892-01-05,M,,Inde,'
].join('\n') + '\n');

fs.writeFileSync(process.env.MG_ENGAGES, [
  'matricule,identite,origine,naissance,arrivee,notes,sources,contributeur',
  '300,GOVINDIN Paul,Inde,1870,1892,,,',       // 300 : dans les deux -> bleu
  '400,SAMY Anne,Inde,1875,1893,,,'            // 400 : MG seul -> vert
].join('\n') + '\n');

/* --------------------------------------------------------------- tests --- */

(async () => {
  console.log('=== avant toute saisie Filae ===');
  let d = await R.construire();
  check('3 provenances peuplees, Filae vide',
        [d.compte.idlr, d.compte.mg, d.compte.deux, d.compte.filae], [2, 1, 1, 0]);
  vrai('la barre ne montre aucun segment rose',
       R.barreGlobale(d.couverture).indexOf('--filae') === -1);
  vrai('la frise ne montre aucun segment rose',
       R.frise(d.couverture).indexOf('--filae') === -1);

  console.log('');
  console.log('=== saisie refusee : le matricule existe deja ===');
  const connu = (n) => {
    const l = d.lignes.find((x) => x.mg === n);
    return l ? { idlr: 'les Archives', mg: 'MG', deux: 'les deux bases' }[l.provenance] : null;
  };
  const r1 = await Filae.ajouter({ matricule: '300', nom: 'Doublon' }, connu);
  vrai('un matricule des deux bases est refuse', !r1.ok, r1.message);
  vrai('le message nomme la base', /les deux bases/.test(r1.message || ''), r1.message);
  const r2 = await Filae.ajouter({ matricule: '100', nom: 'Doublon' }, connu);
  vrai('un matricule des Archives est refuse', !r2.ok && /Archives/.test(r2.message), r2.message);
  vrai('aucun fichier ecrit apres refus', !fs.existsSync(process.env.FILAE_CSV));

  console.log('');
  console.log('=== saisie acceptee ===');
  const r3 = await Filae.ajouter({
    matricule: '500', nom: 'Ramassamy', prenom: 'Marie', ville: 'Saint-Andre',
    naissance: 'vers 1889', deces: '1941', conjoint: 'Naiken Pierre',
    pere: 'Ramassamy Govindin', mere: 'Poulle Anne',
    divers1: 'engage, sucrerie', divers2: 'source familiale'
  }, connu);
  vrai('la saisie est acceptee', r3.ok, r3.message);

  R.oublier();                      // ce que fait le serveur apres un POST
  d = await R.construire();
  check('Filae compte 1', d.compte.filae, 1);
  check('les autres provenances sont inchangees',
        [d.compte.idlr, d.compte.mg, d.compte.deux], [2, 1, 1]);

  const l = d.lignes.find((x) => x.mg === 500);
  check('provenance de la ligne', l.provenance, 'filae');
  check('nom et prenom replies dans la colonne Nom', l.nom, 'Ramassamy Marie');
  check('la ville alimente la colonne Commune', l.commune, 'Saint-Andre');
  check('naissance et deces dans la colonne Date', l.date, '° vers 1889 † 1941');
  check('conjoint, parents et divers dans les Notes', l.notes,
        'conj. Naiken Pierre · père Ramassamy Govindin · mère Poulle Anne · engage, sucrerie · source familiale');
  vrai('la ligne est marquee comme saisie', l.dansFilae === true);
  vrai('pas de lien cherchemg.fr sur une ligne Filae', l.dansMg === false);

  console.log('');
  console.log('=== la saisie est cherchable ===');
  check('par le nom du conjoint', (R.chercher(d, { texte: 'naiken pierre' })).total, 1);
  check('par le nom de la mere', (R.chercher(d, { texte: 'poulle' })).total, 1);
  check('par un champ divers', (R.chercher(d, { texte: 'sucrerie' })).total, 1);
  check('par le numero', (R.chercher(d, { texte: '500' })).total, 1);
  check('le filtre provenance=filae isole la saisie',
        (R.chercher(d, { provenance: 'filae' })).total, 1);
  check('le filtre provenance=idlr ne la ramene pas',
        (R.chercher(d, { provenance: 'idlr' })).rows.some((x) => x.mg === 500), false);

  console.log('');
  console.log('=== les quatre visuels sont d accord ===');
  const v = d.couverture;
  check('la couverture compte la saisie', v.filae, 1);
  check('somme des provenances = total connu',
        v.idlr + v.mg + v.deux + v.filae, v.connus);
  const t0 = v.tranches[0];
  check('somme de la tranche = ses provenances',
        t0.idlr + t0.mg + t0.deux + t0.filae, 5);
  check('la saisie est dans la 1re tranche', t0.filae, 1);

  const barre = R.barreGlobale(v);
  const frise = R.frise(v);
  const leg = R.legende(v);
  vrai('la barre porte un segment rose', barre.indexOf('var(--filae)') !== -1);
  vrai('la frise porte un segment rose', frise.indexOf('var(--filae)') !== -1);
  vrai('la legende annonce Filae', /Filae/.test(leg));
  vrai('la legende donne le bon effectif', /Filae \(saisie\) <b>1<\/b>/.test(leg), leg);

  // Le plancher : sans lui, 1 matricule = 0,01 % = 0,01 px, donc invisible.
  vrai('le segment de barre a un plancher de 2 px',
       /width:max\(2px,[\d.]+%\);background:var\(--filae\)/.test(barre),
       (/[^>]*--filae[^>]*/.exec(barre) || [''])[0]);
  vrai('le segment de frise a un plancher de 2 px',
       /height:max\(2px,[\d.]+%\);background:var\(--filae\)/.test(frise),
       (/[^>]*--filae[^>]*/.exec(frise) || [''])[0]);
  vrai('l infobulle de la tranche annonce Filae', /Filae 1/.test(frise));
  vrai('les tranches sans saisie n ont pas de segment rose',
       (frise.match(/var\(--filae\)/g) || []).length === 1,
       (frise.match(/var\(--filae\)/g) || []).length + ' segments');

  console.log('');
  console.log('=== la page complete se rend ===');
  const html = R.page(d);
  vrai('le bouton de saisie est present', html.indexOf('fl-ouvrir') !== -1);
  vrai('le dialogue est present', html.indexOf('id=dlg') !== -1);
  for (const c of Filae.SAISIE) {
    vrai('champ « ' + c.libelle +' » dans le formulaire', html.indexOf('id="fl-' + c.cle + '"') !== -1);
  }
  vrai('la couleur rose est definie en clair ET en sombre',
       (html.match(/--filae:/g) || []).length === 3,
       (html.match(/--filae:/g) || []).length + ' definitions');
  vrai('le filtre Filae est propose', html.indexOf('<option value=filae>') !== -1);

  console.log('');
  console.log('=== un moissonnage rattrape une saisie ===');
  // 500 finit par apparaitre dans MG : la ligne doit dire MG, sans perdre
  // la trace de la saisie, et la couverture ne doit pas le compter deux fois.
  fs.appendFileSync(process.env.MG_ENGAGES, '500,RAMASSAMY Marie,Inde,1889,1910,,,\n');
  R.oublier();
  d = await R.construire();
  const l2 = d.lignes.find((x) => x.mg === 500);
  check('la provenance passe a MG', l2.provenance, 'mg');
  vrai('la trace de la saisie reste', l2.dansFilae === true);
  check('Filae ne le compte plus', d.compte.filae, 0);
  check('il est signale comme rattrape', d.absorbes, 1);
  check('la couverture ne le compte qu une fois',
        d.couverture.idlr + d.couverture.mg + d.couverture.deux + d.couverture.filae,
        d.couverture.connus);

  console.log('');
  console.log(ok + ' OK, ' + ko + ' echec(s)');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ECHEC : ' + (e && e.stack ? e.stack : e));
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
