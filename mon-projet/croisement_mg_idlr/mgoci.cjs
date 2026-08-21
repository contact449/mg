'use strict';
/**
 * ============================================================================
 *  MG OCI — les matricules saisis a la main.
 *
 *  Archives (actes.csv) et MG (engages.csv) sont moissonnes : cette
 *  application les LIT, ne les ecrit jamais. mgoci.csv est l'exception, et la
 *  seule : c'est le fichier ou atterrit ce qu'aucune des deux bases ne
 *  connait, saisi depuis le formulaire de la recherche croisee.
 *
 *  Regle d'entree : un matricule deja present dans Archives ou dans MG est
 *  refuse. mg oci comble les trous de la serie, il ne double pas ce qui existe
 *  — sans quoi la couverture compterait deux fois le meme numero et la barre
 *  des 130 000 mentirait.
 *
 *  Le fichier reste un CSV lisible et editable a la main, comme les deux
 *  autres sources : aucune base a installer, aucune migration a prevoir, et
 *  une sauvegarde se fait par copie.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const CFG = require('./Config.js');
const { parcourirCsv } = require('./idlr.cjs');

/** Surchargeable comme tous les chemins du projet. */
const FICHIER = () => process.env.MGOCI_CSV || path.join(CFG.DOSSIER, 'mgoci.csv');

/** Une valeur trop longue est une erreur de saisie, pas une donnee. */
const MAX_CAR = 200;

/**
 * Les types d'acte proposes.
 *
 * Les codes sont ceux du moissonneur des Archives (son Config.js, TYPES_ACTE) :
 * la colonne type_acte de mgoci.csv se lit donc exactement comme celle
 * d'actes.csv, sans table de traduction entre les deux fichiers.
 *
 * R et L n'existent pas la-bas — le site range reconnaissances et
 * legitimations sous les naissances. Ici elles ont leur propre code : ce
 * qu'on saisit, c'est justement ce que les deux bases ne distinguent pas.
 */
const TYPES_ACTE = [
  { v: 'N', t: 'Acte de naissance' },
  { v: 'D', t: 'Acte de décès' },
  { v: 'M', t: 'Acte de mariage' },
  { v: 'R', t: 'Acte de reconnaissance' },
  { v: 'L', t: 'Acte de légitimation' }
];

/**
 * Le formulaire, decrit UNE fois.
 *
 * La page HTML et la validation cote serveur lisent tous deux cette liste :
 * ajouter un champ ici l'ajoute des deux cotes a la fois. Sans ca, les deux
 * derivent — le formulaire propose un champ que le serveur jette en silence.
 *
 * `groupe` decoupe le formulaire en blocs titres. Quatorze champs a la file
 * se lisent mal : on relit chaque etiquette pour retrouver le pere au lieu
 * de le voir. Un bloc commence des que le groupe change, dans l'ordre de
 * cette liste — l'ordre du formulaire, celui des colonnes du CSV et celui de
 * la validation restent donc les memes, decrits une seule fois.
 *
 * `choix` transforme le champ en menu deroulant, et la validation refuse
 * alors toute valeur hors de la liste : le menu n'engage que le navigateur,
 * un POST peut arriver sans lui.
 *
 * Les dates sont du texte libre, pas un `input type=date`. En genealogie on
 * releve « 1887 », « vers 1890 », « 12 germinal an XI » : un selecteur de
 * date refuserait ces trois-la, qui sont pourtant ce qu'on a le plus souvent.
 * Meme raison pour l'age, releve « 32 », « environ 40 » ou « 3 mois » : un
 * champ numerique en perdrait deux sur trois.
 */
