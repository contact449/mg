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
| 🩷 rose | **Filae** : saisi à la main, absent des deux bases (`filae.csv`) | selon tes saisies |

**La couleur n'est jamais seule.** Chaque ligne porte aussi le mot « Archives »,
« MG », « Les deux » ou « Filae ». Ce n'est pas de la redondance décorative : jaune et vert
sont à ΔE 6,9 en protanopie, donc difficilement séparables pour environ 8 % des
hommes. L'étiquette est ce qui rend le code couleur lisible pour eux. Les fonds
de ligne sont des teintes très pâles — le texte y garde un contraste de 15:1 à
18:1 dans les deux thèmes, là où un aplat saturé le rendrait illisible.

### Saisir un matricule Filae

Le bouton **« + Matricule Filae »** du formulaire ouvre la saisie d'un numéro
qu'aucune des deux bases ne connaît. Champs : nom, prénom, ville, date de
naissance, date de décès, conjoint, père, mère, et deux cases divers. Seuls le
numéro et le nom sont obligatoires.

**Les dates sont du texte libre**, pas un sélecteur. En généalogie on relève
« 1887 », « vers 1890 », « 12 germinal an XI » : un `input type=date` refuserait
ces trois-là, qui sont pourtant les plus fréquents.

**Un matricule déjà présent dans Archives ou dans MG est refusé**, avec un
message nommant la base. Filae comble les trous de la série, il ne double pas
ce qui existe — sinon la couverture compterait deux fois le même numéro et la
barre des 130 000 mentirait.

Après enregistrement la page revient filtrée sur le nouveau numéro : la ligne
rose est là, et les deux graphiques l'ont intégrée. Le rechargement est
nécessaire, la barre et la frise étant calculées par le serveur.

Tout atterrit dans **`filae.csv`**, à côté du code — un CSV lisible et
modifiable à la main, comme les deux autres sources. Aucune base à installer ;
une sauvegarde se fait par copie. C'est le **seul** fichier que cette
application écrit : `actes.csv` et `engages.csv` restent en lecture seule.

Si un moissonnage semestriel finit par apporter un numéro déjà saisi, la ligne
affiche sa vraie provenance (Archives ou MG) **plus une pastille rose** : la
saisie n'est pas perdue, et elle n'est pas comptée deux fois.

```bash
FILAE_CSV=/autre/chemin/filae.csv npm run recherche   # déplacer le fichier
```

### Un matricule présent des deux côtés

Une seule ligne, bleue : la synthèse. Le détail de chaque base n'est pas déplié
ici — pour voir les actes un par un, la recherche dédiée de chaque application
est faite pour ça (`ile_archive_de_la_reunion/moissonneur`, port 8091).

La colonne **Actes** indique combien d'actes les Archives portent pour ce
matricule, et **Identité (MG)** liste les engagés que MG y rattache.
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
deux, MG seul, puis Filae. Survoler une colonne donne ses chiffres exacts ;
**cliquer filtre la recherche sur cette tranche**, recliquer désélectionne, et
la colonne active reste encadrée.

> **Un plancher de 2 px.** Un matricule vaut 0,01 % d'une tranche et 0,0008 %
> de la série : à l'échelle, son segment ferait 0,01 px — invisible. Une saisie
> Filae qui n'apparaît pas serait prise pour une saisie perdue, donc tout
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
> saisies Filae.
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

`maj.cjs` enchaîne les trois étapes :

1. **IDLR** — `harvest.cjs --refresh` : relit le total de chaque bucket et ne
   re-récolte que ceux qui ont grossi. Plusieurs heures.
2. **MG** — `cherche_mg/moissonneur/harvest.cjs --index --force` : 26 requêtes,
   ~90 s. Seulement l'index : la phase 2 (fiches, ~33 h) est un chantier à part,
   qu'on ne relance pas automatiquement tous les six mois.
3. **Croisement** + rapport, avec notification Discord si `IDLR_DISCORD_WEBHOOK`
   est défini (même webhook que `notify.cjs` du moissonneur).

```bash
node maj.cjs                # tout
node maj.cjs --sans-idlr    # garde la base d'actes existante
node maj.cjs --dry          # montre ce qui serait fait
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
au lieu d'être perdue jusqu'au semestre d'après. Éditer les chemins dans
`croisement.service` si le dossier n'est pas dans `/home/ubuntu/`.

Sans systemd, l'équivalent cron :

```cron
0 3 1 1,7 * cd /home/ubuntu/croisement_mg_idlr && /usr/bin/node maj.cjs >> maj.log 2>&1
```

Le semestre est un compromis assumé : les deux sites sont alimentés par des
bénévoles, au fil de l'eau. Plus fréquent ne rapporterait presque rien et
pèserait sur deux serveurs associatifs ; moins fréquent laisserait dormir des
apports pendant un an.

---

## 8. Tests

```bash
npm test                        # les trois suites ci-dessous

node test/test_croisement.cjs   # 37 assertions, bout en bout, hors ligne
node test/test_filae.cjs        # 55 assertions sur la provenance Filae
node filae.cjs                  # 27 assertions sur le magasin de saisie
node croiser.cjs --selftest     # concordance des noms + état des sources
```

`test_croisement.cjs` fabrique un index MG et un `actes.csv` de synthèse dans un
dossier temporaire, lance le croisement, puis vérifie les compteurs **et** le
contenu des trois CSV. Les cas piégeux y sont volontaires : série ambiguë,
matricule écrit `N°2-537`, numéro hors plage, et un champ `obs` contenant
virgule, guillemets et saut de ligne — celui qui casse un découpage naïf.

`test_filae.cjs` vérifie ce qui doit rester cohérent quand on ajoute une
provenance : la ligne, la légende, la barre et la frise donnent-elles les mêmes
nombres ? Le plancher de 2 px est-il bien posé ? Un matricule déjà connu est-il
refusé ? Et surtout le cas qui n'arrivera que dans six mois — un moissonnage
qui rattrape une saisie : la ligne doit changer de provenance sans perdre la
trace de la saisie **ni** compter le numéro deux fois.

`filae.cjs --selftest` couvre l'écriture CSV, où se cachent les pièges
classiques : un nom contenant une virgule, des guillemets (`dit "le grand"`) ou
un saut de ligne doit revenir intact après un aller-retour sur disque.

---

## 9. Courtoisie

Les deux sites sont tenus par des bénévoles, et leurs données appartiennent à
leurs contributeurs et releveurs. Ce dossier ne fait que **comparer** ce que les
deux moissonneurs ont déjà collecté ; il n'ajoute qu'un seul appel réseau récurrent
— les 26 requêtes MG, deux fois par an. Avant de leur renvoyer les écarts,
un mot aux auteurs vaut mieux qu'un fichier brut :
`https://cherchemg.fr/contact.php`.
