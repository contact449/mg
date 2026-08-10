# Moissonneur IDLR

Récupère les actes de iledelareunion-archive.com (commune par commune, toutes
initiales, **les 5 types : Naissance, Décès, Mariage, Promesse, Divorce**).

Par défaut le CSV ne garde **que les actes portant un n° de matricule**. Pour
tout écrire : `IDLR_ALL=1 node harvest.cjs`.

> Le filtre est appliqué à l'écriture : le script lit quand même toutes les
> pages du site, donc la durée est identique — seul le CSV est plus petit.

Dossier **autonome** : rien à installer, juste Node ≥ 20. Copie le dossier
entier sur le VPS.

## Contenu

| Fichier | Rôle |
|---|---|
| `harvest.cjs` | le moissonneur (couche réseau + énumération) |
| `Config.js` | données communes + mapping (copie de l'API, réutilisée telle quelle) |
| `Parser.js` | parseur HTML→JSON (copie de l'API, réutilisée telle quelle) |
| `package.json` | scripts `start` / `test` |

Les sorties `actes.csv` et `checkpoint.json` sont créées à l'exécution.

## Lancer

```bash
node harvest.cjs            # démarre, ou reprend là où ça s'était arrêté
node harvest.cjs --selftest # vérifs hors-ligne (aucune requête réseau)
```

Pour qu'il survive à une déconnexion SSH, lance-le détaché :

```bash
nohup node harvest.cjs > harvest.log 2>&1 &
tail -f harvest.log        # suivre l'avancement
```

## Mise à jour (le site est alimenté en continu)

Le site n'a pas de « quoi de neuf », mais chaque recherche annonce un **total
d'actes**. Le moissonneur mémorise ce total par bucket (commune/type/initiale)
dans `checkpoint.json`. Pour actualiser plus tard, une fois le premier passage
terminé :

```bash
node harvest.cjs --refresh
```

Il refait une passe légère (1 requête par bucket pour relire le total) et ne
re-récolte **que les buckets dont le total a augmenté**, en **dédoublonnant par
`numero`** (le n° de photo, identifiant unique) — donc pas de doublon dans le
CSV. Beaucoup plus rapide qu'une récolte complète.

> Le tout premier `--refresh` après une récolte faite sans cette version ne fait
> qu'établir les totaux de référence (aucune donnée re-téléchargée) ; les
> `--refresh` suivants détectent les ajouts. Lance-le comme le reste :
> `nohup node harvest.cjs --refresh > refresh.log 2>&1 &`.

## Reprise

Chaque (commune, type, initiale) traité est noté dans `checkpoint.json` et les
actes sont écrits au fur et à mesure dans `actes.csv`. Si ça coupe (VPS, réseau,
Ctrl-C), relance la **même** commande : il saute ce qui est déjà fait.
Pour repartir de zéro : supprime `actes.csv` **et** `checkpoint.json`.

## Réglages (optionnels)

Rien à définir : `node harvest.cjs` marche avec les défauts. Ces variables ne
servent qu'à surcharger un défaut, **en préfixe sur la même ligne** que la
commande. Ce sont des exemples indépendants — n'en mets que celles dont tu as
besoin, et ne lance pas plusieurs récoltes en parallèle.

| Variable | Défaut | Effet |
|---|---|---|
| `IDLR_ALL` | (absent) | `=1` : écrire TOUS les actes, pas seulement les matriculés |
| `IDLR_THROTTLE_MS` | `3000` | délai mini entre requêtes, en ms |
| `IDLR_OUT` | `actes.csv` | chemin du CSV de sortie |
| `IDLR_CK` | `checkpoint.json` | chemin du fichier de reprise |

Exemple (tout garder + un peu plus rapide) :

```bash
IDLR_ALL=1 IDLR_THROTTLE_MS=2000 node harvest.cjs
```

Le throttle par défaut (3 s) est volontairement poli : serveur associatif
bénévole. En continu 24/7, compter **~15 à 26 h** selon la taille réelle de la
base (le vrai chiffre se lit dans les premiers logs).

## Résultat

CSV, une ligne par acte. Colonnes :

```
matricule,type_acte,commune,date_iso,nom,prenom,sexe,
conjoint_nom,conjoint_prenom,age,origine,obs,numero,url_demande_photo
```

Pour ne garder que les personnes matriculées : filtre les lignes où `matricule`
n'est pas vide (Excel/LibreOffice, ou `awk -F, '$1!=""' actes.csv`).

> Courtoisie : préviens le webmaster avant de lancer (User-Agent identifiant
> déjà présent dans les requêtes).
