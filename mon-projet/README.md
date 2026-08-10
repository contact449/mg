# Archives — Gestion des demandes d'actes (OCI Express)

Web app interne d'OCI Express pour gérer les demandes de copies d'actes d'état civil
(naissance, mariage, décès…) auprès des **Archives départementales de La Réunion** et
des mairies : création des demandes, classement automatique par cote (4E / EDEPOT),
répartition en bons de commande pour les visites sur place, photos des actes,
formulaires officiels PDF, envoi des bons par mail aux archives, suivi généalogique
et circuit d'apostille.

- **Prod** : web app Apps Script, accès « Tout le monde » MAIS connexion obligatoire
  dans l'app (compte Google habilité, ou personne + code).
- **Base de données** : Google Sheets (aucun autre backend).
- **Repo GitHub** : https://github.com/flokchvtr/App-Archives

## Stack

| Couche | Techno |
|---|---|
| Backend | Google Apps Script V8 (`src/server/*.js`, JS brut, pas de bundler) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 (`src/client/`) |
| Build | `vite-plugin-singlefile` → un seul `dist/Index.html` (contrainte GAS) |
| Déploiement | `clasp` (le `rootDir` est `dist/`, voir `.clasp.json`) |
| UI | peau « Linear » maison (`components/ui/kit.tsx`), Radix Dialog/Popover, cmdk, dnd-kit, lucide |

## Structure

```
src/server/          backend Apps Script (fonctions globales appelées via google.script.run)
  Code.js            doGet (sert dist/Index.html)
  Constantes.js      IDs des classeurs/dossiers/modèles, feuilles, colonnes, statuts
  Utils.js           accès classeur, _feuille (étend la grille), _ligneVersObjet, IDs, journal
  Habilitations.js   rôles, _exiger, identification par code, getBootstrap
  Demandes.js        CRUD demandes, statuts, photos, affilié/déblocage/apostille, suivi OCI
  Bons.js            bons de commande, dispatch, clôture, envoi mail aux archives
  Formulaires.js     PDF (bon de commande HTML→PDF, formulaire EDEPOT depuis modèle Docs)
  Referentiel.js     Base_Cotes (classement auto 4E/EDEPOT), listerCommunes
  Mairies.js         commandes mairies (communes mères, annexes, emails)
  Statistiques.js    getSuivi (liste + stats des tuiles)
  Idlr*.js           client du site iledelareunion-archive.com (voir § IDLR)
  Import.js          import one-shot du suivi manuel (déjà exécuté, relançable)
  Init.js            initialiser(), jeux de test
src/client/          front React
  App.tsx            routage (pile), porte de login, sidebar/nav, en-tête
  screens/           Suivi, Detail, NouvelleDemande, Bons, BonDetail, Commandes,
                     Apostille, Idlr, MesActes (+ Identification), Admin, Guide
  components/ui/     kit (Carte, Btn, badges, toasts…), boite (confirm/prompt), combobox,
                     sidebar, segmente
  lib/               gas.ts (pont google.script.run + types), mock.ts (dev local),
                     precharge.ts (préchargement fiches), favoris, photo, utils
ile_archive_de_la_reunion/moissonneur/   scripts Node autonomes de moissonnage IDLR
                     (indépendants de l'app — voir leur README)
```

## Identifiants (Constantes.js et .clasp.json)

