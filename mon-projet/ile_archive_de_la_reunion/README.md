# IDLR-Archive API — wrapper JSON pour iledelareunion-archive.com

Le site n'expose aucune API : c'est du PHP de 2009 qui renvoie du HTML.
Ce projet ajoute une couche REST/JSON par-dessus (Google Apps Script).

**État : parsing + envoi des requêtes entièrement reverse-engineered et validés
sur données réelles (Décès, Naissance, Mariage). Reste ta 1ʳᵉ exécution live
pour confirmer la mécanique de session au runtime.**

---

## 1. Reverse engineering (confirmé sur le HTML réel)

### Formulaire (POST)

`<form action="…/recherche.php" method="post">` — aucun champ caché, aucun token.

| Champ site | Rôle | Valeurs |
|---|---|---|
| `nom` | patronyme | 2-25 car., `??` = illisible |
| `choix` | mode | `1`=Contient `2`=Commence `3`=Termine `4`=Exact |
| `prenom` | prénom | |
| `dateinf` | année mini | |
| `datesup` | année maxi | |
| `mere` | nom de la mère | |
| `ordre` | tri | `chrono` \| `alpha` |
| `s` | sexe | `M` \| `F` \| `T` |
| `ta` | type d'acte | `N` `D` `M` `PM` `DIV` — **un seul par recherche** |

### Flux réel

1. **GET** `recherche.php?rech={1\|3}&code={code}&phonex={0\|1}`
   → affiche le formulaire, pose le cookie `PHPSESSID`, fixe le périmètre en session
   (`rech=1`+code 7 chiffres = commune ; `rech=3`+code 5 chiffres = secteur)
2. **POST** `recherche.php` (sans query string) + les 9 champs → résultats page 1
3. **Pagination / phonétique** : **GET** `recherche.php?rech=4&x={offset}&<tous les critères>`
   avec le cookie (`x=(page-1)×50`, 50 actes/page)

⚠️ **Le site force `www.`** → on tape `http://www.iledelareunion-archive.com`
directement (sinon le POST perd son corps lors de la redirection).

### Structure d'une page de résultats

Stats globales → récap critères (avec nb d'actes) → tableau d'actes (colonnes
**variables selon le type**) → pagination. Voir `SCHEMA.md`.

---

## 2. Lancer en local (outils Node)

Toutes les commandes se lancent **depuis ce dossier** :

```bash
npm run search       # moteur de recherche, http://localhost:8091
npm run dashboard    # suivi de récolte,    http://localhost:8080
npm run import       # actes.csv -> actes.db
npm start            # récolte complète (reprend où elle s’était arrêtée)
npm test             # selftests, hors ligne
```

Les mêmes commandes existent à l’identique dans `moissonneur/`, où vivent les
scripts. Peu importe le dossier : ils résolvent leurs fichiers par leur propre
emplacement, jamais par le dossier courant.

**Préfère `npm run` à `node fichier.cjs`.** `node search.cjs` ne fonctionne que
depuis `moissonneur/` ; ailleurs Node échoue sur `MODULE_NOT_FOUND` avant même
d’avoir chargé la moindre ligne du projet. `npm run` répond partout, et sur un
nom erroné il liste les commandes disponibles au lieu d’une pile d’erreur.

---

## 3. Installation (Apps Script)

1. Nouveau projet Apps Script → créer `Config.gs`, `Parser.gs`, `Client.gs`, `Api.gs`.
2. Déployer : *Déployer > Nouveau déploiement > Application Web*, exécuter en tant
   que **moi**, accès selon besoin.

---

## 4. Première exécution (à faire une fois)

Dans l'éditeur, lance **`testSearch()`** (recherche Kichenin/Naissance/CINOR).

- ✅ tu vois des actes → tout marche.
- ❌ erreur « le site a renvoyé le formulaire » → lance **`debugSearch({secteur:'CINOR',nom:'Kichenin',type:'N'})`**
  et regarde les logs (URL, cookies, payload, HTML brut). Colle-moi ça, je corrige.

Le seul point non testable hors-ligne est la mécanique de session au runtime
(cookie `PHPSESSID` conservé entre le GET du formulaire et le POST). Le code la
respecte à l'identique du navigateur ; `debugSearch()` est là si jamais.

---

## 5. Endpoints

```
GET .../exec?action=communes
GET .../exec?action=search&secteur=CINOR&nom=Kichenin&sexe=M&type=D&anneeMax=1951
GET .../exec?action=search&commune=Sainte-Suzanne&nom=HOARAU&type=N&anneeMin=1900
```

| Param | Valeurs |
|---|---|
| `commune` \| `secteur` | périmètre (obligatoire) — `TCO/CIREST/CINOR/CASUD/CIVIS/Notaires` pour secteur |
| `nom`, `prenom`, `mere` | textes (nom : min 2 lettres) |
| `mode` | `contient` \| `commence` \| `termine` \| `exact` |
| `sexe` | `M` \| `F` \| `T` |
| `type` | `N` \| `D` \| `M` \| `PM` \| `DIV` (**un seul**) |
| `anneeMin`, `anneeMax` | AAAA |
| `ordre` | `chrono` \| `alpha` |
| `phonex` | `0` \| `1` |
| `page` | n (50/page) |
| `allPages` | `1` (plafonné `CFG.MAX_PAGES`) |
| `key` | si `CFG.API_KEY` renseignée |

Sortie : voir `SCHEMA.md` (schéma stable quel que soit le type d'acte,
`personnes.principal` + `personnes.conjoint` pour les mariages).

---

## 6. Garde-fous

- **Throttle** 1,5 s entre requêtes · **cache** 6 h · **`MAX_PAGES`** = 20 · **User-Agent** identifiant
- **`warnings[]`** : jamais d'échec silencieux (voir `SCHEMA.md`)
- Conçu comme **proxy à la demande**, pas aspirateur — serveur associatif bénévole.

---

## 7. Table des codes

| Commune | Code | Secteur | Code secteur |
|---|---|---|---|
| La Possession | 9741008 | TCO | 97410 |
| Le Port | 9741007 | TCO | 97410 |
| Saint-Leu | 9741013 | TCO | 97410 |
| Saint-Paul | 9741015 | TCO | 97410 |
| Trois-Bassins | 9741023 | TCO | 97410 |
| Bras-Panon | 9741102 | CIREST | 97411 |
| La Plaine-des-Palmistes | 9741106 | CIREST | 97411 |
| Saint-André | 9741109 | CIREST | 97411 |
| Saint-Benoît | 9741110 | CIREST | 97411 |
| Sainte-Rose | 9741119 | CIREST | 97411 |
| Salazie | 9741121 | CIREST | 97411 |
| Saint-Denis | 9741211 | CINOR | 97412 |
| Sainte-Marie | 9741218 | CINOR | 97412 |
| Sainte-Suzanne | 9741220 | CINOR | 97412 |
| L'Entre-Deux | 9741303 | CASUD | 97413 |
| Saint-Joseph | 9741312 | CASUD | 97413 |
| Saint-Philippe | 9741317 | CASUD | 97413 |
| Le Tampon | 9741322 | CASUD | 97413 |
| Les Avirons | 9741401 | CIVIS | 97414 |
| L'Étang-Salé | 9741404 | CIVIS | 97414 |
| Petite-Île | 9741405 | CIVIS | 97414 |
| Saint-Louis | 9741414 | CIVIS | 97414 |
| Saint-Pierre | 9741416 | CIVIS | 97414 |
| Cilaos | 9741424 | CIVIS | 97414 |
| Bourbon-Notaires | 9741599 | Notaires | 97415 |
