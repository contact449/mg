import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Trash2, UserPlus } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import type { Habilitation, Profil } from '@/lib/gas';
import { Btn, Carte, Champ, CLASSE_INPUT, Encart, SqueletteLignes, TitreCarte, toast } from '@/components/ui/kit';
import { confirmer, demander } from '@/components/ui/boite';
import { cn } from '@/lib/utils';

/** Gestion des habilitations — Admin uniquement. */
export default function Admin({ profil }: { profil: Profil }) {
	const [liste, setListe] = useState<Habilitation[] | null>(null);
	const [email, setEmail] = useState('');
	const [nom, setNom] = useState('');
	const [role, setRole] = useState('Agent');
	const [code, setCode] = useState('');
	const [envoi, setEnvoi] = useState(false);

	const charger = useCallback(async () => {
		try { setListe(await appel<Habilitation[]>('listerHabilitations', getIdentite())); }
		catch (e) { toast('Erreur : ' + (e as Error).message); setListe([]); }
	}, []);

	useEffect(() => { charger(); }, [charger]);

	const ajouter = async () => {
		if (!email.trim() || !email.includes('@')) { toast('Email invalide'); return; }
		setEnvoi(true);
		try {
			await appel('ajouterHabilitation', email.trim(), nom.trim(), role, code.trim(), getIdentite());
			toast(`${email.trim()} habilité (${role})`);
			setEmail('');
			setNom('');
			setCode('');
			charger();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	const changerCode = async (cible: string, dejaUnCode: boolean) => {
		const nouveau = await demander({
			titre: (dejaUnCode ? 'Nouveau code' : 'Code') + ' personnel',
			message: `Pour ${cible} — 4 caractères minimum, à transmettre à la personne.`,
			placeholder: 'Code', ok: 'Enregistrer',
		});
		if (!nouveau) return;
		try {
			await appel('definirCode', cible, nouveau.trim(), getIdentite());
			toast('Code enregistré — à transmettre à la personne');
			charger();
		} catch (e) { toast('Erreur : ' + (e as Error).message); }
	};

	const retirer = async (cible: string) => {
		if (!await confirmer({
			titre: "Retirer l'habilitation ?",
			message: `${cible} passera en mode terrain (lecture + photos).`,
			ok: 'Retirer', danger: true,
		})) return;
		try {
			await appel('retirerHabilitation', cible, getIdentite());
			toast('Habilitation retirée');
			charger();
		} catch (e) { toast('Erreur : ' + (e as Error).message); }
	};

	return (
		// PC : ajout à gauche, personnes habilitées à droite (comme l'écran IDLR)
		<div className="mx-auto w-full max-w-lg space-y-4 md:mx-0 md:grid md:max-w-none md:grid-cols-[380px_minmax(0,1fr)] md:items-start md:gap-4 md:space-y-0">
			<div className="space-y-4">
			<Encart couleur="neutre">
				<b>Admin</b> : saisit les demandes et dispatche les actes (bons de commande).{' '}
				<b>Agent</b> : reçoit ses actes à prendre, corrige cotes et preuves.
				Les personnes non habilitées sont en mode terrain (consultation + photos + statuts).
			</Encart>

			<Carte>
				<TitreCarte>Ajouter une personne</TitreCarte>
				<div className="space-y-3">
					<Champ label="Email (identifiant) *">
						<input className={CLASSE_INPUT} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="prenom@ociexpress.re" />
					</Champ>
					<div className="grid grid-cols-2 gap-3">
						<Champ label="Nom affiché">
							<input className={CLASSE_INPUT} value={nom} onChange={e => setNom(e.target.value)} />
						</Champ>
						<Champ label="Rôle">
							<select className={CLASSE_INPUT} value={role} onChange={e => setRole(e.target.value)}>
								<option>Agent</option>
								<option>Admin</option>
							</select>
						</Champ>
					</div>
					<Champ label="Code personnel (connexion dans l'app)">
						<input className={CLASSE_INPUT} value={code} onChange={e => setCode(e.target.value)} placeholder="4 caractères minimum — optionnel" />
					</Champ>
					<Btn variante="vert" disabled={envoi} onClick={ajouter}>
						<UserPlus className="h-4 w-4" /> {envoi ? 'Ajout…' : 'Habiliter'}
					</Btn>
				</div>
			</Carte>
			</div>

			<Carte className="mt-4 md:mt-0">
				<TitreCarte>Personnes habilitées</TitreCarte>
				{liste === null ? (
					<SqueletteLignes />
				) : liste.length === 0 ? (
					<p className="text-sm text-neutral-500">Aucune habilitation.</p>
				) : (
					<div className="space-y-2">
						{liste.map(h => (
							<div key={h.email} className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 p-3.5">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="truncate font-semibold text-neutral-900">{h.nom || h.email}</span>
										<span className={cn(
											'rounded-full px-2 py-0.5 text-[11px] font-semibold',
											h.role === 'Admin' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
										)}>
											{h.role}
										</span>
									</div>
									<div className="truncate text-xs text-neutral-500">
										{h.email} · ajouté le {h.ajouteLe} par {h.ajoutePar}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1.5">
									<button
										type="button"
										onClick={() => changerCode(h.email, h.aCode)}
										className={cn(
											'rounded-xl border p-2 transition-colors',
											h.aCode
												? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
												: 'border-neutral-300 bg-neutral-50 text-neutral-400 hover:bg-neutral-200',
										)}
										aria-label={`Code de ${h.email}`}
										title={h.aCode ? 'Code défini — changer' : 'Aucun code — définir'}
									>
										<KeyRound className="h-4 w-4" />
									</button>
									{h.email.toLowerCase() !== profil.email.toLowerCase() && (
										<button
											type="button"
											onClick={() => retirer(h.email)}
											className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/20"
											aria-label={`Retirer ${h.email}`}
										>
											<Trash2 className="h-4 w-4" />
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				)}
			</Carte>
		</div>
	);
}
