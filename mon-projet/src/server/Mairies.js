/* ============================ COMMANDES MAIRIES ============================ */

// Actes à demander en mairie (registres récents, absents des archives…) :
// l'admin marque la demande sur sa fiche, puis l'onglet Commandes envoie les
// mails, un par mairie. Les demandes passent « Demandée » (copie attendue).

// Communes mères et dates de création (A. Schérer, Guide des archives de la
// Réunion, 1974, p. 82) : les registres antérieurs à la création d'une
// commune sont détenus par sa commune mère.
const COMMUNES_MERES = {
	'saint paul': { creation: 1665, mere: '' },
	'saint denis': { creation: 1689, mere: 'Saint-Paul' },
	'saint louis': { creation: 1726, mere: 'Saint-Paul' },
	'saint leu': { creation: 1776, mere: 'Saint-Paul' },
	'possession': { creation: 1890, mere: 'Saint-Paul' },
	'sainte suzanne': { creation: 1704, mere: 'Saint-Denis' },
	'sainte marie': { creation: 1737, mere: 'Saint-Denis' },
	'saint benoit': { creation: 1733, mere: 'Sainte-Suzanne' },
	'saint andre': { creation: 1741, mere: 'Sainte-Suzanne' },
	'sainte rose': { creation: 1790, mere: 'Saint-Benoît' },
	'bras panon': { creation: 1882, mere: 'Saint-Benoît' },
	'plaine palmistes': { creation: 1899, mere: 'Saint-Benoît' },
	'salazie': { creation: 1899, mere: 'Saint-André' },
	'saint pierre': { creation: 1735, mere: 'Saint-Louis' },
	'avirons': { creation: 1893, mere: 'Saint-Louis' },
	'etang sale': { creation: 1893, mere: 'Saint-Louis' },
	'cilaos': { creation: 1965, mere: 'Saint-Louis' },
	'saint joseph': { creation: 1798, mere: 'Saint-Pierre' },
	'entre deux': { creation: 1882, mere: 'Saint-Pierre' },
	'tampon': { creation: 1925, mere: 'Saint-Pierre' },
	'petite ile': { creation: 1935, mere: 'Saint-Pierre' },
	'saint philippe': { creation: 1830, mere: 'Saint-Joseph' },
	'trois bassins': { creation: 1897, mere: 'Saint-Leu' },
	'port': { creation: 1895, mere: 'La Possession' },
};

// Annexes d'état civil : registres propres sur une période précise (doc OCI
// 07/2026) ; hors période, l'acte relève de la commune. L'Étang-Salé fut
// annexe de Saint-Louis avant d'être commune (1895).
const ANNEXES = {
	'sainte anne': { commune: 'Saint-Benoît', debut: 1882, fin: 1942 },
	'riviere pluies': { commune: 'Sainte-Marie', debut: 1923, fin: 1941 },
	'quartier francais': { commune: 'Sainte-Suzanne', debut: 1922, fin: 1941 },
	'piton saint leu': { commune: 'Saint-Leu', debut: 1913, fin: 1935 },
	'rivieres saint louis': { commune: 'Saint-Louis', debut: 1901, fin: 1935 },
	'ravine cabris': { commune: 'Saint-Pierre', debut: 1915, fin: 1935 },
	'etang sale': { commune: 'Saint-Louis', debut: 1885, fin: 1894 },
	'saline': { commune: 'Saint-Paul', debut: 1900, fin: 1942 },
	'belle mene': { commune: 'Saint-Paul', debut: 0, fin: 9999 }, // période inconnue
	'bois nefles': { commune: 'Saint-Paul', debut: 1921, fin: 1942 },
	'guillaume': { commune: 'Saint-Paul', debut: 1925, fin: 1941 },
	'saint gilles hauts': { commune: 'Saint-Paul', debut: 1923, fin: 1941 },
	'saint gilles bas': { commune: 'Saint-Paul', debut: 1936, fin: 1942 },
	'saint gilles bains': { commune: 'Saint-Paul', debut: 1936, fin: 1942 }, // même annexe que « les Bas »
	'grand ilet': { commune: 'Salazie', debut: 1884, fin: 1941 },
	'hell bourg': { commune: 'Salazie', debut: 1899, fin: 1942 },
};

