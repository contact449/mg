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
| `importer.cjs` | `actes.csv` -> `actes.db` (ce que `search.cjs` consulte) |
| `search.cjs` | moteur de recherche dans les actes (port 8091) |
| `serve.cjs` | tableau de bord de la recolte en cours (port 8080) |
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


## Developper en local

Rien a installer : Node >= 20 suffit. Le dossier est autonome.

```bash
cd ile_archive_de_la_reunion/moissonneur
```

**1. Avoir des donnees.** Soit tu recuperes un `actes.csv` du VPS, soit tu
lances une recolte (15 a 26 h — voir plus haut). Une recolte partielle suffit
largement pour developper : `Ctrl-C` est sans danger, le checkpoint reprend.

**2. Fabriquer la base.** `harvest.cjs` ecrit un CSV, mais `search.cjs` et
`fixmat.cjs` travaillent sur SQLite. La conversion se fait ici :

```bash
npm run import                  # actes.csv -> actes.db, ~1 s pour 39 000 actes
npm test                        # verifs hors ligne
```

Rejouable : la table est recreee a chaque fois. Le CSV reste la source de
verite, `actes.db` n'est qu'un index de consultation — il est dans le
`.gitignore` et se refabrique en une commande.

**3. Lancer les deux serveurs.** Ils sont independants :

| Commande | Port | A quoi ca sert | Source |
|---|---|---|---|
| `npm run dashboard` | 8080 | suivre une recolte en cours | `checkpoint.json` + `actes.csv` |
| `npm run search` | 8091 | chercher dans les actes | `actes.db` |

**Prefere `npm run` a `node fichier.cjs`.** `node search.cjs` n’existe que dans
ce dossier ; lance depuis `ile_archive_de_la_reunion/`, Node echoue sur
`MODULE_NOT_FOUND` avant meme d’avoir charge une ligne du projet. `npm run`
repond depuis les deux dossiers, avec les memes noms de commandes, et sur un
nom errone il liste les commandes disponibles. Tous les scripts :

```bash
npm start          # node harvest.cjs          (recolte complete)
npm run refresh    # node harvest.cjs --refresh
npm run import     # node importer.cjs         (actes.csv -> actes.db)
npm run search     # node search.cjs           (port 8091)
npm run dashboard  # node serve.cjs            (port 8080)
npm test           # les deux selftests, hors ligne
```

En local, ouvre simplement `http://localhost:8080` et `http://localhost:8091`.
Pour changer de port ou de fichier :

```bash
PORT=9000 node search.cjs                       # bash
IDLR_DB=/chemin/autre.db node search.cjs
```

```powershell
$env:PORT = "9000"; node search.cjs             # PowerShell
```

**Depuis le VPS**, ces memes ports passent par WireGuard
(`http://10.0.0.1:8091`) ou par un tunnel :

```bash
ssh -p 2222 -L 8091:localhost:8091 ubuntu@10.0.0.1
```

> La partie Apps Script du module (`../Config.gs`, `../Client.gs`...) ne tourne
> pas en local : c'est un proxy JSON heberge chez Google. Le dossier
> `moissonneur/` est la seule partie executable sur ton poste.


## La vue de recherche

`npm run search` sert une page unique qui contient le formulaire ET les
resultats : http://localhost:8091

La recherche est **partageable** : les criteres passent dans l URL et celle-ci
suit chaque requete. Un signet ou un lien envoye a un collegue ramene donc
exactement le meme resultat.

```
http://localhost:8091/?nom=HOARAU
http://localhost:8091/?commune=Le+Tampon&type=N&anneeMin=1900
http://localhost:8091/?mat=537
http://localhost:8091/?matonly=1&anneeMin=1860&anneeMax=1870
```



Parametres reconnus : `nom` `prenom` `commune` `type` `mat` `anneeMin`
`anneeMax` `matonly=1` `page`.

### Doublons du CSV

`actes.csv` contient des **doublons parfaits** : un acte remonte dans
plusieurs buckets du moissonneur, et les recoltes successives se recouvrent.
Sur la base actuelle, 39 369 lignes ne portent que **34 209 releves reels**.
`importer.cjs` les ecarte en construisant `actes.db`, et le compteur de la
page ne compte que les releves uniques.

> La cle d unicite est la **ligne entiere**, surtout pas `numero`. Celui-ci
> identifie une PHOTO, et une meme photo porte souvent plusieurs personnes
> (les deux epoux d un mariage), chacune avec son matricule. Dedoublonner sur
> `numero` ramenerait la base a 22 960 lignes et **detruirait 6 647 matricules
> sur 22 399**. Le selftest de `importer.cjs` verrouille ce point.

## Consulter la base

`search.cjs` sert un moteur de recherche sur `actes.db` :

```bash
node importer.cjs               # si actes.db n existe pas encore
node search.cjs                 # http://<vps>:8091
```

Le formulaire affiche deux compteurs :

| Compteur | Ce qu il compte |
|---|---|
| **N actes dans Archives** | lignes de donnees de `actes.csv` |
| **N matricules dans Archives** | numeros de matricule **distincts** du meme fichier |

Le second n est pas le nombre d actes matricules : un meme matricule revient
souvent sur la naissance, le mariage et le deces d une meme personne.
L infobulle de chaque tag donne les deux chiffres et la source.

**Ils sont comptes dans `actes.csv`, pas dans `actes.db`.** C est deliberé :
le CSV est ce que `harvest.cjs` ecrit au fil de la recolte, alors que la base
est une copie figee au dernier `importer.cjs`. Afficher la base donnerait des
chiffres en retard, parfois de plusieurs heures, sans que rien ne le signale.
Les resultats de recherche, eux, viennent bien de `actes.db`.

Le CSV n est relu que s il a change (taille ou date de modification). S il a
change, on le relit — sauf si la lecture precedente a coute cher : le plancher
vaut 20 fois sa duree, plafonne a 60 s, soit au plus 5 % du temps passe a
recompter. Sur une base de 39 000 actes la lecture prend ~250 ms et les
compteurs suivent le fichier en direct ; sur 250 Mo le plancher protege le
serveur pendant une recolte.

Si `actes.csv` est absent, les compteurs retombent sur `actes.db` et
l infobulle le dit. Si la table n existe pas non plus, ils affichent `?` au
lieu de faire echouer la page.
