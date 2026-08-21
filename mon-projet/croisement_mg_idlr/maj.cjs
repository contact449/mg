#!/usr/bin/env node
/**
 * ============================================================================
 *  MISE A JOUR SEMESTRIELLE — rafraichit les deux sources, puis recroise.
 *
 *  Conçu pour tourner SEUL, deux fois par an, sans personne devant l'ecran
 *  (voir systemd/). Trois exigences en decoulent, et elles expliquent la
 *  forme de ce fichier :
 *
 *  1. RIEN NE DOIT MOURIR EN SILENCE. La passe IDLR dure 15 a 28 h et
 *     harvest.cjs abandonne apres 5 echecs d'affilee — soit moins d'une
 *     minute de site indisponible. Sur une nuit entiere, ca arrivera. On
 *     passe donc par superviseur.cjs, qui relance et reprend au checkpoint.
 *
 *  2. ON DOIT SAVOIR QUE CA TOURNE. Une notification part au DEMARRAGE, pas
 *     seulement a la fin ; notify.cjs suit la recolte IDLR en fond ; et
 *     maj_etat.json dit a tout moment quelle etape est en cours, depuis
 *     quand. `node maj.cjs --etat` le lit sans rien lancer.
 *
 *  3. LE RAPPORT UTILE DOIT ARRIVER TOT. Les fiches MG (~33 h) ne servent ni
 *     au croisement ni a ses chiffres : elles passent APRES le rapport. On
 *     recoit le bilan du croisement en fin de nuit, pas deux jours plus tard.
 *
 *  QUATRE ETAPES, dans cet ordre :
 *    1. IDLR   superviseur.cjs --refresh       15 a 28 h — supervise
 *              Relit le total de chaque bucket et ne re-recolte que ceux qui
 *              ont grossi, en dedoublonnant. Ce n'est PAS une demi-mesure :
 *              c'est ce qui rend la mise a jour complete tenable.
 *    2. MG     harvest.cjs --index --force     ~90 s
 *    3. CROISEMENT + rapport Discord           quelques secondes
 *    4. MG     harvest.cjs --fiches            ~33 h — la traine
 *              Reprise sur le fichier de sortie : une coupure ne coute rien.
 *
 *  Usage :  node maj.cjs                    # les quatre etapes
 *           node maj.cjs --etat             # ou en est-on ? (ne lance rien)
 *           node maj.cjs --dry              # montre ce qui serait fait
 *           node maj.cjs --sans-idlr        # garde l'actes.db/csv existant
 *           node maj.cjs --sans-mg          # garde l'index MG existant
 *           node maj.cjs --sans-fiches      # saute la traine de 33 h
 *           node maj.cjs --sans-superviseur # harvest.cjs en direct
 *           node maj.cjs --selftest         # hors ligne, aucune requete
 *
 *  Code de sortie non nul si une etape echoue : systemd marque l'unite en
 *  echec et `systemctl list-timers` le montre.
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CFG = require('./Config.js');
const Env = require('./Env.js');

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
const WEBHOOK = process.env.IDLR_DISCORD_WEBHOOK || '';

const horodatage = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const journal = (...m) => console.log('[' + horodatage() + ']', ...m);

/* ------------------------------------------------------------- etat ------- */

/**
 * maj_etat.json : la seule reponse a « est-ce que ça tourne, et depuis
 * quand ? » qui ne demande ni Discord ni acces SSH. Ecrit a chaque changement
 * d'etape, garde apres la fin — la derniere execution reste consultable.
 */
function ecrireEtat(e) {
  if (DRY) return;
  try { fs.writeFileSync(CFG.chemin('MAJ'), JSON.stringify(e, null, 2)); }
  catch (err) { journal('etat : ecriture impossible — ' + err.message); }
}

