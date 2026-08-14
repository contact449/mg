/**
 * ============================================================================
 *  CHERCHE-MG - Engages.gs
 *  Import d'un CSV d'engages dans le classeur, et moteur de recherche.
 *
 *  POURQUOI CE FICHIER
 *  Le module sait deja constituer l'index (mgDemarrerBalayage) et les fiches
 *  (mgCompleterFiches). Il ne savait pas AFFICHER ni CHERCHER : les donnees
 *  dormaient dans une feuille. Ce fichier ajoute les deux.
 *
 *  SCHEMA LIBRE
 *  Les colonnes sont reconnues par leur NOM, lu dans la ligne d'en-tete, pas
 *  par leur position. La meme feuille et le meme ecran acceptent donc :
 *    - engages.csv                      10 colonnes
 *    - moissonneur/mg_fiches.csv        15 colonnes (statut, releveur, dates)
 *    - un export de MG_Fiches           14 colonnes
 *  Une colonne absente est simplement ignoree ; une colonne inconnue est
 *  conservee et affichee. Rien a reparametrer quand la source change.
 *
 *  IMPORT \u2014 deux voies, au choix
 *    a) Sheets natif : Fichier > Importer > Importer le fichier > Ins\u00e9rer une
 *       nouvelle feuille, puis renommer l'onglet en MG_Engages. Zero code.
 *    b) mgImporterEngages('engages.csv') : lit le fichier sur ton Drive et
 *       remplit la feuille. Pratique pour rejouer l'import a l'identique.
 *
 *  RECHERCHE
 *  mgRechercherEngages(criteres) filtre cote serveur et renvoie une page de
 *  resultats. Le filtrage se fait sur du texte DESACCENTUE : chercher "petan"
 *  trouve "P\u00e9tan", et "geole" trouve "g\u00e9\u00f4le".
 * ============================================================================
 */

/** Feuille ou vivent les engages consultables. */
var MG_SHEET_ENGAGES = 'MG_Engages';

/** Feuille ou "Envoyer vers une feuille" depose le resultat d'une recherche. */
var MG_SHEET_RECHERCHE = 'MG_Recherche';

/** Colonnes connues, dans l'ordre d'affichage souhaite. Cle = nom normalise. */
// Largeurs mini, en px : la somme doit tenir dans la modale (1100) sinon les
// dernieres colonnes sortent du champ et personne ne pense a defiler.
// Notes et Sources sont tronquees a l'ellipse, texte complet au survol.
var MG_COLONNES_ENGAGES = [
  { cle: 'matricule',       titre: 'MG',        largeur: 58,  type: 'nombre' },
  { cle: 'identite',        titre: 'Identite',  largeur: 165 },
  { cle: 'origine',         titre: 'Origine',   largeur: 105 },
  { cle: 'naissance',       titre: 'Naissance', largeur: 84,  type: 'date' },
  { cle: 'arrivee',         titre: 'Arrivee',   largeur: 84,  type: 'date' },
  { cle: 'convoi',          titre: 'Convoi',    largeur: 86 },
  { cle: 'immatriculation', titre: 'Immat.',    largeur: 84,  type: 'date' },
  { cle: 'notes',           titre: 'Notes',     largeur: 160 },
  { cle: 'sources',         titre: 'Sources',   largeur: 180 },
  { cle: 'contributeur',    titre: 'Contributeur', largeur: 105 },
  { cle: 'releveur',        titre: 'Releveur',  largeur: 105 },
  { cle: 'statut',          titre: 'Statut',    largeur: 62 }
];

/** Colonnes fouillees par la recherche en texte libre. */
var MG_CHAMPS_TEXTE = ['identite', 'notes', 'sources', 'origine', 'convoi', 'contributeur', 'releveur'];

/** Plafond de lignes renvoyees en une fois a l'ecran. */
var MG_TAILLE_PAGE_RECHERCHE = 100;

/* ========================================================== acces feuille = */

/** La feuille des engages, ou null si elle n'existe pas encore. */
function mgFeuilleEngages_() {
  return mgClasseur_().getSheetByName(MG_SHEET_ENGAGES);
}

