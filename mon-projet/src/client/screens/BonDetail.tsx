import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import type { Bon } from '@/lib/gas';
import CarteDemande from '@/components/CarteDemande';
import { Carte, Encart, Squelette, SqueletteCarte, SqueletteLignes, TitreCarte, toast } from '@/components/ui/kit';

export default function BonDetail({ idBon, onOuvrirDemande }: {
	idBon: string;
	onOuvrirDemande: (id: string) => void;
}) {
	const [bon, setBon] = useState<Bon | null>(null);

	const charger = useCallback(async () => {
		try { setBon(await appel<Bon>('getBon', idBon, getIdentite())); }
		catch (e) { toast('Erreur : ' + (e as Error).message); }
	}, [idBon]);

	useEffect(() => { charger(); }, [charger]);

	if (!bon) return (
		<div className="space-y-4">
			<Carte>
				<Squelette className="mb-4 h-6 w-32" />
				<SqueletteLignes n={3} />
			</Carte>
			<SqueletteCarte />
			<SqueletteCarte />
		</div>
	);
	const lignes = bon.lignes ?? [];
	const restantes = lignes.filter(d => d.statut === 'À rechercher').length;

	return (
		<div className="space-y-4">
			<Carte>
				<div className="flex items-center justify-between gap-2">
					<h1 className="font-display text-lg font-bold text-neutral-900">{bon.idBon}</h1>
					<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
						{bon.demiJournee}
					</span>
				</div>
				<p className="mt-2 text-sm text-neutral-700">
					<b>Date :</b> {bon.dateArchives}<br />
					<b>Personne :</b> {bon.personne}{bon.email ? ` (${bon.email})` : ''}
				</p>

				<div className="mt-3 overflow-x-auto">
					<table className="w-full border-collapse text-xs">
						<thead>
							<tr className="bg-neutral-100 text-left">
								<th className="border border-neutral-200 px-2 py-1.5">Cote</th>
								<th className="border border-neutral-200 px-2 py-1.5">Commune</th>
								<th className="border border-neutral-200 px-2 py-1.5">Type</th>
								<th className="border border-neutral-200 px-2 py-1.5">Année</th>
								<th className="border border-neutral-200 px-2 py-1.5">Nom</th>
							</tr>
						</thead>
						<tbody>
							{lignes.map(d => (
								<tr key={d.id}>
									<td className="border border-neutral-200 px-2 py-1.5 font-mono font-semibold">{d.cote4E || d.coteEDEPOT || '?'}</td>
									<td className="border border-neutral-200 px-2 py-1.5">{d.commune}</td>
									<td className="border border-neutral-200 px-2 py-1.5">{d.typeActe}</td>
									<td className="border border-neutral-200 px-2 py-1.5">{d.anneeActe}</td>
									<td className="border border-neutral-200 px-2 py-1.5">{d.nom} {d.prenom}{d.destination === 'Généalogie' ? ' · généalogie' : ''}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{bon.photoBon ? (
					<Encart couleur="vert" className="mt-3">
						<a href={bon.photoBon} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
							<ExternalLink className="h-3.5 w-3.5" /> Bon de commande (PDF)
						</a>
					</Encart>
				) : restantes === 0 ? (
					<Encart couleur="neutre" className="mt-3">
						Toutes les cotes sont traitées. Le PDF sera généré et envoyé automatiquement
						en fin de tournée depuis l'onglet <b>Bons</b> (« Envoyer aux archives »).
					</Encart>
				) : (
					<Encart couleur="orange" className="mt-3">
						{restantes} cote{restantes > 1 ? 's' : ''} encore « À rechercher » avant l'envoi aux archives.
					</Encart>
				)}
			</Carte>

			<div>
				<TitreCarte>Actes du bon ({restantes} restant{restantes > 1 ? 's' : ''} à traiter)</TitreCarte>
				<div className="grid gap-3 md:grid-cols-2">
					{lignes.map(d => <CarteDemande key={d.id} demande={d} onOuvrir={onOuvrirDemande} />)}
				</div>
			</div>
		</div>
	);
}
