import { useCallback, useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { closestCenter, DndContext, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { appel, getIdentite } from '@/lib/gas';
import type { Demande, Stats } from '@/lib/gas';
import CarteDemande from '@/components/CarteDemande';
import { Carte, CLASSE_INPUT, SqueletteCarte, toast, Vide } from '@/components/ui/kit';
import { cn } from '@/lib/utils';
import { basculerFavori, getFavoris } from '@/lib/favoris';
import { semerFiches } from '@/lib/precharge';

const FILTRES = ['Tous', 'À rechercher', 'Commande EDEPOT', 'Demandée', 'Trouvée', "Trouvée aujourd'hui", 'En erreur', 'Non trouvé', 'Non communicable', 'Stand by', 'Traitée', 'Généalogie', 'Affiliés'];

// tuiles de stats — cliquables : chacune applique son filtre à la liste
// ordre d'affichage : « Tous » d'abord, puis du plus au moins pertinent
const TUILES: Array<{ cle: string; libelle: string; classe: string; filtre: string }> = [
	{ cle: 'total', libelle: 'Tous', classe: 'text-neutral-900', filtre: 'Tous' },
	{ cle: 'À rechercher', libelle: 'À rechercher', classe: 'text-amber-600', filtre: 'À rechercher' },
	{ cle: 'Commande EDEPOT', libelle: 'Commandes', classe: 'text-orange-600', filtre: 'Commande EDEPOT' },
	{ cle: "Trouvée aujourd'hui", libelle: 'Trouvées auj.', classe: 'text-emerald-700', filtre: "Trouvée aujourd'hui" },
	{ cle: 'Trouvée', libelle: 'Trouvées', classe: 'text-emerald-600', filtre: 'Trouvée' },
	{ cle: 'Stand by', libelle: 'Stand by', classe: 'text-orange-600', filtre: 'Stand by' },
	{ cle: 'En erreur', libelle: 'En erreur', classe: 'text-red-600', filtre: 'En erreur' },
	{ cle: 'Non trouvé', libelle: 'Non trouvés', classe: 'text-neutral-500', filtre: 'Non trouvé' },
	{ cle: 'Non communicable', libelle: 'Non comm.', classe: 'text-cyan-700', filtre: 'Non communicable' },
	{ cle: 'Généalogie', libelle: 'Généalogie', classe: 'text-green-600', filtre: 'Généalogie' },
];

// ordre personnalisé des tuiles (glisser-déposer) — retenu sur l'appareil
const CLE_ORDRE = 'archives-ordre-tuiles';

function getOrdreTuiles(): typeof TUILES {
	try {
		const o: string[] = JSON.parse(localStorage.getItem(CLE_ORDRE) || '');
		if (!Array.isArray(o)) return TUILES;
		// tuiles inconnues de l'ordre sauvé (ajouts futurs) : à la fin, ordre par défaut
		const rang = (t: (typeof TUILES)[number]) => {
			const i = o.indexOf(t.cle);
			return i === -1 ? o.length + TUILES.indexOf(t) : i;
		};
		return [...TUILES].sort((a, b) => rang(a) - rang(b));
	} catch {
		return TUILES;
	}
}

/** Tuile de stats déplaçable — glisser à la souris (PC), appui long (mobile). */
function TuileStat({ t, pleineLargeur, valeur, favori, onFiltre, onFavori }: {
	t: (typeof TUILES)[number];
	pleineLargeur: boolean;
	valeur: string | number;
	favori: boolean;
	onFiltre: () => void;
	onFavori: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.cle });
	return (
		<button
			ref={setNodeRef}
			type="button"
			onClick={onFiltre}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			{...attributes}
			{...listeners}
			className={cn(
				'group relative touch-manipulation select-none rounded-xl py-1 text-center transition-colors hover:bg-neutral-100 active:scale-[0.97] md:py-1.5',
				pleineLargeur && 'col-span-3 md:col-span-1',
				isDragging && 'z-10 bg-neutral-100 shadow-carte-hover',
			)}
		>
			{/* étoile (PC) : épingle la tuile dans le sous-menu Suivi de la sidebar */}
			<span
				role="button"
				title="Épingler dans le menu Suivi"
				onClick={e => { e.stopPropagation(); onFavori(); }}
				className={cn(
					'absolute right-0 top-0 hidden cursor-pointer p-1.5 text-neutral-300 hover:text-amber-500',
					favori ? 'md:inline-block' : 'md:group-hover:inline-block',
				)}
			>
				<Star className={cn('h-3.5 w-3.5', favori && 'fill-amber-400 text-amber-400')} />
			</span>
			<div className={cn('text-xl font-bold tracking-tight tabular-nums md:text-2xl', t.classe)}>{valeur}</div>
			<div className="text-[10px] font-medium text-neutral-500 md:text-[11px]">{t.libelle}</div>
		</button>
	);
}

// dernier chargement gardé en mémoire : revenir sur l'onglet affiche
// instantanément les données connues, le serveur rafraîchit en arrière-plan
let cacheSuivi: { liste: Demande[]; stats: Stats } | null = null;

// semé par le bootstrap au démarrage → premier rendu du Suivi sans aller-retour
export function semerSuivi(r: { liste: Demande[]; stats: Stats }) {
	cacheSuivi = r;
	semerFiches(r.liste);
}

// le filtre vit dans App : il survit ainsi au démontage (retour depuis le Détail)
export default function Suivi({ filtre, onFiltre, onOuvrir }: {
	filtre: string;
	onFiltre: (f: string) => void;
	onOuvrir: (id: string) => void;
}) {
	const [favoris, setFavoris] = useState(getFavoris());
	const [tuiles, setTuiles] = useState(getOrdreTuiles);
	// glisser après 8 px à la souris, après un appui long au doigt (le tap filtre,
	// le défilement reste libre)
	const capteurs = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
	);
	const finGlisser = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		setTuiles(ts => {
			const nv = arrayMove(ts, ts.findIndex(t => t.cle === active.id), ts.findIndex(t => t.cle === over.id));
			localStorage.setItem(CLE_ORDRE, JSON.stringify(nv.map(t => t.cle)));
			return nv;
		});
	};
	const [recherche, setRecherche] = useState('');
	const [demandes, setDemandes] = useState<Demande[] | null>(cacheSuivi?.liste ?? null);
	const [stats, setStats] = useState<Stats | null>(cacheSuivi?.stats ?? null);
	// affichage par paquets de 50 : le premier rendu reste léger
	const [limite, setLimite] = useState(50);

	// UNE seule lecture serveur (tout + stats) : les tuiles et filtres
	// basculent ensuite instantanément, sans rappeler le serveur
	const charger = useCallback(async () => {
		try {
			const r = await appel<{ liste: Demande[]; stats: Stats }>('getSuivi', 'Tous', getIdentite());
			cacheSuivi = r;
			semerFiches(r.liste);
			setDemandes(r.liste);
			setStats(r.stats);
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
			setDemandes(d => d ?? []);
		}
	}, []);

	useEffect(() => { charger(); }, [charger]);
	useEffect(() => { setLimite(50); }, [filtre, recherche]);

	// mêmes règles que getSuivi côté serveur, appliquées en local
	const auj = new Intl.DateTimeFormat('fr-FR').format(new Date()); // jj/mm/aaaa
	const cmdEdepot = (d: Demande) => d.statut === 'À rechercher' && !!d.coteEDEPOT && !d.cote4E;
	const parFiltre = (demandes ?? []).filter(d =>
		filtre === 'Tous' ? true
			: filtre === 'Généalogie' ? d.destination === 'Généalogie' && !d.affilieLe
				: filtre === 'Affiliés' ? !!d.affilieLe
					: filtre === "Trouvée aujourd'hui" ? (d.statut === 'Trouvée' || d.statut === 'Traitée') && (d.derniereMAJ || '').startsWith(auj)
						: filtre === 'Commande EDEPOT' ? cmdEdepot(d)
							: filtre === 'À rechercher' ? d.statut === 'À rechercher' && !cmdEdepot(d)
								: d.statut === filtre);

	const q = recherche.trim().toLowerCase();
	const visibles = parFiltre.filter(d =>
		!q || `${d.nom} ${d.prenom} ${d.id} ${d.commune} ${d.demandeur}`.toLowerCase().includes(q));
	const affiches = visibles.slice(0, limite);

	return (
		<div className="space-y-4">
			<Carte className="p-2.5 md:p-4">
				<DndContext sensors={capteurs} collisionDetection={closestCenter} onDragEnd={finGlisser}>
					<SortableContext items={tuiles.map(t => t.cle)} strategy={rectSortingStrategy}>
						<div className="grid grid-cols-3 gap-1 md:grid-cols-5 md:gap-2">
							{tuiles.map((t, i) => (
								<TuileStat
									key={t.cle}
									t={t}
									pleineLargeur={t.cle === 'total' && i === 0}
									valeur={stats ? (stats[t.cle] ?? 0) : '–'}
									favori={favoris.includes(t.filtre)}
									onFiltre={() => onFiltre(t.filtre)}
									onFavori={() => setFavoris(basculerFavori(t.filtre))}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			</Carte>

			<div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
				{FILTRES.map(f => (
					<button
						key={f}
						type="button"
						onClick={() => onFiltre(f)}
						className={cn(
							'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
							f === filtre
								? 'bg-tampon text-white'
								: 'border border-neutral-300 bg-neutral-50 text-neutral-600 hover:bg-neutral-200',
						)}
					>
						{f}
					</button>
				))}
			</div>

			<div className="relative">
				<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
				<input
					className={cn(CLASSE_INPUT, 'pl-10')}
					placeholder="Rechercher un nom, un ID, une commune…"
					value={recherche}
					onChange={e => setRecherche(e.target.value)}
				/>
			</div>

			{demandes === null ? (
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{Array.from({ length: 6 }, (_, i) => <SqueletteCarte key={i} />)}
				</div>
			) : visibles.length === 0 ? (
				<Vide>Aucune demande{filtre !== 'Tous' ? ` « ${filtre} »` : ''}{q ? ' pour cette recherche' : ''}.</Vide>
			) : (
				<>
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						{affiches.map(d => <CarteDemande key={d.id} demande={d} onOuvrir={onOuvrir} />)}
					</div>
					{visibles.length > affiches.length && (
						<button
							type="button"
							onClick={() => setLimite(l => l + 50)}
							className="mx-auto block rounded-md border border-neutral-300 bg-neutral-50 px-5 py-2 text-sm font-medium text-tampon transition-colors hover:bg-neutral-200"
						>
							Afficher plus ({visibles.length - affiches.length} restantes)
						</button>
					)}
				</>
			)}
		</div>
	);
}