function lireEtat() {
  const f = CFG.chemin('MAJ');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/** Un processus repond-il encore ? Le signal 0 ne tue rien, il interroge. */
function vivant(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Affiche l'etat courant. Sans fichier, on le dit — c'est une reponse, pas
 * une erreur : aucune mise a jour n'a encore tourne sur cette machine.
 */
function afficherEtat() {
  const e = lireEtat();
  if (!e) {
    console.log('Aucune mise a jour enregistree (' + CFG.chemin('MAJ') + ' absent).');
    return 0;
  }
  const duree = (a, b) => Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000);

  if (!e.fin) {
    const encore = vivant(e.pid);
    console.log((encore ? 'EN COURS' : 'INTERROMPUE') + ' — demarree le ' + e.debut +
                ' (' + duree(e.debut) + ' min)');
    console.log('  etape : ' + e.etape + ', depuis ' + duree(e.etapeDebut) + ' min');
    console.log('  pid   : ' + e.pid + (encore ? '' : ' — ce processus ne repond plus'));
    if (!encore) {
      console.log('\nLa mise a jour a ete coupee. Relancer la meme commande : les deux');
      console.log('moissonneurs reprennent a leur checkpoint, rien n\'est refait pour rien.');
    }
  } else {
    console.log((e.ok ? 'TERMINEE' : 'ECHOUEE') + ' le ' + e.fin +
                ' (' + duree(e.debut, e.fin) + ' min)');
    if (e.erreur) console.log('  erreur : ' + e.erreur);
  }
  console.log('  etapes : ' + (e.etapes || []).map((x) =>
    x.nom + ' ' + (x.fin ? duree(x.debut, x.fin) + ' min' : '...')).join(' · '));
  return 0;
}

/* ---------------------------------------------------------- processus ----- */

/** Lance un script Node et attend sa fin. Rejette si le code de sortie != 0. */
function lancer(script, args, cwd) {
  return new Promise((resolve, reject) => {
    journal('>', 'node', path.basename(script), args.join(' '));
    if (DRY) return resolve({ dry: true });

    const p = spawn(process.execPath, [script, ...args], {
      cwd: cwd || path.dirname(script),
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env
    });
    p.on('error', reject);
    p.on('close', (code) => code === 0
      ? resolve({ code })
      : reject(new Error(path.basename(script) + ' a termine avec le code ' + code)));
  });
}

/**
 * Demarre notify.cjs en fond pour la duree d'une etape longue.
 *
 * Il ne fait que LIRE le checkpoint et le battement de coeur : il ne peut pas
 * gener la recolte. Sans webhook il n'a rien a dire, on ne le lance pas.
 * Renvoie de quoi l'arreter — a appeler meme en cas d'echec, sinon le
 * processus survit a la mise a jour.
 */
function suivreEnFond() {
  if (DRY || !WEBHOOK || !fs.existsSync(CFG.MOISSONNEUR_NOTIFY)) return () => {};
  let p;
  try {
    p = spawn(process.execPath, [CFG.MOISSONNEUR_NOTIFY], {
      cwd: path.dirname(CFG.MOISSONNEUR_NOTIFY),
      stdio: 'ignore',
      env: process.env
    });
  } catch (e) {
    journal('suivi Discord : impossible a demarrer — ' + e.message);
    return () => {};
  }
  journal('suivi Discord en fond (notify.cjs, pid ' + p.pid + ')');
  const arreter = () => { try { p.kill(); } catch {} };
  process.once('exit', arreter);   // filet : une sortie brutale ne le laisse pas seul
  return arreter;
}

/* ----------------------------------------------------------- Discord ------ */

async function notifier(texte) {
  if (!WEBHOOK) { journal('(pas de webhook Discord : notification ignoree)'); return; }
  if (DRY) { journal('(dry) notification :\n' + texte); return; }
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: texte.slice(0, 1900) })
    });
    journal('Discord : HTTP ' + res.status);
  } catch (e) {
    journal('Discord : echec — ' + e.message);
  }
}

/** Variation depuis l'execution precedente, lue dans historique.json. */
function evolution() {
  const f = CFG.chemin('HISTORIQUE');
  if (!fs.existsSync(f)) return null;
  try {
    const h = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (h.length < 2) return null;
    const a = h[h.length - 2], b = h[h.length - 1];
    const d = (x, y) => (y - x >= 0 ? '+' : '') + (y - x);
    return `depuis le ${a.date.slice(0, 10)} : MG ${d(a.mg, b.mg)}, ` +
           `IDLR ${d(a.idlr, b.idlr)}, communs ${d(a.communs, b.communs)}`;
  } catch { return null; }
}