// Année du premier registre encore détenu EN MAIRIE (doc OCI 07/2026) : un
// acte antérieur est plutôt aux archives — l'app avertit au marquage.
// Valeur simple, ou détail par type d'acte quand la mairie l'a précisé.
const REGISTRES_MAIRIE_DEPUIS = {
	'bras panon': 1920, 'cilaos': 1867, 'entre deux': 1885, 'etang sale': 1895,
	'plaine palmistes': 1859, 'possession': 1900, 'port': 1895, 'avirons': 1901,
	'trois bassins': 1894, 'tampon': 1882, 'petite ile': 1935, 'saint andre': 1890,
	'saint benoit': 1893, 'saint denis': 1900, 'sainte marie': 1900, 'sainte rose': 1897,
	'sainte suzanne': 1881, 'saint joseph': 1880,
	'saint leu': { 'Naissance': 1854, 'Mariage': 1833, 'Décès': 1847 },
	'saint louis': 1901, 'saint paul': 1900,
	'saint philippe': { 'Naissance': 1887, 'Mariage': 1884 },
	'saint pierre': 1889, 'salazie': 1899,
};

/** Clé de comparaison d'un nom de commune : minuscules, sans accents, sans
 *  ponctuation ni articles (« L'ETANG SALE » ≡ « Etang-Salé (L') »). */
function _cleCommune(s) {
	return String(s || '').toLowerCase()
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.split(/[^a-z0-9]+/)
		.filter(function (m) { return m && ['la', 'le', 'les', 'l', 'de', 'des', 'du', 'd'].indexOf(m) < 0; })
		.join(' ');
}

/** Commune de rattachement — les sections « X — Y » relèvent de la mairie de X. */
function _communeMairie(commune) {
	return String(commune || '').split(' — ')[0].trim();
}

/** Mairie détentrice des registres : la commune de l'acte, remontée à la
 *  commune mère tant que l'acte est antérieur à la création de la commune. */
function _mairiePourDemande(commune, annee) {
	let nom = _communeMairie(commune);
	const an = parseInt(annee, 10) || 0;
	let e = COMMUNES_MERES[_cleCommune(nom)];
	while (an && e && an < e.creation && e.mere) {
		nom = e.mere;
		e = COMMUNES_MERES[_cleCommune(nom)];
	}
	return nom;
}

/** Seuil « registres en mairie depuis » d'une commune, selon le type d'acte. */
function _seuilMairie(nom, typeActe) {
	const s = REGISTRES_MAIRIE_DEPUIS[_cleCommune(nom)];
	if (!s) return 0;
	if (typeof s === 'number') return s;
	return s[typeActe] || Math.min.apply(null, Object.keys(s).map(function (k) { return s[k]; }));
}

/** Où l'acte relève-t-il ? L'annexe si l'année tombe dans sa période, sinon
 *  la commune (remontée à la commune mère si l'acte lui est antérieur). */
function _destinationMairie(d) {
	const an = parseInt(d.anneeActe, 10) || parseInt(_anneeDepuisDate(d.dateActe), 10) || 0;
	const parties = String(d.commune || '').split(' — ');
	const section = (parties.length > 1 ? parties[1] : parties[0]).trim();
	const a = ANNEXES[_cleCommune(section)];
	if (a && (!an || (an >= a.debut && an <= a.fin))) return { nom: section, annexe: true, an: an };
	return { nom: _mairiePourDemande(parties[0], an), annexe: false, an: an };
}

/** Feuille Commune → Email, créée vide au premier usage. */
function _feuilleMairies() {
	let f = _classeur().getSheetByName(NOM_FEUILLE_MAIRIES);
	if (!f) {
		f = _classeur().insertSheet(NOM_FEUILLE_MAIRIES);
		f.appendRow(ENTETES_MAIRIES);
	}
	return f;
}

