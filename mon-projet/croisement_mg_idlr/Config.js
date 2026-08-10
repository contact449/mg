/**
 * ============================================================================
 *  CROISEMENT MG x IDLR — Config.js
 *  Chemins, cadences et seuils. Tout est surchargeable par variable
 *  d'environnement : rien a editer pour un deploiement normal.
 * ============================================================================
 */
'use strict';

const path = require('path');
const ICI = __dirname;
const env = (nom, def) => (process.env[nom] === undefined || process.env[nom] === '' ? def : process.env[nom]);

const MOISSONNEUR = path.join(ICI, '..', 'ile_archive_de_la_reunion', 'moissonneur');

const MOISSONNEUR_MG = path.join(ICI, '..', 'cherche_mg', 'moissonneur');

const CFG = {
  /* ------------------------------- source A : moissonneur MG ---------------
   * Cette application ne moissonne RIEN : chaque module source possede sa
   * propre collecte, et le croisement se contente de lire les deux sorties.
   *   index MG  <- cherche_mg/moissonneur/harvest.cjs --index
   *   actes IDLR <- ile_archive_de_la_reunion/moissonneur/harvest.cjs
   * Les memes variables d'environnement que les moissonneurs sont reconnues,
   * pour qu'un chemin se declare une seule fois pour toute la chaine.
   */
  MG_INDEX: env('MG_OUT',  path.join(MOISSONNEUR_MG, 'mg_matricules.csv')),
  MG_ETAT:  env('MG_ETAT', path.join(MOISSONNEUR_MG, 'mg_etat.json')),
  MOISSONNEUR_MG_HARVEST: path.join(MOISSONNEUR_MG, 'harvest.cjs'),

  /* ------------------------------- source B : moissonneur IDLR (VPS) --------
   * harvest.cjs ecrit actes.csv ; search.cjs et fixmat.cjs travaillent sur
   * actes.db (SQLite). On accepte les DEUX et on prend ce qui existe, le plus
   * recent d'abord : ca evite d'imposer une organisation au VPS.
   */
  IDLR_DB:  env('IDLR_DB',  path.join(MOISSONNEUR, 'actes.db')),
  IDLR_CSV: env('IDLR_OUT', path.join(MOISSONNEUR, 'actes.csv')),
  MOISSONNEUR_HARVEST: path.join(MOISSONNEUR, 'harvest.cjs'),

  /* ----------------------------------------------------------- sorties ----- */
  DOSSIER: env('CROIS_OUT', ICI),
  FICHIERS: {
    ABSENTS_MG: 'idlr_absents_de_mg.csv',   // dans IDLR, pas dans MG
    ABSENTS_IDLR: 'mg_absents_didlr.csv',   // dans MG, pas dans IDLR
    COMMUNS:    'communs.csv',              // des deux cotes
    RESUME:     'resume.json',              // compteurs du dernier croisement
    HISTORIQUE: 'historique.json'           // une entree par execution
  },

  /* ------------------------------------------------------------- metier ---- */
  /** En dessous, plusieurs series de numeros ont coexiste : une egalite de
   *  numero n'y prouve pas grand-chose. Voir cherche_mg/README.md section 2. */
  SEUIL_SERIE_AMBIGUE: 11000,
  /** Bornes annoncees par cherchemg.fr. Au-dela, ce n'est pas une MG. */
  MG_MIN: 1,
  MG_MAX: 130000,
  /** Exemples d'actes conserves par matricule dans les sorties. */
  MAX_EXEMPLES: 3,

  /* ----------------------------------------------------------- cadence ----- */
  /** Mise a jour semestrielle : 1er janvier et 1er juillet (voir systemd/). */
  PERIODE_MOIS: 6,

  USER_AGENT: env('CROIS_UA', 'OCI-EXPRESS-Genealogie/1.0 (+contact: contact@ociexpress.re)')
};

CFG.chemin = (cle) => path.join(CFG.DOSSIER, CFG.FICHIERS[cle]);

module.exports = CFG;
