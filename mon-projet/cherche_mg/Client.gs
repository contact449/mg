/**
 * ============================================================================
 *  CHERCHE-MG - Client.gs
 *  Reseau (throttle + retry + cache), stockage Sheets, et le balayage
 *  reprenable qui construit la liste des matricules.
 *
 *  DEUX PHASES
 *  -----------
 *  Phase 1  mgDemarrerBalayage()  ~26 requetes POST /patro.php
 *           -> feuille MG_Matricules : tous les numeros de MG presents dans
 *              la base du site, avec identite + source.
 *           C'est la reponse a "quels matricules sont dans leur base ?".
 *
 *  Phase 2  mgCompleterFiches()   1 requete GET /mg.php par numero (OPTIONNEL)
 *           -> feuille MG_Fiches : origine, naissance, arrivee, convoi,
 *              immatriculation, notes, contributeur, releveur.
 *           A la cadence du site (~6 s/requete) c'est plusieurs jours pour
 *           ~50 000 numeros : a reserver aux numeros qui t'interessent
 *           vraiment (voir le parametre `filtre`).
 *
 *  Apps Script coupe une execution a 6 min : les deux phases sauvegardent
 *  leur avancement et se replanifient toutes seules par declencheur.
 * ============================================================================
 */

/* ================================================================= reseau */

/** Delai mini entre deux requetes sortantes (le site repond deja en ~6 s). */
function mgThrottle_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('MG_LAST_CALL') || 0);
  var wait = MG_CFG.MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) Utilities.sleep(wait);
  props.setProperty('MG_LAST_CALL', String(Date.now()));
}

/**
 * Requete HTTP avec politesse et reprise sur erreur serveur.
 * @return {string} le HTML (UTF-8)
 */
function mgFetch_(url, options) {
  options = options || {};
  var params = {
    method: options.method || 'get',
    headers: {
      'User-Agent': MG_CFG.USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    },
    followRedirects: true,
    muteHttpExceptions: true
  };
  if (options.payload) params.payload = options.payload;   // objet -> urlencoded

  var derniere = null;
  for (var essai = 1; essai <= MG_CFG.MAX_RETRY; essai++) {
    mgThrottle_();
    try {
      var res = UrlFetchApp.fetch(url, params);
      var code = res.getResponseCode();
      if (code === 200) return res.getContentText('UTF-8');
      if (code >= 400 && code < 500 && code !== 429) {
        throw new Error('HTTP ' + code + ' sur ' + url);   // inutile de reessayer
      }
      derniere = new Error('HTTP ' + code + ' sur ' + url);
    } catch (e) {
      derniere = e;
    }
    if (essai < MG_CFG.MAX_RETRY) Utilities.sleep(MG_CFG.RETRY_BACKOFF_MS * essai);
  }
  throw derniere || new Error('Echec de la requete : ' + url);
}

/* ============================================================ API unitaire */

/**
 * Fiche d'un numero de MG.
 * @param {number|string} n  1..130000
 * @param {Object} opts      { sansCache:true } pour ignorer le cache 6 h
 * @return {Object} voir SCHEMA.md
 */
function mgLookup(n, opts) {
  opts = opts || {};
  var num = mgNormaliserNumero(n);
  if (num === null) {
    return {
      ok: false,
      error: 'Numero de MG invalide : ' + n +
             ' (entier attendu entre ' + MG_CFG.MG_MIN + ' et ' + MG_CFG.MG_MAX + ')'
    };
  }

  var cache = CacheService.getScriptCache();
  var cle = 'mgfiche_' + num;
  if (!opts.sansCache) {
    var hit = cache.get(cle);
    if (hit) { var c = JSON.parse(hit); c.cached = true; return c; }
  }

  var url = MG_CFG.BASE + MG_CFG.PATH_MG + '?MgChaine=' + num;
  var out = mgParseFiche(mgFetch_(url), num);
  out.cached = false;

  var str = JSON.stringify(out);
  if (str.length < 95000) cache.put(cle, str, MG_CFG.CACHE_TTL_SEC);
  return out;
}

/**
 * Recherche par identite (POST /patro.php).
 * @param {string} chaine  1 caractere suffit cote serveur (3 mini cote site)
 * @param {Object} opts    { max:n } pour tronquer la sortie JSON
 */
