# Cherche-MG — liste des Matricules Générales (cherchemg.fr)

Le site [cherchemg.fr](https://cherchemg.fr) recense les **numéros de Matricule
Générale** des engagés de La Réunion (1839–1911). Il n'expose aucune API : du
PHP qui renvoie du HTML. Ce module ajoute par-dessus une couche REST/JSON **et**
un moissonneur qui reconstitue dans Google Sheets la liste complète des
matricules présents dans leur base.

Même architecture que le module frère `ile_archive_de_la_reunion/`
(Config / Parser / Client / Api), globaux préfixés `mg` / `MG_` pour que les
deux puissent cohabiter dans un seul projet Apps Script.

**État : parsing et moissonnage validés hors ligne sur pages réelles
(51 + 47 assertions), tableau de bord rendu et relu en clair, sombre, vide et
en vue tableau. Reste ta 1ʳᵉ exécution live dans Apps Script.**

---

## 1. Reverse engineering (confirmé sur le HTML réel, août 2026)

### Deux points d'entrée

| | Fiche par numéro | Index par identité |
|---|---|---|
| Requête | `GET /mg.php?MgChaine=<n>` | `POST /patro.php` corps `PatroChaine=<chaîne>` |
| Session | aucune — ni cookie, ni token | aucune |
| Renvoie | 1 numéro, 1 à N engagés | **des milliers de lignes d'un coup** |

### La découverte qui change tout

Le champ `PatroChaine` est validé **côté client uniquement**
(`verifpatrochaine.js` exige 3 caractères) : le serveur, lui, accepte **une
seule lettre**. Une requête ramène alors une part énorme de l'index :

| `PatroChaine` | lignes | MG distincts | poids |
|---|---|---|---|
| `a` | 34 315 | **18 145** | 6,5 Mo |
| `ou` | 16 146 | 9 359 | 3,1 Mo |
| `sam` | 3 574 | 2 041 | 0,7 Mo |

Toute identité contenant au moins une lettre a–z est donc atteignable par un
balayage de **26 requêtes**. Énumérer `/mg.php` de 1 à 130 000 en demanderait
**130 000**, soit ~9 jours de requêtes continues à la cadence du site. C'est la
raison d'être de `mgDemarrerBalayage()`.

### Cadence du serveur

Le PHP s'exécute en ~57 ms (en-tête `Server-Timing`) mais la réponse arrive en
**~6 s**, et la connexion n'est jamais réutilisée (`Connection: keep-alive`
annoncé, mais chaque requête rouvre un socket). Le site s'auto-limite à environ
**1 requête / 6 s**. Inutile de paralléliser.

### Formes de réponse de `/mg.php`

| Cas | Marqueur HTML |
|---|---|
| **Trouvé** | `<strong id="anchoryouremg">n</strong>` + `<table id="anchortablemg">` |
| **Absent** | `<div id="anchoryouremg">` + « Ce numéro n'est pas encore présent » |
| **Vide** | ni l'un ni l'autre (`n=0`, chaîne non numérique) |

Dans les deux premiers cas le site ajoute des tables d'« indices » **déduites de
la plage du numéro, pas de l'engagé** : `anchortableimmat` (fenêtre
d'immatriculation), `anchortablecvoy` (convois arrivés dans cette fenêtre),
`anchortablectxt` (histoire contextuelle).

### Structure de `/patro.php`

`<table id="anchortableidt">` : 1 ligne d'en-tête puis N lignes de **exactement
3 cellules** — Patronyme · Source (parfois un lien `bibliocard.php`) ·
`<a href="mg.php?MgChaine=n">n</a>` **ou vide**. Environ 27 % des lignes n'ont
pas de numéro de MG : identité relevée, matricule inconnu. Elles partent dans
une feuille séparée.

---

## 2. Limites à connaître (annoncées par le site)

- Les relevés **ne sont pas exhaustifs** : contributions bénévoles en cours.
- **MG 1 à ~10999** : plusieurs séries de numéros ont coexisté, un même numéro
  porte donc parfois plusieurs engagés sans rapport entre eux (vérifié : MG 5
  renvoie 3 engagés, MG 700 en renvoie 2). Le champ `serie_ambigue` le signale.
- **MG ≥ 11000** : série principale, sans équivoque, 1839→1911, renseignée
  jusqu'à ~124000.