/** Le rapport de croisement, tel qu'il part sur Discord et dans le journal. */
function rapportCroisement(r, minutes) {
  const evo = evolution();
  return `**Croisement MG x IDLR** — ${horodatage()} (${minutes} min)\n` +
    `MG : ${r.sources.mg.matriculesDistincts} matricules · ` +
    `IDLR : ${r.sources.idlr.matriculesDistincts} matricules\n` +
    `communs **${r.communs}** · dans IDLR seul **${r.idlrAbsentsDeMg}** · ` +
    `dans MG seul **${r.mgAbsentsDIdlr}**\n` +
    `recouvrement IDLR→MG ${r.recouvrement.idlr_vers_mg} %` +
    (evo ? `\n${evo}` : '') +
    `\n${r.diagnostic}`;
}

/* ------------------------------------------------------------- etapes ----- */

/**
 * Les etapes prevues, decidees UNE fois : le plan annonce au demarrage est
 * celui qui s'execute, et le selftest verifie la liste sans rien lancer.
 */
function plan() {
  const p = [];
  if (!ARGS.includes('--sans-idlr')) p.push({ nom: 'IDLR', duree: '15 a 28 h' });
  if (!ARGS.includes('--sans-mg')) p.push({ nom: 'MG index', duree: '~90 s' });
  p.push({ nom: 'croisement', duree: 'quelques secondes' });
  if (!ARGS.includes('--sans-fiches')) p.push({ nom: 'MG fiches', duree: '~33 h' });
  return p;
}

