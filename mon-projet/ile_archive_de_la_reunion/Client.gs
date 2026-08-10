/**
 * ============================================================================
 *  IDLR-ARCHIVE API — Client.gs  (v3 — flux confirme)
 *  Session PHP (cookie), throttle, cache.
 *
 *  Flux (fidele au navigateur) :
 *   1. GET  recherche.php?rech={1|3}&code={code}&phonex={0|1}
 *           -> affiche le formulaire, pose le cookie PHPSESSID, fixe le
 *              perimetre (commune/secteur) en session
 *   2. POST recherche.php  (SANS query string) + champs du formulaire
 *           -> resultats page 1 (criteres memorises en session)
 *   3. Pages 2+ / phonetique : GET recherche.php?rech=4&x={offset}&<criteres>
 *           avec le cookie -> la meme mecanique que les liens de pagination
 *
 *  www. impose (le site redirige non-www -> www ; un POST y perdrait son corps).
 * ============================================================================
 */

/** ---------- Throttle ---------- */
function throttle_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('IDLR_LAST_CALL') || 0);
  var wait = CFG.MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) Utilities.sleep(wait);
  props.setProperty('IDLR_LAST_CALL', String(Date.now()));
}

/** ---------- Session / cookies ---------- */
function newSession_() { return { cookies: {} }; }

function absorbCookies_(session, response) {
  var headers = response.getAllHeaders();
  var raw = headers['Set-Cookie'] || headers['set-cookie'];
  if (!raw) return;
  var list = Array.isArray(raw) ? raw : [raw];
  list.forEach(function (line) {
    var kv = String(line).split(';')[0];
    var i = kv.indexOf('=');
    if (i > 0) session.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
}

function cookieHeader_(session) {
  return Object.keys(session.cookies)
    .map(function (k) { return k + '=' + session.cookies[k]; })
    .join('; ');
}

/** ---------- Fetch avec session ---------- */
function fetch_(session, url, options) {
  options = options || {};
  throttle_();

  var headers = {
    'User-Agent': CFG.USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'fr-FR,fr;q=0.9'
  };
  var cookie = cookieHeader_(session);
  if (cookie) headers['Cookie'] = cookie;
  if (options.referer) headers['Referer'] = options.referer;

  var params = {
    method: options.method || 'get',
    headers: headers,
    followRedirects: true,
    muteHttpExceptions: true
  };
  if (options.payload) params.payload = options.payload;  // objet -> form-urlencoded

  var res = UrlFetchApp.fetch(url, params);
  absorbCookies_(session, res);

  var code = res.getResponseCode();
  if (code >= 400) throw new Error('HTTP ' + code + ' sur ' + url);

  var html;
  try {
    html = res.getContentText('UTF-8');
    if (/\u00c3\u00a9|\u00c3\u00a8/.test(html)) html = res.getContentText('ISO-8859-1');
  } catch (e) {
    html = res.getContentText();
  }
  return html;
}

/** ---------- Perimetre ---------- */
function resolveScope_(q) {
  if (q.secteur) {
    var s = findSecteur(q.secteur);
    if (!s) throw new Error('Secteur inconnu : ' + q.secteur + ' (attendus : ' + SECTEURS.join(', ') + ')');
    return { rech: 3, code: s.codeSecteur, phonex: q.phonex ? 1 : 0, label: s.secteur, type: 'secteur' };
  }
  if (q.commune) {
    var c = findCommune(q.commune);
    if (!c) throw new Error('Commune inconnue : ' + q.commune);
    return { rech: 1, code: c.code, phonex: q.phonex ? 1 : 0, label: c.nom, type: 'commune' };
  }
  throw new Error("Precise 'commune' ou 'secteur'.");
}

function buildFormUrl_(scope) {
  return CFG.BASE + CFG.PATH + '?rech=' + scope.rech + '&code=' + scope.code + '&phonex=' + scope.phonex;
}

/** Type d'acte unique (radio cote site) ; defaut N comme le formulaire. */
function resolveType_(q) {
  var t = String(q.type || q.typeActe || 'N').split(',')[0].trim().toUpperCase();
  return VALUE_MAP.acte[t] ? t : 'N';
}

/** URL GET rech=4 (pagination / phonetique), tous criteres inclus. */
function buildSearchGetUrl_(scope, q, x) {
  var p = {
    x: x || 0,
    rech: 4,
    choix: VALUE_MAP.choix[q.mode || 'contient'] || '1',
    nom: q.nom || '',
    s: VALUE_MAP.sexe[q.sexe || 'T'] || 'T',
    ta: resolveType_(q),
    code: scope.code,
    prenom: q.prenom || '',
    mere: q.mere || q.nomMere || '',
    ordre: VALUE_MAP.ordre[q.ordre || 'chrono'] || 'chrono',
    dateinf: q.anneeMin || '',
    datesup: q.anneeMax || '',
    phonex: scope.phonex
  };
  var qs = Object.keys(p).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
  }).join('&');
  return CFG.BASE + CFG.PATH + '?' + qs;
}