| Quoi | Valeur |
|---|---|
| Script Apps Script | `1NDRQkpV2QuOFFI8lXMVKiz-ZCtpgzQIC5qG-YAqPi8qkaRYR4E4_oZfQ` |
| Déploiement versionné (le /exec public) | `AKfycbyVBWJgzxO5JVsV1Hazqo8Jowf_mSyd3OjJiOZ-H1lXH0q1jN4tRJdE8zoO_Ddo5NAa` |
| Classeur base de données | `ID_CLASSEUR_DONNEES` (Demandes, Historique, Bons, Habilitations, Mairies) |
| Classeur OCI de suivi manuel | `ID_CLASSEUR_SUIVI` (lu pour Base_Cotes ; alimenté d'une ligne par acte trouvé) |
| Modèle Docs formulaire EDEPOT | `ID_MODELE_FORMULAIRE_EDEPOT` |
| Dossier Drive des PDF générés | `ID_DOSSIER_FORMULAIRES` |
| Dossier Drive des photos | créé au nom `Archives App - Photos actes` |

## Développer en local

```bash
npm install
npm run dev        # Vite + mocks (google.script.run n'existe pas hors GAS)
npm run typecheck  # tsc --noEmit
```

Sans Apps Script, `lib/gas.ts` bascule sur `lib/mock.ts` : données factices et
réponses simulées pour tous les endpoints. Changer de rôle en dev :
`localStorage.setItem('mockRole', 'Admin'|'Agent'|'Lecture')` puis recharger
(`Lecture` affiche la page de connexion ; code mock : Rachida / `1234`).

## Déployer (procédure IMPÉRATIVE)

Le /exec public est figé sur un **déploiement versionné** : `clasp push` seul ne
change RIEN pour les utilisateurs. Après toute modification :

```bash
npm run build      # client OU serveur (le build copie aussi src/server/*.js dans dist/)
npx clasp push -f
npx clasp deploy -i AKfycbyVBWJgzxO5JVsV1Hazqo8Jowf_mSyd3OjJiOZ-H1lXH0q1jN4tRJdE8zoO_Ddo5NAa -d "description"
```

- `clasp` demande parfois une reconnexion (`invalid_grant`) → `clasp login`.
- Version prod au moment d'écrire : **@42**.
- Première installation : voir `initialiser()` dans Init.js (crée les feuilles,
  le premier utilisateur devient Admin), puis déployer en web app « Tout le monde ».

## Base de données (feuille Demandes — 29 colonnes)

Une ligne = une demande. Colonnes clés (voir `ENTETES_DEMANDES` / `COL`) :
statut (col 10), classement + cotes 4E/EDEPOT (11-13), photos (14, une URL par ligne),
destination Archives/Généalogie (17), preuve (19), bon de commande (20), n° d'acte (21),
commande mairie (23), matricule (24), **affilié le (25), déblocage (26),
checké/notaire/apostillé le (27-29)**.

La grille s'étend automatiquement à 29 colonnes au premier accès (`_feuille()`),
et les en-têtes des colonnes tardives se posent au premier usage (`_poserEnTete`).
Autres feuilles : Historique (journal par demande), Bons de commande
(Demandes/Cotes = listes parallèles), Habilitations (email, nom, rôle, code),
Mairies (emails — `formaterMairies()` la régénère depuis le doc OCI).

## Rôles et connexion

- **Admin** : tout (créer, dispatcher, commander, habiliter).
- **Agent** : recherche sur place, photos, reclassement, ses bons, apostille.
- Connexion : session Google d'un compte habilité, OU « identité déclarée »
  (personne + code personnel, défini par l'Admin) pour les Gmail persos —
  stockée en localStorage et passée en dernier argument de chaque appel serveur.
- **Aucun accès anonyme** : tous les points d'entrée serveur exigent Admin/Agent
  (`_exiger`), l'app affiche une page de connexion sinon. Le rôle est mémoïsé
  par exécution (`_role`) : une exécution = une identité, les appels internes
  n'ont pas à repasser l'ident.
- Limite connue : les helpers `_xxx` restent techniquement invocables via
  google.script.run par quelqu'un qui connaît Apps Script (le verrou couvre les
  portes de l'UI). Blindage total = renommer les helpers en suffixe `_`.

## Circuit métier

**Statuts** : À rechercher → (Demandée | Trouvée | En erreur | Non trouvé |
Non communicable | Stand by) → Traitée. Une photo (ou une confirmation sans photo)
passe l'acte « Trouvée » et écrit une ligne dans le classeur de suivi OCI.

1. **Création** (Admin) : classement automatique par cote depuis Base_Cotes
   (année ou date précise ; sections « Commune — Section » gérées). Garde-fou doublon.
   ≤ 1907 = registres numérisés (préparables en ligne).
2. **Dispatch** (Admin, onglet Bons) : répartit les « À rechercher » avec cote 4E
   entre les personnes cochées — 5 cotes max / personne / demi-journée, groupées
   par registre, généalogie en priorité aux admins, **actes « Déblocage » en tête**.
3. **Sur place** (Agent, mobile) : photo (numéro d'acte obligatoire), trouvé sans
   photo, en erreur, non trouvé, non communicable, report (registre occupé).
4. **Fin de tournée** (Admin, onglet Bons → « Envoyer aux archives ») : clôture tous
   les bons de la demi-journée (Trouvée → Traitée), génère un PDF par bon
   (réplique du formulaire officiel, HTML → PDF) et envoie le tout par mail aux
   archives (CC fabrice@sindraye.re). Anti-double-envoi par tampon « Mail archives ».
5. **EDEPOT seul** (onglet Commandes) : pas de consultation sur place — formulaire
   officiel PDF (modèle Docs), preuve (capture ANOM) obligatoire, 5 actes max,
   les demandes passent « Demandée ».
6. **Mairies** (onglet Commandes) : actes détenus en mairie — un mail par mairie,
   remontée automatique à la commune mère selon l'année (annexes gérées).
7. **Généalogie** : actes de vérification (pas de commande, absents des bons).
   « **Affilié** » = exploité dans le dossier client (le filtre Généalogie ne montre
   que les non-affiliés ; filtre « Affiliés » pour les autres). Un acte généalogie
   reconnu indien se **bascule en Archives** (fiche, Admin) pour devenir commandable.
8. **Déblocage** : priorité posée sur la fiche (Admin) quand un dossier client
   attend l'acte — part en tête du dispatch, badge rose partout.
9. **Apostille** (onglet Apostille, Admin) : après la recherche, 3 étapes datées
   **Checké → Notaire → Apostillé** sur les actes Trouvée/Traitée. Checké exige
   Trouvée/Traitée, Notaire exige Checké, Apostillé exige Notaire ; un « non
   apostillé » s'arrête à Checké ; décocher efface les étapes suivantes.

## IDLR (iledelareunion-archive.com)

Client HTTP du site généalogique de l'association Arbre (`IdlrConfig/Parser/Client.js`) :
session PHP par cookie, GET du formulaire (fixe le périmètre commune/secteur en
session), POST des critères, parsing HTML → JSON, pagination rech=4.

⚠️ **Pièges qui ont déjà mordu** :
- Le POST doit renvoyer les **champs cachés du formulaire** (`code`, `rech=2`) —
  `buildPayload_` les reprend automatiquement du HTML. Ne pas « simplifier » ça.
- Taper `www.` directement (une redirection ferait perdre le corps du POST).
- Politesse : throttle 1,5 s entre requêtes, cache 6 h, 20 pages max, User-Agent
  identifiant OCI. C'est un serveur associatif tenu par des bénévoles.

Usage dans l'app : onglet IDLR (recherche manuelle) et recherche de **matricule**
depuis la fiche / la création (croisement nom + type + année ±1 + commune, lecture
du n° dans les observations). Première exécution sur un nouveau script :
lancer `testIdlr()` dans l'éditeur pour autoriser le scope UrlFetchApp.

## Outils d'admin (éditeur Apps Script)

| Fonction | Effet |
|---|---|
| `initialiser()` | crée les feuilles ; le premier exécutant devient Admin |
| `creerDemandesTest()` / `supprimerDemandesTest()` | jeu d'essai « TEST … » |
| `completerCotesManquantes()` | classement auto en lot des demandes sans cote |
| `formaterMairies()` | régénère l'onglet Mairies (emails vérifiés doc OCI 07/2026) |
| `importerHistorique()` / `annulerImport()` | reprise du suivi manuel (one-shot, déjà fait) |
| `testIdlr()` / `debugSearch(q)` | test et diagnostic du client IDLR |

## UI / design

- Peau « Linear » : bordures fines, thèmes clair + sombre automatiques.
- **Signature émeraude** : tout dérive de `--accent` (`index.css`) ; fond de page
  teinté + halo (`.fond-app`) et chrome teinté (`.chrome-app`). L'app sœur
  **DemSuiv est orange** — même mécanique, seule la couleur change.
- Les cartes affichent la date utile : « Créée le » tant qu'on cherche, sinon la
  date de l'évènement du statut (Traitée = envoi du bon).
- Le PDF du bon reproduit le formulaire papier officiel (Times/Arial voulus).

## Pièges connus / notes de reprise

- **Déployer = `clasp deploy -i …`**, jamais `push` seul (voir § Déployer).
- Le cache IDLR (6 h) peut garder un résultat vide obtenu pendant une panne.
- `Session.getActiveUser()` ne voit pas les Gmail persos → c'est le rôle de
  l'identité déclarée (personne + code).
- Écritures Sheets : toujours `getDisplayValues()` + `trim()` pour comparer des
  IDs (un `getValues()` brut a déjà causé des faux « introuvable »).
- Le dossier `ile_archive_de_la_reunion/moissonneur/` est un outil Node autonome
  (moissonnage IDLR côté VPS) — il ne participe ni au build ni au déploiement.
- Fuseau : `Indian/Reunion` partout dans le code (le manifest dit Mauritius, même UTC+4).

## Apps sœurs (autres repos)

- **Proj_DemSuiv** : suivi procurations / dossiers + envois — même stack, même peau,
  signature orange. Même classeur que l'onglet Envois.
- Écosystème OCI : oci-express-v2 (prod), oci-test (env de test), apps Apps Script
  Hub/Todo/Tâches/Envois/Mails.