const SAISIE = [
  { cle: 'matricule', groupe: 'La personne', libelle: 'Numéro de matricule', requis: true, indice: 'entre 1 et 130 000' },
  { cle: 'nom',       groupe: 'La personne', libelle: 'Nom', requis: true },
  { cle: 'prenom',    groupe: 'La personne', libelle: 'Prénom' },
  { cle: 'age',       groupe: 'La personne', libelle: 'Âge', indice: '32, environ 40, 3 mois…' },

  { cle: 'type_acte', groupe: "L'acte", libelle: "Type d'acte", choix: TYPES_ACTE },
  { cle: 'ville',     groupe: "L'acte", libelle: 'Ville', indice: "commune de l'acte" },

  { cle: 'naissance',      groupe: 'Naissance et décès', libelle: 'Date de naissance', indice: '1887, vers 1890…' },
  { cle: 'lieu_naissance', groupe: 'Naissance et décès', libelle: 'Lieu de naissance', indice: 'Saint-Denis, Inde…' },
  { cle: 'deces',          groupe: 'Naissance et décès', libelle: 'Date de décès' },

  { cle: 'conjoint',  groupe: 'Famille', libelle: 'Conjoint', indice: 'nom et prénom' },
  { cle: 'pere',      groupe: 'Famille', libelle: 'Père', indice: 'nom et prénom' },
  { cle: 'mere',      groupe: 'Famille', libelle: 'Mère', indice: 'nom et prénom' },

  { cle: 'remarque',  groupe: 'Notes', libelle: 'Remarque' },
  { cle: 'divers2',   groupe: 'Notes', libelle: 'Divers 2' }
];

/**
 * La saisie decoupee en blocs, dans l'ordre de SAISIE.
 *
 * Le formulaire s'engendre a partir d'ici plutot que de redecouper la liste
 * de son cote : deux decoupages finiraient par ne plus dire la meme chose.
 */
function groupes() {
  const out = [];
  for (const c of SAISIE) {
    const dernier = out[out.length - 1];
    if (dernier && dernier.titre === c.groupe) dernier.champs.push(c);
    else out.push({ titre: c.groupe, champs: [c] });
  }
  return out;
}

/**
 * Le libelle d'une valeur a choix : « N » se stocke, « Acte de naissance »
 * s'affiche. Une valeur inconnue ressort telle quelle plutot que masquee —
 * une ligne editee a la main ne doit pas disparaitre en silence.
 */
function libelleChoix(cle, valeur) {
  const c = SAISIE.find((x) => x.cle === cle);
  const o = c && c.choix && c.choix.find((y) => y.v === valeur);
  return o ? o.t : String(valeur == null ? '' : valeur);
}

/** L'ordre des colonnes du CSV : la saisie, plus la date d'enregistrement. */
const COLONNES = SAISIE.map((c) => c.cle).concat(['saisi_le']);

/* ------------------------------------------------------------- ecriture --- */

