import { useCallback, useEffect, useState } from 'react';
import { FileText, Landmark, Send } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import type { Demande, RetourFormulaire } from '@/lib/gas';
import { Btn, Carte, SqueletteLignes, TitreCarte, toast } from '@/components/ui/kit';
import { confirmer } from '@/components/ui/boite';
import { cn } from '@/lib/utils';
import { semerFiches } from '@/lib/precharge';

const MAX_ACTES = 5;

/**
 * Commandes à passer — Admin : formulaire EDEPOT (copies certifiées) et mails
 * de commande aux mairies. Accueillera aussi les bons de commande générés
 * (les archives acceptent le bon imprimé, plus besoin de l'écrire à la main).
 */
// dernier chargement gardé en mémoire (retour d'onglet instantané)
let cacheARechercher: Demande[] | null = null;

async function chargerARechercher() {
	cacheARechercher = await appel<Demande[]>('listerDemandes', 'À rechercher', getIdentite());
	semerFiches(cacheARechercher);
	return cacheARechercher;
}

/** Pré-chauffage au démarrage (App) : l'onglet ouvre sans attendre le serveur. */
export function prechargerCommandes() {
	if (!cacheARechercher) chargerARechercher().catch(() => undefined);
}

export default function Commandes() {
	const [liste, setListe] = useState<Demande[] | null>(cacheARechercher);
	const [sel, setSel] = useState<string[]>([]);
	const [envoi, setEnvoi] = useState(false);

	const charger = useCallback(async () => {
		try {
			setListe(await chargerARechercher());
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
			setListe(d => d ?? []);
		}
	}, []);

	// EDEPOT seul (sans 4E) : la copie se commande par le formulaire officiel
	const edepots = liste?.filter(d => d.coteEDEPOT && !d.cote4E) ?? null;
	// commandes mairies : groupées par commune de rattachement (« X — Section » → X)
	const parMairie = new Map<string, Demande[]>();
	for (const d of liste ?? []) {
		if (d.mairie !== 'À commander') continue;
		const commune = d.commune.split(' — ')[0].trim() || 'Commune à compléter';
		parMairie.set(commune, [...(parMairie.get(commune) ?? []), d]);
	}

	useEffect(() => { charger(); }, [charger]);

	const basculer = (id: string) =>
		setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

	const aCommander = liste?.filter(d => d.mairie === 'À commander') ?? [];
	const envoyerMairies = async () => {
		if (!await confirmer({
			titre: 'Envoyer les commandes aux mairies ?',
			message: `${aCommander.length} acte(s) — un mail par mairie ; un acte antérieur à la création de sa commune part à la commune mère.`,
			ok: 'Envoyer',
		})) return;
		setEnvoi(true);
		try {
			const r = await appel<{ nb: number; mails: Array<{ mairie: string; nb: number }> }>(
				'envoyerMailMairie', aCommander.map(d => d.id), getIdentite());
			toast('Envoyé — ' + r.mails.map(m => `${m.mairie} : ${m.nb}`).join(' · '));
			charger();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	const generer = async () => {
		if (!sel.length) { toast('Sélectionnez au moins une demande EDEPOT'); return; }
		if (sel.length > MAX_ACTES) { toast(`Maximum ${MAX_ACTES} actes par formulaire EDEPOT — faites plusieurs formulaires`); return; }
		const w = window.open('', '_blank');
		if (!w) { toast('Autorisez les pop-ups pour ouvrir le formulaire'); return; }
		setEnvoi(true);
		try {
			const r = await appel<RetourFormulaire>('genererFormulaireEdepot', sel, getIdentite());
			w.location.href = r.url;
			toast(`Formulaire EDEPOT généré (${r.nb} acte${(r.nb ?? 0) > 1 ? 's' : ''})`);
			setSel([]);
			charger(); // les demandes sont passées « Demandée » : la liste se rafraîchit
		} catch (e) {
			w.close();
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	return (
		<div className="mx-auto w-full max-w-lg space-y-4">
			<Carte>
				<TitreCarte>Formulaire EDEPOT</TitreCarte>
				<p className="mb-3 text-sm text-neutral-600">
					Demandes avec cote EDEPOT seule : remplit le formulaire officiel de demande
					de copies certifiées (2 par acte, {MAX_ACTES} actes max par formulaire) à
					envoyer aux archives. Une demande doit avoir sa <b>preuve (capture)</b> pour
					être incluse.
				</p>
				{edepots === null ? (
					<SqueletteLignes />
				) : edepots.length === 0 ? (
					<p className="text-sm text-neutral-500">Aucune commande EDEPOT en attente.</p>
				) : (
					<div className="space-y-3">
						<div className={cn(
							'text-sm font-semibold',
							sel.length > MAX_ACTES ? 'text-red-600' : 'text-neutral-700',
						)}>
							{sel.length} / {MAX_ACTES} acte(s) sélectionné(s)
						</div>
						<div className="max-h-96 space-y-2 overflow-y-auto pr-1">
							{edepots.map(d => {
								const sansPreuve = !d.preuve;
								return (
									<label
										key={d.id}
										className={cn(
											'flex items-start gap-3 rounded-xl p-3 transition-colors',
											sansPreuve
												? 'cursor-not-allowed bg-neutral-50 opacity-60'
												: sel.includes(d.id)
													? 'cursor-pointer bg-tampon/10'
													: 'cursor-pointer bg-neutral-50 hover:bg-neutral-100',
										)}
									>
										<input
											type="checkbox"
											className="mt-1 h-4 w-4 accent-tampon"
											disabled={sansPreuve}
											checked={sel.includes(d.id)}
											onChange={() => basculer(d.id)}
										/>
										<span className="min-w-0 text-sm">
											<span className="font-semibold text-neutral-900">
												{d.nom} {d.prenom}{d.destination === 'Généalogie' ? ' · généalogie' : ''}
											</span>
											<br />
											<span className="text-xs text-neutral-500">
												{d.typeActe} · {d.commune} · {d.anneeActe} · <b>{d.coteEDEPOT}</b>
												{d.numeroActe ? ` · acte n° ${d.numeroActe}` : ''}
											</span>
											{sansPreuve && (
												<>
													<br />
													<span className="text-xs font-semibold text-red-600">
														Preuve (capture) manquante — à joindre sur la fiche
													</span>
												</>
											)}
										</span>
									</label>
								);
							})}
						</div>
						<Btn variante="bleu" disabled={envoi || !sel.length} onClick={generer}>
							<FileText className="h-4 w-4" />
							{envoi ? 'Génération…' : `Générer le formulaire EDEPOT (${sel.length})`}
						</Btn>
					</div>
				)}
			</Carte>

			<Carte>
				<TitreCarte>Commandes mairies</TitreCarte>
				<p className="mb-3 text-sm text-neutral-600">
					Demandes marquées « Commander en mairie » sur leur fiche. Un mail part par
					mairie (l'année de l'acte détermine la commune mère si besoin) — les adresses
					se gèrent dans l'onglet <b>Mairies</b> du classeur.
				</p>
				{liste === null ? (
					<SqueletteLignes />
				) : parMairie.size === 0 ? (
					<p className="text-sm text-neutral-500">Aucune commande mairie en attente.</p>
				) : (
					<div className="space-y-3">
						{[...parMairie.entries()].map(([commune, ds]) => (
							<div key={commune} className="rounded-xl bg-neutral-50 p-3">
								<div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-neutral-900">
									<Landmark className="h-4 w-4 text-tampon" /> {commune}
								</div>
								<div className="space-y-0.5">
									{ds.map(d => (
										<div key={d.id} className="text-xs text-neutral-600">
											{d.nom} {d.prenom} · {d.typeActe}
											{(d.dateActe || d.anneeActe) ? ` · ${d.dateActe || d.anneeActe}` : ''}
											{d.numeroActe ? ` · acte n° ${d.numeroActe}` : ''}
										</div>
									))}
								</div>
							</div>
						))}
						<Btn variante="bleu" disabled={envoi} onClick={envoyerMairies}>
							<Send className="h-4 w-4" />
							{envoi ? 'Envoi…' : `Envoyer les mails aux mairies (${aCommander.length})`}
						</Btn>
					</div>
				)}
			</Carte>
		</div>
	);
}
