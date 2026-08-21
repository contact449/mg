# Croisement MG × IDLR — quels matricules manquent, et où ?

Troisième application de la famille. Les deux premières **collectent** ;
celle-ci **compare**, dans les deux sens :

| Question | Sortie |
|---|---|
| Les matricules relevés dans les actes des **Archives** sont-ils dans **MG** ? | `idlr_absents_de_mg.csv` |
| Les matricules de **MG** apparaissent-ils dans les actes des **Archives** ? | `mg_absents_didlr.csv` |
| Les deux à la fois — avec un test de ressemblance des noms | `communs.csv` |

**État : logique de croisement validée hors ligne (37 + 10 assertions), tableau
de bord rendu et relu. Reste ta 1ʳᵉ exécution sur les vraies bases du VPS.**

---

## 1. Pourquoi en Node, et pas en Apps Script

Les deux sources n'ont pas le même ordre de grandeur ni le même domicile :

| Source | Où elle vit | Volume | Coût d'un rafraîchissement |
|---|---|---|---|
| **MG** (cherchemg.fr) | `mg_matricules.csv`, via `cherche_mg/moissonneur/` | ~27 000 lignes | 26 requêtes, ~90 s |
| **IDLR** (iledelareunion-archive.com) | `actes.csv` / `actes.db` sur le VPS, via `ile_archive_de_la_reunion/moissonneur/` | des centaines de milliers d'actes | ~3 250 requêtes, plusieurs heures |

Les actes IDLR n'iront jamais dans Sheets. Le croisement tourne donc **là où ils
sont déjà**, sur le VPS — même dossier autonome, même Node ≥ 20, mêmes
conventions que les moissonneurs.

**Cette application ne moissonne rien.** Chaque module source possède sa propre
collecte ; le croisement se contente de lire les deux sorties :

```
cherche_mg/moissonneur/          ──>  mg_matricules.csv  ─┐
                                                          ├──>  croisement_mg_idlr/
ile_archive_de_la_reunion/moissonneur/ ──>  actes.csv/db ─┘
```

`mg.cjs` et `idlr.cjs` sont donc symétriques : deux lecteurs, un par source,
chacun capable de dire ce qu'il voit (`node mg.cjs`, `node idlr.cjs`). Les
chemins se déclarent par les **mêmes variables d'environnement que les
moissonneurs** (`MG_OUT`, `IDLR_OUT`, `IDLR_DB`) : un chemin se définit une
seule fois pour toute la chaîne.

---

## 2. Avertissement à lire avant d'exploiter les écarts

cherchemg.fr prévient : *« Ne confondez pas le numéro de matricule général avec
le numéro de matricule communal. »*

Le `n°…` que le moissonneur lit dans les **observations** d'un acte IDLR n'est
pas garanti être une MG. **Le taux de recouvrement calculé ici est précisément
le test** :

| Recouvrement IDLR → MG | Lecture |
|---|---|
| ≥ 50 % | même série : les écarts sont du vrai travail de complétion |
| 15 – 50 % | même série, bases très complémentaires — écarts exploitables |
| < 15 % | **stop** : probablement deux numérotations différentes (général vs communal). Comparer n'aurait alors aucun sens. |

Le résumé et le tableau de bord affichent ce taux **et** son interprétation. Un
second garde-fou va dans le même sens : tout `n°` hors 1..130 000 est écarté et
compté à part — ce ne peut pas être une MG.

Troisième nuance : sous **11 000**, plusieurs séries de numéros ont coexisté, un
même numéro pouvant porter des engagés sans rapport. Une égalité de numéro n'y
prouve pas grand-chose : la colonne `serie_ambigue` le signale ligne à ligne.

---

## 3. Installation

Dossier autonome, aucune dépendance à installer — mais il lui faut **les deux
moissonneurs** à côté (ou les chemins de leurs sorties) :

```bash
scp -r croisement_mg_idlr cherche_mg ubuntu@10.0.0.1:~/
ssh ubuntu@10.0.0.1
cd croisement_mg_idlr
node croiser.cjs --selftest     # vérifs hors ligne + état des deux sources
```

