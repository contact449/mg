import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ClipboardList, FileText, HelpCircle, LayoutList, Library, PlusCircle, Receipt, ShieldCheck, Stamp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import type { Demande, Profil, Stats } from '@/lib/gas';
import { Chargement, Toaster, toast } from '@/components/ui/kit';
import { Boites } from '@/components/ui/boite';
import { Sidebar, SidebarBody, SidebarLink, SidebarSousLink } from '@/components/ui/sidebar';
import { getFavoris } from '@/lib/favoris';
import { cn } from '@/lib/utils';
import Suivi, { semerSuivi } from '@/screens/Suivi';
import Detail from '@/screens/Detail';
import NouvelleDemande from '@/screens/NouvelleDemande';
import Bons, { prechargerEcranBons } from '@/screens/Bons';
import BonDetail from '@/screens/BonDetail';
import Commandes, { prechargerCommandes } from '@/screens/Commandes';
import Idlr from '@/screens/Idlr';
import Apostille from '@/screens/Apostille';
import MesActes, { Identification } from '@/screens/MesActes';
import Admin from '@/screens/Admin';
import Guide from '@/screens/Guide';

type Onglet = 'suivi' | 'mes-actes' | 'nouvelle' | 'bons' | 'commandes' | 'apostille' | 'idlr' | 'admin' | 'guide';
type Route =
	| { ecran: Onglet }
	| { ecran: 'detail'; id: string }
	| { ecran: 'bon'; idBon: string };

const TITRES: Record<string, string> = {
	suivi: 'Suivi des demandes',
	'mes-actes': 'Mes actes à prendre',
	nouvelle: 'Nouvelle demande',
	bons: 'Bons de commande',
	commandes: 'Commandes',
	apostille: 'Apostille',
	idlr: 'Recherche IDLR (test)',
	admin: 'Habilitations',
	guide: 'Guide',
	detail: 'Détail de la demande',
	bon: 'Bon de commande',
};

