#!/usr/bin/env node
/**
 * ============================================================================
 *  MISE A JOUR SEMESTRIELLE — rafraichit les deux sources, puis recroise.
 *
 *  Trois etapes, dans cet ordre (chacune desactivable) :
 *    1. IDLR  : `harvest.cjs --refresh` — relit le total de chaque bucket et
 *               ne re-recolte que ceux qui ont grossi. Passe legere, mais
 *               ~3 250 requetes a 3 s : compter plusieurs heures.
 *    2. MG    : `mg.cjs --force` — 26 requetes, ~90 s.
 *    3. croisement + rapport, et notification Discord si un webhook est defini.
 *
 *  Usage :  node maj.cjs                 # tout
 *           node maj.cjs --sans-idlr     # garde l'actes.db/csv existant
 *           node maj.cjs --sans-mg       # garde l'index MG existant
 *           node maj.cjs --dry           # montre ce qui serait fait
 *
 *  Planification : voir systemd/ (timer au 1er janvier et au 1er juillet) ou,
 *  a defaut, la ligne cron donnee dans le README.
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

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
const WEBHOOK = process.env.IDLR_DISCORD_WEBHOOK || '';

const horodatage = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const journal = (...m) => console.log('[' + horodatage() + ']', ...m);

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

async function principal() {
  const t0 = Date.now();
  journal('=== Mise a jour semestrielle MG x IDLR ===');

  /* --- 1. IDLR ----------------------------------------------------------- */
  if (ARGS.includes('--sans-idlr')) {
    journal('IDLR : ignore (--sans-idlr)');
  } else if (!fs.existsSync(CFG.MOISSONNEUR_HARVEST)) {
    journal('IDLR : harvest.cjs introuvable (' + CFG.MOISSONNEUR_HARVEST + ') — ' +
            'on utilisera la base existante telle quelle.');
  } else {
    journal('IDLR : passe de rafraichissement (plusieurs heures)...');
    await lancer(CFG.MOISSONNEUR_HARVEST, ['--refresh']);
    journal('IDLR : termine.');
  }

  /* --- 2. MG ------------------------------------------------------------- */
  if (ARGS.includes('--sans-mg')) {
    journal('MG : ignore (--sans-mg)');
  } else if (!fs.existsSync(CFG.MOISSONNEUR_MG_HARVEST)) {
    journal('MG : moissonneur introuvable (' + CFG.MOISSONNEUR_MG_HARVEST + ') — ' +
            'on utilisera l\'index existant tel quel.');
  } else {
    // Seulement l'index : la phase 2 (fiches, ~33 h) est un chantier a part,
    // qu'on ne relance pas automatiquement tous les six mois.
    journal('MG : remoissonnage de l\'index (26 requetes)...');
    await lancer(CFG.MOISSONNEUR_MG_HARVEST, ['--index', '--force']);
    journal('MG : termine.');
  }

  /* --- 3. croisement ------------------------------------------------------ */
  journal('Croisement...');
  await lancer(path.join(__dirname, 'croiser.cjs'), []);

  if (DRY) { journal('(dry) fin.'); return; }

  const r = JSON.parse(fs.readFileSync(CFG.chemin('RESUME'), 'utf8'));
  const evo = evolution();
  const minutes = Math.round((Date.now() - t0) / 60000);

  const rapport =
    `**Croisement MG x IDLR** — ${horodatage()} (${minutes} min)\n` +
    `MG : ${r.sources.mg.matriculesDistincts} matricules · ` +
    `IDLR : ${r.sources.idlr.matriculesDistincts} matricules\n` +
    `communs **${r.communs}** · dans IDLR seul **${r.idlrAbsentsDeMg}** · ` +
    `dans MG seul **${r.mgAbsentsDIdlr}**\n` +
    `recouvrement IDLR→MG ${r.recouvrement.idlr_vers_mg} %` +
    (evo ? `\n${evo}` : '') +
    `\n${r.diagnostic}`;

  journal('\n' + rapport.replace(/\*\*/g, ''));
  await notifier(rapport);
  journal('=== Termine en ' + minutes + ' min ===');
}

principal().catch((e) => {
  journal('ECHEC : ' + (e && e.message ? e.message : e));
  notifier('**Croisement MG x IDLR — ECHEC**\n' + (e && e.message ? e.message : e))
    .finally(() => process.exit(1));
});