Le selftest affiche où il attend chaque source et si elle est présente. Si les
moissonneurs ne sont pas aux emplacements par défaut, déclare les chemins — ce
sont **les mêmes variables que les moissonneurs eux-mêmes** :

```bash
export MG_OUT=/chemin/mg_matricules.csv    # cherche_mg/moissonneur
export IDLR_DB=/chemin/actes.db            # ou
export IDLR_OUT=/chemin/actes.csv          # ile_archive.../moissonneur
```

`actes.db` et `actes.csv` sont tous deux acceptés — **le plus récent gagne**.
SQLite passe par `node:sqlite` (Node 22 : `--experimental-sqlite` ; Node 24+ :
rien à faire) ; si le module manque, on retombe sur le CSV.

---

## 4. Utilisation

> **Toutes les commandes se lancent depuis CE dossier**, pas depuis
> `mon-projet/`. Sinon Node répond `Cannot find module '…\mg.cjs'` : il cherche
> le script dans le répertoire courant.
>
> ```bash
> cd croisement_mg_idlr        # PowerShell : cd croisement_mg_idlr
> ```

```bash
node mg.cjs              # que voit-on côté cherchemg.fr ? (diagnostic)
node idlr.cjs            # que voit-on côté Archives ? (diagnostic)
node croiser.cjs         # le croisement + les 4 fichiers de sortie
node serve.cjs           # tableau de bord sur http://<vps>:8092
node maj.cjs             # la mise à jour complète (voir § 6)
```

Équivalents via npm, qui ont l'avantage de n'être valides que dans le bon
dossier — donc pas d'ambiguïté possible :

```bash
npm run mg · npm start · npm run serve · npm run maj · npm test
```

### Depuis un poste Windows plutôt que depuis le VPS

Les trois commandes lisent des fichiers : sans eux, elles disent où elles ont
cherché et s'arrêtent. Il faut donc **les deux sources en local**.

L'index MG se fabrique sur place, il ne dépend que du réseau (compter 3 à 4 min
depuis un poste, cherchemg.fr répondant en ~6 s par requête contre ~3 s depuis
Google) :

```powershell
cd ..\cherche_mg\moissonneur
node harvest.cjs --index
cd ..\..\croisement_mg_idlr
```

Les actes IDLR, eux, se rapatrient du VPS. En PowerShell la syntaxe des
variables d'environnement n'est pas celle du bash :

```powershell
$env:IDLR_OUT = "K:\Documents\mg\actes.csv"
node croiser.cjs
```

```bash
# bash / VPS
IDLR_OUT=/home/ubuntu/moissonneur/actes.csv node croiser.cjs
```

### Ce que produit `croiser.cjs`

| Fichier | Une ligne par | Colonnes utiles |
|---|---|---|
| `idlr_absents_de_mg.csv` | acte témoin (3 max par matricule) | `matricule`, `nb_actes_idlr`, `nom`, `prenom`, `commune`, `date_iso`, `numero_photo`, `url_demande_photo` |
| `mg_absents_didlr.csv` | identité MG | `matricule`, `serie_ambigue`, `identite`, `source` |
| `communs.csv` | couple (matricule, identité MG) | `identite_mg`, `nom_idlr`, `prenom_idlr`, `concordance_nom`, `serie_ambigue` |
| `resume.json` | — | compteurs, taux, diagnostic |
| `historique.json` | exécution | pour suivre l'évolution d'un semestre à l'autre |

`idlr_absents_de_mg.csv` est le plus directement utile : ce sont des matricules
**sourcés par un acte d'état civil**, avec la photo à l'appui, que cherchemg.fr
ne connaît pas encore. C'est exactement ce qu'un contributeur peut leur envoyer.

### `concordance_nom`

Sur les matricules communs, l'identité relevée par MG et le nom porté par l'acte
IDLR sont réduits à leurs jetons significatifs (sans accent, ≥ 3 lettres, mots
outils comme « dit » écartés) :