function mgPatro(chaine, opts) {
  opts = opts || {};
  var q = String(chaine || '').trim();
  if (!q) return { ok: false, error: 'Chaine de recherche vide' };

  var html = mgFetch_(MG_CFG.BASE + MG_CFG.PATH_PATRO, {
    method: 'post',
    payload: { PatroChaine: q }
  });

  var r = mgParsePatro(html);
  r.chaine = q;
  if (opts.max && r.lignes.length > opts.max) {
    r.tronque = r.lignes.length;
    r.lignes = r.lignes.slice(0, opts.max);
  }
  return r;
}

/* ================================================================= Sheets */

/**
 * Classeur de destination. Memorise son ID : indispensable, car sous
 * declencheur temporel SpreadsheetApp.getActive() renvoie null.
 */
function mgClasseur_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MG_CLASSEUR_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* recree plus bas */ }
  }
  var actif = null;
  try { actif = SpreadsheetApp.getActive(); } catch (e2) { actif = null; }
  if (!actif) {
    actif = SpreadsheetApp.create('Cherche MG - base des matricules');
    Logger.log('Classeur cree : ' + actif.getUrl());
  }
  props.setProperty('MG_CLASSEUR_ID', actif.getId());
  return actif;
}

/** Force le classeur de destination (utile si tu en veux un precis). */
function mgDefinirClasseur(id) {
  SpreadsheetApp.openById(id);   // leve si l'id est mauvais
  PropertiesService.getScriptProperties().setProperty('MG_CLASSEUR_ID', id);
  return id;
}