- Ne pas confondre matricule **générale** et matricule **communale**.

### Conditions d'usage

Le pied de page du site indique : *« Les informations présentées sur ce site
sont strictement réservées à un usage personnel et non commercial, de type
généalogique. Les fichiers numériques confiés sont la propriété des
contributeurs et les données dépouillées la propriété des releveurs. »*

En conséquence, ce module :

- conserve les colonnes **Contributeur** et **Releveur** dans chaque fiche
  récupérée, et cite `cherchemg.fr` comme source dans les réponses de l'API ;
- limite le débit et met en cache pour ne pas peser sur le serveur ;
- affiche un rappel avant de lancer le balayage.

Avant tout usage dans un cadre professionnel, écris à l'auteur du site
(Laurent Coutaye) via `https://cherchemg.fr/contact.php` : un accord — voire un
export direct — vaut mieux que 26 requêtes de 6 Mo.

---

## 3. Installation

1. Nouveau projet Apps Script → créer les scripts `Config.gs`, `Parser.gs`,
   `Client.gs`, `Api.gs`, `Stats.gs`, `Engages.gs`, plus **deux fichiers HTML**
   nommés `Vue` et `Recherche` (*Fichier › Nouveau › Fichier HTML*). Ou
   `clasp push` depuis ce dossier. Sans `Vue`, tout marche sauf le tableau de
   bord ; sans `Recherche`, tout marche sauf l'écran de recherche.
2. Lier ou créer un classeur : au premier appel, `mgClasseur_()` utilise le
   classeur actif ; si le script est autonome, il en **crée un** et journalise
   son URL. Pour en imposer un : `mgDefinirClasseur('<ID du classeur>')`.

> **Script lié ou script autonome — ça change ce qui marche.**
> `SpreadsheetApp.getUi()` n'existe que dans un script **attaché à un classeur**.
> Dans un script autonome, le menu « Cherche MG » n'apparaît jamais et les
> fenêtres modales lèvent *« Cannot call SpreadsheetApp.getUi() from this
> context »*. Le moissonnage, lui, fonctionne dans les deux cas.
>
> | | Script lié (Extensions › Apps Script depuis le classeur) | Script autonome |
> |---|---|---|
> | Balayage, fiches, import, API JSON | oui | oui |
> | Menu + fenêtres modales | oui | **non** |
> | Écrans en application web | oui | oui |
>
> Pour **lier** : ouvre le classeur → *Extensions › Apps Script* → colle les
> fichiers dans ce projet-là.
> Pour rester **autonome** : déploie en application web et ouvre
> `…/exec?action=tableau` ou `…/exec?action=recherche` — ce sont exactement les
> mêmes pages que les fenêtres modales.
3. Autorisations demandées au premier lancement : `UrlFetch`, `Spreadsheets`,
   `ScriptApp` (déclencheurs).
4. Web app (facultatif) : *Déployer > Nouveau déploiement > Application Web*,
   exécuter en tant que **moi**.

> **Un seul `doGet()` par projet Apps Script.** Si tu réunis ce module et
> `ile_archive_de_la_reunion` dans le même projet, renomme le `doGet` de
> l'autre en `idlrDoGet` et aiguille :
> ```js
> function doGet(e) {
>   var p = (e && e.parameter) || {};
>   return (p.source === 'mg') ? mgDoGet(e) : idlrDoGet(e);
> }
> ```

---

## 4. Utilisation

### Phase 1 — construire la liste des matricules (~26 requêtes)

```js
mgDemarrerBalayage();     // ou depuis le menu « Cherche MG » du classeur
mgEtatBalayage();         // avancement
mgArreterBalayage();      // stop + retrait du déclencheur
```

Apps Script coupe une exécution à 6 min : le balayage traite les lettres tant
qu'il lui reste du budget (`MG_CFG.BUDGET_MS`, 4 min), sauvegarde sa place dans
les propriétés du script et **se replanifie tout seul**.

**Mesuré en production** (10 août 2026) : les 26 lettres passent en **85 s**,
dans une seule exécution — 324 541 lignes lues, 27 043 lignes enregistrées,
19 541 matricules distincts. Le réseau de Google vers cherchemg.fr est bien plus
rapide qu'un poste local (~3 s par requête au lieu de ~6 s), donc le mécanisme de
reprise ne sert en pratique que de filet.