- `oui` — au moins un jeton commun ;
- `non` — aucun : à vérifier, surtout en série ambiguë ;
- `?` — un des deux côtés n'a rien d'exploitable.

Un taux de discordance élevé est un signal, pas un verdict : les orthographes
d'époque varient énormément.

---

## 5. Tableau de bord

```bash
node serve.cjs           # puis ouvrir http://localhost:8092
```

> `HOST` vaut `0.0.0.0` par défaut : c'est l'adresse d'**écoute** (toutes les
> interfaces), pas une adresse à taper dans un navigateur — celui-ci répondrait
> `ERR_ADDRESS_INVALID`. Ouvre `localhost`, ou l'IP du serveur depuis le réseau.

Chiffre héros (matricules communs), jauges de recouvrement dans les deux sens,
barre part-à-tout **MG seul / communs / IDLR seul**, indicateurs de qualité,
tableau d'évolution, et téléchargement des CSV. Accès comme les autres services
du VPS : `http://10.0.0.1:8092` via WireGuard, ou

```bash
ssh -p 2222 -L 8092:localhost:8092 ubuntu@10.0.0.1
```

Palette : slots catégoriels 1-2-3, validés en clair et en sombre (pire paire CVD
ΔE 9,2 / 9,4 ; vision normale 24,0 / 20,9). L'aqua passe sous 3:1 sur fond clair
— d'où les valeurs écrites dans la légende et le tableau, jamais la couleur
seule.

---

## 6. Recherche croisée

Une requête dans **toutes les sources à la fois**, une ligne par matricule,
colorée selon sa provenance.

```bash
npm run recherche        # puis http://localhost:8093
```

| Couleur | Provenance | Sur la base actuelle |
|---|---|---|
| 🟡 jaune | présent seulement dans les Archives (`actes.csv`) | 13 309 |
| 🟢 vert | présent seulement dans MG (`engages.csv`) | 10 485 |
| 🔵 bleu | présent dans les **deux** | 9 060 |
| 🩷 rose | **mg oci** : saisi à la main, absent des deux bases (`mgoci.csv`) | selon tes saisies |

**La couleur n'est jamais seule.** Chaque ligne porte aussi le mot « Archives »,
« MG », « Les deux » ou « mg oci ». Ce n'est pas de la redondance décorative : jaune et vert
sont à ΔE 6,9 en protanopie, donc difficilement séparables pour environ 8 % des
hommes. L'étiquette est ce qui rend le code couleur lisible pour eux. Les fonds
de ligne sont des teintes très pâles — le texte y garde un contraste de 15:1 à
18:1 dans les deux thèmes, là où un aplat saturé le rendrait illisible.

### Saisir un matricule mg oci

Le bouton **« + Matricule mg oci »** du formulaire ouvre la saisie d'un numéro
qu'aucune des deux bases ne connaît. Seuls le numéro et le nom sont
obligatoires. Les quatorze champs sont rangés en cinq blocs titrés, dans cet
ordre — c'est aussi l'ordre des colonnes du CSV :

| Bloc | Champs |
|---|---|
| **La personne** | numéro de matricule\*, nom\*, prénom, âge |
| **L'acte** | type d'acte, ville |
| **Naissance et décès** | date de naissance, lieu de naissance, date de décès |
| **Famille** | conjoint, père, mère |
| **Notes** | remarque, divers 2 |

Les blocs ne sont pas une décoration : quatorze champs à la file obligent à
lire chaque étiquette pour retrouver le père. Ce sont de vrais `fieldset`, donc
un lecteur d'écran annonce « Famille — Père » et pas « Père » seul.