/** Feuille par nom, creee avec ses en-tetes si absente. */
function mgFeuille_(nom, entetes) {
  var ss = mgClasseur_();
  var sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    if (entetes) {
      sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/** Toutes les valeurs d'une colonne (hors en-tete), en tableau plat. */
function mgColonne_(sh, colonne) {
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var vals = sh.getRange(2, colonne, n, 1).getValues();
  var out = new Array(n);
  for (var i = 0; i < n; i++) out[i] = vals[i][0];
  return out;
}

/**
 * Ajoute des lignes par paquets.
 * Deux pieges evites : un setValues geant fait exploser le temps d'execution,
 * et une feuille neuve ne fait que 1000 lignes -> il faut l'agrandir AVANT
 * d'ecrire, sinon "range exceeds grid limits".
 */
function mgAjouterLignes_(sh, lignes, nbColonnes) {
  if (!lignes.length) return;

  var debut = sh.getLastRow() + 1;
  var derniere = debut + lignes.length - 1;
  var max = sh.getMaxRows();
  if (derniere > max) sh.insertRowsAfter(max, derniere - max + 1000);

  for (var i = 0; i < lignes.length; i += MG_CFG.TAILLE_LOT) {
    var lot = lignes.slice(i, i + MG_CFG.TAILLE_LOT);
    sh.getRange(debut + i, 1, lot.length, nbColonnes).setValues(lot);
  }
}

/* ====================================================== PHASE 1 : balayage */

/**
 * Lance (ou relance depuis zero) le balayage complet de l'index par identite.
 * Ne vide PAS les feuilles : la deduplication fait que relancer est sans risque.
 *
 * @param {Array<string>} alphabet  facultatif, defaut MG_ALPHABET
 */
function mgDemarrerBalayage(alphabet) {
  var lettres = (alphabet && alphabet.length) ? alphabet.slice() : MG_ALPHABET.slice();
  PropertiesService.getScriptProperties().setProperty('MG_BALAYAGE', JSON.stringify({
    enCours: true,
    restant: lettres,
    faits: [],
    lignesLues: 0,
    nouveauxMg: 0,
    nouveauxSans: 0,
    debut: new Date().toISOString(),
    maj: new Date().toISOString()
  }));
  return mgBalayage();
}

/**
 * Traite les lettres restantes dans le budget de temps imparti, puis se
 * replanifie si besoin. C'est aussi la fonction appelee par le declencheur.
 */
function mgBalayage() {
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  var etat = JSON.parse(props.getProperty('MG_BALAYAGE') || 'null');

  if (!etat || !etat.enCours) {
    Logger.log('Aucun balayage en cours. Lance mgDemarrerBalayage().');
    mgSupprimerDeclencheurs_('mgBalayage');
    return { ok: false, error: 'Aucun balayage en cours' };
  }

  // Si le balayage etait suspendu, son declencheur a ete supprime : cet appel
  // ne peut donc etre que manuel -> on repart avec le compteur d'echecs a zero.
  // Sinon on ne touche PAS a `echecs`, qui doit survivre d'un declencheur au
  // suivant pour que MAX_ECHECS ait un sens.
  if (etat.suspendu) {
    etat.suspendu = false;
    etat.echecs = 0;
    Logger.log('Reprise manuelle apres suspension.');
  }

  var shMg   = mgFeuille_(MG_SHEETS.MATRICULES, MG_ENTETES.MATRICULES);
  var shSans = mgFeuille_(MG_SHEETS.SANS,       MG_ENTETES.SANS);

  // Index de deduplication, charges une fois par execution (colonne "Cle").
  var vusMg   = mgSetDepuisColonne_(shMg,   MG_ENTETES.MATRICULES.length);
  var vusSans = mgSetDepuisColonne_(shSans, MG_ENTETES.SANS.length);

  while (etat.restant.length) {
    if (Date.now() - t0 > MG_CFG.BUDGET_MS) break;

    var lettre = etat.restant[0];
    var r;
    try {
      r = mgPatro(lettre);
      etat.echecs = 0;
    } catch (e) {
      // Le site est momentanement indisponible : on replanifie sans perdre la
      // place. Mais on ne boucle pas indefiniment : au-dela de MAX_ECHECS
      // reprises infructueuses d'affilee, on s'arrete et on laisse la main.
      etat.echecs = (etat.echecs || 0) + 1;
      etat.dernierEchec = String(e);
      Logger.log('Echec %s/%s sur "%s" : %s', etat.echecs, MG_CFG.MAX_ECHECS, lettre, e);

      if (etat.echecs >= MG_CFG.MAX_ECHECS) {
        // Suspendu, pas termine : enCours reste vrai et la file est intacte.
        // Un simple mgBalayage() manuel repart d'ou on en etait.
        etat.suspendu = true;
        props.setProperty('MG_BALAYAGE', JSON.stringify(etat));
        mgSupprimerDeclencheurs_('mgBalayage');
        Logger.log('Balayage SUSPENDU apres %s echecs consecutifs. Relance mgBalayage() ' +
                   'quand le site repond : la place est conservee.', etat.echecs);
      } else {
        props.setProperty('MG_BALAYAGE', JSON.stringify(etat));
        mgPlanifierReprise_('mgBalayage');
      }
      return mgEtatBalayage();
    }

    var lignesMg = [];
    var lignesSans = [];

    for (var i = 0; i < r.lignes.length; i++) {
      var l = r.lignes[i];
      var empreinte = mgHash_(mgNormTexte_(l.patronyme) + '|' + mgNormTexte_(l.source));

      if (l.mg !== null) {
        var cle = l.mg + '-' + empreinte;
        if (vusMg[cle]) continue;
        vusMg[cle] = 1;
        lignesMg.push([l.mg, l.patronyme, l.source, l.sourceUrl, lettre, cle]);
      } else {
        if (vusSans[empreinte]) continue;
        vusSans[empreinte] = 1;
        lignesSans.push([l.patronyme, l.source, l.sourceUrl, lettre, empreinte]);
      }
    }

    if (lignesMg.length)   mgAjouterLignes_(shMg,   lignesMg,   MG_ENTETES.MATRICULES.length);
    if (lignesSans.length) mgAjouterLignes_(shSans, lignesSans, MG_ENTETES.SANS.length);

    etat.restant.shift();
    etat.faits.push(lettre);
    etat.lignesLues   += r.total;
    etat.nouveauxMg   += lignesMg.length;
    etat.nouveauxSans += lignesSans.length;
    etat.maj = new Date().toISOString();
    props.setProperty('MG_BALAYAGE', JSON.stringify(etat));

    Logger.log('"%s" : %s lignes lues, %s MG nouveaux, %s sans-numero nouveaux (reste %s lettres)',
               lettre, r.total, lignesMg.length, lignesSans.length, etat.restant.length);
  }

  if (etat.restant.length) {
    props.setProperty('MG_BALAYAGE', JSON.stringify(etat));
    mgPlanifierReprise_('mgBalayage');
  } else {
    etat.enCours = false;
    etat.fin = new Date().toISOString();
    props.setProperty('MG_BALAYAGE', JSON.stringify(etat));
    mgSupprimerDeclencheurs_('mgBalayage');
    Logger.log('Balayage termine : %s MG enregistres.', mgNombreMatricules());
  }
  return mgEtatBalayage();
}

/** Etat lisible du balayage (pour l'editeur, le menu ou l'API). */
function mgEtatBalayage() {
  var etat = JSON.parse(
    PropertiesService.getScriptProperties().getProperty('MG_BALAYAGE') || 'null'
  );
  if (!etat) return { ok: true, enCours: false, message: 'Jamais lance' };
  return {
    ok: true,
    enCours: !!etat.enCours,
    suspendu: !!etat.suspendu,          // en panne : relancer mgBalayage() a la main
    echecsConsecutifs: etat.echecs || 0,
    dernierEchec: etat.dernierEchec || null,
    lettresFaites: etat.faits,
    lettresRestantes: etat.restant,
    lignesLues: etat.lignesLues,
    lignesEnregistrees: etat.nouveauxMg,
    identitesSansNumero: etat.nouveauxSans,
    matriculesDistincts: mgNombreMatricules(),
    debut: etat.debut,
    maj: etat.maj,
    fin: etat.fin || null
  };
}

/** Arrete le balayage et retire le declencheur. */
function mgArreterBalayage() {
  var props = PropertiesService.getScriptProperties();
  var etat = JSON.parse(props.getProperty('MG_BALAYAGE') || 'null');
  if (etat) {
    etat.enCours = false;
    etat.suspendu = false;
    props.setProperty('MG_BALAYAGE', JSON.stringify(etat));
  }
  mgSupprimerDeclencheurs_('mgBalayage');
  return mgEtatBalayage();
}

/** Nombre de numeros de MG DISTINCTS enregistres. */
function mgNombreMatricules() {
  var sh = mgFeuille_(MG_SHEETS.MATRICULES, MG_ENTETES.MATRICULES);
  var vals = mgColonne_(sh, 1);
  var vus = {};
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v === '' || v === null) continue;
    if (!vus[v]) { vus[v] = 1; n++; }
  }
  return n;
}

