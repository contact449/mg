/* ============================ BONS DE COMMANDE ============================ */

// Crée un bon pour un compte habilité — Admin. Quota MAX_COTES_PAR_PERSONNE
// par demi-journée, cumulé sur tous les bons de la personne.
function creerBonCommande(b, ident) {
	_exiger(['Admin'], ident);
	if (!b || !b.ids || !b.ids.length) throw new Error('Aucune demande sélectionnée');
	const email = String((b && b.email) || '').trim().toLowerCase();
	if (!email) throw new Error('Indiquez la personne (habilitée) qui se rend aux archives');
	const nom = _nomHabilite(email);
	if (nom === null) {
		throw new Error('Personne non habilitée : ' + email + ' — ajoutez-la d\'abord dans l\'écran Admin.');
	}
	const personne = nom || email;
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const deja = _cotesCommandees(b.dateArchives, b.demiJournee, email);
		if (deja + b.ids.length > MAX_COTES_PAR_PERSONNE) {
			throw new Error('Maximum ' + MAX_COTES_PAR_PERSONNE + ' cotes par personne et par demi-journée — ' +
				personne + ' en a déjà ' + deja + ' le ' + b.dateArchives + ' ' + b.demiJournee +
				' (' + b.ids.length + ' demandées). Répartissez sur plusieurs personnes ou demi-journées.');
		}
		return { ok: true, idBon: _creerBonInterne(b.dateArchives, b.demiJournee, email, personne, b.ids, _nomAgent(ident)) };
	} finally { lock.releaseLock(); }
}

// Création effective d'un bon — verrou et quotas vérifiés par l'appelant.
function _creerBonInterne(dateArchives, demiJournee, email, personne, ids, nomAgent) {
	const idBon = _genererID('BON', 'SEQBON');
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	const cotes = [];
	for (const id of ids) {
		const r = _trouverLigne(id);
		if (r < 0) continue;
		const d = _ligneVersObjet(f.getRange(r, 1, 1, ENTETES_DEMANDES.length).getDisplayValues()[0]);
		// la cote commandée : toujours la copie 4E si elle existe, sinon EDEPOT
		cotes.push(d.cote4E || d.coteEDEPOT || '?');
		f.getRange(r, COL.BON).setValue(idBon);
		if (d.remiseLe) f.getRange(r, COL.REMISE).setValue(''); // redispatchée : la date de remise a servi
		_tamponnerMAJ(f, r);
		_journaliser(id, d.statut, 'Ajoutée au bon de commande ' + idBon + ' (' +
			dateArchives + ' ' + demiJournee + ' — ' + personne + ')', nomAgent);
	}
	_feuille(NOM_FEUILLE_BONS).appendRow([
		idBon, dateArchives || '', demiJournee || '', personne,
		ids.join(', '), cotes.join(', '), _maintenant(), '', email
	]);
	return idBon;
}

// Répartition automatique — Admin. Distribue les demandes disponibles (À
// rechercher, cote 4E, hors bon) entre les personnes cochées, plus anciennes
// d'abord, groupées par cote, dans la limite des quotas. Un bon par personne.
// Les demandes Généalogie vont en priorité aux Admin cochés.
// p = { dateArchives:'jj/mm/aaaa', demiJournee:'Matin'|'Après-midi', emails:[…] }
function repartirBons(p, ident) {
	_exiger(['Admin'], ident);
	if (!p || !p.emails || !p.emails.length) throw new Error('Choisissez au moins une personne');
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const brut = listerDemandes('À rechercher')
			.filter(d => !d.bon && d.cote4E) // EDEPOT seul : passe par le formulaire, pas sur place
			.reverse(); // les plus anciennes d'abord
		// les actes « déblocage » (un dossier client attend dessus) partent en tête
		const dispo = brut.filter(d => d.deblocage).concat(brut.filter(d => !d.deblocage));
		if (!dispo.length) throw new Error('Aucune demande disponible (avec cote 4E, hors bon — les EDEPOT seuls passent par le formulaire)');

		const personnes = [];
		for (const brute of p.emails) {
			const email = String(brute).trim().toLowerCase();
			const l = _ligneHabilitation(email);
			if (!l) throw new Error('Personne non habilitée : ' + email);
			const capa = MAX_COTES_PAR_PERSONNE - _cotesCommandees(p.dateArchives, p.demiJournee, email);
			if (capa > 0) personnes.push({ email: email, personne: l.nom || email, role: l.role, ids: [], capa: capa });
		}
		if (!personnes.length) {
			throw new Error('Toutes les personnes choisies ont déjà leurs ' + MAX_COTES_PAR_PERSONNE +
				' cotes sur cette demi-journée');
		}

		// 1) les demandes Généalogie vont en priorité aux Admin cochés
		const admins = personnes.filter(x => x.role === 'Admin');
		const affectes = new Set();
		if (admins.length) {
			const genea = dispo.filter(d => d.destination === 'Généalogie');
			let tour = true;
			while (genea.length && tour) {
				tour = false;
				for (const pers of admins) {
					if (!genea.length) break;
					if (pers.ids.length >= pers.capa) continue;
					const d = genea.shift();
					pers.ids.push(d.id);
					affectes.add(d.id);
					tour = true;
				}
			}
		}

		// 2) le reste groupé par cote : les demandes d'un même registre vont à
		//    la même personne (une seule consultation sur place)
		const parCote = {};
		const groupes = [];
		for (const d of dispo.filter(d => !affectes.has(d.id))) {
			if (!parCote[d.cote4E]) { parCote[d.cote4E] = []; groupes.push(parCote[d.cote4E]); }
			parCote[d.cote4E].push(d);
		}
		const restantes = _distribuerParCote(groupes, personnes);

		const bons = [];
		for (const pers of personnes) {
			if (!pers.ids.length) continue;
			bons.push({
				idBon: _creerBonInterne(p.dateArchives, p.demiJournee, pers.email, pers.personne, pers.ids, _nomAgent(ident)),
				personne: pers.personne, nb: pers.ids.length
			});
		}
		console.log('Répartition : ' + bons.map(b => b.personne + '=' + b.nb).join(', ') +
			(restantes ? ' — ' + restantes + ' demande(s) non affectée(s)' : ''));
		return { ok: true, bons: bons, restantes: restantes };
	} finally { lock.releaseLock(); }
}

