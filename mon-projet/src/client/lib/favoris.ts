// Tuiles favorites du Suivi (localStorage) — affichées en sous-menu du
// rail latéral PC pour ouvrir le Suivi directement sur le bon filtre.
const CLE = 'archives-favoris-suivi';
const DEFAUT = ['À rechercher', "Trouvée aujourd'hui"];

export function getFavoris(): string[] {
	try {
		const l = JSON.parse(localStorage.getItem(CLE) || '');
		return Array.isArray(l) ? l : DEFAUT;
	} catch {
		return DEFAUT;
	}
}

export function basculerFavori(filtre: string): string[] {
	const l = getFavoris();
	const nv = l.includes(filtre) ? l.filter(x => x !== filtre) : [...l, filtre];
	localStorage.setItem(CLE, JSON.stringify(nv));
	return nv;
}
