// Données factices pour le dev local (npm run dev, sans Apps Script).
// Changer de rôle : localStorage.setItem('mockRole', 'Admin'|'Agent'|'Lecture')
// puis recharger. Par défaut : Admin.

const role = (typeof localStorage !== 'undefined' && localStorage.getItem('mockRole')) || 'Admin';

// identité déclarée simulée (parcours « Gmail perso » : mockRole=Lecture puis identification)
function identiteStockee(): { email: string; code: string } | null {
	try { return JSON.parse(localStorage.getItem('archives-identite') || 'null'); }
	catch { return null; }
}

function profilCourant() {
	const ident = identiteStockee();
	if (role === 'Lecture' && ident) {
		return {
			email: ident.email, nom: 'Rachida', role: 'Agent', connecte: true,
			declare: true, peutModifier: true, estAdmin: false,
		};
	}
	return {
		email: role === 'Lecture' ? '' : 'contact@ociexpress.re',
		nom: role === 'Agent' ? 'Rachida' : role === 'Admin' ? 'Administrateur' : '',
		role,
		connecte: role !== 'Lecture',
		declare: false,
		peutModifier: role !== 'Lecture',
		estAdmin: role === 'Admin',
	};
}

const demandes = [
	{
		id: 'DEM-2026-0231', dateCreation: '09/07/2026 08:12:00', typeActe: 'Naissance',
		nom: 'SINAPAYEL', prenom: 'Jean Baptiste', commune: 'Saint-Pierre', anneeActe: '1895',
		dateActe: '', demandeur: 'ARSEN AJIRKAN', statut: 'À rechercher',
		classement: 'Cote 4E (copie)', cote4E: '4E5/426', coteEDEPOT: '', photos: '',
		notes: 'Lot commande manuel : 08072026-1', derniereMAJ: '09/07/2026 08:12:00',
		destination: 'Archives', avant1908: 'Oui', preuve: 'https://drive.google.com/file/d/xxx/view',
		bon: 'BON-2026-0012', remiseLe: '', deblocage: 'Oui',
	},
	{
		id: 'DEM-2026-0230', dateCreation: '09/07/2026 08:10:00', typeActe: 'Mariage',
		nom: 'FINA GEORGES ET POTEYEN FRANSISKA', prenom: '', commune: '', anneeActe: '',
		dateActe: '', demandeur: '', statut: 'À rechercher', classement: '', cote4E: '',
		coteEDEPOT: '', photos: '', notes: '', derniereMAJ: '09/07/2026 08:10:00',
		destination: 'Généalogie', avant1908: '', preuve: '', bon: '', remiseLe: '12/07/2026',
		affilieLe: '15/07/2026',
	},
	{
		id: 'DEM-2026-0229', dateCreation: '08/07/2026 14:02:00', typeActe: 'Décès',
		nom: 'RAMASSAMY', prenom: 'Nagou', commune: 'Saint-Paul', anneeActe: '1870',
		dateActe: '12/03/1870', demandeur: '', statut: 'Trouvée',
		classement: 'Cote EDEPOT (original)', cote4E: '', coteEDEPOT: 'EDEPOT1/129',
		photos: 'https://drive.google.com/file/d/yyy/view', notes: '',
		derniereMAJ: '09/07/2026 09:00:00', destination: 'Archives', avant1908: 'Oui',
		preuve: '', bon: 'BON-2026-0012',
	},
	{
		id: 'DEM-2026-0228', dateCreation: '08/07/2026 13:50:00', typeActe: 'Naissance',
		nom: 'PIRKANA', prenom: 'Rajana Andalama', commune: 'Saint-Denis', anneeActe: '1922',
		dateActe: '', demandeur: '', statut: 'À rechercher', classement: '', cote4E: '',
		coteEDEPOT: '', photos: '', notes: 'Trouvé sur ANOM mais photo indisponible',
		derniereMAJ: '08/07/2026 13:50:00', destination: 'Archives', avant1908: 'Non',
		preuve: '', bon: '', mairie: 'À commander',
	},
	{
		id: 'DEM-2026-0227', dateCreation: '02/07/2026 10:00:00', typeActe: 'Mariage',
		nom: 'MOUTOUCOMORAPOULLE', prenom: 'Vellayoudom', commune: 'Salazie', anneeActe: '1910',
		dateActe: '', demandeur: '', statut: 'En erreur', classement: 'Cote 4E (copie)',
		cote4E: '4E14/184', coteEDEPOT: '', photos: '', notes: 'Date différente sur le registre',
		derniereMAJ: '05/07/2026 11:00:00', destination: 'Archives', avant1908: 'Oui',
		preuve: '', bon: '',
	},
	{
		id: 'DEM-2026-0226', dateCreation: '30/06/2026 09:30:00', typeActe: 'Décès',
		nom: 'VALLIAMEE', prenom: '', commune: 'Sainte-Suzanne', anneeActe: '1900',
		dateActe: '', demandeur: '', statut: 'Traitée', classement: 'Cote 4E (copie)',
		cote4E: '4E3/266', coteEDEPOT: '', photos: 'https://drive.google.com/file/d/zzz/view',
		notes: '', derniereMAJ: '02/07/2026 16:00:00', destination: 'Archives',
		avant1908: 'Oui', preuve: '', bon: '', checkeLe: '20/07/2026',
	},
	{
		id: 'DEM-2026-0225', dateCreation: '30/06/2026 09:00:00', typeActe: 'Naissance',
		nom: 'GOVINDIN', prenom: 'Tirouvingalom', commune: 'Saint-Louis', anneeActe: '1888',
		dateActe: '', demandeur: '', statut: 'Non trouvé', classement: '', cote4E: '',
		coteEDEPOT: '', photos: '', notes: 'Absent du livret', derniereMAJ: '01/07/2026 15:00:00',
		destination: 'Archives', avant1908: 'Oui', preuve: '', bon: '',
	},
];

