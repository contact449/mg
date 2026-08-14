/**
 * ============================================================================
 *  CHERCHE-MG - Api.gs
 *  Endpoint JSON (Web App), menu du classeur, et tests.
 *
 *  DEPLOIEMENT : Deployer > Nouveau deploiement > Application Web
 *                Executer en tant que : moi
 *                Acces : selon besoin
 *
 *  COHABITATION avec le module ile_archive_de_la_reunion : si tu mets les
 *  deux dans le MEME projet Apps Script, Apps Script n'accepte qu'un seul
 *  doGet(). Garde alors un doGet unique qui aiguille, par exemple :
 *
 *      function doGet(e) {
 *        var p = (e && e.parameter) || {};
 *        return (p.source === 'mg') ? mgDoGet(e) : idlrDoGet(e);
 *      }
 *
 *  (et renomme le doGet de l'autre module en idlrDoGet).
 * ============================================================================
 */

/* ---------------------------------------------------------------- endpoint */

/**
 *  GET .../exec?action=tableau                 <- le tableau de bord (HTML)
 *  GET .../exec?action=recherche               <- l ecran de recherche (HTML)
 *  GET .../exec?action=fiche&mg=11000
 *  GET .../exec?action=patro&q=moutou&max=200
 *  GET .../exec?action=liste&page=1&taille=1000
 *  GET .../exec?action=etat
 *
 *  Params :
 *    action = tableau | recherche | fiche | patro | liste | etat  (defaut : fiche)
 *    mg     = numero de matricule (1..130000)     [action=fiche]
 *    q      = chaine recherchee dans l'identite   [action=patro]
 *    max    = plafond de lignes renvoyees         [action=patro]
 *    page, taille = pagination de la feuille      [action=liste]
 *    key    = ta cle si MG_CFG.API_KEY est renseignee
 */
function mgDoGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (MG_CFG.API_KEY && p.key !== MG_CFG.API_KEY) {
      return mgJson_({ ok: false, error: 'Cle API invalide' });
    }

    switch (p.action || 'fiche') {

      // Les deux ecrans, servis en HTML : c'est la voie qui marche meme quand
      // le script est autonome et n'a donc aucune interface de classeur.
      case 'tableau':
        return mgPageWeb_(mgPageTableauDeBord(), 'Cherche MG - chiffres cles');

      case 'recherche':
        return mgPageWeb_(HtmlService.createHtmlOutputFromFile('Recherche'),
                          'Cherche MG - recherche d\'engages');

      case 'fiche':
        return mgJson_(mgLookup(p.mg || p.numero || p.MgChaine,
                                { sansCache: p.sansCache === '1' }));

      case 'patro':
        return mgJson_(mgPatro(p.q || p.patronyme,
                               { max: p.max ? Number(p.max) : 500 }));

      case 'liste':
        return mgJson_(mgListeMatricules(Number(p.page || 1), Number(p.taille || 1000)));

      case 'etat':
        return mgJson_(mgEtatBalayage());

      default:
        return mgJson_({ ok: false, error: 'action inconnue : ' + p.action });
    }
  } catch (err) {
    return mgJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Si ce module est seul dans son projet Apps Script, ce doGet suffit. */
function doGet(e) { return mgDoGet(e); }

function mgJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------- interface utilisateur -- */

/**
 * L'interface du classeur, ou null si le script n'est pas lie a un classeur.
 *
 * SpreadsheetApp.getUi() n'existe QUE dans un script attache a un fichier
 * ouvert. Dans un script autonome - celui que mgClasseur_() alimente en creant
 * un classeur - l'appel leve "Cannot call SpreadsheetApp.getUi() from this
 * context". On teste au lieu de laisser passer l'exception brute.
 */
function mgUi_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}

/**
 * Comme mgUi_(), mais explique quoi faire au lieu d'un message Google opaque.
 * @param {string} quoi    ce qu'on voulait ouvrir, pour le message
 * @param {string} action  la route web equivalente (?action=...)
 */
function mgUiOuEchouer_(quoi, action) {
  var ui = mgUi_();
  if (ui) return ui;
  throw new Error(
    'Impossible d\'ouvrir ' + quoi + ' ici : ce script n\'est pas lie a un classeur.\n\n' +
    'Deux solutions :\n' +
    '  1) Lier le script au classeur - ouvre le classeur, Extensions > Apps Script, ' +
    'et colle les fichiers dans CE projet. Le menu et les fenetres marcheront.\n' +
    '  2) Deployer en application web (Deployer > Nouveau deploiement > Application ' +
    'Web) et ouvrir  <url>/exec?action=' + action + '  : c\'est la meme page.\n\n' +
    'Le classeur des donnees : ' + mgClasseur_().getUrl());
}

