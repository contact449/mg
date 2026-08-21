#!/usr/bin/env node
/**
 * ============================================================================
 *  RECHERCHE DES ENGAGES — l'ecran « Rechercher un engage… », hors de Sheets.
 *
 *  Le module Apps Script sait deja chercher : c'est Engages.gs, servi dans une
 *  fenetre modale du classeur. Il lui faut un classeur, un compte Google et un
 *  import prealable. Sur le VPS, ou pendant le developpement, on a le CSV sous
 *  la main et pas le classeur — d'ou cette page, sur le meme modele que
 *  search.cjs (Archives, port 8091) et recherche.cjs (croisement, port 8093).
 *
 *  LE MOTEUR N'EST PAS REECRIT.
 *
 *  Engages.js est une copie conforme de ../Engages.gs, chargee dans un
 *  contexte vm comme Config.js et Parser.js le sont pour le moissonneur.
 *  `mgRechercherEngages()` s'execute donc ICI, inchange : la seule piece
 *  fournie par Node est `mgLireEngages_()`, qui rend les lignes du CSV la ou
 *  Apps Script rendait celles de la feuille.
 *
 *  Consequence : les deux ecrans ne peuvent pas diverger. Un filtre corrige
 *  dans Engages.gs l'est des deux cotes, et le selftest refuse de passer si la
 *  copie a derive. Pour resynchroniser apres une evolution du module :
 *      cp ../Engages.gs Engages.js && cp ../Config.gs Config.js
 *
 *  SOURCES, dans cet ordre — la premiere presente gagne
 *      MG_ENGAGES  ou  ../engages.csv          10 colonnes, releve curate
 *      MG_FICHES   ou  mg_fiches.csv           15 colonnes, phase 2
 *      MG_OUT      ou  mg_matricules.csv        4 colonnes, l'index seul
 *  Les colonnes sont reconnues par leur NOM : les trois formats passent sans
 *  aucun reglage, une colonne absente est ignoree, une colonne inconnue est
 *  affichee quand meme.
 *
 *  Lancer :  npm run recherche       # puis http://localhost:8094
 *  Reglages (env) : PORT=8094  HOST=0.0.0.0  MG_ENGAGES=...  MG_FICHES=...
 *
 *  Le fichier est relu quand il change (taille ou date), avec un plancher
 *  proportionnel au cout de la lecture — meme regle que search.cjs.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const Env = require('./Env.js');
const { parcourirCsv, ligneCsv } = require('./harvest.cjs');

const PORT = Number(process.env.PORT || 8094);
const HOST = process.env.HOST || '0.0.0.0';

/* ------------------------------------------ moteur Apps Script (via vm) --- */

/**
 * Charge les copies conformes. Config.js apporte la normalisation du texte
 * (sans accent, minuscules) et la lecture des annees ; Engages.js apporte le
 * moteur de recherche et la liste des colonnes affichables.
 */