async function principal() {
  const t0 = Date.now();
  journal('=== Mise a jour semestrielle MG x IDLR ===');
  Env.banniere('mise a jour semestrielle');

  // Les deux moissonneurs refusent d'eux-memes en dev ; on le dit tout de
  // suite plutot que de laisser echouer l'etape 1 apres coup.
  if (!Env.RESEAU && !DRY) {
    journal('Environnement dev : les moissonneurs refuseront de sortir.');
    journal('Utilise  OCI_ENV=prod node maj.cjs  (ou --sans-idlr --sans-mg --sans-fiches).');
  }

  const prevues = plan();
  const etat = {
    debut: new Date().toISOString(),
    pid: process.pid,
    etape: prevues[0] ? prevues[0].nom : 'croisement',
    etapeDebut: new Date().toISOString(),
    plan: prevues.map((x) => x.nom),
    etapes: [],
    fin: null,
    ok: null
  };
  ecrireEtat(etat);

  /** Encadre une etape : etat a jour avant, duree notee apres. */
  async function etape(nom, faire) {
    etat.etape = nom;
    etat.etapeDebut = new Date().toISOString();
    const e = { nom, debut: etat.etapeDebut, fin: null };
    etat.etapes.push(e);
    ecrireEtat(etat);
    await faire();
    e.fin = new Date().toISOString();
    ecrireEtat(etat);
  }

  await notifier('**Mise a jour semestrielle — demarrage** ' + horodatage() + '\n' +
    prevues.map((x) => '· ' + x.nom + ' (' + x.duree + ')').join('\n') +
    '\nSuivi : `node maj.cjs --etat` · tableau de bord port 8080');

  /* --- 1. IDLR : la longue passe, supervisee ------------------------------ */
  if (ARGS.includes('--sans-idlr')) {
    journal('IDLR : ignore (--sans-idlr)');
  } else if (!fs.existsSync(CFG.MOISSONNEUR_HARVEST)) {
    journal('IDLR : harvest.cjs introuvable (' + CFG.MOISSONNEUR_HARVEST + ') — ' +
            'on utilisera la base existante telle quelle.');
  } else {
    // Le superviseur relance harvest.cjs a chaque mort et reprend au
    // checkpoint. Sans lui, une minute d'indisponibilite du site suffit a
    // arreter la recolte pour la nuit, et personne ne le voit avant midi.
    const superviser = !ARGS.includes('--sans-superviseur') &&
                       fs.existsSync(CFG.MOISSONNEUR_SUPERVISEUR);
    if (!superviser && !ARGS.includes('--sans-superviseur')) {
      journal('IDLR : superviseur.cjs introuvable — harvest.cjs sera lance en direct.');
    }
    await etape('IDLR', async () => {
      journal('IDLR : passe de rafraichissement (15 a 28 h)' +
              (superviser ? ', sous superviseur...' : '...'));
      const arreterSuivi = suivreEnFond();
      try {
        await lancer(superviser ? CFG.MOISSONNEUR_SUPERVISEUR : CFG.MOISSONNEUR_HARVEST,
                     ['--refresh']);
      } finally {
        arreterSuivi();
      }
      journal('IDLR : termine.');
    });
  }

  /* --- 2. MG : l'index -------------------------------------------------- */
  if (ARGS.includes('--sans-mg')) {
    journal('MG : ignore (--sans-mg)');
  } else if (!fs.existsSync(CFG.MOISSONNEUR_MG_HARVEST)) {
    journal('MG : moissonneur introuvable (' + CFG.MOISSONNEUR_MG_HARVEST + ') — ' +
            'on utilisera l\'index existant tel quel.');
  } else {
    await etape('MG index', async () => {
      journal('MG : remoissonnage de l\'index (26 requetes)...');
      await lancer(CFG.MOISSONNEUR_MG_HARVEST, ['--index', '--force']);
      journal('MG : index termine.');
    });
  }

  /* --- 3. croisement : le rapport part ICI -------------------------------- */
  await etape('croisement', async () => {
    journal('Croisement...');
    await lancer(path.join(__dirname, 'croiser.cjs'), []);
  });

  if (!DRY) {
    const r = JSON.parse(fs.readFileSync(CFG.chemin('RESUME'), 'utf8'));
    const rapport = rapportCroisement(r, Math.round((Date.now() - t0) / 60000));
    journal('\n' + rapport.replace(/\*\*/g, ''));
    await notifier(rapport);
  }

  /* --- 4. MG : les fiches, la traine -------------------------------------- */
  // Apres le rapport, parce qu'elles n'y entrent pas : le croisement lit
  // mg_matricules.csv, jamais mg_fiches.csv. Les faire avant retarderait le
  // bilan de 33 h sans rien y ajouter.
  if (ARGS.includes('--sans-fiches')) {
    journal('MG fiches : ignore (--sans-fiches)');
  } else if (!fs.existsSync(CFG.MOISSONNEUR_MG_HARVEST)) {
    journal('MG fiches : moissonneur introuvable — ignore.');
  } else {
    await etape('MG fiches', async () => {
      journal('MG : fiches detaillees (~33 h, reprise sur le fichier de sortie)...');
      await lancer(CFG.MOISSONNEUR_MG_HARVEST, ['--fiches']);
      journal('MG : fiches terminees.');
    });
    if (!DRY) await notifier('**Fiches MG rafraichies** — ' + horodatage());
  }

  const minutes = Math.round((Date.now() - t0) / 60000);
  etat.etape = 'terminee';
  etat.fin = new Date().toISOString();
  etat.ok = true;
  ecrireEtat(etat);

  if (DRY) { journal('(dry) fin.'); return; }
  journal('=== Termine en ' + minutes + ' min ===');
}

/* ------------------------------------------------------------ selftest ---- */

/**
 * Hors ligne. Ce fichier tourne deux fois par an, a 3 h du matin, sans
 * personne : c'est exactement le code qu'on ne peut pas se permettre de
 * laisser sans test.
 */
