import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import type { Demande } from '@/lib/gas';
import { Carte, CLASSE_INPUT, SqueletteLignes, TitreCarte, toast } from '@/components/ui/kit';
import { Segmente } from '@/components/ui/segmente';
import { cn } from '@/lib/utils';

// dernier chargement gardé en mémoire (retour d'onglet instantané)
let cacheApostille: Demande[] | null = null;

type Etape = { cle: 'checke' | 'notaire' | 'apostille'; libelle: string; champ: 'checkeLe' | 'notaireLe' | 'apostilleLe' };
const ETAPES: Etape[] = [
	{ cle: 'checke', libelle: 'Checké', champ: 'checkeLe' },
	{ cle: 'notaire', libelle: 'Notaire', champ: 'notaireLe' },
	{ cle: 'apostille', libelle: 'Apostillé', champ: 'apostilleLe' },
];

/** Circuit apostille — tous les actes Trouvée/Traitée, cochage en masse.
 *  Checké → Notaire → Apostillé (règles d'ordre aussi vérifiées côté serveur) ;
 *  un « non apostillé » s'arrête à Checké. */
export default function Apostille() {
	const [liste, setListe] = useState<Demande[] | null>(cacheApostille);
	const [recherche, setRecherche] = useState('');
	const [vue, setVue] = useState<'À traiter' | 'Apostillés'>('À traiter');

	const charger = useCallback(async () => {
		try {
			const r = await appel<Demande[]>('listerDemandes', 'Tous', getIdentite());
			cacheApostille = r.filter(d => d.statut === 'Trouvée' || d.statut === 'Traitée');
			setListe(cacheApostille);
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
			setListe(l => l ?? []);
		}
	}, []);
	useEffect(() => { charger(); }, [charger]);

	const basculer = async (d: Demande, etape: Etape) => {
		const actif = !d[etape.champ];
		try {
			const r = await appel<{ date: string }>('cocherApostille', d.id, etape.cle, actif, getIdentite());
			// maj optimiste avec la date renvoyée — décocher efface la suite (même règle que le serveur)
			setListe(l => (l ?? []).map(x => x.id !== d.id ? x : {
				...x,
				[etape.champ]: r.date,
				...(etape.cle === 'checke' && !actif ? { notaireLe: '', apostilleLe: '' } : {}),
				...(etape.cle === 'notaire' && !actif ? { apostilleLe: '' } : {}),
			}));
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		}
	};

	const q = recherche.trim().toLowerCase();
	const visibles = (liste ?? [])
		.filter(d => (vue === 'Apostillés' ? !!d.apostilleLe : !d.apostilleLe))
		.filter(d => !q || `${d.nom} ${d.prenom} ${d.id} ${d.commune} ${d.demandeur}`.toLowerCase().includes(q));

	return (
		<div className="mx-auto w-full max-w-3xl space-y-4">
			<Segmente
				options={['À traiter', 'Apostillés'] as const}
				valeur={vue}
				onChange={setVue}
			/>

			<div className="relative">
				<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
				<input
					className={cn(CLASSE_INPUT, 'pl-10')}
					placeholder="Rechercher un nom, un ID, une commune…"
					value={recherche}
					onChange={e => setRecherche(e.target.value)}
				/>
			</div>

			<Carte>
				<TitreCarte>Actes trouvés / traités ({visibles.length})</TitreCarte>
				{liste === null ? (
					<SqueletteLignes n={5} />
				) : visibles.length === 0 ? (
					<p className="text-sm text-neutral-500">
						{vue === 'Apostillés' ? 'Aucun acte apostillé pour le moment.' : 'Aucun acte à traiter.'}
					</p>
				) : (
					<div className="divide-y divide-neutral-200">
						{visibles.map(d => (
							<div key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5">
								<div className="min-w-0">
									<div className="truncate text-sm font-semibold text-neutral-900">
										{d.nom} {d.prenom}
										{d.destination === 'Généalogie' && <span className="font-normal text-green-700"> · généa</span>}
									</div>
									<div className="text-xs text-neutral-500">
										{d.typeActe}{d.commune ? ` · ${d.commune}` : ''}{d.anneeActe ? ` · ${d.anneeActe}` : ''} · {d.statut}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-4">
									{ETAPES.map(e => {
										const bloque = e.cle === 'notaire' ? !d.checkeLe : e.cle === 'apostille' ? !d.notaireLe : false;
										return (
											<label
												key={e.cle}
												title={bloque ? (e.cle === 'notaire' ? 'Cocher « Checké » d\'abord' : 'Passer chez le notaire d\'abord') : undefined}
												className={cn('flex items-center gap-1.5', bloque && !d[e.champ] ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}
											>
												<input
													type="checkbox"
													className="h-4 w-4 accent-tampon"
													checked={!!d[e.champ]}
													disabled={bloque && !d[e.champ]}
													onChange={() => basculer(d, e)}
												/>
												<span className="text-xs font-medium text-neutral-700">
													{e.libelle}
													{d[e.champ] && <span className="text-neutral-400"> {d[e.champ]}</span>}
												</span>
											</label>
										);
									})}
								</div>
							</div>
						))}
					</div>
				)}
			</Carte>
		</div>
	);
}
