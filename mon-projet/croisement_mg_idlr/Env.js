/**
 * ============================================================================
 *  Env.js - environnement d'execution, commun aux trois applications Node.
 *
 *  COPIE CONFORME : ce fichier existe a l'identique dans
 *      ile_archive_de_la_reunion/moissonneur/
 *      cherche_mg/moissonneur/
 *      croisement_mg_idlr/
 *  (meme convention que Config.js et Parser.js : chaque dossier reste
 *  autonome et copiable seul sur le VPS). Pour resynchroniser :
 *      cp ile_archive_de_la_reunion/moissonneur/Env.js <autre dossier>/
 *  Les selftests verifient que les copies n'ont pas derive.
 *
 *  DEUX PRINCIPES
 *
 *  1. dev par defaut. Sans OCI_ENV, on est en developpement. La production
 *     doit etre declaree ; on ne bascule jamais en prod par oubli.
 *
 *  2. rien de dangereux sans autorisation. En dev, toute requete vers les
 *     sites reels est refusee : cherchemg.fr et iledelareunion-archive.com
 *     sont tenus par des benevoles, et une commande lancee par megarde peut
 *     declencher des heures de trafic. Les tests travaillent sur les fixtures.
 *
 *  USAGE
 *      OCI_ENV=prod node harvest.cjs        # bash / systemd
 *      $env:OCI_ENV = "prod"; node ...      # PowerShell
 *      OCI_RESEAU=1 node harvest.cjs        # dev, appel reel exceptionnel
 * ============================================================================
 */
'use strict';

const NOMS = ['dev', 'prod'];

const NOM = String(process.env.OCI_ENV || 'dev').trim().toLowerCase();
if (NOMS.indexOf(NOM) === -1) {
  throw new Error('OCI_ENV invalide : "' + process.env.OCI_ENV +
                  '" (attendu : ' + NOMS.join(' ou ') + ')');
}

const DEV = NOM === 'dev';
const PROD = !DEV;

/** En prod le reseau est ouvert ; en dev il faut le demander explicitement. */
const RESEAU = PROD || process.env.OCI_RESEAU === '1';

/**
 * Refuse une requete sortante quand l'environnement ne l'autorise pas.
 * A appeler UNE fois, avant la premiere requete, pas a chaque appel : le
 * message doit arriver au lancement, pas au milieu d'une recolte.
 *
 * @param {string} hote   le site vise, pour le message
 * @param {string} quoi   ce que la commande allait faire
 */
function exigerReseau(hote, quoi) {
  if (RESEAU) return;
  throw new Error(
    'Environnement dev : requete vers ' + hote + ' bloquee.\n\n' +
    (quoi ? '  ' + quoi + '\n\n' : '') +
    '  ' + hote + ' est tenu par des benevoles. Une recolte lancee par\n' +
    '  megarde represente des heures de trafic sur leur serveur.\n\n' +
    'Pour un appel reel ponctuel depuis le dev :\n' +
    '  bash        OCI_RESEAU=1 <ta commande>\n' +
    '  PowerShell  $env:OCI_RESEAU = "1"; <ta commande>\n\n' +
    'Pour la production :\n' +
    '  OCI_ENV=prod <ta commande>');
}

/** Valeur selon l'environnement : env(dev, prod). */
function selon(valeurDev, valeurProd) {
  return DEV ? valeurDev : valeurProd;
}

/**
 * Racine des donnees. On ne deplace RIEN par defaut : dev et prod vivent
 * deja sur des machines differentes (poste de travail contre VPS), et
 * relocaliser les fichiers casserait les installations existantes.
 * OCI_DONNEES permet de tout deporter d'un coup si besoin.
 */
function donnees(defaut) {
  return process.env.OCI_DONNEES || defaut;
}

/**
 * URL a ouvrir dans un navigateur, a partir de l'adresse d'ecoute.
 *
 * 0.0.0.0 veut dire "toutes les interfaces" cote serveur ; ce n'est PAS une
 * adresse joignable. Un navigateur repond ERR_ADDRESS_INVALID. Afficher
 * l'adresse de bind au demarrage envoie donc l'utilisateur dans le mur :
 * on affiche localhost, et on mentionne a part l acces distant.
 */
function urlLocale(hote, port) {
  const h = (!hote || hote === '0.0.0.0' || hote === '::' || hote === '[::]')
    ? 'localhost' : hote;
  return 'http://' + h + ':' + port;
}

/** Etiquette courte pour les interfaces web. */
function badge() {
  return { env: NOM, prod: PROD, texte: PROD ? 'PROD' : 'DEV', reseau: RESEAU };
}

/**
 * Ligne affichee au lancement de chaque service : on doit toujours savoir
 * dans quel environnement on se trouve sans avoir a le deviner.
 */
function banniere(application) {
  const marque = PROD ? '[PROD]' : '[dev]';
  const reseau = RESEAU ? 'reseau autorise' : 'reseau bloque';
  console.log(marque + ' ' + application + ' - ' + reseau +
              (DEV && !RESEAU ? ' (OCI_RESEAU=1 pour autoriser)' : ''));
}

module.exports = {
  NOM: NOM,
  DEV: DEV,
  PROD: PROD,
  RESEAU: RESEAU,
  exigerReseau: exigerReseau,
  selon: selon,
  donnees: donnees,
  urlLocale: urlLocale,
  badge: badge,
  banniere: banniere
};