/** Page HTML servie par l'application web (titre + viewport poses une fois). */
function mgPageWeb_(sortie, titre) {
  return sortie
    .setTitle(titre)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------ lecture de la base */

/**
 * Page de la feuille MG_Matricules (la liste construite par le balayage).
 * @param {number} page    1-based
 * @param {number} taille  lignes par page
 */
function mgListeMatricules(page, taille) {
  page = Math.max(1, Number(page || 1));
  taille = Math.min(Math.max(1, Number(taille || 1000)), 5000);

  var sh = mgFeuille_(MG_SHEETS.MATRICULES, MG_ENTETES.MATRICULES);
  var total = Math.max(0, sh.getLastRow() - 1);
  var debut = (page - 1) * taille;
  if (debut >= total) {
    return { ok: true, total: total, page: page, taille: taille, count: 0, lignes: [] };
  }
  var n = Math.min(taille, total - debut);
  var vals = sh.getRange(2 + debut, 1, n, MG_ENTETES.MATRICULES.length).getValues();

  var lignes = vals.map(function (r) {
    return { mg: r[0], identite: r[1], source: r[2], sourceUrl: r[3], trouvePar: r[4] };
  });
  return {
    ok: true,
    source: 'cherchemg.fr (releves benevoles, contributeurs nommes dans la fiche)',
    total: total,
    page: page,
    taille: taille,
    count: lignes.length,
    lignes: lignes
  };
}

/**
 * Chiffres cles de la base locale (version plate, pour l'API et les logs).
 * Le detail - histogramme, distribution, releveurs - est dans mgStatistiques(),
 * que le tableau de bord affiche. Un seul calcul, deux presentations.
 */
function mgResume() {
  var s = mgStatistiques();
  return {
    ok: true,
    classeur: s.classeur,
    lignesMatricules: s.lignesIndex,
    matriculesDistincts: s.matriculesDistincts,
    engagesDistincts: s.engagesDistincts,
    plage: s.plage,
    matriculesSerieAmbigue: s.serieAmbigue,    // < 11000 : plusieurs series ont coexiste
    identitesSansNumero: s.identitesSansNumero,
    lignesFiches: s.lignesFiches,
    balayage: s.balayage
  };
}

/* -------------------------------------------------------------------- menu */

/**
 * Menu du classeur. Si ton projet a deja un onOpen(), supprime celui-ci et
 * appelle mgInstallerMenu_() depuis le tien.
 */
function onOpen() { mgInstallerMenu_(); }

function mgInstallerMenu_() {
  var ui = mgUi_();
  if (!ui) return;            // script autonome : pas de menu, pas d erreur
  ui
    .createMenu('Cherche MG')
    .addItem('1. Lancer le balayage complet', 'mgMenuBalayage_')
    .addItem('Voir l\'avancement', 'mgMenuEtat_')
    .addItem('Arreter le balayage', 'mgArreterBalayage')
    .addSeparator()
    .addItem('2. Completer les fiches (serie >= 11000)', 'mgMenuFiches_')
    .addSeparator()
    .addItem('Rechercher un engage...', 'mgOuvrirRecherche')
    .addItem('Importer un CSV d\'engages...', 'mgMenuImporterEngages_')
    .addSeparator()
    .addItem('Chercher un numero de MG (en ligne)...', 'mgMenuRecherche_')
    .addItem('Chiffres cles', 'mgAfficherTableauDeBord')
    .addToUi();
}

function mgMenuBalayage_() {
  var ui = mgUiOuEchouer_('cette fenetre', 'etat');
  var rep = ui.alert(
    'Balayage complet',
    'Environ ' + MG_ALPHABET.length + ' requetes vers cherchemg.fr, une par lettre.\n' +
    'Mesure en production : ~90 s pour les 26 lettres, en une seule execution.\n' +
    'Si Apps Script coupe avant la fin, le script se replanifie tout seul.\n\n' +
    'Rappel : le site indique un usage personnel et non commercial, et les\n' +
    'donnees appartiennent a leurs contributeurs et releveurs (noms conserves).\n\n' +
    'Lancer ?',
    ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;
  mgDemarrerBalayage();
  ui.alert('Balayage lance. Suis l\'avancement par le menu "Voir l\'avancement".');
}

function mgMenuEtat_() {
  var ui = mgUiOuEchouer_('cette fenetre', 'etat');
  var e = mgEtatBalayage();
  if (e.enCours === false && !e.lettresFaites) {
    ui.alert('Balayage jamais lance.');
    return;
  }
  var faites = (e.lettresFaites || []).length;
  var reste  = (e.lettresRestantes || []).length;
  var etat = e.suspendu ? 'SUSPENDU (' + e.echecsConsecutifs + ' echecs) - relance mgBalayage()'
           : e.enCours  ? 'en cours'
           : 'termine';

  ui.alert(
    'Balayage : ' + etat + '\n\n' +
    faites + ' lettres traitees, ' + reste + ' restantes\n' +
    (e.lettresRestantes || []).join(' ') + '\n\n' +
    mgFormaterNombre_(e.lignesLues) + ' lignes lues sur le site\n' +
    mgFormaterNombre_(e.matriculesDistincts) + ' matricules distincts enregistres\n' +
    mgFormaterNombre_(e.identitesSansNumero) + ' identites sans numero\n\n' +
    'Derniere mise a jour : ' + (e.maj || '-') +
    (e.dernierEchec ? '\nDernier echec : ' + e.dernierEchec : '')
  );
}

/** 18145 -> "18 145" (espace insecable fine, lisible dans une alerte). */
function mgFormaterNombre_(v) {
  return String(v === null || v === undefined ? 0 : v)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

function mgMenuFiches_() {
  var ui = mgUiOuEchouer_('cette fenetre', 'etat');
  var rep = ui.alert(
    'Completer les fiches',
    'Une requete par numero, ~6 s chacune cote site.\n' +
    'Limite par execution : ' + MG_CFG.MAX_FICHES_PAR_RUN + ' fiches, puis reprise auto.\n\n' +
    'Sur toute la serie principale cela represente PLUSIEURS JOURS.\n' +
    'Continuer ?',
    ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;
  var r = mgCompleterFiches({ min: MG_CFG.SERIE_PRINCIPALE_MIN, continu: true });
  ui.alert(r.traites + ' fiches recuperees, ' + r.reste + ' restantes.');
}

function mgMenuRecherche_() {
  var ui = mgUiOuEchouer_('cette fenetre', 'fiche');
  var rep = ui.prompt('Numero de Matricule Generale', 'Entre un numero (1 a 130000) :',
                      ui.ButtonSet.OK_CANCEL);
  if (rep.getSelectedButton() !== ui.Button.OK) return;
  var f = mgLookup(rep.getResponseText());
  if (f.ok === false) { ui.alert(f.error); return; }
  if (!f.trouve) {
    ui.alert('MG ' + f.mg + ' : pas encore presente dans la base du site.' +
             (f.immatriculation ? '\n\nImmatriculee entre le ' + f.immatriculation.entre_le +
              ' et le ' + f.immatriculation.et_le + '.' : ''));
    return;
  }
  var txt = f.engages.map(function (g) {
    return '- ' + (g.identite || '(sans identite)') + ' | ' + g.origine +
           ' | arrivee ' + (g.arrivee || '?') + '\n  releveur : ' + g.releveur;
  }).join('\n');
  ui.alert('MG ' + f.mg + ' : ' + f.nb_engages + ' engage(s)\n\n' + txt);
}

/* Le menu "Chiffres cles" ouvre desormais le tableau de bord
   (mgAfficherTableauDeBord, dans Stats.gs). mgResume() reste disponible
   pour l'API et pour un coup d'oeil rapide depuis l'editeur. */

/* ------------------------------------------------------------------- tests */

/** Fiche d'un numero connu (MG 5 : 3 engages, serie ambigue). */
function mgTestFiche() {
  var f = mgLookup(5, { sansCache: true });
  Logger.log('statut=%s  engages=%s  ambigue=%s', f.statut, f.nb_engages, f.serie_ambigue);
  Logger.log(JSON.stringify(f.engages, null, 2));
  return f;
}

/** Index par identite : doit ramener quelques milliers de lignes. */
function mgTestPatro() {
  var r = mgPatro('sam', { max: 5 });
  Logger.log('lignes=%s  avecMg=%s  sansMg=%s  warnings=%s',
             r.total, r.avecMg, r.sansMg, r.warnings.join(','));
  Logger.log(JSON.stringify(r.lignes, null, 2));
  return r;
}

/** Verifie que la structure du site n'a pas bouge (a lancer si le parsing casse). */
function mgTestStructure() {
  var html = mgFetch_(MG_CFG.BASE + MG_CFG.PATH_MG + '?MgChaine=11000');
  var ids = ['anchortablemg', 'anchortableimmat', 'anchortablecvoy', 'anchortablectxt'];
  ids.forEach(function (id) {
    Logger.log('%s : %s', id, mgTable_(html, id) ? 'present' : 'ABSENT');
  });
  var patro = mgFetch_(MG_CFG.BASE + MG_CFG.PATH_PATRO, {
    method: 'post', payload: { PatroChaine: 'sam' }
  });
  Logger.log('anchortableidt : %s', mgTable_(patro, 'anchortableidt') ? 'present' : 'ABSENT');
  Logger.log('champs fiche vus : %s',
             JSON.stringify(mgParseFiche(html, 11000).warnings));
}

/** Parsing pur, sans reseau : colle ici un extrait de HTML pour deboguer. */
function mgTestParserHorsLigne() {
  var extrait =
    '<table id="anchortablemg"><tr><th><h3>Engages</h3></th></tr>' +
    '<tr><td><b>Num\u00e9ro MG :</b> 5 <br/><b>Identit\u00e9 :</b> Ramsamy<br/>' +
    '<b>Origine :</b> Inde<br/><b>Naissance :</b> <br/><b>Arriv\u00e9e :</b> 1839-12-22<br/>' +
    '<b>Convoi :</b> <br/><b>Immatriculation :</b> 1839-12-22<br/>' +
    '<b>Notes :</b> prison a vie<br/><b>Sources :</b> IMG_9931.JPG<br/>' +
    '<span>Contributeur : <b>Claude Rossignol</b> | Releveur : <b>Laurent Coutaye </b>' +
    '<i>(proprietaire de ces donnees)</i></span></td></tr></table>';
  var f = mgParseFiche('<strong id="anchoryouremg">5</strong>' + extrait, 5);
  Logger.log(JSON.stringify(f, null, 2));
  return f;
}