**Le type d'acte est un menu déroulant** — naissance, décès, mariage,
reconnaissance, légitimation. Il s'ouvre sur *« non précisé »* : un menu qui
s'ouvrirait sur « Acte de naissance » enregistrerait une naissance à chaque
saisie où l'on n'y touche pas. Le CSV stocke le code (`N`, `D`, `M`, `R`, `L`),
celui du moissonneur des Archives : la colonne `type_acte` de `mgoci.csv` se
lit donc comme celle d'`actes.csv`. `R` et `L` sont propres à mg oci — le site
range reconnaissances et légitimations sous les naissances, et c'est justement
ce que la saisie sert à distinguer. Le serveur refuse toute autre valeur : le
menu n'engage que le navigateur, un POST peut arriver sans lui.

**Les dates et l'âge sont du texte libre**, pas des sélecteurs. En généalogie on
relève « 1887 », « vers 1890 », « 12 germinal an XI », « environ 40 », « 3 mois » :
un `input type=date` ou un champ numérique refuserait la plupart de ces
relevés, qui sont pourtant les plus fréquents.

Dans les résultats, une fiche mg oci se replie dans les colonnes existantes
plutôt que d'en ajouter cinq vides sur 99 % des lignes : la **Commune** prend la
ville, à défaut le lieu de naissance ; le type d'acte va dans la colonne
**Type**, commune à toutes les provenances ; les **Notes** reçoivent le lieu
de naissance s'il n'est pas déjà en Commune, l'âge préfixé, puis la remarque
et divers 2. Tout cela entre dans la recherche en texte libre — chercher
« reconnaissance » ou « Saint-Benoît » ramène la fiche.

**Un matricule déjà présent dans Archives ou dans MG est refusé**, avec un
message nommant la base. mg oci comble les trous de la série, il ne double pas
ce qui existe — sinon la couverture compterait deux fois le même numéro et la
barre des 130 000 mentirait.

Après enregistrement la page revient filtrée sur le nouveau numéro : la ligne
rose est là, et les deux graphiques l'ont intégrée. Le rechargement est
nécessaire, la barre et la frise étant calculées par le serveur.

Tout atterrit dans **`mgoci.csv`**, à côté du code — un CSV lisible et
modifiable à la main, comme les deux autres sources. Aucune base à installer ;
une sauvegarde se fait par copie. C'est le **seul** fichier que cette
application écrit : `actes.csv` et `engages.csv` restent en lecture seule.

Si un moissonnage semestriel finit par apporter un numéro déjà saisi, la ligne
affiche sa vraie provenance (Archives ou MG) **plus une pastille rose** : la
saisie n'est pas perdue, et elle n'est pas comptée deux fois.

```bash
MGOCI_CSV=/autre/chemin/mgoci.csv npm run recherche   # déplacer le fichier
```

### Un matricule présent des deux côtés

Une seule ligne, bleue : la synthèse. Le détail de chaque base n'est pas déplié
ici — pour voir les actes un par un, la recherche dédiée de chaque application
est faite pour ça (`ile_archive_de_la_reunion/moissonneur`, port 8091).

La colonne **Actes** indique combien d'actes les Archives portent pour ce
matricule, et **Identité (MG)** liste les engagés que MG y rattache.

La colonne **Type**, entre Date et Actes, donne **tous** les types d'acte que
le matricule porte, en toutes lettres et dédoublonnés : `Naissance · Mariage ·
Décès`. Trois précisions qui comptent :

- **Tous les actes, pas les trois exemples gardés en mémoire.** L'index ne
  retient que trois actes par matricule pour borner la mémoire, mais les types
  sont collectés à part — ce sont sept codes possibles, l'ensemble ne peut pas
  grossir. Un matricule de 115 actes ne tairait sinon ni son mariage ni son
  décès. Sur les données réelles du 21/08/2026, **22 369 lignes sur 32 854**
  portent un type, et les combinaisons les plus fréquentes sont `Décès` (16 395),
  `Naissance` (2 966) et `Naissance · Décès` (1 607).
- **L'ordre est celui d'une vie**, pas celui du fichier : naissance,
  reconnaissance, légitimation, mariage, promesse, divorce, décès. Deux
  matricules portant les mêmes actes se lisent donc pareil, quel que soit
  l'ordre où le moissonnage les a rencontrés.
