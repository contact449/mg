/**
 * ============================================================================
 *  CHERCHE-MG - Stats.gs
 *  Agregats de la base locale + ouverture du tableau de bord (Vue.html).
 *
 *  mgStatistiques()          calcule tout en UN seul parcours des feuilles
 *  mgAfficherTableauDeBord() ouvre Vue.html dans une fenetre modale
 *
 *  Le parcours lit deux colonnes de MG_Matricules (numero + identite) et une
 *  de MG_Fiches. Sur une base complete (~250 000 lignes) compte quelques
 *  secondes : c'est une action de menu, pas un appel d'API.
 * ============================================================================
 */

/** Largeur des tranches de l'histogramme (13 tranches pour 130 000). */
var MG_TAILLE_TRANCHE = 10000;

/** Nombre de releveurs affiches dans le classement. */
var MG_TOP_RELEVEURS = 8;

/**
 * Tous les chiffres de la base locale.
 * @return {Object} voir SCHEMA.md, section "Statistiques"
 */
function mgStatistiques() {
  var shMg     = mgFeuille_(MG_SHEETS.MATRICULES, MG_ENTETES.MATRICULES);
  var shSans   = mgFeuille_(MG_SHEETS.SANS,       MG_ENTETES.SANS);
  var shFiches = mgFeuille_(MG_SHEETS.FICHES,     MG_ENTETES.FICHES);

  var nLignes = Math.max(0, shMg.getLastRow() - 1);
  var lignes  = nLignes ? shMg.getRange(2, 1, nLignes, 2).getValues() : [];

  var nbTranches = Math.ceil(MG_CFG.MG_MAX / MG_TAILLE_TRANCHE);
  var tranches = [];
  for (var t = 0; t < nbTranches; t++) {
    tranches.push({
      debut: t * MG_TAILLE_TRANCHE + 1,
      fin:   (t + 1) * MG_TAILLE_TRANCHE,
      n:     0
    });
  }

  var nbIdentites = {};   // numero de MG -> nb d'identites distinctes
  var vuMgIdent   = {};   // "mg\n identite" -> deja compte
  var distincts = 0, min = null, max = null, ambigus = 0, engages = 0;

  for (var i = 0; i < lignes.length; i++) {
    var n = Number(lignes[i][0]);
    if (!n) continue;

    if (nbIdentites[n] === undefined) {
      nbIdentites[n] = 0;
      distincts++;
      if (min === null || n < min) min = n;
      if (max === null || n > max) max = n;
      if (n < MG_CFG.SERIE_PRINCIPALE_MIN) ambigus++;
      var idx = Math.floor((n - 1) / MG_TAILLE_TRANCHE);
      if (idx >= 0 && idx < nbTranches) tranches[idx].n++;
    }

    // Un meme engage peut apparaitre sur plusieurs sources : on ne compte
    // qu'une fois chaque identite pour un numero donne. Separateur = saut de
    // ligne : mgNormTexte_ ecrase tout blanc, il ne peut donc pas s'en trouver
    // dans l'identite (sinon 5 + "1x" et 51 + "x" donneraient la meme cle).
    var cle = n + '\n' + mgNormTexte_(lignes[i][1]);
    if (!vuMgIdent[cle]) { vuMgIdent[cle] = 1; nbIdentites[n]++; engages++; }
  }

  // Combien de matricules portent 1, 2, 3, 4 engages ou plus ?
  // On renvoie le NOMBRE, pas un libelle : ce fichier est ASCII, la mise en
  // mots (accentuee) appartient a la vue.
  var distribution = [
    { engages: 1, n: 0 },
    { engages: 2, n: 0 },
    { engages: 3, n: 0 },
    { engages: 4, n: 0 }   // 4 ou plus
  ];
  for (var mg in nbIdentites) {
    var c = nbIdentites[mg];
    if (c < 1) continue;
    distribution[Math.min(c, 4) - 1].n++;
  }

  return {
    ok: true,
    genere_le: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    classeur: mgClasseur_().getUrl(),

    matriculesDistincts: distincts,
    engagesDistincts:    engages,       // couples (matricule, identite) distincts
    lignesIndex:         nLignes,
    identitesSansNumero: Math.max(0, shSans.getLastRow() - 1),
    lignesFiches:        Math.max(0, shFiches.getLastRow() - 1),
    plage:               { min: min, max: max },

    serieAmbigue:    ambigus,                // < 11000, plusieurs series ont coexiste
    seriePrincipale: distincts - ambigus,    // >= 11000, un numero = une personne
    seuilSerie:      MG_CFG.SERIE_PRINCIPALE_MIN,

    tailleTranche: MG_TAILLE_TRANCHE,
    tranches:      tranches,
    distribution:  distribution,
    releveurs:     mgTopReleveurs_(shFiches),

    balayage: mgEtatBalayage()
  };
}

/** Classement des releveurs, depuis MG_Fiches (vide tant que la phase 2 n'a pas tourne). */
function mgTopReleveurs_(shFiches) {
  var n = Math.max(0, shFiches.getLastRow() - 1);
  if (!n) return [];

  var colonne = MG_ENTETES.FICHES.indexOf('Releveur') + 1;
  var vals = shFiches.getRange(2, colonne, n, 1).getValues();

  var compte = {};
  for (var i = 0; i < n; i++) {
    var nom = String(vals[i][0] || '').trim();
    if (nom) compte[nom] = (compte[nom] || 0) + 1;
  }

  var liste = [];
  for (var k in compte) liste.push({ nom: k, n: compte[k] });
  liste.sort(function (a, b) { return b.n - a.n; });
  return liste.slice(0, MG_TOP_RELEVEURS);
}

/* ------------------------------------------------------------ tableau de bord */

/**
 * Ouvre le tableau de bord.
 * Necessite un fichier HTML nomme "Vue" dans le projet Apps Script.
 */
function mgAfficherTableauDeBord() {
  var modele = HtmlService.createTemplateFromFile('Vue');

  // Injecte en JSON. On neutralise '<' : une valeur contenant "</script>"
  // fermerait la balise et casserait la page.
  modele.donnees = JSON.stringify(mgStatistiques()).replace(/</g, '\\u003c');

  SpreadsheetApp.getUi().showModalDialog(
    modele.evaluate().setWidth(940).setHeight(720),
    'Cherche MG - chiffres cles'
  );
}
