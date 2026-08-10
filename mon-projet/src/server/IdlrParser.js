/**
 * ============================================================================
 *  IDLR-ARCHIVE API — Parser.gs  (v3)
 *  HTML de /recherche.php -> JSON structure.
 *
 *  Valide sur 3 VRAIES pages : Deces, Naissance, Mariage.
 *
 *  Le tableau change selon le type d'acte :
 *   - Naissance : Commune Date Nom Prenom Sexe [pere +] [mere +] Parrain Marraine Obs Photo
 *   - Deces     : Commune Date Nom Prenom Sexe Age [pere +] [mere +] Origine Obs Photo
 *   - Mariage   : Commune Date <PERS.1> <PERS.2 "Conjoint"> Obs Photo
 *       chaque personne = Nom Prenom Age Date° [+ pere] Prenom-pere Nom-mere Prenom-mere [+ mere] Origine
 *       ATTENTION : seule une partie des colonnes de la 2e personne porte le
 *       suffixe "Conjoint" (Nom/Prenom/parents). Age, Date°, +, Origine ne
 *       l'ont PAS -> impossible de grouper par libelle.
 *
 *  => GROUPEMENT POSITIONNEL : chaque colonne "Nom" (nue) ouvre une personne ;
 *     toutes les colonnes suivantes lui appartiennent jusqu'a la personne
 *     suivante ou aux colonnes de queue (Obs, N° de photo).
 *
 *  Colonnes particulieres :
 *   - "Date°"  = date de naissance de la personne (le ° = ne). Slug = "date"
 *                comme la Date de l'acte -> gere par le flag hasDegree.
 *   - "+"      = parent decede. 1er + du bloc = pere, 2e + = mere (ordinal).
 *   - "Nom ... Conjoint" = 2e personne.
 *
 *  Garanties :
 *   - schema de sortie IDENTIQUE quel que soit le type d'acte
 *   - `raw` conserve toutes les cellules (rien perdu si un layout surprend)
 *   - `warnings[]` -> jamais d'echec silencieux
 * ============================================================================
 */

/* ------------------------------------------------------------- utilitaires */

