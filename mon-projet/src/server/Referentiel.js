/* ==================== RÉFÉRENTIEL (onglet Base_Cotes) ==================== */

// Référentiel = onglet Base_Cotes du classeur OCI (lu, jamais modifié) :
// Commune | Section | Intitulé | Contenu | Dates | Cote 4E | EDEPOT | µfilm.
// Le type d'acte se déduit de l'intitulé ; les « Publications » ne sont
// jamais retenues pour un type demandé (ce ne sont pas les registres).
let _refCache = null; // Base_Cotes lu une seule fois par exécution
function rechercherCotes(commune, typeActe, annee, dateActe, ident) {
	_exiger(['Admin', 'Agent'], ident);
	if (!_refCache) {
		const f = _classeurSuivi().getSheetByName(NOM_FEUILLE_REFERENTIEL);
		if (!f) return { resultats: [], message: 'Onglet ' + NOM_FEUILLE_REFERENTIEL + ' introuvable dans le classeur de suivi OCI' };
		const n = f.getLastRow() - 1;
		if (n < 1) return { resultats: [], message: 'Référentiel vide — onglet ' + NOM_FEUILLE_REFERENTIEL };
		_refCache = f.getRange(2, 1, n, 8).getDisplayValues();
	}
	const a = parseInt(annee, 10);
	// intervalle cherché : la date précise si fournie, sinon l'année entière
	const q1 = _borneDate(dateActe, false) || (a ? a * 10000 + 101 : 0);
	const q2 = _borneDate(dateActe, true) || (a ? a * 10000 + 1231 : 0);
	// « Commune — Section » : la section (mairie annexe) a ses propres registres
	// et cotes — la commune seule ne matche que les registres principaux
	const parties = String(commune || '').split(' — ');
	const communeCherchee = _normRef(parties[0]);
	const sectionCherchee = _normRef(parties.slice(1).join(' '));
	const typeCherche = _normRef(typeActe).replace(/s$/, ''); // « décès » -> « dece » : matche singulier/pluriel
	const valeurs = _refCache;
	const resultats = [];
	for (const l of valeurs) {
		const [com, section, intitule, , a1, a2, c4e, ced] = l;
		if (commune && _normRef(com) !== communeCherchee) continue;
		if (commune && _normRef(section) !== sectionCherchee) continue;
		const intituleNorm = _normRef(intitule);
		const table = intituleNorm.indexOf('table') === 0;
		const publication = intituleNorm.indexOf('publication') === 0;
		if (typeCherche) {
			// on peut demander directement une table décennale ou une publication
			if (typeCherche.indexOf('table') >= 0) { if (!table) continue; }
			else if (typeCherche.indexOf('publication') >= 0) { if (!publication) continue; }
			// sinon : registres d'actes (les tables restent proposées en suggestion)
			else if (!table && (publication || intituleNorm.indexOf(typeCherche) < 0)) continue;
		}
		if (q1) {
			const r1 = _borneDate(a1, false);
			const r2 = _borneDate(a2, true) || _borneDate(a1, true);
			if (!r1 || r1 > q2 || r2 < q1) continue;
		}
		resultats.push({
			commune: com, types: intitule.replace(/\s+/g, ' '), table: table,
			intitule: intitule.replace(/\s+/g, ' ') + (section ? ' — ' + section.replace(/\s+/g, ' ') : ''),
			anneeDebut: a1, anneeFin: a2, cote4E: c4e, coteEDEPOT: ced
		});
		if (resultats.length >= 60) break;
	}
	resultats.sort((x, y) => (x.table === y.table) ? 0 : (x.table ? 1 : -1));
	return { resultats: resultats };
}

// Borne comparable aaaammjj — accepte une année seule (→ 1er janv. ou
// 31 déc. selon la borne) ou une date complète ; 0 si inexploitable.
function _borneDate(s, borneFin) {
	const t = String(s || '').trim();
	let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
	if (m) return parseInt(m[3], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10);
	m = t.match(/(1[5-9]\d{2}|20\d{2})/);
	return m ? parseInt(m[1], 10) * 10000 + (borneFin ? 1231 : 101) : 0;
}

