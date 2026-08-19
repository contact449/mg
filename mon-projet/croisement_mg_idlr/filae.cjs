'use strict';
/**
 * ============================================================================
 *  FILAE — les matricules saisis a la main.
 *
 *  Archives (actes.csv) et MG (engages.csv) sont moissonnes : cette
 *  application les LIT, ne les ecrit jamais. filae.csv est l'exception, et la
 *  seule : c'est le fichier ou atterrit ce qu'aucune des deux bases ne
 *  connait, saisi depuis le formulaire de la recherche croisee.
 *
 *  Regle d'entree : un matricule deja present dans Archives ou dans MG est
 *  refuse. Filae comble les trous de la serie, il ne double pas ce qui existe
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
const FICHIER = () => process.env.FILAE_CSV || path.join(CFG.DOSSIER, 'filae.csv');

/** Une valeur trop longue est une erreur de saisie, pas une donnee. */
const MAX_CAR = 200;

/**
 * Le formulaire, decrit UNE fois.
 *
 * La page HTML et la validation cote serveur lisent tous deux cette liste :
 * ajouter un champ ici l'ajoute des deux cotes a la fois. Sans ca, les deux
 * derivent — le formulaire propose un champ que le serveur jette en silence.
 *
 * Les dates sont du texte libre, pas un `input type=date`. En genealogie on
 * releve « 1887 », « vers 1890 », « 12 germinal an XI » : un selecteur de
 * date refuserait ces trois-la, qui sont pourtant ce qu'on a le plus souvent.
 */
const SAISIE = [
  { cle: 'matricule', libelle: 'Numéro de matricule', requis: true, indice: 'entre 1 et 130 000' },
  { cle: 'nom',       libelle: 'Nom', requis: true },
  { cle: 'prenom',    libelle: 'Prénom' },
  { cle: 'ville',     libelle: 'Ville' },
  { cle: 'naissance', libelle: 'Date de naissance', indice: '1887, vers 1890…' },
  { cle: 'deces',     libelle: 'Date de décès' },
  { cle: 'conjoint',  libelle: 'Conjoint', indice: 'nom et prénom' },
  { cle: 'pere',      libelle: 'Père', indice: 'nom et prénom' },
  { cle: 'mere',      libelle: 'Mère', indice: 'nom et prénom' },
  { cle: 'divers1',   libelle: 'Divers 1' },
  { cle: 'divers2',   libelle: 'Divers 2' }
];

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
 * Lit filae.csv. Absent = liste vide : l'application doit demarrer avant
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
function valider(brut, dejaFilae, connu) {
  const v = {};
  for (const c of SAISIE) {
    const s = String(brut[c.cle] == null ? '' : brut[c.cle]).trim();
    if (s.length > MAX_CAR) {
      return { ok: false, message: c.libelle + ' : ' + MAX_CAR + ' caractères au maximum.' };
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

  if (dejaFilae.has(num)) {
    return { ok: false, message: 'Le matricule ' + num + ' est déjà saisi dans Filae.' };
  }
  // La regle qui donne son sens a Filae : on ne saisit que ce qui manque.
  const ou = connu ? connu(num) : null;
  if (ou) {
    return { ok: false, message: 'Le matricule ' + num + ' est déjà présent dans ' + ou +
      '. Filae ne sert qu\'aux matricules absents des deux bases — cherche-le pour voir sa fiche.' };
  }

  v.matricule = num;
  return { ok: true, valeurs: v };
}

/* ------------------------------------------------------------- ajout ------ */

/**
 * Ajoute un matricule Filae. Cree le fichier avec son entete au besoin.
 *
 * L'ecriture est un simple append : un seul processus sert cette page, et une
 * ligne de quelques centaines d'octets part en un seul write. Pas de fichier
 * temporaire ni de renommage — la reprise apres coupure n'a rien a rejouer.
 */
async function ajouter(brut, connu, chemin) {
  const f = chemin || FICHIER();
  const existants = await lire(f);
  const dejaFilae = new Set(existants.map((r) => r.matricule));

  const r = valider(brut, dejaFilae, connu);
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
  dit(!valider({ matricule: '7', nom: 'X' }, new Set([7])).ok, 'doublon Filae refuse');
  dit(!valider({ matricule: '9', nom: 'X' }, vide, () => 'les Archives').ok,
      'matricule deja dans une base : refuse');
  dit(valider({ matricule: '9', nom: 'X' }, vide, () => null).ok,
      'matricule inconnu des deux bases : accepte');
  dit(valider({ matricule: ' 42 ', nom: ' Petan ' }, vide).valeurs.nom === 'Petan',
      'espaces de bord retires');

  // aller-retour sur un vrai fichier
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filae-'));
  const f = path.join(tmp, 'filae.csv');
  return (async () => {
    const a = await ajouter({ matricule: '77', nom: 'Petan, dit "le grand"', prenom: 'Jean',
      ville: 'Saint-Denis', divers1: 'ligne\navec saut' }, null, f);
    dit(a.ok, 'ajout accepte');
    const lu = await lire(f);
    dit(lu.length === 1, 'une ligne relue');
    dit(lu[0].matricule === 77, 'matricule relu en nombre');
    dit(lu[0].nom === 'Petan, dit "le grand"', 'virgule ET guillemets survivent a l aller-retour');
    dit(lu[0].divers1 === 'ligne\navec saut', 'saut de ligne survit a l aller-retour');
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

module.exports = { lire, ajouter, valider, champCsv, ligneCsv, SAISIE, COLONNES, FICHIER, selftest };

if (require.main === module) {
  selftest().then((bon) => process.exit(bon ? 0 : 1));
}