const bons = [
	{
		idBon: 'BON-2026-0012', dateArchives: '10/07/2026', demiJournee: 'Matin',
		personne: 'Rachida', demandes: 'DEM-2026-0231, DEM-2026-0229', cotes: '4E5/426, EDEPOT1/129',
		creeLe: '09/07/2026 08:30:00', photoBon: '', email: 'rachida@gmail.com', mailArchives: '',
	},
	{
		idBon: 'BON-2026-0011', dateArchives: '03/07/2026', demiJournee: 'Après-midi',
		personne: 'Paul', demandes: 'DEM-2026-0226', cotes: '4E3/266',
		creeLe: '02/07/2026 09:00:00', photoBon: 'https://drive.google.com/file/d/bon/view',
		email: 'paul@ociexpress.re', mailArchives: '',
	},
];

const habilitations = [
	{ email: 'contact@ociexpress.re', nom: 'Administrateur', role: 'Admin', ajouteLe: '01/06/2026', ajoutePar: 'initialiser()', aCode: false },
	{ email: 'rachida@gmail.com', nom: 'Rachida', role: 'Agent', ajouteLe: '09/07/2026', ajoutePar: 'contact@ociexpress.re', aCode: true },
	{ email: 'paul@gmail.com', nom: 'Paul', role: 'Agent', ajouteLe: '09/07/2026', ajoutePar: 'contact@ociexpress.re', aCode: false },
];

// en prod, listerCommunes intercale les sections (« Commune — Section ») depuis Base_Cotes
const communes = ['Avirons (Les)', 'Bras-Panon', 'Cilaos', 'Entre-Deux', 'Etang-Salé',
	'Petite-Île', 'Plaine-des-Palmistes', 'Port (Le)', 'Possession (La)',
	'Saint-André', 'Saint-Benoît', 'Saint-Denis', 'Saint-Joseph', 'Saint-Leu',
	'Saint-Louis', 'Saint-Paul', 'Saint-Paul — La Saline', 'Saint-Paul — Saint-Gilles les Hauts',
	'Saint-Philippe', 'Saint-Pierre', 'Sainte-Marie',
	'Sainte-Rose', 'Sainte-Suzanne', 'Salazie', 'Tampon (Le)', 'Trois-Bassins'];

function stats() {
	const s: Record<string, number> = { total: demandes.length };
	for (const st of ['À rechercher', 'Demandée', 'Trouvée', 'En erreur', 'Non trouvé', 'Non communicable', 'Stand by', 'Traitée']) {
		s[st] = demandes.filter(d => d.statut === st).length;
	}
	s['Généalogie'] = demandes.filter(d => d.destination === 'Généalogie').length;
	s["Trouvée aujourd'hui"] = 1;
	s['Commande EDEPOT'] = demandes.filter(d => d.statut === 'À rechercher' && d.coteEDEPOT && !d.cote4E).length;
	s['À rechercher'] -= s['Commande EDEPOT'];
	return s;
}