// Normalise pour comparer avec Base_Cotes : accents, retours à la ligne
// (même en plein mot), ponctuation, articles « (Le) / (La) / (Les) ».
function _normRef(s) {
	return String(s || '').toLowerCase()
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.replace(/\((le|la|les)\)/g, '')
		.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Classement auto : 4E + EDEPOT = « Les deux » (copie 4E commandable sur
// place), 4E seul = copie via bon, EDEPOT seul = formulaire (exclu des
// bons), rien = classement vide à vérifier.
function _classementAuto(commune, typeActe, annee, dateActe) {
	// si on demande une table décennale, ce sont les cotes des tables qu'on veut
	const veutTable = _normRef(typeActe).indexOf('table') >= 0;
	const res = rechercherCotes(commune, typeActe, annee, dateActe).resultats.filter(r => veutTable ? r.table : !r.table);
	const avecLesDeux = res.find(r => r.cote4E && r.coteEDEPOT);
	const avec4E = res.find(r => r.cote4E);
	const avecED = res.find(r => r.coteEDEPOT);
	if (avecLesDeux) return { classement: 'Les deux', c4: avecLesDeux.cote4E, ce: avecLesDeux.coteEDEPOT };
	if (avec4E && avecED) return { classement: 'Les deux', c4: avec4E.cote4E, ce: avecED.coteEDEPOT };
	if (avec4E) return { classement: 'Cote 4E (copie)', c4: avec4E.cote4E, ce: '' };
	if (avecED) return { classement: 'Cote EDEPOT (original)', c4: '', ce: avecED.coteEDEPOT };
	return { classement: '', c4: '', ce: '' };
}

// Complète en lot les cotes manquantes (classement auto) des demandes ayant
// commune + année mais aucune cote — à lancer depuis l'éditeur.
function completerCotesManquantes() {
	_exiger(['Admin']);
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	const n = f.getLastRow() - 1;
	if (n < 1) { console.log('Aucune demande'); return { ok: true, completees: 0 }; }
	const v = f.getRange(2, 1, n, ENTETES_DEMANDES.length).getDisplayValues();
	let completees = 0, sansResultat = 0;
	for (let i = 0; i < v.length; i++) {
		const d = _ligneVersObjet(v[i]);
		if (!d.id || d.cote4E || d.coteEDEPOT || !d.commune) continue;
		let annee = d.anneeActe;
		if (!annee) {
			annee = _anneeDepuisDate(d.dateActe);
			if (!annee) continue;
			// année déduite de la date précise : on la reporte dans la fiche
			f.getRange(i + 2, COL.ANNEE).setValue(annee);
			f.getRange(i + 2, COL.AVANT_1908).setValue(parseInt(annee, 10) <= ANNEE_PIVOT ? 'Oui' : 'Non');
		}
		const auto = _classementAuto(d.commune, d.typeActe, annee, d.dateActe);
		if (!auto.classement) {
			sansResultat++;
			console.log(d.id + ' : aucune cote dans Base_Cotes pour ' + d.commune + ' / ' + d.typeActe + ' / ' + annee);
			continue;
		}
		f.getRange(i + 2, COL.CLASSEMENT, 1, 3).setValues([[auto.classement, auto.c4, auto.ce]]);
		_tamponnerMAJ(f, i + 2);
		_journaliser(d.id, d.statut, 'Cotes complétées automatiquement : ' + auto.classement +
			(auto.c4 ? ' — 4E : ' + auto.c4 : '') + (auto.ce ? ' — EDEPOT : ' + auto.ce : ''));
		completees++;
	}
	console.log('Cotes complétées : ' + completees + (sansResultat ? ' — sans résultat : ' + sansResultat + ' (voir lignes ci-dessus)' : ''));
	return { ok: true, completees: completees, sansResultat: sansResultat };
}

// COMMUNES_4E : libellés canoniques du référentiel Base_Cotes (l'autre liste
// de communes, COMMUNES, appartient au client IDLR — IdlrConfig.js)
const COMMUNES_4E = ['Avirons (Les)', 'Bras-Panon', 'Cilaos', 'Entre-Deux', 'Etang-Salé',
	'Petite-Île', 'Plaine-des-Palmistes', 'Port (Le)', 'Possession (La)',
	'Saint-André', 'Saint-Benoît', 'Saint-Denis', 'Saint-Joseph', 'Saint-Leu',
	'Saint-Louis', 'Saint-Paul', 'Saint-Philippe', 'Saint-Pierre', 'Sainte-Marie',
	'Sainte-Rose', 'Sainte-Suzanne', 'Salazie', 'Tampon (Le)', 'Trois-Bassins'];

// Communes + sections (mairies annexes) de Base_Cotes, en « Commune —
// Section » sous leur commune ; valeur stockée telle quelle et redécoupée
// par rechercherCotes(). Cache 6 h.
function listerCommunes(ident) {
	_exiger(['Admin', 'Agent'], ident);
	const cache = CacheService.getScriptCache();
	const enCache = cache.get('communesSections');
	if (enCache) return JSON.parse(enCache);
	const sections = {}; // normRef(commune) -> { normRef(section) -> libellé propre }
	try {
		const f = _classeurSuivi().getSheetByName(NOM_FEUILLE_REFERENTIEL);
		const n = f.getLastRow() - 1;
		for (const [com, sec] of f.getRange(2, 1, n, 2).getDisplayValues()) {
			if (!sec.trim()) continue;
			const k = _normRef(com), ks = _normRef(sec);
			if (!sections[k]) sections[k] = {};
			if (!sections[k][ks]) sections[k][ks] = _propreRef(sec);
		}
	} catch (e) { /* Base_Cotes inaccessible : liste des communes seules */ }
	const liste = [];
	for (const c of COMMUNES_4E) {
		liste.push(c);
		const s = sections[_normRef(c)];
		if (s) for (const nom of Object.values(s).sort()) liste.push(c + ' — ' + nom);
	}
	cache.put('communesSections', JSON.stringify(liste), 21600);
	return liste;
}

// Libellé propre : Base_Cotes contient des retours à la ligne, parfois en
// plein mot après un tiret (« Rivière Saint-\nLouis »).
function _propreRef(s) {
	return String(s || '').replace(/-\s*\n\s*/g, '-').replace(/\s+/g, ' ').trim();
}
