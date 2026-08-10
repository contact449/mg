/**
 * ============================================================================
 *  CHERCHE-MG - Parser.gs
 *  Extraction du HTML de cherchemg.fr.
 *
 *  Aucun appel reseau ici : toutes les fonctions prennent une chaine HTML.
 *  Elles sont donc testables hors ligne (voir mgTestParser() dans Api.gs).
 *
 *  Regle d'ecriture : ce fichier est ASCII pur. Les libelles accentues du
 *  site ("Numero MG", "Identite", "Arrivee"...) ne sont jamais compares tels
 *  quels : on passe systematiquement par mgNormTexte_() qui desaccentue.
 *  Le parsing survit ainsi a un changement d'accent ou d'encodage.
 * ============================================================================
 */

/* ========================================================== bas niveau HTML */

var MG_ENTITES_NOMMEES_ = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', deg: '\u00b0', laquo: '\u00ab', raquo: '\u00bb',
  eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0', ccedil: '\u00e7',
  copy: '\u00a9', dagger: '\u2020', ndash: '\u2013', mdash: '\u2014',
  rsquo: '\u2019', lsquo: '\u2018'
};

/** Decode les entites HTML (numeriques + les quelques nommees utilisees). */
function mgDecode_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/&#(\d+);/g, function (_, d) {
      return String.fromCharCode(parseInt(d, 10));
    })
    .replace(/&([a-z]+);/gi, function (m, nom) {
      var v = MG_ENTITES_NOMMEES_[nom.toLowerCase()];
      return v === undefined ? m : v;
    });
}

