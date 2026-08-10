/**
 * ============================================================================
 *  IDLR-ARCHIVE API — Api.gs
 *  Endpoint JSON (Web App) + outils de diagnostic.
 *
 *  DEPLOIEMENT : Deployer > Nouveau deploiement > Application Web
 *                Executer en tant que : moi
 *                Acces : Anyone (si appel depuis une PWA) ou selon besoin
 * ============================================================================
 */

/* ------------------------------------------------------------- diagnostics */

/** Verifie que les name= du formulaire n'ont pas change (les vrais sont deja dans Config.gs). */
function inspectForm(code, rech) {
  code = code || '9741220';
  rech = rech || 1;
  var session = newSession_();
  var url = CFG.BASE + CFG.PATH + '?rech=' + rech + '&code=' + code + '&phonex=0';
  var form = parseFormFields(fetch_(session, url));
  Logger.log('URL        : ' + url);
  Logger.log('action     : ' + form.action + ' | method: ' + form.method.toUpperCase());
  form.fields.forEach(function (f) {
    Logger.log('  [%s] name="%s" value="%s"%s', f.type, f.name, f.value || '', f.checked ? ' CHECKED' : '');
  });
  return form;
}

/** Test rapide dans l'editeur. */
function testSearch() {
  var r = search({ secteur: 'CINOR', nom: 'Kichenin', sexe: 'M', type: 'N', anneeMax: 1951 });
  Logger.log('total: %s | ramenes: %s | pages: %s', r.total, r.count, r.totalPages);
  Logger.log(JSON.stringify(r.results.slice(0, 3), null, 2));
  return r;
}

function testCommunes() { Logger.log(JSON.stringify(COMMUNES, null, 2)); }

/* ---------------------------------------------------------------- endpoint */

/**
 *  GET .../exec?action=communes
 *  GET .../exec?action=search&commune=Sainte-Suzanne&nom=HOARAU&type=N&anneeMin=1900
 *  GET .../exec?action=search&secteur=CINOR&nom=Kichenin&sexe=M&type=D&anneeMax=1951
 *
 *  Params search :
 *    commune | secteur        perimetre (obligatoire, l'un des deux)
 *    nom, prenom, mere        textes (nom : min 2 lettres, '??' = illisible)
 *    mode   = contient | commence | termine | exact
 *    sexe   = M | F | T
 *    type   = N | D | M | PM | DIV   (UN SEUL par recherche)
 *    anneeMin, anneeMax
 *    ordre  = chrono | alpha
 *    phonex = 0 | 1                  (orthographe approchante)
 *    page   = n                      (50 actes/page)
 *    allPages = 1                    (plafonne par CFG.MAX_PAGES)
 *    key    = ta cle si CFG.API_KEY est renseignee
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (CFG.API_KEY && p.key !== CFG.API_KEY) {
      return json_({ ok: false, error: 'Cle API invalide' });
    }

    switch (p.action || 'search') {

      case 'communes':
        return json_({
          ok: true,
          count: COMMUNES.length,
          secteurs: SECTEURS,
          types_acte: TYPES_ACTE,
          communes: COMMUNES
        });

      case 'inspect':
        return json_({ ok: true, form: inspectForm(p.code, p.rech) });

      case 'search':
        return json_(search({
          commune:  p.commune,
          secteur:  p.secteur,
          nom:      p.nom,
          prenom:   p.prenom,
          mere:     p.mere || p.nomMere,
          mode:     p.mode,
          sexe:     p.sexe,
          type:     p.type,
          anneeMin: p.anneeMin,
          anneeMax: p.anneeMax,
          ordre:    p.ordre,
          phonex:   p.phonex,
          page:     p.page,
          allPages: p.allPages
        }));

      default:
        return json_({ ok: false, error: 'action inconnue : ' + p.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
