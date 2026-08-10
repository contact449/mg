/* ==================== IMPORT DU SUIVI MANUEL (une fois) ==================== */

/**
 * Reprend l'onglet de suivi manuel (NOM_FEUILLE_IMPORT, dans le classeur
 * OCI de suivi) vers la feuille Demandes de la base de l'app. À exécuter
 * depuis l'éditeur Apps Script. RELANÇABLE : une demande déjà en base
 * (mêmes mots dans le nom + même type d'acte) est ignorée — on peut donc
 * relancer plus tard pour rattraper les nouvelles lignes du suivi.
 *
 * Normalisations appliquées (voir _normaliserImport) :
 *  - date de groupe (col A, présente sur la 1re ligne seulement) propagée ;
 *    formats jj/mm/aa et jj/mm/aaaa acceptés
 *  - NOM / Prénom séparés (mots en MAJUSCULES = nom) ; les couples
 *    (« X et Y », mariages) restent entiers dans le nom
 *  - type d'acte -> Naissance / Mariage / Décès / Jugement
 *  - lien de la cellule LIEN (ou du nom) = PHOTO DE L'ACTE -> champ Photos ;
 *    sans statut noté, la présence de cette photo vaut « Trouvée »
 *  - « GENEALOGIE » (texte ou ligne verte) -> Destination Généalogie
 *  - « TROUVER SUR ANOM PS DE PHOTO » (texte ou ligne cyan) -> note dédiée,
 *    la demande reste À rechercher (la photo manque toujours)
 *  - lot « jjmmaaaa -n » -> gardé en note (pas de bon rétroactif) ; le lien
 *    posé dessus est la PHOTO DU BON -> note « Photo du bon : … »
 *  - statut suivi manuel : ACTE CREE -> Traitée ; APOSTILLER /
 *    NON APOSTILLER -> Trouvée ; PAS TROUVE -> Non trouvé ;
 *    vide ou texte libre -> À rechercher (texte gardé en note)
 *  - doublons ignorés : au sein du suivi (même nom + type + date de
 *    groupe) et contre les demandes déjà en base (même nom + type)
 * Commune et année n'existent pas dans le suivi manuel : laissées vides,
 * donc pas de classement auto — à compléter au fil de l'eau dans l'app.
 */
function importerHistorique() {
	_exiger(['Admin']);
	const fSrc = _classeurSuivi().getSheetByName(NOM_FEUILLE_IMPORT);
	if (!fSrc) throw new Error('Onglet « ' + NOM_FEUILLE_IMPORT + ' » introuvable dans le classeur de suivi OCI');
	const fDem = _feuille(NOM_FEUILLE_DEMANDES);

	// clés des demandes déjà en base (nom + type) : rien n'est importé en double
	const dejaLa = new Set();
	const nExist = fDem.getLastRow() - 1;
	if (nExist > 0) {
		for (const l of fDem.getRange(2, 3, nExist, 3).getDisplayValues()) {
			dejaLa.add(_cleImport(l[1] + ' ' + l[2], _typeImport(l[0]) || l[0]));
		}
	}

	const n = fSrc.getLastRow() - 1;
	if (n < 1) throw new Error('Onglet « ' + NOM_FEUILLE_IMPORT + ' » vide');
	const plage = fSrc.getRange(2, 1, n, 8);
	const valeurs = plage.getDisplayValues();
	const liens = plage.getRichTextValues().map(l => l.map(c => (c && c.getLinkUrl()) || ''));
	const fonds = plage.getBackgrounds();

	const res = _normaliserImport(valeurs, liens, fonds, dejaLa);
	res.demandes.reverse(); // source triée du plus récent au plus ancien -> on écrit du plus ancien au plus récent

	const now = _maintenant();
	const ids = _reserverIDs('DEM', 'SEQ', res.demandes.length);
	const lignesDem = [], lignesHist = [];
	res.demandes.forEach((d, i) => {
		const l = [ids[i], d.dateCreation, d.typeActe, d.nom, d.prenom, '', '', '',
			d.demandeur, d.statut, '', '', '', d.photos, d.notes, now, d.destination, '', '', '', ''];
		while (l.length < ENTETES_DEMANDES.length) l.push(''); // largeur de la plage écrite
		lignesDem.push(l);
		lignesHist.push([ids[i], now, d.statut,
			'Import « ' + NOM_FEUILLE_IMPORT + ' » ligne ' + d.ligneSource +
			(d.suiviManuel ? ' — suivi manuel : ' + d.suiviManuel : ''), _agent()]);
	});
	if (lignesDem.length) {
		// à la suite des demandes existantes (jamais en ligne 2 : on n'écrase rien)
		fDem.getRange(fDem.getLastRow() + 1, 1, lignesDem.length, ENTETES_DEMANDES.length).setValues(lignesDem);
		const fHist = _feuille(NOM_FEUILLE_HISTORIQUE);
		fHist.getRange(fHist.getLastRow() + 1, 1, lignesHist.length, ENTETES_HISTORIQUE.length)
			.setValues(lignesHist);
	}
	// résumé dans le journal d'exécution (la valeur de retour n'y apparaît pas)
	console.log('Import terminé : ' + lignesDem.length + ' demandes — par statut : ' + JSON.stringify(res.parStatut));
	res.ignorees.forEach(x => console.log('Ignorée L' + x.ligne + ' (' + x.raison + ') : ' + x.contenu));
	res.anomalies.forEach(a => console.log('Anomalie : ' + a));
	return { ok: true, importees: lignesDem.length, parStatut: res.parStatut, ignorees: res.ignorees, anomalies: res.anomalies };
}