/**
 * Lit la feuille et renvoie ses lignes sous forme d'objets.
 * L'en-tete est normalise (sans accent, minuscules) pour retrouver les cles
 * quelle que soit la casse ou l'accentuation du CSV d'origine.
 *
 * @return {{entetes:Array<string>, cles:Array<string>, lignes:Array<Array>}}
 */
function mgLireEngages_() {
  var sh = mgFeuilleEngages_();
  if (!sh) {
    throw new Error(
      'Feuille "' + MG_SHEET_ENGAGES + '" introuvable.\n\n' +
      'Importe d\'abord tes engages :\n' +
      '  - Fichier > Importer > (engages.csv) > Inserer une nouvelle feuille, ' +
      'puis renomme l\'onglet en ' + MG_SHEET_ENGAGES + '\n' +
      '  - ou lance mgImporterEngages("engages.csv") depuis l\'editeur.');
  }
  var nbLignes = sh.getLastRow() - 1;
  var nbCols = sh.getLastColumn();
  if (nbLignes <= 0) return { entetes: [], cles: [], lignes: [] };

  var entetes = sh.getRange(1, 1, 1, nbCols).getDisplayValues()[0];
  var cles = entetes.map(function (h) { return mgNormTexte_(h).replace(/\s+/g, '_'); });
  // getDisplayValues : une date lue en getValues reviendrait en objet Date et
  // "1838-08-31" deviendrait "Fri Aug 31 1838...". On veut le texte affiche.
  var lignes = sh.getRange(2, 1, nbLignes, nbCols).getDisplayValues();
  return { entetes: entetes, cles: cles, lignes: lignes };
}

/** Position d'une colonne par sa cle normalisee, -1 si absente. */
function mgIndexColonne_(cles, cle) {
  return cles.indexOf(cle);
}

/* ================================================================ import = */

/**
 * Importe un CSV depuis le Drive dans la feuille MG_Engages.
 *
 * @param {string} nomOuId  nom exact du fichier sur le Drive, ou son ID
 * @param {Object} opts     { remplacer: true } pour vider la feuille avant
 * @return {Object} compte-rendu
 */
function mgImporterEngages(nomOuId, opts) {
  opts = opts || {};
  var nom = String(nomOuId || 'engages.csv');

  var fichier = null;
  try { fichier = DriveApp.getFileById(nom); } catch (e) { fichier = null; }
  if (!fichier) {
    var it = DriveApp.getFilesByName(nom);
    if (!it.hasNext()) {
      throw new Error('Fichier introuvable sur le Drive : ' + nom +
                      '\nDepose-le sur ton Drive (glisser-deposer) puis relance.');
    }
    fichier = it.next();
  }

  var texte = fichier.getBlob().getDataAsString('UTF-8');
  var table = Utilities.parseCsv(texte);
  if (!table.length) throw new Error('CSV vide : ' + nom);

  var entetes = table[0];
  var corps = table.slice(1);

  var ss = mgClasseur_();
  var sh = ss.getSheetByName(MG_SHEET_ENGAGES);
  if (!sh) sh = ss.insertSheet(MG_SHEET_ENGAGES);
  else if (opts.remplacer !== false) sh.clear();

  // La grille par defaut fait 1000 lignes / 26 colonnes : on l'agrandit AVANT
  // d'ecrire, sinon setValues leve "range exceeds grid limits".
  var besoinLignes = corps.length + 1;
  if (besoinLignes > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), besoinLignes - sh.getMaxRows() + 100);
  if (entetes.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), entetes.length - sh.getMaxColumns());

  sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold');
  sh.setFrozenRows(1);

  // Tout en texte : sans ca, Sheets transforme "1838-08-31" en date et
  // "0000-00-00" en erreur, et les matricules perdent leurs zeros de tete.
  var plage = sh.getRange(2, 1, corps.length, entetes.length);
  plage.setNumberFormat('@');
  for (var i = 0; i < corps.length; i += 2000) {
    var lot = corps.slice(i, i + 2000);
    // parseCsv peut rendre des lignes plus courtes : on les complete.
    for (var j = 0; j < lot.length; j++) {
      while (lot[j].length < entetes.length) lot[j].push('');
      if (lot[j].length > entetes.length) lot[j] = lot[j].slice(0, entetes.length);
    }
    sh.getRange(2 + i, 1, lot.length, entetes.length).setValues(lot);
  }

  var cr = {
    ok: true,
    fichier: fichier.getName(),
    lignes: corps.length,
    colonnes: entetes,
    feuille: MG_SHEET_ENGAGES,
    classeur: ss.getUrl()
  };
  Logger.log('Import : %s lignes depuis %s', cr.lignes, cr.fichier);
  return cr;
}