/** HTML -> texte lisible : <br> devient espace, balises supprimees. */
function mgTexte_(html) {
  return mgDecode_(
    String(html === null || html === undefined ? '' : html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

/** Premier href d'un fragment HTML (URL de source), '' si aucun. */
function mgPremierHref_(html) {
  var m = /<a[^>]+href\s*=\s*["']([^"']+)["']/i.exec(String(html || ''));
  return m ? mgDecode_(m[1]) : '';
}

/** Contenu interne de <table id="..."> ... </table>, '' si absente. */
function mgTable_(html, id) {
  var i = String(html || '').indexOf('<table id="' + id + '"');
  if (i === -1) return '';
  var debut = html.indexOf('>', i);
  if (debut === -1) return '';
  var fin = html.indexOf('</table>', debut);
  if (fin === -1) return '';
  return html.slice(debut + 1, fin);
}

/** Lignes <tr> d'une table (contenu interne de chaque tr). */
function mgLignes_(tableHtml) {
  var out = [];
  var re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var m;
  while ((m = re.exec(String(tableHtml || '')))) out.push(m[1]);
  return out;
}

/** Cellules <td>/<th> d'une ligne (contenu interne, HTML conserve). */
function mgCellules_(trHtml) {
  var out = [];
  var re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  var m;
  while ((m = re.exec(String(trHtml || '')))) out.push(m[1]);
  return out;
}

/**
 * Bloc "<b>Libelle :</b> valeur<br/><b>Libelle :</b> valeur..." -> objet.
 *
 * @param {string} blocHtml  contenu d'un <td>
 * @param {Object} map       libelle normalise -> nom de propriete
 * @return {{champs:Object, inconnus:Array}} inconnus = libelles hors du map
 */
function mgChampsBloc_(blocHtml, map) {
  var champs = {};
  var inconnus = [];
  var morceaux = String(blocHtml || '').split(/<br\s*\/?>/i);

  for (var i = 0; i < morceaux.length; i++) {
    var m = /^\s*<b>\s*([^<]*?)\s*:?\s*<\/b>([\s\S]*)$/i.exec(morceaux[i]);
    if (!m) continue;
    var libelle = mgNormTexte_(m[1]).replace(/\s*:\s*$/, '');
    var cle = map[libelle];
    if (cle) {
      // Un libelle peut revenir (Sources sur plusieurs lignes) : on concatene.
      var val = mgTexte_(m[2]);
      champs[cle] = champs[cle] ? (champs[cle] + ' | ' + val) : val;
    } else if (libelle) {
      if (inconnus.indexOf(libelle) === -1) inconnus.push(libelle);
    }
  }
  return { champs: champs, inconnus: inconnus };
}

/* ============================================ 1. INDEX PAR IDENTITE (patro) */

/**
 * Parse la reponse de POST /patro.php.
 *
 * Table <table id="anchortableidt"> : 1 ligne d'entete puis N lignes de
 * 3 cellules exactement (verifie : 3571/3571 lignes de donnees pour "sam").
 *
 * @param {string} html
 * @return {{ok:boolean, total:number, avecMg:number, sansMg:number,
 *           lignes:Array, warnings:Array}}
 *   lignes[] = { patronyme, source, sourceUrl, mg }   mg = number|null
 */
function mgParsePatro(html) {
  var warnings = [];
  var table = mgTable_(html, 'anchortableidt');

  if (!table) {
    // Formulaire renvoye sans resultat : soit 0 reponse, soit requete rejetee.
    return {
      ok: true, total: 0, avecMg: 0, sansMg: 0, lignes: [],
      warnings: ['TABLE_ABSENTE']
    };
  }

  var lignes = [];
  var avecMg = 0;
  var ignorees = 0;

  // exec() ligne par ligne : evite de materialiser 34 000 sous-chaines d'un coup.
  var reTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var m;
  while ((m = reTr.exec(table))) {
    var tr = m[1];
    if (/<th[\s>]/i.test(tr)) continue;              // ligne d'entete

    var td = mgCellules_(tr);
    if (td.length !== 3) { ignorees++; continue; }

    var patronyme = mgTexte_(td[0]);
    var mMg = /MgChaine=(\d+)/.exec(td[2]);

    lignes.push({
      patronyme: patronyme,
      source:    mgTexte_(td[1]),
      sourceUrl: mgPremierHref_(td[1]),
      mg:        mMg ? parseInt(mMg[1], 10) : null
    });
    if (mMg) avecMg++;
  }

  if (ignorees) warnings.push('LIGNES_IGNOREES:' + ignorees);
  if (!lignes.length) warnings.push('AUCUNE_LIGNE');

  return {
    ok: true,
    total:  lignes.length,
    avecMg: avecMg,
    sansMg: lignes.length - avecMg,
    lignes: lignes,
    warnings: warnings
  };
}

/* ================================================ 2. FICHE PAR NUMERO (mg) */

/**
 * Parse la reponse de GET /mg.php?MgChaine=n.
 *
 * @param {string} html
 * @param {number} n  numero demande (sert de repli si le HTML ne le redonne pas)
 * @return {Object} voir SCHEMA.md
 */
function mgParseFiche(html, n) {
  html = String(html || '');
  var warnings = [];

  // -- statut ---------------------------------------------------------------
  // Trouve  : <strong id="anchoryouremg">n</strong> + <table id="anchortablemg">
  // Absent  : <div id="anchoryouremg">n ... "pas encore present"
  // Vide    : ni l'un ni l'autre (n=0, chaine non numerique)
  var tableEngages = mgTable_(html, 'anchortablemg');
  var aAncre = /id="anchoryouremg"/.test(html);
  var statut = tableEngages ? 'trouve' : (aAncre ? 'absent' : 'vide');

  var mNum = /id="anchoryouremg"[^>]*>\s*(?:<b>)?\s*(\d+)/.exec(html);
  var mg = mNum ? parseInt(mNum[1], 10) : (mgNormaliserNumero(n) || null);

  // -- engages --------------------------------------------------------------
  var engages = [];
  if (tableEngages) {
    var trs = mgLignes_(tableEngages);
    for (var i = 0; i < trs.length; i++) {
      if (/<th[\s>]/i.test(trs[i])) continue;
      var td = mgCellules_(trs[i]);
      if (!td.length) continue;

      var bloc = mgChampsBloc_(td[0], MG_CHAMPS_FICHE);
      var e = bloc.champs;
      if (bloc.inconnus.length) {
        warnings.push('CHAMP_INCONNU:' + bloc.inconnus.join(','));
      }

      // Attribution des donnees : le site nomme explicitement les proprietaires.
      var mContrib = /Contributeur\s*:\s*<b>([\s\S]*?)<\/b>/i.exec(td[0]);
      var mReleve  = /Releveur\s*:\s*<b>([\s\S]*?)<\/b>/i.exec(td[0]);

      engages.push({
        mg:              e.mg ? parseInt(e.mg, 10) : mg,
        identite:        e.identite || '',
        origine:         e.origine || '',
        naissance:       mgDateSite_(e.naissance),
        annee_naissance: mgAnnee_(e.naissance),
        arrivee:         mgDateSite_(e.arrivee),
        annee_arrivee:   mgAnnee_(e.arrivee),
        convoi:          e.convoi || '',
        immatriculation: mgDateSite_(e.immatriculation),
        notes:           e.notes || '',
        sources:         e.sources || '',
        contributeur:    mContrib ? mgTexte_(mContrib[1]) : '',
        releveur:        mReleve ? mgTexte_(mReleve[1]) : ''
      });
    }
    if (!engages.length) warnings.push('TABLE_ENGAGES_VIDE');
  }

  // -- indices (deduits de la plage du numero, pas de l'engage) -------------
  var out = {
    ok: true,
    mg: mg,
    statut: statut,
    trouve: statut === 'trouve',
    serie_ambigue: mg !== null && mg < MG_CFG.SERIE_PRINCIPALE_MIN,
    nb_engages: engages.length,
    engages: engages,
    immatriculation: mgParseImmat_(html),
    convois: mgParseConvois_(html),
    contexte: mgParseContexte_(html),
    periode_peu_documentee: null,
    url: MG_CFG.BASE + MG_CFG.PATH_MG + '?MgChaine=' + (mg === null ? '' : mg),
    warnings: warnings
  };

  // "...concerne une periode peu documentee (avant 1844-01-28)."
  var mInd = /\((avant|apr[^\s]*)\s+(\d{4}-\d{2}-\d{2})\)/.exec(html);
  if (mInd) {
    out.periode_peu_documentee = {
      sens: /^av/i.test(mInd[1]) ? 'avant' : 'apres',
      date: mInd[2]
    };
  }

  if (mg !== null && engages.length) {
    for (var k = 0; k < engages.length; k++) {
      if (engages[k].mg !== mg) { warnings.push('MG_INCOHERENT:' + engages[k].mg); break; }
    }
  }
  return out;
}

/** Fenetre d'immatriculation : <table id="anchortableimmat">, 3 cellules. */
function mgParseImmat_(html) {
  var t = mgTable_(html, 'anchortableimmat');
  if (!t) return null;
  var trs = mgLignes_(t);
  for (var i = 0; i < trs.length; i++) {
    if (/<th[\s>]/i.test(trs[i])) continue;
    var td = mgCellules_(trs[i]);
    if (td.length < 3) continue;
    // Chaque cellule vaut "<b>Libelle</b><br/>valeur" (libelle SANS deux-points).
    var val = function (cell) {
      var p = String(cell).split(/<br\s*\/?>/i);
      return mgTexte_(p.length > 1 ? p.slice(1).join(' ') : p[0]);
    };
    return { mg: parseInt(val(td[0]), 10) || null, entre_le: val(td[1]), et_le: val(td[2]) };
  }
  return null;
}

/** Convois arrives dans la fenetre : <table id="anchortablecvoy">. */
function mgParseConvois_(html) {
  var t = mgTable_(html, 'anchortablecvoy');
  if (!t) return [];
  var out = [];
  var trs = mgLignes_(t);
  for (var i = 0; i < trs.length; i++) {
    if (/<th[\s>]/i.test(trs[i])) continue;
    var td = mgCellules_(trs[i]);
    if (!td.length) continue;
    var c = mgChampsBloc_(td[0], MG_CHAMPS_CONVOI).champs;
    if (!c.navire && !c.arrivee) continue;
    out.push({
      navire:     c.navire || '',
      arrivee:    mgDateSite_(c.arrivee),
      provenance: c.provenance || '',
      remarques:  c.remarques || '',
      nombre:     c.nombre ? (parseInt(String(c.nombre).replace(/\D/g, ''), 10) || null) : null,
      sources:    c.sources || ''
    });
  }
  return out;
}

/** Histoire contextuelle : <table id="anchortablectxt">. */
function mgParseContexte_(html) {
  var t = mgTable_(html, 'anchortablectxt');
  if (!t) return [];
  var out = [];
  var trs = mgLignes_(t);
  for (var i = 0; i < trs.length; i++) {
    if (/<th[\s>]/i.test(trs[i])) continue;
    var td = mgCellules_(trs[i]);
    if (!td.length) continue;

    // "<b>Periode :</b> D1 <b>a</b> D2<br/><b>Evenement :</b> ...<br/><b>Sources :</b> ..."
    var c = mgChampsBloc_(td[0], { 'periode': 'periode', 'evenement': 'evenement', 'sources': 'sources' }).champs;
    var dates = String(c.periode || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (!c.evenement && !dates.length) continue;
    out.push({
      debut:     dates[0] || '',
      fin:       dates[1] || '',
      evenement: c.evenement || '',
      sources:   c.sources || ''
    });
  }
  return out;
}
