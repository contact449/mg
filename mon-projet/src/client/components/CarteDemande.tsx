import { useRef } from 'react';
import { Camera, Clock, FileImage, RotateCcw, TriangleAlert, UserRound } from 'lucide-react';
import type { Demande } from '@/lib/gas';
import { BadgeAffilie, BadgeDeblocage, BadgeGenea, BadgeStatut, Cote } from '@/components/ui/kit';
import { prechargerDemande } from '@/lib/precharge';

/** Carte compacte d'une demande (listes du Suivi, des bons…). */
export default function CarteDemande({ demande: d, onOuvrir }: {
	demande: Demande;
	onOuvrir: (id: string) => void;
}) {
	const nbPhotos = (d.photos || '').split('\n').filter(Boolean).length;
	// survol franc (150 ms) : getDemande part en avance, le clic le réutilise
	const survol = useRef(0);
	return (
		<button
			type="button"
			onMouseEnter={() => { survol.current = window.setTimeout(() => prechargerDemande(d.id), 150); }}
			onMouseLeave={() => window.clearTimeout(survol.current)}
			onClick={() => { window.clearTimeout(survol.current); onOuvrir(d.id); }}
			className="flex w-full flex-col items-stretch rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-left transition-[box-shadow,border-color,scale] duration-150 ease-out hover:border-neutral-300 hover:shadow-carte-hover active:scale-[0.99]"
		>
			<div className="flex items-start justify-between gap-2">
				<span className="font-semibold leading-snug text-neutral-900">
					{d.nom} {d.prenom}
				</span>
				<span className="flex shrink-0 items-center gap-1.5">
					{/* preuve ANOM (capture) et photos d'acte : deux icônes distinctes */}
					{d.preuve && <FileImage className="h-3.5 w-3.5 text-cyan-700" />}
					{nbPhotos > 0 && (
						<span className="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-emerald-700">
							<Camera className="h-3.5 w-3.5" />{nbPhotos > 1 ? `×${nbPhotos}` : ''}
						</span>
					)}
					{d.deblocage && <BadgeDeblocage />}
					{d.destination === 'Généalogie' && (d.affilieLe ? <BadgeAffilie /> : <BadgeGenea />)}
					<BadgeStatut statut={d.statut} />
				</span>
			</div>
			<div className="mt-1 font-mono text-[11px] text-neutral-500">
				{d.id} <span className="font-sans text-xs">· {d.typeActe}
				{d.commune ? ` · ${d.commune}` : ''}
				{(d.dateActe || d.anneeActe) ? ` · ${d.dateActe || d.anneeActe}` : ''}
				{d.bon ? ` · ${d.bon}` : ''}</span>
			</div>
			{d.demandeur && (
				<div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
					<UserRound className="h-3 w-3" /> {d.demandeur}
				</div>
			)}
			{/* la date utile : création tant qu'on cherche, sinon la date de
			    l'évènement du statut (Traitée = clôture/envoi du bon…) */}
			<div className="mt-1 flex items-center gap-1 text-xs font-bold text-tampon">
				<Clock className="h-3 w-3" />
				{d.statut === 'À rechercher'
					? `Créée le ${d.dateCreation.split(' ')[0]}`
					: `${d.statut} le ${(d.derniereMAJ || d.dateCreation).split(' ')[0]}`}
			</div>
			{d.remiseLe && d.statut === 'À rechercher' && (
				<div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700">
					<RotateCcw className="h-3 w-3" /> Remise à rechercher le {d.remiseLe}
				</div>
			)}
			{(d.cote4E || d.coteEDEPOT) ? (
				<div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2 text-xs text-neutral-600">
					{d.cote4E && <Cote type="4E" valeur={d.cote4E} />}
					{d.coteEDEPOT && <Cote type="EDEPOT" valeur={d.coteEDEPOT} />}
					{d.classement === 'Les deux' && <i>→ commander la copie 4E</i>}
				</div>
			) : (
				<div className="mt-auto flex items-center gap-1 pt-2 text-xs font-medium text-red-700"><TriangleAlert className="h-3.5 w-3.5 shrink-0" /> Aucune cote — commune/année à compléter</div>
			)}
		</button>
	);
}