/** Echappe un champ CSV. Un nom peut contenir une virgule ou une apostrophe. */
function champCsv(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const ligneCsv = (champs) => champs.map(champCsv).join(',');

/* ------------------------------------------------------------- lecture ---- */

/**
 * Lit mgoci.csv. Absent = liste vide : l'application doit demarrer avant
 * qu'un seul matricule ait ete saisi.
 */
async function lire(chemin) {
  const f = chemin || FICHIER();
  if (!fs.existsSync(f)) return [];

  let entete = null;
  const out = [];
  await parcourirCsv(f, (l) => {
    if (!entete) { entete = l.map((h) => String(h || '').trim().toLowerCase()); return; }
    if (l.length === 1 && !l[0]) return;               // ligne vide de fin de fichier
    const r = {};
    entete.forEach((h, i) => { r[h] = l[i] == null ? '' : l[i]; });
    const num = Number(String(r.matricule || '').replace(/\D/g, ''));
    if (!num) return;                                  // ligne inexploitable : on l'ignore
    r.matricule = num;
    out.push(r);
  });
  return out;
}

/* ---------------------------------------------------------- validation ---- */

/**
 * Verifie une saisie. Renvoie { ok:true, valeurs } ou { ok:false, message }.
 *
 * `connu(num)` dit si Archives ou MG connait deja ce numero ; l'appelant
 * l'injecte parce que l'index croise vit dans recherche.cjs. Le passer en
 * argument rend la regle testable sans monter les deux CSV en memoire.
 */
function valider(brut, dejaMgOci, connu) {
  const v = {};
  for (const c of SAISIE) {
    const s = String(brut[c.cle] == null ? '' : brut[c.cle]).trim();
    if (s.length > MAX_CAR) {
      return { ok: false, message: c.libelle + ' : ' + MAX_CAR + ' caractères au maximum.' };
    }
    // Le menu deroulant n'engage que le navigateur : un POST peut arriver
    // sans lui, et une valeur hors liste rendrait la colonne inexploitable.
    if (c.choix && s && !c.choix.some((o) => o.v === s)) {
      return { ok: false, message: c.libelle + ' : « ' + s + ' » n\'est pas un choix proposé.' };
    }
    v[c.cle] = s;
  }

  const num = Number(v.matricule.replace(/\s/g, ''));
  if (!v.matricule) return { ok: false, message: 'Le numéro de matricule est obligatoire.' };
  if (!Number.isInteger(num)) {
    return { ok: false, message: 'Le numéro de matricule doit être un nombre entier.' };
  }
  if (num < CFG.MG_MIN || num > CFG.MG_MAX) {
    return { ok: false, message: 'Le matricule ' + num + ' est hors de la série ' +
      CFG.MG_MIN + '–' + CFG.MG_MAX + ' : ce n\'est pas une matricule générale.' };
  }
  if (!v.nom) return { ok: false, message: 'Le nom est obligatoire.' };

  if (dejaMgOci.has(num)) {
    return { ok: false, message: 'Le matricule ' + num + ' est déjà saisi dans mg oci.' };
  }
  // La regle qui donne son sens a mg oci : on ne saisit que ce qui manque.
  const ou = connu ? connu(num) : null;
  if (ou) {
    return { ok: false, message: 'Le matricule ' + num + ' est déjà présent dans ' + ou +
      '. mg oci ne sert qu\'aux matricules absents des deux bases — cherche-le pour voir sa fiche.' };
  }

  v.matricule = num;
  return { ok: true, valeurs: v };
}

/* ------------------------------------------------------------- ajout ------ */

/**
 * Ajoute un matricule mg oci. Cree le fichier avec son entete au besoin.
 *
 * L'ecriture est un simple append : un seul processus sert cette page, et une
 * ligne de quelques centaines d'octets part en un seul write. Pas de fichier
 * temporaire ni de renommage — la reprise apres coupure n'a rien a rejouer.
 */
async function ajouter(brut, connu, chemin) {
  const f = chemin || FICHIER();
  const existants = await lire(f);
  const dejaMgOci = new Set(existants.map((r) => r.matricule));

  const r = valider(brut, dejaMgOci, connu);
  if (!r.ok) return r;

  const v = r.valeurs;
  v.saisi_le = new Date().toISOString().slice(0, 10);

  const nouveau = !fs.existsSync(f);
  const eol = '\r\n';   // les CSV du projet s'ouvrent dans Excel sous Windows
  fs.appendFileSync(f,
    (nouveau ? ligneCsv(COLONNES) + eol : '') +
    ligneCsv(COLONNES.map((c) => v[c])) + eol, 'utf8');

  return { ok: true, matricule: v.matricule, fichier: f, total: existants.length + 1 };
}

/* ------------------------------------------------------------ selftest ---- */

function selftest() {
  const os = require('os');
  let ok = 0, ko = 0;
  const dit = (b, t) => { if (b) { ok++; console.log('OK    ' + t); } else { ko++; console.log('ECHEC ' + t); } };

  dit(champCsv('Petan') === 'Petan', 'champ simple non echappe');
  dit(champCsv('Petan, Jean') === '"Petan, Jean"', 'virgule -> guillemets');
  dit(champCsv('dit "le grand"') === '"dit ""le grand"""', 'guillemet double');
  dit(champCsv('a\nb') === '"a\nb"', 'saut de ligne echappe');
  dit(champCsv(null) === '', 'valeur absente -> vide');

  const vide = new Set();
  dit(!valider({ matricule: '', nom: 'X' }, vide).ok, 'matricule obligatoire');
  dit(!valider({ matricule: '42', nom: '' }, vide).ok, 'nom obligatoire');
  dit(!valider({ matricule: '0', nom: 'X' }, vide).ok, 'matricule 0 refuse');
  dit(!valider({ matricule: '130001', nom: 'X' }, vide).ok, 'au-dela de 130 000 refuse');
  dit(!valider({ matricule: '12,5', nom: 'X' }, vide).ok, 'non entier refuse');
  dit(valider({ matricule: '130000', nom: 'X' }, vide).ok, 'borne haute acceptee');
  dit(valider({ matricule: '1', nom: 'X' }, vide).ok, 'borne basse acceptee');
  dit(!valider({ matricule: '5', nom: 'x'.repeat(201) }, vide).ok, 'champ trop long refuse');
  dit(!valider({ matricule: '7', nom: 'X' }, new Set([7])).ok, 'doublon mg oci refuse');
  dit(!valider({ matricule: '9', nom: 'X' }, vide, () => 'les Archives').ok,
      'matricule deja dans une base : refuse');
  dit(valider({ matricule: '9', nom: 'X' }, vide, () => null).ok,
      'matricule inconnu des deux bases : accepte');
  dit(valider({ matricule: ' 42 ', nom: ' Petan ' }, vide).valeurs.nom === 'Petan',
      'espaces de bord retires');

  dit(valider({ matricule: '5', nom: 'X', type_acte: 'M' }, vide).ok, 'type d acte connu accepte');
  dit(valider({ matricule: '5', nom: 'X', type_acte: '' }, vide).ok, 'type d acte laisse vide accepte');
  dit(!valider({ matricule: '5', nom: 'X', type_acte: 'Z' }, vide).ok, 'type d acte hors liste refuse');
  dit(!valider({ matricule: '5', nom: 'X', type_acte: 'Naissance' }, vide).ok,
      'le libelle a la place du code est refuse');
  dit(libelleChoix('type_acte', 'R') === 'Acte de reconnaissance', 'libelle du type d acte');
  dit(libelleChoix('type_acte', '') === '', 'type d acte absent -> rien a afficher');
  dit(libelleChoix('type_acte', 'Z') === 'Z', 'code inconnu rendu tel quel');

  dit(groupes().length === 5, 'cinq blocs de saisie');
  dit(groupes().reduce((n, g) => n + g.champs.length, 0) === SAISIE.length,
      'aucun champ hors bloc');
  dit(new Set(groupes().map((g) => g.titre)).size === groupes().length,
      'un bloc par groupe : les champs d un meme groupe se suivent');
  dit(COLONNES.indexOf('remarque') !== -1 && COLONNES.indexOf('divers1') === -1,
      'divers1 remplace par remarque');
  dit(['age', 'lieu_naissance', 'type_acte'].every((c) => COLONNES.indexOf(c) !== -1),
      'age, lieu de naissance et type d acte sont des colonnes');

  // aller-retour sur un vrai fichier
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mgoci-'));
  const f = path.join(tmp, 'mgoci.csv');
  return (async () => {
    const a = await ajouter({ matricule: '77', nom: 'Petan, dit "le grand"', prenom: 'Jean',
      ville: 'Saint-Denis', age: '32', type_acte: 'N',
      lieu_naissance: 'Saint-Benoit', remarque: 'ligne\navec saut' }, null, f);
    dit(a.ok, 'ajout accepte');
    const lu = await lire(f);
    dit(lu.length === 1, 'une ligne relue');
    dit(lu[0].matricule === 77, 'matricule relu en nombre');
    dit(lu[0].nom === 'Petan, dit "le grand"', 'virgule ET guillemets survivent a l aller-retour');
    dit(lu[0].remarque === 'ligne\navec saut', 'saut de ligne survit a l aller-retour');
    dit(lu[0].age === '32' && lu[0].lieu_naissance === 'Saint-Benoit' &&
        lu[0].type_acte === 'N', 'age, lieu de naissance et type d acte relus');
    dit(/^\d{4}-\d{2}-\d{2}$/.test(lu[0].saisi_le), 'date de saisie enregistree');

    const b = await ajouter({ matricule: '77', nom: 'Doublon' }, null, f);
    dit(!b.ok, 'ajout du meme matricule refuse');
    dit((await lire(f)).length === 1, 'le refus n a rien ecrit');

    const c = await ajouter({ matricule: '78', nom: 'Second' }, null, f);
    dit(c.ok && (await lire(f)).length === 2, 'deuxieme ajout, entete non redoublee');

    dit((await lire(path.join(tmp, 'absent.csv'))).length === 0, 'fichier absent -> liste vide');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('');
    console.log(ok + ' OK, ' + ko + ' echec(s)');
    return ko === 0;
  })();
}

module.exports = { lire, ajouter, valider, champCsv, ligneCsv, SAISIE, COLONNES,
                   TYPES_ACTE, groupes, libelleChoix, FICHIER, selftest };

if (require.main === module) {
  selftest().then((bon) => process.exit(bon ? 0 : 1));
}
