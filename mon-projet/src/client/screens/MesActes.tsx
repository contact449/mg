import { useEffect, useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { appel, getIdentite, setIdentite } from '@/lib/gas';
import type { Bon, Personne, Profil } from '@/lib/gas';
import { CarteBon } from '@/screens/Bons';
import { Btn, Carte, Champ, CLASSE_INPUT, Encart, SqueletteCarte, SqueletteLignes, TitreCarte, toast, Vide } from '@/components/ui/kit';

// dernier chargement gardé en mémoire (retour d'onglet instantané)
let cacheMesBons: Bon[] | null = null;

/** Les bons affectés à l'utilisateur — avec identification par nom + code
 *  personnel (aucun compte Google requis). */
export default function MesActes({ profil, onOuvrirBon, onProfilChange }: {
	profil: Profil;
	onOuvrirBon: (idBon: string) => void;
	onProfilChange: () => void;
}) {
	const [bons, setBons] = useState<Bon[] | null>(cacheMesBons);

	useEffect(() => {
		appel<Bon[]>('listerMesBons', getIdentite())
			.then(b => { cacheMesBons = b; setBons(b); })
			.catch(e => { toast('Erreur : ' + (e as Error).message); setBons(b => b ?? []); });
	}, []);

	const aFaire = (bons ?? []).filter(b => !b.photoBon);
	const faits = (bons ?? []).filter(b => b.photoBon);

	return (
		<div className="space-y-4">
			<Encart couleur="neutre">
				<div className="flex items-center justify-between gap-2">
					<span>
						<b>{profil.nom || profil.email}</b>
						{profil.declare && ' (identifié par code)'} — voici tes bons de commande.
					</span>
					{profil.declare && (
						<button
							type="button"
							onClick={() => { cacheMesBons = null; setBons(null); setIdentite(null); onProfilChange(); }}
							className="flex shrink-0 items-center gap-1 rounded-[10px] bg-neutral-50 px-2.5 py-1.5 text-xs font-semibold text-tampon active:opacity-60"
						>
							<LogOut className="h-3.5 w-3.5" /> Changer
						</button>
					)}
				</div>
			</Encart>

			{bons === null ? (
				<div className="grid gap-2 md:grid-cols-2">
					{Array.from({ length: 4 }, (_, i) => <SqueletteCarte key={i} />)}
				</div>
			) : bons.length === 0 ? (
				<Vide>Aucun bon ne t'est affecté pour le moment.</Vide>
			) : (
				<>
					{aFaire.length > 0 && (
						<div className="space-y-2">
							<h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">En cours</h2>
							<div className="grid gap-2 md:grid-cols-2">
								{aFaire.map(b => <CarteBon key={b.idBon} bon={b} onOuvrir={onOuvrirBon} />)}
							</div>
						</div>
					)}
					{faits.length > 0 && (
						<div className="space-y-2">
							<h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Terminés (PDF du bon généré)</h2>
							<div className="grid gap-2 md:grid-cols-2">
								{faits.map(b => <CarteBon key={b.idBon} bon={b} onOuvrir={onOuvrirBon} />)}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}

/* --------------------- Identification par code ---------------------- */

/** Aussi la page de connexion de l'app (App) : l'accès exige une identité. */
export function Identification({ onIdentifie }: { onIdentifie: () => void }) {
	const [personnes, setPersonnes] = useState<Personne[] | null>(null);
	const [email, setEmail] = useState('');
	const [code, setCode] = useState('');
	const [envoi, setEnvoi] = useState(false);

	useEffect(() => {
		appel<Personne[]>('listerPersonnes')
			.then(setPersonnes)
			.catch(e => { toast('Erreur : ' + (e as Error).message); setPersonnes([]); });
	}, []);

	const valider = async () => {
		if (!email) { toast('Choisis ton nom dans la liste'); return; }
		if (!code.trim()) { toast('Tape ton code personnel'); return; }
		setEnvoi(true);
		try {
			const p = await appel<Profil>('identifier', email, code.trim());
			setIdentite({ email, code: code.trim(), nom: p.nom });
			toast(`Bienvenue ${p.nom || email} !`);
			onIdentifie();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	return (
		<div className="mx-auto w-full max-w-lg space-y-4">
			<Carte>
				<TitreCarte>S'identifier</TitreCarte>
				<p className="mb-4 text-sm leading-relaxed text-neutral-600">
					Aucun compte Google n'est nécessaire : choisis ton nom dans la liste et
					tape ton <b>code personnel</b> — c'est l'administrateur qui te l'a donné.
				</p>
				{personnes === null ? (
					<SqueletteLignes />
				) : (
					<div className="space-y-3">
						<Champ label="Qui es-tu ?">
							<select className={CLASSE_INPUT} value={email} onChange={e => setEmail(e.target.value)}>
								<option value="">— Choisir —</option>
								{personnes.map(p => (
									<option key={p.email} value={p.email} disabled={!p.aCode}>
										{p.nom}{!p.aCode ? ' (pas de code défini)' : ''}
									</option>
								))}
							</select>
						</Champ>
						<Champ label="Code personnel">
							<input
								className={CLASSE_INPUT}
								type="password"
								inputMode="numeric"
								autoComplete="off"
								value={code}
								onChange={e => setCode(e.target.value)}
								onKeyDown={e => { if (e.key === 'Enter') valider(); }}
							/>
						</Champ>
						<Btn variante="primaire" disabled={envoi} onClick={valider}>
							<KeyRound className="h-4 w-4" /> {envoi ? 'Vérification…' : "S'identifier"}
						</Btn>
					</div>
				)}
			</Carte>
			<Encart couleur="neutre">
				Pas de code ? Demande à l'administrateur de t'en définir un dans l'écran Admin.
			</Encart>
		</div>
	);
}