/**
 * Payload du POST :
 *  1) reprend les champs du <form> charge (defauts radios + hidden eventuels)
 *  2) ecrase avec les criteres demandes
 */
function buildPayload_(formHtml, q) {
  var payload = {};

  if (CFG.AUTO_FORM_DEFAULTS && formHtml) {
    parseFormFields(formHtml).fields.forEach(function (f) {
      if (f.type === 'radio') { if (f.checked) payload[f.name] = f.value; }
      else if (f.type === 'checkbox') { if (f.checked) payload[f.name] = f.value || 'on'; }
      else if (f.type === 'hidden') { payload[f.name] = f.value || ''; }
      else if (f.type !== 'submit' && f.type !== 'button' && f.type !== 'image') {
        payload[f.name] = f.value || '';
      }
    });
  }

  function set(logical, value) {
    var name = FIELD_MAP[logical];
    if (name) payload[name] = (value === undefined || value === null) ? '' : value;
  }

  set('nom',      q.nom || '');
  set('prenom',   q.prenom || '');
  set('mere',     q.mere || q.nomMere || '');
  set('anneeMin', q.anneeMin || '');
  set('anneeMax', q.anneeMax || '');
  set('choix',    VALUE_MAP.choix[q.mode || 'contient'] || '1');
  set('ordre',    VALUE_MAP.ordre[q.ordre || 'chrono'] || 'chrono');
  set('sexe',     VALUE_MAP.sexe[q.sexe || 'T'] || 'T');
  set('typeActe', resolveType_(q));

  return payload;
}

/** Recupere une page (index 0-based) via GET rech=4. */
function fetchPage_(session, scope, q, pageIndex, referer) {
  var url = buildSearchGetUrl_(scope, q, pageIndex * CFG.PAGE_SIZE);
  return parseResultsPage(fetch_(session, url, { referer: referer }), CFG.BASE);
}

/**
 * RECHERCHE PRINCIPALE.
 * @param {Object} q { commune|secteur, nom, prenom, mere, anneeMin, anneeMax,
 *                     mode, ordre, sexe, type, phonex, page, allPages }
 */
