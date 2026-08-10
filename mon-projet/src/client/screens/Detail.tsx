import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Ban, CameraOff, Copy, ExternalLink, FolderCog, Hourglass, Landmark, Link2, Lock, PauseCircle, Pencil, RotateCcw, CheckCircle2, Search, Trash2, Unlock, UserCheck } from 'lucide-react';
import { appel, getIdentite, TYPES_ACTES } from '@/lib/gas';
import type { CoteResultat, Demande, Profil, RetourAction, RetourPhoto } from '@/lib/gas';
import { miniatureDrive } from '@/lib/photo';
import { estAnneeSeule, formaterDateSaisie } from '@/lib/utils';
import {
	BadgeAffilie, BadgeDeblocage, BadgeGenea, BadgeStatut, BoutonPhoto, Btn, Carte, Champ,
	CLASSE_INPUT, Cote, Encart, Squelette, SqueletteLignes, TitreCarte, toast,
} from '@/components/ui/kit';
import { confirmer, demander } from '@/components/ui/boite';
import { Combobox } from '@/components/ui/combobox';
import { ficheConnue, prendreDemandeEnVol } from '@/lib/precharge';

export default function Detail({ id, profil, onOuvrirBon, onSupprimee }: {
	id: string;
	profil: Profil;
	onOuvrirBon: (idBon: string) => void;
	onSupprimee: () => void;
}) {
	const [d, setD] = useState<Demande | null>(null);
	const [rappelBon, setRappelBon] = useState('');
	const [classementOuvert, setClassementOuvert] = useState(false);
	const [ficheOuverte, setFicheOuverte] = useState(false);

	const charger = useCallback(async () => {
		// un getDemande lancé au survol de la carte est réutilisé tel quel
		try { setD(await (prendreDemandeEnVol(id) ?? appel<Demande>('getDemande', id, getIdentite()))); }
		catch (e) { toast('Erreur : ' + (e as Error).message); }
	}, [id]);

	// peinture immédiate avec la fiche déjà connue des listes (sans historique),
	// le serveur complète ensuite
	useEffect(() => { setD(ficheConnue(id) ?? null); charger(); }, [charger, id]);

	if (!d) return (
		<div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
			<Carte>
				<Squelette className="mb-4 h-6 w-44" />
				<SqueletteLignes n={4} />
			</Carte>
			<Carte>
				<SqueletteLignes n={3} />
			</Carte>
		</div>
	);

	const aRechercher = d.statut === 'À rechercher';
	// « Demandée » / « Non communicable » : copie à recevoir des archives
	const attenteCopie = d.statut === 'Demandée' || d.statut === 'Non communicable';
	// EDEPOT seul : la capture ANOM = preuve, la demande reste « À rechercher »
	// jusqu'au formulaire EDEPOT et à la réception des copies certifiées.
	const edepotSeul = !!d.coteEDEPOT && !d.cote4E;
	const photos = (d.photos || '').split('\n').filter(Boolean);

	const traiterRetour = (r: RetourAction) => {
		if (r.suiviErreur) toast('Suivi OCI non mis à jour : ' + r.suiviErreur);
		if (r.bonACloturer && r.idBon) setRappelBon(r.idBon);
	};

	const photoActe = async (b64: string, mime?: string) => {
		let numero = d.numeroActe;
		if (!numero) {
			const saisie = await demander({ titre: "Numéro de l'acte", message: 'Inscrit sur le registre — obligatoire pour classer la photo.', placeholder: 'ex : 128', ok: 'Valider' });
			numero = (saisie || '').replace(/\D/g, '');
			if (!numero) { toast("Photo annulée — le numéro d'acte est obligatoire"); return; }
		}
		const r = await appel<RetourPhoto>('ajouterPhoto', d.id, b64, false, getIdentite(), numero, mime);
		toast(r.statut === 'Trouvée' ? 'Acte trouvé — retiré de la liste à rechercher' : 'Photo enregistrée');
		traiterRetour(r);
		charger();
	};

	const photoPreuve = async (b64: string, mime?: string) => {
		await appel('ajouterPhoto', d.id, b64, true, getIdentite(), '', mime);
		toast('Preuve enregistrée');
		charger();
	};

	const supprimerPreuve = async () => {
		if (!await confirmer({ titre: 'Supprimer la preuve jointe ?', ok: 'Supprimer', danger: true })) return;
		await appel('definirPreuve', d.id, '', getIdentite());
		toast('Preuve supprimée');
		charger();
	};

	const trouveSansPhoto = async () => {
		const motif = await demander({
			titre: 'Trouvé sans photo',
			message: "Les archives confirment que l'acte existe mais la photo est impossible (ex : registre conservé à l'ANOM).",
			placeholder: 'Précision', ok: 'Confirmer',
		});
		if (motif === null) return;
		const r = await appel<RetourAction>('confirmerSansPhoto', d.id, motif || '', getIdentite());
		toast('Acte TROUVÉ (sans photo) — retiré de la liste à rechercher');
		traiterRetour(r);
		charger();
	};

	const marquerEnErreur = async () => {
		const motif = await demander({
			titre: 'Passer « En erreur »',
			message: "L'acte consulté ne correspond pas — précise le constat (date différente, autre personne, type erroné…).",
			placeholder: 'Constat', ok: 'En erreur', danger: true,
		});
		if (motif === null) return;
		const r = await appel<RetourAction>('changerStatut', d.id, 'En erreur',
			'Acte consulté mais non conforme : ' + (motif || 'sans précision') + ' — corriger les données', getIdentite());
		toast('Passée « En erreur »');
		traiterRetour(r);
		charger();
	};

	const marquerNonTrouve = async () => {
		if (!await confirmer({
			titre: 'Passer « Non trouvé » ?',
			message: "L'acte est absent du livret / des fonds malgré la recherche.",
			ok: 'Non trouvé',
		})) return;
		const r = await appel<RetourAction>('changerStatut', d.id, 'Non trouvé',
			'Acte absent malgré la recherche — vérifier commune/année', getIdentite());
		toast('Passée « Non trouvé »');
		traiterRetour(r);
		charger();
	};

	const marquerNonCommunicable = async () => {
		const motif = await demander({
			titre: 'Non communicable',
			message: "L'acte ne peut pas être consulté en salle : les archives font la copie et nous l'enverront.",
			placeholder: 'Précision (facultatif)', ok: 'Confirmer',
		});
		if (motif === null) return;
		const r = await appel<RetourAction>('marquerNonCommunicable', d.id, motif || '', getIdentite());
		toast('Passée « Non communicable » — photographier la copie à réception');
		traiterRetour(r);
		charger();
	};

	const reporter = async () => {
		if (!await confirmer({
			titre: "Reporter l'acte ?",
			message: "Le registre est déjà en consultation dans la salle — l'acte sort du bon et repartira dans un prochain dispatch.",
			ok: 'Reporter',
		})) return;
		const r = await appel<RetourAction>('reporterDemande', d.id, '', getIdentite());
		toast('Reportée — remise à rechercher pour une prochaine tournée');
		traiterRetour(r);
		charger();
	};

	const basculerMairie = async () => {
		const actif = d.mairie !== 'À commander';
		const r = await appel<{ avertissement?: string }>('marquerMairie', d.id, actif, getIdentite());
		toast(actif ? "À commander en mairie — le mail part de l'onglet Commandes" : 'Commande mairie annulée');
		if (r.avertissement) toast(r.avertissement);
		charger();
	};

	const majStatut = async (statut: string) => {
		await appel('changerStatut', d.id, statut, '', getIdentite());
		toast('Statut : ' + statut);
		charger();
	};

	const mettreEnStandBy = async () => {
		const note = await demander({
			titre: 'Mettre en stand by',
			message: 'Pourquoi la demande est mise de côté ? (pas de cote, décision du client en attente…)',
			placeholder: 'Motif', ok: 'Stand by',
		});
		if (note === null) return;
		await appel('changerStatut', d.id, 'Stand by', note.trim(), getIdentite());
		toast('Mise en stand by — hors de la liste à rechercher');
		charger();
	};

	const remettreARechercher = async () => {
		const note = await demander({
			titre: 'Remettre « À rechercher »',
			message: "Annotation : ce qui a été corrigé, ce qu'il faut vérifier.",
			placeholder: 'Annotation', ok: 'Remettre',
		});
		if (note === null) return;
		await appel('changerStatut', d.id, 'À rechercher', note.trim(), getIdentite());
		toast('Statut : À rechercher');
		charger();
	};

	const supprimer = async () => {
		if (!await confirmer({
			titre: `Supprimer ${d.id} ?`,
			message: `${d.nom} — la fiche et son historique sont retirés, le dossier photos Drive part à la corbeille (récupérable 30 jours), et la demande sort de son bon éventuel.`,
			ok: 'Supprimer définitivement', danger: true,
		})) return;
		await appel('supprimerDemande', d.id, getIdentite());
		toast(`${d.id} supprimée`);
		onSupprimee();
	};

	const copierLien = async (url: string) => {
		// presse-papiers indisponible dans l'iframe GAS sur certains navigateurs
		try { await navigator.clipboard.writeText(url); }
		catch {
			const ta = document.createElement('textarea');
			ta.value = url;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		}
		toast('Lien copié');
	};

	const basculerDestination = async () => {
		const cible = d.destination === 'Généalogie' ? 'Archives' : 'Généalogie';
		if (!await confirmer({
			titre: `Basculer en ${cible} ?`,
			message: cible === 'Archives'
				? "L'acte devient commandable : il entrera dans le dispatch des bons et les formulaires."
				: "L'acte repasse en généalogie : photo de vérification seulement, plus de commande.",
			ok: 'Basculer',
		})) return;
		await appel('changerDestination', d.id, cible, getIdentite());
		toast('Destination : ' + cible);
		charger();
	};

	const basculerAffilie = async () => {
		await appel('basculerAffilie', d.id, !d.affilieLe, getIdentite());
		toast(d.affilieLe ? 'Affiliation retirée' : 'Acte affilié — il sort du filtre Généalogie');
		charger();
	};

	const basculerDeblocage = async () => {
		await appel('basculerDeblocage', d.id, !d.deblocage, getIdentite());
		toast(d.deblocage ? 'Priorité déblocage retirée' : 'Priorité déblocage — il partira en tête du prochain dispatch');
		charger();
	};

	const joindrePreuve = async () => {
		const url = await demander({ titre: 'Joindre la preuve', message: 'Lien de la capture du site de recherche.', placeholder: 'https://…', ok: 'Joindre' });
		if (!url) return;
		await appel('definirPreuve', d.id, url.trim(), getIdentite());
		toast('Preuve jointe');
		charger();
	};

	return (
		<div className="space-y-4">
			{rappelBon && (
				<Carte className="border-emerald-500/30 bg-emerald-500/10">
					<p className="mb-3 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
						Toutes les cotes du bon {rappelBon} sont traitées — il peut être clôturé :
						les demandes trouvées passeront « Traitée » et le PDF officiel sera généré.
					</p>
					<Btn variante="vert" onClick={() => { setRappelBon(''); onOuvrirBon(rappelBon); }}>
						<CheckCircle2 className="h-4 w-4" /> Ouvrir le bon {rappelBon} pour le clôturer
					</Btn>
				</Carte>
			)}

			{/* deux colonnes indépendantes (PC) : fiche + photos + historique à
			    gauche, actions à droite — l'historique ne change plus de place et
			    aucune carte ne crée de trou (placement explicite, pas de rangée) */}
			<div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
			<Carte>
				<div className="flex items-start justify-between gap-2">
					<h1 className="font-display text-lg font-bold leading-snug text-neutral-900">{d.nom} {d.prenom}</h1>
					<span className="flex shrink-0 flex-wrap justify-end gap-1.5">
						{d.deblocage && <BadgeDeblocage />}
						{d.destination === 'Généalogie' && (d.affilieLe ? <BadgeAffilie /> : <BadgeGenea />)}
						<BadgeStatut statut={d.statut} />
					</span>
				</div>
				{/* la date utile : création tant qu'on cherche, sinon l'évènement du
				    statut (Traitée = clôture/envoi du bon) — le détail complet est
				    dans l'historique */}
				<div className="mt-1 text-xs text-neutral-500">
					{d.id} · {d.statut === 'À rechercher' ? `créée le ${d.dateCreation}` : `${d.statut} le ${d.derniereMAJ}`}
				</div>
				<p className="mt-3 text-sm text-neutral-800">
					<b>{d.typeActe}</b>
					{d.commune ? <> · {d.commune}</> : ' · commune à compléter'}
					{d.anneeActe && <> · {d.anneeActe}</>}
					{d.dateActe && <> ({d.dateActe})</>}
				</p>
				{d.avant1908 === 'Oui' && <p className="mt-1 text-xs font-semibold text-emerald-700">≤ 1907 — images des registres disponibles</p>}
				{d.avant1908 === 'Non' && <p className="mt-1 text-xs font-semibold text-amber-700">&gt; 1907 — registres non numérisés</p>}
				{d.remiseLe && d.statut === 'À rechercher' && (
					<p className="mt-1 text-xs font-semibold text-amber-700">Remise à rechercher le {d.remiseLe}</p>
				)}
				{d.mairie === 'À commander' && (
					<p className="mt-1 text-xs font-semibold text-orange-700">Commande mairie : mail à envoyer (onglet Commandes)</p>
				)}
				{d.mairie?.startsWith('Envoyée') && (
					<p className="mt-1 text-xs font-semibold text-violet-700">Commande mairie {d.mairie.toLowerCase()}</p>
				)}
				{d.numeroActe && <p className="mt-2 text-xs font-semibold text-neutral-700">Acte n° {d.numeroActe}</p>}
				{profil.peutModifier
					? <MatriculeInline demande={d} onFait={charger} />
					: d.matricule && <p className="mt-1 text-xs font-semibold text-neutral-700">Matricule n° {d.matricule}</p>}
				{d.demandeur && <p className="mt-2 text-xs text-neutral-600">Demandeur : {d.demandeur}</p>}
				{d.bon && (
					<button type="button" onClick={() => onOuvrirBon(d.bon)}
						className="mt-1 text-xs font-semibold text-tampon underline-offset-2 hover:underline">
						Bon de commande : {d.bon}
					</button>
				)}
				{(d.checkeLe || d.notaireLe || d.apostilleLe) && (
					<p className="mt-2 text-xs font-semibold text-neutral-700">
						Apostille : {[d.checkeLe && `checké le ${d.checkeLe}`, d.notaireLe && `notaire le ${d.notaireLe}`,
							d.apostilleLe && `apostillé le ${d.apostilleLe}`].filter(Boolean).join(' · ')}
					</p>
				)}
				{/* la note en évidence : c'est elle que l'agent doit voir sur place */}
				{d.notes && (
					<Encart couleur="orange" className="mt-3 text-sm font-semibold">
						Note : {d.notes}
					</Encart>
				)}

				{d.classement ? (
					<Encart couleur="vert" className="mt-3">
						<b>{d.classement}</b>
						<div className="mt-1.5 flex flex-wrap gap-1.5">
							{d.cote4E && <Cote type="4E" valeur={d.cote4E} />}
							{d.coteEDEPOT && <Cote type="EDEPOT" valeur={d.coteEDEPOT} />}
						</div>
						{edepotSeul && <><br /><i>EDEPOT seul → demande par le formulaire officiel (onglet Commandes), pas sur place.</i></>}
						{d.coteEDEPOT && d.cote4E && <><br /><i>Copie 4E à demander sur place — l'acte reste consultable sur le site des ANOM.</i></>}
					</Encart>
				) : (
					<Encart couleur="rouge" className="mt-3">Aucune cote — compléter commune/année ou corriger le classement.</Encart>
				)}
				{d.preuve && (
					<Encart couleur="orange" className="mt-3">
						<div className="flex items-center justify-between gap-2">
							<a href={d.preuve} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
								<ExternalLink className="h-3.5 w-3.5" /> Preuve : ouvrir la capture
							</a>
							{profil.peutModifier && (
								<button type="button" onClick={supprimerPreuve}
									className="shrink-0 rounded-md border border-amber-500/40 bg-neutral-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10">
									<Trash2 className="inline h-3.5 w-3.5" /> Supprimer
								</button>
							)}
						</div>
					</Encart>
				)}
			</Carte>

			<Carte className="md:col-start-2 md:row-start-1 md:row-span-2">
				<TitreCarte>Actions</TitreCarte>
				<div className="space-y-2.5">
					{aRechercher && !d.bon && !edepotSeul && (
						<>
							<Encart couleur="neutre">
								Pas encore dispatchée : la photo se prend <b>aux archives</b>, une fois la
								demande mise dans un bon de commande et le registre consulté.
							</Encart>
							{profil.peutModifier && (
								<BoutonPhoto pdf variante="blanc" libelle="J'ai déjà l'acte (photo / PDF) — l'ajouter" onPhoto={photoActe} />
							)}
						</>
					)}
					{aRechercher && !d.bon && edepotSeul && (
						<Encart couleur="vert">
							Cote EDEPOT seule : repère l'acte sur le <b>site des ANOM</b> et joins la capture
							en <b>preuve</b> — la demande reste « À rechercher » jusqu'au formulaire
							EDEPOT (onglet Commandes) et à la réception des copies certifiées.
						</Encart>
					)}
					{aRechercher && !d.bon && profil.estAdmin && (
						<Btn variante="blanc" onClick={basculerMairie}>
							<Landmark className="h-4 w-4" />
							{d.mairie === 'À commander' ? 'Annuler la commande mairie' : "Commander en mairie (registre absent des archives)"}
						</Btn>
					)}
					{aRechercher && (d.bon || edepotSeul) && (
						<>
							{edepotSeul ? (
								d.preuve
									? <BoutonPhoto pdf libelle="Copie reçue des archives — photographier" onPhoto={photoActe} />
									: null
							) : (
								<BoutonPhoto libelle="Acte trouvé — photographier" onPhoto={photoActe} />
							)}
							<Btn variante="blanc" onClick={trouveSansPhoto}>
								<CameraOff className="h-4 w-4" /> Trouvé mais photo impossible (ANOM…)
							</Btn>
							<Btn variante="rouge" onClick={marquerEnErreur}>
								<AlertTriangle className="h-4 w-4" /> En erreur (acte différent, dates ≠…)
							</Btn>
							<Btn variante="gris" onClick={marquerNonTrouve}>
								<Ban className="h-4 w-4" /> Non trouvé (absent du livret)
							</Btn>
							{d.bon && (
								<Btn variante="blanc" onClick={marquerNonCommunicable}>
									<Lock className="h-4 w-4" /> Non communicable (copie envoyée par les archives)
								</Btn>
							)}
						</>
					)}
					{!aRechercher && d.statut !== 'Traitée' && (
						<BoutonPhoto
							pdf
							libelle={attenteCopie ? 'Copie reçue des archives — photographier' : 'Ajouter une photo'}
							variante={attenteCopie ? 'vert' : 'blanc'}
							onPhoto={photoActe}
						/>
					)}
					{d.statut === 'Demandée' && (
						<Encart couleur="neutre">
							Formulaire EDEPOT envoyé aux archives — photographie les copies certifiées
							à leur réception pour passer la demande « Trouvée ».
						</Encart>
					)}
					{d.statut === 'Non communicable' && (
						<Encart couleur="neutre">
							Acte non communicable en salle — les archives font la copie et l'envoient.
							Photographie-la à réception : la demande passera « Trouvée ».
						</Encart>
					)}
					{d.statut === 'Stand by' && (
						<Encart couleur="neutre">
							En stand by — mise de côté (voir l'historique pour le motif). Remets-la
							« À rechercher » quand elle peut repartir dans un bon.
						</Encart>
					)}
					{profil.peutModifier && aRechercher && (
						<div className="space-y-2 rounded-xl border border-neutral-200 p-2">
							<p className="px-1 text-[11px] font-medium text-neutral-500">Mettre de côté</p>
							{d.bon && (
								<Btn variante="blanc" onClick={reporter}>
									<Hourglass className="h-4 w-4" /> Registre déjà en consultation — reporter
								</Btn>
							)}
							<Btn variante="blanc" onClick={mettreEnStandBy}>
								<PauseCircle className="h-4 w-4" /> Mettre en stand by (pas de cote, à décider…)
							</Btn>
						</div>
					)}
					{d.coteEDEPOT && !d.preuve && (
						<>
							{profil.peutModifier && (
								<Btn variante="blanc" onClick={joindrePreuve}>
									<Link2 className="h-4 w-4" /> Joindre la preuve (lien)
								</Btn>
							)}
							<BoutonPhoto pdf libelle="Joindre la preuve (capture / PDF)" variante="blanc" onPhoto={photoPreuve} />
						</>
					)}
					{profil.estAdmin && aRechercher && (
						<Btn variante="blanc" onClick={basculerDeblocage}>
							<Unlock className="h-4 w-4 text-rose-600" />
							{d.deblocage ? 'Retirer la priorité déblocage' : 'Priorité déblocage (un dossier attend cet acte)'}
						</Btn>
					)}
					{profil.peutModifier && d.destination === 'Généalogie' && (
						<Btn variante={d.affilieLe ? 'blanc' : 'vert'} onClick={basculerAffilie}>
							<UserCheck className="h-4 w-4" />
							{d.affilieLe ? `Affilié le ${d.affilieLe} — retirer` : 'Marquer affilié (dossier client traité)'}
						</Btn>
					)}
					{profil.estAdmin && (
						<Btn variante="blanc" onClick={basculerDestination}>
							<ArrowLeftRight className="h-4 w-4" />
							{d.destination === 'Généalogie' ? 'Basculer en Archives (acte à commander)' : 'Basculer en Généalogie'}
						</Btn>
					)}
					{profil.peutModifier && (
						<Btn variante="blanc" onClick={() => setFicheOuverte(o => !o)}>
							<Pencil className="h-4 w-4" /> Modifier la fiche (nom, commune, année…)
						</Btn>
					)}
					{ficheOuverte && <BlocFiche demande={d} onFait={() => { setFicheOuverte(false); charger(); }} />}
					{profil.peutModifier && (
						<Btn variante="blanc" onClick={() => setClassementOuvert(o => !o)}>
							<FolderCog className="h-4 w-4" /> Corriger le classement / les cotes
						</Btn>
					)}
					{classementOuvert && <BlocClassement demande={d} onFait={() => { setClassementOuvert(false); charger(); }} />}
					{profil.peutModifier && d.statut === 'Trouvée' && !d.bon && (
						<Btn variante="bleu" onClick={() => majStatut('Traitée')}>
							<CheckCircle2 className="h-4 w-4" /> Clôturer (Traitée)
						</Btn>
					)}
					{profil.peutModifier && (d.statut === 'En erreur' || d.statut === 'Non trouvé' || d.statut === 'Stand by' || attenteCopie) && (
						<Btn variante="blanc" onClick={remettreARechercher}>
							<RotateCcw className="h-4 w-4" />
							{attenteCopie ? 'Annuler (remettre à rechercher)'
								: d.statut === 'Stand by' ? 'Reprendre (remettre à rechercher)'
									: 'Remettre à rechercher (données corrigées)'}
						</Btn>
					)}
					{profil.estAdmin && (
						<Btn variante="rouge" onClick={supprimer}>
							<Trash2 className="h-4 w-4" /> Supprimer la demande (définitif)
						</Btn>
					)}
				</div>
			</Carte>

			<div className="space-y-4 md:col-start-1 md:row-start-2">
			{photos.length > 0 && (
				<Carte>
					<TitreCarte>Photos de l'acte ({photos.length})</TitreCarte>
					<div className="flex flex-wrap gap-2">
						{photos.map(u => (
							<div key={u} className="relative">
								<a href={u} target="_blank" rel="noreferrer">
									<img
										src={miniatureDrive(u)}
										loading="lazy"
										alt="Photo de l'acte"
										className="h-20 w-20 rounded-xl object-cover outline -outline-offset-1 outline-black/10"
										onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }}
									/>
								</a>
								<button
									type="button"
									aria-label="Copier le lien de la photo"
									onClick={() => copierLien(u)}
									className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-50 p-1.5 shadow-md outline -outline-offset-1 outline-black/10 active:bg-neutral-100"
								>
									<Copy className="h-3.5 w-3.5 text-neutral-600" />
								</button>
							</div>
						))}
					</div>
					<p className="mt-2 text-xs text-neutral-400">Appuyer sur une photo pour l'ouvrir en grand.</p>
				</Carte>
			)}

			<Carte>
				<TitreCarte>Historique</TitreCarte>
				{!d.historique ? (
					<SqueletteLignes />
				) : d.historique.length > 0 ? (
					<ol>
						{d.historique.slice().reverse().map((h, i, arr) => (
							<li key={i} className="flex gap-3">
								<div className="flex flex-col items-center">
									<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-300" />
									{i < arr.length - 1 && <span className="w-px flex-1 bg-neutral-200" />}
								</div>
								<div className="min-w-0 pb-4">
									<div className="text-[11px] text-neutral-400">{h.date} · {h.agent}</div>
									<div className="text-sm font-semibold text-neutral-800">{h.statut}</div>
									{h.detail && <div className="text-xs text-neutral-600">{h.detail}</div>}
								</div>
							</li>
						))}
					</ol>
				) : (
					<p className="text-sm text-neutral-500">Aucun évènement.</p>
				)}
			</Carte>
			</div>
			</div>
		</div>
	);
}

