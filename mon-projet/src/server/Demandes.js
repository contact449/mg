/* ============================ API DEMANDES ============================ */

// Crée une demande avec classement automatique (Base_Cotes) — Admin.
// Garde-fou doublon (même nom + type + commune + année) : renvoie
// { ok:false, doublon } sans créer, sauf d.forcer (l'UI confirme et renvoie).
function creerDemande(d, ident) {
	_exiger(['Admin'], ident);
	if (!d || !d.typeActe || !d.nom || !d.commune) {
		throw new Error('Champs obligatoires : type d\'acte, nom, commune');
	}
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		if (!d.anneeActe && d.dateActe) d.anneeActe = _anneeDepuisDate(d.dateActe);
		if (!d.forcer) {
			const nomMaj = String(d.nom).toUpperCase().trim();
			const doublon = listerDemandes('Tous').find(o =>
				o.nom === nomMaj && o.typeActe === d.typeActe && o.commune === d.commune &&
				String(o.anneeActe) === String(d.anneeActe || '') &&
				(!o.dateActe || !d.dateActe || o.dateActe === d.dateActe));
			if (doublon) {
				return {
					ok: false,
					doublon: {
						id: doublon.id, nom: doublon.nom, prenom: doublon.prenom,
						statut: doublon.statut, commune: doublon.commune, anneeActe: doublon.anneeActe
					}
				};
			}
		}
		const id = _genererID('DEM', 'SEQ');
		const now = _maintenant();
		const annee = parseInt(d.anneeActe, 10) || 0;
		const avant1908 = annee && annee <= ANNEE_PIVOT ? 'Oui' : (annee ? 'Non' : '');
		// l'aperçu du formulaire a déjà calculé la cote sur les mêmes données :
		// on la reprend telle quelle et on économise le rechargement de Base_Cotes
		const auto = d.coteCalculee
			? { classement: d.classement || '', c4: d.cote4E || '', ce: d.coteEDEPOT || '' }
			: (annee ? _classementAuto(d.commune, d.typeActe, annee, d.dateActe) : { classement: '', c4: '', ce: '' });
		const destination = d.destination === 'Généalogie' ? 'Généalogie' : 'Archives';

		const fD = _feuille(NOM_FEUILLE_DEMANDES);
		_poserEnTete(fD, COL.MATRICULE, ENTETES_DEMANDES);
		fD.appendRow([
			id, now, d.typeActe, (d.nom || '').toUpperCase(), d.prenom || '',
			d.commune, d.anneeActe || '', d.dateActe || '', d.demandeur || '',
			'À rechercher', auto.classement, auto.c4, auto.ce, '', d.notes || '', now,
			destination, avant1908, d.preuve || '', '', String(d.numeroActe || '').replace(/\D+/g, ''),
			'', '', String(d.matricule || '').trim()
		]);

		let detail = 'Création — ' + d.typeActe + ' / ' + (d.nom || '').toUpperCase() + ' ' +
			(d.prenom || '') + ' / ' + d.commune + (d.anneeActe ? ' / ' + d.anneeActe : '') +
			' / Destination : ' + destination;
		if (auto.classement) {
			detail += ' — Classement auto : ' + auto.classement;
			if (auto.c4) detail += ' (4E : ' + auto.c4 + (auto.ce ? ', EDEPOT : ' + auto.ce : '') + ')';
			else if (auto.ce) detail += ' (EDEPOT : ' + auto.ce + ')';
		} else {
			detail += ' — Aucune cote trouvée automatiquement : à vérifier';
		}
		_journaliser(id, 'À rechercher', detail, _nomAgent(ident));
		return { ok: true, id: id, classement: auto.classement, cote4E: auto.c4, coteEDEPOT: auto.ce, avant1908: avant1908 };
	} finally { lock.releaseLock(); }
}