/**
 * ANNULE un import : supprime les demandes créées par importerHistorique()
 * (reconnues à leur évènement d'historique « Import « … » ») ainsi que leurs
 * lignes d'historique — les demandes créées via l'app sont conservées.
 * Permet de relancer un import corrigé. NB : les demandes réimportées
 * recevront de nouveaux IDs.
 */
function annulerImport() {
	_exiger(['Admin']);
	const fH = _feuille(NOM_FEUILLE_HISTORIQUE);
	const nH = fH.getLastRow() - 1;
	if (nH < 1) throw new Error('Historique vide — rien à annuler');
	const hist = fH.getRange(2, 1, nH, ENTETES_HISTORIQUE.length).getDisplayValues();
	const importes = new Set();
	for (const l of hist) {
		if (String(l[3]).indexOf('Import « ') === 0) importes.add(String(l[0]));
	}
	if (!importes.size) throw new Error('Aucune demande importée trouvée dans l\'historique');

	const fD = _feuille(NOM_FEUILLE_DEMANDES);
	const nD = fD.getLastRow() - 1;
	const dem = nD > 0 ? fD.getRange(2, 1, nD, ENTETES_DEMANDES.length).getDisplayValues() : [];
	const gardeDem = dem.filter(l => !importes.has(String(l[0])));
	const gardeHist = hist.filter(l => !importes.has(String(l[0])));

	if (nD > 0) fD.getRange(2, 1, nD, ENTETES_DEMANDES.length).clearContent();
	if (gardeDem.length) fD.getRange(2, 1, gardeDem.length, ENTETES_DEMANDES.length).setValues(gardeDem);
	fH.getRange(2, 1, nH, ENTETES_HISTORIQUE.length).clearContent();
	if (gardeHist.length) fH.getRange(2, 1, gardeHist.length, ENTETES_HISTORIQUE.length).setValues(gardeHist);

	console.log('Import annulé : ' + importes.size + ' demandes supprimées, ' + gardeDem.length + ' conservées');
	return { ok: true, supprimees: importes.size, conservees: gardeDem.length };
}

/** Réserve n IDs séquentiels d'un coup (une seule prise de verrou). */
function _reserverIDs(prefixe, cle, n) {
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const annee = Utilities.formatDate(new Date(), 'Indian/Reunion', 'yyyy');
		const k = cle + '_' + annee;
		const debut = parseInt(props.getProperty(k) || '0', 10);
		props.setProperty(k, String(debut + n));
		const ids = [];
		for (let i = 1; i <= n; i++) ids.push(prefixe + '-' + annee + '-' + ('0000' + (debut + i)).slice(-4));
		return ids;
	} finally { lock.releaseLock(); }
}