// Distribue les groupes (une cote = un groupe) tour par tour : chacun reçoit
// le prochain groupe qui tient en entier dans sa capacité restante ; si aucun
// ne tient, le premier est entamé. Renvoie le nombre de demandes non placées.
function _distribuerParCote(groupes, personnes) {
	let distribue = true;
	while (groupes.length && distribue) {
		distribue = false;
		for (const pers of personnes) {
			if (!groupes.length) break;
			if (pers.ids.length >= pers.capa) continue;
			let g = groupes.findIndex(x => x.length <= pers.capa - pers.ids.length);
			if (g < 0) g = 0;
			while (groupes[g].length && pers.ids.length < pers.capa) pers.ids.push(groupes[g].shift().id);
			if (!groupes[g].length) groupes.splice(g, 1);
			distribue = true;
		}
	}
	return groupes.reduce((n, grp) => n + grp.length, 0);
}

// Retire une demande d'un bon — Demandes et Cotes sont des listes parallèles,
// on retire au même index ; un bon vidé est détruit.
function _retirerDuBon(idBon, id) {
	const f = _feuille(NOM_FEUILLE_BONS);
	const n = f.getLastRow() - 1;
	if (n < 1) return;
	const v = f.getRange(2, 1, n, ENTETES_BONS.length).getDisplayValues();
	for (let i = 0; i < v.length; i++) {
		if (String(v[i][0]) !== String(idBon)) continue;
		const ids = v[i][COL_BON.DEMANDES - 1].split(',').map(s => s.trim()).filter(Boolean);
		const cotes = v[i][COL_BON.COTES - 1].split(',').map(s => s.trim());
		const k = ids.indexOf(id);
		if (k < 0) return;
		ids.splice(k, 1);
		cotes.splice(k, 1);
		if (!ids.length) {
			f.deleteRow(i + 2);
			console.log('Bon ' + idBon + ' vidé par le report de ' + id + ' — supprimé');
			return;
		}
		f.getRange(i + 2, COL_BON.DEMANDES, 1, 2).setValues([[ids.join(', '), cotes.join(', ')]]);
		return;
	}
}

// Nom d'une personne habilitée, '' si sans nom, null si email non habilité.
function _nomHabilite(email) {
	const f = _feuille(NOM_FEUILLE_HABILITATIONS);
	const n = f.getLastRow() - 1;
	if (n < 1) return null;
	const v = f.getRange(2, 1, n, 2).getValues();
	for (const l of v) {
		if (String(l[0]).trim().toLowerCase() === email) return String(l[1] || '');
	}
	return null;
}