- **Une case vide veut dire « non relevé », pas « aucun acte »** — d'où le
  tiret gris. MG ne donne aucun type d'acte : les 10 485 lignes vertes sont
  vides pour cette raison, et c'est exact.

Pas de pastille colorée sur ce type, contrairement à la recherche des Archives
(port 8091) : ici la couleur est déjà prise par la provenance, et un point vert
« Naissance » à côté d'une ligne verte « MG » ferait lire deux codes couleur
l'un pour l'autre.

Le type entre dans la recherche en texte libre sous la forme affichée —
chercher « mariage » ramène les lignes qui en portent un.

La colonne **Famille** réunit le conjoint, le père et la mère relevés dans
l'acte — ou saisis, sur une ligne mg oci. Une seule colonne plutôt que trois :
l'entourage n'est relevé que sur les mariages, soit **7,5 % des actes**, et
trois colonnes vides sur les 92 % restants gêneraient la lecture. Ces noms
entrent dans la recherche en texte libre : chercher « Sinnama » ramène
l'acte où elle est épouse, pas seulement ceux où elle est la personne
principale.

Le contenu dépend du **type d'acte**, parce que le site ne relève pas les
mêmes choses :

| Type | Ce qui s'affiche |
|---|---|
| Mariage, promesse, divorce | `conj. NOM Prénom`, `père …`, `mère …` |
| **Naissance** | `père <prénom>`, `mère NOM Prénom`, † si le parent est mort, `parr.`, `marr.` |
| Décès | `père †`, `mère †` |
| mg oci | ce que tu as saisi |

> **Une naissance donne le prénom du père et le nom complet de la mère** —
> 82 %, 98 % et 96 % des actes sondés sur une page réelle le 21/08/2026.
> Le site ne donne **pas** le NOM du père : c’est le patronyme de l’enfant,
> déjà en colonne Nom. La ligne affiche donc `père Guillaume` et non
> `père HOAREAU Guillaume` — recopier le nom de l’enfant serait une
> déduction, fausse sur les 11 % d’actes qui sont des reconnaissances.
>
> **Ces colonnes restent vides tant qu’une récolte ne les a pas remplies** ;
> seul le conjoint est là depuis toujours. Voir
> `ile_archive_de_la_reunion/moissonneur/README.md`, section « Rattraper les
> noms de parents ».
Filtres : texte libre (identité, nom, notes, sources, origine — insensible aux
accents), provenance, plage de matricules, commune, origine.

Comme la recherche IDLR, les critères passent dans l'URL :

```
http://localhost:8093/?texte=petan
http://localhost:8093/?provenance=idlr&commune=Saint-Denis
http://localhost:8093/?provenance=deux&matMin=1&matMax=1000
```

### Couverture de la série — deux niveaux de lecture

La légende donne les effectifs par provenance, puis deux visuels reprennent les
**mêmes chiffres** à deux échelles :

**Ensemble de la série** — une barre : les 130 000 numéros d'un seul tenant, les
segments proportionnels, le gris étant ce qu'aucune source ne connaît.

**Par tranche de 10 000** — une frise de **13 colonnes** : 1–10 000,
10 001–20 000, … 120 001–130 000. Chaque colonne est une jauge **sur 10 000**,
pas une barre à l'échelle du maximum observé : on lit donc directement la part
connue de chaque tranche, et les tranches se comparent entre elles.

Dans les deux, les couleurs s'empilent dans le même ordre : Archives seul, les
deux, MG seul, puis mg oci. Survoler une colonne donne ses chiffres exacts ;
**cliquer filtre la recherche sur cette tranche**, recliquer désélectionne, et
la colonne active reste encadrée.

> **Un plancher de 2 px.** Un matricule vaut 0,01 % d'une tranche et 0,0008 %
> de la série : à l'échelle, son segment ferait 0,01 px — invisible. Une saisie
> mg oci qui n'apparaît pas serait prise pour une saisie perdue, donc tout
> segment non vide reçoit 2 px au minimum. La proportion est légèrement faussée
> vers le haut pour les très petits effectifs ; les nombres exacts restent dans
> la légende et dans l'infobulle de chaque colonne.

