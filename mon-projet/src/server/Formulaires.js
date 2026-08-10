/* ============================ FORMULAIRES PDF ============================ */

// Copie un modèle Google Docs (l'original n'est jamais modifié), le remplit,
// exporte le PDF (partagé par lien) et jette la copie temporaire, même en erreur.
function _genererPdfDepuisModele(idModele, nomPdf, remplir) {
	const copie = DriveApp.getFileById(idModele).makeCopy('~temp - ' + nomPdf);
	try {
		const doc = DocumentApp.openById(copie.getId());
		remplir(doc.getBody());
		doc.saveAndClose();
		const dossier = DriveApp.getFolderById(ID_DOSSIER_FORMULAIRES);
		const pdf = dossier.createFile(copie.getAs('application/pdf').setName(nomPdf + '.pdf'));
		pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
		return pdf.getUrl();
	} finally {
		copie.setTrashed(true);
	}
}

// Remplit le tableau « Actes demandés » : la ligne vide sous l'en-tête sert
// de modèle (dupliquée si besoin) pour préserver la mise en page.
function _remplirTableauActes(body, lignes, versCellules) {
	const table = body.getTables()[0];
	if (!table) throw new Error('Tableau « Actes demandés » introuvable dans le modèle');
	const nbColonnes = table.getRow(0).getNumCells();
	const modele = table.getRow(1);
	while (table.getNumRows() - 1 < lignes.length) table.appendTableRow(modele.copy());
	lignes.forEach(function (d, i) {
		const cellules = versCellules(d);
		if (cellules.length !== nbColonnes) {
			throw new Error('Ligne ' + (i + 1) + ' : ' + cellules.length + ' valeurs pour ' +
				nbColonnes + ' colonnes — le modèle a-t-il changé ?');
		}
		const r = table.getRow(i + 1);
		for (let c = 0; c < cellules.length; c++) {
			const texte = String(cellules[c] == null ? '' : cellules[c]);
			const cellule = r.getCell(c);
			cellule.setText(texte);
			// police imposée : taille 11, ni gras ni italique
			if (texte) cellule.editAsText().setBold(false).setItalic(false).setFontSize(11);
		}
	});
}

// Formulaire EDEPOT — Admin. Demande officielle de copies certifiées ; la
// preuve (capture) est obligatoire, sinon refus en listant les bloquantes.
function genererFormulaireEdepot(ids, ident) {
	_exiger(['Admin'], ident);
	if (!ids || !ids.length) throw new Error('Aucune demande sélectionnée');
	if (ids.length > MAX_ACTES_FORMULAIRE_EDEPOT) {
		throw new Error('Maximum ' + MAX_ACTES_FORMULAIRE_EDEPOT + ' actes par formulaire EDEPOT — ' +
			ids.length + ' sélectionnés. Faites plusieurs formulaires.');
	}
	const f = _feuille(NOM_FEUILLE_DEMANDES);
	const lignes = [], bloquees = [];
	for (const id of ids) {
		const r = _trouverLigne(id);
		if (r < 0) { bloquees.push(id + ' : introuvable'); continue; }
		const d = _ligneVersObjet(f.getRange(r, 1, 1, ENTETES_DEMANDES.length).getDisplayValues()[0]);
		if (!d.coteEDEPOT) bloquees.push(d.id + ' (' + d.nom + ') : pas de cote EDEPOT');
		else if (!d.preuve) bloquees.push(d.id + ' (' + d.nom + ') : preuve (capture) manquante');
		else { d.ligne = r; lignes.push(d); }
	}
	if (bloquees.length) throw new Error('Formulaire non généré — ' + bloquees.join(' ; '));

	const dateJour = Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy');
	const nomPdf = 'Formulaire EDEPOT ' + Utilities.formatDate(new Date(), 'Indian/Reunion', 'yyyy-MM-dd HH.mm');
	const url = _genererPdfDepuisModele(ID_MODELE_FORMULAIRE_EDEPOT, nomPdf, function (body) {
		_remplirTableauActes(body, lignes, function (d) {
			return [d.nom, d.prenom, d.typeActe,
				d.dateActe || d.anneeActe,
				d.commune + (d.coteEDEPOT ? ' — ' + d.coteEDEPOT : ''),
				d.numeroActe, NB_COPIES_CERTIFIEES];
		});
		body.replaceText('Le\\s*…', 'Le ' + dateJour);
	});
	// les demandes passent « Demandée » : copies commandées, en attente des archives
	const nomAgent = _nomAgent(ident);
	for (const d of lignes) {
		_poserStatut(f, d.ligne, 'Demandée');
		_journaliser(d.id, 'Demandée', 'Formulaire EDEPOT généré : ' + url, nomAgent);
	}
	return { ok: true, url: url, nb: lignes.length };
}

