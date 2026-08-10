/* ==================== IDLR (iledelareunion-archive.com) ====================
 * Pont entre l'app et le client IDLR (IdlrConfig/IdlrParser/IdlrClient) :
 * la base généalogique de l'association Arbre, interrogée en direct (session
 * PHP + parsing HTML). Écran de test : onglet « IDLR ».
 * Première exécution : lancer testIdlr() dans l'éditeur (autorise le scope
 * UrlFetchApp et valide la mécanique de session en live).
 */

/** Référentiel pour l'écran : périmètres et types d'actes du site. */
function idlrReferentiel(ident) {
	_exiger(['Admin', 'Agent'], ident);
	return {
		secteurs: SECTEURS,
		communes: COMMUNES.map(c => c.nom),
		types: TYPES_ACTE,
	};
}

/**
 * Recherche IDLR — q = { commune|secteur, nom, prenom, mere, type, sexe,
 * mode, anneeMin, anneeMax, phonex, page } (voir IdlrClient.search).
 */
function idlrRecherche(q, ident) {
	_exiger(['Admin', 'Agent'], ident);
	return search(q || {});
}

/**
 * Recherche automatique du matricule d'une demande sur IDLR — Admin/Agent.
 * Croise nom / type / année (± 1) et, si la commune existe sur IDLR, la
 * restreint. Renvoie le n° de matricule lu dans les observations du meilleur
 * résultat (année la plus proche), ou '' si rien. Ne modifie pas la demande.
 */
function chercherMatriculeIdlr(id, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const d = _demandeLigne(id).d;
	return _chercherMatriculeIdlr(d.nom, d.prenom, d.typeActe, d.commune, d.anneeActe);
}

/** Idem à la création (pas encore d'id) — crit = { nom, prenom, typeActe, commune, anneeActe }. */
function chercherMatriculeIdlrCriteres(crit, ident) {
	_exiger(['Admin', 'Agent'], ident);
	crit = crit || {};
	return _chercherMatriculeIdlr(crit.nom, crit.prenom, crit.typeActe, crit.commune, crit.anneeActe);
}

function _chercherMatriculeIdlr(nom, prenom, typeActe, commune, anneeActe) {
	if (!nom || !String(nom).trim()) throw new Error('Renseigne au moins le nom pour chercher sur IDLR');
	const annee = parseInt(anneeActe, 10) || 0;
	const q = { nom: String(nom).trim(), prenom: String(prenom || '').trim() };
	const type = _typeIdlr(typeActe);
	if (type) q.type = type;
	if (annee) { q.anneeMin = String(annee - 1); q.anneeMax = String(annee + 1); }
	const c = _communeIdlr(commune);
	if (c) q.commune = c;

	const actes = (search(q).results || []).slice()
		.sort((a, b) => Math.abs((a.annee || 0) - annee) - Math.abs((b.annee || 0) - annee));
	for (const a of actes) {
		const m = _matriculeDepuisObs(a.obs);
		if (m) {
			const p = (a.personnes && a.personnes.principal) || {};
			return { ok: true, matricule: m, total: actes.length,
				apercu: { nom: p.nom || nom, prenom: p.prenom || '', date: a.date || '', commune: a.commune || '', obs: a.obs || '' } };
		}
	}
	return { ok: true, matricule: '', total: actes.length };
}

// N° de matricule lu dans les observations IDLR (« … n°89446 »).
function _matriculeDepuisObs(obs) {
	const m = String(obs || '').match(/[nN]\s*°\s*(\d+)/);
	return m ? m[1] : '';
}

// Type de demande → code IDLR (N/M/D), '' si non mappable.
function _typeIdlr(typeActe) {
	const t = String(typeActe || '').toLowerCase();
	if (t.indexOf('naiss') === 0) return 'N';
	if (t.indexOf('mariage') === 0) return 'M';
	if (t.indexOf('déc') === 0 || t.indexOf('dec') === 0) return 'D';
	return '';
}

// Commune de la demande → nom exact d'une commune IDLR ('' sinon) : on retire la
// section « Commune — Section » et on compare via _cleCommune (sans accents/casse).
function _communeIdlr(commune) {
	const cle = _cleCommune(String(commune || '').split('—')[0]);
	for (const c of COMMUNES) if (_cleCommune(c.nom) === cle) return c.nom;
	return '';
}

/** Test éditeur (recherche Kichenin / Naissance / CINOR). */
function testIdlr() {
	const r = search({ secteur: 'CINOR', nom: 'Kichenin', sexe: 'M', type: 'N', anneeMax: 1951 });
	console.log('total: ' + r.total + ' | ramenés: ' + r.count + ' | pages: ' + r.totalPages);
	console.log(JSON.stringify(r.results.slice(0, 3), null, 2));
	return r;
}