function search(q) {
  q = q || {};
  var scope = resolveScope_(q);
  var formUrl = buildFormUrl_(scope);

  var cacheKey = 'idlr_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify([scope, q]))
  );
  var cache = CacheService.getScriptCache();
  var hit = cache.get(cacheKey);
  if (hit) { var c = JSON.parse(hit); c.cached = true; return c; }

  var session = newSession_();

  // 1) GET du formulaire -> cookie + perimetre en session
  var formHtml = fetch_(session, formUrl);

  // 2) POST des criteres -> resultats page 1 (criteres memorises en session)
  var payload = buildPayload_(formHtml, q);
  var html = fetch_(session, CFG.BASE + CFG.PATH, { method: 'post', payload: payload, referer: formUrl });
  var data = parseResultsPage(html, CFG.BASE);

  if (data.isForm) {
    throw new Error(
      "Le site a renvoye le formulaire au lieu des resultats. Verifie : (a) que le " +
      "perimetre existe, (b) le cookie de session, (c) FIELD_MAP. Utilise debugSearch(q) " +
      "pour voir le HTML brut renvoye."
    );
  }

  var pageSize = CFG.PAGE_SIZE;
  var totalPages = data.total ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  // 3) phonetique demandee -> rejoue page 1 en phonex=1 (mecanique du site)
  if (scope.phonex) {
    var ph = fetchPage_(session, scope, q, 0, formUrl);
    if (!ph.isForm) { data = ph; totalPages = data.total ? Math.max(1, Math.ceil(data.total / pageSize)) : totalPages; }
  }

  // 3bis) page precise > 1
  var wantedPage = Math.max(1, Number(q.page || 1));
  if (!(String(q.allPages) === '1' || q.allPages === true) && wantedPage > 1) {
    var pg = fetchPage_(session, scope, q, wantedPage - 1, formUrl);
    if (!pg.isForm) data = pg;
  }

  // 3ter) toutes les pages (plafonne par MAX_PAGES)
  var results = data.results.slice();
  if (String(q.allPages) === '1' || q.allPages === true) {
    var lastPage = Math.min(totalPages, CFG.MAX_PAGES);
    for (var pageIdx = 1; pageIdx < lastPage; pageIdx++) {
      var extra = fetchPage_(session, scope, q, pageIdx, formUrl);
      if (extra.isForm) break;
      results = results.concat(extra.results);
      extra.warnings.forEach(function (w) { if (data.warnings.indexOf(w) === -1) data.warnings.push(w); });
    }
    data.pagination.fetchedAllPages = (lastPage >= totalPages);
    if (totalPages > CFG.MAX_PAGES) data.warnings.push('MAX_PAGES:' + totalPages + '>' + CFG.MAX_PAGES);
  }

  var out = {
    ok: true,
    source: 'iledelareunion-archive.com (association Arbre)',
    scope: { type: scope.type, label: scope.label, code: scope.code, phonex: scope.phonex },
    query: {
      nom: q.nom || '', prenom: q.prenom || '', mere: q.mere || q.nomMere || '',
      mode: q.mode || 'contient', sexe: q.sexe || 'T', type: resolveType_(q),
      anneeMin: q.anneeMin || '', anneeMax: q.anneeMax || '', ordre: q.ordre || 'chrono'
    },
    stats: data.scope,
    criteria: data.criteria,
    total: data.total,
    count: results.length,
    page: (String(q.allPages) === '1' || q.allPages === true) ? null : Math.max(1, Number(q.page || 1)),
    totalPages: totalPages,
    layouts: data.layouts,
    warnings: data.warnings,
    results: results,
    cached: false
  };

  var str = JSON.stringify(out);
  if (str.length < 95000) cache.put(cacheKey, str, CFG.CACHE_TTL_SEC);
  return out;
}

/** Debug : renvoie le HTML brut de la reponse POST (pour diagnostiquer un souci). */
function debugSearch(q) {
  q = q || {};
  var scope = resolveScope_(q);
  var formUrl = buildFormUrl_(scope);
  var session = newSession_();
  var formHtml = fetch_(session, formUrl);
  var payload = buildPayload_(formHtml, q);
  var html = fetch_(session, CFG.BASE + CFG.PATH, { method: 'post', payload: payload, referer: formUrl });
  Logger.log('FORM URL : ' + formUrl);
  Logger.log('COOKIES  : ' + cookieHeader_(session));
  Logger.log('PAYLOAD  : ' + JSON.stringify(payload));
  Logger.log('HTML len : ' + html.length);
  Logger.log(html.slice(0, 4000));
  return html;
}