/* ============================================================= recherche = */

/**
 * Recherche dans la feuille des engages.
 *
 * @param {Object} c criteres :
 *   texte         mots cherches dans identite/notes/sources/... (tous exiges)
 *   matriculeMin  borne basse (nombre)
 *   matriculeMax  borne haute
 *   origine       prefixe ("Inde" attrape "Inde | Calcutta")
 *   contributeur  valeur exacte
 *   anneeMin      annee mini, comparee a naissance / arrivee / immatriculation
 *   anneeMax      annee maxi
 *   page          1-based
 *   taille        lignes par page (plafonne)
 * @return {Object} { ok, total, page, pages, colonnes, lignes, duree_ms }
 */
function mgRechercherEngages(c) {
  c = c || {};
  var t0 = Date.now();
  var data = mgLireEngages_();
  var cles = data.cles;

  var iMat  = mgIndexColonne_(cles, 'matricule');
  var iOrig = mgIndexColonne_(cles, 'origine');
  var iCont = mgIndexColonne_(cles, 'contributeur');
  var iNais = mgIndexColonne_(cles, 'naissance');
  var iArr  = mgIndexColonne_(cles, 'arrivee');
  var iImm  = mgIndexColonne_(cles, 'immatriculation');

  // Colonnes fouillees par le texte libre, parmi celles reellement presentes.
  var iTexte = [];
  for (var k = 0; k < MG_CHAMPS_TEXTE.length; k++) {
    var idx = mgIndexColonne_(cles, MG_CHAMPS_TEXTE[k]);
    if (idx !== -1) iTexte.push(idx);
  }

  // Tous les mots doivent etre presents (ET), chacun pouvant tomber dans une
  // colonne differente : "moutou 1851" trouve l'identite Moutou datee de 1851.
  var mots = mgNormTexte_(c.texte || '').split(' ').filter(function (m) { return m.length > 0; });

  var origine = mgNormTexte_(c.origine || '');
  var contributeur = mgNormTexte_(c.contributeur || '');
  var matMin = c.matriculeMin ? Number(c.matriculeMin) : null;
  var matMax = c.matriculeMax ? Number(c.matriculeMax) : null;
  var anMin = c.anneeMin ? Number(c.anneeMin) : null;
  var anMax = c.anneeMax ? Number(c.anneeMax) : null;

  var retenues = [];

  for (var r = 0; r < data.lignes.length; r++) {
    var l = data.lignes[r];

    if (matMin !== null || matMax !== null) {
      var m = Number(l[iMat]);
      if (!m) continue;
      if (matMin !== null && m < matMin) continue;
      if (matMax !== null && m > matMax) continue;
    }
    if (origine && iOrig !== -1 && mgNormTexte_(l[iOrig]).indexOf(origine) !== 0) continue;
    if (contributeur && iCont !== -1 && mgNormTexte_(l[iCont]) !== contributeur) continue;

    if (anMin !== null || anMax !== null) {
      var an = mgPremiereAnnee_([l[iNais], l[iArr], l[iImm]], [iNais, iArr, iImm]);
      if (an === null) continue;
      if (anMin !== null && an < anMin) continue;
      if (anMax !== null && an > anMax) continue;
    }

    if (mots.length) {
      var foin = '';
      for (var t = 0; t < iTexte.length; t++) foin += ' ' + l[iTexte[t]];
      foin = mgNormTexte_(foin);
      var tous = true;
      for (var w = 0; w < mots.length; w++) {
        if (foin.indexOf(mots[w]) === -1) { tous = false; break; }
      }
      if (!tous) continue;
    }

    retenues.push(l);
  }

  // Tri par matricule croissant : l'ordre naturel d'un registre.
  if (iMat !== -1) {
    retenues.sort(function (a, b) { return (Number(a[iMat]) || 0) - (Number(b[iMat]) || 0); });
  }

  var taille = Math.min(Number(c.taille || MG_TAILLE_PAGE_RECHERCHE), MG_TAILLE_PAGE_RECHERCHE);
  var page = Math.max(1, Number(c.page || 1));
  var pages = Math.max(1, Math.ceil(retenues.length / taille));
  if (page > pages) page = pages;
  var debut = (page - 1) * taille;

  return {
    ok: true,
    total: retenues.length,
    totalFeuille: data.lignes.length,
    page: page,
    pages: pages,
    taille: taille,
    colonnes: mgColonnesAffichables_(data),
    lignes: retenues.slice(debut, debut + taille),
    duree_ms: Date.now() - t0
  };
}