/** Set (objet) des cles deja presentes dans la derniere colonne d'une feuille. */
function mgSetDepuisColonne_(sh, colonne) {
  var vals = mgColonne_(sh, colonne);
  var set = {};
  for (var i = 0; i < vals.length; i++) {
    if (vals[i] !== '' && vals[i] !== null) set[vals[i]] = 1;
  }
  return set;
}

/* ================================================ PHASE 2 : fiches detail */

/**
 * Complete MG_Fiches en interrogeant /mg.php numero par numero.
 *
 * ATTENTION : 1 requete = ~6 s cote site. 50 000 numeros = plusieurs jours.
 * Utilise `filtre` pour ne traiter que ce dont tu as besoin.
 *
 * @param {Object} opts
 *   { limite:  nombre max de fiches sur CETTE execution (defaut MAX_FICHES_PAR_RUN)
 *     min:     ne traiter que les MG >= min   (ex. 11000 = serie non ambigue)
 *     max:     ne traiter que les MG <= max
 *     continu: true -> se replanifie jusqu'a epuisement (sinon, un seul lot) }
 */
function mgCompleterFiches(opts) {
  opts = opts || {};
  var t0 = Date.now();
  var limite = Math.min(Number(opts.limite || MG_CFG.MAX_FICHES_PAR_RUN),
                        MG_CFG.MAX_FICHES_PAR_RUN);

  var shMg     = mgFeuille_(MG_SHEETS.MATRICULES, MG_ENTETES.MATRICULES);
  var shFiches = mgFeuille_(MG_SHEETS.FICHES,     MG_ENTETES.FICHES);

  // Numeros a traiter = distincts de MG_Matricules moins ceux deja en MG_Fiches.
  var deja = {};
  var faits = mgColonne_(shFiches, 1);
  for (var i = 0; i < faits.length; i++) if (faits[i] !== '') deja[faits[i]] = 1;

  var tous = mgColonne_(shMg, 1);
  var aFaire = [];
  var vus = {};
  for (var j = 0; j < tous.length; j++) {
    var n = Number(tous[j]);
    if (!n || vus[n] || deja[n]) continue;
    if (opts.min && n < Number(opts.min)) continue;
    if (opts.max && n > Number(opts.max)) continue;
    vus[n] = 1;
    aFaire.push(n);
  }
  aFaire.sort(function (a, b) { return a - b; });

  var lignes = [];
  var traites = 0;
  var horodatage = new Date();

  for (var k = 0; k < aFaire.length && traites < limite; k++) {
    if (Date.now() - t0 > MG_CFG.BUDGET_MS) break;
    var f;
    try {
      f = mgLookup(aFaire[k], { sansCache: false });
    } catch (e) {
      Logger.log('Echec MG %s : %s', aFaire[k], e);
      break;
    }
    if (!f || f.ok === false) { Logger.log('MG %s ignore : %s', aFaire[k], f && f.error); continue; }
    traites++;
    var immat = f.immatriculation || {};
    if (!f.engages || !f.engages.length) {
      // Numero reference dans l'index mais sans fiche : on trace la ligne vide.
      lignes.push([f.mg, '', '', '', '', '', '', '', '', '', '',
                   immat.entre_le || '', immat.et_le || '', horodatage]);
      continue;
    }
    for (var e = 0; e < f.engages.length; e++) {
      var g = f.engages[e];
      lignes.push([g.mg, g.identite, g.origine, g.naissance, g.arrivee, g.convoi,
                   g.immatriculation, g.notes, g.sources, g.contributeur, g.releveur,
                   immat.entre_le || '', immat.et_le || '', horodatage]);
    }
  }

  if (lignes.length) mgAjouterLignes_(shFiches, lignes, MG_ENTETES.FICHES.length);

  var reste = aFaire.length - traites;
  Logger.log('%s fiches recuperees (%s lignes ecrites), reste %s numeros.',
             traites, lignes.length, reste);

  if (opts.continu && reste > 0 && traites > 0) {
    PropertiesService.getScriptProperties()
      .setProperty('MG_FICHES_OPTS', JSON.stringify(opts));
    mgPlanifierReprise_('mgCompleterFichesReprise');
  }
  return { ok: true, traites: traites, lignesEcrites: lignes.length, reste: reste };
}

