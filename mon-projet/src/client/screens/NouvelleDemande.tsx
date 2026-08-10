import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { appel, getIdentite, TYPES_ACTES } from '@/lib/gas';
import type { CoteResultat, RetourCreation } from '@/lib/gas';
import { BoutonPhoto, Btn, Carte, Champ, CLASSE_INPUT, Encart, TitreCarte, toast } from '@/components/ui/kit';
import { confirmer } from '@/components/ui/boite';
import { Segmente } from '@/components/ui/segmente';
import { Combobox } from '@/components/ui/combobox';
import { cn, estAnneeSeule, formaterDateSaisie } from '@/lib/utils';
import { compresserPhoto, fichierVersBase64 } from '@/lib/photo';

/** Création d'une demande — réservé à l'Admin (le backend le vérifie aussi). */
export default function NouvelleDemande({ onCreee }: { onCreee: (id: string) => void }) {
	const [communes, setCommunes] = useState<string[]>([]);
	const [destination, setDestination] = useState<'Archives' | 'Généalogie'>('Archives');
	const [typeActe, setTypeActe] = useState('');
	const [nom, setNom] = useState('');
	const [prenom, setPrenom] = useState('');
	const [nom2, setNom2] = useState('');
	const [prenom2, setPrenom2] = useState('');
	const [commune, setCommune] = useState('');
	const [annee, setAnnee] = useState('');
	const [dateActe, setDateActe] = useState('');
	const [demandeur, setDemandeur] = useState('');
	const [notes, setNotes] = useState('');
	const [numeroActe, setNumeroActe] = useState('');
	const [matricule, setMatricule] = useState('');
	const [cherchIdlr, setCherchIdlr] = useState(false);
	// pret = résultat arrivé (pas le placeholder « Calcul… ») : ses cotes sont
	// alors passées à creerDemande pour éviter un recalcul Base_Cotes serveur
	const [apercu, setApercu] = useState<{ classement: string; texte: string; ok: boolean; pret?: boolean; c4?: string; ce?: string } | null>(null);
	const [envoi, setEnvoi] = useState(false);
	const [dernieres, setDernieres] = useState<Array<{ id: string; nom: string }>>([]);
	// demande EDEPOT qui vient d'être créée : on réclame la preuve tout de suite
	const [preuveAttendue, setPreuveAttendue] = useState<{ id: string; nom: string } | null>(null);
	// acte déjà en main (photo/PDF) déposé dans le formulaire avant création
	const [fichier, setFichier] = useState<{ b64: string; mime: string; nom: string } | null>(null);

	useEffect(() => {
		appel<string[]>('listerCommunes', getIdentite()).then(setCommunes).catch(() => undefined);
	}, []);

	const an = parseInt(annee, 10);
	const avant1908 = !!an && an <= 1907;
	const estMariage = typeActe === 'Mariage' || typeActe === 'Publication de mariage';

	// champ unique : date complète (slashs automatiques) ou année seule.
	// L'année en est déduite (déclenche l'aperçu de la cote).
	const changerDate = (brut: string) => {
		const v = formaterDateSaisie(brut);
		setDateActe(v);
		const m = v.match(/(1[5-9]\d{2}|20\d{2})$/);
		setAnnee(m ? m[1] : '');
	};

	// aperçu du classement automatique dès que commune + année sont posées
	useEffect(() => {
		if (!commune || !an) { setApercu(null); return; }
		let annule = false;
		setApercu({ classement: '', texte: 'Calcul de la cote…', ok: true });
		appel<{ resultats: CoteResultat[] }>('rechercherCotes', commune, typeActe, annee, dateActe.trim(), getIdentite())
			.then(r => {
				if (annule) return;
				const reg = r.resultats.filter(x => !x.table);
				if (!reg.length) {
					setApercu({ classement: '', ok: false, pret: true, c4: '', ce: '', texte: `Aucune cote dans Base_Cotes pour ${commune} ${annee}${typeActe ? ` (${typeActe})` : ''} — la demande sera créée sans cote.` });
					return;
				}
				const c4 = reg.find(x => x.cote4E);
				const ce = reg.find(x => x.coteEDEPOT);
				if (c4 && ce) setApercu({ classement: 'Les deux', ok: true, pret: true, c4: c4.cote4E, ce: ce.coteEDEPOT, texte: `4E : ${c4.cote4E} + EDEPOT : ${ce.coteEDEPOT} → copie à demander sur place (bon), acte aussi consultable sur le site des ANOM.` });
				else if (c4) setApercu({ classement: 'Cote 4E (copie)', ok: true, pret: true, c4: c4.cote4E, ce: '', texte: `4E : ${c4.cote4E}` });
				else if (ce) setApercu({ classement: 'Cote EDEPOT (original)', ok: true, pret: true, c4: '', ce: ce.coteEDEPOT, texte: `EDEPOT : ${ce.coteEDEPOT} → consultable sur le site des ANOM, pas de demande sur place.` });
			})
			.catch(() => undefined);
		return () => { annule = true; };
	}, [commune, typeActe, annee, an, dateActe]);

	const creer = async (forcer = false) => {
		if (!typeActe || !nom.trim() || !commune) { toast('Champs obligatoires : type, nom, commune'); return; }
		if (fichier && !numeroActe.trim() && apercu?.classement !== 'Cote EDEPOT (original)') {
			toast("Le numéro d'acte est obligatoire quand l'acte est joint (il est inscrit dessus)"); return;
		}
		setEnvoi(true);
		try {
			// mariage : les deux noms/prénoms sont réunis par « et » (convention du suivi)
			const nomComplet = [nom.trim(), estMariage ? nom2.trim() : ''].filter(Boolean).join(' et ');
			const prenomComplet = [prenom.trim(), estMariage ? prenom2.trim() : ''].filter(Boolean).join(' et ');
			// les tables décennales ont leur propre logique serveur : pas de raccourci
			const apercuFiable = apercu?.pret && !typeActe.toLowerCase().includes('table');
			const r = await appel<RetourCreation>('creerDemande', {
				typeActe, nom: nomComplet, prenom: prenomComplet, commune,
				anneeActe: annee, dateActe: estAnneeSeule(dateActe) ? '' : dateActe.trim(), demandeur: demandeur.trim(),
				notes: notes.trim(), destination,
				numeroActe: numeroActe.trim(), matricule: matricule.trim(), forcer,
				...(apercuFiable ? { coteCalculee: true, classement: apercu.classement, cote4E: apercu.c4, coteEDEPOT: apercu.ce } : {}),
			}, getIdentite());
			if (!r.ok && r.doublon) {
				const x = r.doublon;
				if (await confirmer({
					titre: 'Doublon possible',
					message: `${x.id} — ${x.nom} ${x.prenom} (${x.commune}${x.anneeActe ? ' ' + x.anneeActe : ''}, statut « ${x.statut} »). Créer quand même ?`,
					ok: 'Créer quand même',
				})) {
					await creer(true);
				}
				return;
			}
			toast(`${r.id} créée — ${r.classement || 'sans cote'}`);
			setDernieres(l => [{ id: r.id, nom: nomComplet.toUpperCase() }, ...l].slice(0, 8));
			const edepotSeul = !!r.coteEDEPOT && !r.cote4E;
			// fichier déposé : preuve si EDEPOT seul, « Trouvée » si généalogie,
			// sinon la demande part en commande mairie (onglet Commandes)
			if (fichier) {
				try {
					if (edepotSeul) {
						await appel('ajouterPhoto', r.id, fichier.b64, true, getIdentite(), '', fichier.mime);
						toast(`Preuve EDEPOT enregistrée sur ${r.id}`);
					} else if (destination === 'Généalogie') {
						await appel('ajouterPhoto', r.id, fichier.b64, false, getIdentite(), numeroActe.trim(), fichier.mime);
						toast(`Acte joint à ${r.id} — demande « Trouvée »`);
					} else {
						await appel('ajouterPhoto', r.id, fichier.b64, false, getIdentite(), numeroActe.trim(), fichier.mime, true);
						const m = await appel<{ avertissement?: string }>('marquerMairie', r.id, true, getIdentite());
						toast(`${r.id} — acte joint, à commander en mairie (onglet Commandes)`);
						if (m.avertissement) toast(m.avertissement);
					}
				} catch (e) {
					toast(`Fichier non joint à ${r.id} : ` + (e as Error).message);
				}
				setFichier(null);
			}
			setPreuveAttendue(edepotSeul && !fichier ? { id: r.id, nom: nomComplet.toUpperCase() } : null);
			// on garde destination, type, commune et demandeur pour enchaîner la saisie en série
			setNom(''); setPrenom(''); setNom2(''); setPrenom2(''); setAnnee(''); setDateActe(''); setNotes(''); setNumeroActe(''); setMatricule('');
			setApercu(null);
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	// recherche auto du matricule sur IDLR à partir des champs saisis
	const chercherMatricule = async () => {
		if (!nom.trim()) { toast('Renseigne au moins le nom pour chercher sur IDLR'); return; }
		setCherchIdlr(true);
		try {
			const r = await appel<{ matricule: string; total: number; apercu?: { nom: string; prenom: string; date: string } }>(
				'chercherMatriculeIdlrCriteres', { nom: nom.trim(), prenom: prenom.trim(), typeActe, commune, anneeActe: annee }, getIdentite());
			if (r.matricule) {
				setMatricule(r.matricule);
				toast(`Matricule n° ${r.matricule} trouvé sur IDLR${r.apercu ? ` (${r.apercu.nom} ${r.apercu.prenom} · ${r.apercu.date})` : ''}`);
			} else {
				toast(r.total ? `Aucun matricule dans les ${r.total} résultat(s) IDLR` : 'Aucun résultat sur IDLR');
			}
		} catch (e) {
			toast('Erreur IDLR : ' + (e as Error).message);
		} finally {
			setCherchIdlr(false);
		}
	};

	const photoPreuve = async (b64: string, mime?: string) => {
		if (!preuveAttendue) return;
		await appel('ajouterPhoto', preuveAttendue.id, b64, true, getIdentite(), '', mime);
		toast(`Preuve enregistrée sur ${preuveAttendue.id}`);
		setPreuveAttendue(null);
	};

	// image compressée comme une photo, PDF transmis tel quel
	const chargerFichier = async (f: File) => {
		try {
			const estPdf = f.type === 'application/pdf';
			setFichier({
				b64: estPdf ? await fichierVersBase64(f) : await compresserPhoto(f),
				mime: estPdf ? 'application/pdf' : 'image/jpeg',
				nom: f.name || 'image collée',
			});
		} catch (e) {
			toast('Erreur : ' + ((e as Error).message || 'Fichier illisible'));
		}
	};

	// Ctrl+V : une image du presse-papier remplit la zone de dépôt (ou part en
	// preuve si l'encart EDEPOT la réclame juste après une création)
	useEffect(() => {
		const coller = (e: ClipboardEvent) => {
			const image = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))?.getAsFile();
			if (!image) return;
			e.preventDefault();
			if (preuveAttendue) {
				compresserPhoto(image).then(b64 => photoPreuve(b64, 'image/jpeg'))
					.catch(err => toast('Erreur : ' + (err as Error).message));
			} else {
				chargerFichier(image);
			}
		};
		window.addEventListener('paste', coller);
		return () => window.removeEventListener('paste', coller);
	});

	return (
		<div className="mx-auto w-full max-w-lg space-y-4">
			{preuveAttendue && (
				<Carte className="border-amber-500/30 bg-amber-500/10">
					<p className="mb-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
						{preuveAttendue.id} ({preuveAttendue.nom}) est classée <b>EDEPOT</b> : joins tout de
						suite la capture de l'acte (site des ANOM) en preuve — elle est obligatoire pour
						générer le formulaire EDEPOT.
						<span className="hidden md:inline"> Capture dans le presse-papier ? <b>Ctrl+V</b> la colle directement.</span>
					</p>
					<div className="space-y-2">
						<BoutonPhoto pdf libelle="Joindre la preuve (capture / PDF)" onPhoto={photoPreuve} />
						<Btn variante="blanc" onClick={() => setPreuveAttendue(null)}>Plus tard</Btn>
					</div>
				</Carte>
			)}

			<Carte>
				<TitreCarte>Destination</TitreCarte>
				<Segmente options={['Archives', 'Généalogie'] as const} valeur={destination} onChange={setDestination} />
				{destination === 'Généalogie' && (
					<Encart couleur="neutre" className="mt-3">
						Photo de vérification destinée à débloquer un arbre généalogique (pas de commande d'acte).
					</Encart>
				)}
			</Carte>

			<Carte>
				<TitreCarte>Acte recherché</TitreCarte>
				<div className="space-y-3">
					<Champ label="Type d'acte *">
						<select className={CLASSE_INPUT} value={typeActe} onChange={e => setTypeActe(e.target.value)}>
							<option value="">— Choisir —</option>
							{TYPES_ACTES.map(t => <option key={t}>{t}</option>)}
						</select>
					</Champ>
					<div className="grid grid-cols-2 gap-3">
						<Champ label={estMariage ? 'Nom (époux·se 1) *' : 'Nom *'}>
							<input className={CLASSE_INPUT} value={nom} onChange={e => setNom(e.target.value)} />
						</Champ>
						<Champ label={estMariage ? 'Prénom (époux·se 1)' : 'Prénom'}>
							<input className={CLASSE_INPUT} value={prenom} onChange={e => setPrenom(e.target.value)} />
						</Champ>
					</div>
					{estMariage && (
						<div className="grid grid-cols-2 gap-3">
							<Champ label="Nom (époux·se 2)">
								<input className={CLASSE_INPUT} value={nom2} onChange={e => setNom2(e.target.value)} />
							</Champ>
							<Champ label="Prénom (époux·se 2)">
								<input className={CLASSE_INPUT} value={prenom2} onChange={e => setPrenom2(e.target.value)} />
							</Champ>
						</div>
					)}
					<Champ label="Commune *">
						<Combobox valeur={commune} options={communes} onChange={setCommune} recherche="Taper pour filtrer…" />
					</Champ>
					<Champ label={({ Naissance: 'Date de naissance', Mariage: 'Date du mariage', 'Décès': 'Date du décès' } as Record<string, string>)[typeActe] || 'Date de l\'acte'}>
						<input className={CLASSE_INPUT} inputMode="numeric" value={dateActe} onChange={e => changerDate(e.target.value)} placeholder="jj/mm/aaaa — ou l'année seule" />
					</Champ>
					<Champ label="Demandeur (client)">
						<input className={CLASSE_INPUT} value={demandeur} onChange={e => setDemandeur(e.target.value)} />
					</Champ>
					<Champ label="Notes">
						<input className={CLASSE_INPUT} value={notes} onChange={e => setNotes(e.target.value)} />
					</Champ>
				</div>

				{(avant1908 || fichier) && (
					<div className="mt-3">
						<Champ label={fichier ? "N° d'acte * (inscrit sur l'acte joint)" : "N° d'acte (si déjà repéré sur le registre en ligne)"}>
							<input className={CLASSE_INPUT} inputMode="numeric" value={numeroActe} onChange={e => setNumeroActe(e.target.value.replace(/\D/g, ''))} />
						</Champ>
					</div>
				)}
				<div className="mt-3">
					<Champ label="Matricule (facultatif — relevé sur l'acte)">
						<div className="flex gap-2">
							<input className={CLASSE_INPUT} value={matricule} onChange={e => setMatricule(e.target.value)} placeholder="relevé sur l'acte, ou via IDLR" />
							<Btn variante="blanc" disabled={cherchIdlr} onClick={chercherMatricule} className="!w-auto shrink-0">
								<Search className="h-4 w-4" /> {cherchIdlr ? '…' : 'IDLR'}
							</Btn>
						</div>
					</Champ>
				</div>
				{apercu && (
					<Encart couleur={apercu.ok ? 'vert' : 'rouge'} className="mt-3">
						{apercu.classement && <b>Classement automatique : {apercu.classement}<br /></b>}
						{apercu.texte}
					</Encart>
				)}

				{/* acte déjà en main : vide → circuit archives normal ; rempli →
				    preuve EDEPOT, « Trouvée » (généalogie) ou commande mairie */}
				<label
					className={cn(
						'mt-3 block cursor-pointer rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors',
						fichier
							? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
							: 'border-neutral-300 bg-neutral-50 text-neutral-500 hover:bg-neutral-100',
					)}
					onDragOver={e => e.preventDefault()}
					onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) chargerFichier(f); }}
				>
					<input
						type="file"
						accept="image/*,application/pdf"
						className="hidden"
						onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) chargerFichier(f); }}
					/>
					{fichier ? (
						<>
							<b>{fichier.nom}</b> — {destination === 'Généalogie' ? 'la demande passera directement « Trouvée »'
								: apercu?.classement === 'Cote EDEPOT (original)' ? 'servira de preuve EDEPOT'
									: 'la demande partira en commande mairie'}
							<button
								type="button"
								className="ml-2 font-semibold text-red-600"
								onClick={e => { e.preventDefault(); setFichier(null); }}
							>
								Retirer
							</button>
						</>
					) : (
						<>
							Tu as déjà l'acte ? <b>Joindre la photo / le PDF</b>
							<span className="hidden md:inline"> — clic, glisser-déposer ou <b>Ctrl+V</b></span>
							<br /><span className="text-xs">Sinon, la demande part aux archives.</span>
						</>
					)}
				</label>
			</Carte>

			<Btn variante="vert" disabled={envoi} onClick={() => creer()}>
				{envoi ? 'Création…' : 'Créer la demande'}
			</Btn>

			{dernieres.length > 0 && (
				<Carte className="p-4">
					<TitreCarte>Créées à l'instant ({dernieres.length})</TitreCarte>
					<div className="space-y-1.5">
						{dernieres.map(x => (
							<button
								key={x.id}
								type="button"
								onClick={() => onCreee(x.id)}
								className="block w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-xs hover:bg-neutral-100"
							>
								<b>{x.id}</b> · {x.nom} <span className="text-neutral-400">— ouvrir la fiche</span>
							</button>
						))}
					</div>
				</Carte>
			)}
		</div>
	);
}
