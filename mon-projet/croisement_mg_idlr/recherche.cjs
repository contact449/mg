#!/usr/bin/env node
/**
 * ============================================================================
 *  RECHERCHE CROISEE — une seule requete dans toutes les sources a la fois.
 *
 *  Archives (actes.csv)  +  MG (engages.csv)  +  Filae (filae.csv)
 *                        ->  une ligne par matricule
 *
 *  UNE ligne par matricule, coloree selon sa provenance :
 *     jaune  present seulement dans les Archives (IDLR)
 *     vert   present seulement dans MG (cherchemg.fr)
 *     bleu   present dans les DEUX — une seule ligne, la synthese ; le
 *            detail de chaque base ne sort pas ici, il se consulte dans la
 *            recherche dediee de chaque application.
 *     rose   Filae : saisi a la main parce qu'aucune des deux bases ne le
 *            connait. Seule provenance que cette application ecrit.
 *
 *  La couleur n'est jamais seule : chaque ligne porte aussi le mot
 *  « Archives », « MG », « Les deux » ou « Filae ». Ce n'est pas de la
 *  redondance decorative — jaune et vert sont a DeltaE 6,9 en protanopie,
 *  c'est-a-dire difficilement separables pour ~8 % des hommes. L'etiquette
 *  est ce qui rend le code couleur lisible pour eux.
 *
 *  Le rose a ete choisi contre les trois couleurs deja en place, simulation
 *  de dichromatie a l'appui : son pire ecart est de 20,6 (contre le bleu, en
 *  protanopie), la ou la pire paire preexistante est a 12,3. Il est donc
 *  mieux separe que ce qui l'entoure, et non ajoute au juge.
 *
 *  Chaque lien mene a la base d'ou vient la donnee : le numero de matricule
 *  vers cherchemg.fr (seulement si MG le connait), le nom releve dans un acte
 *  vers cet acte sur iledelareunion-archive.com.
 *
 *  Lancer :  node recherche.cjs        # puis http://localhost:8093
 *  Reglages (env) : PORT=8093  HOST=0.0.0.0
 *                   IDLR_OUT=actes.csv        MG_ENGAGES=engages.csv
 *                   FILAE_CSV=filae.csv
 *
 *  Les fichiers sont relus quand ils changent (taille ou date), avec un
 *  plancher proportionnel au cout de la lecture — meme regle que search.cjs.
 *  Une saisie Filae court-circuite ce plancher : elle doit se voir aussitot.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const CFG = require('./Config.js');
const Env = require('./Env.js');
const { parcourirCsv } = require('./idlr.cjs');
const Filae = require('./filae.cjs');

const PORT = Number(process.env.PORT || 8093);
const HOST = process.env.HOST || '0.0.0.0';
const PAGE = 100;
const MAX_EXEMPLES = 3;

/* ------------------------------------------------------- sources ---------- */

/** Le premier fichier existant de la liste, ou null. */
function premierPresent(liste) {
  for (const f of liste) if (f && fs.existsSync(f)) return f;
  return null;
}

const SRC_IDLR = () => premierPresent([CFG.IDLR_CSV]);
const SRC_MG = () => premierPresent([
  process.env.MG_ENGAGES,
  path.join(__dirname, '..', 'cherche_mg', 'engages.csv'),
  path.join(__dirname, '..', 'cherche_mg', 'moissonneur', 'mg_fiches.csv'),
  CFG.MG_INDEX
]);

/* --------------------------------------------------------- outils --------- */

/** Empreinte 64 bits d'une ligne, pour ecarter les doublons parfaits. */
function empreinte(champs) {
  const s = champs.join(String.fromCharCode(1));
  let djb2 = 5381, sdbm = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2 + c) | 0;
    sdbm = (c + (sdbm << 6) + (sdbm << 16) - sdbm) | 0;
  }
  return (djb2 >>> 0).toString(36) + (sdbm >>> 0).toString(36);
}

