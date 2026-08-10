// Préchargement spéculatif des fiches : les listes sèment leurs demandes ici
// (le Détail peint instantanément, l'historique arrive ensuite) et le survol
// d'une carte lance le getDemande en avance — le clic réutilise la promesse
// au lieu de repartir de zéro (~1 s gagnée par ouverture).
import { appel, getIdentite } from './gas';
import type { Demande } from './gas';

const fiches = new Map<string, Demande>();

export function semerFiches(liste: Demande[]) {
	for (const d of liste) fiches.set(d.id, d);
}

export function ficheConnue(id: string): Demande | undefined {
	return fiches.get(id);
}

// getDemande en vol (survol) — expire vite : au-delà, un appel frais vaut mieux
const enVol = new Map<string, Promise<Demande>>();

export function prechargerDemande(id: string) {
	if (enVol.has(id)) return;
	const p = appel<Demande>('getDemande', id, getIdentite());
	p.catch(() => enVol.delete(id));
	enVol.set(id, p);
	setTimeout(() => enVol.delete(id), 20000);
}

/** Récupère (et consomme) la promesse lancée au survol, s'il y en a une. */
export function prendreDemandeEnVol(id: string): Promise<Demande> | undefined {
	const p = enVol.get(id);
	enVol.delete(id);
	return p;
}
