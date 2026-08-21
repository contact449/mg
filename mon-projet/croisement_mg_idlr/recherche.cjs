#!/usr/bin/env node
/**
 * ============================================================================
 *  RECHERCHE CROISEE — une seule requete dans toutes les sources a la fois.
 *
 *  Archives (actes.csv)  +  MG (engages.csv)  +  mg oci (mgoci.csv)
 *                        ->  une ligne par matricule
 *
 *  UNE ligne par matricule, coloree selon sa provenance :
 *     jaune  present seulement dans les Archives (IDLR)
 *     vert   present seulement dans MG (cherchemg.fr)
 *     bleu   present dans les DEUX — une seule ligne, la synthese ; le
 *            detail de chaque base ne sort pas ici, il se consulte dans la
 *            recherche dediee de chaque application.
 *     rose   mg oci : saisi a la main parce qu'aucune des deux bases ne le
 *            connait. Seule provenance que cette application ecrit.
 *
 *  La couleur n'est jamais seule : chaque ligne porte aussi le mot
 *  « Archives », « MG », « Les deux » ou « mg oci ». Ce n'est pas de la
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
 *                   MGOCI_CSV=mgoci.csv
 *
 *  Les fichiers sont relus quand ils changent (taille ou date), avec un
 *  plancher proportionnel au cout de la lecture — meme regle que search.cjs.
 *  Une saisie mg oci court-circuite ce plancher : elle doit se voir aussitot.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const CFG = require('./Config.js');
const Env = require('./Env.js');
const { parcourirCsv } = require('./idlr.cjs');
const MgOci = require('./mgoci.cjs');

const PORT = Number(process.env.PORT || 8093);
const HOST = process.env.HOST || '0.0.0.0';
const PAGE = 100;
const MAX_EXEMPLES = 3;

/**
 * Les types d'acte, en toutes lettres et dans l'ordre d'une vie.
 *
 * N, D, M, PM et DIV sont ceux du moissonneur des Archives ; R et L viennent
 * de la saisie mg oci, qui distingue ce que le site range sous les naissances.
 * Un code inconnu s'affiche tel quel plutot que d'etre tu : une ligne editee
 * a la main ne doit pas perdre son type en silence.
 *
 * L'ordre des cles est celui de la colonne, et c'est celui d'une vie, pas
 * celui du fichier — deux matricules portant les memes actes doivent se lire
 * pareil, quel que soit l'ordre ou le moissonneur les a rencontres.
 */
const TYPE_ACTE = { N: 'Naissance', R: 'Reconnaissance', L: 'Légitimation',
                    M: 'Mariage', PM: 'Promesse', DIV: 'Divorce', D: 'Décès' };
const ORDRE_TYPE = Object.keys(TYPE_ACTE);
const rangType = (t) => {
  const i = ORDRE_TYPE.indexOf(t);
  return i === -1 ? ORDRE_TYPE.length : i;   // inconnu : a la fin, jamais perdu
};

/**
 * Les types d'un matricule, dedoublonnes et en toutes lettres.
 *
 * Un matricule porte souvent plusieurs actes — naissance puis mariage puis
 * deces. La colonne les donne tous, separes comme les notes : « Naissance ·
 * Mariage ». Dedoublonner est indispensable, trois actes de naissance pour
 * une fratrie homonyme n'ecriraient sinon que trois fois le meme mot.
 */
function typesEnClair() {
  const vus = new Set();
  for (const s of arguments) if (s) for (const t of s) vus.add(t);
  return [...vus].sort((p, q) => rangType(p) - rangType(q))
    .map((t) => TYPE_ACTE[t] || t).join(' · ');
}

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

/**
 * Ajoute un exemplaire a l'entree d'un matricule, en bornant la memoire.
 *
 * `types` est le seul champ qui echappe au plafond des exemples : c'est un
 * ensemble de codes d'une lettre ou deux, il ne peut pas grossir au-dela des
 * sept types existants. La colonne Type dit donc tout ce que le matricule
 * porte, la ou trois exemples sur dix actes tairaient un mariage.
 */