function chargerMoteur() {
  const ctx = vm.createContext({ console });
  for (const f of ['Config.js', 'Engages.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const MOTEUR = chargerMoteur();
const norm = MOTEUR.mgNormTexte_;

/* ------------------------------------------------------------- source ----- */

/** Le premier fichier existant de la liste, ou null. */
function premierPresent(liste) {
  for (const f of liste) if (f && fs.existsSync(f)) return f;
  return null;
}

/**
 * engages.csv d'abord : c'est le releve curate, celui que l'ecran Sheets
 * importe. mg_fiches.csv le remplace sans rien changer ici (les colonnes sont
 * lues par leur nom), et mg_matricules.csv reste un dernier recours — l'index
 * seul, sans origine ni date, mais mieux qu'une page vide.
 */
const SOURCE = () => premierPresent([
  process.env.MG_ENGAGES,
  path.join(__dirname, '..', 'engages.csv'),
  process.env.MG_FICHES,
  path.join(__dirname, 'mg_fiches.csv'),
  process.env.MG_OUT,
  path.join(__dirname, 'mg_matricules.csv')
]);

/* ---------------------------------------------------------- chargement ---- */

/**
 * Lit le CSV et le presente comme Engages.gs attend une feuille :
 * { entetes, cles, lignes }. Les cles sont les en-tetes normalisees, ce que
 * `mgIndexColonne_` cherche — meme regle que mgLireEngages_ dans Sheets.
 *
 * Les lignes plus courtes que l'en-tete sont completees : un CSV coupe par un
 * transfert ne doit pas decaler les colonnes de toutes les lignes suivantes.
 */
async function lire(chemin) {
  let entetes = null;
  const lignes = [];
  await parcourirCsv(chemin, (l) => {
    if (!entetes) { entetes = l.map((h) => String(h == null ? '' : h).trim()); return; }
    if (l.length === 1 && !l[0]) return;                 // ligne vide de fin de fichier
    const r = l.slice(0, entetes.length);
    while (r.length < entetes.length) r.push('');
    lignes.push(r);
  });
  entetes = entetes || [];
  const cles = entetes.map((h) => norm(h).replace(/\s+/g, '_'));
  return { entetes, cles, lignes };
}

/**
 * Monte le fichier en memoire et branche le moteur dessus.
 *
 * `mgLireEngages_` est ecrasee APRES le chargement des copies : c'est le seul
 * point ou Node se substitue a Apps Script. Tout le reste — filtres, tri,
 * pagination, choix des colonnes — reste le code du module.
 */
async function construire() {
  const f = SOURCE();
  if (!f) {
    throw new Error(
      'Aucune source d\'engages.\n' +
      '  cherche : ' + path.join(__dirname, '..', 'engages.csv') + '\n' +
      '        et : ' + path.join(__dirname, 'mg_fiches.csv') + '\n' +
      '        et : ' + path.join(__dirname, 'mg_matricules.csv') + '\n\n' +
      'Fabrique l\'index (node harvest.cjs --index), ou pointe MG_ENGAGES vers ton CSV.');
  }

  const donnees = await lire(f);
  MOTEUR.mgLireEngages_ = () => donnees;

  const amorce = MOTEUR.mgAmorcerRecherche();
  return { fichier: f, donnees, amorce };
}

/* ------------------------------------------------------------ memoire ----- */

let memo = null;

function signature() {
  const f = SOURCE();
  if (!f) return 'absent';
  const s = fs.statSync(f);
  return f + ':' + s.mtimeMs + ':' + s.size;
}

/** Force la reconstruction au prochain appel (selftests, rechargement force). */
function oublier() { memo = null; }

/**
 * L'index en memoire. Relu quand le fichier change — mais pas plus souvent
 * qu'un plancher valant 20 fois la duree de la lecture precedente, plafonne a
 * une minute : sur 27 000 lignes la lecture coute ~250 ms et suit le fichier
 * en direct, sur un fichier enorme le plancher protege le serveur.
 */
async function index() {
  const sig = signature();
  if (memo && memo.sig === sig) return memo.v;
  const plancher = memo ? Math.min(60000, memo.duree * 20) : 0;
  if (memo && Date.now() - memo.t < plancher) return memo.v;

  const t0 = Date.now();
  const v = await construire();
  memo = { sig, v, t: Date.now(), duree: Date.now() - t0 };
  return v;
}

/* ---------------------------------------------------------- recherche ----- */

/** Les criteres reconnus, une seule fois : formulaire, URL et export les lisent. */
const CRITERES = ['texte', 'matMin', 'matMax', 'anMin', 'anMax', 'origine', 'contributeur'];

/** Traduit les parametres d'URL vers les noms attendus par Engages.gs. */
function criteres(q) {
  return {
    texte: q.texte || '',
    matriculeMin: q.matMin || '',
    matriculeMax: q.matMax || '',
    anneeMin: q.anMin || '',
    anneeMax: q.anMax || '',
    origine: q.origine || '',
    contributeur: q.contributeur || ''
  };
}

/** Une page de resultats, telle que le module la calcule. */
function chercher(etat, q) {
  return MOTEUR.mgRechercherEngages(Object.assign(criteres(q), {
    page: Number(q.page || 1),
    taille: MOTEUR.MG_TAILLE_PAGE_RECHERCHE
  }));
}

/**
 * TOUS les resultats, sans pagination — ce que « Envoyer vers une feuille »
 * fait dans Sheets. Ici la destination est un CSV que le navigateur telecharge.
 * On boucle sur les pages plutot que de contourner le plafond du module :
 * l'export et l'ecran restent ainsi le meme filtrage, page apres page.
 */
function exporter(etat, q) {
  const c = Object.assign(criteres(q), { page: 1, taille: MOTEUR.MG_TAILLE_PAGE_RECHERCHE });
  const apercu = MOTEUR.mgRechercherEngages(c);
  const cols = apercu.colonnes;

  let csv = ligneCsv(cols.map((x) => x.titre));
  for (let p = 1; p <= apercu.pages; p++) {
    c.page = p;
    for (const l of MOTEUR.mgRechercherEngages(c).lignes) {
      csv += ligneCsv(cols.map((x) => l[x.index]));
    }
  }
  return { csv, total: apercu.total };
}

/* ---------------------------------------------------------------- vue ----- */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = (v) => String(v == null ? 0 : v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const STYLE = `
:root{color-scheme:light;--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;
--muted:#898781;--grid:#e1e0d9;--bord:rgba(11,11,11,.10);--champ:#fff;--focus:#2a78d6;
--mg:#008300;--mg-fond:#e9f5e9}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])){color-scheme:dark;
--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;
--bord:rgba(255,255,255,.10);--champ:#111110;--focus:#3987e5;--mg:#3fa64a;--mg-fond:#132015}}
:root[data-theme=dark]{color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;
--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--bord:rgba(255,255,255,.10);--champ:#111110;
--focus:#3987e5;--mg:#3fa64a;--mg-fond:#132015}
*{box-sizing:border-box}html{background:var(--plane)}html,body{margin:0;height:100%}
body{background:var(--plane);color:var(--ink);
font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}
h1{font-size:18px;font-weight:650;margin:0 0 2px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:12.5px;margin:0}
.tete{padding:16px 18px 0}
.envdev{display:inline-block;background:#f59e0b;color:#1f1300;font-weight:700;font-size:10.5px;
letter-spacing:.06em;padding:2px 7px;border-radius:4px;margin-right:7px;vertical-align:2px}
form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;padding:14px 18px;
border-bottom:1px solid var(--bord);background:var(--surface);margin-top:12px}
label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--ink2)}
input,select{font:inherit;font-size:12.5px;color:var(--ink);background:var(--champ);
border:1px solid var(--bord);border-radius:7px;padding:6px 9px;height:33px}
input:focus,select:focus{outline:2px solid var(--focus);outline-offset:-1px}
#texte{width:240px}.mini{width:82px}.moyen{width:158px}
button{font:inherit;font-size:12.5px;border-radius:7px;padding:7px 14px;cursor:pointer;
border:1px solid var(--bord);background:var(--surface);color:var(--ink);height:33px}
button.p{background:var(--focus);border-color:var(--focus);color:#fff}
button:hover{filter:brightness(1.06)}button[disabled]{opacity:.5;cursor:default}
.etat{padding:9px 18px;font-size:12px;color:var(--ink2);border-bottom:1px solid var(--bord);
display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.etat b{color:var(--ink);font-variant-numeric:tabular-nums}
.zone{flex:1;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{position:sticky;top:0;z-index:1;background:var(--surface);text-align:left;
font-weight:500;color:var(--ink2);font-size:11px;text-transform:uppercase;letter-spacing:.03em;
padding:8px 12px;border-bottom:1px solid var(--grid);white-space:nowrap}
tbody td{padding:8px 12px;border-bottom:1px solid var(--grid);vertical-align:top;max-width:300px}
tbody tr:hover{background:var(--mg-fond)}
.coupe{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Le matricule : la colonne qu'on lit en premier, et le lien vers la source. */
td.mg{font-variant-numeric:tabular-nums;white-space:nowrap}
td.mg a{color:var(--mg);font-weight:600;text-decoration:none;
border-bottom:1px solid color-mix(in srgb,var(--mg) 45%,transparent)}
td.mg a:hover{border-bottom-color:var(--mg)}
/* Sous 11 000, plusieurs series ont coexiste : le doute s'affiche, il ne se
   devine pas. Un point d'interrogation discret, explique au survol. */
.ambigu{display:inline-block;margin-left:5px;color:var(--muted);font-weight:700;cursor:help}
.vide{padding:40px 18px;color:var(--muted);text-align:center}
.vide b{display:block;color:var(--ink);font-size:14px;margin-bottom:4px}
.pied{display:flex;align-items:center;gap:12px;padding:10px 18px;
border-top:1px solid var(--bord);background:var(--surface);font-size:12px;color:var(--ink2)}
.pied .esp{flex:1}
`;

/**
 * La page : formulaire + resultats, rendus par le serveur au premier
 * chargement pour qu'un lien partage montre tout de suite ses resultats.
 *
 * Les criteres passent dans l'URL et celle-ci suit chaque requete : un signet
 * ou un lien envoye a un collegue ramene exactement le meme resultat — meme
 * regle que la recherche des Archives.
 */
function page(etat, q, r) {
  const a = etat.amorce;
  const v = (n) => esc(q[n] || '');

  const liste = (nom, valeurs, choisi) =>
    '<option value=""' + (choisi ? '' : ' selected') + '>Toutes</option>' +
    valeurs.map((x) => '<option value="' + esc(x.valeur) + '"' +
      (norm(x.valeur) === norm(choisi) ? ' selected' : '') + '>' +
      esc(x.valeur) + ' (' + nf(x.n) + ')</option>').join('');

  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Engagés — recherche</title><style>${STYLE}</style></head><body>

<div class=tete>
  <h1>${Env.PROD ? '' : '<span class=envdev>DEV</span>'}Engagés — recherche</h1>
  <p class=sub>${nf(a.lignes)} lignes · ${nf(a.matriculesDistincts)} matricules distincts
    (MG ${nf(a.plage.min)} à ${nf(a.plage.max)}) — ${esc(path.basename(etat.fichier))}</p>
</div>

<form method=get action="/">
  <label>Recherche<input type=search id=texte name=texte value="${v('texte')}"
    placeholder="identité, notes, sources…" autocomplete=off autofocus></label>
  <label>MG de<input class=mini type=number name=matMin min=1 max=130000 placeholder=1
    value="${v('matMin')}"></label>
  <label>à<input class=mini type=number name=matMax min=1 max=130000 placeholder=130000
    value="${v('matMax')}"></label>
  <label>Année de<input class=mini type=number name=anMin placeholder=1839
    value="${v('anMin')}"></label>
  <label>à<input class=mini type=number name=anMax placeholder=1911
    value="${v('anMax')}"></label>
  <label>Origine<select class=moyen name=origine>${liste('origine', a.origines, q.origine || '')}</select></label>
  <label>Contributeur<select class=moyen name=contributeur>${liste('contributeur', a.contributeurs, q.contributeur || '')}</select></label>
  <button class=p type=submit>Chercher</button>
  <button type=button onclick="location.href='/'">Effacer</button>
  <a href="/export.csv${qs(q, {})}"><button type=button
    title="Télécharger TOUS les résultats, pas seulement la page affichée">Exporter le CSV</button></a>
</form>

<div class=etat>
  <span><b>${nf(r.total)}</b> résultat${r.total > 1 ? 's' : ''}
    sur ${nf(r.totalFeuille)} lignes — ${r.duree_ms} ms</span>
  <span>${esc(etat.fichier)}</span>
</div>

<div class=zone>${tableau(a, r)}</div>

${pied(q, r)}
</body></html>`;
}

/** Le tableau, colonne par colonne, comme Recherche.html les rend dans Sheets. */
function tableau(a, r) {
  if (!r.total) {
    return '<div class=vide><b>Aucun résultat</b>Élargis la recherche, ou retire un filtre.</div>';
  }
  const cols = r.colonnes;

  const cellule = (col, valeur) => {
    if (col.type === 'nombre') {
      // Le matricule renvoie vers sa fiche sur le site, source des donnees.
      const mg = String(valeur == null ? '' : valeur).replace(/\D/g, '');
      return '<td class=mg><a href="' + esc(a.urlFiche + mg) + '" target=_blank rel=noopener' +
        ' title="Voir cette MG sur cherchemg.fr">' + esc(valeur) + '</a>' +
        (mg && Number(mg) < 11000
          ? '<span class=ambigu title="Sous 11 000, plusieurs séries de numéros ont' +
            ' coexisté : un même numéro peut porter des engagés sans rapport">?</span>'
          : '') + '</td>';
    }
    // Une date inconnue est notee 0000-00-00 par le site : l'afficher n'apprend
    // rien et encombre la colonne. Elle reste telle quelle dans le fichier.
    const t = String(valeur == null ? '' : valeur).trim();
    const s = (col.type === 'date' && /^0{4}-0{2}-0{2}$/.test(t)) ? '' : valeur;
    return '<td><span class=coupe title="' + esc(s) + '">' + esc(s) + '</span></td>';
  };

  return '<table><thead><tr>' +
    cols.map((c) => '<th style="min-width:' + c.largeur + 'px">' + esc(c.titre) + '</th>').join('') +
    '</tr></thead><tbody>' +
    r.lignes.map((l) => '<tr>' + cols.map((c) => cellule(c, l[c.index])).join('') + '</tr>').join('') +
    '</tbody></table>';
}

/** Pagination. Des liens, pas des boutons : chaque page a son adresse. */
function pied(q, r) {
  if (!r.total) return '';
  const debut = (r.page - 1) * r.taille + 1;
  const fin = Math.min(r.page * r.taille, r.total);
  const lien = (p, txt, actif) => actif
    ? '<a href="' + esc(qs(q, { page: p })) + '"><button type=button>' + txt + '</button></a>'
    : '<button type=button disabled>' + txt + '</button>';

  return '<div class=pied>' +
    '<span>' + nf(debut) + ' – ' + nf(fin) + ' sur ' + nf(r.total) + '</span>' +
    '<span class=esp></span>' +
    lien(r.page - 1, '← Précédent', r.page > 1) +
    '<span>page ' + r.page + ' / ' + r.pages + '</span>' +
    lien(r.page + 1, 'Suivant →', r.page < r.pages) +
    '</div>';
}

/** Reconstruit la query string en changeant ce qu'on lui passe. */
function qs(q, changements) {
  const u = new URLSearchParams();
  for (const c of CRITERES) if (q[c]) u.set(c, q[c]);
  for (const [k, v] of Object.entries(changements)) {
    if (v === '' || v === undefined || v === null) u.delete(k); else u.set(k, v);
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

/* ------------------------------------------------------------- serveur ---- */

function demarrer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const q = Object.fromEntries(u.searchParams);
    const json = u.pathname === '/api';
    const csv = u.pathname === '/export.csv';

    // Le corps est construit AVANT le moindre en-tete : si la generation leve,
    // la reponse n'est pas engagee et le catch peut repondre 500 proprement.
    try {
      const etat = await index();

      if (csv) {
        const x = exporter(etat, q);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="engages-recherche.csv"',
          'Cache-Control': 'no-store'
        });
        return res.end('﻿' + x.csv);   // BOM : Excel sous Windows sinon casse les accents
      }

      const r = chercher(etat, q);
      const corps = json ? JSON.stringify(r) : page(etat, q, r);
      res.writeHead(200, {
        'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
        // La page embarque les chiffres du moment : la mettre en cache
        // afficherait des donnees mortes qu'on prendrait pour un bug.
        'Cache-Control': 'no-store'
      });
      res.end(corps);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': json ? 'application/json' : 'text/plain; charset=utf-8' });
      res.end(json ? JSON.stringify({ error: e.message, lignes: [], total: 0 })
                   : 'ECHEC : ' + e.message);
    }
  }).listen(PORT, HOST, () => {
    Env.banniere('recherche des engages');
    console.log('Ouvrir : ' + Env.urlLocale(HOST, PORT));
    if (HOST === '0.0.0.0') console.log('Depuis le reseau : http://<ip-du-serveur>:' + PORT);
    console.log('Source : ' + (SOURCE() || 'absente'));
  });
}

/* ------------------------------------------------------------ selftest ---- */

async function selftest() {
  const os = require('os');
  let ok = 0, ko = 0;
  const dit = (b, t, d) => {
    if (b) { ok++; console.log('OK    ' + t); }
    else { ko++; console.log('ECHEC ' + t + (d !== undefined ? '  -> ' + d : '')); }
  };

  console.log('=== copies conformes ===');
  const amont = path.join(__dirname, '..');
  if (fs.existsSync(path.join(amont, 'Engages.gs'))) {
    for (const [copie, source] of [['Config.js', 'Config.gs'], ['Engages.js', 'Engages.gs']]) {
      dit(fs.readFileSync(path.join(__dirname, copie), 'utf8') ===
          fs.readFileSync(path.join(amont, source), 'utf8'),
          copie + ' identique a ../' + source);
    }
  } else {
    console.log('(module Apps Script absent : comparaison sautee)');
  }
  dit(typeof MOTEUR.mgRechercherEngages === 'function', 'le moteur de Engages.gs est charge');
  dit(MOTEUR.MG_TAILLE_PAGE_RECHERCHE === 100, 'taille de page reprise du module');

  console.log('');
  console.log('=== sur un CSV de synthese ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-recherche-'));
  const f = path.join(tmp, 'engages.csv');
  // Les pieges volontaires : accents, virgule et guillemets dans les notes,
  // date inconnue 0000-00-00, matricule sous 11 000 (serie ambigue).
  fs.writeFileSync(f, [
    'matricule,identite,origine,naissance,arrivee,convoi,immatriculation,notes,sources,contributeur',
    '103,Pétan Marie,Inde,0000-00-00,1842-08-05,,1842-08-05,"détenu à la géôle, St Denis",IMG_1.JPG,Xavier Lecoq',
    '11000,Moutou Samy,Inde | Calcutta,1850-00-00,1869-03-02,Aurelie,1869-03-02,"dit ""le grand""",IMG_2.JPG,Christian Fontaine',
    '12000,Naiken Pierre,Afrique,,1875-01-01,,1875-01-01,,IMG_3.JPG,Xavier Lecoq'
  ].join('\n') + '\n', 'utf8');

  process.env.MG_ENGAGES = f;
  oublier();
  const etat = await index();
  const a = etat.amorce;

  dit(a.lignes === 3, '3 lignes lues', a.lignes);
  dit(a.matriculesDistincts === 3, '3 matricules distincts', a.matriculesDistincts);
  dit(a.plage.min === 103 && a.plage.max === 12000, 'plage des matricules',
      a.plage.min + '-' + a.plage.max);

  const tout = chercher(etat, {});
  dit(tout.total === 3, 'sans critere : tout ressort', tout.total);
  dit(tout.lignes[0][0] === '103', 'tri par matricule croissant', tout.lignes[0][0]);

  dit(chercher(etat, { texte: 'petan' }).total === 1, 'recherche insensible aux accents');
  dit(chercher(etat, { texte: 'geole' }).total === 1, 'geole trouve geole');
  dit(chercher(etat, { texte: 'le grand' }).total === 1, 'guillemets doubles traverses');
  dit(chercher(etat, { texte: 'moutou aurelie' }).total === 1,
      'tous les mots exiges, repartis sur plusieurs colonnes');
  dit(chercher(etat, { texte: 'moutou naiken' }).total === 0, 'un mot absent ecarte la ligne');

  dit(chercher(etat, { matMin: 11000 }).total === 2, 'borne basse des matricules');
  dit(chercher(etat, { matMin: 11000, matMax: 11000 }).total === 1, 'plage fermee');
  dit(chercher(etat, { origine: 'Inde' }).total === 2,
      'origine par prefixe : Inde attrape Inde | Calcutta');
  dit(chercher(etat, { origine: 'Afrique' }).total === 1, 'autre origine');
  dit(chercher(etat, { contributeur: 'Xavier Lecoq' }).total === 2, 'contributeur exact');
  dit(chercher(etat, { anMin: 1869, anMax: 1875 }).total === 1, 'plage d annees');
  dit(chercher(etat, { anMin: 1850, anMax: 1850 }).total === 1,
      'la naissance prime sur l arrivee');
  // 0000-00-00 n'est pas une annee : la ligne 103 doit retomber sur son
  // arrivee (1842) plutot que d'etre ecartee du filtre.
  dit(chercher(etat, { anMin: 1842, anMax: 1842 }).total === 1,
      'date inconnue : on passe a la colonne suivante');
  dit(chercher(etat, { texte: 'inde', origine: 'Afrique' }).total === 0,
      'les criteres se cumulent');

  console.log('');
  console.log('=== rendu ===');
  const html = page(etat, {}, tout);
  dit(html.indexOf('<th style="min-width:58px">MG</th>') !== -1, 'la colonne MG est en tete');
  dit(html.indexOf('cherchemg.fr/mg.php?MgChaine=103') !== -1, 'le matricule renvoie a sa fiche');
  dit((html.match(/class=ambigu/g) || []).length === 1,
      'un seul « ? » : le matricule sous 11 000');
  dit(html.indexOf('0000-00-00') === -1, 'la date inconnue n est pas affichee');
  dit(html.indexOf('1842-08-05') !== -1, 'les dates reelles le sont');
  dit(html.indexOf('g&eacute;&ocirc;le') === -1 && html.indexOf('géôle') !== -1,
      'les accents traversent le rendu');
  // La liste donne les valeurs BRUTES distinctes avec leur effectif ; c'est
  // le filtre qui elargit ensuite par prefixe.
  dit(html.indexOf('Inde (1)') !== -1 && html.indexOf('Inde | Calcutta (1)') !== -1,
      'la liste des origines porte ses effectifs');
  dit(page(etat, {}, chercher(etat, { texte: 'zzz' })).indexOf('Aucun résultat') !== -1,
      'recherche vide : un message, pas un tableau vide');

  console.log('');
  console.log('=== export CSV ===');
  const x = exporter(etat, { origine: 'Inde' });
  const l = x.csv.trim().split('\n');
  dit(x.total === 2, 'export : les 2 lignes filtrees', x.total);
  dit(l.length === 3, 'en-tete + 2 lignes', l.length);
  dit(l[0].indexOf('Identite') !== -1, 'l en-tete porte les titres affiches');
  dit(x.csv.indexOf('"dit ""le grand"""') !== -1, 'les guillemets sont rechappes');
  dit(x.csv.indexOf('"détenu à la géôle, St Denis"') !== -1, 'la virgule reste protegee');

  console.log('');
  console.log('=== schema libre ===');
  // mg_matricules.csv n'a ni origine ni date : l'ecran doit s'y adapter seul.
  const g = path.join(tmp, 'index.csv');
  fs.writeFileSync(g, 'matricule,identite,source,trouve_par\n' +
                      '7,Petan Jean,patro.php,p\n', 'utf8');
  process.env.MG_ENGAGES = g;
  oublier();
  const etat2 = await index();
  const r2 = chercher(etat2, {});
  dit(r2.total === 1, 'un index seul se lit aussi', r2.total);
  dit(r2.colonnes.map((c) => c.titre).join(',') === 'MG,Identite,source,trouve_par',
      'colonnes connues d abord, inconnues conservees',
      r2.colonnes.map((c) => c.titre).join(','));
  dit(chercher(etat2, { origine: 'Inde' }).total === 1,
      'un filtre sur une colonne absente ne rejette rien');

  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MG_ENGAGES;
  oublier();

  console.log('');
  console.log(ok + ' OK, ' + ko + ' echec(s)');
  return ko === 0;
}

/* --------------------------------------------------------------- main ----- */

module.exports = { construire, chercher, exporter, index, oublier, page, tableau, SOURCE, selftest };

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    selftest().then((bon) => process.exit(bon ? 0 : 1));
  } else {
    demarrer();
  }
}