function listerDemandes(filtreStatut, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	const n = f.getLastRow() - 1;
	if (n < 1) return [];
	const v = f.getRange(2, 1, n, ENTETES_DEMANDES.length).getDisplayValues();
	let liste = v.map(_ligneVersObjet).filter(o => o.id);
	if (filtreStatut && filtreStatut !== 'Tous') liste = liste.filter(o => o.statut === filtreStatut);
	return liste.reverse();
}

function getDemande(id, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	q.d.historique = getHistorique(id);
	return q.d;
}

function getHistorique(id) {
	_exiger(['Admin', 'Agent']);
	const f = _feuille(NOM_FEUILLE_HISTORIQUE);
	const n = f.getLastRow() - 1;
	if (n < 1) return [];
	return f.getRange(2, 1, n, ENTETES_HISTORIQUE.length).getDisplayValues()
		.filter(l => String(l[0]) === String(id))
		.map(l => ({ date: l[1], statut: l[2], detail: l[3], agent: l[4] }));
}

// Corrige la fiche (type, nom, commune, année…) — Admin/Agent. Si la
// recherche change (type/commune/année/date), le classement est recalculé.
function modifierDemande(id, champs, ident) {
	_exiger(['Admin', 'Agent'], ident);
	if (!champs) throw new Error('Aucune modification transmise');
	const q = _demandeLigne(id);
	const d = q.d;
	const nv = {
		typeActe: champs.typeActe != null ? String(champs.typeActe).trim() : d.typeActe,
		nom: champs.nom != null ? String(champs.nom).trim().toUpperCase() : d.nom,
		prenom: champs.prenom != null ? String(champs.prenom).trim() : d.prenom,
		commune: champs.commune != null ? String(champs.commune).trim() : d.commune,
		anneeActe: champs.anneeActe != null ? String(champs.anneeActe).trim() : d.anneeActe,
		dateActe: champs.dateActe != null ? String(champs.dateActe).trim() : d.dateActe,
		demandeur: champs.demandeur != null ? String(champs.demandeur).trim() : d.demandeur,
		notes: champs.notes != null ? String(champs.notes).trim() : d.notes,
		// numéro d'acte : chiffres uniquement
		numeroActe: champs.numeroActe != null ? String(champs.numeroActe).replace(/\D+/g, '') : d.numeroActe,
		// matricule : facultatif, relevé sur l'acte (texte libre)
		matricule: champs.matricule != null ? String(champs.matricule).trim() : d.matricule
	};
	if (!nv.typeActe || !nv.nom) throw new Error('Champs obligatoires : type d\'acte, nom');

	if (!nv.anneeActe && nv.dateActe) nv.anneeActe = _anneeDepuisDate(nv.dateActe);
	const annee = parseInt(nv.anneeActe, 10) || 0;
	const avant1908 = annee ? (annee <= ANNEE_PIVOT ? 'Oui' : 'Non') : '';
	q.f.getRange(q.r, COL.TYPE, 1, 7).setValues([[nv.typeActe, nv.nom, nv.prenom, nv.commune, nv.anneeActe, nv.dateActe, nv.demandeur]]);
	q.f.getRange(q.r, COL.NOTES).setValue(nv.notes);
	q.f.getRange(q.r, COL.AVANT_1908).setValue(avant1908);
	q.f.getRange(q.r, COL.NUMERO_ACTE).setValue(nv.numeroActe);
	_poserEnTete(q.f, COL.MATRICULE, ENTETES_DEMANDES);
	q.f.getRange(q.r, COL.MATRICULE).setValue(nv.matricule);

	let detail = 'Fiche modifiée — ' + nv.typeActe + ' / ' + nv.nom +
		(nv.prenom ? ' ' + nv.prenom : '') + (nv.commune ? ' / ' + nv.commune : '') +
		(nv.anneeActe ? ' / ' + nv.anneeActe : '');
	const rechercheChangee = nv.typeActe !== d.typeActe || nv.commune !== d.commune ||
		String(nv.anneeActe) !== String(d.anneeActe) || String(nv.dateActe) !== String(d.dateActe);
	if (rechercheChangee && nv.commune && annee) {
		const auto = _classementAuto(nv.commune, nv.typeActe, annee, nv.dateActe);
		q.f.getRange(q.r, COL.CLASSEMENT, 1, 3).setValues([[auto.classement, auto.c4, auto.ce]]);
		detail += auto.classement
			? ' — reclassement auto : ' + auto.classement +
				(auto.c4 ? ' (4E : ' + auto.c4 + (auto.ce ? ', EDEPOT : ' + auto.ce : '') + ')' : auto.ce ? ' (EDEPOT : ' + auto.ce + ')' : '')
			: ' — aucune cote trouvée automatiquement : à vérifier';
	}
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, d.statut, detail, _nomAgent(ident));
	return { ok: true };
}