Ce que la forme montre d'emblée : la tranche **1–10 000 est couverte à 61,4 %**,
loin devant les autres (20 à 26 %), et la dernière tombe à 3,6 %. Une part de
cette avance vient des faux matricules extraits de dates, qui produisent surtout
de petits numéros.

> **Les trois affichages comptent la même chose** : la plage 1–130 000. Les
> 1 787 numéros hors plage apparaissent comme une entrée grise à part dans la
> légende — ils restent cherchables mais n'entrent dans aucune tranche. Les
> totaux tombent juste : 11 522 + 10 485 + 9 060 + 1 787 = 32 854, plus tes
> saisies mg oci.
>
> La provenance est décidée **une seule fois**, par `provenanceDe()` dans
> `recherche.cjs` : lignes, légende, barre et frise lisent toutes cette
> fonction. Elles ne peuvent donc pas diverger, et ajouter une provenance ne
> demande pas de retoucher quatre comptages censés rester d'accord.
### Détail du calcul

Un compteur en tête de page dit combien de matricules les deux bases connaissent
**sur les 130 000** que la série peut porter, avec la répartition par provenance :

```
Couverture de la série — 31 067 matricules connus sur 130 000        23,9 %
[■■■■ jaune ■■ bleu ■■ vert ]────────────── reste inconnu ──────────────
```

Seuls les numéros de la plage **1–130 000** entrent dans le calcul. Les autres
ne peuvent pas être des matricules et gonfleraient la couverture à tort : on en
compte **1 787**, tous du côté Archives, avec des valeurs allant jusqu'à
`113413113413`. Ils viennent de la règle de concaténation du moissonneur —
`N°13-1796` devient `131796` — et sont écartés, la note sous le compteur le
disant explicitement.

> La légende au-dessus compte **tous** les matricules trouvés (13 309 côté
> Archives), le compteur seulement ceux de la plage (11 522). L'écart est
> exactement les 1 787 hors plage. Les deux portées sont écrites, chacune sert
> à autre chose : la légende décrit ce que les filtres renvoient, le compteur
> ce qu'on couvre de la série.

### Où mènent les liens

Chaque lien renvoie à la base **d'où vient la donnée** :

| Colonne | Lien | Présent quand |
|---|---|---|
| **MG** (le numéro) | `cherchemg.fr/mg.php?MgChaine=N` | MG connaît ce matricule — donc lignes vertes et bleues |
| **Nom (Archives)** | l'acte sur `iledelareunion-archive.com` | l'acte porte une `url_demande_photo` |

Sur une ligne **jaune**, le numéro n'est donc pas cliquable : ce matricule a été
lu dans les observations d'un acte, MG ne le connaît pas, et le lien tomberait
sur « ce numéro n'est pas encore présent ». Le lien utile y est celui du nom,
qui mène à l'acte.

Le lien vers les Archives porte un soulignement de la couleur des Archives, pour
qu'on voie où il mène avant de cliquer.

> Environ un tiers des actes n'ont pas d'`url_demande_photo` : le nom s'affiche
> alors sans lien. Pour un matricule qui porte plusieurs actes, on retient le
> premier qui en possède une plutôt que le premier venu — ce seul détail fait
> passer les lignes bleues liées de 22 % à 80 %.

### Sources lues

| Base | Fichier | Repli |
|---|---|---|
| Archives | `IDLR_OUT` ou `../ile_archive_de_la_reunion/moissonneur/actes.csv` | — |
| MG | `MG_ENGAGES` ou `../cherche_mg/engages.csv` | `mg_fiches.csv`, puis `mg_matricules.csv` |

Les colonnes sont reconnues par leur **nom**, pas par leur position : remplacer
`engages.csv` par `mg_fiches.csv` ne demande aucun réglage. Les doublons
parfaits d'`actes.csv` sont écartés à la lecture, comme dans `importer.cjs`.

---

## 7. Mise à jour semestrielle