/** Point d'entree du declencheur de la phase 2 (relit ses options). */
function mgCompleterFichesReprise() {
  var o = PropertiesService.getScriptProperties().getProperty('MG_FICHES_OPTS');
  return mgCompleterFiches(o ? JSON.parse(o) : { continu: true });
}

/* ============================================================ declencheurs */

var MG_FONCTIONS_PLANIFIEES_ = ['mgBalayage', 'mgCompleterFichesReprise'];

/**
 * Replanifie UNE fonction. On ne supprime que ses propres declencheurs :
 * les deux phases peuvent tourner en meme temps sans que l'une decroche
 * la reprise de l'autre.
 */
function mgPlanifierReprise_(nomFonction) {
  mgSupprimerDeclencheurs_(nomFonction);
  ScriptApp.newTrigger(nomFonction)
    .timeBased()
    .after(MG_CFG.TRIGGER_DELAI_MN * 60 * 1000)
    .create();
  Logger.log('Reprise planifiee dans %s min (%s).', MG_CFG.TRIGGER_DELAI_MN, nomFonction);
}

/**
 * Supprime les declencheurs du module.
 * @param {string=} nomFonction  si fourni, ne supprime que ceux-la ;
 *                               sinon, tous ceux du module (arret complet).
 */
function mgSupprimerDeclencheurs_(nomFonction) {
  var cibles = nomFonction ? [nomFonction] : MG_FONCTIONS_PLANIFIEES_;
  var trigs = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trigs.length; i++) {
    if (cibles.indexOf(trigs[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigs[i]);
    }
  }
}