// Reclassement manuel : corriger les cotes ou marquer « Erreur (non trouvé) ».
function classerDemande(id, classement, cote4E, coteEDEPOT, commentaire, ident) {
	_exiger(['Admin', 'Agent'], ident);
	if (CLASSEMENTS.indexOf(classement) < 0) throw new Error('Classement invalide');
	const q = _demandeLigne(id);
	const erreur = classement === 'Erreur (non trouvé)';
	const statut = erreur ? 'Non trouvé' : q.d.statut;
	q.f.getRange(q.r, COL.STATUT, 1, 4).setValues([[statut, classement, erreur ? '' : (cote4E || ''), erreur ? '' : (coteEDEPOT || '')]]);
	_tamponnerMAJ(q.f, q.r);
	let detail = 'Reclassement : ' + classement;
	if (cote4E && !erreur) detail += ' — 4E : ' + cote4E;
	if (coteEDEPOT && !erreur) detail += ' — EDEPOT : ' + coteEDEPOT;
	if (commentaire) detail += ' — ' + commentaire;
	_journaliser(id, statut, detail, _nomAgent(ident));
	return { ok: true };
}

// Changement de statut — Admin/Agent (session ou identité déclarée).
function changerStatut(id, statut, commentaire, ident) {
	_exiger(['Admin', 'Agent'], ident);
	if (STATUTS.indexOf(statut) < 0) throw new Error('Statut invalide');
	const q = _demandeLigne(id);
	_poserStatut(q.f, q.r, statut);
	let idBon = q.d.bon || '';
	if (statut === 'À rechercher') {
		// date de remise : affichée sur la carte tant qu'un nouveau dispatch n'a pas eu lieu
		_tamponnerRemise(q.f, q.r);
		// sortie de l'ancien bon, sinon la demande resterait invisible du
		// dispatch (qui ne prend que les demandes hors bon)
		if (idBon) {
			_retirerDuBon(idBon, id);
			q.f.getRange(q.r, COL.BON).setValue('');
			commentaire = (commentaire ? commentaire + ' — ' : '') + 'sortie du bon ' + idBon;
			idBon = '';
		}
	}
	_journaliser(id, statut, commentaire || '', _nomAgent(ident));
	return { ok: true, idBon: idBon, bonACloturer: _bonACloturer(idBon) };
}

// Joint / remplace / supprime (url vide) la preuve — Admin/Agent.
function definirPreuve(id, url, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	q.f.getRange(q.r, COL.PREUVE).setValue(url || '');
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, q.d.statut, url ? 'Preuve jointe : ' + url : 'Preuve supprimée', _nomAgent(ident));
	return { ok: true };
}