/** Sans accent, minuscules : on cherche « petan » et on trouve « Pétan ». */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = (v) => String(v == null ? 0 : v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/* ------------------------------------------------------- chargement ------- */

/**
 * Lit un CSV en repérant ses colonnes par NOM, pas par position : les deux
 * fichiers n'ont ni le meme nombre ni le meme ordre de colonnes, et
 * engages.csv peut etre remplace par mg_fiches.csv sans rien changer ici.
 */
async function lireCsv(chemin, garder) {
  let entete = null;
  let index = null;
  const vues = new Set();
  let lignes = 0, doublons = 0;

  await parcourirCsv(chemin, (l) => {
    if (!entete) {
      entete = l.map((h) => norm(h).trim());
      index = (nom) => entete.indexOf(nom);
      return;
    }
    const cle = empreinte(l);
    if (vues.has(cle)) { doublons++; return; }
    vues.add(cle);
    lignes++;
    garder(l, index, entete);
  });
  return { lignes, doublons, entete: entete || [] };
}

/** Ajoute un exemplaire a l'entree d'un matricule, en bornant la memoire. */
function ajouter(carte, mg, exemple) {
  let e = carte.get(mg);
  if (!e) { e = { n: 0, exemples: [] }; carte.set(mg, e); }
  e.n++;
  if (e.exemples.length < MAX_EXEMPLES) e.exemples.push(exemple);
}

/**
 * Construit l'index croise : une entree par matricule, avec ce que chaque
 * base en dit. C'est ici que se decide la couleur d'une ligne.
 */
async function construire() {
  const fIdlr = SRC_IDLR();
  const fMg = SRC_MG();
  if (!fIdlr && !fMg) {
    throw new Error('Aucune source.\n  Archives : ' + CFG.IDLR_CSV +
                    '\n  MG       : ' + path.join(__dirname, '..', 'cherche_mg', 'engages.csv'));
  }

  const idlr = new Map();
  const mg = new Map();
  const filae = new Map();
  let statIdlr = { lignes: 0, doublons: 0 };
  let statMg = { lignes: 0, doublons: 0 };

  if (fIdlr) {
    statIdlr = await lireCsv(fIdlr, (l, i) => {
      const num = Number(String(l[i('matricule')] || '').replace(/\D/g, ''));
      if (!num) return;
      ajouter(idlr, num, {
        nom: l[i('nom')] || '', prenom: l[i('prenom')] || '',
        commune: l[i('commune')] || '', date: l[i('date_iso')] || '',
        type: l[i('type_acte')] || '', obs: l[i('obs')] || '',
        origine: l[i('origine')] || '',
        // Lien vers l'acte sur iledelareunion-archive.com. Environ un tiers
        // des actes n'en ont pas : on affichera alors le nom sans lien.
        url: l[i('url_demande_photo')] || ''
      });
    });
  }

  if (fMg) {
    statMg = await lireCsv(fMg, (l, i) => {
      const num = Number(String(l[i('matricule')] || '').replace(/\D/g, ''));
      if (!num) return;
      ajouter(mg, num, {
        identite: l[i('identite')] || '',
        origine: l[i('origine')] || '',
        naissance: l[i('naissance')] || '', arrivee: l[i('arrivee')] || '',
        notes: l[i('notes')] || '', sources: l[i('sources')] || '',
        contributeur: l[i('contributeur')] || ''
      });
    });
  }

  // Filae : la saisie manuelle. Seule source que cette application ecrit,
  // et seule a n'avoir aucun moissonneur derriere elle.
  for (const r of await Filae.lire()) ajouter(filae, r.matricule, r);

  /**
   * La provenance d'un numero, decidee UNE fois. Lignes, legende, barre et
   * frise appellent toutes cette fonction : leurs totaux ne peuvent donc pas
   * diverger, et ajouter une provenance ne demande pas de retoucher quatre
   * comptages qui doivent rester d'accord.
   *
   * Filae vient en dernier parce qu'il n'a pas vocation a masquer une base
   * moissonnee : si un rafraichissement finit par apporter le numero, c'est
   * Archives ou MG qui parle, et `dansFilae` garde la trace de la saisie.
   */
  const provenanceDe = (n) => (idlr.has(n) && mg.has(n)) ? 'deux'
    : idlr.has(n) ? 'idlr' : mg.has(n) ? 'mg' : 'filae';

  // Fusion : une entree par matricule, avec sa provenance.
  const lignes = [];
  const tous = new Set([...idlr.keys(), ...mg.keys(), ...filae.keys()]);
  for (const num of tous) {
    const a = idlr.get(num);
    const b = mg.get(num);
    const c = filae.get(num);
    const provenance = provenanceDe(num);
    const xa = (a && a.exemples[0]) || {};
    const xb = (b && b.exemples[0]) || {};
    const xc = (c && c.exemples[0]) || {};

    // Une fiche Filae porte des champs qu'aucune des deux bases n'a : on les
    // replie dans les colonnes existantes plutot que d'en ajouter cinq qui
    // resteraient vides sur 99 % des lignes.
    const dateFilae = [xc.naissance ? '° ' + xc.naissance : '',
                       xc.deces ? '† ' + xc.deces : ''].filter(Boolean).join(' ');
    const detailFilae = [
      xc.conjoint ? 'conj. ' + xc.conjoint : '',
      xc.pere ? 'père ' + xc.pere : '',
      xc.mere ? 'mère ' + xc.mere : '',
      xc.divers1, xc.divers2
    ].filter(Boolean).join(' · ');

    lignes.push({
      mg: num,
      provenance,
      identite: b ? b.exemples.map((x) => x.identite).filter(Boolean).join(' · ') : '',
      nom: [xa.nom, xa.prenom].filter(Boolean).join(' ') ||
           [xc.nom, xc.prenom].filter(Boolean).join(' '),
      origine: xb.origine || xa.origine || '',
      commune: xa.commune || xc.ville || '',
      date: xb.naissance || xb.arrivee || xa.date || dateFilae,
      nActes: a ? a.n : 0,
      nEngages: b ? b.n : 0,
      notes: xb.notes || xa.obs || detailFilae,
      dansFilae: !!c,               // saisi a la main, meme si une base l'a rattrape depuis
      // On prend le premier acte QUI A une URL, pas simplement le premier :
      // environ un tiers des actes n en ont pas, et se rabattre sur le
      // premier venu priverait de lien des matricules qui en meritent un.
      urlIdlr: (a && (a.exemples.find((x) => x.url) || {}).url) || '',
      dansMg: !!b,                  // MG connait-il ce matricule ?
      // champ de recherche prepare une fois, pas a chaque requete
      foin: norm([
        num,
        b ? b.exemples.map((x) => [x.identite, x.notes, x.sources, x.origine, x.contributeur].join(' ')).join(' ') : '',
        a ? a.exemples.map((x) => [x.nom, x.prenom, x.commune, x.obs, x.origine].join(' ')).join(' ') : '',
        c ? c.exemples.map((x) => [x.nom, x.prenom, x.ville, x.naissance, x.deces,
          x.conjoint, x.pere, x.mere, x.divers1, x.divers2].join(' ')).join(' ') : ''
      ].join(' '))
    });
  }
  lignes.sort((x, y) => x.mg - y.mg);

  const compter = (liste, prov) => liste.filter((n) => provenanceDe(n) === prov).length;
  const tousTab = [...tous];

  return {
    lignes,
    // Les matricules Filae qu'un moissonnage a fini par rattraper. Ils ne
    // comptent plus comme Filae (Archives ou MG fait foi), mais les taire
    // laisserait croire que la saisie a ete perdue.
    absorbes: [...filae.keys()].filter((n) => idlr.has(n) || mg.has(n)).length,
    sources: {
      idlr: fIdlr ? { fichier: fIdlr, ...statIdlr } : null,
      mg: fMg ? { fichier: fMg, ...statMg } : null,
      filae: { fichier: Filae.FICHIER(), lignes: filae.size }
    },
    compte: {
      idlr: compter(tousTab, 'idlr'),
      mg: compter(tousTab, 'mg'),
      deux: compter(tousTab, 'deux'),
      filae: compter(tousTab, 'filae')
    },

    // Couverture de la serie : ce qu'on connait sur ce qu'elle peut porter.
    // On ne compte QUE les numeros de la plage 1..130 000 : le reste ne peut
    // pas etre une MG (on trouve jusqu'a 113413113413, des chiffres colles
    // par le regex du moissonneur) et gonflerait la couverture a tort.
    couverture: (() => {
      const dans = (n) => n >= CFG.MG_MIN && n <= CFG.MG_MAX;
      const v = [...tous].filter(dans);
      return {
        total: CFG.MG_MAX,
        connus: v.length,
        hors: tous.size - v.length,
        idlr: compter(v, 'idlr'),
        mg: compter(v, 'mg'),
        deux: compter(v, 'deux'),
        filae: compter(v, 'filae'),

        // 13 tranches de 10 000 : 1-10 000, 10 001-20 000 ... 120 001-130 000.
        tranches: (() => {
          const T = [];
          for (let i = 0; i < 13; i++) {
            T.push({ debut: i * 10000 + 1, fin: (i + 1) * 10000, idlr: 0, mg: 0, deux: 0, filae: 0 });
          }
          for (const n of v) {
            const c = T[Math.floor((n - 1) / 10000)];
            if (!c) continue;
            c[provenanceDe(n)]++;
          }
          return T;
        })()
      };
    })()
  };
}

/* ------------------------------------------------------------ memoire ----- */

let memo = null;

function signature() {
  // filae.csv n'existe pas tant qu'aucune saisie n'a eu lieu : son apparition
  // doit elle aussi changer la signature, d'ou le marqueur explicite.
  const p = [SRC_IDLR(), SRC_MG(), Filae.FICHIER()].filter(Boolean);
  return p.map((f) => {
    if (!fs.existsSync(f)) return f + ':absent';
    const s = fs.statSync(f);
    return f + ':' + s.mtimeMs + ':' + s.size;
  }).join('|');
}

/**
 * Force la reconstruction au prochain appel.
 *
 * Sans ca, une saisie Filae pourrait attendre jusqu'a une minute avant
 * d'apparaitre : `index()` s'impose un plancher entre deux reconstructions
 * pour ne pas relire 39 000 actes a chaque requete. Ce plancher protege des
 * relectures subies, pas de celles qu'on declenche soi-meme.
 */
function oublier() { memo = null; }

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

function chercher(donnees, q) {
  const mots = norm(q.texte || '').split(/\s+/).filter(Boolean);
  const prov = q.provenance || '';
  const min = q.matMin ? Number(q.matMin) : null;
  const max = q.matMax ? Number(q.matMax) : null;
  const commune = norm(q.commune || '');
  const origine = norm(q.origine || '');

  const out = [];
  for (const l of donnees.lignes) {
    if (prov && l.provenance !== prov) continue;
    if (min !== null && l.mg < min) continue;
    if (max !== null && l.mg > max) continue;
    if (commune && norm(l.commune).indexOf(commune) !== 0) continue;
    if (origine && norm(l.origine).indexOf(origine) !== 0) continue;
    if (mots.length && !mots.every((m) => l.foin.indexOf(m) !== -1)) continue;
    out.push(l);
  }

  const page = Math.max(0, parseInt(q.page, 10) || 0);

  return {
    total: out.length,
    page,
    rows: out.slice(page * PAGE, page * PAGE + PAGE).map((l) => {
      const { foin, ...reste } = l;   // le champ de recherche ne sort pas
      return reste;
    }),
    hasMore: out.length > (page + 1) * PAGE
  };
}
/* ---------------------------------------------------------------- vue ----- */

const STYLE = `
:root{color-scheme:light;--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;
--muted:#898781;--grid:#e1e0d9;--bord:rgba(11,11,11,.10);--champ:#fff;--focus:#2a78d6;
--idlr:#eda100;--mg:#008300;--deux:#2a78d6;--filae:#b81e73;
--idlr-fond:#fdf6e3;--mg-fond:#e9f5e9;--deux-fond:#e8f1fd;--filae-fond:#fceaf3}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])){color-scheme:dark;
--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;
--bord:rgba(255,255,255,.10);--champ:#111110;--focus:#3987e5;
--idlr:#c98500;--mg:#008300;--deux:#3987e5;--filae:#bd287a;
--idlr-fond:#2a2114;--mg-fond:#132015;--deux-fond:#111e2e;--filae-fond:#2b1122}}
:root[data-theme=dark]{color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;
--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--bord:rgba(255,255,255,.10);--champ:#111110;
--focus:#3987e5;--idlr:#c98500;--mg:#008300;--deux:#3987e5;--filae:#bd287a;
--idlr-fond:#2a2114;--mg-fond:#132015;--deux-fond:#111e2e;--filae-fond:#2b1122}
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
border:1px solid var(--bord);border-radius:7px;padding:6px 9px}
input:focus,select:focus{outline:2px solid var(--focus);outline-offset:-1px}
#texte{width:240px}.mini{width:82px}
button{font:inherit;font-size:12.5px;border-radius:7px;padding:7px 14px;cursor:pointer;
border:1px solid var(--bord);background:var(--surface);color:var(--ink)}
button.p{background:var(--focus);border-color:var(--focus);color:#fff}
button:hover{filter:brightness(1.06)}button[disabled]{opacity:.5;cursor:default}
.legende{display:flex;gap:16px;flex-wrap:wrap;padding:10px 18px;font-size:12px;color:var(--ink2);
border-bottom:1px solid var(--bord)}
.legende span{display:inline-flex;align-items:center;gap:7px}
.pastille{width:11px;height:11px;border-radius:3px;flex:none}
.legende b{color:var(--ink);font-variant-numeric:tabular-nums}
.legende .horsplage,.legende .horsplage b{color:var(--muted)}
.legende .horsplage .pastille{border:1px solid var(--bord)}
/* Compteur de couverture : une proportion contre une limite connue.
   La piste montre les 130 000 numeros possibles, les segments ce qu on a. */
.couv{padding:12px 18px;border-bottom:1px solid var(--bord)}
.couv-tete{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
font-size:12px;color:var(--ink2);margin-bottom:6px;flex-wrap:wrap}
.couv-tete b{color:var(--ink);font-variant-numeric:tabular-nums;font-size:13px}
/* Frise : 13 jauges de 10 000. La piste grise est la capacite de la tranche,
   le remplissage ce qu'on en connait — les hauteurs se comparent donc
   directement d'une tranche a l'autre. */
/* Barre d ensemble : les 130 000 numeros sur une seule ligne. */
.piste{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;
background:var(--grid)}
.piste i{display:block;height:100%;flex:none}
/* Intitule de chaque niveau de lecture : sans lui on croit voir deux fois
   la meme chose, alors que la frise decompose la barre. */
.couv-sous{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;
color:var(--muted);margin:10px 0 5px}
.frise{display:flex;gap:3px;align-items:flex-end;height:110px}
.fcol{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;
background:var(--grid);border-radius:3px;overflow:hidden;cursor:pointer;
border:1px solid transparent;transition:border-color .1s}
.fcol:hover{border-color:var(--focus)}
.fcol.actif{border-color:var(--focus);box-shadow:0 0 0 1px var(--focus)}
.fcol i{display:block;width:100%;flex:none}
.faxe{display:flex;gap:3px;margin-top:5px}
.faxe span{flex:1;text-align:center;font-size:10px;color:var(--muted);
font-variant-numeric:tabular-nums}
.couv-note{font-size:11px;color:var(--muted);margin-top:6px}
/* Le bouton de saisie porte le rose de Filae : on sait ce qu'il produit
   avant de l'avoir ouvert. */
.fl-ouvrir{border-color:var(--filae);color:var(--filae);font-weight:600}
.fl-ouvrir:hover{background:var(--filae-fond)}
dialog.fl{border:1px solid var(--bord);border-radius:12px;padding:0;max-width:640px;width:92vw;
background:var(--surface);color:var(--ink);box-shadow:0 12px 40px rgba(0,0,0,.28)}
dialog.fl::backdrop{background:rgba(0,0,0,.42)}
dialog.fl form{display:block;padding:18px 20px 16px;border:0;background:none;margin:0}
dialog.fl h2{font-size:15px;font-weight:650;margin:0 0 4px}
dialog.fl h2::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;
background:var(--filae);margin-right:8px;vertical-align:1px}
.fl-note{font-size:12px;color:var(--ink2);margin:0 0 14px}
.fl-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.fl-grille label{gap:4px}
.fl-grille input{width:100%}
.req{color:var(--filae)}
.fl-err{margin:12px 0 0;padding:9px 11px;border-radius:7px;font-size:12.5px;
background:var(--filae-fond);color:var(--ink);border-left:3px solid var(--filae)}
.fl-pied{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.etat{padding:9px 18px;font-size:12px;color:var(--ink2);border-bottom:1px solid var(--bord);
display:flex;justify-content:space-between;gap:12px}
.etat b{color:var(--ink);font-variant-numeric:tabular-nums}
.zone{flex:1;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{position:sticky;top:0;z-index:1;background:var(--surface);text-align:left;
font-weight:500;color:var(--ink2);font-size:11px;text-transform:uppercase;letter-spacing:.03em;
padding:8px 12px;border-bottom:1px solid var(--grid);white-space:nowrap}
tbody td{padding:8px 12px;border-bottom:1px solid var(--grid);vertical-align:top;max-width:300px}
.coupe{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* La couleur de provenance : un fond tres pale + un liseré franc a gauche.
   Un aplat sature sur toute la ligne rendrait le texte illisible. */
tr.idlr{background:var(--idlr-fond)}tr.mg{background:var(--mg-fond)}tr.deux{background:var(--deux-fond)}
tr.filae{background:var(--filae-fond)}
tr.idlr td:first-child{box-shadow:inset 3px 0 var(--idlr)}
tr.mg td:first-child{box-shadow:inset 3px 0 var(--mg)}
tr.deux td:first-child{box-shadow:inset 3px 0 var(--deux)}
tr.filae td:first-child{box-shadow:inset 3px 0 var(--filae)}
.prov{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:11.5px;white-space:nowrap}
.num{font-variant-numeric:tabular-nums}
td.mgnum{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
td.mgnum a{color:var(--focus);text-decoration:none}td.mgnum a:hover{text-decoration:underline}
/* Le lien vers les Archives porte la couleur des Archives : on voit ou il mene */
td a.acte{color:inherit;text-decoration:underline;text-decoration-color:var(--idlr);
text-underline-offset:2px;text-decoration-thickness:1.5px}
td a.acte:hover{color:var(--idlr)}
.pied{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 18px;
border-top:1px solid var(--bord);background:var(--surface);font-size:12px;color:var(--ink2)}
.pages{display:flex;gap:8px;align-items:center}
.vide{padding:50px 20px;text-align:center;color:var(--ink2)}
.vide b{display:block;color:var(--ink);font-size:15px;margin-bottom:6px}
`;

/**
 * Legende des couleurs, avec les effectifs.
 *
 * Elle compte la plage 1-130 000, comme la barre et la frise : trois visuels
 * cote a cote doivent donner les memes nombres. Les numeros hors plage ne
 * sont pas une provenance ; ils apparaissent en retrait, parce que les taire
 * ferait un total qui ne tombe pas juste.
 */
function legende(v) {
  const item = (couleur, nom, n, classe) =>
    '<span' + (classe ? ' class=' + classe : '') + '>' +
    '<i class=pastille style="background:var(--' + couleur + ')"></i>' +
    nom + ' <b>' + nf(n) + '</b></span>';

  return '<div class=legende>' +
    item('idlr', 'Archives seulement', v.idlr) +
    item('mg', 'MG seulement', v.mg) +
    item('deux', 'Les deux', v.deux) +
    item('filae', 'Filae (saisie)', v.filae) +
    (v.hors ? item('grid', 'hors plage 1\u2013130 000', v.hors, 'horsplage') : '') +
    '</div>';
}

/**
 * Barre d'ensemble : la serie entiere sur une ligne.
 *
 * Les trois segments sont proportionnels aux 130 000 numeros possibles ; ce
 * qui reste de piste grise est donc ce qu'aucune des deux bases ne connait.
 * C'est la lecture globale, que la frise decompose juste en dessous.
 */
function barreGlobale(v) {
  const lg = (n) => (n / v.total * 100).toFixed(3);

  // Plancher de 2 px : un matricule vaut 0,0008 % des 130 000, soit un
  // segment de 0,01 px — invisible. Une saisie Filae qui n'apparait pas
  // serait prise pour une saisie perdue. La proportion est donc legerement
  // faussee vers le haut pour les tres petits effectifs ; les nombres exacts
  // restent dans la legende juste au-dessus.
  const seg = (couleur, n) => !n ? '' :
    '<i style="width:max(2px,' + lg(n) + '%);background:var(--' + couleur + ')"></i>';

  // Meme ordre que dans la frise, lue de bas en haut : les deux visuels se
  // superposent mentalement au lieu de se contredire.
  return '<div class=piste role=img aria-label="Couverture de la serie entiere">' +
    seg('idlr', v.idlr) + seg('deux', v.deux) + seg('mg', v.mg) + seg('filae', v.filae) +
    '</div>';
}

/**
 * Frise de couverture : une colonne par tranche de 10 000 matricules.
 *
 * Chaque colonne est une jauge sur 10 000, pas une barre a l'echelle du
 * maximum observe : on lit donc directement la part connue de chaque tranche,
 * et les tranches se comparent entre elles.
 *
 * L'ordre des segments dans le DOM est vert, bleu, jaune. La colonne etant
 * justifiee en bas, le jaune se retrouve au pied de la barre, dans le meme
 * ordre que la legende au-dessus.
 */
function frise(v) {
  const colonnes = v.tranches.map((x) => {
    const connus = x.idlr + x.deux + x.mg + x.filae;
    // Meme plancher que la barre, et pour la meme raison.
    const h = (n) => 'max(2px,' + (n / 10000 * 100).toFixed(2) + '%)';
    // connus/10000*100 arrondi au dixieme : 6137 -> 61,4 %
    const pct = String(Math.round(connus / 10) / 10).replace('.', ',');
    const titre = 'MG ' + nf(x.debut) + ' a ' + nf(x.fin) + '\n' +
      nf(connus) + ' connus sur 10 000 (' + pct + ' %)\n' +
      'Archives seul ' + nf(x.idlr) + '\nLes deux ' + nf(x.deux) + '\nMG seul ' + nf(x.mg) +
      (x.filae ? '\nFilae ' + nf(x.filae) : '');
    // Le rose est en tete du DOM donc en haut de la colonne : une saisie
    // Filae represente quelques unites sur 10 000, elle serait invisible
    // coincee entre deux gros segments.
    return '<div class=fcol data-debut="' + x.debut + '" data-fin="' + x.fin +
      '" title="' + esc(titre) + '">' +
      ['filae', 'mg', 'deux', 'idlr'].map((p) => !x[p] ? '' :
        '<i style="height:' + h(x[p]) + ';background:var(--' + p + ')"></i>').join('') +
      '</div>';
  }).join('');

  const axe = v.tranches
    .map((x) => '<span>' + (x.debut === 1 ? '0' : (x.debut - 1) / 1000 + 'k') + '</span>')
    .join('');

  return '<div class=frise role=img aria-label="Couverture par tranche de 10 000 matricules">' +
    colonnes + '</div><div class=faxe>' + axe + '</div>';
}

/**
 * Le formulaire de saisie Filae, engendre depuis Filae.SAISIE.
 *
 * Les champs ne sont pas ecrits en dur ici : c'est la meme liste qui sert a
 * la validation cote serveur. Un champ ajoute la-bas apparait ici, et un
 * champ propose ici ne peut pas etre jete en silence a l'arrivee.
 */
function formulaireFilae() {
  const champ = (c) =>
    '<label>' + esc(c.libelle) + (c.requis ? ' <b class=req>*</b>' : '') +
    '<input id="fl-' + c.cle + '" maxlength=200' +
    (c.indice ? ' placeholder="' + esc(c.indice) + '"' : '') +
    (c.requis ? ' required' : '') + '></label>';

  return '<dialog id=dlg class=fl>' +
    '<form id=flform onsubmit="enregistrerFilae();return false">' +
    '<h2>Nouveau matricule Filae</h2>' +
    '<p class=fl-note>Pour un numéro absent des Archives <b>et</b> de MG. ' +
    'Il apparaitra en rose dans les résultats et dans les deux graphiques.</p>' +
    '<div class=fl-grille>' + Filae.SAISIE.map(champ).join('') + '</div>' +
    '<p class=fl-err id=fl-err hidden></p>' +
    '<div class=fl-pied>' +
    '<button type=button onclick="dlg.close()">Annuler</button>' +
    '<button class=p type=submit id=fl-ok>Enregistrer</button>' +
    '</div></form></dialog>';
}

function page(donnees) {
  const c = donnees.compte;
  const v = donnees.couverture;
  const pc = String(Math.round(v.connus / v.total * 1000) / 10).replace('.', ',');

  const s = donnees.sources;
  const srcTxt = [
    s.idlr ? 'Archives : ' + path.basename(s.idlr.fichier) + ' (' + nf(s.idlr.lignes) + ' actes)' : 'Archives : absent',
    s.mg ? 'MG : ' + path.basename(s.mg.fichier) + ' (' + nf(s.mg.lignes) + ' engagés)' : 'MG : absent'
  ].join(' · ');

  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Recherche croisée Archives × MG</title><style>${STYLE}</style></head><body>

<div class=tete>
  <h1>${Env.PROD ? '' : '<span class=envdev>DEV</span>'}Recherche croisée</h1>
  <p class=sub>Une requête dans les deux bases à la fois — ${esc(srcTxt)}</p>
</div>

<form id=f onsubmit="go(0);return false">
  <label>Recherche<input type=search id=texte placeholder="nom, identité, notes…" autofocus></label>
  <label>Provenance<select id=provenance>
    <option value="">Toutes</option>
    <option value=idlr>Archives seulement</option>
    <option value=mg>MG seulement</option>
    <option value=deux>Les deux</option>
    <option value=filae>Filae (saisie)</option>
  </select></label>
  <label>MG de<input class=mini type=number id=matMin min=1 max=130000 placeholder=1></label>
  <label>à<input class=mini type=number id=matMax min=1 max=130000 placeholder=130000></label>
  <label>Commune<input type=text id=commune placeholder="Saint-Denis"></label>
  <label>Origine<input type=text id=origine placeholder="Inde"></label>
  <button class=p type=submit>Chercher</button>
  <button type=button onclick="vider()">Effacer</button>
  <button type=button class=fl-ouvrir onclick="ouvrirFilae()"
    title="Saisir un matricule absent des deux bases">+ Matricule Filae</button>
</form>

${formulaireFilae()}

${legende(v)}

<div class=couv>
  <div class=couv-tete>
    <span>Couverture de la série — <b>${nf(v.connus)}</b> matricules connus sur <b>${nf(v.total)}</b></span>
    <span><b>${pc}</b> %</span>
  </div>
  <div class=couv-sous>Ensemble de la série</div>
  ${barreGlobale(v)}
  <div class=couv-sous>Par tranche de 10 000</div>
  ${frise(v)}
  <div class=couv-note>Clique une tranche pour n'afficher qu'elle. Les ${nf(v.total - v.connus)} numéros restants ne sont connus d'aucune des deux bases.</div>
</div>

<div class=etat><span id=resume><b>${nf(c.idlr + c.mg + c.deux)}</b> matricules croisés au total</span><span id=chrono></span></div>
<div class=zone id=zone><div class=vide><b>Lance une recherche</b>Un nom, un matricule, une commune — ou clique sur Chercher pour tout parcourir.</div></div>
<div class=pied id=pied hidden>
  <span id=plage></span>
  <span class=pages><button id=prec>‹ Précédent</button><span id=numpage></span><button id=suiv>Suivant ›</button></span>
</div>

<script>
const $=i=>document.getElementById(i);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf=v=>String(v==null?0:v).replace(/\\B(?=(\\d{3})+(?!\\d))/g,'\\u202f');
const LIB={idlr:'Archives',mg:'MG',deux:'Les deux',filae:'Filae'};
const FILAE_CHAMPS=${JSON.stringify(Filae.SAISIE.map((c) => c.cle))};
let page=0,dernier=null;

/* ---- saisie d'un matricule Filae ---- */
function ouvrirFilae(){
  $('fl-err').hidden=true;
  /* Le numéro cherché est le plus souvent celui qu'on vient de ne pas trouver :
     on le pré-remplit s'il est identifiable, plutôt que de le faire retaper. */
  const t=$('texte').value.trim();
  if(/^\\d{1,6}$/.test(t))$('fl-matricule').value=t;
  else if($('matMin').value&&$('matMin').value===$('matMax').value)$('fl-matricule').value=$('matMin').value;
  dlg.showModal();
  $('fl-matricule').focus();
}

async function enregistrerFilae(){
  const b=$('fl-ok'),err=$('fl-err');
  b.disabled=true;err.hidden=true;
  const corps={};for(const c of FILAE_CHAMPS)corps[c]=$('fl-'+c).value;
  try{
    const r=await(await fetch('/filae',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(corps)})).json();
    if(!r.ok){err.textContent=r.message;err.hidden=false;b.disabled=false;return;}
    /* La barre et la frise sont calculées par le serveur : il faut recharger
       pour qu'elles intègrent la saisie. On arrive filtré sur le nouveau
       matricule — la ligne rose est là, preuve que l'ajout a porté. */
    location.href='?matMin='+r.matricule+'&matMax='+r.matricule;
  }catch(e){err.textContent=e.message;err.hidden=false;b.disabled=false;}
}

const CHAMPS=['texte','provenance','matMin','matMax','commune','origine'];
function qs(p){const u=new URLSearchParams();for(const c of CHAMPS)if($(c).value)u.set(c,$(c).value);u.set('page',p);return u.toString();}
function vider(){for(const c of CHAMPS)$(c).value='';go(0);}

async function go(p){
  page=p;
  const b=document.querySelector('button.p');b.disabled=true;$('chrono').textContent='Recherche…';
  try{
    const r=await(await fetch('/api?'+qs(p))).json();
    history.replaceState(null,'','?'+qs(p));
    marquerTranche();
    dernier=r;
    $('chrono').textContent=nf(r.total)+' résultat'+(r.total>1?'s':'');
    if(!r.total){$('zone').innerHTML='<div class=vide><b>Aucun résultat</b>Élargis la recherche, ou retire un filtre.</div>';$('pied').hidden=true;return;}
    $('zone').innerHTML='<table><thead><tr>'+
      '<th>Provenance</th><th>MG</th><th>Identité (MG)</th><th>Nom (Archives)</th>'+
      '<th>Origine</th><th>Commune</th><th>Date</th><th>Actes</th><th>Notes</th>'+
      '</tr></thead><tbody>'+r.rows.map(l=>
        '<tr class="'+l.provenance+'">'+
        // Une saisie Filae qu'un moissonnage a depuis rattrapée garde une
        // pastille rose : la ligne dit vrai sur sa source, sans effacer que
        // le numéro a d'abord été saisi à la main.
        '<td><span class=prov><i class=pastille style="background:var(--'+l.provenance+')"></i>'+LIB[l.provenance]+
        (l.dansFilae&&l.provenance!=='filae'
          ? ' <i class=pastille title="aussi saisi dans Filae" style="background:var(--filae)"></i>':'')+
        '</span></td>'+
        // Le numero ne renvoie a cherchemg.fr que si MG le connait : sur une
        // ligne jaune, ce lien tomberait sur « pas encore presente ».
        '<td class=mgnum>'+(l.dansMg
          ? '<a href="https://cherchemg.fr/mg.php?MgChaine='+l.mg+'" target=_blank rel=noopener title="Voir cette MG sur cherchemg.fr">'+l.mg+'</a>'
          : l.mg)+'</td>'+
        '<td><span class=coupe title="'+esc(l.identite)+'">'+esc(l.identite)+'</span></td>'+
        // Le nom releve dans un acte renvoie a CET acte, sur le site des Archives.
        '<td><span class=coupe title="'+esc(l.nom)+'">'+(l.urlIdlr
          ? '<a class=acte href="'+esc(l.urlIdlr)+'" target=_blank rel=noopener title="Voir cet acte sur iledelareunion-archive.com">'+esc(l.nom)+'</a>'
          : esc(l.nom))+'</span></td>'+
        '<td><span class=coupe title="'+esc(l.origine)+'">'+esc(l.origine)+'</span></td>'+
        '<td><span class=coupe>'+esc(l.commune)+'</span></td>'+
        '<td class=num>'+esc(l.date)+'</td>'+
        '<td class=num>'+(l.nActes||'')+'</td>'+
        '<td><span class=coupe title="'+esc(l.notes)+'">'+esc(l.notes)+'</span></td>'+
        '</tr>').join('')+'</tbody></table>';
    $('zone').scrollTop=0;
    $('plage').textContent=(p*100+1)+' – '+Math.min((p+1)*100,r.total)+' sur '+nf(r.total);
    $('numpage').textContent='page '+(p+1);
    $('prec').disabled=p<=0;$('suiv').disabled=!r.hasMore;$('pied').hidden=false;
  }catch(e){$('zone').innerHTML='<div class=vide><b>Erreur</b>'+esc(e.message)+'</div>';}
  finally{b.disabled=false;}
}
/* La frise sert aussi de navigation : cliquer une tranche filtre dessus. */
document.querySelectorAll('.fcol').forEach(col=>{
  col.onclick=()=>{
    const d=col.dataset.debut, f=col.dataset.fin;
    const deja=$('matMin').value===d && $('matMax').value===f;
    $('matMin').value=deja?'':d; $('matMax').value=deja?'':f;   // reclic = deselection
    go(0);
  };
});
/** Marque la tranche active : la frise reflete le filtre en cours. */
function marquerTranche(){
  document.querySelectorAll('.fcol').forEach(col=>{
    col.classList.toggle('actif',
      $('matMin').value===col.dataset.debut && $('matMax').value===col.dataset.fin);
  });
}

$('prec').onclick=()=>{if(page>0)go(page-1);};
$('suiv').onclick=()=>{if(dernier&&dernier.hasMore)go(page+1);};

/* Une recherche croisée doit pouvoir se partager : les critères sont dans l'URL. */
const P=new URLSearchParams(location.search);
let amorce=false;
for(const c of CHAMPS)if(P.get(c)){$(c).value=P.get(c);amorce=true;}
if(amorce)go(Number(P.get('page')||0));
<\/script></body></html>`;
}

/* ------------------------------------------------------------- serveur ---- */

/**
 * Lit le corps d'une requete, avec un plafond.
 *
 * Sans plafond, un client qui envoie un flux sans fin ferait grossir la
 * chaine jusqu'a tuer le processus : le serveur n'attendait jusqu'ici aucun
 * corps, cette porte s'ouvre avec la saisie Filae.
 */
function lireCorps(req, max) {
  const plafond = max || 64 * 1024;
  return new Promise((res, rej) => {
    let s = '', n = 0;
    req.on('data', (d) => {
      n += d.length;
      if (n > plafond) { req.destroy(); rej(new Error('Requête trop volumineuse.')); return; }
      s += d;
    });
    req.on('end', () => res(s));
    req.on('error', rej);
  });
}

/**
 * POST /filae — enregistre un matricule saisi a la main.
 *
 * La regle « absent des deux bases » se verifie ici, contre l'index en
 * memoire : c'est le seul endroit qui connait a la fois Archives et MG.
 */
async function posterFilae(req) {
  let brut;
  try { brut = JSON.parse(await lireCorps(req) || '{}'); }
  catch (e) { return { ok: false, message: 'Saisie illisible : ' + e.message }; }

  const donnees = await index();
  const connu = (n) => {
    const l = donnees.lignes.find((x) => x.mg === n);   // une seule fois par saisie
    return l ? { idlr: 'les Archives', mg: 'MG', deux: 'les deux bases' }[l.provenance] || null : null;
  };

  const r = await Filae.ajouter(brut, connu);
  if (r.ok) oublier();   // la barre et la frise doivent bouger tout de suite
  return r;
}

/**
 * Le serveur ne demarre que si ce fichier est lance directement : un
 * require('./recherche.cjs') pour reutiliser construire() ne doit pas
 * ouvrir un port au passage.
 */
function demarrer() {
  return http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = u.pathname === '/api';

  // Le corps est construit AVANT le moindre en-tete : si la generation leve,
  // la reponse n'est pas encore engagee et le catch peut repondre 500
  // proprement. Sinon writeHead(500) sur une reponse deja ouverte tue le
  // processus et le navigateur ne voit qu'une connexion coupee.
  try {
    if (req.method === 'POST' && u.pathname === '/filae') {
      const r = await posterFilae(req);
      res.writeHead(r.ok ? 201 : 400, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'
      });
      return res.end(JSON.stringify(r));
    }

    const donnees = await index();
    const corps = json
      ? JSON.stringify(chercher(donnees, Object.fromEntries(u.searchParams)))
      : page(donnees);

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
    res.end(json ? JSON.stringify({ error: e.message, rows: [], total: 0 }) : 'ECHEC : ' + e.message);
  }
  }).listen(PORT, HOST, () => {
    Env.banniere('recherche croisee');
    console.log('Ouvrir : ' + Env.urlLocale(HOST, PORT));
    if (HOST === '0.0.0.0') console.log('Depuis le reseau : http://<ip-du-serveur>:' + PORT);
    console.log('Archives : ' + (SRC_IDLR() || 'absent'));
    console.log('MG       : ' + (SRC_MG() || 'absent'));
  });
}

if (require.main === module) demarrer();

module.exports = { construire, chercher, empreinte, norm, demarrer, oublier, page, legende, barreGlobale, frise, formulaireFilae };