// Cotes déjà commandées par une personne sur une demi-journée, tous bons cumulés.
function _cotesCommandees(dateArchives, demiJournee, email) {
	const f = _feuille(NOM_FEUILLE_BONS);
	const n = f.getLastRow() - 1;
	if (n < 1) return 0;
	const v = f.getRange(2, 1, n, ENTETES_BONS.length).getDisplayValues();
	let total = 0;
	for (const l of v) {
		if (l[1] === String(dateArchives || '') && l[2] === String(demiJournee || '') &&
			String(l[8]).trim().toLowerCase() === email) {
			total += l[4].split(',').filter(s => s.trim()).length;
		}
	}
	return total;
}

function listerBons(ident) {
	_exiger(['Admin', 'Agent'], ident);
	const f = _feuille(NOM_FEUILLE_BONS);
	const n = f.getLastRow() - 1;
	if (n < 1) return [];
	return f.getRange(2, 1, n, ENTETES_BONS.length).getDisplayValues().map(l => ({
		idBon: l[0], dateArchives: l[1], demiJournee: l[2], personne: l[3],
		demandes: l[4], cotes: l[5], creeLe: l[6], photoBon: l[7], email: l[8],
		mailArchives: l[9] || ''
	})).reverse();
}

/** Fin de tournée — Admin. En un geste : clôture tous les bons de la
 *  demi-journée (Trouvée → Traitée, PDF en colonne H + suivi) puis les envoie
 *  aux archives, un PDF séparé par bon. Plus de clôture manuelle bon par bon. */
function envoyerBonsArchives(dateArchives, demiJournee, ident) {
	_exiger(['Admin'], ident);
	const groupe = listerBons().filter(function (b) {
		return b.dateArchives === dateArchives && b.demiJournee === demiJournee;
	});
	if (!groupe.length) throw new Error('Aucun bon le ' + dateArchives + ' (' + demiJournee + ')');
	// pas de double envoi : on ne (re)traite que les bons pas encore envoyés
	const aTraiter = groupe.filter(function (b) { return !b.mailArchives; });
	if (!aTraiter.length) throw new Error('Ces bons ont déjà été envoyés aux archives');

	const email = _chercherEmail('Archives départementales');
	if (!email) {
		throw new Error('Ajoutez l\'email des archives sur la ligne « Archives départementales » de l\'onglet Mairies');
	}
	// rien ne part tant qu'une recherche n'est pas finie (contrôle global avant
	// de toucher au moindre statut)
	const toutes = listerDemandes('Tous');
	const restants = aTraiter.filter(function (b) {
		return toutes.some(function (o) { return o.bon === b.idBon && o.statut === 'À rechercher'; });
	});
	if (restants.length) {
		throw new Error('Termine d\'abord les recherches — bon(s) ' +
			restants.map(function (b) { return b.idBon; }).join(', ') + ' encore « À rechercher »');
	}

	// clôture chaque bon (Trouvée → Traitée + PDF colonne H + lien suivi) puis
	// prépare sa pièce jointe — régénérée à jour, pas de compilation
	const pieces = [];
	for (const b of aTraiter) {
		cloturerBon(b.idBon, ident);
		const bon = getBon(b.idBon);
		const blob = _blobPdfBon(bon);
		if (blob) pieces.push({ bon: b, blob: blob, nb: _lignesImprimables(bon).length });
	}
	if (!pieces.length) throw new Error('Aucun acte imprimable dans les bons du ' + dateArchives);
	const nbActes = pieces.reduce(function (n, p) { return n + p.nb; }, 0);
	const session = demiJournee === 'Matin' ? 'du matin' : 'de l\'après-midi';
	MailApp.sendEmail({
		to: email,
		cc: 'fabrice@sindraye.re',
		subject: 'Transmission des bons de commande du ' + dateArchives + ' – ' + demiJournee,
		body: 'Bonjour,\n\n' +
			'Comme convenu avec l\'équipe des Archives Départementales de La Réunion, vous trouverez ' +
			'ci-joint les bons de commande pour la session ' + session + '.\n\n' +
			'Récapitulatif :\n' +
			'- Date : ' + dateArchives + '\n' +
			'- Nombre de bons : ' + pieces.length + '\n' +
			'- Nombre d\'actes : ' + nbActes + '\n\n' +
			'Merci d\'avance pour votre aide.\n\n' +
			'Cordialement,\n\nOCI Express\ncontact@ociexpress.re',
		name: 'OCI Express',
		attachments: pieces.map(function (p) { return p.blob; }),
	});
	// tampon « Mail archives » sur chaque bon envoyé
	const f = _feuille(NOM_FEUILLE_BONS);
	_poserEnTete(f, COL_BON.MAIL, ENTETES_BONS);
	const dateJour = Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy');
	for (const p of pieces) {
		const r = _ligneBon(p.bon.idBon);
		if (r > 0) f.getRange(r, COL_BON.MAIL).setValue('Envoyé le ' + dateJour);
	}
	return { ok: true, nb: pieces.length, actes: nbActes, sansPdf: groupe.length - pieces.length, email: email };
}

