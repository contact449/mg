// Boîtes de dialogue de l'app (shadcn/Radix Dialog, thème iOS) — remplacent
// window.prompt / window.confirm avec la même ergonomie Promise :
//   await confirmer({ titre, message, ok: 'Supprimer', danger: true })  -> boolean
//   await demander({ titre, message, placeholder })                     -> string | null
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Btn, CLASSE_INPUT } from '@/components/ui/kit';

interface OptionsBoite {
	titre: string;
	message?: ReactNode;
	ok?: string; // libellé du bouton principal (défaut « OK »)
	danger?: boolean; // action destructrice : bouton rouge
	placeholder?: string; // demander() uniquement
	valeur?: string; // pré-remplissage de la saisie
}
type Requete = OptionsBoite & { saisie: boolean; resoudre: (v: string | null) => void };

let _poser: ((r: Requete) => void) | null = null;

export function confirmer(o: OptionsBoite): Promise<boolean> {
	return new Promise(res => {
		if (!_poser) { res(window.confirm(o.titre)); return; } // filet si l'hôte n'est pas monté
		_poser({ ...o, saisie: false, resoudre: v => res(v !== null) });
	});
}

export function demander(o: OptionsBoite): Promise<string | null> {
	return new Promise(res => {
		if (!_poser) { res(window.prompt(o.titre)); return; }
		_poser({ ...o, saisie: true, resoudre: res });
	});
}

/** Hôte unique, monté une fois dans App (comme le Toaster). */
export function Boites() {
	const [req, setReq] = useState<Requete | null>(null);
	const [texte, setTexte] = useState('');

	useEffect(() => {
		_poser = r => { setTexte(r.valeur || ''); setReq(r); };
		return () => { _poser = null; };
	}, []);

	const fermer = (v: string | null) => {
		req?.resoudre(v);
		setReq(null);
	};

	return (
		<Dialog.Root open={!!req} onOpenChange={o => { if (!o) fermer(null); }}>
			<Dialog.Portal>
				<Dialog.Overlay className="animation-voile fixed inset-0 z-50 bg-black/40" />
				<Dialog.Content
					aria-describedby={req?.message ? 'boite-message' : undefined}
					onOpenAutoFocus={e => { if (!req?.saisie) e.preventDefault(); }}
					className="animation-boite fixed left-1/2 top-1/2 z-50 w-[calc(100vw-3rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-neutral-50 p-5 shadow-xl focus:outline-none"
				>
					<Dialog.Title className="text-center text-[17px] font-semibold text-neutral-900">
						{req?.titre}
					</Dialog.Title>
					{req?.message && (
						<Dialog.Description asChild>
							<div id="boite-message" className="mt-1.5 text-center text-sm leading-relaxed text-neutral-600">{req.message}</div>
						</Dialog.Description>
					)}
					{req?.saisie && (
						<form onSubmit={e => { e.preventDefault(); fermer(texte); }}>
							<input
								className={CLASSE_INPUT + ' mt-4'}
								autoFocus
								placeholder={req.placeholder}
								value={texte}
								onChange={e => setTexte(e.target.value)}
							/>
						</form>
					)}
					<div className="mt-4 grid grid-cols-2 gap-2">
						<Btn variante="blanc" onClick={() => fermer(null)}>Annuler</Btn>
						<Btn variante={req?.danger ? 'rouge' : 'primaire'} onClick={() => fermer(req?.saisie ? texte : '')}>
							{req?.ok || 'OK'}
						</Btn>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