Il alimente deux feuilles :

| Feuille | Contenu |
|---|---|
| `MG_Matricules` | une ligne par (MG, identité, source) — **la liste demandée** |
| `MG_Sans_numero` | identités relevées sans numéro de MG |

La déduplication se fait sur `MG + hash(identité|source)`, ce qui rend le
balayage **idempotent** : le relancer n'ajoute aucun doublon, et une reprise
après coupure ne duplique rien.

Si le site ne répond plus, le balayage réessaie, puis **se suspend** au bout de
`MG_CFG.MAX_ECHECS` (5) reprises infructueuses au lieu de boucler indéfiniment.
`mgEtatBalayage()` affiche alors `suspendu: true` avec la dernière erreur ; un
simple `mgBalayage()` manuel repart d'où il en était.

### Phase 2 — détail fiche par fiche (optionnel, long)

```js
mgCompleterFiches({ min: 11000, continu: true });
```

Une requête `/mg.php` par numéro, ~6 s chacune : sur toute la série principale
cela représente **plusieurs jours**. Réserve-le aux numéros qui t'intéressent
(`min` / `max`), ou laisse tourner en fond. Alimente `MG_Fiches` avec origine,
naissance, arrivée, convoi, immatriculation, notes, contributeur, releveur.

> **Pour la série entière, préfère le moissonneur.** Apps Script coupe à 6 min
> par exécution : la reprise automatique fonctionne, mais enchaîner ~33 h de
> requêtes par déclencheurs est fragile. [`moissonneur/`](moissonneur/) fait le
> même travail en Node, en continu, avec reprise sur le fichier de sortie —
> conçu pour tourner détaché sur le VPS. Le module Apps Script reste le bon
> outil pour l'index (90 s) et pour les recherches à l'unité.

### À l'unité

```js
mgLookup(11000);      // fiche complète d'un numéro
mgPatro('kichenin');  // recherche par identité
mgResume();           // chiffres clés à plat (API, logs)
```

### Consulter et chercher les engagés — menu « Rechercher un engagé… »

Les matricules ne servent à rien s'ils restent dans une feuille. `Engages.gs` +
`Recherche.html` ajoutent l'écran qui manquait : un tableau filtrable sur la
feuille **`MG_Engages`**.

**1. Importer les données.** Deux voies au choix :

- *Sheets natif* — Fichier › Importer › (ton CSV) › **Insérer une nouvelle
  feuille**, puis renomme l'onglet en `MG_Engages`. Zéro code.
- *Depuis le script* — dépose le CSV sur ton Drive, puis menu **Importer un CSV
  d'engagés…**, ou `mgImporterEngages('engages.csv')` dans l'éditeur.

**2. Chercher.** Menu **Rechercher un engagé…** ouvre l'écran :

| Filtre | Comportement |
|---|---|
| Recherche | tous les mots doivent être présents, répartis sur identité, notes, sources, origine, convoi, contributeur |
| MG de / à | plage de matricules |
| Année de / à | comparée à naissance, sinon arrivée, sinon immatriculation |
| Origine | **préfixe** : « Inde » attrape aussi « Inde \| Calcutta » |
| Contributeur | valeur exacte |

La recherche est **insensible aux accents et à la casse** : `petan` trouve
« Pétan », `geole` trouve « géôle ». Ça compte — les relevés d'époque en sont
pleins et personne ne les tape.

Chaque matricule renvoie vers sa fiche sur cherchemg.fr. Un `?` signale les
numéros sous 11 000, où plusieurs séries ont coexisté. Le bouton **Envoyer vers
une feuille** écrit *tous* les résultats (pas seulement la page affichée) dans
`MG_Recherche`, pour trier et partager ensuite.

**Schéma libre.** Les colonnes sont reconnues par leur **nom**, lu dans la ligne
d'en-tête — jamais par leur position. Le même écran accepte donc `engages.csv`
(10 colonnes), `moissonneur/mg_fiches.csv` (15 colonnes), ou un export de
`MG_Fiches`. Une colonne absente est ignorée, une colonne inconnue est affichée
quand même. Rien à reparamétrer quand la source change.

> Le filtrage se fait côté serveur, sur toute la feuille : compter 1 à 3 s par
> recherche sur 27 000 lignes. C'est pourquoi elle part sur **Entrée** ou sur le
> bouton, jamais à chaque frappe.