`maj.cjs` est fait pour tourner **seul**, deux fois par an, sans personne devant
l'écran. Il enchaîne quatre étapes :

| # | Étape | Commande | Durée |
|---|---|---|---|
| 1 | **IDLR** | `superviseur.cjs --refresh` | 15 à 28 h |
| 2 | **MG — index** | `harvest.cjs --index --force` | ~90 s |
| 3 | **Croisement + rapport** | `croiser.cjs` | quelques secondes |
| 4 | **MG — fiches** | `harvest.cjs --fiches` | ~33 h |

```bash
node maj.cjs                    # les quatre étapes
node maj.cjs --etat             # où en est-on ? (ne lance rien)
node maj.cjs --dry              # montre ce qui serait fait
node maj.cjs --sans-idlr        # garde la base d'actes existante
node maj.cjs --sans-fiches      # saute la traîne de 33 h
node maj.cjs --sans-superviseur # harvest.cjs en direct
```

Trois décisions expliquent cet ordre, et méritent d'être connues avant d'y
toucher.

**L'étape IDLR passe par `superviseur.cjs`, pas par `harvest.cjs`.** Une récolte
complète, c'est ~35 000 requêtes sur plus de 28 h, et `harvest.cjs` abandonne
après **5 échecs d'affilée** — soit moins d'une minute de site indisponible. Sur
une nuit entière, ça arrive. Le superviseur relance et le checkpoint reprend au
bucket suivant ; l'attente entre deux relances double à chaque fois (1, 2, 4…
jusqu'à 30 min) et il abandonne pour de bon après 8 échecs **sans le moindre
progrès** — marteler le serveur d'une association en panne serait exactement ce
qu'il ne faut pas faire.

**`--refresh` n'est pas une demi-mesure.** Il relit le total annoncé de *chaque*
bucket (commune × type × initiale) et ne re-télécharge que ceux qui ont grossi,
en dédoublonnant par `numero`. C'est ce qui rend une mise à jour complète
tenable deux fois par an : une récolte intégrale referait 28 h de trafic sur le
serveur des bénévoles pour retrouver ce qu'on a déjà.

**Les fiches MG passent APRÈS le rapport.** Le croisement lit
`mg_matricules.csv`, jamais `mg_fiches.csv` : mettre les 33 h de phase 2 avant
retarderait le bilan de deux jours sans rien y ajouter. On reçoit donc le
rapport en fin de nuit, et les fiches arrivent quand elles arrivent — leur
reprise se fait sur le fichier de sortie, une coupure ne coûte rien.

### Savoir qu'un moissonnage est en cours

Quatre voies, de la plus passive à la plus directe :

| Voie | Ce qu'elle donne | Demande |
|---|---|---|
| **Discord** | démarrage, résumé toutes les 30 min, rapport, fin, échec | un webhook |
| `node maj.cjs --etat` | étape en cours, depuis quand, PID vivant ou non | un shell |
| Tableau de bord **:8080** | avancement de la récolte IDLR, rythme, fin estimée | un navigateur |
| `maj.log` · `systemctl status croisement` | le journal complet | un accès VPS |