/** Premiere annee exploitable parmi plusieurs colonnes de date. */
function mgPremiereAnnee_(valeurs, indexes) {
  for (var i = 0; i < valeurs.length; i++) {
    if (indexes[i] === -1) continue;
    var a = mgAnnee_(valeurs[i]);
    if (a) return a;
  }
  return null;
}

/**
 * Colonnes a afficher : celles qu'on connait, dans l'ordre voulu, puis les
 * eventuelles colonnes inattendues du CSV (jamais perdues).
 */
function mgColonnesAffichables_(data) {
  var out = [];
  var pris = {};
  for (var i = 0; i < MG_COLONNES_ENGAGES.length; i++) {
    var def = MG_COLONNES_ENGAGES[i];
    var idx = mgIndexColonne_(data.cles, def.cle);
    if (idx === -1) continue;
    pris[idx] = 1;
    out.push({ index: idx, titre: def.titre, largeur: def.largeur || 120, type: def.type || 'texte' });
  }
  for (var j = 0; j < data.cles.length; j++) {
    if (pris[j]) continue;
    if (!data.entetes[j]) continue;
    out.push({ index: j, titre: data.entetes[j], largeur: 120, type: 'texte' });
  }
  return out;
}

/** Valeurs distinctes d'une colonne, pour alimenter les listes de l'ecran. */
function mgValeursDistinctes_(cle, maxi) {
  var data = mgLireEngages_();
  var idx = mgIndexColonne_(data.cles, cle);
  if (idx === -1) return [];
  var vus = {};
  for (var i = 0; i < data.lignes.length; i++) {
    var v = String(data.lignes[i][idx] || '').trim();
    if (v) vus[v] = (vus[v] || 0) + 1;
  }
  var liste = [];
  for (var k in vus) liste.push({ valeur: k, n: vus[k] });
  liste.sort(function (a, b) { return b.n - a.n; });
  return liste.slice(0, maxi || 200);
}

/**
 * Donnees d'amorcage de l'ecran : compteurs et listes deroulantes.
 * Un seul aller-retour au chargement, au lieu d'un par liste.
 */
function mgAmorcerRecherche() {
  var data = mgLireEngages_();
  var iMat = mgIndexColonne_(data.cles, 'matricule');
  var mats = {};
  var min = null, max = null;
  for (var i = 0; i < data.lignes.length; i++) {
    var m = Number(data.lignes[i][iMat]);
    if (!m) continue;
    mats[m] = 1;
    if (min === null || m < min) min = m;
    if (max === null || m > max) max = m;
  }
  var n = 0;
  for (var k in mats) n++;

  return {
    ok: true,
    lignes: data.lignes.length,
    matriculesDistincts: n,
    plage: { min: min, max: max },
    colonnes: mgColonnesAffichables_(data),
    origines: mgValeursDistinctes_('origine', 60),
    contributeurs: mgValeursDistinctes_('contributeur', 40),
    urlFiche: MG_CFG.BASE + MG_CFG.PATH_MG + '?MgChaine='
  };
}

