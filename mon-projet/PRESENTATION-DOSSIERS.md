# Présentation des dossiers de `~/var/www`

Deux projets cohabitent ici :

1. **OCI Express** (Next.js / Prisma / PostgreSQL) — trois dossiers correspondant à
   trois **environnements** du même dépôt GitHub `Akameeeeee/Logiciel-Metier-OCI-EXPRESS` ;
2. **Proj_Archives** — une application **Google Apps Script** indépendante
   (gestion des demandes d'actes aux Archives).

| Dossier          | Rôle                                            | Base de données  | Port / URL             | Dernier commit |
| ---------------- | ----------------------------------------------- | ---------------- | ---------------------- | -------------- |
| `oci-express-v2` | **Production OCI Express (la vraie version)**   | `oci_express_v2` | `http://10.0.0.1`      | 3 juil. 2026   |
| `oci-test`       | **Environnement de test** (on y pousse d'abord) | `oci_test`       | `http://10.0.0.1:3002` | 1 juil. 2026   |
| `oci-app`        | Ancienne production V1, figée                   | `ocidb`          | `http://10.0.0.1:3000` | 2 juin 2026    |
| `Proj_Archives`  | App Apps Script « Archives »                    | Google Sheets    | Web app Google         | 10 juil. 2026  |

---

## `oci-express-v2` — ✅ la production actuelle (V2)

- La version en service : 393 commits, dernier le 3 juillet 2026.
- `.env` de production : vrai SMTP/IMAP Gmail (`contact@ociexpress.re`), intégration
  Google Sheets/Drive, base `oci_express_v2`.
- Contient la documentation du projet (`DOCUMENTATION-DEVELOPPEUR.md`, `JOURNAL.md`,
  `TUTO-SITE.md`, `ENV-TEST-VPS.md`) et des dumps de sauvegarde PostgreSQL (juin 2026).
- Petit sous-dossier `ociexpress-DEV_V2/` (76 Ko, notes mode offline), vestige
  d'une expérimentation.

## `oci-test` — 🧪 l'environnement de test (à ne pas supprimer)

- Copie **volontairement isolée** de la prod, où l'on déploie et teste les
  changements **avant** de les mettre sur la vraie version.
- Isolation complète (voir `ENV-TEST-VPS.md`) : base séparée (`oci_test`),
  port séparé (3002), et **emails neutralisés** — le SMTP pointe sur MailHog
  (`localhost:1025`), qui capture les mails au lieu de les envoyer aux vrais
  clients/notaires.
- Actuellement 2 commits derrière la prod (dernier déploiement de test :
  1er juillet). C'est normal : il reflète simplement le dernier push testé.

## `oci-app` — 📦 l'ancienne production V1

- L'ancienne version en service avant la V2 : figée au 2 juin 2026
  (267 commits), base `ocidb`, port 3000.
- Tout son historique git est déjà inclus dans `oci-express-v2` : aucun commit
  unique. Conservée comme archive de la V1.
- Fichiers non versionnés notables :
  - `sauvergarde_avant_maj_2026-06-02.dump` (sauvegarde de la base V1 du 2 juin —
    à récupérer avant toute suppression)
  - `openssl_rand_-base64_32` (fichier **vide**, créé par erreur en tapant la
    commande `openssl rand -base64 32` — sans valeur, supprimable)

## `Proj_Archives` — 🗂️ app « Archives — Gestion des demandes » (Apps Script)

Application web Google Apps Script pour OCI Express : gestion des **demandes
d'actes d'état civil aux Archives départementales de La Réunion**. Projet
distinct des trois dossiers ci-dessus (git local uniquement, déployé via clasp).

### Métier

- Chaque demande d'acte est **classée automatiquement** à la création via le
  répertoire 4E : cote **4E** (copie), cote **EDEPOT** (original), ou les deux
  (on commande alors la copie 4E).
- **Règle du 31/12/1907** : actes ≤ 1907 → registres numérisés, recherche
  d'image possible en amont ; > 1907 → non numérisés, recherche sur place.
- Deux **destinations** : « Archives » (commande d'acte) ou « Généalogie »
  (photo de vérification pour débloquer un arbre généalogique).
- **Bons de commande** : max 5 cotes / personne / demi-journée, affectés à un
  agent habilité ; `repartirBons()` distribue automatiquement et équitablement
  les demandes entre agents.
- Sur place : photo de l'acte (n° d'acte obligatoire) → statut « Trouvée »,
  photo stockée dans Drive, et une ligne est ajoutée en retour dans le classeur
  de suivi manuel OCI (onglets « Suivi Demande A / G »).
- Statuts : À rechercher, Trouvée, En erreur, Non trouvé, Traitée.

### Données et accès

- Base de données = **Google Sheets** : un classeur dédié à l'app (Demandes,
  Bons de commande, Habilitations, Historique) ; le classeur de suivi manuel
  OCI est lu (référentiel `Base_Cotes`) et alimenté en retour.
- Web app déployée en accès public anonyme (`ANYONE_ANONYMOUS`) :
  identification par **nom + code personnel** (aucun compte Google requis),
  rôles Admin / Agent ; les visiteurs non identifiés sont en mode terrain
  (lecture + photos). Création des demandes et des bons réservée à l'Admin.

### Technique

- Backend : Apps Script (`src/server/` — Demandes, Bons, Habilitations,
  Import, Référentiel, Init/migrations, Statistiques).
- Frontend : **React 19 + TypeScript + Vite + Tailwind v4** (structure shadcn),
  build tout-en-un dans `dist/Index.html` (contrainte Apps Script) ;
  écrans : Suivi, Détail, Nouvelle demande, Bons (+ détail), Mes actes,
  Admin, Guide.
- Déploiement : `npm run deploy` (build Vite + `clasp push`). Node 24.
- `Index.html` / `JavaScript.html` / `Styles.html` à la racine = ancien front
  vanilla, gardé en référence, plus déployé.
- Dernier commit : 10 juillet 2026 ; à venir : génération de PDF
  (EDEPOT, bon de commande).

---

## Flux de travail OCI Express

```
développement → push GitHub → déploiement sur oci-test (validation sans risque)
                                        ↓ OK
                              déploiement sur oci-express-v2 (production)
```


https://docs.google.com/document/d/1XO1wckKGGuDbdeT4bE_CWFelbLoh5_h5iut21FeKqOM/view?tab=t.0
Voici le premier lien c'est les demandes pour les EDEPOT, j'aimerai que dans l'application on a quelque part une option qui nous permet d'envoyer le formulaire que je t'ai donnée avec toutes les informations des e depot, le formulaire peut etre généré uniquement si il y a les photo qui lui sont alignées aux e depot


https://docs.google.com/document/d/1dfAhnG6OGQ0NErCS9euerMoeaTwcPK_zuJhefDu9rrk/view?tab=t.0
Voici le deuxieme lien lorsqu'on a fini le bon on peut imprimer le bon, au lieu de générer automatiquement quelque chose comme c'était fait avant j'aimerai qu'il remplisse le formulaire et remplisse les cases correctement, j'ai oublié de dire mais dans la case Date et nom de la commune (l'avant dernière) on met aussi la cote et le numéro de l'acte en +, et le nombre de copie est toujours de 2
