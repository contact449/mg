/**
 * ARCHIVES APP — gestion des demandes d'actes d'état civil (OCI Express).
 * Backend Google Apps Script, base de données Google Sheets.
 * Installation : voir INSTALLATION.md (initialiser(), importer le
 * référentiel, déployer en web app « Tout le monde »).
 */

// Classeur de l'app (seule base où l'app écrit) et classeur OCI de suivi
// manuel (lu pour Base_Cotes, alimenté d'une ligne par acte trouvé).
const ID_CLASSEUR_DONNEES = '1ARuRxDqQ_yCmOfHgJIdRvDpJ4kddbOSGthCUfak-Utc';
const ID_CLASSEUR_SUIVI = '1PBbeCQFDzOOxzH8bJbhWSsscUw1tVI2-4NFoObKCfmQ';

const NOM_FEUILLE_DEMANDES = 'Demandes';
const NOM_FEUILLE_HISTORIQUE = 'Historique';
const NOM_FEUILLE_REFERENTIEL = 'Base_Cotes';
const NOM_FEUILLE_BONS = 'Bons de commande';
const NOM_FEUILLE_HABILITATIONS = 'Habilitations';
const NOM_FEUILLE_MAIRIES = 'Mairies'; // Commune → email (créée au premier usage)

// Onglets du suivi manuel OCI, un par destination — disposition :
// DATE | DEMANDEUR | NOM PRENOM | TYPE | LIEN | COMMANDER | COMMENTAIRE
const NOM_FEUILLE_SUIVI_ARCHIVES = 'Suivi Demande A';
const NOM_FEUILLE_SUIVI_GENEALOGIE = 'Suivi Demande G';
const NOM_FEUILLE_IMPORT = NOM_FEUILLE_SUIVI_ARCHIVES; // source de l'import historique (déjà exécuté)

const NOM_DOSSIER_PHOTOS = 'Archives App - Photos actes';

const ENTETES_DEMANDES = [
	'ID', 'Date création', 'Type acte', 'Nom', 'Prénom', 'Commune',
	'Année acte', 'Date acte (précise)', 'Demandeur', 'Statut',
	'Classement', 'Cote 4E', 'Cote EDEPOT', 'Photos', 'Notes', 'Dernière MAJ',
	'Destination', 'Avant 1908', 'Preuve', 'Bon de commande', 'N° acte',
	'Remise à rechercher le', 'Commande mairie', 'Matricule',
	// Affilié = acte généalogie exploité dans le dossier client · Déblocage =
	// acte prioritaire (débloque un dossier) · Checké/Notaire/Apostillé =
	// circuit apostille après la recherche (dates, pas des statuts)
	'Affilié le', 'Déblocage', 'Checké le', 'Notaire le', 'Apostillé le'
];
// Colonnes utiles de l'onglet Demandes (1-based, même ordre que les en-têtes)
const COL = {
	TYPE: 3, ANNEE: 7, STATUT: 10, CLASSEMENT: 11, PHOTOS: 14, NOTES: 15,
	MAJ: 16, DESTINATION: 17, AVANT_1908: 18, PREUVE: 19, BON: 20, NUMERO_ACTE: 21, REMISE: 22,
	MAIRIE: 23, MATRICULE: 24, AFFILIE: 25, DEBLOCAGE: 26, CHECKE: 27, NOTAIRE: 28, APOSTILLE: 29,
};

const ENTETES_MAIRIES = ['Commune', 'Email'];

const ENTETES_HISTORIQUE = ['ID demande', 'Date', 'Statut', 'Détail', 'Agent'];

const ENTETES_BONS = ['ID bon', 'Date archives', 'Demi-journée', 'Personne', 'Demandes', 'Cotes', 'Créé le', 'Photo du bon', 'Email personne', 'Mail archives'];
// Demandes/Cotes = listes parallèles ; LIEN (ex-photo) = PDF généré à la clôture
const COL_BON = { DEMANDES: 5, COTES: 6, LIEN: 8, MAIL: 10 };

const ENTETES_HABILITATIONS = ['Email', 'Nom', 'Rôle', 'Ajouté le', 'Ajouté par', 'Code'];
const ROLES = ['Admin', 'Agent'];

// Demandée = formulaire EDEPOT envoyé, copies attendues · Non communicable =
// pas consultable en salle, copie envoyée par les archives · Stand by = mise
// de côté (hors dispatch) · Traitée = clôturée avec son bon
const STATUTS = ['À rechercher', 'Demandée', 'Trouvée', 'En erreur', 'Non trouvé', 'Non communicable', 'Stand by', 'Traitée'];
// Statuts depuis lesquels une photo / confirmation fait passer « Trouvée »
const STATUTS_VERS_TROUVEE = ['À rechercher', 'Demandée', 'En erreur', 'Non trouvé', 'Non communicable', 'Stand by'];

const CLASSEMENTS = ['', 'Cote 4E (copie)', 'Cote EDEPOT (original)', 'Les deux', 'Erreur (non trouvé)'];
const ANNEE_PIVOT = 1907; // ≤ 1907 : registres numérisés, recherche préparable en ligne
const MAX_COTES_PAR_PERSONNE = 5; // par demi-journée

// Formulaires officiels : modèles Google Docs copiés puis remplis (Formulaires.js)
const ID_MODELE_FORMULAIRE_EDEPOT = '1XO1wckKGGuDbdeT4bE_CWFelbLoh5_h5iut21FeKqOM';
const ID_DOSSIER_FORMULAIRES = '1Kv4uzZx2SCzH8ZOGsVaISsIyLd2tstxb'; // dossier Drive des PDF générés
const NB_COPIES_CERTIFIEES = 2;
const MAX_ACTES_FORMULAIRE_EDEPOT = 5;
