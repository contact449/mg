/**
 * ============================================================================
 *  CHERCHE-MG - Config.gs
 *  Wrapper JSON + moissonneur au-dessus de https://cherchemg.fr
 *  (Numeros de Matricule Generale des engages de La Reunion)
 * ============================================================================
 *
 *  REVERSE ENGINEERING - confirme sur le HTML reel (aout 2026) :
 *
 *  -- 1. FICHE PAR NUMERO ---------------------------------------------------
 *
 *    GET /mg.php?MgChaine=<n>          (n entier, 1..130000, pas de session,
 *                                       pas de cookie, pas de token)
 *
 *    Le <form name="Recherche"> de la page est en method="get" avec
 *    onSubmit="return false" : c'est le bouton qui appelle VerifMgChaine(),
 *    laquelle valide [0-9]{1,6} cote client puis soumet. Cote serveur aucune
 *    validation : n=0 renvoie une page vide, n>130000 renvoie les "indices".
 *
 *    Trois formes de reponse :
 *      a) TROUVEE   "Votre MG <strong id="anchoryouremg">n</strong> a ete
 *                    trouvee" + <table id="anchortablemg"> (1..N engages)
 *      b) ABSENTE   <div id="anchoryouremg"><b>n</b> ... "Ce numero n'est pas
 *                    encore present, mais voici quelques indices"
 *      c) VIDE      ni l'un ni l'autre (n=0, chaine non numerique)
 *
 *    Dans les cas (a) et (b) le site ajoute des tables "indices", deduites de
 *    la PLAGE du numero et non de l'engage :
 *      <table id="anchortableimmat">  fenetre d'immatriculation (entre / et le)
 *      <table id="anchortablecvoy">   convois arrives dans cette fenetre
 *      <table id="anchortablectxt">   histoire contextuelle
 *
 *  -- 2. INDEX PAR IDENTITE (la mine d'or) ----------------------------------
 *
 *    POST /patro.php    corps : PatroChaine=<chaine>
 *
 *    -> <table id="anchortableidt"> : 1 ligne d'entete + N lignes de 3 <td>
 *         [1] Patronyme
 *         [2] Source (peut contenir un <a href> vers bibliocard.php)
 *         [3] <a href="mg.php?MgChaine=<n>#anchoryouremg">n</a>  OU vide
 *
 *    Recherche "contient", insensible a la casse. La validation 3 caracteres
 *    minimum est PUREMENT CLIENT (verifpatrochaine.js) : le serveur accepte
 *    une seule lettre. C'est ce qui rend le moissonnage raisonnable :
 *
 *         PatroChaine=a   -> 34 315 lignes, 18 145 MG distincts, 6,5 Mo
 *         PatroChaine=ou  -> 16 146 lignes,  9 359 MG distincts
 *         PatroChaine=sam ->  3 574 lignes,  2 041 MG distincts
 *
 *    Toute identite contenant au moins une lettre a-z est donc atteignable
 *    par un balayage de 26 requetes, la ou enumerer /mg.php de 1 a 130000 en
 *    demanderait 130 000 (~9 jours a la cadence du serveur).
 *
 *  -- 3. CADENCE DU SERVEUR -------------------------------------------------
 *
 *    Le PHP s'execute en ~57 ms (Server-Timing) mais la reponse arrive en
 *    ~6 s et la connexion n'est jamais reutilisee : le site s'auto-limite a
 *    environ 1 requete / 6 s. Inutile de paralleliser, ca ne passera pas.
 *
 *  -- 4. LIMITES ANNONCEES PAR LE SITE --------------------------------------
 *
 *    - Resultats NON exhaustifs (releves benevoles toujours en cours).
 *    - MG 1..~10999 : plusieurs series de numeros ont coexiste, un meme
 *      numero peut donc porter plusieurs engages sans rapport entre eux
 *      (verifie : MG 5 renvoie 3 engages, MG 700 en renvoie 2).
 *    - MG >= 11000 : serie principale, sans equivoque, de 1839 a 1911,
 *      renseignee jusqu'a ~124000.
 *    - Pied de page : "usage personnel et non commercial, de type
 *      genealogique" ; les donnees appartiennent aux contributeurs et
 *      releveurs, dont le nom est conserve dans chaque ligne stockee.
 *
 *  NOTE PROJET : tous les globaux sont prefixes mg / MG_ pour pouvoir
 *  cohabiter avec le module ile_archive_de_la_reunion dans un meme projet
 *  Apps Script (espace de noms plat). Seul doGet() est commun : voir Api.gs.
 * ============================================================================
 */

var MG_CFG = {
  BASE:        'https://cherchemg.fr',
  PATH_MG:     '/mg.php',
  PATH_PATRO:  '/patro.php',

  // Bornes annoncees par le site.
  MG_MIN: 1,
  MG_MAX: 130000,
  SERIE_PRINCIPALE_MIN: 11000,   // en dessous : numeros potentiellement ambigus

  // Politesse. Le serveur repond deja en ~6 s ; ce delai s'ajoute par-dessus.
  MIN_INTERVAL_MS: 2000,
  MAX_RETRY:       3,
  RETRY_BACKOFF_MS: 5000,
  CACHE_TTL_SEC:   21600,        // 6 h (maximum Apps Script)
  USER_AGENT:      'OCI-EXPRESS-Genealogie/1.0 (+contact: contact@ociexpress.re)',

  // Garde-fou anti-aspiration sur la phase 2 (fiches une par une).
  MAX_FICHES_PAR_RUN: 250,

  // Apps Script coupe a 6 min : on rend la main avant et on se replanifie.
  BUDGET_MS:        4 * 60 * 1000,
  TRIGGER_DELAI_MN: 1,
  MAX_ECHECS:       5,           // reprises infructueuses avant suspension

  // Ecriture par paquets dans la feuille (evite les setValues geants).
  TAILLE_LOT: 2000,

  // Optionnel : protege l'endpoint doGet. '' = ouvert.
  API_KEY: ''
};