function decodeEntities_(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&deg;/gi, '\u00b0')
    .replace(/&#0*176;/g, '\u00b0')
    .replace(/&#x0*b0;/gi, '\u00b0');
}

function cleanCell_(html) {
  return decodeEntities_(
    String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

function slug_(label) {
  return String(label)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Toutes les tables, imbriquees comprises (pile, tolerant aux </table> orphelins). */
function findTables_(html) {
  var re = /<\/?table\b[^>]*>/gi, stack = [], tables = [], m;
  while ((m = re.exec(html)) !== null) {
    if (m[0][1] !== '/') stack.push(m.index);
    else { var s = stack.pop(); if (s !== undefined) tables.push(html.slice(s, m.index + m[0].length)); }
  }
  return tables;
}

function getRows_(tableHtml) {
  var rows = [], re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, m;
  while ((m = re.exec(tableHtml)) !== null) rows.push(m[1]);
  return rows;
}

/** Cellules AVEC attributs (colspan/rowspan) : indispensable pour les en-tetes a etages. */
function getCellsEx_(rowHtml) {
  var out = [], re = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, m;
  while ((m = re.exec(rowHtml)) !== null) {
    var attrs = m[2] || '';
    out.push({
      tag: m[1].toLowerCase(),
      html: m[3],
      text: cleanCell_(m[3]),
      colspan: parseInt((attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [, 1])[1], 10) || 1,
      rowspan: parseInt((attrs.match(/rowspan\s*=\s*["']?(\d+)/i) || [, 1])[1], 10) || 1
    });
  }
  return out;
}

function getCells_(rowHtml, raw) {
  return getCellsEx_(rowHtml).map(function (c) { return raw ? c.html : c.text; });
}

function setPath_(obj, path, value) {
  var parts = path.split('.'), cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function setRaw_(raw, key, val) {
  if (raw[key] === undefined) { raw[key] = val; return; }
  var n = 2;
  while (raw[key + '_' + n] !== undefined) n++;
  raw[key + '_' + n] = val;
}

/** Role (epoux/epouse/conjoint) depuis un libelle ou un groupe d'en-tete. */
function roleOf_(text) {
  var t = slug_(text);
  if (!t) return '';
  if (/conjoint/.test(t)) return 'conjoint';
  if (/epouse|femme/.test(t)) return 'epouse';
  if (/epoux|^mari$|^mari_/.test(t)) return 'epoux';
  return '';
}

/** Retire la mention de role d'un libelle pour garder le champ nu. */
function stripRole_(label) {
  return String(label)
    .replace(/\bconjoint\b/gi, '')
    .replace(/\b(de\s+l['\u2019]?\s*)?[e\u00e9]pou(x|se)\b/gi, '')
    .replace(/\bfemme\b|\bmari\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------------------------------------------- en-tete */

function analyzeHeader_(rows) {
  return {
    labels: getCellsEx_(rows[0]).map(function (c) { return c.text; }),
    dataStart: 1
  };
}

/* --------------------------------------- plan de colonnes (positionnel) */

/**
 * Construit le plan des colonnes d'un tableau d'actes.
 * Chaque colonne recoit : scope ('top'|'person'), personIndex, field (chemin).
 * Une nouvelle personne s'ouvre a chaque colonne "Nom" nue.
 * @return {{cols:Object[], persons:Object[], warnings:string[]}}
 */
function analyzeActesColumns_(labels) {
  var cols = [], persons = [], warnings = [];
  var curPerson = -1, sawActeDate = false;

  for (var i = 0; i < labels.length; i++) {
    var label = String(labels[i] || '');
    var hasDegree = label.indexOf('\u00b0') >= 0;
    var isPlus = label.replace(/\s+/g, '') === '+';
    var role = roleOf_(label);
    var base = slug_(stripRole_(label));

    var col = {
      index: i, label: label, role: role, base: base,
      hasDegree: hasDegree, isPlus: isPlus,
      scope: '', personIndex: -1, field: ''
    };

    // ---- colonnes de tete (frame de l'acte) ----
    if (!isPlus && base === 'commune') { col.scope = 'top'; col.field = 'commune'; cols.push(col); continue; }
    if (!isPlus && base === 'date' && !hasDegree && !sawActeDate) {
      col.scope = 'top'; col.field = 'date'; sawActeDate = true; cols.push(col); continue;
    }
    if (!isPlus && (base === 'obs' || base === 'observation' || base === 'observations')) {
      col.scope = 'top'; col.field = 'obs'; cols.push(col); continue;
    }
    if (!isPlus && /^n_?(de_)?photo$|^numero$|^n_photo$|^no_de_photo$/.test(base)) {
      col.scope = 'top'; col.field = 'numero'; cols.push(col); continue;
    }

    // ---- ouverture d'une personne : colonne "Nom" nue ----
    if (base === 'nom') {
      curPerson++;
      var r = role || (curPerson === 0 ? 'principal' : (curPerson === 1 ? 'conjoint' : 'personne' + (curPerson + 1)));
      persons.push({ index: curPerson, role: r, plusCount: 0 });
      col.scope = 'person'; col.personIndex = curPerson; col.field = 'nom';
      cols.push(col); continue;
    }

    // ---- colonne hors personne (avant le 1er "Nom") ----
    if (curPerson < 0) {
      col.scope = 'top'; col.field = 'autres:' + (base || ('col' + i));
      cols.push(col); continue;
    }

    // ---- colonne appartenant a la personne courante ----
    col.scope = 'person'; col.personIndex = curPerson;
    var p = persons[curPerson];

    if (isPlus) {
      p.plusCount++;
      if (p.plusCount === 1) col.field = 'pere.decede';
      else if (p.plusCount === 2) col.field = 'mere.decede';
      else col.field = 'autres:deces_' + p.plusCount;
    } else if (base === 'date' && hasDegree) { col.field = 'date_naissance'; }
    else if (base === 'prenom' || base === 'prenoms') { col.field = 'prenom'; }
    else if (base === 'sexe') { col.field = 'sexe'; }
    else if (base === 'age') { col.field = 'age'; }
    else if (base === 'profession') { col.field = 'profession'; }
    else if (base === 'prenom_du_pere') { col.field = 'pere.prenom'; }
    else if (base === 'nom_du_pere') { col.field = 'pere.nom'; }
    else if (base === 'nom_de_la_mere') { col.field = 'mere.nom'; }
    else if (base === 'prenom_de_la_mere') { col.field = 'mere.prenom'; }
    else if (base === 'origine') { col.field = 'origine'; }
    else if (base === 'parrain') { col.field = 'parrain'; }
    else if (base === 'marraine') { col.field = 'marraine'; }
    else { col.field = 'autres:' + (base || ('col' + i)); }

    cols.push(col);
  }

  persons.forEach(function (p) {
    if (p.plusCount !== 0 && p.plusCount !== 2) warnings.push('PLUS_COUNT:' + p.role + '=' + p.plusCount);
  });
  if (!persons.length) warnings.push('NO_PERSON_COLUMN');

  return { cols: cols, persons: persons, warnings: warnings };
}

/* ------------------------------------------ construction d'un enregistrement */

function isoDate_(s) {
  var m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? (m[3] + '-' + m[2] + '-' + m[1]) : '';
}

function buildRecordFromCols_(cells, plan, baseUrl, criteria, warnings) {
  var rec = {
    type_acte: '', type_acte_libelle: '',
    commune: '', date: '', date_iso: '', annee: null,
    obs: '', numero: '', url_demande_photo: '',
    personnes: {}, raw: {}
  };
  plan.persons.forEach(function (p) { rec.personnes[p.role] = { role: p.role, pere: {}, mere: {} }; });

  if (cells.length !== plan.cols.length) {
    warnings.push('ROW_WIDTH:' + cells.length + '/' + plan.cols.length);
  }

  var photoUrl = '', typeActe = '';

  for (var i = 0; i < plan.cols.length; i++) {
    var col = plan.cols[i];
    var cell = cells[i];
    if (!cell) continue;

    var val = cell.text;

    var a = cell.html.match(/href=["']([^"']*rech=12[^"']*)["']/i);
    if (a) {
      var href = decodeEntities_(a[1]);
      photoUrl = /^https?:/i.test(href) ? href : baseUrl + '/' + href.replace(/^\//, '');
      var t = href.match(/[?&]TypeActe=([^&]*)/i);
      if (t) typeActe = decodeURIComponent(t[1]);
    }

    var isDeces = /\.decede$/.test(col.field);
    var value = isDeces ? (val.indexOf('+') !== -1) : val;

    if (col.scope === 'top') {
      if (col.field.indexOf('autres:') === 0) {
        var kt = col.field.slice(7);
        if (!rec.autres) rec.autres = {};
        rec.autres[kt] = value;
        setRaw_(rec.raw, 'top.' + kt, value);
      } else {
        rec[col.field] = value;
        setRaw_(rec.raw, col.field, value);
      }
    } else {
      var role = plan.persons[col.personIndex].role;
      var person = rec.personnes[role];
      if (col.field.indexOf('autres:') === 0) {
        var kp = col.field.slice(7);
        if (!person.autres) person.autres = {};
        person.autres[kp] = value;
        setRaw_(rec.raw, role + '.autres.' + kp, value);
      } else {
        setPath_(person, col.field, value);
        setRaw_(rec.raw, role + '.' + col.field, value);
      }
    }
  }

  rec.url_demande_photo = photoUrl;
  rec.type_acte = typeActe || (criteria && criteria.type_d_acte) || '';
  rec.type_acte_libelle = TYPES_ACTE[rec.type_acte] || rec.type_acte;

  rec.date_iso = isoDate_(rec.date);
  if (rec.date_iso) rec.annee = Number(rec.date_iso.slice(0, 4));
  else {
    var y = String(rec.date || '').match(/(\d{4})\s*$/);
    if (y) rec.annee = Number(y[1]);
  }

  // date de naissance -> ISO par personne
  Object.keys(rec.personnes).forEach(function (role) {
    var dn = rec.personnes[role].date_naissance;
    if (dn) {
      var iso = isoDate_(dn);
      if (iso) rec.personnes[role].date_naissance_iso = iso;
    }
  });

  return rec;
}

/* --------------------------------------------- parsing d'un tableau d'actes */

function isActesTable_(tableHtml) {
  var rows = getRows_(tableHtml);
  if (!rows.length) return false;
  var h = analyzeHeader_(rows);
  var L = h.labels.map(slug_);
  return L.indexOf('commune') !== -1 &&
         L.indexOf('date') !== -1 &&
         L.some(function (x) { return x === 'nom'; });
}

function parseActesTable_(tableHtml, baseUrl, criteria, warnings) {
  var rows = getRows_(tableHtml);
  var h = analyzeHeader_(rows);
  var plan = analyzeActesColumns_(h.labels);
  plan.warnings.forEach(function (w) { if (warnings.indexOf(w) === -1) warnings.push(w); });

  var records = [];
  for (var r = h.dataStart; r < rows.length; r++) {
    var cells = getCellsEx_(rows[r]);
    if (!cells.length) continue;
    records.push(buildRecordFromCols_(cells, plan, baseUrl, criteria, warnings));
  }

  var fields = plan.cols.map(function (c) {
    return c.scope === 'person'
      ? (plan.persons[c.personIndex].role + '.' + c.field)
      : c.field;
  });

  return {
    columns: h.labels,
    persons: plan.persons.map(function (p) { return p.role; }),
    fields: fields,
    records: records
  };
}

/* ------------------------------------------------------------ page complete */

function parseResultsPage(html, baseUrl) {
  baseUrl = (baseUrl || CFG.BASE).replace(/\/$/, '');
  var tables = findTables_(html);
  var warnings = [];

  var out = {
    scope: {}, criteria: {}, total: 0,
    layouts: [], results: [],
    pagination: { current: 1, pages: [], links: {} },
    warnings: warnings,
    isForm: false
  };

  // --- stats globales (Secteur/Commune + compteurs N/M/D/PM/DIV) ---
  for (var i = 0; i < tables.length; i++) {
    var rws = getRows_(tables[i]);
    if (!rws.length) continue;
    var labs = getCells_(rws[0]);
    if (labs.some(function (l) { return /^Nombre d'Actes\s*:/i.test(l); })) {
      labs.forEach(function (l) {
        var m = l.match(/^([^:]+?)\s*:\s*(.+)$/);
        if (m) { var v = m[2].trim(); out.scope[slug_(m[1])] = /^\d+$/.test(v) ? Number(v) : v; }
      });
      break;
    }
  }

  // --- recap des criteres + nombre d'actes trouves ---
  var recap = null;
  for (var j = 0; j < tables.length; j++) {
    var rw = getRows_(tables[j]);
    if (!rw.length) continue;
    var hl = getCells_(rw[0]);
    if (hl.indexOf("Type d'acte") !== -1 && hl.indexOf('Ordre') !== -1) { recap = tables[j]; break; }
  }
  if (recap) {
    var rr = getRows_(recap);
    var rl = getCells_(rr[0]), rv = rr[1] ? getCells_(rr[1]) : [];
    for (var k = 1; k < rl.length; k++) out.criteria[slug_(rl[k])] = rv[k] !== undefined ? rv[k] : '';
    var n = out.criteria['nombre_d_actes'];
    out.total = n ? (parseInt(String(n).replace(/\D/g, ''), 10) || 0) : 0;
  }

  // --- TOUS les tableaux d'actes ---
  var found = 0;
  tables.forEach(function (t) {
    if (!isActesTable_(t)) return;
    found++;
    var parsed = parseActesTable_(t, baseUrl, out.criteria, warnings);
    out.layouts.push({
      columns: parsed.columns,
      persons: parsed.persons,
      fields: parsed.fields,
      count: parsed.records.length
    });
    out.results = out.results.concat(parsed.records);
  });

  if (!found) {
    out.isForm = !recap && /Entrer le Nom/i.test(html);
    return out;
  }

  // --- pagination ---
  for (var p = 0; p < tables.length; p++) {
    var t2 = tables[p];
    if (!/page\(s\)/i.test(t2) || /rech=12/i.test(t2)) continue;
    var cur = t2.match(/<font[^>]*rouge[^>]*>\s*(\d+)\s*<\/font>/i);
    if (cur) out.pagination.current = Number(cur[1]);
    var reA = /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*(\d+)\s*<\/a>/gi, ma;
    while ((ma = reA.exec(t2)) !== null) {
      out.pagination.pages.push(Number(ma[2]));
      out.pagination.links[ma[2]] = decodeEntities_(ma[1]);
    }
    break;
  }
  out.pagination.pages.push(out.pagination.current);
  out.pagination.pages = out.pagination.pages
    .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
    .sort(function (a, b) { return a - b; });

  // --- coherence : total annonce vs actes parses (1 seule page) ---
  if (out.total && out.pagination.pages.length === 1 && out.results.length !== out.total) {
    warnings.push('COUNT_MISMATCH:' + out.results.length + '/' + out.total);
  }

  return out;
}