function selftest() {
  const os = require('os');
  let ok = 0, ko = 0;
  const dit = (b, t, d) => {
    if (b) { ok++; console.log('OK    ' + t); }
    else { ko++; console.log('ECHEC ' + t + (d !== undefined ? '  -> ' + d : '')); }
  };

  console.log('=== le plan des etapes ===');
  // plan() lit ARGS, fige au chargement du module : on verifie donc la liste
  // par defaut, celle qui part reellement depuis systemd.
  const parDefaut = plan().map((x) => x.nom);
  dit(parDefaut.join(' > ') === 'IDLR > MG index > croisement > MG fiches',
      'quatre etapes, dans l ordre', parDefaut.join(' > '));
  dit(parDefaut.indexOf('croisement') < parDefaut.indexOf('MG fiches'),
      'le croisement passe AVANT les fiches : le rapport n attend pas 33 h');

  console.log('');
  console.log('=== les chemins des outils ===');
  dit(path.basename(CFG.MOISSONNEUR_SUPERVISEUR) === 'superviseur.cjs',
      'le superviseur est designe');
  dit(path.basename(CFG.MOISSONNEUR_NOTIFY) === 'notify.cjs', 'le suivi Discord est designe');
  dit(fs.existsSync(CFG.MOISSONNEUR_SUPERVISEUR),
      'superviseur.cjs existe la ou on l attend', CFG.MOISSONNEUR_SUPERVISEUR);
  dit(fs.existsSync(CFG.MOISSONNEUR_NOTIFY),
      'notify.cjs existe la ou on l attend', CFG.MOISSONNEUR_NOTIFY);

  console.log('');
  console.log('=== sans webhook, rien ne se lance en fond ===');
  const w = process.env.IDLR_DISCORD_WEBHOOK;
  delete process.env.IDLR_DISCORD_WEBHOOK;
  dit(typeof suivreEnFond() === 'function', 'suivreEnFond rend toujours un arret appelable');
  if (w) process.env.IDLR_DISCORD_WEBHOOK = w;

  console.log('');
  console.log('=== le fichier d etat ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maj-'));
  const vraiDossier = CFG.DOSSIER;
  CFG.DOSSIER = tmp;

  dit(lireEtat() === null, 'pas de fichier : pas d etat');
  const e = {
    debut: new Date(Date.now() - 3600000).toISOString(), pid: process.pid,
    etape: 'IDLR', etapeDebut: new Date(Date.now() - 1800000).toISOString(),
    plan: ['IDLR'], etapes: [{ nom: 'IDLR', debut: new Date().toISOString(), fin: null }],
    fin: null, ok: null
  };
  ecrireEtat(e);
  const relu = lireEtat();
  dit(relu !== null && relu.etape === 'IDLR', 'etat ecrit puis relu');
  dit(relu.fin === null, 'une mise a jour en cours n a pas de fin');
  dit(vivant(process.pid), 'notre propre pid est vivant');
  dit(!vivant(999999999), 'un pid inexistant ne l est pas');

  e.fin = new Date().toISOString(); e.ok = true; e.etape = 'terminee';
  ecrireEtat(e);
  dit(lireEtat().ok === true, 'la fin est enregistree');
  dit(afficherEtat() === 0, 'afficherEtat ne leve pas sur un etat termine');

  fs.writeFileSync(path.join(tmp, 'maj_etat.json'), 'ceci n est pas du json', 'utf8');
  dit(lireEtat() === null, 'un fichier illisible ne fait pas tomber la commande');

  CFG.DOSSIER = vraiDossier;
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('');
  console.log('=== le rapport ===');
  const r = {
    sources: { mg: { matriculesDistincts: 19541 }, idlr: { matriculesDistincts: 20582 } },
    communs: 9059, idlrAbsentsDeMg: 11523, mgAbsentsDIdlr: 10482,
    recouvrement: { idlr_vers_mg: 44 }, diagnostic: 'Recouvrement partiel.'
  };
  const txt = rapportCroisement(r, 812);
  dit(txt.indexOf('communs **9059**') !== -1, 'le rapport porte les communs');
  dit(txt.indexOf('44 %') !== -1, 'et le recouvrement');
  dit(txt.indexOf('812 min') !== -1, 'et la duree');
  dit(txt.length < 1900, 'il tient dans la limite d un message Discord', txt.length);

  console.log('');
  console.log(ok + ' OK, ' + ko + ' echec(s)');
  return ko === 0;
}

/* --------------------------------------------------------------- main ----- */

module.exports = { plan, lireEtat, ecrireEtat, vivant, rapportCroisement, selftest };

if (require.main === module) {
  if (ARGS.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else if (ARGS.includes('--etat')) {
    process.exit(afficherEtat());
  } else {
    principal().catch((e) => {
      const msg = e && e.message ? e.message : String(e);
      journal('ECHEC : ' + msg);
      const etat = lireEtat();
      if (etat && !etat.fin) {
        etat.fin = new Date().toISOString();
        etat.ok = false;
        etat.erreur = msg;
        ecrireEtat(etat);
      }
      notifier('**Mise a jour semestrielle — ECHEC**\n' +
               (etat && etat.etape ? 'etape : ' + etat.etape + '\n' : '') + msg)
        .finally(() => process.exit(1));
    });
  }
}