/**
 * Ecrit TOUS les resultats d'une recherche dans une feuille du classeur.
 * Sans pagination : c'est fait pour travailler ensuite sur la selection
 * (tri, filtres Sheets, export, partage).
 */
function mgExporterRecherche(criteres) {
  var c = {};
  for (var k in criteres) c[k] = criteres[k];
  c.page = 1;
  c.taille = MG_TAILLE_PAGE_RECHERCHE;

  var apercu = mgRechercherEngages(c);
  if (!apercu.total) return { ok: true, lignes: 0, feuille: MG_SHEET_RECHERCHE };

  // On rejoue la recherche en demandant tout : mgRechercherEngages plafonne la
  // page, on boucle donc sur les pages plutot que de contourner le plafond.
  var toutes = [];
  for (var p = 1; p <= apercu.pages; p++) {
    c.page = p;
    toutes = toutes.concat(mgRechercherEngages(c).lignes);
  }

  var ss = mgClasseur_();
  var sh = ss.getSheetByName(MG_SHEET_RECHERCHE);
  if (!sh) sh = ss.insertSheet(MG_SHEET_RECHERCHE);
  else sh.clear();

  var cols = apercu.colonnes;
  var entetes = cols.map(function (x) { return x.titre; });
  var corps = toutes.map(function (l) {
    return cols.map(function (x) { return l[x.index]; });
  });

  var besoin = corps.length + 1;
  if (besoin > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), besoin - sh.getMaxRows() + 100);
  if (entetes.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), entetes.length - sh.getMaxColumns());

  sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (corps.length) {
    sh.getRange(2, 1, corps.length, entetes.length).setNumberFormat('@').setValues(corps);
  }
  ss.setActiveSheet(sh);

  return { ok: true, lignes: corps.length, feuille: MG_SHEET_RECHERCHE, total: apercu.total };
}

/* ================================================================ ecran = */

/** Ouvre l'ecran de recherche (necessite le fichier HTML "Recherche"). */
function mgOuvrirRecherche() {
  var ui = mgUiOuEchouer_('l ecran de recherche', 'recherche');
  var html = HtmlService.createHtmlOutputFromFile('Recherche')
    .setWidth(1100)
    .setHeight(720);
  ui.showModalDialog(html, 'Engages - recherche');
}

/** Menu : import guide. */
function mgMenuImporterEngages_() {
  var ui = mgUiOuEchouer_('cette fenetre', 'recherche');
  var rep = ui.prompt(
    'Importer un CSV d\'engages',
    'Nom du fichier sur ton Drive (ou son ID).\n' +
    'Depose-le d\'abord sur le Drive par glisser-deposer.\n\n' +
    'Exemple : engages.csv',
    ui.ButtonSet.OK_CANCEL);
  if (rep.getSelectedButton() !== ui.Button.OK) return;

  var nom = rep.getResponseText().trim();
  if (!nom) return;
  try {
    var cr = mgImporterEngages(nom);
    ui.alert(cr.lignes + ' lignes importees dans la feuille ' + cr.feuille + '.\n\n' +
             'Colonnes : ' + cr.colonnes.join(', '));
  } catch (e) {
    ui.alert('Import impossible.\n\n' + (e && e.message ? e.message : e));
  }
}

/* ================================================================ tests = */

/** Verifie que la feuille est lisible et que la recherche repond. */
function mgTestRecherche() {
  var a = mgAmorcerRecherche();
  Logger.log('lignes=%s  matricules=%s  plage=%s-%s',
             a.lignes, a.matriculesDistincts, a.plage.min, a.plage.max);
  Logger.log('origines (top 5) : %s',
             JSON.stringify(a.origines.slice(0, 5)));

  var r = mgRechercherEngages({ texte: 'moutou', taille: 5 });
  Logger.log('recherche "moutou" : %s resultats en %s ms', r.total, r.duree_ms);
  Logger.log(JSON.stringify(r.lignes.slice(0, 3), null, 2));
  return r;
}