**Le webhook est la pièce qui change tout.** Avec `IDLR_DISCORD_WEBHOOK` défini,
`maj.cjs` prévient **au démarrage** — plan des étapes et durées annoncées —,
lance `notify.cjs` en fond pendant toute la récolte IDLR (résumé périodique, et
alerte immédiate si l'état change), poste le rapport de croisement dès qu'il est
prêt, signale la fin des fiches, et signale tout échec **en nommant l'étape**.
Sans webhook, tout fonctionne à l'identique mais en silence.

`maj_etat.json` est écrit à chaque changement d'étape et **conservé après la
fin** : la dernière exécution reste consultable. `--etat` sait distinguer une
mise à jour qui tourne d'une qui a été coupée — il vérifie que le PID répond
encore :

```
EN COURS — demarree le 2026-07-01T03:12:44.019Z (486 min)
  etape : IDLR, depuis 486 min
  pid   : 21774
  etapes : IDLR ...
```

### Planification

```bash
sudo cp systemd/croisement.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now croisement.timer
systemctl list-timers croisement.timer      # prochaine échéance
```

Le timer part le **1ᵉʳ janvier et le 1ᵉʳ juillet à 03h00**. `Persistent=true` :
si le VPS était éteint à l'heure dite, la mise à jour part au démarrage suivant
au lieu d'être perdue jusqu'au semestre d'après. `RandomizedDelaySec=30m` évite
que tous les timers du VPS partent à la même seconde.

`TimeoutStartSec=96h` : les deux longues étapes mises bout à bout font ~60 h
dans le pire cas. Une minuterie trop courte tuerait une exécution parfaitement
normale, au milieu, sans que rien ne le dise.

Éditer les chemins dans `croisement.service` si le dossier n'est pas dans
`/home/ubuntu/`, et y décommenter la ligne `IDLR_DISCORD_WEBHOOK`.

> **Le service déclare `OCI_ENV=prod`.** Sans cette ligne, la mise à jour
> tournerait en dev et les deux moissonneurs refuseraient de sortir — l'unité
> échouerait bruyamment plutôt que de récolter en silence depuis une machine de
> développement. N'installe le timer **que** sur le VPS.

---

## 8. Tests

```bash
npm test                        # les trois suites ci-dessous

node test/test_croisement.cjs   # 37 assertions, bout en bout, hors ligne
node test/test_mgoci.cjs        # 101 assertions sur la provenance mg oci
node mgoci.cjs                  # 40 assertions sur le magasin de saisie
node croiser.cjs --selftest     # concordance des noms + état des sources
node maj.cjs --selftest         # 19 assertions sur la mise à jour automatique
```

`test_croisement.cjs` fabrique un index MG et un `actes.csv` de synthèse dans un
dossier temporaire, lance le croisement, puis vérifie les compteurs **et** le
contenu des trois CSV. Les cas piégeux y sont volontaires : série ambiguë,
matricule écrit `N°2-537`, numéro hors plage, et un champ `obs` contenant
virgule, guillemets et saut de ligne — celui qui casse un découpage naïf.

`test_mgoci.cjs` vérifie ce qui doit rester cohérent quand on ajoute une
provenance : la ligne, la légende, la barre et la frise donnent-elles les mêmes
nombres ? Le plancher de 2 px est-il bien posé ? Un matricule déjà connu est-il
refusé ? Et surtout le cas qui n'arrivera que dans six mois — un moissonnage
qui rattrape une saisie : la ligne doit changer de provenance sans perdre la
trace de la saisie **ni** compter le numéro deux fois.

`maj.cjs --selftest` vérifie ce qui ne se voit qu'une fois tous les six mois, à
3 h du matin : l'ordre des quatre étapes, le fait que le croisement passe avant
les fiches, la présence du superviseur et de `notify.cjs` là où on les attend,
le cycle de vie de `maj_etat.json` (écrit, relu, illisible, terminé), la
détection d'un PID mort, et la taille du rapport Discord. Aucune requête.

`mgoci.cjs --selftest` couvre l'écriture CSV, où se cachent les pièges
classiques : un nom contenant une virgule, des guillemets (`dit "le grand"`) ou
un saut de ligne doit revenir intact après un aller-retour sur disque. Il vérifie
aussi les valeurs à choix : un type d'acte hors liste est refusé, et le libellé
à la place du code (`Naissance` au lieu de `N`) l'est aussi.

---

## 9. Courtoisie

Les deux sites sont tenus par des bénévoles, et leurs données appartiennent à
leurs contributeurs et releveurs. Ce dossier ne fait que **comparer** ce que les
deux moissonneurs ont déjà collecté ; il n'ajoute qu'un seul appel réseau récurrent
— les 26 requêtes MG, deux fois par an. Avant de leur renvoyer les écarts,
un mot aux auteurs vaut mieux qu'un fichier brut :
`https://cherchemg.fr/contact.php`.
