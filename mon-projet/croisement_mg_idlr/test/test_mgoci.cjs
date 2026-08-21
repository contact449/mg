/**
 * Test bout-en-bout de la provenance mg oci, hors ligne.
 *
 *   node test/test_mgoci.cjs
 *
 * Fabrique un actes.csv et un engages.csv de synthese, saisit des matricules
 * mg oci par le meme chemin que le formulaire, puis verifie que la saisie
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mgoci-e2e-'));
process.env.CROIS_OUT = TMP;
process.env.IDLR_OUT = path.join(TMP, 'actes.csv');
process.env.IDLR_DB = path.join(TMP, 'inexistant.db');
process.env.MG_ENGAGES = path.join(TMP, 'engages.csv');
process.env.MGOCI_CSV = path.join(TMP, 'mgoci.csv');

const MgOci = require('../mgoci.cjs');
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

// Entete SANS les colonnes parents : c'est l'etat d'actes.csv tant qu'un
// moissonnage n'a pas eu lieu depuis leur ajout au moissonneur. La lecture
// doit le supporter sans rien casser.
fs.writeFileSync(process.env.IDLR_OUT, [
  'matricule,nom,prenom,commune,date_iso,type_acte,obs,origine,conjoint_nom,conjoint_prenom,url_demande_photo',
  '100,Petan,Jean,Saint-Denis,1887-03-02,N,,Inde,,,http://www.iledelareunion-archive.com/a/100',
  '200,Naiken,Marie,Saint-Paul,1890-07-14,D,,Inde,,,',
  '300,Govindin,Paul,Saint-Louis,1892-01-05,M,,Inde,Sinnama,Marie Rose,'
].join('\n') + '\n');

fs.writeFileSync(process.env.MG_ENGAGES, [
  'matricule,identite,origine,naissance,arrivee,notes,sources,contributeur',
  '300,GOVINDIN Paul,Inde,1870,1892,,,',       // 300 : dans les deux -> bleu
  '400,SAMY Anne,Inde,1875,1893,,,'            // 400 : MG seul -> vert
].join('\n') + '\n');

/* --------------------------------------------------------------- tests --- */