### La même recherche en local — `npm run recherche`

L'écran ci-dessus a besoin d'un classeur, d'un compte Google et d'un import
préalable. Sur le VPS, ou pendant le développement, on a le CSV sous la main et
pas le classeur. La même recherche est donc servie en page web locale :

```bash
npm run recherche          # puis http://localhost:8094
```

**Le moteur n'est pas réécrit.** `moissonneur/Engages.js` est une copie conforme
de `Engages.gs`, chargée dans un contexte `vm` comme `Config.js` et `Parser.js`
le sont déjà pour le moissonneur. `mgRechercherEngages()` s'exécute donc tel
quel : la seule pièce fournie par Node est `mgLireEngages_()`, qui rend les
lignes du CSV là où Apps Script rendait celles de la feuille. Les deux écrans ne
peuvent pas diverger, et le selftest refuse de passer si la copie a dérivé.

| | Écran Sheets | Page locale |
|---|---|---|
| Source | feuille `MG_Engages` | `engages.csv`, sinon `mg_fiches.csv`, sinon `mg_matricules.csv` |
| Filtres | identiques — **c'est le même code** | |
| Résultats partageables | non | oui, les critères sont dans l'URL |
| « Tous les résultats » | feuille `MG_Recherche` | `Exporter le CSV` (télécharge tout, pas la page affichée) |

Mesuré sur le vrai `engages.csv` : **1 721 résultats sur 27 096 lignes en
190 ms** pour la recherche « moutou ».

Les critères passent dans l'URL, donc un signet ou un lien envoyé à un collègue
ramène le même résultat :

```
http://localhost:8094/?texte=moutou
http://localhost:8094/?origine=Inde&anMin=1860&anMax=1870
http://localhost:8094/?matMin=11000&matMax=12000
http://localhost:8094/api?texte=petan          # les mêmes résultats en JSON
http://localhost:8094/export.csv?origine=Madagascar
```

Réglages : `PORT` (8094 par défaut), `HOST`, et `MG_ENGAGES` / `MG_FICHES` /
`MG_OUT` pour désigner un autre fichier — les mêmes variables que le
moissonneur, comme partout dans la chaîne.

### Tableau de bord — menu « Chiffres clés »

`mgAfficherTableauDeBord()` ouvre `Vue.html` en fenêtre modale :

- **chiffre héros** — matricules distincts, avec la plage couverte ;
- **compteur** d'avancement du balayage (lettres faites / total, état) ;
- **4 tuiles** — lignes d'index, engagés distincts, identités sans numéro,
  fiches détaillées ;
