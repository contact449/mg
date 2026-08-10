/* ============================ STATISTIQUES ============================ */

// Écran Suivi : liste filtrée + stats des tuiles en une seule lecture.
function getSuivi(filtreStatut, ident) {
	_exiger(['Admin', 'Agent'], ident);
	const tout = listerDemandes('Tous');
	const s = { total: tout.length };
	STATUTS.forEach(st => s[st] = tout.filter(o => o.statut === st).length);
	// Généalogie = les actes encore à exploiter (non affiliés) ; les affiliés
	// (déjà intégrés au dossier client) ont leur propre filtre
	const genea = o => o.destination === 'Généalogie' && !o.affilieLe;
	s['Généalogie'] = tout.filter(genea).length;
	// trouvées du jour — proxy : Trouvée OU Traitée avec dernière MAJ
	// aujourd'hui (une Trouvée clôturée dans la journée reste comptée)
	const auj = Utilities.formatDate(new Date(), 'Indian/Reunion', 'dd/MM/yyyy');
	const trouveeAuj = o => (o.statut === 'Trouvée' || o.statut === 'Traitée') &&
		String(o.derniereMAJ).indexOf(auj) === 0;
	s['Trouvée aujourd\'hui'] = tout.filter(trouveeAuj).length;
	// EDEPOT seul « À rechercher » = une commande à faire (formulaire), pas une
	// recherche sur place : section « Commande EDEPOT », exclue d'« À rechercher »
	const cmdEdepot = o => o.statut === 'À rechercher' && o.coteEDEPOT && !o.cote4E;
	s['Commande EDEPOT'] = tout.filter(cmdEdepot).length;
	s['À rechercher'] -= s['Commande EDEPOT'];
	return {
		liste: filtreStatut === 'Commande EDEPOT' ? tout.filter(cmdEdepot)
			: filtreStatut === 'À rechercher' ? tout.filter(o => o.statut === 'À rechercher' && !cmdEdepot(o))
				: filtreStatut === 'Trouvée aujourd\'hui' ? tout.filter(trouveeAuj)
					: filtreStatut === 'Généalogie' ? tout.filter(genea)
						: filtreStatut === 'Affiliés' ? tout.filter(o => o.affilieLe)
							: filtreStatut && filtreStatut !== 'Tous' ? tout.filter(o => o.statut === filtreStatut) : tout,
		stats: s
	};
}