/**
 * Cœur PUR de la normalisation (aucun appel GAS -> testable en local).
 * valeurs / liens / fonds : tableaux [ligne][colonne] des 8 colonnes
 * A=date groupe, B=demandeur, C=nom prénom, D=type acte, E=lien,
 * F=lot commande, G=statut suivi, H=date suivi.
 */
function _normaliserImport(valeurs, liens, fonds, dejaLa) {
	dejaLa = dejaLa || new Set();
	const demandes = [], ignorees = [], anomalies = [];
	const parStatut = {};
	const vus = {};
	let dateGroupe = '';
	for (let i = 0; i < valeurs.length; i++) {
		const ligneSource = i + 2;
		const brut = (valeurs[i] || []).map(x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim());
		const texteLigne = _normImport(brut.join(' '));

		if (brut[0]) {
			const d = _dateImport(brut[0]);
			if (d) dateGroupe = d;
			else anomalies.push('Ligne ' + ligneSource + ' : date de groupe illisible « ' + brut[0] + ' »');
		}

		if (!brut[2]) {
			if (brut.slice(1).some(x => x)) {
				ignorees.push({ ligne: ligneSource, raison: 'sans nom', contenu: brut.filter(Boolean).join(' · ').slice(0, 60) });
			}
			continue; // ligne vide ou porteuse de la seule date de groupe
		}
		// lignes de liste brute type « ACTE 56 … » / « N°264 ACTE DE DECES … » :
		// le mot ACTE + un numéro n'apparaissent jamais dans un vrai nom
		if (/\bACTES?\b/.test(_normImport(brut[2])) && /\d/.test(brut[2])) {
			ignorees.push({ ligne: ligneSource, raison: 'liste brute « ACTE n° » (à reprendre à la main)', contenu: brut[2].slice(0, 60) });
			continue;
		}

		let texteNom = brut[2];
		const notes = [];
		if (/PHOTO\s+INDISPONIBLE/i.test(texteNom)) {
			texteNom = texteNom.replace(/PHOTO\s+INDISPONIBLE/i, '').replace(/\s+/g, ' ').trim();
			notes.push('Photo indisponible (mention du suivi manuel)');
		}
		const np = _separerNomPrenom(texteNom);
		const typeActe = _typeImport(brut[3]);
		if (!typeActe) anomalies.push('Ligne ' + ligneSource + ' : type d\'acte inconnu « ' + brut[3] + ' »');

		const cleBase = _cleImport(texteNom, typeActe);
		if (dejaLa.has(cleBase)) {
			ignorees.push({ ligne: ligneSource, raison: 'déjà présente dans Demandes', contenu: brut[2] });
			continue;
		}
		const cle = cleBase + '|' + dateGroupe;
		if (vus[cle]) {
			ignorees.push({ ligne: ligneSource, raison: 'doublon de la ligne ' + vus[cle], contenu: brut[2] });
			continue;
		}
		vus[cle] = ligneSource;

		const fond = (fonds[i] || []).map(c => String(c || '').toLowerCase());
		const lig = liens[i] || [];
		const genealogie = /\bGENEALOG/.test(texteLigne) || fond.indexOf('#00ff00') >= 0;
		const anomSansPhoto = /\bANOM\b/.test(texteLigne) || fond.indexOf('#00ffff') >= 0;
		if (anomSansPhoto) notes.push('Trouvé sur ANOM mais photo indisponible');

		const lot = brut[5].replace(/\s+/g, '');
		if (/^\d{8}-\d+$/.test(lot)) notes.push('Lot commande manuel : ' + lot);
		else if (brut[5] && !/\bGENEALOG/.test(_normImport(brut[5]))) notes.push('Commande (suivi manuel) : ' + brut[5]);
		if (lig[5]) notes.push('Photo du bon : ' + lig[5]); // le lien du lot = photo du bon de commande

		const st = _statutImport(brut[6]);
		// mention « genealogique » déjà traduite en Destination : pas de note en plus
		if (st.mention && !/\bGENEALOG/.test(_normImport(st.mention))) notes.push('Statut suivi manuel : ' + st.mention);
		if (brut[7]) notes.push('Date suivi manuel : ' + brut[7]);

		// lien de l'acte (photo), posé tantôt sur LIEN (E), tantôt sur le nom (C)
		// (le lien de F est la photo du bon, traité en note ci-dessus)
		const lienActe = lig[4] || lig[2] || '';
		let statut = st.statut;
		if (lienActe && statut === 'À rechercher') statut = 'Trouvée'; // la photo est là

		parStatut[statut] = (parStatut[statut] || 0) + 1;
		demandes.push({
			ligneSource: ligneSource, dateCreation: dateGroupe, typeActe: typeActe,
			nom: np.nom, prenom: np.prenom, demandeur: brut[1],
			statut: statut, destination: genealogie ? 'Généalogie' : 'Archives',
			photos: lienActe, notes: notes.join(' — '),
			suiviManuel: [brut[6], brut[7]].filter(Boolean).join(' / ')
		});
	}
	return { demandes: demandes, ignorees: ignorees, anomalies: anomalies, parStatut: parStatut };
}