- **histogramme** des matricules par tranche de 10 000 (une seule teinte : la
  hauteur porte déjà la magnitude, la couleur n'a rien à encoder de plus) ;
- **part-à-tout** série principale / série ambiguë, valeurs dans la légende ;
- **distribution** du nombre d'engagés par matricule ;
- **classement des releveurs**, dès que la phase 2 a produit des fiches ;
- **bouton « Voir le tableau »** : chaque graphique a son jumeau chiffré, donc
  aucune valeur n'est accessible seulement au survol.

Palette : slots catégoriels 1 et 2, validés dans les deux modes
(ΔE CVD 24,7 clair / 26,8 sombre ; vision normale 33,6 / 31,8 ; contraste
≥ 3:1). Le thème suit celui du système, avec surcharge `data-theme`.

`mgStatistiques()` renvoie ces mêmes chiffres en JSON si tu veux les traiter
ailleurs. Le calcul fait **un seul parcours** des feuilles : compte quelques
secondes sur une base complète, c'est une action de menu, pas un appel d'API.

### Le même tableau de bord en local — `npm run chiffres`

```bash
npm run chiffres           # puis http://localhost:8095
```

**Ni le calcul ni la vue ne sont réécrits.** `moissonneur/Stats.js` et
`moissonneur/Vue.html` sont des copies conformes de `Stats.gs` et `Vue.html` :
`mgStatistiques()` s'exécute tel quel, et la page servie **est** le fichier du
module. Apps Script y injecte ses chiffres par le scriptlet `<?!= donnees ?>`,
Node y injecte les siens au même endroit. Les deux tableaux de bord ne peuvent
donc pas donner des nombres différents ni dessiner deux graphiques distincts.

Ce que Node fournit, c'est le **classeur** : trois fausses feuilles adossées aux
CSV (`mg_matricules.csv` → `MG_Matricules`, `mg_fiches.csv` → `MG_Fiches`), plus
les quelques services Google que `Stats.gs` appelle au passage. Les colonnes y
sont remises dans l'ordre de `MG_ENTETES` **par leur nom** — `mg_fiches.csv`
porte en deuxième position une colonne `statut` que la feuille n'a pas, et
`mgTopReleveurs_` lit « Releveur » par sa *position* : sans ce réalignement, le
classement des releveurs compterait des contributeurs. Un selftest verrouille
ce point.

Mesuré sur les vrais fichiers : **19 541 matricules distincts**, 23 892 lignes
d'index, 27 125 fiches, MG 1 à 126 033, 4 939 en série ambiguë.

Trois libellés de la vue sont adaptés au contexte local, parce qu'ils nomment
des choses qui n'existent pas hors de Sheets :

| Dans le classeur | En local | Pourquoi |
|---|---|---|
| « Ouvrir le classeur » | « Ouvrir le dossier des données » | il n'y a pas de classeur |
| « Lance *Cherche MG › Lancer le balayage complet* » | « Lance `npm run index` » | il n'y a pas de menu |
| Identités sans numéro : « relevées, matricule inconnu » | « non collectées par le moissonneur » | voir ci-dessous |

> **La phase 1 du moissonneur n'écrit pas les identités sans numéro.** Le
> balayage Apps Script les enregistre dans `MG_Sans_numero` — environ 27 % des
> lignes de `patro.php` — alors que `harvest.cjs --index` ne garde que les
> lignes portant un numéro. La tuile afficherait donc un `0` qui voudrait dire
> « aucune » quand il veut dire « pas collectées » : c'est le libellé qui est
> corrigé, pas le chiffre. Dépose un `mg_sans_numero.csv` (ou pointe `MG_SANS`
> dessus) et la tuile reprend son sens d'origine.

Le selftest vérifie que ces trois phrases existent toujours dans la vue : si le
module les reformule, la substitution ne portera plus et le test le dira, plutôt
que de laisser passer un libellé trompeur.

#### Quelle source donne les chiffres justes ?

`chiffres.cjs` prend le premier fichier présent : `mg_matricules.csv`, sinon
`engages.csv`, sinon `mg_fiches.csv`. Cet ordre n'est pas arbitraire — le même
calcul, lancé sur les trois fichiers réels le 21/08/2026, ne donne pas
tout à fait les mêmes nombres :

| Source | Lignes | Matricules distincts | Engagés distincts | Identités vides |
|---|---|---|---|---|
| **`mg_matricules.csv`** | 23 892 | **19 541** | **23 892** | 0 |
| `mg_fiches.csv` | 27 125 | 19 541 | 23 928 | **33** |
| `engages.csv` | 27 096 | **19 545** | 23 899 | 0 |

Aucun matricule hors de la plage 1–130 000 dans les trois, et **aucun couple
(matricule, identité) de l'index ne manque aux deux autres** : l'index est un
sous-ensemble strict. Les écarts viennent donc de ce que les autres ajoutent.

**`mg_matricules.csv` est la bonne source par défaut**, pour trois raisons :

- c'est exactement ce que contient la feuille `MG_Matricules` du classeur, donc
  l'écran local et celui de Sheets annoncent les mêmes nombres ;
- il est daté et reproductible — `mg_etat.json` dit quand, en combien de temps,
  et une commande le refait ;
- il ne porte aucune identité vide, donc aucun engagé fantôme.

**N'utilise pas `mg_fiches.csv` comme index.** Il ajoute 36 couples dont **33
sont des lignes de fiche sans identité**, sur des matricules qui portent par
ailleurs une identité renseignée — le site y écrit « Contacter le Webmaster de
ce site » à la place du nom. Le calcul traite « vide » comme une identité
distincte : ces 33 lignes deviennent 33 engagés qui n'existent pas. Il ne
gagne rien en échange : la phase 2 énumère les matricules de l'index, elle ne
peut donc pas en connaître un de plus (19 541 des deux côtés). Il reste un
dernier recours quand rien d'autre n'est là.

**`engages.csv` connaît 4 matricules que l'index ne peut pas atteindre** —
20925, 57847, 64321, 105054. Ce n'est pas un défaut du moissonneur : ces
quatre-là n'ont, dans la base, qu'un relevé dont l'identité vaut `#`, la marque
du site pour un nom illisible. Or le balayage interroge `patro.php` avec les
26 lettres : **une identité qui ne contient aucune lettre a–z est hors de
portée**, par construction. `#` n'apparaît d'ailleurs jamais dans
`mg_matricules.csv` (0 occurrence), contre 7 dans `engages.csv`. L'écart est
donc réel, connu, et vaut **4 matricules sur 19 545, soit 0,02 %**.

À l'inverse, `engages.csv` n'est produit par aucune commande : il se dépose à la
main, sans date ni traçabilité. Pointe `MG_OUT` dessus si tu veux la couverture
maximale, en sachant que tu échanges la reproductibilité contre 4 matricules.

```bash
MG_OUT=../engages.csv npm run chiffres     # couverture maximale
npm run chiffres                           # index : reproductible (défaut)
```

`http://localhost:8095/api` renvoie l'objet complet en JSON — le même que
`mgStatistiques()`.

---

## 5. Endpoints

```
GET .../exec?action=fiche&mg=11000
GET .../exec?action=patro&q=moutou&max=200
GET .../exec?action=liste&page=1&taille=1000
GET .../exec?action=etat
```

| Param | Valeurs |
|---|---|
| `action` | `fiche` \| `patro` \| `liste` \| `etat` (défaut `fiche`) |
| `mg` | numéro 1..130000 — `action=fiche` |
| `q` | chaîne cherchée dans l'identité — `action=patro` |
| `max` | plafond de lignes renvoyées — `action=patro` |
| `page`, `taille` | pagination de `MG_Matricules` — `action=liste` |
| `key` | ta clé si `MG_CFG.API_KEY` est renseignée |

Sortie : voir [SCHEMA.md](SCHEMA.md).

---

## 6. Garde-fous

- **Throttle** 2 s ajoutés aux ~6 s du site · **cache** 6 h sur les fiches ·
  **3 tentatives** avec back-off sur erreur 5xx (pas de retry sur 4xx).
- **`MAX_FICHES_PAR_RUN`** = 250 : plafond dur sur la phase 2.
- **`MAX_ECHECS`** = 5 : le balayage se suspend au lieu de marteler un site
  en panne. Les deux phases ne se décrochent pas mutuellement leur reprise
  (chacune ne supprime que ses propres déclencheurs).
- **`warnings[]`** dans chaque réponse : jamais d'échec silencieux. Un libellé
  inattendu dans une fiche remonte en `CHAMP_INCONNU:`, une ligne de tableau mal
  formée en `LIGNES_IGNOREES:n`.
- Conçu comme **proxy à la demande + un moissonnage ponctuel**, pas comme un
  aspirateur permanent.

---

## 7. Tests

Hors ligne, sans réseau, sur des pages réelles enregistrées dans
`test/fixtures/` :

```bash
node test/test_parser.cjs      # 51 assertions : parsing des 2 pages
node test/test_balayage.cjs    # 47 assertions : dédup, idempotence, reprise,
                               #                 suspension, et statistiques
node test/test_engages.cjs     # 49 assertions : import, recherche, filtres,
                               #                 pagination, export, script autonome
node moissonneur/recherche.cjs --selftest
                               # 39 assertions : la recherche locale, hors ligne
node moissonneur/chiffres.cjs --selftest
                               # 37 assertions : le tableau de bord local
```

`test_balayage.cjs` remplace Apps Script par de faux services (Sheets,
Properties, Cache, UrlFetch, déclencheurs) et rejoue le balayage complet. Le
faux Sheets reproduit volontairement la contrainte qui casse en vrai : écrire
au-delà de `getMaxRows()` lève « range exceeds grid limits ».

`test_engages.cjs` tourne sur le **vrai** `engages.csv` s'il est présent
(27 096 lignes), sinon sur un extrait de synthèse. Les deux exercent le champ
`notes` contenant une virgule entre guillemets — celui qui casse un découpage
naïf — et vérifient que chercher `petan` trouve bien « Pétan ».

Si le site change sa mise en page, ces tests le disent avant le déploiement.
Pour vérifier en direct : `mgTestStructure()` dans l'éditeur Apps Script.