/** Email d'une ligne de l'onglet Mairies (comparaison tolérante) ; '' si absent. */
function _chercherEmail(nom) {
	const cle = _cleCommune(nom);
	const f = _feuilleMairies();
	if (!cle || f.getLastRow() < 2) return '';
	const v = f.getRange(2, 1, f.getLastRow() - 1, 2).getDisplayValues();
	for (const l of v) {
		if (_cleCommune(l[0]) === cle && String(l[1]).trim()) return String(l[1]).trim();
	}
	return '';
}

/** Destinataire d'une demande (annexe sans ligne : retombe sur la commune). */
function _resoudreMairie(d) {
	const dest = _destinationMairie(d);
	let email = _chercherEmail(dest.nom);
	if (!email && dest.annexe) {
		dest.nom = _mairiePourDemande(String(d.commune || '').split(' — ')[0], dest.an);
		email = _chercherEmail(dest.nom);
	}
	if (!email) {
		throw new Error('Email de la mairie de ' + (dest.nom || '(commune vide)') + ' introuvable — complétez ' +
			'l\'onglet « Mairies » du classeur (lancez formaterMairies() dans l\'éditeur pour le remettre au propre).');
	}
	return { nom: dest.nom, email: email };
}

/** Marque / démarque une demande « à commander en mairie » — Admin. */
function marquerMairie(id, actif, ident) {
	_exiger(['Admin'], ident);
	const q = _demandeLigne(id);
	if (actif && q.d.statut !== 'À rechercher') {
		throw new Error('Seule une demande « À rechercher » peut partir en commande mairie');
	}
	_poserEnTete(q.f, COL.MAIRIE);
	q.f.getRange(q.r, COL.MAIRIE).setValue(actif ? 'À commander' : '');
	_tamponnerMAJ(q.f, q.r);
	_journaliser(id, q.d.statut, actif ? 'À commander en mairie' : 'Commande mairie annulée', _nomAgent(ident));

	// acte antérieur aux registres détenus par la mairie : on prévient l'admin
	let avertissement = '';
	if (actif) {
		const dest = _destinationMairie(q.d);
		const seuil = dest.annexe ? 0 : _seuilMairie(dest.nom, q.d.typeActe);
		if (dest.an && seuil && dest.an < seuil) {
			avertissement = 'Attention : la mairie de ' + dest.nom + ' ne détient ses registres (' +
				q.d.typeActe + ') que depuis ' + seuil + ' — un acte de ' + dest.an + ' est plutôt aux archives.';
		}
	}
	return { ok: true, mairie: actif ? 'À commander' : '', avertissement: avertissement };
}

/** Envoie les mails de commande — un mail par mairie résolue — Admin. */
function envoyerMailMairie(ids, ident) {
	_exiger(['Admin'], ident);
	if (!ids || !ids.length) throw new Error('Aucune demande sélectionnée');
	const lots = ids.map(function (id) { return _demandeLigne(id); });

	// groupement par destinataire (annexe, commune, ou commune mère selon l'année)
	const parEmail = {};
	for (const q of lots) {
		const m = _resoudreMairie(q.d);
		(parEmail[m.email] = parEmail[m.email] || { nom: m.nom, lots: [] }).lots.push(q);
	}

	const dateJour = Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy');
	const nomAgent = _nomAgent(ident);
	const mails = [];
	for (const email in parEmail) {
		const g = parEmail[email];
		const lignesMail = g.lots.map(function (q) {
			const d = q.d;
			return '- Acte de ' + String(d.typeActe).toLowerCase() + ' de ' + d.nom + ' ' + d.prenom +
				(d.dateActe || d.anneeActe ? ', ' + (d.dateActe || d.anneeActe) : '') +
				(d.commune ? ', établi à ' + d.commune : '') +
				(d.numeroActe ? ' (acte n° ' + d.numeroActe + ')' : '');
		});
		MailApp.sendEmail({
			to: email,
			subject: 'Demande de copies d\'actes d\'état civil (recherches généalogiques)',
			body: 'Bonjour,\n\n' +
				'Dans le cadre de recherches généalogiques, nous souhaiterions obtenir une copie intégrale ' +
				'des actes suivants :\n\n' +
				lignesMail.join('\n') + '\n\n' +
				'Vous pouvez nous les transmettre par retour de mail (copie numérisée) ou nous indiquer la marche à suivre.\n\n' +
				'Merci d\'avance pour votre aide,\nOCI Express\ncontact@ociexpress.re',
			name: 'OCI Express',
		});
		// mail parti : les demandes passent « Demandée », copie attendue de la mairie
		for (const q of g.lots) {
			_poserStatut(q.f, q.r, 'Demandée');
			q.f.getRange(q.r, COL.MAIRIE).setValue('Envoyée le ' + dateJour);
			_journaliser(q.d.id, 'Demandée', 'Mail envoyé à la mairie de ' + g.nom + ' (' + email + ')', nomAgent);
		}
		mails.push({ mairie: g.nom, email: email, nb: g.lots.length });
	}
	return { ok: true, nb: lots.length, mails: mails };
}

