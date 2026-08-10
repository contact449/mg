import { AlertTriangle, Ban, Camera, Hourglass, Lock } from 'lucide-react';
import { BadgeStatut, Carte, TitreCarte } from '@/components/ui/kit';
import type { Statut } from '@/lib/gas';

/** Puce icône alignée dans le texte du guide. */
function Ic({ icone: Icone }: { icone: typeof Camera }) {
	return <Icone className="inline h-3.5 w-3.5 align-[-2px]" />;
}

const STATUTS_GUIDE: Array<{ statut: Statut; texte: string }> = [
	{ statut: 'À rechercher', texte: "l'acte est à récupérer aux archives." },
	{ statut: 'Trouvée', texte: 'photographié : il sort définitivement de la liste à rechercher.' },
	{ statut: 'En erreur', texte: "un acte a été consulté mais ne correspond pas (date, personne, type…) : corriger les données puis « remettre à rechercher »." },
	{ statut: 'Non trouvé', texte: 'absent du livret / des fonds malgré la recherche.' },
	{ statut: 'Non communicable', texte: "pas consultable en salle : les archives font la copie et l'envoient, photo à joindre à réception." },
	{ statut: 'Stand by', texte: 'mise de côté (pas de cote, décision en attente…) : hors dispatch jusqu\'à sa remise « À rechercher ».' },
	{ statut: 'Traitée', texte: "dossier clôturé par l'admin." },
];

export default function Guide() {
	return (
		// deux colonnes explicites sur PC : pas de trous entre cartes de hauteurs inégales
		<div className="space-y-4 text-sm leading-relaxed text-neutral-700 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
			<div className="space-y-4">
			<Carte>
				<TitreCarte>Le circuit d'un acte</TitreCarte>
				<ol className="list-decimal space-y-2 pl-5">
					<li><b>L'admin crée la demande</b> — le classement (cote 4E / EDEPOT) est calculé automatiquement à partir de la commune et de l'année.</li>
					<li><b>L'admin crée un bon de commande</b> — il affecte jusqu'à <b>5 cotes par personne et par demi-journée</b> à un agent.</li>
					<li><b>L'agent va aux archives</b> — il retrouve ses actes dans « Mes actes » et consulte les registres sur place.</li>
					<li><b>Sur place</b> — pour chaque acte : <Ic icone={Camera} /> photo si trouvé, <Ic icone={AlertTriangle} /> « En erreur » si l'acte ne correspond pas, <Ic icone={Ban} /> « Non trouvé » s'il est absent, <Ic icone={Lock} /> « Non communicable » si la salle ne le communique pas, <Ic icone={Hourglass} /> « Reporter » si le registre est déjà en consultation.</li>
					<li><b>Fin de tournée</b> — quand tout est traité, on <b>clôture le bon</b> : les demandes trouvées passent « Traitée » et le <b>PDF officiel du bon</b> est généré automatiquement (relié au suivi), <b>à envoyer par mail aux archives</b> — plus de bon papier.</li>
				</ol>
			</Carte>

			<Carte>
				<TitreCarte>La règle du 31/12/1907</TitreCarte>
				<p>
					<b>Acte ≤ 1907</b> : les images des registres existent en ligne — la recherche peut se
					préparer en amont (le n° d'acte peut être saisi dès la création).<br />
					<b>Acte &gt; 1907</b> : registres non numérisés — recherche sur place.
				</p>
			</Carte>
			</div>

			<div className="space-y-4">
			<Carte>
				<TitreCarte>Les statuts</TitreCarte>
				<ul className="space-y-2.5">
					{STATUTS_GUIDE.map(s => (
						<li key={s.statut} className="flex items-start gap-2">
							<BadgeStatut statut={s.statut} />
							<span>{s.texte}</span>
						</li>
					))}
				</ul>
			</Carte>

			<Carte>
				<TitreCarte>Les cotes</TitreCarte>
				<p>
					<b className="text-emerald-700">4E</b> = copie communicable → commande sur place via un bon.<br />
					<b className="text-amber-700">EDEPOT seul</b> = demande par le <b>formulaire officiel</b> (onglet
					<b> Commandes</b>), acte consultable sur le site des ANOM (capture en
					preuve) — ces demandes apparaissent dans « Commande EDEPOT » au Suivi,
					pas dans « À rechercher ».<br />
					<b>Les deux</b> = la copie se demande <b>sur place</b> (bon) — le site des
					ANOM reste disponible pour préparer la recherche.<br />
					Si une demande n'a pas de cote, vérifier commune et année, ou corriger le classement
					depuis sa fiche.
				</p>
			</Carte>

			<Carte>
				<TitreCarte>Destination « Généalogie »</TitreCarte>
				<p>
					Pas une commande d'acte : une <b>photo de vérification</b> pour débloquer un arbre
					généalogique. Le circuit aux archives est le même.
				</p>
			</Carte>
			</div>
		</div>
	);
}
