import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Saisie de date : ne garde que les chiffres et insère les slashs
 *  automatiquement (collages 12.03.1870, 12-03-1870… acceptés).
 *  Jusqu'à 4 chiffres, rien n'est inséré : « 1870 » reste une année seule. */
export function formaterDateSaisie(v: string): string {
	const c = v.replace(/\D/g, "").slice(0, 8);
	if (c.length <= 4) return c;
	return `${c.slice(0, 2)}/${c.slice(2, 4)}/${c.slice(4)}`;
}

/** Année seule (1500-2099) ? — la saisie de date accepte les deux. */
export function estAnneeSeule(v: string): boolean {
	return /^(1[5-9]\d{2}|20\d{2})$/.test(v.trim());
}