const reponses: Record<string, (args: unknown[]) => unknown> = {
	getProfil: () => profilCourant(),
	getBootstrap: () => ({ profil: profilCourant(), suivi: { liste: demandes, stats: stats() } }),
	listerPersonnes: () => habilitations.map(h => ({ email: h.email, nom: h.nom, role: h.role, aCode: h.aCode })),
	identifier: args => {
		const [email, code] = args as [string, string];
		if (email === 'rachida@gmail.com' && code === '1234') {
			return { email, nom: 'Rachida', role: 'Agent', connecte: true, declare: true, peutModifier: true, estAdmin: false };
		}
		throw new Error('Identification refusée — vérifie la personne choisie et le code.');
	},
	definirCode: () => ({ ok: true }),
	listerDemandes: args => {
		const f = args[0] as string;
		return f && f !== 'Tous' ? demandes.filter(d => d.statut === f) : demandes;
	},
	getSuivi: args => {
		const f = args[0] as string;
		return {
			liste: f === "Trouvée aujourd'hui" ? demandes.filter(d => d.statut === 'Trouvée' || d.statut === 'Traitée')
				: f === 'Commande EDEPOT' ? demandes.filter(d => d.statut === 'À rechercher' && d.coteEDEPOT && !d.cote4E)
					: f === 'À rechercher' ? demandes.filter(d => d.statut === f && !(d.coteEDEPOT && !d.cote4E))
						: f && f !== 'Tous' ? demandes.filter(d => d.statut === f) : demandes,
			stats: stats(),
		};
	},
	getDemande: args => {
		const d = demandes.find(x => x.id === args[0]);
		if (!d) throw new Error('Demande introuvable : ' + args[0]);
		return {
			...d, historique: [
				{ date: d.dateCreation, statut: 'À rechercher', detail: 'Création — ' + d.typeActe + ' / ' + d.nom, agent: 'contact@ociexpress.re' },
				{ date: d.derniereMAJ, statut: d.statut, detail: 'Dernier évènement (mock)', agent: 'rachida@ociexpress.re' },
			],
		};
	},
	listerCommunes: () => communes,
	idlrReferentiel: () => ({
		secteurs: ['TCO', 'CIREST', 'CINOR', 'CASUD', 'CIVIS', 'Notaires'],
		communes: ['Saint-Denis', 'Sainte-Suzanne', 'Saint-Paul'],
		types: { N: 'Naissance', D: 'Décès', M: 'Mariage', PM: 'Promesse de mariage', DIV: 'Divorce' },
	}),
	idlrRecherche: () => ({
		ok: true, total: 1, count: 1, page: 1, totalPages: 1, cached: false, warnings: [],
		scope: { type: 'secteur', label: 'CINOR' },
		results: [{
			type_acte: 'N', type_acte_libelle: 'Naissance', commune: 'Sainte-Suzanne', date: '12.03.1902',
			numero: 'STSU_1902_0042', url_demande_photo: 'http://www.iledelareunion-archive.com/recherche.php?rech=12',
			personnes: {
				principal: {
					nom: 'PAYET', prenom: 'Marie Louise', sexe: 'F',
					pere: { prenom: 'Jean', decede: false }, mere: { nom: 'HOARAU', prenom: 'Rose', decede: true },
					parrain: 'Pierre PAYET', marraine: 'Julie HOARAU',
				},
			},
		}],
	}),
	rechercherCotes: args => {
		const [commune, , annee] = args as [string, string, string];
		if (!commune || !annee) return { resultats: [] };
		return {
			resultats: [{
				commune, types: 'Naissances', table: false, intitule: 'Naissances',
				anneeDebut: String(annee), anneeFin: '', cote4E: '4E5/426', coteEDEPOT: '',
			}],
		};
	},
	creerDemande: () => ({ ok: true, id: 'DEM-2026-9999', classement: 'Cote 4E (copie)', cote4E: '4E5/426', coteEDEPOT: '', avant1908: 'Oui' }),
	modifierDemande: () => ({ ok: true }),
	chercherMatriculeIdlr: () => ({ ok: true, matricule: '89446', total: 3, apercu: { nom: 'PIRKANA', prenom: 'Rajana', date: '12/03/1922', commune: 'Saint-Denis', obs: '°08 M32 n°89446' } }),
	chercherMatriculeIdlrCriteres: () => ({ ok: true, matricule: '89446', total: 3, apercu: { nom: 'PIRKANA', prenom: 'Rajana', date: '12/03/1922', commune: 'Saint-Denis', obs: '°08 M32 n°89446' } }),
	supprimerDemande: () => ({ ok: true }),
	changerDestination: args => {
		const d = demandes.find(x => x.id === args[0]) as { destination?: string } | undefined;
		if (d) d.destination = String(args[1]);
		return { ok: true, destination: args[1] };
	},
	basculerAffilie: args => {
		const d = demandes.find(x => x.id === args[0]) as { affilieLe?: string } | undefined;
		const date = args[1] ? '03/08/2026' : '';
		if (d) d.affilieLe = date;
		return { ok: true, affilieLe: date };
	},
	basculerDeblocage: args => {
		const d = demandes.find(x => x.id === args[0]) as { deblocage?: string } | undefined;
		if (d) d.deblocage = args[1] ? 'Oui' : '';
		return { ok: true, deblocage: args[1] ? 'Oui' : '' };
	},
	cocherApostille: args => {
		const d = demandes.find(x => x.id === args[0]) as Record<string, string> | undefined;
		const champ = { checke: 'checkeLe', notaire: 'notaireLe', apostille: 'apostilleLe' }[String(args[1])];
		const date = args[2] ? '03/08/2026' : '';
		if (d && champ) d[champ] = date;
		return { ok: true, date: date };
	},
	repartirBons: () => ({ ok: true, bons: [{ idBon: 'BON-2026-0013', personne: 'Rachida', nb: 3 }, { idBon: 'BON-2026-0014', personne: 'Paul', nb: 2 }], restantes: 0 }),
	classerDemande: () => ({ ok: true }),
	changerStatut: () => ({ ok: true, idBon: 'BON-2026-0012', bonACloturer: true }),
	confirmerSansPhoto: () => ({ ok: true, idBon: 'BON-2026-0012', bonACloturer: true }),
	marquerNonCommunicable: () => ({ ok: true, idBon: 'BON-2026-0012', bonACloturer: true }),
	reporterDemande: () => ({ ok: true, idBon: 'BON-2026-0012', bonACloturer: false }),
	definirPreuve: () => ({ ok: true }),
	marquerMairie: args => {
		const d = demandes.find(x => x.id === args[0]) as { mairie?: string } | undefined;
		if (d) d.mairie = args[1] ? 'À commander' : '';
		return { ok: true, mairie: args[1] ? 'À commander' : '' };
	},
	envoyerMailMairie: args => {
		const ids = args[0] as string[];
		for (const d of demandes) {
			if (ids.includes(d.id)) { d.statut = 'Demandée'; (d as { mairie?: string }).mairie = 'Envoyée le 17/07/2026'; }
		}
		return { ok: true, nb: ids.length, mails: [{ mairie: 'Saint-Denis', email: 'etatcivil@mairie-mock.re', nb: ids.length }] };
	},
	envoyerBonsArchives: args => {
		const [dateA, demi] = args as [string, string];
		let nb = 0;
		for (const b of bons) {
			if (b.dateArchives === dateA && b.demiJournee === demi && !b.mailArchives) {
				(b as { mailArchives?: string }).mailArchives = 'Envoyé le 17/07/2026';
				(b as { photoBon?: string }).photoBon = 'https://drive.google.com/file/d/bon-pdf/view';
				nb++;
			}
		}
		if (!nb) throw new Error('Ces bons ont déjà été envoyés aux archives');
		return { ok: true, nb, actes: nb * 2, email: 'archives-mock@cg974.fr' };
	},
	ajouterPhoto: () => ({ ok: true, url: 'https://drive.google.com/file/d/mock/view', statut: 'Trouvée', idBon: 'BON-2026-0012', bonACloturer: true }),
	listerBons: () => bons,
	listerMesBons: () => {
		const p = profilCourant();
		return bons.filter(b => b.email === p.email || (p.role === 'Agent' && b.personne === p.nom));
	},
	getBon: args => {
		const b = bons.find(x => x.idBon === args[0]);
		if (!b) throw new Error('Bon introuvable : ' + args[0]);
		const ids = b.demandes.split(',').map(s => s.trim());
		return { ...b, lignes: demandes.filter(d => ids.includes(d.id)) };
	},
	creerBonCommande: () => ({ ok: true, idBon: 'BON-2026-0012' }),
	genererPdfBon: () => ({ ok: true, url: 'https://drive.google.com/file/d/bon-pdf/view' }),
	cloturerBon: () => ({ ok: true, url: 'https://drive.google.com/file/d/bon-pdf/view', traitees: 2 }),
	genererFormulaireEdepot: args => ({ ok: true, url: 'https://drive.google.com/file/d/formulaire-edepot/view', nb: (args[0] as string[]).length }),
	listerHabilitations: () => habilitations,
	ajouterHabilitation: () => ({ ok: true }),
	retirerHabilitation: () => ({ ok: true }),
};

/** Simule un appel backend avec une petite latence. */
export function mockAppel(fn: string, args: unknown[]): Promise<unknown> {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			try {
				const h = reponses[fn];
				if (!h) throw new Error('Mock manquant : ' + fn);
				resolve(JSON.parse(JSON.stringify(h(args))));
			} catch (e) { reject(e); }
		}, 250);
	});
}
