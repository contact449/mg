#!/usr/bin/env node
/**
 * ============================================================================
 *  Tableau de bord du croisement — serveur HTTP sans dependance.
 *  Lit resume.json / historique.json et sert aussi les CSV en telechargement.
 *
 *  Usage :  node serve.cjs                # http://<vps>:8092
 *  Reglages (env) : PORT=8092  HOST=0.0.0.0  CROIS_OUT=<dossier des sorties>
 *
 *  Meme acces que les autres services du VPS : http://10.0.0.1:8092 via
 *  WireGuard, ou tunnel  ssh -p 2222 -L 8092:localhost:8092 ubuntu@10.0.0.1
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const CFG = require('./Config.js');
const Env = require('./Env.js');

const PORT = Number(process.env.PORT || 8092);
const HOST = process.env.HOST || '0.0.0.0';

const lireJson = (cle) => {
  const f = CFG.chemin(cle);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => String(v == null ? 0 : v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** ISO -> jj/mm/aaaa, avec l'heure si demandée. */
const dateFr = (iso, avecHeure) => {
  if (!iso) return '';
  const d = String(iso).slice(0, 10).split('-');
  const jour = d[2] + '/' + d[1] + '/' + d[0];
  return avecHeure ? jour + ' à ' + String(iso).slice(11, 16) : jour;
};

/* ------------------------------------------------------------------- vue --- */

const STYLE = `
:root{color-scheme:light;--surface-1:#fcfcfb;--plane:#f9f9f7;--text-primary:#0b0b0b;
--text-secondary:#52514e;--text-muted:#898781;--gridline:#e1e0d9;--border:rgba(11,11,11,.10);
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--track:#cde2fb}
@media(prefers-color-scheme:dark){:root:where(:not([data-theme=light])){color-scheme:dark;
--surface-1:#1a1a19;--plane:#0d0d0d;--text-primary:#fff;--text-secondary:#c3c2b7;
--text-muted:#898781;--gridline:#2c2c2a;--border:rgba(255,255,255,.10);
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--track:#184f95}}
*{box-sizing:border-box}html{background:var(--plane)}html,body{margin:0;min-height:100%}
body{background:var(--plane);color:var(--text-primary);
font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px 22px 28px}
.entete{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
flex-wrap:wrap;margin-bottom:18px}
.hl{font-size:12px;color:var(--text-secondary)}
.hv{font-size:52px;font-weight:600;line-height:1.05;letter-spacing:-.02em;margin:2px 0 3px}
.hs{font-size:12px;color:var(--text-muted)}
.jauges{display:flex;gap:22px;flex-wrap:wrap}
.jauge{min-width:180px}
.jt{display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:5px}
.jt b{color:var(--text-primary);font-variant-numeric:tabular-nums}
.piste{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
.rempl{height:100%;border-radius:4px;background:var(--s1)}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.tuile{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:11px 13px}
.tl{font-size:11px;color:var(--text-secondary)}
.tv{font-size:22px;font-weight:600;margin-top:2px}
.tn{font-size:11px;color:var(--text-muted);margin-top:1px}
.carte{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;
padding:14px 16px 13px;margin-bottom:12px}
.carte h2{font-size:13px;font-weight:600;margin:0}
.carte .sous{font-size:11px;color:var(--text-muted);margin:2px 0 10px}
.carte svg{display:block;width:100%;height:auto}
.legende{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 10px;padding:0;list-style:none}
.legende li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-secondary)}
.past{width:10px;height:10px;border-radius:3px;flex:none}
.legende b{color:var(--text-primary);font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--gridline)}
th{color:var(--text-secondary);font-weight:500}
th.n,td.n{text-align:right}td.n{font-variant-numeric:tabular-nums}
.diag{background:var(--surface-1);border:1px solid var(--border);border-left:3px solid var(--s2);
border-radius:8px;padding:11px 14px;margin-bottom:12px;font-size:12.5px}
.liens{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.lien{font-size:12px;color:var(--text-primary);background:var(--surface-1);
border:1px solid var(--border);border-radius:7px;padding:5px 11px;text-decoration:none}
.lien:hover{background:var(--plane)}
.pied{font-size:11px;color:var(--text-muted);margin-top:16px}
.vide{text-align:center;padding:50px 20px;color:var(--text-secondary)}
.vide .gros{font-size:15px;color:var(--text-primary);margin-bottom:6px}
`;

