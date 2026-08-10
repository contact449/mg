/**
 * ============================================================================
 *  IDLR-ARCHIVE API — Config.gs  (v2 — noms de champs CONFIRMES)
 *  Wrapper JSON au-dessus de http://www.iledelareunion-archive.com/
 * ============================================================================
 *
 *  REVERSE ENGINEERING — confirme sur le HTML reel du formulaire :
 *
 *  <form action="http://www.iledelareunion-archive.com/recherche.php"
 *        name="formulaire" method="post">
 *
 *  Champs POST (+ des champs CACHES obligatoires — code, rech=2 —, repris
 *  automatiquement du <form> par buildPayload_ ; ils ont deja change) :
 *    nom      (text)   patronyme, 2-25 car., motif [A-Za-z accents ?' ]
 *    choix    (radio)  1=Contient  2=Commence par  3=Termine par  4=Exact
 *    prenom   (text)
 *    dateinf  (text)   annee mini
 *    datesup  (text)   annee maxi
 *    mere     (text)   nom de la mere, meme motif que nom
 *    ordre    (radio)  chrono | alpha
 *    s        (radio)  M | F | T
 *    ta       (radio)  N | D | M | PM | DIV   (UN SEUL type par recherche !)
 *    (le bouton submit n'a PAS de name -> rien a envoyer pour lui)
 *
 *  Le formulaire poste vers recherche.php SANS query string : le perimetre
 *  (commune / secteur) est garde en SESSION PHP, etabli par le GET qui a
 *  charge le formulaire :
 *     recherche.php?rech=1&code=<7 chiffres>&phonex=0   (commune)
 *     recherche.php?rech=3&code=<5 chiffres>&phonex=0   (secteur)
 *
 *  Pagination = lien GET rejouant la recherche, avec le cookie de session :
 *     recherche.php?rech=4&x=<offset>&choix=..&nom=..&s=..&ta=..&code=..
 *                  &prenom=..&mere=..&ordre=..&dateinf=..&datesup=..&phonex=..
 *     x = (page-1) * 50   (50 actes par page)
 *
 *  IMPORTANT : le site redirige non-www -> www. On tape www. directement,
 *  sinon le POST perd son corps lors de la redirection 301/302.
 * ============================================================================
 */

var CFG = {
  BASE: 'http://www.iledelareunion-archive.com',   // www. obligatoire
  PATH: '/recherche.php',

  PAGE_SIZE: 50,           // 50 actes par page (offset x)

  // Politesse : serveur associatif tenu par des benevoles.
  MIN_INTERVAL_MS: 1500,   // delai mini entre 2 requetes sortantes
  CACHE_TTL_SEC: 21600,    // 6h (max Apps Script)
  MAX_PAGES: 20,           // garde-fou anti-aspiration
  USER_AGENT: 'OCI-EXPRESS-Genealogie/1.0 (+contact: webmaster@oci-express.re)'
};

/** Noms de champs REELS du formulaire (cle logique -> name= du site). */
var FIELD_MAP = {
  nom:      'nom',
  prenom:   'prenom',
  mere:     'mere',       // nom de la mere
  anneeMin: 'dateinf',
  anneeMax: 'datesup',
  choix:    'choix',      // mode de correspondance
  ordre:    'ordre',
  sexe:     's',
  typeActe: 'ta'
};

/** Valeurs REELLES cote site. */
var VALUE_MAP = {
  choix: { contient: '1', commence: '2', termine: '3', exact: '4' },
  ordre: { chrono: 'chrono', alpha: 'alpha' },
  sexe:  { M: 'M', F: 'F', T: 'T' },
  acte:  { N: 'N', D: 'D', M: 'M', PM: 'PM', DIV: 'DIV' }
};

/** Types d'actes (UN SEUL par recherche : radio cote site). */
var TYPES_ACTE = {
  N:   'Naissance',
  D:   'Deces',
  M:   'Mariage',
  PM:  'Promesse de mariage',
  DIV: 'Divorce'
};

