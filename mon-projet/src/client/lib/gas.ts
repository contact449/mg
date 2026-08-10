// Pont vers le backend Apps Script (google.script.run) avec API Promise.
// En dev local (npm run dev), google.script n'existe pas : on bascule sur
// les mocks de ./mock pour travailler l'UI sans déployer.
import { mockAppel } from './mock';

export const TYPES_ACTES = ['Naissance', 'Mariage', 'Décès', 'Reconnaissance', 'Publication de mariage', 'Table décennale', 'Jugement'];

export type Role = 'Admin' | 'Agent' | 'Lecture';
export type Statut = 'À rechercher' | 'Demandée' | 'Trouvée' | 'En erreur' | 'Non trouvé' | 'Non communicable' | 'Stand by' | 'Traitée';
export type Destination = 'Archives' | 'Généalogie';

export interface Profil {
	email: string;
	nom: string;
	role: Role;
	connecte: boolean;
	declare: boolean;
	peutModifier: boolean;
	estAdmin: boolean;
}

/** Identité déclarée (agents sur compte Google hors domaine). */
export interface Identite {
	email: string;
	code: string;
	nom?: string;
}

export interface Personne {
	email: string;
	nom: string;
	role: string;
	aCode: boolean;
}

const CLE_IDENTITE = 'archives-identite';

export function getIdentite(): Identite | null {
	try { return JSON.parse(localStorage.getItem(CLE_IDENTITE) || 'null'); }
	catch { return null; }
}

export function setIdentite(ident: Identite | null) {
	if (ident) localStorage.setItem(CLE_IDENTITE, JSON.stringify(ident));
	else localStorage.removeItem(CLE_IDENTITE);
}

export interface Evenement {
	date: string;
	statut: string;
	detail: string;
	agent: string;
}

export interface Demande {
	id: string;
	dateCreation: string;
	typeActe: string;
	nom: string;
	prenom: string;
	commune: string;
	anneeActe: string;
	dateActe: string;
	demandeur: string;
	statut: Statut;
	classement: string;
	cote4E: string;
	coteEDEPOT: string;
	photos: string;
	notes: string;
	derniereMAJ: string;
	destination: Destination;
	avant1908: string;
	preuve: string;
	bon: string;
	numeroActe: string;
	remiseLe: string; // date de remise « À rechercher » (vidée au dispatch suivant)
	mairie: string; // '' | 'À commander' | 'Envoyée le jj/mm/aaaa'
	matricule: string; // facultatif, relevé sur l'acte (ou trouvé via IDLR)
	affilieLe: string; // généalogie : date d'exploitation dans le dossier client
	deblocage: string; // 'Oui' = prioritaire (débloque un dossier client)
	checkeLe: string; // circuit apostille : Checké → Notaire → Apostillé
	notaireLe: string;
	apostilleLe: string;
	historique?: Evenement[];
}

export interface Bon {
	idBon: string;
	dateArchives: string;
	demiJournee: string;
	personne: string;
	demandes: string;
	cotes: string;
	creeLe: string;
	photoBon: string; // lien du bon : PDF généré (anciens bons : photo papier)
	email: string;
	mailArchives: string; // '' | 'Envoyé le jj/mm/aaaa' (mail groupé aux archives)
	lignes?: Demande[];
}

export interface Stats {
	total: number;
	[cle: string]: number;
}

export interface Habilitation {
	email: string;
	nom: string;
	role: string;
	ajouteLe: string;
	ajoutePar: string;
	aCode: boolean;
}

export interface CoteResultat {
	commune: string;
	types: string;
	table: boolean;
	intitule: string;
	anneeDebut: string;
	anneeFin: string;
	cote4E: string;
	coteEDEPOT: string;
}

export interface RetourAction {
	ok: boolean;
	idBon?: string;
	bonACloturer?: boolean;
	suiviErreur?: string;
}

export interface RetourPhoto extends RetourAction {
	url: string;
	statut: Statut;
}

/** PDF généré depuis un modèle Google Docs (bon de commande, formulaire EDEPOT). */
export interface RetourFormulaire {
	ok: boolean;
	url: string;
	nb?: number;
}

export interface RetourCreation {
	ok: boolean;
	id: string;
	classement: string;
	cote4E: string;
	coteEDEPOT: string;
	avant1908: string;
	/** renvoyé avec ok=false : une demande similaire existe déjà (rien n'est créé) */
	doublon?: { id: string; nom: string; prenom: string; statut: string; commune: string; anneeActe: string };
}

interface GoogleScriptRun {
	withSuccessHandler(cb: (r: unknown) => void): GoogleScriptRun;
	withFailureHandler(cb: (e: Error) => void): GoogleScriptRun;
	[fn: string]: unknown;
}

declare global {
	interface Window {
		google?: { script: { run: GoogleScriptRun } };
	}
}

/** Appelle une fonction du backend GAS et renvoie une Promise. */
export function appel<T>(fn: string, ...args: unknown[]): Promise<T> {
	const gs = window.google?.script?.run;
	if (!gs) return mockAppel(fn, args) as Promise<T>;
	return new Promise<T>((resolve, reject) => {
		const runner = gs
			.withSuccessHandler(r => resolve(r as T))
			.withFailureHandler(e => reject(e));
		(runner[fn] as (...a: unknown[]) => void)(...args);
	});
}
