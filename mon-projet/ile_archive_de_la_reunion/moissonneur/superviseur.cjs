#!/usr/bin/env node
/**
 * ============================================================================
 *  SUPERVISEUR — relance le moissonneur quand il meurt, et seulement alors.
 *
 *  Une récolte complète, c'est ~35 000 requêtes sur plus de 28 h. harvest.cjs
 *  réessaie 5 fois une requête qui échoue (5 s, 10 s, 15 s, 20 s), puis
 *  abandonne et le processus s'arrête. Cinq échecs d'affilée, c'est moins de
 *  une minute de site indisponible : sur 28 h, ça arrivera. Sans surveillance
 *  la récolte s'arrête à 3 h du matin et personne ne le voit avant midi.
 *
 *  Le checkpoint fait le reste : une relance reprend au bucket suivant, et
 *  au pire un bucket est refait.
 *
 *  Ce n'est PAS une boucle qui insiste. Si le site est réellement hors
 *  service, l'attente entre deux relances double à chaque fois (1, 2, 4…
 *  jusqu'à 30 min), et au bout de PLAFOND_ECHECS échecs sans le moindre
 *  progrès on s'arrête pour de bon. Marteler le serveur d'une association
 *  parce qu'il est en panne serait exactement ce qu'il ne faut pas faire.
 *
 *  Lancer (mêmes arguments et variables que harvest.cjs) :
 *    OCI_RESEAU=1 IDLR_OUT=actes-2026.csv IDLR_CK=checkpoint-2026.json \
 *      node superviseur.cjs
 *
 *  Arrêter : Ctrl+C, ou tuer le processus. Le moissonneur reçoit le signal.
 * ============================================================================
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HARVEST = path.join(__dirname, 'harvest.cjs');
const CK = process.env.IDLR_CK || path.join(__dirname, 'checkpoint.json');

const ATTENTE_MIN = 60 * 1000;          // 1 min après le premier échec
const ATTENTE_MAX = 30 * 60 * 1000;     // plafond : 30 min
const PLAFOND_ECHECS = 8;               // échecs SANS progrès avant d'abandonner

const args = process.argv.slice(2);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const horo = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const dire = (m) => console.log('[superviseur ' + horo() + '] ' + m);

/** Combien de buckets sont faits. Sert à savoir si une tentative a progressé. */
function avancement() {
  try { return (JSON.parse(fs.readFileSync(CK, 'utf8')).done || []).length; }
  catch { return 0; }
}

function lancer() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HARVEST, ...args], { stdio: 'inherit', env: process.env });
    const relayer = (sig) => () => { dire('signal ' + sig + ' — transmis au moissonneur'); p.kill(sig); };
    const onInt = relayer('SIGINT'), onTerm = relayer('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    p.on('exit', (code, signal) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      resolve({ code, signal });
    });
  });
}

(async () => {
  dire('démarrage — ' + avancement() + ' bucket(s) déjà faits');
  let echecs = 0;                     // échecs consécutifs SANS progrès
  let attente = ATTENTE_MIN;

  for (;;) {
    const avant = avancement();
    const { code, signal } = await lancer();

    if (signal) { dire('arrêté par signal ' + signal + ' — on ne relance pas'); process.exit(0); }
    if (code === 0) { dire('récolte terminée (' + avancement() + ' buckets)'); process.exit(0); }

    const apres = avancement();
    const gagnes = apres - avant;

    if (gagnes > 0) {
      // Une tentative qui a avancé n'est pas un échec de fond : le site
      // répond, on a juste perdu la main. On repart vite et on remet le
      // compteur à zéro, sinon une longue récolte finirait par s'auto-bloquer.
      echecs = 0;
      attente = ATTENTE_MIN;
      dire('sorti en ' + code + ' après ' + gagnes + ' bucket(s) — relance dans 60 s (' + apres + '/3250)');
    } else {
      echecs++;
      if (echecs >= PLAFOND_ECHECS) {
        dire(echecs + ' relances sans le moindre progrès — abandon.');
        dire('Le site est probablement hors service. Reprends plus tard :');
        dire('  la même commande repartira du bucket ' + apres + '.');
        process.exit(1);
      }
      dire('sorti en ' + code + ' sans progresser (' + echecs + '/' + PLAFOND_ECHECS +
           ') — nouvelle tentative dans ' + Math.round(attente / 60000) + ' min');
    }

    await dormir(attente);
    if (gagnes === 0) attente = Math.min(attente * 2, ATTENTE_MAX);
  }
})();
