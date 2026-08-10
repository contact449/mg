import { useEffect, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { appel, getIdentite } from '@/lib/gas';
import { Btn, Carte, Champ, CLASSE_INPUT, Encart, Squelette, TitreCarte, toast } from '@/components/ui/kit';

/* Écran de TEST de la base IDLR (iledelareunion-archive.com, association
 * Arbre) : recherche en direct dans leur état civil ancien, avec lien
 * « demande de photo » vers le site. */

interface IdlrParent { nom?: string; prenom?: string; decede?: boolean }
interface IdlrPersonne {
	nom?: string; prenom?: string; sexe?: string; age?: string;
	date_naissance?: string; origine?: string; parrain?: string; marraine?: string;
	pere?: IdlrParent; mere?: IdlrParent;
}
interface IdlrActe {
	type_acte: string; type_acte_libelle: string; commune: string; date: string;
	obs?: string; numero?: string; url_demande_photo?: string;
	personnes: { principal?: IdlrPersonne; conjoint?: IdlrPersonne };
}
interface IdlrRetour {
	ok: boolean; total: number; count: number; page: number | null; totalPages: number;
	cached?: boolean; warnings: string[]; results: IdlrActe[];
	scope: { type: string; label: string };
}
interface IdlrRef { secteurs: string[]; communes: string[]; types: Record<string, string> }

// « Obs : °08 M32 n°89446 » → l'observation cache parfois le n° de matricule
const matricule = (obs?: string) => obs?.match(/[nN]\s*°\s*(\d+)/)?.[1] ?? '';

function Personne({ p, titre }: { p: IdlrPersonne; titre?: string }) {
	const parent = (x?: IdlrParent) => x && (x.nom || x.prenom)
		? `${x.prenom || ''}${x.nom ? ' ' + x.nom : ''}${x.decede ? ' †' : ''}` : '';
	const pere = parent(p.pere), mere = parent(p.mere);
	return (
		<div className="text-sm">
			{titre && <span className="text-xs font-semibold uppercase text-neutral-400">{titre} · </span>}
			<b>{p.nom} {p.prenom}</b>
			{p.sexe && <span className="text-neutral-500"> ({p.sexe})</span>}
			{p.age && <span className="text-neutral-500"> · {p.age}</span>}
			{p.date_naissance && <span className="text-neutral-500"> · né(e) {p.date_naissance}</span>}
			{p.origine && <span className="text-neutral-500"> · {p.origine}</span>}
			{(pere || mere) && (
				<div className="text-xs text-neutral-500">
					{pere && <>Père : {pere}</>}{pere && mere && ' — '}{mere && <>Mère : {mere}</>}
				</div>
			)}
			{(p.parrain || p.marraine) && (
				<div className="text-xs text-neutral-500">
					{p.parrain && <>Parrain : {p.parrain}</>}{p.parrain && p.marraine && ' — '}{p.marraine && <>Marraine : {p.marraine}</>}
				</div>
			)}
		</div>
	);
}

const ENCART_INTRO = (
	<Encart couleur="neutre">
		<b>Test</b> — interroge en direct la base de l'association Arbre
		(iledelareunion-archive.com) : état civil ancien de La Réunion, avec
		demande de photo d'acte sur leur site.
	</Encart>
);

const CARTE_RESULTATS_VIDE = (
	<Carte className="mt-4 hidden text-center text-sm text-neutral-500 md:mt-0 md:block">
		Les résultats s'afficheront ici — lance une recherche à gauche.
	</Carte>
);

export default function Idlr() {
	const [ref, setRef] = useState<IdlrRef | null>(null);
	const [perimetre, setPerimetre] = useState('');
	const [nom, setNom] = useState('');
	const [prenom, setPrenom] = useState('');
	const [mere, setMere] = useState('');
	const [type, setType] = useState('N');
	const [sexe, setSexe] = useState('T');
	const [mode, setMode] = useState('contient');
	const [anneeMin, setAnneeMin] = useState('');
	const [anneeMax, setAnneeMax] = useState('');
	const [phonex, setPhonex] = useState(false);
	const [envoi, setEnvoi] = useState(false);
	// résultats accumulés (le site livre 50 actes par requête, on affiche 12)
	const [actes, setActes] = useState<IdlrActe[]>([]);
	const [meta, setMeta] = useState<{ total: number; warnings: string[]; cached?: boolean } | null>(null);
	const [pageAff, setPageAff] = useState(1);
	// filtre local : refouille dans les résultats déjà chargés, sans requête
	const [filtre, setFiltre] = useState('');

	const TAILLE_PAGE = 12; // 4 colonnes × 3 lignes

	useEffect(() => {
		appel<IdlrRef>('idlrReferentiel', getIdentite()).then(setRef).catch(e => toast('Erreur : ' + (e as Error).message));
	}, []);

	const requete = (page: number) => {
		const [genre, valeur] = perimetre.split(':');
		return appel<IdlrRetour>('idlrRecherche', {
			[genre]: valeur, nom: nom.trim(), prenom: prenom.trim(), mere: mere.trim(),
			type, sexe, mode, anneeMin: anneeMin.trim(), anneeMax: anneeMax.trim(),
			phonex: phonex ? 1 : 0, page,
		}, getIdentite());
	};

	const chercher = async () => {
		if (!perimetre) { toast('Choisis un périmètre (commune ou secteur)'); return; }
		if (nom.trim().length < 2) { toast('Nom : 2 lettres minimum'); return; }
		setEnvoi(true);
		try {
			const r = await requete(1);
			setActes(r.results);
			setMeta({ total: r.total, warnings: r.warnings, cached: r.cached });
			setPageAff(1);
			setFiltre('');
			if (!r.results.length) toast('Aucun acte trouvé');
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	// rapatrie tout le résultat (par pages de 50) pour que le filtre local
	// fouille l'ensemble — plafonné à 1 000 actes (serveur associatif)
	const chargerTout = async () => {
		if (!meta) return;
		const plafond = Math.min(meta.total, 1000);
		setEnvoi(true);
		try {
			let tous = actes;
			while (tous.length < plafond) {
				const r = await requete(Math.floor(tous.length / 50) + 1);
				if (!r.results.length) break;
				tous = [...tous, ...r.results];
				setActes(tous);
			}
			if (meta.total > 1000) toast('Chargement plafonné à 1 000 actes — affine la recherche');
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	// change de page d'affichage ; recharge la page suivante du site (50 actes)
	// quand on dépasse ce qui est déjà chargé
	const aller = async (p: number) => {
		if (!meta || p < 1) return;
		const debut = (p - 1) * TAILLE_PAGE;
		const q = filtre.trim().toLowerCase();
		if (!q && debut >= actes.length && actes.length < meta.total) {
			setEnvoi(true);
			try {
				const r = await requete(Math.floor(actes.length / 50) + 1);
				if (!r.results.length) return;
				const tous = [...actes, ...r.results];
				setActes(tous);
				if (debut < tous.length) setPageAff(p);
			} catch (e) {
				toast('Erreur : ' + (e as Error).message);
			} finally {
				setEnvoi(false);
			}
		} else {
			setPageAff(p);
		}
	};

	// silhouette d'un Champ (libellé + input) pendant le chargement du référentiel
	const champFantome = (
		<div>
			<Squelette className="mb-2 h-3 w-24" />
			<Squelette className="h-[42px] rounded-[10px]" />
		</div>
	);
	if (!ref) return (
		<div className="mx-auto w-full max-w-lg space-y-4 md:mx-0 md:grid md:max-w-none md:grid-cols-[360px_minmax(0,1fr)] md:items-start md:gap-4 md:space-y-0">
			<div className="space-y-4">
				{ENCART_INTRO}
				<Carte>
					<TitreCarte>Recherche</TitreCarte>
					<div className="space-y-3">
						{champFantome}
						{[0, 1, 2, 3].map(i => (
							<div key={i} className="grid grid-cols-2 gap-3">{champFantome}{champFantome}</div>
						))}
						<Squelette className="h-4 w-56" />
						<Squelette className="h-[46px] rounded-xl" />
					</div>
				</Carte>
			</div>
			{CARTE_RESULTATS_VIDE}
		</div>
	);

	const q = filtre.trim().toLowerCase();
	const contenu = (x?: IdlrPersonne) => x
		? [x.nom, x.prenom, x.origine, x.parrain, x.marraine, x.pere?.nom, x.pere?.prenom, x.mere?.nom, x.mere?.prenom] : [];
	const visibles = actes.filter(a => !q ||
		[a.commune, a.date, a.numero, a.obs, ...contenu(a.personnes.principal), ...contenu(a.personnes.conjoint)]
			.filter(Boolean).join(' ').toLowerCase().includes(q));
	// sans filtre on pagine sur le total annoncé (les pages lointaines se chargent
	// à la volée) ; avec filtre, sur ce qui correspond dans le chargé
	const totalAff = q ? visibles.length : (meta?.total ?? 0);
	const pagesAff = Math.max(1, Math.ceil(totalAff / TAILLE_PAGE));
	const affiches = visibles.slice((pageAff - 1) * TAILLE_PAGE, pageAff * TAILLE_PAGE);

	return (
		// PC : recherche à gauche, grille de résultats à droite
		<div className="mx-auto w-full max-w-lg space-y-4 md:mx-0 md:grid md:max-w-none md:grid-cols-[360px_minmax(0,1fr)] md:items-start md:gap-4 md:space-y-0">
			<div className="space-y-4">
			{ENCART_INTRO}

			<Carte>
				<TitreCarte>Recherche</TitreCarte>
				<div className="space-y-3">
					<Champ label="Périmètre *">
						<select className={CLASSE_INPUT} value={perimetre} onChange={e => setPerimetre(e.target.value)}>
							<option value="">— Choisir —</option>
							<optgroup label="Secteurs">
								{ref.secteurs.map(s => <option key={s} value={`secteur:${s}`}>{s}</option>)}
							</optgroup>
							<optgroup label="Communes">
								{ref.communes.map(c => <option key={c} value={`commune:${c}`}>{c}</option>)}
							</optgroup>
						</select>
					</Champ>
					<div className="grid grid-cols-2 gap-3">
						<Champ label="Nom * (min. 2 lettres)">
							<input className={CLASSE_INPUT} value={nom} onChange={e => setNom(e.target.value)} />
						</Champ>
						<Champ label="Prénom">
							<input className={CLASSE_INPUT} value={prenom} onChange={e => setPrenom(e.target.value)} />
						</Champ>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<Champ label="Type d'acte">
							<select className={CLASSE_INPUT} value={type} onChange={e => setType(e.target.value)}>
								{Object.entries(ref.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
							</select>
						</Champ>
						<Champ label="Sexe">
							<select className={CLASSE_INPUT} value={sexe} onChange={e => setSexe(e.target.value)}>
								<option value="T">Tous</option>
								<option value="M">Masculin</option>
								<option value="F">Féminin</option>
							</select>
						</Champ>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<Champ label="Année min">
							<input className={CLASSE_INPUT} inputMode="numeric" value={anneeMin} onChange={e => setAnneeMin(e.target.value)} />
						</Champ>
						<Champ label="Année max">
							<input className={CLASSE_INPUT} inputMode="numeric" value={anneeMax} onChange={e => setAnneeMax(e.target.value)} />
						</Champ>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<Champ label="Nom de la mère">
							<input className={CLASSE_INPUT} value={mere} onChange={e => setMere(e.target.value)} />
						</Champ>
						<Champ label="Correspondance">
							<select className={CLASSE_INPUT} value={mode} onChange={e => setMode(e.target.value)}>
								<option value="contient">Contient</option>
								<option value="commence">Commence par</option>
								<option value="termine">Termine par</option>
								<option value="exact">Exact</option>
							</select>
						</Champ>
					</div>
					<label className="flex items-center gap-2 text-sm text-neutral-700">
						<input type="checkbox" className="h-4 w-4 accent-tampon" checked={phonex} onChange={e => setPhonex(e.target.checked)} />
						Orthographe approchante (phonétique)
					</label>
					<Btn variante="primaire" disabled={envoi} onClick={chercher}>
						<Search className="h-4 w-4" /> {envoi ? 'Recherche…' : 'Rechercher'}
					</Btn>
				</div>
			</Carte>
			</div>

			{meta ? (
				<div className="mt-4 min-w-0 space-y-4 md:mt-0">
					<Encart couleur={actes.length ? 'vert' : 'orange'}>
						<b>{meta.total}</b> acte(s) — {actes.length} chargé(s)
						{q && <> · {visibles.length} après filtre</>}
						{meta.cached && ' · (cache)'}
						{meta.warnings.length > 0 && (
							<div className="mt-1 text-xs">Avertissements : {meta.warnings.join(' · ')}</div>
						)}
					</Encart>

					{actes.length > 1 && (
						<div className="flex gap-2">
							<div className="relative min-w-0 flex-1">
								<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
								<input
									className={CLASSE_INPUT + ' bg-neutral-50 pl-10'}
									placeholder={`Refouiller dans les ${actes.length} actes chargés…`}
									value={filtre}
									onChange={e => { setFiltre(e.target.value); setPageAff(1); }}
								/>
							</div>
							{actes.length < meta.total && (
								<button
									type="button"
									disabled={envoi}
									onClick={chargerTout}
									className="shrink-0 rounded-[10px] bg-neutral-50 px-3 py-2 text-sm font-semibold text-tampon transition-colors active:bg-neutral-200 disabled:opacity-40"
									title="Charger tous les actes pour que le filtre fouille l'ensemble"
								>
									{envoi ? 'Chargement…' : `Tout charger (${Math.min(meta.total, 1000) - actes.length})`}
								</button>
							)}
						</div>
					)}

					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{affiches.map((a, i) => (
						<Carte key={i} className="p-4">
							<div className="mb-2">
								<div className="text-sm font-semibold text-tampon">
									{a.type_acte_libelle} · {a.date} · {a.commune}
								</div>
								{a.numero && <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400">{a.numero}</div>}
							</div>
							{a.personnes.principal && <Personne p={a.personnes.principal} />}
							{a.personnes.conjoint && (
								<div className="mt-2 border-t border-neutral-100 pt-2">
									<Personne p={a.personnes.conjoint} titre="Conjoint" />
								</div>
							)}
							{matricule(a.obs) && (
								<p className="mt-2 text-xs font-semibold text-neutral-700">Matricule n° {matricule(a.obs)}</p>
							)}
							{a.obs && <p className="mt-2 text-xs text-neutral-500">Obs : {a.obs}</p>}
							{a.url_demande_photo && (
								<a
									href={a.url_demande_photo} target="_blank" rel="noreferrer"
									className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-tampon underline-offset-2 hover:underline"
								>
									<ExternalLink className="h-3.5 w-3.5" /> Demander la photo (site Arbre)
								</a>
							)}
						</Carte>
					))}
					</div>

					{q && !visibles.length && (
						<p className="text-center text-sm text-neutral-500">Aucun résultat chargé ne correspond à « {filtre} ».</p>
					)}

					{pagesAff > 1 && (
						<div className="flex items-center justify-center gap-3">
							<button
								type="button"
								disabled={envoi || pageAff <= 1}
								onClick={() => aller(pageAff - 1)}
								className="rounded-full bg-neutral-50 px-4 py-2 text-sm font-semibold text-tampon transition-colors active:bg-neutral-200 disabled:opacity-40"
							>
								‹ Précédente
							</button>
							<span className="text-sm font-semibold text-neutral-600">
								page {pageAff} / {pagesAff}
							</span>
							<button
								type="button"
								disabled={envoi || pageAff >= pagesAff}
								onClick={() => aller(pageAff + 1)}
								className="rounded-full bg-neutral-50 px-4 py-2 text-sm font-semibold text-tampon transition-colors active:bg-neutral-200 disabled:opacity-40"
							>
								Suivante ›
							</button>
						</div>
					)}
				</div>
			) : (
				CARTE_RESULTATS_VIDE
			)}
		</div>
	);
}