export default function App() {
	const [profil, setProfil] = useState<Profil | null>(null);
	const [pile, setPile] = useState<Route[]>([{ ecran: 'suivi' }]);
	// filtre courant du Suivi — vit ici pour survivre au passage par le Détail
	const [filtreSuivi, setFiltreSuivi] = useState('Tous');
	const route = pile[pile.length - 1];
	// sur PC le défilement vit dans la colonne de contenu, pas dans window
	const colonne = useRef<HTMLDivElement>(null);
	const remonter = () => { window.scrollTo(0, 0); colonne.current?.scrollTo(0, 0); };

	const chargerProfil = () => {
		appel<{ profil: Profil; suivi: { liste: Demande[]; stats: Stats } | null }>('getBootstrap', getIdentite())
			.then(b => {
				if (b.suivi) semerSuivi(b.suivi);
				setProfil(b.profil);
				// pré-chauffage des onglets admin, après la 1re peinture du Suivi
				if (b.profil.estAdmin) setTimeout(() => { prechargerEcranBons(); prechargerCommandes(); }, 1500);
			})
			.catch(e => {
				toast('Erreur : ' + (e as Error).message);
				setProfil({ email: '', nom: '', role: 'Lecture', connecte: false, declare: false, peutModifier: false, estAdmin: false });
			});
	};
	useEffect(chargerProfil, []);

	const ouvrir = (r: Route) => {
		setPile(p => [...p, r]);
		remonter();
	};
	const retour = () => {
		setPile(p => (p.length > 1 ? p.slice(0, -1) : p));
		remonter();
	};
	const allerOnglet = (o: Onglet) => {
		setPile([{ ecran: o }]);
		remonter();
	};

	if (!profil) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center fond-app">
				<div className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-neutral-900">
					<span className="grid h-9 w-9 place-items-center rounded-xl bg-tampon text-base font-bold text-white">A</span>
					Archives
				</div>
				<p className="mt-1 text-sm text-neutral-500">Gestion des demandes d'actes</p>
				<Chargement />
			</div>
		);
	}

	// porte d'entrée : sans habilitation (Google ou personne + code), rien ne
	// s'affiche — le serveur refuse de toute façon les lectures non identifiées
	if (!profil.peutModifier) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center fond-app px-4 py-10">
				<div className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-neutral-900">
					<span className="grid h-9 w-9 place-items-center rounded-xl bg-tampon text-base font-bold text-white">A</span>
					Archives
				</div>
				<p className="mt-1 text-sm text-neutral-500">Accès réservé — identifie-toi pour consulter</p>
				{profil.connecte && (
					<p className="mt-2 max-w-md text-center text-xs text-neutral-500">
						Compte Google <b>{profil.email}</b> non habilité — identifie-toi avec ton
						code personnel, ou demande l'accès à un administrateur.
					</p>
				)}
				<div className="mt-6 w-full">
					<Identification onIdentifie={chargerProfil} />
				</div>
				<Toaster />
			</div>
		);
	}

	const onglets: Array<{ id: Onglet; libelle: string; icone: LucideIcon }> = [
		{ id: 'suivi', libelle: 'Suivi', icone: LayoutList },
		// « Mes actes » sert aussi d'écran d'identification pour les comptes hors domaine
		{ id: 'mes-actes', libelle: 'Mes actes', icone: ClipboardList },
		...(profil.estAdmin ? [
			{ id: 'nouvelle' as Onglet, libelle: 'Nouvelle', icone: PlusCircle },
			{ id: 'bons' as Onglet, libelle: 'Bons', icone: Receipt },
			{ id: 'commandes' as Onglet, libelle: 'Commandes', icone: FileText },
			{ id: 'apostille' as Onglet, libelle: 'Apostille', icone: Stamp },
			{ id: 'idlr' as Onglet, libelle: 'IDLR', icone: Library },
			{ id: 'admin' as Onglet, libelle: 'Admin', icone: ShieldCheck },
		] : []),
		{ id: 'guide', libelle: 'Guide', icone: HelpCircle },
	];

	const estSousEcran = route.ecran === 'detail' || route.ecran === 'bon';

	return (
		<div className="min-h-screen fond-app text-neutral-900 md:flex md:h-screen md:overflow-hidden">
			{/* rail latéral animé (PC) : icônes seules, se déplie au survol */}
			<Sidebar>
				<SidebarBody>
					<div className="mb-6 flex items-center gap-3 px-1">
						<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-tampon text-sm font-bold text-white">A</span>
						<span className="truncate text-sm font-bold">Archives</span>
					</div>
					<div className="flex flex-col gap-1">
						{onglets.map(o => (
							<div key={o.id} className="flex flex-col">
								<SidebarLink
									actif={pile[0].ecran === o.id}
									icone={<o.icone className={cn('h-5 w-5', pile[0].ecran === o.id && 'stroke-[2.5]')} />}
									label={o.libelle}
									onClick={() => allerOnglet(o.id)}
								/>
								{o.id === 'suivi' && getFavoris().map(fv => (
									<SidebarSousLink
										key={fv}
										label={fv}
										onClick={() => { setFiltreSuivi(fv); allerOnglet('suivi'); }}
									/>
								))}
							</div>
						))}
					</div>
				</SidebarBody>
			</Sidebar>

			{/* colonne de contenu : en-tête + écran, défilement interne sur PC */}
			<div ref={colonne} className="flex min-h-screen flex-1 flex-col md:h-screen md:min-h-0 md:overflow-y-auto">
				<header className="sticky top-0 z-40 border-b border-neutral-300/60 chrome-app backdrop-blur-xl">
					<div className="relative mx-auto flex h-14 max-w-lg items-center justify-between gap-2 px-4 md:max-w-6xl md:px-8">
						{estSousEcran ? (
							<button
								type="button"
								onClick={retour}
								className="-ml-2 flex items-center rounded-xl px-1.5 py-1.5 text-[16px] text-tampon active:opacity-50"
							>
								<ChevronLeft className="h-6 w-6" /> Retour
							</button>
						) : (
							<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-tampon text-sm font-bold text-white md:hidden">A</span>
						)}
						<h1 className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold md:static md:inset-auto md:min-w-0 md:flex-1 md:text-left">
							{TITRES[route.ecran]}
						</h1>
						{/* nom de l'app centré (PC) : différencie Archives de DemSuiv d'un coup d'œil */}
						<span className="pointer-events-none absolute inset-x-0 hidden items-center justify-center gap-1.5 text-sm font-bold tracking-tight text-tampon md:flex">
							<span className="h-2 w-2 rounded-full bg-tampon" /> Archives
						</span>
						<span className={cn(
							'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium',
							profil.estAdmin ? 'text-tampon' : profil.peutModifier ? 'text-blue-700 dark:text-blue-300' : 'text-neutral-600',
						)}>
							<span className={cn('h-1.5 w-1.5 rounded-full', profil.estAdmin ? 'bg-tampon' : profil.peutModifier ? 'bg-blue-500' : 'bg-neutral-400')} />
							{profil.connecte ? profil.role : 'Terrain'}
						</span>
					</div>
				</header>

				<main className="mx-auto w-full max-w-lg px-4 pb-28 pt-4 md:max-w-6xl md:px-8 md:pb-12 md:pt-6 xl:max-w-7xl">
				{route.ecran === 'suivi' && (
					<Suivi filtre={filtreSuivi} onFiltre={setFiltreSuivi} onOuvrir={id => ouvrir({ ecran: 'detail', id })} />
				)}
				{route.ecran === 'detail' && (
					<Detail
						id={route.id}
						profil={profil}
						onOuvrirBon={idBon => ouvrir({ ecran: 'bon', idBon })}
						onSupprimee={retour}
					/>
				)}
				{route.ecran === 'nouvelle' && (
					<NouvelleDemande onCreee={id => ouvrir({ ecran: 'detail', id })} />
				)}
				{route.ecran === 'bons' && (
					<Bons onOuvrirBon={idBon => ouvrir({ ecran: 'bon', idBon })} />
				)}
				{route.ecran === 'commandes' && <Commandes />}
				{route.ecran === 'apostille' && <Apostille />}
				{route.ecran === 'idlr' && <Idlr />}
				{route.ecran === 'bon' && (
					<BonDetail
						idBon={route.idBon}
						onOuvrirDemande={id => ouvrir({ ecran: 'detail', id })}
					/>
				)}
				{route.ecran === 'mes-actes' && (
					<MesActes
						profil={profil}
						onOuvrirBon={idBon => ouvrir({ ecran: 'bon', idBon })}
						onProfilChange={chargerProfil}
					/>
				)}
				{route.ecran === 'admin' && <Admin profil={profil} />}
				{route.ecran === 'guide' && <Guide />}
				</main>

				{/* barre du bas (mobile uniquement — le PC a le rail latéral) */}
				<nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-300/60 chrome-app backdrop-blur-xl md:hidden">
					<div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
						{onglets.map(o => {
							const actif = pile[0].ecran === o.id;
							const Icone = o.icone;
							return (
								<button
									key={o.id}
									type="button"
									onClick={() => allerOnglet(o.id)}
									className={cn(
										'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold transition-colors',
										actif ? 'text-tampon' : 'text-neutral-400 hover:text-neutral-600',
									)}
								>
									<Icone className={cn('h-5 w-5', actif && 'stroke-[2.5]')} />
									<span className="truncate">{o.libelle}</span>
								</button>
							);
						})}
					</div>
				</nav>
			</div>

			<Toaster />
			<Boites />
		</div>
	);
}