// Photo (ou PDF) de l'acte — Admin/Agent. Numéro d'acte obligatoire à
// la première photo ; la demande passe « Trouvée » et une ligne part au
// suivi OCI. estPreuve = capture ANOM : statut inchangé.
function ajouterPhoto(id, donneesBase64, estPreuve, ident, numeroActe, mime) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	const d = q.d;
	const numero = String(numeroActe || '').replace(/\D+/g, '');
	if (!estPreuve) {
		if (!numero && !d.numeroActe) throw new Error('Indiquez le numéro de l\'acte (inscrit sur le registre)');
		if (numero) q.f.getRange(q.r, COL.NUMERO_ACTE).setValue(numero);
	}

	const racine = obtenirDossierPhotos();
	const it = racine.getFoldersByName(id);
	const dossier = it.hasNext() ? it.next() : racine.createFolder(id);

	const type = mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
	// nom : ANOM PHOTO ARCHIVES|GENEALOGIE jj/MM/aa ACTE TYPE NOM PRENOM date ville
	const nomFichier = ['ANOM PHOTO',
		d.destination === 'Généalogie' ? 'GENEALOGIE' : 'ARCHIVES',
		Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yy'),
		'ACTE ' + String(d.typeActe || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
		d.nom, d.prenom, d.dateActe || d.anneeActe, d.commune]
		.filter(Boolean).join(' ') + (type === 'application/pdf' ? '.pdf' : '.jpg');

	const blob = Utilities.newBlob(Utilities.base64Decode(donneesBase64), type, nomFichier);
	const fichier = dossier.createFile(blob);
	fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
	const url = fichier.getUrl();

	if (estPreuve) {
		q.f.getRange(q.r, COL.PREUVE).setValue(url);
		_tamponnerMAJ(q.f, q.r);
		_journaliser(id, d.statut, 'Preuve (capture) ajoutée : ' + url, _nomAgent(ident));
		return { ok: true, url: url, statut: d.statut };
	}

	const existantes = String(q.f.getRange(q.r, COL.PHOTOS).getValue() || '');
	q.f.getRange(q.r, COL.PHOTOS).setValue(existantes ? existantes + '\n' + url : url);
	let statut = d.statut, suiviErreur = '';
	if (STATUTS_VERS_TROUVEE.indexOf(statut) >= 0) {
		statut = 'Trouvée';
		q.f.getRange(q.r, COL.STATUT).setValue(statut);
		// reflet dans le suivi manuel OCI — jamais bloquant pour la photo
		try { _ajouterAuSuivi(d, url); }
		catch (e) { suiviErreur = e.message; _journaliser(id, statut, 'Suivi OCI non mis à jour : ' + e.message); }
	}
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, statut, 'Photo de l\'acte' + (numero ? ' (acte n° ' + numero + ')' : '') + ' : ' + url, _nomAgent(ident));
	return {
		ok: true, url: url, statut: statut, idBon: d.bon || '',
		bonACloturer: _bonACloturer(d.bon), suiviErreur: suiviErreur
	};
}

// Acte confirmé par les archives mais photo impossible (ex : registre à
// l'ANOM) — Admin/Agent. Passe « Trouvée », ligne de suivi sans lien.
function confirmerSansPhoto(id, commentaire, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	if (STATUTS_VERS_TROUVEE.indexOf(q.d.statut) < 0) {
		throw new Error('Demande déjà « ' + q.d.statut + ' »');
	}
	_poserStatut(q.f, q.r, 'Trouvée');
	let suiviErreur = '';
	try { _ajouterAuSuivi(q.d, '', commentaire); }
	catch (e) { suiviErreur = e.message; _journaliser(id, 'Trouvée', 'Suivi OCI non mis à jour : ' + e.message); }
	_journaliser(id, 'Trouvée', 'Acte TROUVÉ SANS PHOTO — confirmé par les archives' +
		(commentaire ? ' : ' + commentaire : ''), _nomAgent(ident));
	return { ok: true, idBon: q.d.bon || '', bonACloturer: _bonACloturer(q.d.bon), suiviErreur: suiviErreur };
}