// Bons affectés au compte connecté ou à l'identité déclarée.
function listerMesBons(ident) {
	_exiger(['Admin', 'Agent'], ident);
	const email = _role(ident || null).email;
	if (!email) return [];
	return listerBons().filter(b => String(b.email).trim().toLowerCase() === email.toLowerCase());
}

// Détail d'un bon avec ses demandes — la feuille Demandes est lue une fois.
function getBon(idBon, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const bon = listerBons().find(b => b.idBon === idBon);
	if (!bon) throw new Error('Bon introuvable : ' + idBon);
	const ids = bon.demandes.split(',').map(s => s.trim()).filter(Boolean);
	const parId = {};
	for (const d of listerDemandes('Tous')) parId[d.id] = d;
	bon.lignes = ids.map(id => parId[id]).filter(Boolean);
	return bon;
}

// Prêt à clôturer ? Plus d'« À rechercher », quelque chose à mettre sur le
// PDF, et des « Trouvée » à traiter OU pas encore de PDF (une copie NC
// arrivée après clôture rouvre le droit de clôturer).
function _bonACloturer(idBon) {
	if (!idBon) return false;
	const bon = listerBons().find(b => b.idBon === idBon);
	if (!bon) return false;
	const actes = listerDemandes('Tous').filter(o => o.bon === idBon);
	if (!actes.length || actes.some(o => o.statut === 'À rechercher')) return false;
	const imprimable = actes.some(o => o.statut !== 'En erreur' && o.statut !== 'Non trouvé');
	return imprimable && (actes.some(o => o.statut === 'Trouvée') || !bon.photoBon);
}

// Ligne (1-based) d'un bon dans la feuille Bons, -1 si introuvable.
function _ligneBon(idBon) {
	const f = _feuille(NOM_FEUILLE_BONS);
	const n = f.getLastRow() - 1;
	if (n < 1) return -1;
	// getDisplayValues + trim comme les autres lecteurs de la feuille (l'ID vient
	// lui-même d'un getDisplayValues côté appelant — évite un faux -1)
	const v = f.getRange(2, 1, n, 1).getDisplayValues();
	const cible = String(idBon).trim();
	for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim() === cible) return i + 2;
	return -1;
}

// Clôture du bon — Admin/Agent. Les « Trouvée » passent « Traitée » et le
// PDF officiel est généré (ou réouvert), à envoyer par mail aux archives.
function cloturerBon(idBon, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	const n = f.getLastRow() - 1;
	const actes = [];
	if (n > 0) {
		const v = f.getRange(2, 1, n, ENTETES_DEMANDES.length).getDisplayValues();
		for (let i = 0; i < v.length; i++) {
			const o = _ligneVersObjet(v[i]);
			if (o.bon === idBon) { o.ligne = i + 2; actes.push(o); }
		}
	}
	if (!actes.length) throw new Error('Aucun acte dans le bon ' + idBon);
	const restants = actes.filter(o => o.statut === 'À rechercher').length;
	if (restants) throw new Error(restants + ' acte(s) encore « À rechercher » — traite-les avant de clôturer');
	const nomAgent = _nomAgent(ident);
	let traitees = 0;
	for (const o of actes) {
		if (o.statut !== 'Trouvée') continue;
		_poserStatut(f, o.ligne, 'Traitée');
		_journaliser(o.id, 'Traitée', 'Clôturée avec le bon ' + idBon, nomAgent);
		traitees++;
	}
	const pdf = genererPdfBon(idBon);
	return { ok: true, url: pdf.url, traitees: traitees };
}

// Pose le lien du bon (PDF) sur la colonne COMMANDER des lignes de suivi OCI
// écrites pour ce bon (le texte reste l'ID du bon), onglets A et G.
function _lierBonAuSuivi(idBon, urlPhoto) {
	for (const nom of [NOM_FEUILLE_SUIVI_ARCHIVES, NOM_FEUILLE_SUIVI_GENEALOGIE]) {
		const f = _classeurSuivi().getSheetByName(nom);
		if (!f) continue;
		const n = f.getLastRow() - 1;
		if (n < 1) continue;
		const valeurs = f.getRange(2, 6, n, 1).getDisplayValues();
		for (let i = 0; i < valeurs.length; i++) {
			if (String(valeurs[i][0]).trim() === String(idBon)) {
				f.getRange(i + 2, 6).setRichTextValue(
					SpreadsheetApp.newRichTextValue().setText(String(idBon)).setLinkUrl(urlPhoto).build());
			}
		}
	}
}