/**
 * Alphabet du balayage, ordonne par rendement decroissant : les voyelles
 * ramenent l'essentiel de l'index des les premieres requetes, le reste ne
 * sert qu'a garantir l'exhaustivite (une identite sans aucune voyelle).
 * Chaque entree peut faire plusieurs caracteres si tu veux cibler.
 */
var MG_ALPHABET = [
  'a', 'e', 'i', 'o', 'u',
  'n', 'r', 's', 't', 'm', 'l', 'c', 'd', 'p', 'v', 'g', 'b', 'h',
  'y', 'f', 'j', 'k', 'q', 'w', 'x', 'z'
];

/**
 * Noms des feuilles de destination.
 * L'avancement du balayage, lui, vit dans les proprietes du script
 * (cle MG_BALAYAGE) : quelques centaines d'octets, pas besoin d'une feuille.
 */
var MG_SHEETS = {
  MATRICULES: 'MG_Matricules',    // MG trouves : une ligne par (MG, identite, source)
  SANS:       'MG_Sans_numero',   // identites relevees sans numero de MG
  FICHES:     'MG_Fiches'         // phase 2 : detail /mg.php par numero
};

/** En-tetes (sans accent : le fichier reste ASCII, robuste au clasp push). */
var MG_ENTETES = {
  MATRICULES: ['MG', 'Identite', 'Source', 'URL source', 'Trouve par', 'Cle'],
  SANS:       ['Identite', 'Source', 'URL source', 'Trouve par', 'Cle'],
  FICHES:     ['MG', 'Identite', 'Origine', 'Naissance', 'Arrivee', 'Convoi',
               'Immatriculation', 'Notes', 'Sources', 'Contributeur',
               'Releveur', 'Immat. entre le', 'Immat. et le', 'Recupere le']
};

/**
 * Libelles de champs de la fiche /mg.php.
 *
 * Les cles sont DESACCENTUEES et en minuscules : le parser passe le libelle
 * lu dans le HTML par mgNormTexte_() avant de chercher ici. Double benefice :
 * ce fichier reste ASCII pur (insensible a l'encodage au clasp push) et le
 * parsing survit a un accent que le site ajouterait ou retirerait.
 * Libelles reels sur le site : "Numero MG", "Identite", "Arrivee", etc.
 */
var MG_CHAMPS_FICHE = {
  'numero mg':        'mg',
  'identite':         'identite',
  'origine':          'origine',
  'naissance':        'naissance',
  'arrivee':          'arrivee',
  'convoi':           'convoi',
  'immatriculation':  'immatriculation',
  'notes':            'notes',
  'sources':          'sources'
};

/** Libelles de champs d'un convoi (table anchortablecvoy), memes regles. */
var MG_CHAMPS_CONVOI = {
  'navire':              'navire',
  'arrivee':             'arrivee',
  'provenance':          'provenance',
  'remarques':           'remarques',
  "nombre d'engages":    'nombre',
  'sources':             'sources'
};

/* -------------------------------------------------------------- utilitaires */

/** Numero de MG valide ? Renvoie l'entier ou null. */
function mgNormaliserNumero(n) {
  var s = String(n === null || n === undefined ? '' : n).trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  var v = parseInt(s, 10);
  if (v < MG_CFG.MG_MIN || v > MG_CFG.MG_MAX) return null;
  return v;
}

/**
 * Hash court et stable, pour les cles de deduplication du balayage.
 *
 * DEUX fonctions independantes (djb2 et sdbm) concatenees, soit ~64 bits.
 * Un seul mot de 32 bits ne suffirait pas : sur les ~250 000 couples
 * (patronyme|source) que ramene un balayage complet, le paradoxe des
 * anniversaires donne ~7 collisions attendues, donc ~7 identites qui
 * disparaitraient silencieusement. En 64 bits l'esperance tombe a ~3e-9.
 */
function mgHash_(s) {
  var djb2 = 5381;
  var sdbm = 0;
  s = String(s || '');
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + c) | 0;               // djb2 : h*33 + c
    sdbm = (c + (sdbm << 6) + (sdbm << 16) - sdbm) | 0; // sdbm : c + h*65599
  }
  return (djb2 >>> 0).toString(36) + (sdbm >>> 0).toString(36);
}

/**
 * Normalisation pour comparaison : sans accent, minuscules, apostrophe droite,
 * espaces normalises. Sert a reconnaitre les libelles du site (MG_CHAMPS_*).
 */
function mgNormTexte_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")   // apostrophes typographiques
    .replace(/\u00a0/g, ' ')                 // espace insecable
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1839-12-22" -> 1839 ; "0000-00-00" et "" -> null. */
function mgAnnee_(dateSite) {
  var m = /^(\d{4})-/.exec(String(dateSite || ''));
  if (!m) return null;
  var a = parseInt(m[1], 10);
  return a > 0 ? a : null;
}

/** Le site ecrit les dates inconnues 0000-00-00 : on les rend vides. */
function mgDateSite_(v) {
  var s = String(v || '').trim();
  return (s === '0000-00-00' || s === '') ? '' : s;
}