function ajouter(carte, mg, exemple) {
  let e = carte.get(mg);
  if (!e) { e = { n: 0, exemples: [], types: new Set() }; carte.set(mg, e); }
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
  const mgoci = new Map();
  let statIdlr = { lignes: 0, doublons: 0 };
  let statMg = { lignes: 0, doublons: 0 };

  if (fIdlr) {
    statIdlr = await lireCsv(fIdlr, (l, i) => {
      const num = Number(String(l[i('matricule')] || '').replace(/\D/g, ''));
      if (!num) return;
      // Normalise : la colonne est ecrite par un moissonneur, mais le CSV
      // peut avoir ete repris a la main entre-temps.
      const type = String(l[i('type_acte')] || '').trim().toUpperCase();
      ajouter(idlr, num, {
        nom: l[i('nom')] || '', prenom: l[i('prenom')] || '',
        commune: l[i('commune')] || '', date: l[i('date_iso')] || '',
        type: type, obs: l[i('obs')] || '',
        origine: l[i('origine')] || '',
        // Entourage releve dans l'acte. Le conjoint est la depuis toujours ;
        // les parents n'arrivent qu'avec un moissonnage posterieur a l'ajout
        // de leurs colonnes. i() rend -1 pour une colonne absente, d'ou || ''.
        //
        // Les trois types d'actes donnent le PRENOM du pere et le NOM COMPLET
        // de la mere (verifie sur pages reelles le 21/08/2026 : naissance
        // 82/98/96 %, deces 58/66/64 %, mariage 80/94/92 %). Aucun ne donne le
        // NOM du pere : c'est le patronyme de la personne, deja en colonne nom.
        conjointNom: l[i('conjoint_nom')] || '', conjointPrenom: l[i('conjoint_prenom')] || '',
        pereNom: l[i('pere_nom')] || '', perePrenom: l[i('pere_prenom')] || '',
        mereNom: l[i('mere_nom')] || '', merePrenom: l[i('mere_prenom')] || '',
        pereDecede: !!l[i('pere_decede')], mereDecede: !!l[i('mere_decede')],
        parrain: l[i('parrain')] || '', marraine: l[i('marraine')] || '',
        // Lien vers l'acte sur iledelareunion-archive.com. Environ un tiers
        // des actes n'en ont pas : on affichera alors le nom sans lien.
        url: l[i('url_demande_photo')] || ''
      });
      if (type) idlr.get(num).types.add(type);
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

  // mg oci : la saisie manuelle. Seule source que cette application ecrit,
  // et seule a n'avoir aucun moissonneur derriere elle.
  for (const r of await MgOci.lire()) {
    ajouter(mgoci, r.matricule, r);
    if (r.type_acte) mgoci.get(r.matricule).types.add(String(r.type_acte).trim().toUpperCase());
  }

  /**
   * La provenance d'un numero, decidee UNE fois. Lignes, legende, barre et
   * frise appellent toutes cette fonction : leurs totaux ne peuvent donc pas
   * diverger, et ajouter une provenance ne demande pas de retoucher quatre
   * comptages qui doivent rester d'accord.
   *
   * mg oci vient en dernier parce qu'il n'a pas vocation a masquer une base
   * moissonnee : si un rafraichissement finit par apporter le numero, c'est
   * Archives ou MG qui parle, et `dansMgOci` garde la trace de la saisie.
   */
  const provenanceDe = (n) => (idlr.has(n) && mg.has(n)) ? 'deux'
    : idlr.has(n) ? 'idlr' : mg.has(n) ? 'mg' : 'mgoci';

  // Fusion : une entree par matricule, avec sa provenance.
  const lignes = [];
  const tous = new Set([...idlr.keys(), ...mg.keys(), ...mgoci.keys()]);
  for (const num of tous) {
    const a = idlr.get(num);
    const b = mg.get(num);
    const c = mgoci.get(num);
    const provenance = provenanceDe(num);
    const xa = (a && a.exemples[0]) || {};
    const xb = (b && b.exemples[0]) || {};
    const xc = (c && c.exemples[0]) || {};

    // Une fiche mg oci porte des champs qu'aucune des deux bases n'a : on les
    // replie dans les colonnes existantes plutot que d'en ajouter cinq qui
    // resteraient vides sur 99 % des lignes.
    const dateMgOci = [xc.naissance ? '° ' + xc.naissance : '',
                       xc.deces ? '† ' + xc.deces : ''].filter(Boolean).join(' ');
    /**
     * La commune d'une fiche mg oci : la ville saisie, sinon le lieu de
     * naissance. Sur un matricule qu'aucune des deux bases ne connait, le
     * lieu de naissance est souvent le seul lieu qu'on ait — une colonne
     * vide en dirait moins. Et quand il n'est PAS celui affiche ici, il
     * repart dans les notes, nomme : sinon la saisie serait perdue de vue.
     */
    const communeMgOci = xc.ville || xc.lieu_naissance || '';
    const naissanceLieu = xc.lieu_naissance && xc.lieu_naissance !== communeMgOci
      ? 'né(e) à ' + xc.lieu_naissance : '';
    /**
     * Le reste va dans les notes, la ou va deja le champ libre des Archives.
     * Type d'acte et age n'ont d'equivalent dans aucune des deux bases : deux
     * colonnes de plus resteraient vides sur 99 % des lignes. L'age est
     * prefixe parce qu'un « 32 » seul, au milieu d'une note, ne se lit pas.
     */
    const detailMgOci = [naissanceLieu, xc.age ? 'âge : ' + xc.age : '',
                         xc.remarque, xc.divers2].filter(Boolean).join(' · ');

    /**
     * Le type d'acte : celui des Archives, plus celui de la saisie quand un
     * moissonnage l'a rattrapee. Les deux ont leur mot a dire — le site
     * range reconnaissances et legitimations sous les naissances, et c'est
     * justement la distinction que la saisie apporte.
     *
     * MG n'en donne aucun : la colonne reste vide sur une ligne verte, et
     * son tiret gris dit « pas releve » plutot que « pas d'acte ».
     */
    const type = typesEnClair(a && a.types, c && c.types);

    /**
     * L'entourage : conjoint, pere, mere, dans une seule colonne.
     *
     * Trois colonnes de plus seraient vides sur la quasi-totalite des lignes
     * — le conjoint ne concerne que les mariages (7,5 % des actes) et les
     * parents ne sont releves que la aussi. Une colonne qui se remplit d'un
     * cote ou de l'autre reste lisible ; trois colonnes vides ne le sont pas.
     *
     * Archives d'abord, mg oci en secours : une ligne bleue ou jaune montre ce
     * que l'acte dit, une ligne rose ce que tu as saisi.
     */
    /**
     * Père et mère, chacun dans SA colonne.
     *
     * Ils tenaient dans une colonne « Famille » commune tant qu'ils étaient
     * rares. Ils ne le sont pas : le site les donne sur les naissances, les
     * décès ET les mariages — de 58 à 98 % selon le champ et le type. Une
     * colonne partagée avec le conjoint obligerait à lire des préfixes pour
     * savoir de qui on parle ; deux colonnes se lisent d'un coup d'œil.
     *
     * Le NOM du père n'est donné par AUCUN type d'acte : c'est le patronyme
     * de la personne, déjà dans la colonne Nom. On affiche donc son prénom
     * seul et on ne recopie pas celui de l'enfant — 11 % des naissances sont
     * des reconnaissances, où l'enfant peut porter un autre nom.
     */
    const paire = (nom, prenom) => [nom, prenom].filter(Boolean).join(' ');
    const mort = (v, d) => (v ? v + (d ? ' †' : '') : (d ? '†' : ''));
    const pere = mort(paire(xa.pereNom, xa.perePrenom) || xc.pere, xa.pereDecede);
    const mere = mort(paire(xa.mereNom, xa.merePrenom) || xc.mere, xa.mereDecede);
    const conjoint = paire(xa.conjointNom, xa.conjointPrenom) || xc.conjoint || '';

    lignes.push({
      mg: num,
      provenance,
      identite: b ? b.exemples.map((x) => x.identite).filter(Boolean).join(' · ') : '',
      nom: [xa.nom, xa.prenom].filter(Boolean).join(' ') ||
           [xc.nom, xc.prenom].filter(Boolean).join(' '),
      origine: xb.origine || xa.origine || '',
      commune: xa.commune || communeMgOci,
      type,
      date: xb.naissance || xb.arrivee || xa.date || dateMgOci,
      pere,
      mere,
      conjoint,
      nActes: a ? a.n : 0,
      nEngages: b ? b.n : 0,
      notes: xb.notes || xa.obs || detailMgOci,
      dansMgOci: !!c,               // saisi a la main, meme si une base l'a rattrape depuis
      // On prend le premier acte QUI A une URL, pas simplement le premier :
      // environ un tiers des actes n en ont pas, et se rabattre sur le
      // premier venu priverait de lien des matricules qui en meritent un.
      urlIdlr: (a && (a.exemples.find((x) => x.url) || {}).url) || '',
      dansMg: !!b,                  // MG connait-il ce matricule ?
      // champ de recherche prepare une fois, pas a chaque requete
      foin: norm([
        num, type,
        b ? b.exemples.map((x) => [x.identite, x.notes, x.sources, x.origine, x.contributeur].join(' ')).join(' ') : '',
        a ? a.exemples.map((x) => [x.nom, x.prenom, x.commune, x.obs, x.origine,
          x.conjointNom, x.conjointPrenom, x.pereNom, x.perePrenom,
          x.mereNom, x.merePrenom, x.parrain, x.marraine].join(' ')).join(' ') : '',
        c ? c.exemples.map((x) => [x.nom, x.prenom, x.ville, x.age,
          x.naissance, x.lieu_naissance, x.deces, x.conjoint, x.pere, x.mere,
          x.remarque, x.divers2].join(' ')).join(' ') : ''
      ].join(' '))
    });
  }
  lignes.sort((x, y) => x.mg - y.mg);

  const compter = (liste, prov) => liste.filter((n) => provenanceDe(n) === prov).length;
  const tousTab = [...tous];

  return {
    lignes,
    // Les matricules mg oci qu'un moissonnage a fini par rattraper. Ils ne
    // comptent plus comme mg oci (Archives ou MG fait foi), mais les taire
    // laisserait croire que la saisie a ete perdue.
    absorbes: [...mgoci.keys()].filter((n) => idlr.has(n) || mg.has(n)).length,
    sources: {
      idlr: fIdlr ? { fichier: fIdlr, ...statIdlr } : null,
      mg: fMg ? { fichier: fMg, ...statMg } : null,
      mgoci: { fichier: MgOci.FICHIER(), lignes: mgoci.size }
    },
    compte: {
      idlr: compter(tousTab, 'idlr'),
      mg: compter(tousTab, 'mg'),
      deux: compter(tousTab, 'deux'),
      mgoci: compter(tousTab, 'mgoci')
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
        mgoci: compter(v, 'mgoci'),

        // 13 tranches de 10 000 : 1-10 000, 10 001-20 000 ... 120 001-130 000.
        tranches: (() => {
          const T = [];
          for (let i = 0; i < 13; i++) {
            T.push({ debut: i * 10000 + 1, fin: (i + 1) * 10000, idlr: 0, mg: 0, deux: 0, mgoci: 0 });
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
  // mgoci.csv n'existe pas tant qu'aucune saisie n'a eu lieu : son apparition
  // doit elle aussi changer la signature, d'ou le marqueur explicite.
  const p = [SRC_IDLR(), SRC_MG(), MgOci.FICHIER()].filter(Boolean);
  return p.map((f) => {
    if (!fs.existsSync(f)) return f + ':absent';
    const s = fs.statSync(f);
    return f + ':' + s.mtimeMs + ':' + s.size;
  }).join('|');
}

/**
 * Force la reconstruction au prochain appel.
 *
 * Sans ca, une saisie mg oci pourrait attendre jusqu'a une minute avant
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
--idlr:#eda100;--mg:#008300;--deux:#2a78d6;--mgoci:#b81e73;
--idlr-fond:#fdf6e3;--mg-fond:#e9f5e9;--deux-fond:#e8f1fd;--mgoci-fond:#fceaf3}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])){color-scheme:dark;
--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;
--bord:rgba(255,255,255,.10);--champ:#111110;--focus:#3987e5;
--idlr:#c98500;--mg:#008300;--deux:#3987e5;--mgoci:#bd287a;
--idlr-fond:#2a2114;--mg-fond:#132015;--deux-fond:#111e2e;--mgoci-fond:#2b1122}}
:root[data-theme=dark]{color-scheme:dark;--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;
--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--bord:rgba(255,255,255,.10);--champ:#111110;
--focus:#3987e5;--idlr:#c98500;--mg:#008300;--deux:#3987e5;--mgoci:#bd287a;
--idlr-fond:#2a2114;--mg-fond:#132015;--deux-fond:#111e2e;--mgoci-fond:#2b1122}
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
/* Le bouton de saisie porte le rose de mg oci : on sait ce qu'il produit
   avant de l'avoir ouvert. */
.fl-ouvrir{border-color:var(--mgoci);color:var(--mgoci);font-weight:600}
.fl-ouvrir:hover{background:var(--mgoci-fond)}
dialog.fl{border:1px solid var(--bord);border-radius:12px;padding:0;max-width:660px;width:92vw;
background:var(--surface);color:var(--ink);box-shadow:0 12px 40px rgba(0,0,0,.28);
/* Cinq blocs ne tiennent pas sur un ecran d ordinateur portable : la
   boite defile plutot que de pousser le bouton Enregistrer hors champ. */
max-height:90vh;overflow:auto}
dialog.fl::backdrop{background:rgba(0,0,0,.42)}
dialog.fl form{display:block;padding:18px 20px 16px;border:0;background:none;margin:0}
dialog.fl h2{font-size:15px;font-weight:650;margin:0 0 4px}
dialog.fl h2::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;
background:var(--mgoci);margin-right:8px;vertical-align:1px}
.fl-note{font-size:12px;color:var(--ink2);margin:0 0 16px}
/* Un bloc par groupe de champs. L'intitule reprend la graisse des sous-titres
   de la couverture : c'est le meme role — dire ou l'on est avant de lire. */
.fl-bloc{border:0;padding:0;margin:0 0 18px;min-width:0}
.fl-bloc legend{display:block;width:100%;padding:0 0 6px;margin:0 0 11px;
font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;
color:var(--muted);border-bottom:1px solid var(--bord)}
/* La grille de saisie. Toute la mise en page tient dans ces quatre regles,
   et chacune repare un desalignement precis. */
/* auto-FILL et non auto-fit : auto-fit supprime les pistes vides, si bien que
   « L'acte » et « Notes », qui n'ont que deux champs, les etalaient sur toute
   la largeur pendant que « Famille » en tenait trois. Les pistes conservees,
   un champ vaut une piste dans les cinq blocs — les colonnes se superposent
   donc d'un bloc a l'autre, quel que soit le nombre de champs. */
.fl-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));
gap:13px 14px;align-items:end}
/* Un libelle qui passe sur deux lignes (« Numéro de matricule » en etroit)
   ferait descendre SON champ et lui seul. Cale par le bas : les champs d'une
   meme ligne restent alignes, c'est le libelle qui monte. */
.fl-grille label{gap:5px;min-width:0}
/* Hauteur imposee : un <select> et un <input> ne se calculent pas pareil
   d'un navigateur a l'autre, et le menu du type d'acte depassait son voisin
   de deux pixels. 34 px laissent la ligne de texte respirer (18,1 px) dans
   les 12 px de marge interne. */
.fl-grille input,.fl-grille select{width:100%;height:34px}
.req{color:var(--mgoci)}
.fl-err{margin:12px 0 0;padding:9px 11px;border-radius:7px;font-size:12.5px;
background:var(--mgoci-fond);color:var(--ink);border-left:3px solid var(--mgoci)}
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
/* Les deux colonnes de parents : ce qu on vient chercher, donc lisibles
   sans effort. Le gris des cases vides dit « non relevé » sans bruit. */
td.parent{max-width:190px}
/* Le type d acte : MG n en donne pas, la case vide doit dire « non relevé »
   et non « aucun acte » — meme tiret gris que pour les parents. */
td.type{max-width:170px}
td.parent:empty::after,td.parent .coupe:empty::after,
td.type:empty::after,td.type .coupe:empty::after{content:"—";color:var(--muted)}
/* La couleur de provenance : un fond tres pale + un liseré franc a gauche.
   Un aplat sature sur toute la ligne rendrait le texte illisible. */
tr.idlr{background:var(--idlr-fond)}tr.mg{background:var(--mg-fond)}tr.deux{background:var(--deux-fond)}
tr.mgoci{background:var(--mgoci-fond)}
tr.idlr td:first-child{box-shadow:inset 3px 0 var(--idlr)}
tr.mg td:first-child{box-shadow:inset 3px 0 var(--mg)}
tr.deux td:first-child{box-shadow:inset 3px 0 var(--deux)}
tr.mgoci td:first-child{box-shadow:inset 3px 0 var(--mgoci)}
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
    item('mgoci', 'mg oci (saisie)', v.mgoci) +
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
  // segment de 0,01 px — invisible. Une saisie mg oci qui n'apparait pas
  // serait prise pour une saisie perdue. La proportion est donc legerement
  // faussee vers le haut pour les tres petits effectifs ; les nombres exacts
  // restent dans la legende juste au-dessus.
  const seg = (couleur, n) => !n ? '' :
    '<i style="width:max(2px,' + lg(n) + '%);background:var(--' + couleur + ')"></i>';

  // Meme ordre que dans la frise, lue de bas en haut : les deux visuels se
  // superposent mentalement au lieu de se contredire.
  return '<div class=piste role=img aria-label="Couverture de la serie entiere">' +
    seg('idlr', v.idlr) + seg('deux', v.deux) + seg('mg', v.mg) + seg('mgoci', v.mgoci) +
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
    const connus = x.idlr + x.deux + x.mg + x.mgoci;
    // Meme plancher que la barre, et pour la meme raison.
    const h = (n) => 'max(2px,' + (n / 10000 * 100).toFixed(2) + '%)';
    // connus/10000*100 arrondi au dixieme : 6137 -> 61,4 %
    const pct = String(Math.round(connus / 10) / 10).replace('.', ',');
    const titre = 'MG ' + nf(x.debut) + ' a ' + nf(x.fin) + '\n' +
      nf(connus) + ' connus sur 10 000 (' + pct + ' %)\n' +
      'Archives seul ' + nf(x.idlr) + '\nLes deux ' + nf(x.deux) + '\nMG seul ' + nf(x.mg) +
      (x.mgoci ? '\nmg oci ' + nf(x.mgoci) : '');
    // Le rose est en tete du DOM donc en haut de la colonne : une saisie
    // mg oci represente quelques unites sur 10 000, elle serait invisible
    // coincee entre deux gros segments.
    return '<div class=fcol data-debut="' + x.debut + '" data-fin="' + x.fin +
      '" title="' + esc(titre) + '">' +
      ['mgoci', 'mg', 'deux', 'idlr'].map((p) => !x[p] ? '' :
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
 * Le formulaire de saisie mg oci, engendre depuis MgOci.groupes().
 *
 * Les champs ne sont pas ecrits en dur ici : c'est la meme liste qui sert a
 * la validation cote serveur. Un champ ajoute la-bas apparait ici, et un
 * champ propose ici ne peut pas etre jete en silence a l'arrivee.
 *
 * Le decoupage en blocs vient de la meme liste. Quatorze champs a la file
 * obligeraient a lire chaque etiquette pour trouver le pere ; cinq intitules
 * disent d'abord OU regarder, les etiquettes ensuite quoi ecrire. Un fieldset
 * plutot qu'un simple titre : c'est ce qu'un lecteur d'ecran annonce avant
 * chaque champ du bloc, « Famille — Père » au lieu de « Père » seul.
 */
function formulaireMgOci() {
  const champ = (c) =>
    '<label>' + esc(c.libelle) + (c.requis ? ' <b class=req>*</b>' : '') +
    (c.choix
      // La premiere option est vide, et c'est elle qui est retenue au
      // depart : le type d'acte n'est pas toujours su, et un menu ouvert sur
      // « Acte de naissance » enregistrerait une naissance a chaque saisie
      // ou l'on n'y touche pas.
      ? '<select id="fl-' + c.cle + '"><option value="">— non précisé —</option>' +
        c.choix.map((o) => '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>').join('') +
        '</select>'
      : '<input id="fl-' + c.cle + '" maxlength=200' +
        (c.indice ? ' placeholder="' + esc(c.indice) + '"' : '') +
        (c.requis ? ' required' : '') + '>') +
    '</label>';

  const bloc = (g) =>
    '<fieldset class=fl-bloc><legend>' + esc(g.titre) + '</legend>' +
    '<div class=fl-grille>' + g.champs.map(champ).join('') + '</div></fieldset>';

  return '<dialog id=dlg class=fl>' +
    '<form id=flform onsubmit="enregistrerMgOci();return false">' +
    '<h2>Nouveau matricule mg oci</h2>' +
    '<p class=fl-note>Pour un numéro absent des Archives <b>et</b> de MG. ' +
    'Il apparaitra en rose dans les résultats et dans les deux graphiques.</p>' +
    MgOci.groupes().map(bloc).join('') +
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
    <option value=mgoci>mg oci (saisie)</option>
  </select></label>
  <label>MG de<input class=mini type=number id=matMin min=1 max=130000 placeholder=1></label>
  <label>à<input class=mini type=number id=matMax min=1 max=130000 placeholder=130000></label>
  <label>Commune<input type=text id=commune placeholder="Saint-Denis"></label>
  <label>Origine<input type=text id=origine placeholder="Inde"></label>
  <button class=p type=submit>Chercher</button>
  <button type=button onclick="vider()">Effacer</button>
  <button type=button class=fl-ouvrir onclick="ouvrirMgOci()"
    title="Saisir un matricule absent des deux bases">+ Matricule mg oci</button>
</form>

${formulaireMgOci()}

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
const LIB={idlr:'Archives',mg:'MG',deux:'Les deux',mgoci:'mg oci'};
const MGOCI_CHAMPS=${JSON.stringify(MgOci.SAISIE.map((c) => c.cle))};
let page=0,dernier=null;

/* ---- saisie d'un matricule mg oci ---- */
function ouvrirMgOci(){
  $('fl-err').hidden=true;
  /* Le numéro cherché est le plus souvent celui qu'on vient de ne pas trouver :
     on le pré-remplit s'il est identifiable, plutôt que de le faire retaper. */
  const t=$('texte').value.trim();
  if(/^\\d{1,6}$/.test(t))$('fl-matricule').value=t;
  else if($('matMin').value&&$('matMin').value===$('matMax').value)$('fl-matricule').value=$('matMin').value;
  dlg.showModal();
  $('fl-matricule').focus();
}

async function enregistrerMgOci(){
  const b=$('fl-ok'),err=$('fl-err');
  b.disabled=true;err.hidden=true;
  const corps={};for(const c of MGOCI_CHAMPS)corps[c]=$('fl-'+c).value;
  try{
    const r=await(await fetch('/mgoci',{method:'POST',
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
      '<th>Père</th><th>Mère</th><th>Conjoint</th><th>Origine</th><th>Commune</th><th>Date</th><th>Type</th><th>Actes</th><th>Notes</th>'+
      '</tr></thead><tbody>'+r.rows.map(l=>
        '<tr class="'+l.provenance+'">'+
        // Une saisie mg oci qu'un moissonnage a depuis rattrapée garde une
        // pastille rose : la ligne dit vrai sur sa source, sans effacer que
        // le numéro a d'abord été saisi à la main.
        '<td><span class=prov><i class=pastille style="background:var(--'+l.provenance+')"></i>'+LIB[l.provenance]+
        (l.dansMgOci&&l.provenance!=='mgoci'
          ? ' <i class=pastille title="aussi saisi dans mg oci" style="background:var(--mgoci)"></i>':'')+
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
        // Père et mère, chacun dans sa colonne : c'est ce qu'on vient
        // chercher, ça ne se lit pas derrière un préfixe.
        '<td class=parent><span class=coupe title="'+esc(l.pere)+'">'+esc(l.pere)+'</span></td>'+
        '<td class=parent><span class=coupe title="'+esc(l.mere)+'">'+esc(l.mere)+'</span></td>'+
        '<td><span class=coupe title="'+esc(l.conjoint)+'">'+esc(l.conjoint)+'</span></td>'+
        '<td><span class=coupe title="'+esc(l.origine)+'">'+esc(l.origine)+'</span></td>'+
        '<td><span class=coupe>'+esc(l.commune)+'</span></td>'+
        '<td class=num>'+esc(l.date)+'</td>'+
        // Le type en toutes lettres, pas le code : « N » ne se lit pas.
        // Plusieurs actes, plusieurs types — le titre donne la liste
        // entiere quand la cellule la tronque.
        '<td class=type><span class=coupe title="'+esc(l.type)+'">'+esc(l.type)+'</span></td>'+
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
 * corps, cette porte s'ouvre avec la saisie mg oci.
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
 * POST /mgoci — enregistre un matricule saisi a la main.
 *
 * La regle « absent des deux bases » se verifie ici, contre l'index en
 * memoire : c'est le seul endroit qui connait a la fois Archives et MG.
 */
async function posterMgOci(req) {
  let brut;
  try { brut = JSON.parse(await lireCorps(req) || '{}'); }
  catch (e) { return { ok: false, message: 'Saisie illisible : ' + e.message }; }

  const donnees = await index();
  const connu = (n) => {
    const l = donnees.lignes.find((x) => x.mg === n);   // une seule fois par saisie
    return l ? { idlr: 'les Archives', mg: 'MG', deux: 'les deux bases' }[l.provenance] || null : null;
  };

  const r = await MgOci.ajouter(brut, connu);
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
    if (req.method === 'POST' && u.pathname === '/mgoci') {
      const r = await posterMgOci(req);
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

module.exports = { construire, chercher, empreinte, norm, demarrer, oublier, page, legende, barreGlobale, frise, formulaireMgOci };