// Acte non communicable en salle : les archives font la copie et l'envoient
// (photo à joindre à réception) — Admin/Agent.
function marquerNonCommunicable(id, commentaire, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	if (q.d.statut !== 'À rechercher') throw new Error('Demande déjà « ' + q.d.statut + ' »');
	_poserStatut(q.f, q.r, 'Non communicable');
	_journaliser(id, 'Non communicable', 'Acte NON COMMUNICABLE — copie faite et envoyée par les archives' +
		(commentaire ? ' : ' + commentaire : ''), _nomAgent(ident));
	return { ok: true, idBon: q.d.bon || '', bonACloturer: _bonACloturer(q.d.bon) };
}

// Registre déjà en consultation par un tiers : l'acte sort de son bon et
// reste « À rechercher » pour un prochain dispatch — Admin/Agent.
function reporterDemande(id, commentaire, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	if (!q.d.bon) throw new Error('Demande hors bon de commande');
	if (q.d.statut !== 'À rechercher') throw new Error('Demande déjà « ' + q.d.statut + ' »');
	_retirerDuBon(q.d.bon, id);
	q.f.getRange(q.r, COL.BON).setValue('');
	_tamponnerRemise(q.f, q.r);
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, 'À rechercher', 'REPORTÉE — registre déjà en consultation dans la salle' +
		(commentaire ? ' : ' + commentaire : '') + ' — sortie du bon ' + q.d.bon, _nomAgent(ident));
	return { ok: true, idBon: q.d.bon, bonACloturer: _bonACloturer(q.d.bon) };
}

// Suppression définitive — Admin. Retire la ligne et son historique, sort la
// demande de son bon (un bon vidé est détruit), corbeille le dossier photos.
function supprimerDemande(id, ident) {
	_exiger(['Admin'], ident);
	const q = _demandeLigne(id);
	if (q.d.bon) _retirerDuBon(q.d.bon, id);
	q.f.deleteRow(q.r);

	const fH = _feuille(NOM_FEUILLE_HISTORIQUE);
	const nH = fH.getLastRow() - 1;
	if (nH > 0) {
		const hist = fH.getRange(2, 1, nH, ENTETES_HISTORIQUE.length).getDisplayValues();
		const garde = hist.filter(l => String(l[0]) !== String(id));
		if (garde.length < hist.length) {
			fH.getRange(2, 1, nH, ENTETES_HISTORIQUE.length).clearContent();
			if (garde.length) fH.getRange(2, 1, garde.length, ENTETES_HISTORIQUE.length).setValues(garde);
		}
	}

	const it = obtenirDossierPhotos().getFoldersByName(id);
	if (it.hasNext()) it.next().setTrashed(true);
	console.log('Demande ' + id + ' (' + q.d.nom + ') supprimée par ' + _nomAgent(ident));
	return { ok: true };
}

// Bascule Archives ↔ Généalogie — Admin. Un acte généalogie reconnu indien
// passe en Archives pour devenir commandable (bons / formulaires) ; l'inverse
// répare une erreur d'aiguillage.
function changerDestination(id, destination, ident) {
	_exiger(['Admin'], ident);
	const dest = destination === 'Généalogie' ? 'Généalogie' : 'Archives';
	const q = _demandeLigne(id);
	q.f.getRange(q.r, COL.DESTINATION).setValue(dest);
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, q.d.statut, 'Destination : ' + q.d.destination + ' → ' + dest, _nomAgent(ident));
	return { ok: true, destination: dest };
}

// Généalogie : marque l'acte « affilié » (exploité dans le dossier client).
// Le filtre Généalogie du Suivi ne montre que les non-affiliés.
function basculerAffilie(id, actif, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const q = _demandeLigne(id);
	const date = actif ? Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy') : '';
	_poserEnTete(q.f, COL.AFFILIE);
	q.f.getRange(q.r, COL.AFFILIE).setValue(date);
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, q.d.statut, actif ? 'Affilié — acte exploité dans le dossier client' : 'Affiliation retirée', _nomAgent(ident));
	return { ok: true, affilieLe: date };
}