// Actes imprimables d'un bon : tout sauf erreurs, non trouvés et généalogie
// (photo de vérification, aucune copie à demander).
function _lignesImprimables(bon) {
	return (bon.lignes || []).filter(function (d) {
		return d.statut !== 'En erreur' && d.statut !== 'Non trouvé' && d.destination !== 'Généalogie';
	});
}

// Blob PDF d'un seul bon (≤5 cotes, une personne) reproduisant le formulaire
// officiel — null si rien à demander (bon 100 % généalogie / tout en erreur).
function _blobPdfBon(bon) {
	const lignes = _lignesImprimables(bon);
	if (!lignes.length) return null;
	const dateArchives = bon.dateArchives || Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy');
	const nomPdf = 'BON ' + bon.idBon + ' ' + String(bon.dateArchives || '').replace(/\//g, '-');
	return Utilities.newBlob(_htmlFormulaireBon(lignes, dateArchives), 'text/html', nomPdf + '.html')
		.getAs('application/pdf').setName(nomPdf + '.pdf');
}

// HTML du formulaire officiel (paysage, en-tête et tarifs sur chaque page,
// date + signature à la fin) — le PDF d'un bon (≤5 cotes) tient sur une page.
function _htmlFormulaireBon(lignes, dateArchives) {
	const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
	const rang = function (d) {
		return '<tr><td>' + [(d.statut === 'Non communicable' ? 'NC — ' : '') + d.nom, d.prenom, d.typeActe,
			d.dateActe || d.anneeActe, d.commune, d.numeroActe, NB_COPIES_CERTIFIEES]
			.map(esc).join('</td><td>') + '</td></tr>';
	};

	// pagination manuelle : l'en-tête (logo + titres) et le rappel tarifs se
	// répètent sur chaque page, comme sur le formulaire d'origine
	const PAGE1 = 14, SUIVANTES = 18; // rangs par page (~26 px le rang en paysage)
	const pages = [lignes.slice(0, PAGE1)];
	for (let i = PAGE1; i < lignes.length; i += SUIVANTES) pages.push(lignes.slice(i, i + SUIVANTES));
	// le bloc date + signature (~5 rangs) doit tenir sous le tableau de la dernière page
	const der = pages[pages.length - 1], maxDer = pages.length === 1 ? PAGE1 - 5 : SUIVANTES - 4;
	if (der.length > maxDer) pages.push(der.splice(maxDer));

	const enTete = '<div class="entete">' +
		(BON_LOGO_B64 ? '<img class="logo" src="data:image/png;base64,' + BON_LOGO_B64 + '">' : '') +
		'<div class="titres"><b>Carte Overseas Citizenship of India (OCI)</b><br>' +
		'<b>Demande de copies d\'actes d\'état civil certifiées conformes</b></div></div>';
	const pied = '<p class="pied">Quand les documents n\'ont pas déjà été numérisés, les prises de vue sont ' +
		'facturées 3 € l\'unité. Les tirages papier A4 sont facturés 0,10 € l\'unité<br>' +
		'<b>Horaires d\'ouverture :</b> Du lundi au jeudi de 8h00 à 16h00.</p>';
	const colonnes = '<tr><th>Nom</th><th>Prénom</th><th>Nature des actes<br>(naissance,<br>mariage, décès)</th>' +
		'<th>Date</th><th>Commune</th><th>N° Actes</th><th>Nombre<br>de<br>copies</th></tr>';

	const corps = pages.map(function (chunk, i) {
		const premiere = i === 0, derniere = i === pages.length - 1;
		return '<div class="page' + (derniere ? '' : ' saut') + '">' + enTete +
			(premiere
				? '<h2>Identification du demandeur</h2>' +
				'<table class="ident"><tr><td><b>Nom et prénoms :</b> ' + esc(BON_DEMANDEUR.nom) + '</td>' +
				'<td><b>Téléphone :</b> ' + esc(BON_DEMANDEUR.tel) + '</td></tr>' +
				'<tr><td><b>Adresse :</b> ' + esc(BON_DEMANDEUR.adresse) + '</td>' +
				'<td><b>Mail :</b> ' + esc(BON_DEMANDEUR.mail) + '</td></tr></table>' +
				'<h2>Actes demandés</h2>'
				: '') +
			'<table class="actes">' + (premiere ? colonnes : '') + chunk.map(rang).join('') + '</table>' +
			(derniere
				? '<p class="signature"><b><i>Date et signature du demandeur :</i></b><br><b><i>Le ' +
				esc(dateArchives) + '</i></b></p>' +
				(BON_SIGNATURE_B64 ? '<img class="parafe" src="data:image/png;base64,' + BON_SIGNATURE_B64 + '">' : '')
				: '') +
			pied + '</div>';
	}).join('');

	const html = '<html><head><meta charset="utf-8"><style>' +
		'@page{size:A4 landscape;margin:24px 30px}' +
		'body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:0}' +
		'.saut{page-break-after:always}' +
		'.entete{margin-bottom:8px}' +
		'.logo{float:left;width:90px}' +
		'.titres{text-align:center;font-family:\'Times New Roman\',Georgia,serif;font-size:13px;padding-top:6px}' +
		'h2{clear:both;text-align:center;font-family:\'Times New Roman\',Georgia,serif;font-style:italic;font-size:16px;margin:22px 0 10px}' +
		'.ident{width:100%;border-collapse:collapse}.ident td{border:none;padding:6px 4px;font-size:12px}' +
		'.actes{border-collapse:collapse;width:100%;margin-top:8px}' +
		'.actes th,.actes td{border:1px solid #000;padding:6px 5px;text-align:center;font-weight:bold;font-size:11px}' +
		'.signature{margin:24px 0 4px;font-family:Arial,sans-serif}' +
		'.parafe{width:150px}' +
		'.pied{font-size:9px;margin-top:26px}' +
		'</style></head><body>' + corps + '</body></html>';
	return html;
}

/**
 * BON DE COMMANDE PDF — reproduit le formulaire officiel des archives avec
 * les actes du bon (Admin/Agent) : logo, en-tête, date + signature.
 * Généré à la clôture, un PDF par bon.
 */
function genererPdfBon(idBon, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const bon = getBon(idBon);
	// figurent sur le bon : tous les actes — y compris traités et non
	// communicables (marqués « NC » à gauche : copie à faire par les
	// archives) — sauf erreurs, non trouvés et généalogie. Bon 100 %
	// généalogie (ou tout en erreur) : rien à demander aux archives.
	const blob = _blobPdfBon(bon);
	if (!blob) return { ok: true, url: bon.photoBon || '' };
	// écrase le PDF existant du même bon (regénéré à jour) au lieu d'empiler
	// des doublons au même nom sur le Drive
	const dossier = DriveApp.getFolderById(ID_DOSSIER_FORMULAIRES);
	const anciens = dossier.getFilesByName(blob.getName());
	while (anciens.hasNext()) anciens.next().setTrashed(true);
	const pdf = dossier.createFile(blob);
	pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
	const url = pdf.getUrl();
	// le lien du bon (col 8, ex-photo du bon) + la colonne COMMANDER du
	// suivi OCI pointent vers ce PDF — jamais bloquant
	const ligne = _ligneBon(idBon);
	if (ligne > 0) _feuille(NOM_FEUILLE_BONS).getRange(ligne, COL_BON.LIEN).setValue(url);
	try { _lierBonAuSuivi(idBon, url); }
	catch (e) { console.log('Suivi OCI non mis à jour (lien du bon) : ' + e.message); }
	return { ok: true, url: url };
}
