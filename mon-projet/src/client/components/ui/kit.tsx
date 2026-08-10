// Kit UI de l'app — peau « Linear » : surfaces définies par une bordure fine
// (pas d'ombre lourde), boutons compacts, badges translucides lisibles en
// thème clair comme sombre, un seul accent (indigo).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, ChangeEvent } from 'react';
import { Camera, Check, CheckCheck, Loader2, Lock, Pause, Search, Send, Trees, TriangleAlert, Unlock, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compresserPhoto, fichierVersBase64 } from '@/lib/photo';
import type { Statut } from '@/lib/gas';

/* ------------------------------- Carte ------------------------------- */

export function Carte({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn('rounded-lg border border-neutral-200 bg-neutral-50 p-4', className)}>{children}</div>;
}

export function TitreCarte({ children }: { children: ReactNode }) {
	return <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{children}</h2>;
}

/* ------------------------------ Boutons ------------------------------ */

// primaire = accent ; vert/rouge/bleu = sémantiques ; « blanc » = secondaire
// bordé (surface + bordure) ; gris = discret.
const VARIANTES_BTN = {
	primaire: 'bg-tampon text-white shadow-sm hover:brightness-110 active:brightness-95',
	vert: 'bg-emerald-600 text-white shadow-sm hover:brightness-110 active:brightness-95',
	rouge: 'bg-red-600 text-white shadow-sm hover:brightness-110 active:brightness-95',
	bleu: 'bg-blue-600 text-white shadow-sm hover:brightness-110 active:brightness-95',
	blanc: 'border border-neutral-300 bg-neutral-50 text-neutral-800 hover:bg-neutral-200',
	gris: 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300',
} as const;

export function Btn({ variante = 'primaire', className, disabled, onClick, children }: {
	variante?: keyof typeof VARIANTES_BTN;
	className?: string;
	disabled?: boolean;
	onClick?: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'flex w-full items-center justify-center gap-2 rounded-md px-3.5 py-2.5 text-sm font-medium',
				'transition-[filter,background-color,scale] duration-100 ease-out active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50',
				VARIANTES_BTN[variante], className,
			)}
		>
			{children}
		</button>
	);
}

/* ------------------------------- Badges ------------------------------ */

// fond translucide (marche sur clair et sombre) + texte teinté, éclairci en sombre.
const COULEURS_STATUT: Record<Statut, string> = {
	'À rechercher': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
	'Demandée': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
	'Trouvée': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
	'En erreur': 'bg-red-500/15 text-red-700 dark:text-red-300',
	'Non trouvé': 'bg-neutral-200 text-neutral-600',
	'Non communicable': 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
	'Stand by': 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
	'Traitée': 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
};

const ICONES_STATUT: Record<Statut, LucideIcon> = {
	'À rechercher': Search,
	'Demandée': Send,
	'Trouvée': Check,
	'En erreur': TriangleAlert,
	'Non trouvé': X,
	'Non communicable': Lock,
	'Stand by': Pause,
	'Traitée': CheckCheck,
};

export function BadgeStatut({ statut }: { statut: Statut }) {
	const Icone = ICONES_STATUT[statut];
	return (
		<span className={cn(
			'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
			COULEURS_STATUT[statut] ?? 'bg-neutral-200 text-neutral-700',
		)}>
			{Icone && <Icone className="h-3 w-3" />}
			{statut}
		</span>
	);
}

export function BadgeGenea() {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-300 whitespace-nowrap">
			<Trees className="h-3 w-3" /> Généa
		</span>
	);
}

/** Acte prioritaire : un dossier client attend dessus (rose, repérable de loin). */
export function BadgeDeblocage() {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">
			<Unlock className="h-3 w-3" /> Déblocage
		</span>
	);
}

/** Acte généalogie déjà exploité dans le dossier client. */
export function BadgeAffilie() {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap">
			<Check className="h-3 w-3" /> Affilié
		</span>
	);
}

/** Étiquette de cote — mono, comme au dos d'une boîte d'archives.
 *  Le code couleur 4E (vert) / EDEPOT (orange) est celui appris par l'équipe. */
export function Cote({ type, valeur }: { type: '4E' | 'EDEPOT'; valeur: string }) {
	return (
		<span className={cn(
			'inline-flex items-baseline gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold whitespace-nowrap',
			type === '4E'
				? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
				: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
		)}>
			<span className="text-[9px] font-bold uppercase opacity-60">{type}</span>
			{valeur}
		</span>
	);
}

/* ---------------------------- Encarts info --------------------------- */

const COULEURS_ENCART = {
	neutre: 'bg-neutral-200/60 text-neutral-700',
	vert: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
	rouge: 'bg-red-500/10 text-red-800 dark:text-red-300',
	orange: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
} as const;