/** Les 24 communes + les notaires, avec code interne et secteur. */
var COMMUNES = [
  { nom: "La Possession",           code: '9741008', insee: '97408', secteur: 'TCO',      codeSecteur: '97410' },
  { nom: "Le Port",                 code: '9741007', insee: '97407', secteur: 'TCO',      codeSecteur: '97410' },
  { nom: "Saint-Leu",               code: '9741013', insee: '97413', secteur: 'TCO',      codeSecteur: '97410' },
  { nom: "Saint-Paul",              code: '9741015', insee: '97415', secteur: 'TCO',      codeSecteur: '97410' },
  { nom: "Trois-Bassins",           code: '9741023', insee: '97423', secteur: 'TCO',      codeSecteur: '97410' },

  { nom: "Bras-Panon",              code: '9741102', insee: '97402', secteur: 'CIREST',   codeSecteur: '97411' },
  { nom: "La Plaine-des-Palmistes", code: '9741106', insee: '97406', secteur: 'CIREST',   codeSecteur: '97411' },
  { nom: "Saint-Andre",             code: '9741109', insee: '97409', secteur: 'CIREST',   codeSecteur: '97411' },
  { nom: "Saint-Benoit",            code: '9741110', insee: '97410', secteur: 'CIREST',   codeSecteur: '97411' },
  { nom: "Sainte-Rose",             code: '9741119', insee: '97419', secteur: 'CIREST',   codeSecteur: '97411' },
  { nom: "Salazie",                 code: '9741121', insee: '97421', secteur: 'CIREST',   codeSecteur: '97411' },

  { nom: "Saint-Denis",             code: '9741211', insee: '97411', secteur: 'CINOR',    codeSecteur: '97412' },
  { nom: "Sainte-Marie",            code: '9741218', insee: '97418', secteur: 'CINOR',    codeSecteur: '97412' },
  { nom: "Sainte-Suzanne",          code: '9741220', insee: '97420', secteur: 'CINOR',    codeSecteur: '97412' },

  { nom: "L'Entre-Deux",            code: '9741303', insee: '97403', secteur: 'CASUD',    codeSecteur: '97413' },
  { nom: "Saint-Joseph",            code: '9741312', insee: '97412', secteur: 'CASUD',    codeSecteur: '97413' },
  { nom: "Saint-Philippe",          code: '9741317', insee: '97417', secteur: 'CASUD',    codeSecteur: '97413' },
  { nom: "Le Tampon",               code: '9741322', insee: '97422', secteur: 'CASUD',    codeSecteur: '97413' },

  { nom: "Les Avirons",             code: '9741401', insee: '97401', secteur: 'CIVIS',    codeSecteur: '97414' },
  { nom: "L'Etang-Sale",            code: '9741404', insee: '97404', secteur: 'CIVIS',    codeSecteur: '97414' },
  { nom: "Petite-Ile",              code: '9741405', insee: '97405', secteur: 'CIVIS',    codeSecteur: '97414' },
  { nom: "Saint-Louis",             code: '9741414', insee: '97414', secteur: 'CIVIS',    codeSecteur: '97414' },
  { nom: "Saint-Pierre",            code: '9741416', insee: '97416', secteur: 'CIVIS',    codeSecteur: '97414' },
  { nom: "Cilaos",                  code: '9741424', insee: '97424', secteur: 'CIVIS',    codeSecteur: '97414' },

  { nom: "Bourbon-Notaires",        code: '9741599', insee: '',      secteur: 'Notaires', codeSecteur: '97415' }
];

var SECTEURS = ['TCO', 'CIREST', 'CINOR', 'CASUD', 'CIVIS', 'Notaires'];

function normLabel_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findCommune(q) {
  if (!q) return null;
  var n = normLabel_(q);
  for (var i = 0; i < COMMUNES.length; i++) {
    var c = COMMUNES[i];
    if (c.code === String(q) || normLabel_(c.nom) === n) return c;
  }
  for (var j = 0; j < COMMUNES.length; j++) {
    if (normLabel_(COMMUNES[j].nom).indexOf(n) !== -1) return COMMUNES[j];
  }
  return null;
}

function findSecteur(q) {
  if (!q) return null;
  var n = normLabel_(q);
  for (var i = 0; i < COMMUNES.length; i++) {
    var c = COMMUNES[i];
    if (c.codeSecteur === String(q) || normLabel_(c.secteur) === n) {
      return { secteur: c.secteur, codeSecteur: c.codeSecteur };
    }
  }
  return null;
}