/**
 * Maintenance (à lancer depuis l'éditeur) : remet l'onglet « Mairies » au
 * propre avec les adresses vérifiées du doc OCI (07/2026) — noms officiels,
 * périodes des registres, annexes. Un email déjà saisi dans la feuille est
 * conservé s'il diffère ; les manquants sont surlignés.
 */
function formaterMairies() {
	_exiger(['Admin']);
	// [commune, email vérifié, registres, note]
	const LIGNES = [
		['Bras-Panon', 'etatcivil@braspanon.re', 'depuis 1920', ''],
		['Cilaos', 'ecivil@ville-cilaos.fr', 'depuis 1867', ''],
		['Entre-Deux', 'ec@entredeux.re', 'depuis 1885', ''],
		['L\'Étang-Salé', 'etatcivil@letangsale.fr', 'depuis 1895', 'Aussi annexe de Saint-Louis 1885 à 1894 (même adresse)'],
		['La Plaine-des-Palmistes', 'etat.civil@plaine-des-palmistes.fr', 'depuis 1859', ''],
		['La Possession', 'czit@lapossession.re', 'depuis 1900', ''],
		['Le Port', 'population@ville-port.re', 'depuis 1895', ''],
		['Le Tampon', 'gestion.courrier@mairie-tampon.fr', 'depuis 1882', ''],
		['Les Avirons', 'etat-civil@mairie-avirons.re', 'depuis 1901', ''],
		['Les Trois-Bassins', 'etatcivil@ville-troisbassins.re', 'depuis 1894', ''],
		['Petite-Île', 'etat-civil@petite-ile.re', 'depuis 1935', ''],
		['Saint-André', 'etat.civil@saint-andre.re', 'depuis 1890', ''],
		['Saint-Benoît', 'etatcivil@ville-saintbenoit.re', 'depuis 1893', ''],
		['Saint-Denis', 'e.lefevre@saintdenis.re', 'depuis 1900', ''],
		['Saint-Joseph', 'etatcivil@saintjoseph.re', 'depuis 1880', ''],
		['Saint-Leu', 'etatcivil@mairie-saintleu.fr', 'N 1854 · M 1833 · D 1847', ''],
		['Saint-Louis', 'etat-civil@ville-saint-louis.fr', 'depuis 1901', ''],
		['Saint-Paul', 'etat.civil@mairie-saintpaul.fr', 'depuis 1900', ''],
		['Saint-Philippe', 'etat.civil@saintphilippe.re', 'N 1887 · M 1884', ''],
		['Saint-Pierre', 'courrier@saintpierre.re', 'depuis 1889', ''],
		['Sainte-Marie', 'mcaroupaye@ville-saintemarie.re', 'depuis 1900', ''],
		['Sainte-Rose', 'etat.civil@sainterose.re', 'depuis 1897', ''],
		['Sainte-Suzanne', 'etatcivil@ville-saintesuzanne.re', 'depuis 1881', ''],
		['Salazie', 'etat-civil@ville-salazie.fr', 'depuis 1899', ''],
		['Grand Ilet', 'etat-civil@ville-salazie.fr', '1884 à 1898 · 1939 à 1941', 'Annexe de Salazie'],
		['Hell-Bourg', 'etat-civil@ville-salazie.fr', '1899 à 1942', 'Annexe de Salazie'],
		['Sainte-Anne', 'jeanmichel.vital@ville-saintbenoit.re', '1882 à 1942', 'Annexe de Saint-Benoît'],
		['Rivière des Pluies', 'marivieredespluies@ville-saintemarie.re', '1923 à 1941', 'Annexe de Sainte-Marie'],
		['Quartier Français', 'annexe.qf@ville-saintesuzanne.re', '1922 à 1941', 'Annexe de Sainte-Suzanne'],
		['Piton Saint-Leu', 'etatcivil.piton@mairie-saintleu.fr', '1913 à 1935', 'Annexe de Saint-Leu'],
		['Rivières de Saint-Louis', 'jrpattiama@saintlouis.re', '1901 à 1935', 'Annexe de Saint-Louis'],
		['Ravine des Cabris', 'etat-civil-rdc@saintpierre.re', '1915 à 1935', 'Annexe de Saint-Pierre'],
		['La Saline', 'annexe.lasaline@mairie-saintpaul.fr', '1900 à 1942', 'Annexe de Saint-Paul'],
		['Belle Mène', 'annexe.bellemene@mairie-saintpaul.fr', '', 'Annexe de Saint-Paul (période inconnue)'],
		['Bois de Nèfles', 'annexe.boisdenefles@mairie-saintpaul.fr', '1921 à 1942', 'Annexe de Saint-Paul'],
		['Le Guillaume', 'annexe.leguillaume@mairie-saintpaul.fr', '1925 à 1941', 'Annexe de Saint-Paul'],
		['Saint-Gilles les Hauts', 'annexe.saintgillesleshaut@mairie-saintpaul.fr', '1923 à 1941', 'Annexe de Saint-Paul'],
		['Saint-Gilles les Bains', 'annexe.saintgilleslesbains@mairie-saintpaul.fr', '1936 à 1942', 'Annexe de Saint-Paul (« les Bas »)'],
		['Archives départementales', '', '', 'Destinataire des bons de commande — email à compléter'],
	];
	const f = _feuilleMairies();
	// emails déjà saisis : conservés s'ils diffèrent du doc (corrections manuelles)
	const ALIAS = { 'saint phillipe': 'saint philippe', 'saint anne': 'sainte anne' };
	const connu = {};
	if (f.getLastRow() > 1) {
		f.getRange(2, 1, f.getLastRow() - 1, 2).getDisplayValues().forEach(function (l) {
			let cle = _cleCommune(l[0]);
			cle = ALIAS[cle] || cle;
			if (cle && String(l[1]).trim() && !connu[cle]) connu[cle] = String(l[1]).trim();
		});
	}
	const donnees = LIGNES.map(function (l) {
		return [l[0], l[1] || connu[_cleCommune(l[0])] || '', l[2], l[3]];
	});

	f.clear();
	f.getRange(1, 1, 1, 4).setValues([['Commune', 'Email', 'Registres', 'Note']])
		.setFontWeight('bold').setBackground('#52449b').setFontColor('#ffffff');
	f.getRange(2, 1, donnees.length, 4).setValues(donnees);
	for (let i = 0; i < donnees.length; i++) {
		if (!donnees[i][1]) f.getRange(i + 2, 2).setBackground('#fdecea');
	}
	f.setFrozenRows(1);
	f.setColumnWidth(1, 200);
	f.setColumnWidth(2, 320);
	f.setColumnWidth(3, 180);
	f.setColumnWidth(4, 320);
	const manquants = donnees.filter(function (l) { return !l[1]; }).length;
	console.log(manquants + ' email(s) manquant(s) — cellules surlignées en rouge clair');
	return manquants;
}
