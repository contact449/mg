/* ============================ INITIALISATION ============================ */

function initialiser() {
	const ss = _classeur();
	_creerFeuille(ss, NOM_FEUILLE_DEMANDES, ENTETES_DEMANDES);
	_creerFeuille(ss, NOM_FEUILLE_HISTORIQUE, ENTETES_HISTORIQUE);
	_creerFeuille(ss, NOM_FEUILLE_BONS, ENTETES_BONS);
	const fhab = _creerFeuille(ss, NOM_FEUILLE_HABILITATIONS, ENTETES_HABILITATIONS);
	// Le premier utilisateur qui initialise devient automatiquement Admin
	if (fhab.getLastRow() < 2) {
		const moi = _agent();
		if (moi && moi !== 'inconnu') {
			fhab.appendRow([moi, 'Administrateur initial', 'Admin', _maintenant(), 'initialiser()']);
		}
	}
	// pas d'onglet référentiel à créer : Base_Cotes vit dans le classeur de suivi OCI
	obtenirDossierPhotos();
	return 'Initialisation v2 terminée';
}

function _creerFeuille(ss, nom, entetes) {
	let f = ss.getSheetByName(nom);
	if (!f) {
		f = ss.insertSheet(nom);
		f.getRange(1, 1, 1, entetes.length).setValues([entetes])
			.setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
		f.setFrozenRows(1);
	}
	return f;
}

/* -------------------------- OUTILS DE TEST -------------------------- */

/** Crée 5 demandes fictives (nom préfixé « TEST ») avec de vraies
 *  communes/années : les cotes se calculent, elles sont dispatchables.
 *  Nettoyage : supprimerDemandesTest(). */
function creerDemandesTest() {
	const jeux = [
		{ typeActe: 'Naissance', nom: 'TEST PAYET', prenom: 'Jean', commune: 'Saint-Pierre', anneeActe: '1895' },
		{ typeActe: 'Décès', nom: 'TEST HOARAU', prenom: 'Marie', commune: 'Saint-Paul', anneeActe: '1870' },
		{ typeActe: 'Mariage', nom: 'TEST GRONDIN', prenom: 'Paul', commune: 'Salazie', anneeActe: '1910' },
		{ typeActe: 'Naissance', nom: 'TEST FONTAINE', prenom: 'Luce', commune: 'Avirons (Les)', anneeActe: '1894' },
		{ typeActe: 'Mariage', nom: 'TEST RIVIERE', prenom: 'Ana', commune: 'Sainte-Suzanne', anneeActe: '1900' },
	];
	const ids = [];
	for (const d of jeux) {
		d.demandeur = 'TEST';
		d.notes = 'Demande fictive de test';
		d.forcer = true; // pas de garde-fou doublon sur les jeux de test relançables
		ids.push(creerDemande(d).id);
	}
	console.log('Demandes de test créées : ' + ids.join(', '));
	return { ok: true, ids: ids };
}

/** Supprime les demandes de test (nom commençant par « TEST »), leur
 *  historique, et les bons qui ne contenaient que des tests. */
function supprimerDemandesTest() {
	_exiger(['Admin']);
	const fD = _feuille(NOM_FEUILLE_DEMANDES);
	const nD = fD.getLastRow() - 1;
	if (nD < 1) { console.log('Aucune demande'); return { ok: true, supprimees: 0 }; }
	const dem = fD.getRange(2, 1, nD, ENTETES_DEMANDES.length).getDisplayValues();
	const tests = new Set(dem.filter(l => String(l[3]).indexOf('TEST') === 0).map(l => String(l[0])));
	if (!tests.size) { console.log('Aucune demande de test'); return { ok: true, supprimees: 0 }; }

	const gardeDem = dem.filter(l => !tests.has(String(l[0])));
	fD.getRange(2, 1, nD, ENTETES_DEMANDES.length).clearContent();
	if (gardeDem.length) fD.getRange(2, 1, gardeDem.length, ENTETES_DEMANDES.length).setValues(gardeDem);

	const fH = _feuille(NOM_FEUILLE_HISTORIQUE);
	const nH = fH.getLastRow() - 1;
	if (nH > 0) {
		const hist = fH.getRange(2, 1, nH, ENTETES_HISTORIQUE.length).getDisplayValues();
		const gardeHist = hist.filter(l => !tests.has(String(l[0])));
		fH.getRange(2, 1, nH, ENTETES_HISTORIQUE.length).clearContent();
		if (gardeHist.length) fH.getRange(2, 1, gardeHist.length, ENTETES_HISTORIQUE.length).setValues(gardeHist);
	}

	const fB = _feuille(NOM_FEUILLE_BONS);
	const nB = fB.getLastRow() - 1;
	if (nB > 0) {
		const bons = fB.getRange(2, 1, nB, ENTETES_BONS.length).getDisplayValues();
		const gardeBons = bons.filter(l => {
			const ids = String(l[4]).split(',').map(s => s.trim()).filter(Boolean);
			return !(ids.length && ids.every(id => tests.has(id)));
		});
		fB.getRange(2, 1, nB, ENTETES_BONS.length).clearContent();
		if (gardeBons.length) fB.getRange(2, 1, gardeBons.length, ENTETES_BONS.length).setValues(gardeBons);
	}
	console.log('Supprimé : ' + tests.size + ' demandes de test (+ historique et bons 100 % test)');
	return { ok: true, supprimees: tests.size };
}

function obtenirDossierPhotos() {
	const it = DriveApp.getFoldersByName(NOM_DOSSIER_PHOTOS);
	return it.hasNext() ? it.next() : DriveApp.createFolder(NOM_DOSSIER_PHOTOS);
}