/** Clé de rapprochement d'une demande : mots du nom complet triés
 *  (l'ordre nom/prénom diffère selon les saisies) + type d'acte. */
function _cleImport(nomComplet, typeActe) {
	return _normImport(nomComplet).replace(/[^A-Z0-9 ]/g, ' ').split(' ')
		.filter(Boolean).sort().join(' ') + '|' + (typeActe || '');
}

/** MAJUSCULES sans accents, espaces normalisés (comparaisons). */
function _normImport(s) {
	return String(s || '').replace(/\s+/g, ' ').trim()
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** jj/mm/aa ou jj/mm/aaaa -> jj/mm/aaaa ('' si illisible). */
function _dateImport(txt) {
	const m = String(txt).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
	if (!m) return '';
	const an = m[3].length === 2 ? '20' + m[3] : m[3];
	return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + an;
}

/** Les mots ENTIÈREMENT en majuscules forment le nom, le reste le prénom. */
function _separerNomPrenom(texte) {
	const t = texte.replace(/\s+/g, ' ').trim();
	if (/\bet\b/i.test(t) || t.indexOf('&') >= 0) return { nom: t.toUpperCase(), prenom: '' }; // couple (mariage)
	const nom = [], prenom = [];
	for (const mot of t.split(' ')) {
		if (mot.length > 1 && mot === mot.toUpperCase() && /[A-ZÀ-Ý]/.test(mot)) nom.push(mot);
		else prenom.push(mot);
	}
	if (!nom.length && prenom.length) nom.push(prenom.shift());
	return { nom: nom.join(' ').toUpperCase(), prenom: prenom.join(' ') };
}

function _typeImport(txt) {
	const t = _normImport(txt);
	if (t.indexOf('NAISS') >= 0) return 'Naissance';
	if (t.indexOf('MARIAGE') >= 0) return 'Mariage';
	if (t.indexOf('DEC') >= 0) return 'Décès';
	if (t.indexOf('JUGEMENT') >= 0) return 'Jugement';
	return '';
}

/** Statut du suivi manuel -> statut de l'app (mention d'origine conservée). */
function _statutImport(txt) {
	const t = _normImport(txt);
	if (!t) return { statut: 'À rechercher', mention: '' };
	if (t.indexOf('PAS TROUV') >= 0 || t.indexOf('NON TROUV') >= 0 || t.indexOf('INTROUV') >= 0) {
		return { statut: 'Non trouvé', mention: txt };
	}
	if (/ACTE?\s*CREE/.test(t)) return { statut: 'Traitée', mention: txt };
	if (t.indexOf('POSTIL') >= 0) return { statut: 'Trouvée', mention: txt }; // APOSTILLER / NON APOSTILLER / appostiller
	return { statut: 'À rechercher', mention: txt };
}