/** Barre part-a-tout a 3 segments, separes par 2px de fond. Valeurs en legende. */
function partATout(segments, total) {
  const W = 856, H = 26, gap = 2;
  const utile = W - gap * (segments.length - 1);
  let x = 0;
  const parts = segments.map((s) => {
    const w = total ? Math.max(0, utile * s.v / total) : 0;
    const r = Math.min(4, w);
    const d = w <= 0 ? '' :
      `M${x},0h${w - r}a${r},${r} 0 0 1 ${r},${r}v${H - 2 * r}a${r},${r} 0 0 1 ${-r},${r}H${x}Z`;
    x += w + gap;
    return d ? `<path d="${d}" fill="var(--${s.slot})"/>` : '';
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Repartition des matricules">${parts.join('')}</svg>`;
}

function page() {
  const r = lireJson('RESUME');
  const hist = lireJson('HISTORIQUE') || [];

  if (!r) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Croisement MG x IDLR</title>
<style>${STYLE}</style></head><body><div class="vide">
<div class="gros">Aucun croisement n'a encore tourné.</div>
Lance <code>node maj.cjs</code> (ou <code>node croiser.cjs</code> si les deux sources sont déjà là).
</div></body></html>`;
  }

  const total = r.communs + r.idlrAbsentsDeMg + r.mgAbsentsDIdlr;
  const seg = [
    { slot: 's1', v: r.mgAbsentsDIdlr, nom: 'MG seul' },
    { slot: 's3', v: r.communs, nom: 'Communs' },
    { slot: 's2', v: r.idlrAbsentsDeMg, nom: 'IDLR seul' }
  ];
  const pc = (v) => (total ? Math.round(v / total * 1000) / 10 : 0).toString().replace('.', ',');

  const lignesHist = hist.slice(-12).reverse().map((h) => `<tr>
    <td>${esc(dateFr(h.date))}</td><td class="n">${n(h.mg)}</td><td class="n">${n(h.idlr)}</td>
    <td class="n">${n(h.communs)}</td><td class="n">${n(h.idlrAbsentsDeMg)}</td>
    <td class="n">${n(h.mgAbsentsDIdlr)}</td><td class="n">${String(h.recouvrement_idlr_vers_mg).replace('.', ',')} %</td>
  </tr>`).join('');

  const jauge = (titre, valeur, note) => `<div class="jauge"><div class="jt"><span>${titre}</span>
    <span><b>${String(valeur).replace('.', ',')}</b> %</span></div>
    <div class="piste"><div class="rempl" style="width:${Math.min(100, valeur)}%"></div></div>
    <div class="tn">${note}</div></div>`;

  const tuile = (l, v, note) => `<div class="tuile"><div class="tl">${l}</div>
    <div class="tv">${v}</div><div class="tn">${note}</div></div>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Croisement MG x IDLR</title><style>${STYLE}</style></head><body>

<div class="entete">
  <div><div class="hl">Matricules présents dans les deux bases</div>
  <div class="hv">${n(r.communs)}</div>
  <div class="hs">sur ${n(total)} matricules connus au total &middot; croisement du ${esc(dateFr(r.date))}</div></div>
  <div class="jauges">
    ${jauge('Recouvrement IDLR → MG', r.recouvrement.idlr_vers_mg, 'des matricules IDLR sont dans MG')}
    ${jauge('Recouvrement MG → IDLR', r.recouvrement.mg_vers_idlr, 'des matricules MG ont un acte IDLR')}
  </div>
</div>

<div class="kpi">
  ${tuile('cherchemg.fr', n(r.sources.mg.matriculesDistincts), 'matricules · index de ' + r.sources.mg.age_jours + ' j')}
  ${tuile('iledelareunion-archive', n(r.sources.idlr.matriculesDistincts), 'matricules sur ' + n(r.sources.idlr.actesAvecMatricule) + ' actes')}
  ${tuile('Dans IDLR, absents de MG', n(r.idlrAbsentsDeMg), 'à signaler au site')}
  ${tuile('Dans MG, absents d\'IDLR', n(r.mgAbsentsDIdlr), 'aucun acte ne les porte')}
</div>

<div class="diag">${esc(r.diagnostic)}</div>

<div class="carte">
  <h2>Répartition des matricules connus</h2>
  <p class="sous">Un même numéro peut être connu d'une seule des deux bases : c'est là que se trouve le travail.</p>
  <ul class="legende">
    ${seg.map((s) => `<li><span class="past" style="background:var(--${s.slot})"></span>${s.nom}
      <b>${n(s.v)}</b> (${pc(s.v)} %)</li>`).join('')}
  </ul>
  ${partATout(seg, total)}
</div>

<div class="carte">
  <h2>Qualité du rapprochement</h2>
  <p class="sous">Sur les matricules communs, l'identité relevée par MG et le nom porté par l'acte IDLR se ressemblent-ils ?</p>
  <table>
    <tr><th>Indicateur</th><th class="n">Valeur</th></tr>
    <tr><td>Couples comparables</td><td class="n">${n(r.concordanceNoms.testables)}</td></tr>
    <tr><td>Noms discordants</td><td class="n">${n(r.concordanceNoms.discordants)}</td></tr>
    <tr><td>Taux de discordance</td><td class="n">${String(r.concordanceNoms.taux_discordance).replace('.', ',')} %</td></tr>
    <tr><td>Communs sous le seuil ${n(r.serieAmbigue.seuil)} (série ambiguë)</td><td class="n">${n(r.serieAmbigue.communs)}</td></tr>
    <tr><td>Actes IDLR portant un n° hors 1..${n(CFG.MG_MAX)}</td><td class="n">${n(r.sources.idlr.horsPlage)}</td></tr>
  </table>
</div>

${hist.length > 1 ? `<div class="carte"><h2>Évolution</h2>
  <p class="sous">Une ligne par exécution (mise à jour semestrielle).</p>
  <table><tr><th>Date</th><th class="n">MG</th><th class="n">IDLR</th><th class="n">Communs</th>
  <th class="n">IDLR seul</th><th class="n">MG seul</th><th class="n">Recouvr.</th></tr>
  ${lignesHist}</table></div>` : ''}

<div class="carte">
  <h2>Fichiers</h2>
  <p class="sous">CSV produits par le dernier croisement.</p>
  <div class="liens">
    <a class="lien" href="/csv/ABSENTS_MG">idlr_absents_de_mg.csv</a>
    <a class="lien" href="/csv/ABSENTS_IDLR">mg_absents_didlr.csv</a>
    <a class="lien" href="/csv/COMMUNS">communs.csv</a>
    <a class="lien" href="/resume.json">resume.json</a>
  </div>
</div>

<p class="pied">Sources : cherchemg.fr (relevés bénévoles, propriété de leurs contributeurs et releveurs)
et iledelareunion-archive.com (association Arbre). Croisement du ${esc(dateFr(r.date, true))},
calculé en ${r.duree_s} s.</p>
</body></html>`;
}

/* --------------------------------------------------------------- serveur --- */

const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page());
  }

  if (url.pathname === '/resume.json') {
    const f = CFG.chemin('RESUME');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('pas encore de resume'); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(fs.readFileSync(f));
  }

  const m = /^\/csv\/(ABSENTS_MG|ABSENTS_IDLR|COMMUNS)$/.exec(url.pathname);
  if (m) {
    const f = CFG.chemin(m[1]);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('fichier absent : ' + path.basename(f)); }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + path.basename(f) + '"'
    });
    return fs.createReadStream(f).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
});

serveur.listen(PORT, HOST, () => {
  Env.banniere('tableau de bord du croisement');
  console.log('Ouvrir : ' + Env.urlLocale(HOST, PORT));
  if (HOST === '0.0.0.0') console.log('Depuis le reseau : http://<ip-du-serveur>:' + PORT);
  console.log('Sorties lues dans : ' + CFG.DOSSIER);
});
