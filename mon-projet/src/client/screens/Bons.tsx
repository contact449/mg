import { useCallback, useEffect, useState } from 'react';
import { Send, Shuffle } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import type { Bon, Demande, Habilitation } from '@/lib/gas';
import { Btn, Carte, Champ, CLASSE_INPUT, Encart, SqueletteLignes, TitreCarte, toast } from '@/components/ui/kit';
import { confirmer } from '@/components/ui/boite';
import { cn } from '@/lib/utils';
import { Segmente } from '@/components/ui/segmente';
import { semerFiches } from '@/lib/precharge';

const MAX_COTES = 5;

/** Date du jour au format yyyy-mm-dd (heure locale, pas UTC). */
function dateDuJour(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface RetourRepartition {
	ok: boolean;
	bons: Array<{ idBon: string; personne: string; nb: number }>;
	restantes: number;
}

// dernier chargement gardé en mémoire : retour d'onglet instantané,
// rafraîchissement silencieux en arrière-plan
let cacheEcranBons: { disponibles: Demande[]; bons: Bon[]; agents: Habilitation[]; sansCote: number } | null = null;

async function chargerEcranBons() {
	const [liste, tousBons, habs] = await Promise.all([
		appel<Demande[]>('listerDemandes', 'À rechercher', getIdentite()),
		appel<Bon[]>('listerBons', getIdentite()),
		appel<Habilitation[]>('listerHabilitations', getIdentite()),
	]);
	semerFiches(liste);
	// EDEPOT seul (sans 4E) : commande via l'onglet Commandes, pas sur place ;
	// commande mairie : le circuit archives ne la concerne pas
	const brut = liste.filter(d => !d.bon && d.cote4E && d.mairie !== 'À commander');
	// les actes « déblocage » en tête — même priorité que le dispatch serveur
	const dispo = [...brut.filter(d => d.deblocage), ...brut.filter(d => !d.deblocage)];
	const nbSansCote = liste.filter(d => !d.cote4E && !d.coteEDEPOT).length;
	cacheEcranBons = { disponibles: dispo, bons: tousBons, agents: habs, sansCote: nbSansCote };
	return cacheEcranBons;
}

/** Pré-chauffage au démarrage (App) : l'onglet ouvre sans attendre le serveur. */
export function prechargerEcranBons() {
	if (!cacheEcranBons) chargerEcranBons().catch(() => undefined);
}

// vue retenue entre montages : retour depuis un bon → on retombe sur la même vue
let derniereVue: 'creer' | 'liste' = 'creer';

/** Dispatch des actes : répartition automatique ou bon manuel — Admin. */
export default function Bons({ onOuvrirBon }: { onOuvrirBon: (idBon: string) => void }) {
	// deux vues : création/dispatch d'un côté, liste des bons créés de l'autre
	const [vue, setVue] = useState<'creer' | 'liste'>(derniereVue);
	useEffect(() => { derniereVue = vue; }, [vue]);
	const [disponibles, setDisponibles] = useState<Demande[] | null>(cacheEcranBons?.disponibles ?? null);
	const [bons, setBons] = useState<Bon[]>(cacheEcranBons?.bons ?? []);
	const [agents, setAgents] = useState<Habilitation[]>(cacheEcranBons?.agents ?? []);
	// visite commune aux deux modes — aujourd'hui par défaut, pas de date passée
	const [date, setDate] = useState(dateDuJour());
	const [demiJournee, setDemiJournee] = useState('Matin');
	// répartition automatique
	const [emailsAuto, setEmailsAuto] = useState<string[]>([]);
	const [envoiAuto, setEnvoiAuto] = useState(false);
	// bon manuel
	const [selection, setSelection] = useState<string[]>([]);
	const [email, setEmail] = useState('');
	const [envoi, setEnvoi] = useState(false);
	// demandes « À rechercher » sans aucune cote : invisibles dans le dispatch
	const [sansCote, setSansCote] = useState(cacheEcranBons?.sansCote ?? 0);

	const charger = useCallback(async () => {
		try {
			const c = await chargerEcranBons();
			setDisponibles(c.disponibles);
			setSansCote(c.sansCote);
			setBons(c.bons);
			setAgents(c.agents);
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
			setDisponibles(d => d ?? []);
		}
	}, []);

	useEffect(() => { charger(); }, [charger]);

	const dateFr = () => {
		const [a, m, j] = date.split('-');
		return `${j}/${m}/${a}`;
	};

	const verifVisite = () => {
		if (!date) { toast('Indiquez la date de la visite'); return false; }
		if (date < dateDuJour()) { toast('La date de visite ne peut pas être dans le passé'); return false; }
		return true;
	};

	/* ------------------- répartition automatique ------------------- */

	const basculerAgent = (mail: string) =>
		setEmailsAuto(s => (s.includes(mail) ? s.filter(x => x !== mail) : [...s, mail]));

	const repartir = async () => {
		if (!verifVisite()) return;
		if (!emailsAuto.length) { toast('Choisissez au moins une personne'); return; }
		setEnvoiAuto(true);
		try {
			const r = await appel<RetourRepartition>('repartirBons', {
				dateArchives: dateFr(), demiJournee, emails: emailsAuto,
			}, getIdentite());
			toast(r.bons.map(b => `${b.personne} : ${b.nb}`).join(' · ') +
				(r.restantes ? ` — ${r.restantes} non affectée(s)` : ''));
			setEmailsAuto([]);
			charger();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoiAuto(false);
		}
	};

	/* ------------------------- bon manuel -------------------------- */

	const basculer = (id: string) =>
		setSelection(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

	const creer = async () => {
		if (!verifVisite()) return;
		if (!selection.length) { toast('Sélectionnez au moins une demande'); return; }
		if (selection.length > MAX_COTES) { toast(`Maximum ${MAX_COTES} cotes par personne et par demi-journée`); return; }
		if (!email) { toast('Choisissez la personne qui se rend aux archives'); return; }
		setEnvoi(true);
		try {
			const r = await appel<{ idBon: string }>('creerBonCommande', {
				dateArchives: dateFr(), demiJournee, email, ids: selection,
			}, getIdentite());
			toast(`Bon ${r.idBon} créé`);
			setSelection([]);
			onOuvrirBon(r.idBon);
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	/* --------------- envoi des bons d'une visite aux archives --------------- */

	const envoyerArchives = async (dateA: string, demi: string, nb: number) => {
		if (!await confirmer({
			titre: `Envoyer ${nb} bon(s) aux archives ?`,
			message: `Visite du ${dateA} (${demi}) — les demandes trouvées passent « Traitée », un PDF par bon est généré puis envoyé aux archives. À ne faire qu'une fois tout terminé.`,
			ok: 'Envoyer',
		})) return;
		try {
			const r = await appel<{ nb: number; actes: number; email: string }>('envoyerBonsArchives', dateA, demi, getIdentite());
			toast(`${r.nb} bon${r.nb > 1 ? 's' : ''} envoyé${r.nb > 1 ? 's' : ''} à ${r.email} (${r.actes} acte${r.actes > 1 ? 's' : ''})`);
			charger();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		}
	};

	// vue liste : bons groupés par visite (date + demi-journée)
	const visites = new Map<string, Bon[]>();
	for (const b of bons) {
		const k = `${b.dateArchives} · ${b.demiJournee}`;
		visites.set(k, [...(visites.get(k) ?? []), b]);
	}

	const nbDispo = disponibles?.length ?? 0;

	return (
		<div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
			<Segmente
				className="md:col-span-2"
				options={['creer', 'liste'] as const}
				valeur={vue}
				onChange={setVue}
				rendu={o => (o === 'creer' ? 'Créer / dispatch' : `Bons créés (${bons.length})`)}
			/>

			{vue === 'creer' && (<>
			{sansCote > 0 && (
				<Encart couleur="orange" className="md:col-span-2">
					<b>{sansCote}</b> demande{sansCote > 1 ? 's' : ''} « À rechercher » sans cote,
					invisible{sansCote > 1 ? 's' : ''} ici tant que la cote n'est pas complétée —
					voir le Suivi (filtre « À rechercher ») ou corriger le classement dans la fiche.
				</Encart>
			)}
			{/* colonne gauche : le flux normal (visite + répartition auto) */}
			<div className="space-y-4">
			<Carte>
				<TitreCarte>Visite aux archives</TitreCarte>
				<div className="grid grid-cols-2 gap-3">
					<Champ label="Date">
						<input type="date" className={CLASSE_INPUT} value={date} min={dateDuJour()} onChange={e => setDate(e.target.value)} />
					</Champ>
					<Champ label="Demi-journée">
						<select className={CLASSE_INPUT} value={demiJournee} onChange={e => setDemiJournee(e.target.value)}>
							<option>Matin</option>
							<option>Après-midi</option>
						</select>
					</Champ>
				</div>
			</Carte>

			<Carte>
				<TitreCarte>Répartition automatique</TitreCarte>
				<p className="mb-3 text-sm text-neutral-600">
					Distribue les <b>{nbDispo}</b> demande{nbDispo > 1 ? 's' : ''} disponible{nbDispo > 1 ? 's' : ''} (avec
					cote 4E, hors bon — les EDEPOT seuls passent par le formulaire) équitablement
					entre les personnes cochées — les plus anciennes d'abord, {MAX_COTES} max chacune.
					Un bon par personne. Les demandes Généalogie vont en priorité aux admins cochés.
				</p>
				<div className="mb-3 flex flex-wrap gap-2">
					{agents.map(a => (
						<button
							key={a.email}
							type="button"
							onClick={() => basculerAgent(a.email)}
							className={cn(
								'rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
								emailsAuto.includes(a.email)
									? 'bg-tampon text-white'
									: 'bg-neutral-100 text-neutral-600 active:bg-neutral-200',
							)}
						>
							{a.nom || a.email}
						</button>
					))}
				</div>
				<Btn variante="primaire" disabled={envoiAuto || !nbDispo} onClick={repartir}>
					<Shuffle className="h-4 w-4" /> {envoiAuto ? 'Répartition…' : 'Répartir automatiquement'}
				</Btn>
			</Carte>
			</div>

			{/* colonne droite : l'alternative manuelle */}
			<Carte className="md:self-start">
				<TitreCarte>Ou : créer un bon à la main</TitreCarte>
				<div className="space-y-3">
					<Champ label="Personne (compte habilité)">
						<select className={CLASSE_INPUT} value={email} onChange={e => setEmail(e.target.value)}>
							<option value="">— Choisir —</option>
							{agents.map(a => (
								<option key={a.email} value={a.email}>{a.nom || a.email} ({a.role})</option>
							))}
						</select>
					</Champ>

					<div className={cn(
						'text-sm font-semibold',
						selection.length > MAX_COTES ? 'text-red-600' : 'text-neutral-700',
					)}>
						{selection.length} / {MAX_COTES} cote(s) sélectionnée(s)
					</div>

					{disponibles === null ? (
						<SqueletteLignes />
					) : disponibles.length === 0 ? (
						<p className="text-sm text-neutral-500">
							Aucune demande disponible (déjà dans un bon, sans cote 4E, ou EDEPOT seule → formulaire).
						</p>
					) : (
						<div className="max-h-80 space-y-2 overflow-y-auto pr-1">
							{disponibles.map(d => (
								<label
									key={d.id}
									className={cn(
										'flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors',
										selection.includes(d.id)
											? 'bg-tampon/10'
											: 'bg-neutral-50 hover:bg-neutral-100',
									)}
								>
									<input
										type="checkbox"
										className="mt-1 h-4 w-4 accent-tampon"
										checked={selection.includes(d.id)}
										onChange={() => basculer(d.id)}
									/>
									<span className="min-w-0 text-sm">
										<span className="font-semibold text-neutral-900">
											{d.deblocage && <span className="font-bold text-rose-600">Déblocage · </span>}
											{d.nom} {d.prenom}{d.destination === 'Généalogie' ? ' · généalogie' : ''}
										</span>
										<br />
										<span className="text-xs text-neutral-500">
											{d.typeActe} · {d.commune} · {d.anneeActe} · <b>{d.cote4E || d.coteEDEPOT}</b>
											{d.classement === 'Les deux' ? ' (copie 4E)' : ''}
										</span>
									</span>
								</label>
							))}
						</div>
					)}

					<Btn variante="vert" disabled={envoi} onClick={creer}>
						{envoi ? 'Création…' : 'Créer le bon'}
					</Btn>
				</div>
			</Carte>

			</>)}

			{vue === 'liste' && (
				<div className="space-y-4 md:col-span-2">
					{bons.length === 0 ? (
						<Carte><p className="text-sm text-neutral-500">Aucun bon créé.</p></Carte>
					) : (
						[...visites.entries()].map(([visite, groupe]) => {
							const aEnvoyer = groupe.filter(b => !b.mailArchives).length;
							const envoyes = groupe.filter(b => b.mailArchives).length;
							return (
								<Carte key={visite}>
									<TitreCarte>{visite}</TitreCarte>
									<div className="grid gap-2 md:grid-cols-2">
										{groupe.map(b => <CarteBon key={b.idBon} bon={b} onOuvrir={onOuvrirBon} />)}
									</div>
									{envoyes === groupe.length ? (
										<p className="mt-3 text-xs font-semibold text-emerald-700">Bons envoyés aux archives.</p>
									) : (
										<Btn
											variante="bleu" className="mt-3"
											disabled={!aEnvoyer}
											onClick={() => envoyerArchives(groupe[0].dateArchives, groupe[0].demiJournee, aEnvoyer)}
										>
											<Send className="h-4 w-4" />
											{`Envoyer aux archives (${aEnvoyer} bon${aEnvoyer > 1 ? 's' : ''})`}
										</Btn>
									)}
								</Carte>
							);
						})
					)}
				</div>
			)}
		</div>
	);
}

export function CarteBon({ bon: b, onOuvrir }: { bon: Bon; onOuvrir: (idBon: string) => void }) {
	const nb = b.demandes.split(',').filter(s => s.trim()).length;
	return (
		<button
			type="button"
			onClick={() => onOuvrir(b.idBon)}
			className="flex w-full flex-col items-stretch justify-start rounded-lg border border-neutral-200 bg-neutral-50 p-3.5 text-left transition-[box-shadow,border-color,scale] duration-150 ease-out hover:border-neutral-300 hover:shadow-carte-hover active:scale-[0.99]"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="font-mono text-sm font-semibold text-neutral-900">{b.idBon}</span>
				<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
					{b.demiJournee}
				</span>
			</div>
			<div className="mt-0.5 text-xs text-neutral-500">
				{b.dateArchives} · {b.personne} · {nb} cote(s)
				{b.photoBon ? ' · PDF généré' : ''}
				{b.mailArchives ? ` · archives : ${b.mailArchives.toLowerCase()}` : ''}
			</div>
		</button>
	);
}