export function Encart({ couleur = 'neutre', className, children }: {
	couleur?: keyof typeof COULEURS_ENCART;
	className?: string;
	children: ReactNode;
}) {
	return <div className={cn('rounded-md px-3.5 py-2.5 text-sm leading-relaxed', COULEURS_ENCART[couleur], className)}>{children}</div>;
}

/* ---------------------------- Formulaires ---------------------------- */

export function Champ({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="block">
			<span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
			{children}
		</label>
	);
}

// input Linear : surface bordée, focus = bordure accent + fin halo
export const CLASSE_INPUT =
	'w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 ' +
	'placeholder:text-neutral-400 transition-colors focus:border-tampon focus:outline-none focus:ring-1 focus:ring-tampon/40';

/* ------------------------------- Toasts ------------------------------ */

type ToastMsg = { id: number; texte: string; sortant?: boolean };
let _emetToast: ((texte: string) => void) | null = null;

export function toast(texte: string) {
	_emetToast?.(texte);
}

export function Toaster() {
	const [msgs, setMsgs] = useState<ToastMsg[]>([]);
	useEffect(() => {
		let seq = 0;
		_emetToast = texte => {
			const id = ++seq;
			setMsgs(m => [...m, { id, texte }]);
			setTimeout(() => setMsgs(m => m.map(x => (x.id === id ? { ...x, sortant: true } : x))), 2900);
			setTimeout(() => setMsgs(m => m.filter(x => x.id !== id)), 3200);
		};
		return () => { _emetToast = null; };
	}, []);
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
			{msgs.map(m => (
				<div
					key={m.id}
					className={cn(
						// surface inversée : sombre en clair, clair en sombre
						'animation-toast max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-50 shadow-lg',
						'transition-[opacity,translate] duration-300 ease-in',
						m.sortant && 'translate-y-2 opacity-0',
					)}
				>
					{m.texte}
				</div>
			))}
		</div>
	);
}

/* ----------------------------- Chargement ---------------------------- */

export function Chargement({ plein = false }: { plein?: boolean }) {
	return (
		<div className={cn('flex items-center justify-center', plein ? 'py-16' : 'py-6')}>
			<Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
		</div>
	);
}

/** Bloc gris pulsant — brique des états squelette. */
export function Squelette({ className }: { className?: string }) {
	return <div className={cn('animate-pulse rounded bg-neutral-200', className)} />;
}

/** Silhouette d'une CarteDemande pendant le chargement des listes. */
export function SqueletteCarte() {
	return (
		<div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
			<div className="flex items-start justify-between gap-2">
				<Squelette className="h-4 w-36" />
				<Squelette className="h-5 w-24 rounded" />
			</div>
			<Squelette className="mt-2.5 h-3 w-3/4" />
			<Squelette className="mt-2 h-3 w-28" />
			<Squelette className="mt-3 h-5 w-32" />
		</div>
	);
}

/** Lignes grises pulsantes — contenu d'une carte en chargement. */
export function SqueletteLignes({ n = 3 }: { n?: number }) {
	return (
		<div className="space-y-2.5 py-1">
			{Array.from({ length: n }, (_, i) => (
				<Squelette key={i} className={cn('h-3.5', ['w-full', 'w-5/6', 'w-2/3'][i % 3])} />
			))}
		</div>
	);
}

export function Vide({ children }: { children: ReactNode }) {
	return <Carte className="text-center text-sm text-neutral-500">{children}</Carte>;
}

/* ---------------------------- Bouton photo --------------------------- */

/** Ouvre l'appareil photo / la galerie, compresse et renvoie le base64.
 *  pdf : accepte aussi les PDF (transmis tels quels, avec leur type MIME). */
export function BoutonPhoto({ libelle, variante = 'vert', pdf = false, onPhoto }: {
	libelle: string;
	variante?: keyof typeof VARIANTES_BTN;
	pdf?: boolean;
	onPhoto: (base64: string, mime?: string) => Promise<void>;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const [enCours, setEnCours] = useState(false);

	const changement = async (ev: ChangeEvent<HTMLInputElement>) => {
		const fichier = ev.target.files?.[0];
		ev.target.value = '';
		if (!fichier) return;
		setEnCours(true);
		try {
			const estPdf = fichier.type === 'application/pdf';
			const b64 = estPdf ? await fichierVersBase64(fichier) : await compresserPhoto(fichier);
			await onPhoto(b64, estPdf ? 'application/pdf' : 'image/jpeg');
		} catch (e) {
			toast('Erreur : ' + ((e as Error).message || 'Photo impossible'));
		} finally {
			setEnCours(false);
		}
	};

	return (
		<>
			<input ref={ref} type="file" accept={pdf ? 'image/*,application/pdf' : 'image/*'} capture={pdf ? undefined : 'environment'} className="hidden" onChange={changement} />
			<Btn variante={variante} disabled={enCours} onClick={() => ref.current?.click()}>
				{enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
				{enCours ? 'Envoi en cours…' : libelle}
			</Btn>
		</>
	);
}