(async () => {
  console.log('=== avant toute saisie mg oci ===');
  let d = await R.construire();
  check('3 provenances peuplees, mg oci vide',
        [d.compte.idlr, d.compte.mg, d.compte.deux, d.compte.mgoci], [2, 1, 1, 0]);
  // MG ne donne aucun type d'acte : sa colonne reste vide, et c'est vrai.
  check('le type d acte des Archives, en toutes lettres',
        [100, 200, 300, 400].map((n) => d.lignes.find((x) => x.mg === n).type),
        ['Naissance', 'Décès', 'Mariage', '']);
  vrai('la barre ne montre aucun segment rose',
       R.barreGlobale(d.couverture).indexOf('--mgoci') === -1);
  vrai('la frise ne montre aucun segment rose',
       R.frise(d.couverture).indexOf('--mgoci') === -1);

  console.log('');
  console.log('=== entourage releve dans un acte des Archives ===');
  const m = d.lignes.find((x) => x.mg === 300);
  check('le conjoint de l acte est affiche', m.conjoint, 'Sinnama Marie Rose');
  check('le conjoint est cherchable', (R.chercher(d, { texte: 'sinnama' })).total, 1);
  check('un acte sans conjoint laisse la colonne vide',
        d.lignes.find((x) => x.mg === 100).conjoint, '');
  vrai('les colonnes parents absentes ne cassent rien',
       d.lignes.every((x) => typeof x.pere === 'string' && typeof x.mere === 'string'));

  console.log('');
  console.log('=== saisie refusee : le matricule existe deja ===');
  const connu = (n) => {
    const l = d.lignes.find((x) => x.mg === n);
    return l ? { idlr: 'les Archives', mg: 'MG', deux: 'les deux bases' }[l.provenance] : null;
  };
  const r1 = await MgOci.ajouter({ matricule: '300', nom: 'Doublon' }, connu);
  vrai('un matricule des deux bases est refuse', !r1.ok, r1.message);
  vrai('le message nomme la base', /les deux bases/.test(r1.message || ''), r1.message);
  const r2 = await MgOci.ajouter({ matricule: '100', nom: 'Doublon' }, connu);
  vrai('un matricule des Archives est refuse', !r2.ok && /Archives/.test(r2.message), r2.message);
  vrai('aucun fichier ecrit apres refus', !fs.existsSync(process.env.MGOCI_CSV));

  console.log('');
  console.log('=== saisie acceptee ===');
  const r3 = await MgOci.ajouter({
    matricule: '500', nom: 'Ramassamy', prenom: 'Marie', ville: 'Saint-Andre',
    age: '32', type_acte: 'R',
    naissance: 'vers 1889', lieu_naissance: 'Saint-Benoit', deces: '1941',
    conjoint: 'Naiken Pierre', pere: 'Ramassamy Govindin', mere: 'Poulle Anne',
    remarque: 'engage, sucrerie', divers2: 'source familiale'
  }, connu);
  vrai('la saisie est acceptee', r3.ok, r3.message);

  R.oublier();                      // ce que fait le serveur apres un POST
  d = await R.construire();
  check('mg oci compte 1', d.compte.mgoci, 1);
  check('les autres provenances sont inchangees',
        [d.compte.idlr, d.compte.mg, d.compte.deux], [2, 1, 1]);

  const l = d.lignes.find((x) => x.mg === 500);
  check('provenance de la ligne', l.provenance, 'mgoci');
  check('nom et prenom replies dans la colonne Nom', l.nom, 'Ramassamy Marie');
  check('la ville alimente la colonne Commune', l.commune, 'Saint-Andre');
  check('naissance et deces dans la colonne Date', l.date, '° vers 1889 † 1941');
  check('le conjoint saisi a sa colonne', l.conjoint, 'Naiken Pierre');
  check('le père saisi a sa colonne', l.pere, 'Ramassamy Govindin');
  check('la mère saisie a sa colonne', l.mere, 'Poulle Anne');
  check('le reste de la fiche est replie dans les Notes', l.notes,
        'né(e) à Saint-Benoit · âge : 32 · engage, sucrerie · source familiale');
  // R et L n'existent pas cote Archives : le site les range sous les
  // naissances, et c'est ce que la saisie sert justement a distinguer.
  check('le type saisi a sa colonne, en toutes lettres', l.type, 'Reconnaissance');
  vrai('le type n est plus repete dans les notes', l.notes.indexOf('econnaissance') === -1);
  vrai('la ligne est marquee comme saisie', l.dansMgOci === true);
  vrai('pas de lien cherchemg.fr sur une ligne mg oci', l.dansMg === false);

  console.log('');
  console.log('=== la saisie est cherchable ===');
  check('par le nom du conjoint', (R.chercher(d, { texte: 'naiken pierre' })).total, 1);
  check('par le nom de la mere', (R.chercher(d, { texte: 'poulle' })).total, 1);
  check('par la remarque', (R.chercher(d, { texte: 'sucrerie' })).total, 1);
  check('par le lieu de naissance', (R.chercher(d, { texte: 'saint-benoit' })).total, 1);
  check('par l age', (R.chercher(d, { texte: '32' })).total, 1);
  // le libelle est indexe, pas le code : « D » seul ramenerait tout
  // On indexe ce qui est affiche : la colonne dit « Reconnaissance ».
  check('par le type d acte', (R.chercher(d, { texte: 'reconnaissance' })).total, 1);
  check('par le numero', (R.chercher(d, { texte: '500' })).total, 1);
  check('le filtre provenance=mgoci isole la saisie',
        (R.chercher(d, { provenance: 'mgoci' })).total, 1);
  check('le filtre provenance=idlr ne la ramene pas',
        (R.chercher(d, { provenance: 'idlr' })).rows.some((x) => x.mg === 500), false);

  console.log('');
  console.log('=== les quatre visuels sont d accord ===');
  const v = d.couverture;
  check('la couverture compte la saisie', v.mgoci, 1);
  check('somme des provenances = total connu',
        v.idlr + v.mg + v.deux + v.mgoci, v.connus);
  const t0 = v.tranches[0];
  check('somme de la tranche = ses provenances',
        t0.idlr + t0.mg + t0.deux + t0.mgoci, 5);
  check('la saisie est dans la 1re tranche', t0.mgoci, 1);

  const barre = R.barreGlobale(v);
  const frise = R.frise(v);
  const leg = R.legende(v);
  vrai('la barre porte un segment rose', barre.indexOf('var(--mgoci)') !== -1);
  vrai('la frise porte un segment rose', frise.indexOf('var(--mgoci)') !== -1);
  vrai('la legende annonce mg oci', /mg oci/.test(leg));
  vrai('la legende donne le bon effectif', /mg oci \(saisie\) <b>1<\/b>/.test(leg), leg);

  // Le plancher : sans lui, 1 matricule = 0,01 % = 0,01 px, donc invisible.
  vrai('le segment de barre a un plancher de 2 px',
       /width:max\(2px,[\d.]+%\);background:var\(--mgoci\)/.test(barre),
       (/[^>]*--mgoci[^>]*/.exec(barre) || [''])[0]);
  vrai('le segment de frise a un plancher de 2 px',
       /height:max\(2px,[\d.]+%\);background:var\(--mgoci\)/.test(frise),
       (/[^>]*--mgoci[^>]*/.exec(frise) || [''])[0]);
  vrai('l infobulle de la tranche annonce mg oci', /mg oci 1/.test(frise));
  vrai('les tranches sans saisie n ont pas de segment rose',
       (frise.match(/var\(--mgoci\)/g) || []).length === 1,
       (frise.match(/var\(--mgoci\)/g) || []).length + ' segments');

  console.log('');
  console.log('=== la page complete se rend ===');
  const html = R.page(d);
  vrai('le bouton de saisie est present', html.indexOf('fl-ouvrir') !== -1);
  vrai('le dialogue est present', html.indexOf('id=dlg') !== -1);
  for (const c of MgOci.SAISIE) {
    vrai('champ « ' + c.libelle +' » dans le formulaire', html.indexOf('id="fl-' + c.cle + '"') !== -1);
  }
  vrai('la couleur rose est definie en clair ET en sombre',
       (html.match(/--mgoci:/g) || []).length === 3,
       (html.match(/--mgoci:/g) || []).length + ' definitions');
  vrai('le filtre mg oci est propose', html.indexOf('<option value=mgoci>') !== -1);
  vrai('la colonne Type est dans l en-tete, entre Date et Actes',
       html.indexOf('<th>Date</th><th>Type</th><th>Actes</th>') !== -1);
  for (const g of MgOci.groupes()) {
    vrai('bloc « ' + g.titre + ' » titre dans le formulaire',
         html.indexOf('<legend>' + g.titre + '</legend>') !== -1);
  }
  vrai('un bloc par groupe, pas un de plus',
       (html.match(/<fieldset class=fl-bloc>/g) || []).length === MgOci.groupes().length);
  for (const o of MgOci.TYPES_ACTE) {
    vrai('« ' + o.t + ' » propose au menu',
         html.indexOf('<option value="' + o.v + '">' + o.t + '</option>') !== -1);
  }
  vrai('le menu s ouvre sur aucun type choisi',
       html.indexOf('<select id="fl-type_acte"><option value="">') !== -1);

  console.log('');
  console.log('=== un moissonnage rattrape une saisie ===');
  // 500 finit par apparaitre dans MG : la ligne doit dire MG, sans perdre
  // la trace de la saisie, et la couverture ne doit pas le compter deux fois.
  fs.appendFileSync(process.env.MG_ENGAGES, '500,RAMASSAMY Marie,Inde,1889,1910,,,\n');
  R.oublier();
  d = await R.construire();
  const l2 = d.lignes.find((x) => x.mg === 500);
  check('la provenance passe a MG', l2.provenance, 'mg');
  vrai('la trace de la saisie reste', l2.dansMgOci === true);
  check('mg oci ne le compte plus', d.compte.mgoci, 0);
  check('il est signale comme rattrape', d.absorbes, 1);
  check('la couverture ne le compte qu une fois',
        d.couverture.idlr + d.couverture.mg + d.couverture.deux + d.couverture.mgoci,
        d.couverture.connus);

  console.log('');
  console.log('=== apres un moissonnage qui apporte les colonnes parents ===');
  // Ce que produira harvest.cjs une fois les parents releves : quatre
  // colonnes de plus. La lecture se fait par NOM, donc rien d'autre ne bouge.
  fs.writeFileSync(process.env.IDLR_OUT, [
    'matricule,nom,prenom,commune,date_iso,type_acte,obs,origine,' +
      'conjoint_nom,conjoint_prenom,pere_nom,pere_prenom,mere_nom,mere_prenom,url_demande_photo',
    '100,Petan,Jean,Saint-Denis,1887-03-02,N,,Inde,,,Petan,Louis,Sabapaty,Anne,',
    '300,Govindin,Paul,Saint-Louis,1892-01-05,M,,Inde,Sinnama,Marie Rose,Govindin,Ary,Moutou,Rose,',
    // la naissance vient APRES le mariage dans le fichier : la colonne
    // Type doit quand meme la donner en premier.
    '300,Govindin,Paul,Saint-Louis,1870-04-11,N,,Inde,,,Govindin,Ary,Moutou,Rose,'
  ].join('\n') + '\n');
  R.oublier();
  d = await R.construire();
  const mar = d.lignes.find((x) => x.mg === 300);
  check('mariage : pere dans sa colonne', mar.pere, 'Govindin Ary');
  check('mariage : mere dans sa colonne', mar.mere, 'Moutou Rose');
  check('mariage : conjoint dans sa colonne', mar.conjoint, 'Sinnama Marie Rose');
  check('deux actes : les deux types, dans l ordre d une vie',
        mar.type, 'Naissance · Mariage');
  check('les deux actes sont comptes', mar.nActes, 2);
  const sans = d.lignes.find((x) => x.mg === 100);
  check('acte sans conjoint : colonne conjoint vide', sans.conjoint, '');
  check('acte sans conjoint : parents quand meme la', sans.pere + ' / ' + sans.mere,
        'Petan Louis / Sabapaty Anne');
  check('le pere est cherchable', (R.chercher(d, { texte: 'sabapaty' })).total, 1);
  check('la mere est cherchable', (R.chercher(d, { texte: 'moutou rose' })).total, 1);
  vrai('les colonnes Père et Mère sont dans l en-tete',
       R.page(d).indexOf('<th>Père</th><th>Mère</th>') !== -1);

  console.log('');
  console.log('=== ce qu une NAISSANCE dit des parents ===');
  // Le site ne donne aucun nom de parent sur un acte de naissance : seulement
  // une marque « + » quand le parent est déjà mort, plus parrain et marraine.
  // Voir ile_archive_de_la_reunion/SCHEMA.md, « Colonnes vues par type ».
  fs.writeFileSync(process.env.IDLR_OUT, [
    'matricule,nom,prenom,commune,date_iso,type_acte,obs,origine,' +
      'conjoint_nom,conjoint_prenom,pere_nom,pere_prenom,mere_nom,mere_prenom,' +
      'pere_decede,mere_decede,parrain,marraine,url_demande_photo',
    // Naissance : le site donne le PRÉNOM du père, jamais son nom.
    '100,Apassamy,Amélie,La Possession,1892-06-16,N,,Inde,,,,Gabriel,Gouvarama,Angama,1,,Moutou Jean,Naiken Rose,',
    '200,Petan,Louis,Saint-Denis,1893-04-02,N,,Inde,,,,,,,,,,,',
    '300,Govindin,Paul,Saint-Louis,1892-01-05,M,,Inde,Sinnama,Marie Rose,Govindin,Ary,Moutou,Rose,,1,,,'
  ].join('\n') + '\n');
  R.oublier();
  d = await R.construire();

  const naiss = d.lignes.find((x) => x.mg === 100);
  check('naissance : prénom du père, avec la croix s il est mort', naiss.pere, 'Gabriel †');
  check('naissance : nom COMPLET de la mère', naiss.mere, 'Gouvarama Angama');
  check('naissance sans parents relevés : colonnes vides',
        d.lignes.find((x) => x.mg === 200).pere + '|' + d.lignes.find((x) => x.mg === 200).mere, '|');
  check('mariage : les noms priment sur la marque de décès',
        d.lignes.find((x) => x.mg === 300).mere, 'Moutou Rose †');
  check('le père est cherchable', (R.chercher(d, { texte: 'gabriel' })).total, 1);
  check('la mère est cherchable', (R.chercher(d, { texte: 'gouvarama' })).total, 1);
  vrai('la croix ne s affiche que si le parent est marqué mort',
       d.lignes.find((x) => x.mg === 200).pere.indexOf('†') === -1);

  console.log('');
  console.log(ok + ' OK, ' + ko + ' echec(s)');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ECHEC : ' + (e && e.stack ? e.stack : e));
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