// Priorité « déblocage » — Admin : l'acte débloque un dossier client, il part
// en tête du dispatch des bons et s'affiche en rose.
function basculerDeblocage(id, actif, ident) {
	_exiger(['Admin'], ident);
	const q = _demandeLigne(id);
	_poserEnTete(q.f, COL.DEBLOCAGE);
	q.f.getRange(q.r, COL.DEBLOCAGE).setValue(actif ? 'Oui' : '');
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, q.d.statut, actif ? 'Priorité DÉBLOCAGE — débloque un dossier client' : 'Priorité déblocage retirée', _nomAgent(ident));
	return { ok: true, deblocage: actif ? 'Oui' : '' };
}

// Circuit apostille — étapes datées, cochées depuis l'onglet Apostille.
// Checké exige un acte Trouvée/Traitée ; Notaire exige Checké ; Apostillé
// exige Notaire (un « non apostillé » s'arrête à Checké). Décocher une étape
// efface les suivantes.
function cocherApostille(id, etape, actif, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const cols = { checke: COL.CHECKE, notaire: COL.NOTAIRE, apostille: COL.APOSTILLE };
	if (!cols[etape]) throw new Error('Étape apostille inconnue : ' + etape);
	const q = _demandeLigne(id);
	if (actif) {
		if (etape === 'checke' && q.d.statut !== 'Trouvée' && q.d.statut !== 'Traitée') {
			throw new Error('« Checké » : uniquement un acte Trouvée ou Traitée (statut actuel : ' + q.d.statut + ')');
		}
		if (etape === 'notaire' && !q.d.checkeLe) throw new Error('« Notaire » : l\'acte doit d\'abord être checké');
		if (etape === 'apostille' && !q.d.notaireLe) throw new Error('« Apostillé » : l\'acte doit d\'abord passer chez le notaire');
	}
	const date = actif ? Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy') : '';
	_poserEnTete(q.f, cols[etape]);
	q.f.getRange(q.r, cols[etape]).setValue(date);
	if (!actif) {
		if (etape === 'checke') q.f.getRange(q.r, COL.NOTAIRE, 1, 2).setValues([['', '']]);
		if (etape === 'notaire') q.f.getRange(q.r, COL.APOSTILLE).setValue('');
	}
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, q.d.statut, 'Apostille — ' + etape + (actif ? ' coché' : ' décoché (étapes suivantes effacées)'), _nomAgent(ident));
	return { ok: true, date: date };
}

// Reflète un acte trouvé EN HAUT de l'onglet de suivi OCI de sa destination,
// sur fond blanc : date | demandeur | nom | type | LIEN | bon | commentaire.
function _ajouterAuSuivi(d, urlPhoto, commentaire) {
	const nomFeuille = d.destination === 'Généalogie' ? NOM_FEUILLE_SUIVI_GENEALOGIE : NOM_FEUILLE_SUIVI_ARCHIVES;
	const f = _classeurSuivi().getSheetByName(nomFeuille);
	if (!f) throw new Error('onglet « ' + nomFeuille + ' » introuvable');
	f.insertRowBefore(2);
	const ligne = f.getRange(2, 1, 1, 8);
	ligne.clearFormat(); // ne pas hériter du format de la ligne d'en-tête
	f.getRange(2, 1, 1, 7).setValues([[
		Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy'),
		d.demandeur || '', (d.nom + ' ' + (d.prenom || '')).trim(),
		String(d.typeActe || '').toUpperCase(), urlPhoto ? 'LIEN' : 'SANS PHOTO',
		d.bon || '', commentaire || ''
	]]);
	if (urlPhoto) {
		f.getRange(2, 5).setRichTextValue(
			SpreadsheetApp.newRichTextValue().setText('LIEN').setLinkUrl(urlPhoto).build());
	}
	ligne.setBackground('#ffffff');
}
