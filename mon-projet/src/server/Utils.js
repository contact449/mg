/* ============================ UTILITAIRES ============================ */

let _classeurCache = null, _classeurSuiviCache = null;
/** Classeur de l'app — base de données (ouvert une fois par exécution). */
function _classeur() {
	if (!_classeurCache) _classeurCache = SpreadsheetApp.openById(ID_CLASSEUR_DONNEES);
	return _classeurCache;
}

/** Classeur OCI de suivi manuel — lecture (Base_Cotes, import) + ajout
 *  d'une ligne de suivi à chaque acte trouvé (_ajouterAuSuivi). */
function _classeurSuivi() {
	if (!_classeurSuiviCache) _classeurSuiviCache = SpreadsheetApp.openById(ID_CLASSEUR_SUIVI);
	return _classeurSuiviCache;
}

function _feuille(nom) {
	const f = _classeur().getSheetByName(nom);
	if (!f) throw new Error('Feuille manquante : ' + nom + ' — exécutez initialiser()');
	// colonnes ajoutées après coup (Affilié, Déblocage, circuit apostille…) :
	// la grille est étendue au premier accès, sinon les lectures pleine
	// largeur (getRange sur ENTETES_DEMANDES.length) sortiraient de la grille
	if (nom === NOM_FEUILLE_DEMANDES && f.getMaxColumns() < ENTETES_DEMANDES.length) {
		f.insertColumnsAfter(f.getMaxColumns(), ENTETES_DEMANDES.length - f.getMaxColumns());
	}
	return f;
}

function _maintenant() {
	return Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy HH:mm:ss');
}

/** Extrait l'année d'une date précise (« 12/05/1884 » → « 1884 »). */
function _anneeDepuisDate(dateActe) {
	const m = String(dateActe || '').match(/(1[5-9]\d{2}|20\d{2})/);
	return m ? m[1] : '';
}

function _agent() {
	try { return Session.getActiveUser().getEmail() || 'inconnu'; } catch (e) { return 'inconnu'; }
}

function _genererID(prefixe, cle) {
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const annee = Utilities.formatDate(new Date(), 'Indian/Reunion', 'yyyy');
		const k = cle + '_' + annee;
		const seq = parseInt(props.getProperty(k) || '0', 10) + 1;
		props.setProperty(k, String(seq));
		return prefixe + '-' + annee + '-' + ('0000' + seq).slice(-4);
	} finally { lock.releaseLock(); }
}

function _journaliser(idDemande, statut, detail, agent) {
	_feuille(NOM_FEUILLE_HISTORIQUE).appendRow([idDemande, _maintenant(), statut, detail || '', agent || _agent()]);
}

function _trouverLigne(id) {
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	const n = Math.max(f.getLastRow() - 1, 1);
	const ids = f.getRange(2, 1, n, 1).getValues();
	for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
	return -1;
}

/** Feuille + ligne + fiche d'une demande ; jette si introuvable. */
function _demandeLigne(id) {
	const r = _trouverLigne(id);
	if (r < 0) throw new Error('Demande introuvable : ' + id);
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	return { f: f, r: r, d: _ligneVersObjet(f.getRange(r, 1, 1, ENTETES_DEMANDES.length).getDisplayValues()[0]) };
}

/** Tamponne la colonne « Dernière MAJ ». */
function _tamponnerMAJ(f, r) { f.getRange(r, COL.MAJ).setValue(_maintenant()); }

/** Écrit le statut et tamponne la dernière MAJ. */
function _poserStatut(f, r, statut) {
	f.getRange(r, COL.STATUT).setValue(statut);
	_tamponnerMAJ(f, r);
}

function _ligneVersObjet(l) {
	return {
		id: l[0], dateCreation: l[1], typeActe: l[2], nom: l[3], prenom: l[4],
		commune: l[5], anneeActe: l[6], dateActe: l[7], demandeur: l[8],
		statut: l[9], classement: l[10], cote4E: l[11], coteEDEPOT: l[12],
		photos: l[13], notes: l[14], derniereMAJ: l[15],
		destination: l[16] || 'Archives', avant1908: l[17], preuve: l[18], bon: l[19],
		numeroActe: l[20] || '', remiseLe: l[21] || '', mairie: l[22] || '',
		matricule: l[23] || '', affilieLe: l[24] || '', deblocage: l[25] || '',
		checkeLe: l[26] || '', notaireLe: l[27] || '', apostilleLe: l[28] || ''
	};
}

/** Pose l'en-tête d'une colonne ajoutée après coup (au premier usage). */
function _poserEnTete(f, col, entetes) {
	entetes = entetes || ENTETES_DEMANDES;
	if (String(f.getRange(1, col).getValue()) !== entetes[col - 1]) {
		f.getRange(1, col).setValue(entetes[col - 1]);
	}
}

/** Tamponne « Remise à rechercher le ». */
function _tamponnerRemise(f, r) {
	_poserEnTete(f, COL.REMISE);
	f.getRange(r, COL.REMISE).setValue(Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy'));
}
