#!/usr/bin/env node
/**
 * Répare la colonne `matricule` dans actes.db à partir de `obs`, avec la regex
 * corrigée (« N°2-537 » -> « 2537 »). À lancer une fois après avoir constaté des
 * matricules tronqués.
 *
 * Lancer :  node --experimental-sqlite fixmat.cjs
 * Réglage (env) : IDLR_DB=actes.db
 */
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.IDLR_DB || path.join(__dirname, 'actes.db');
const MATRICULE_RE = /[nN]\s*°\s*(\d+(?:[.\-]\d+)*)/;
const matriculeNum = obs => { const m = MATRICULE_RE.exec(obs || ''); return m ? m[1].replace(/\D/g, '') : ''; };

const db = new DatabaseSync(DB);
// Toutes les lignes susceptibles de porter un matricule (ont un ° ) ou qui en
// ont déjà un (à re-vérifier). On ne touche qu'aux lignes qui changent vraiment.
const rows = db.prepare("SELECT rowid, obs, matricule FROM actes WHERE obs LIKE '%°%' OR matricule <> ''").all();
const upd = db.prepare('UPDATE actes SET matricule=? WHERE rowid=?');

db.exec('BEGIN');
let changed = 0;
for (const r of rows) {
  const v = matriculeNum(r.obs);
  if (v !== (r.matricule || '')) { upd.run(v, r.rowid); changed++; }
}
db.exec('COMMIT');
console.log(`${rows.length} lignes examinées, ${changed} matricules corrigés.`);