/* --------- Matricule inline sur la fiche (saisie + recherche IDLR) ------- */

function MatriculeInline({ demande: d, onFait }: { demande: Demande; onFait: () => void }) {
	const [matricule, setMatricule] = useState(d.matricule);
	const [cherche, setCherche] = useState(false);
	const [envoi, setEnvoi] = useState(false);
	const modifie = matricule.trim() !== (d.matricule || '');

	const chercher = async () => {
		setCherche(true);
		try {
			const r = await appel<{ matricule: string; total: number; apercu?: { nom: string; prenom: string; date: string } }>('chercherMatriculeIdlr', d.id, getIdentite());
			if (r.matricule) {
				setMatricule(r.matricule);
				toast(`Matricule n° ${r.matricule} trouvé sur IDLR${r.apercu ? ` (${r.apercu.nom} ${r.apercu.prenom} · ${r.apercu.date})` : ''} — clique OK pour enregistrer`);
			} else {
				toast(r.total ? `Aucun matricule dans les ${r.total} résultat(s) IDLR` : 'Aucun résultat sur IDLR');
			}
		} catch (e) {
			toast('Erreur IDLR : ' + (e as Error).message);
		} finally {
			setCherche(false);
		}
	};

	const enregistrer = async () => {
		setEnvoi(true);
		try {
			await appel('modifierDemande', d.id, { matricule: matricule.trim() }, getIdentite());
			toast('Matricule enregistré');
			onFait();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	return (
		<div className="mt-3">
			<p className="mb-1 text-xs font-medium text-neutral-500">Matricule (facultatif)</p>
			<div className="flex gap-2">
				<input className={CLASSE_INPUT} value={matricule} onChange={e => setMatricule(e.target.value)} placeholder="relevé sur l'acte, ou via IDLR" />
				<Btn variante="blanc" disabled={cherche} onClick={chercher} className="!w-auto shrink-0">
					<Search className="h-4 w-4" /> {cherche ? '…' : 'IDLR'}
				</Btn>
				{modifie && (
					<Btn variante="vert" disabled={envoi} onClick={enregistrer} className="!w-auto shrink-0">
						{envoi ? '…' : 'OK'}
					</Btn>
				)}
			</div>
		</div>
	);
}

/* ---------------------- Bloc de modification de fiche ------------------ */

function BlocFiche({ demande: d, onFait }: { demande: Demande; onFait: () => void }) {
	const [typeActe, setTypeActe] = useState(d.typeActe);
	const [nom, setNom] = useState(d.nom);
	const [prenom, setPrenom] = useState(d.prenom);
	const [commune, setCommune] = useState(d.commune);
	// champ unique : date complète ou année seule
	const [dateActe, setDateActe] = useState(d.dateActe || d.anneeActe);
	const [demandeur, setDemandeur] = useState(d.demandeur);
	const [notes, setNotes] = useState(d.notes);
	const [numeroActe, setNumeroActe] = useState(d.numeroActe);
	const [communes, setCommunes] = useState<string[]>([]);
	const [envoi, setEnvoi] = useState(false);
	// aperçu de la cote recalculée en direct quand commune/type/année changent
	const [apercu, setApercu] = useState<{ classement: string; texte: string; ok: boolean } | null>(null);
	const anneeApercu = (dateActe.match(/(1[5-9]\d{2}|20\d{2})$/) || [])[1] || '';

	useEffect(() => {
		appel<string[]>('listerCommunes', getIdentite()).then(setCommunes).catch(() => undefined);
	}, []);

	useEffect(() => {
		if (!commune || !anneeApercu) { setApercu(null); return; }
		let annule = false;
		setApercu({ classement: '', texte: 'Calcul de la cote…', ok: true });
		appel<{ resultats: CoteResultat[] }>('rechercherCotes', commune, typeActe, anneeApercu, estAnneeSeule(dateActe) ? '' : dateActe.trim(), getIdentite())
			.then(r => {
				if (annule) return;
				const reg = r.resultats.filter(x => !x.table);
				if (!reg.length) { setApercu({ classement: '', ok: false, texte: `Aucune cote dans Base_Cotes pour ${commune} ${anneeApercu}${typeActe ? ` (${typeActe})` : ''}.` }); return; }
				const c4 = reg.find(x => x.cote4E);
				const ce = reg.find(x => x.coteEDEPOT);
				if (c4 && ce) setApercu({ classement: 'Les deux', ok: true, texte: `4E : ${c4.cote4E} + EDEPOT : ${ce.coteEDEPOT}` });
				else if (c4) setApercu({ classement: 'Cote 4E (copie)', ok: true, texte: `4E : ${c4.cote4E}` });
				else if (ce) setApercu({ classement: 'Cote EDEPOT (original)', ok: true, texte: `EDEPOT : ${ce.coteEDEPOT}` });
			})
			.catch(() => undefined);
		return () => { annule = true; };
	}, [commune, typeActe, dateActe, anneeApercu]);

	const valider = async () => {
		if (!typeActe || !nom.trim()) { toast('Champs obligatoires : type, nom'); return; }
		setEnvoi(true);
		try {
			const m = dateActe.match(/(1[5-9]\d{2}|20\d{2})$/);
			const annee = m ? m[1] : '';
			await appel('modifierDemande', d.id, {
				typeActe, nom: nom.trim(), prenom: prenom.trim(), commune,
				anneeActe: annee, dateActe: estAnneeSeule(dateActe) ? '' : dateActe.trim(),
				demandeur: demandeur.trim(), notes: notes.trim(),
				numeroActe: numeroActe.trim(),
			}, getIdentite());
			toast('Fiche modifiée' + (commune !== d.commune || annee !== d.anneeActe || typeActe !== d.typeActe ? ' — cotes recalculées' : ''));
			onFait();
		} catch (e) {
			toast('Erreur : ' + (e as Error).message);
		} finally {
			setEnvoi(false);
		}
	};

	return (
		<div className="space-y-3 rounded-xl bg-neutral-50 p-4">
			<Champ label="Type d'acte *">
				<select className={CLASSE_INPUT} value={typeActe} onChange={e => setTypeActe(e.target.value)}>
					{!TYPES_ACTES.includes(typeActe) && typeActe && <option>{typeActe}</option>}
					{TYPES_ACTES.map(t => <option key={t}>{t}</option>)}
				</select>
			</Champ>
			<div className="grid grid-cols-2 gap-3">
				<Champ label="Nom *">
					<input className={CLASSE_INPUT} value={nom} onChange={e => setNom(e.target.value)} />
				</Champ>
				<Champ label="Prénom">
					<input className={CLASSE_INPUT} value={prenom} onChange={e => setPrenom(e.target.value)} />
				</Champ>
			</div>
			<Champ label="Commune">
				<Combobox
					valeur={commune}
					options={!communes.includes(commune) && commune ? [commune, ...communes] : communes}
					onChange={setCommune}
					recherche="Taper pour filtrer…"
				/>
			</Champ>
			<Champ label="Date de l'acte">
				<input className={CLASSE_INPUT} inputMode="numeric" value={dateActe} onChange={e => setDateActe(formaterDateSaisie(e.target.value))} placeholder="jj/mm/aaaa — ou l'année seule" />
			</Champ>
			<Champ label="Demandeur">
				<input className={CLASSE_INPUT} value={demandeur} onChange={e => setDemandeur(e.target.value)} />
			</Champ>
			<Champ label="Notes">
				<input className={CLASSE_INPUT} value={notes} onChange={e => setNotes(e.target.value)} />
			</Champ>
			<Champ label="N° d'acte (repéré sur le registre)">
				<input className={CLASSE_INPUT} inputMode="numeric" value={numeroActe} onChange={e => setNumeroActe(e.target.value.replace(/\D/g, ''))} />
			</Champ>
			{apercu ? (
				<Encart couleur={apercu.ok ? 'vert' : 'rouge'} className="mt-1">
					{apercu.classement && <b>Cote recalculée : {apercu.classement}<br /></b>}
					{apercu.texte}
				</Encart>
			) : (
				<p className="text-xs text-neutral-500">
					Si le type, la commune ou l'année changent, le classement et les cotes sont recalculés automatiquement à l'enregistrement.
				</p>
			)}
			<Btn variante="vert" disabled={envoi} onClick={valider}>{envoi ? 'Enregistrement…' : 'Enregistrer la fiche'}</Btn>
		</div>
	);
}

/* ------------------- Bloc de correction du classement ------------------ */

const CLASSEMENTS = ['Cote 4E (copie)', 'Cote EDEPOT (original)', 'Les deux', 'Erreur (non trouvé)'];

function BlocClassement({ demande: d, onFait }: { demande: Demande; onFait: () => void }) {
	const [classement, setClassement] = useState(d.classement || 'Cote 4E (copie)');
	const [c4, setC4] = useState(d.cote4E);
	const [ce, setCe] = useState(d.coteEDEPOT);
	const [commentaire, setCommentaire] = useState('');
	const [suggestions, setSuggestions] = useState<CoteResultat[]>([]);

	useEffect(() => {
		if (!d.commune || !d.anneeActe) return;
		appel<{ resultats: CoteResultat[] }>('rechercherCotes', d.commune, d.typeActe, d.anneeActe, d.dateActe, getIdentite())
			.then(r => setSuggestions(r.resultats.slice(0, 8)))
			.catch(() => undefined);
	}, [d.commune, d.typeActe, d.anneeActe, d.dateActe]);

	const montre4E = classement === 'Cote 4E (copie)' || classement === 'Les deux';
	const montreED = classement === 'Cote EDEPOT (original)' || classement === 'Les deux';

	const valider = async () => {
		if (montre4E && !c4) { toast('Indiquez la cote 4E'); return; }
		if (montreED && !ce) { toast('Indiquez la cote EDEPOT'); return; }
		try {
			await appel('classerDemande', d.id, classement, c4.trim(), ce.trim(), commentaire.trim(), getIdentite());
			toast('Classement mis à jour');
			onFait();
		} catch (e) { toast('Erreur : ' + (e as Error).message); }
	};

	return (
		<div className="space-y-3 rounded-xl bg-neutral-50 p-4">
			<Champ label="Classement">
				<select className={CLASSE_INPUT} value={classement} onChange={e => setClassement(e.target.value)}>
					{CLASSEMENTS.map(c => <option key={c}>{c}</option>)}
				</select>
			</Champ>
			{montre4E && (
				<Champ label="Cote 4E">
					<input className={CLASSE_INPUT} value={c4} onChange={e => setC4(e.target.value)} placeholder="ex : 4E2/521" />
				</Champ>
			)}
			{montreED && (
				<Champ label="Cote EDEPOT">
					<input className={CLASSE_INPUT} value={ce} onChange={e => setCe(e.target.value)} placeholder="ex : EDEPOT8/402" />
				</Champ>
			)}
			<Champ label="Commentaire">
				<input className={CLASSE_INPUT} value={commentaire} onChange={e => setCommentaire(e.target.value)} />
			</Champ>
			{suggestions.length > 0 && (
				<div>
					<div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
						Suggestions (appuyer pour remplir)
					</div>
					<div className="flex flex-wrap gap-2">
						{suggestions.map((s, i) => (
							<button
								key={i}
								type="button"
								onClick={() => {
									if (s.cote4E) setC4(s.cote4E);
									if (s.coteEDEPOT) setCe(s.coteEDEPOT);
									setClassement(s.cote4E && s.coteEDEPOT ? 'Les deux' : s.coteEDEPOT ? 'Cote EDEPOT (original)' : 'Cote 4E (copie)');
								}}
								className="rounded-[10px] bg-neutral-100 px-3 py-1.5 text-left text-xs active:bg-neutral-200"
							>
								<b>{s.intitule || s.types}</b> {s.anneeDebut}{s.anneeFin && s.anneeFin !== s.anneeDebut ? `-${s.anneeFin}` : ''}{s.table ? ' (table)' : ''}
								<br />
								{s.cote4E && <span className="text-emerald-700">4E : {s.cote4E} </span>}
								{s.coteEDEPOT && <span className="text-amber-700">EDEPOT : {s.coteEDEPOT}</span>}
							</button>
						))}
					</div>
				</div>
			)}
			<Btn variante="vert" onClick={valider}>Valider</Btn>
		</div>
	);
}
