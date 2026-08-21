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
conjoint_nom,conjoint_prenom,pere_nom,pere_prenom,mere_nom,mere_prenom,
pere_decede,mere_decede,parrain,marraine,
age,origine,obs,numero,url_demande_photo
```

**Ce que chaque type d’acte porte réellement** (`SCHEMA.md`, validé sur de
vraies pages) :

| Type | Entourage donné par le site |
|---|---|
| Naissance | `pere_prenom` (82 %), `mere_nom` (98 %), `mere_prenom` (96 %), `pere_decede`, `mere_decede`, `parrain` (22 %), `marraine` |
| Décès | `pere_decede`, `mere_decede` |
| Mariage, promesse, divorce | `conjoint_*`, `pere_*`, `mere_*` |

> **Une naissance donne le prénom du père et le nom complet de la mère**,
> vérifié le 21/08/2026 sur une page réelle : 82 %, 98 % et 96 % des actes
> sondés. `SCHEMA.md` affirmait le contraire ; il était périmé, il est corrigé.
>
> Le site ne donne **pas** le NOM du père sur une naissance (0 %) : c’est le
> patronyme de l’enfant, déjà en colonne `nom`. `pere_nom` reste donc vide
> pour les naissances, et on ne l’y recopie pas : 11 % de ces actes sont des
> reconnaissances, où l’enfant peut ne pas porter le nom du père — là
> précisément où l’inférence serait fausse.
>
> Le `obs` d’une naissance, lui, n’apporte rien : sur 13 075 naissances
> relevées, 52 mentionnent un parent (0,4 %).

Pour ne garder que les personnes matriculées : filtre les lignes où `matricule`
n'est pas vide (Excel/LibreOffice, ou `awk -F, '$1!=""' actes.csv`).

> **Courtoisie : préviens le webmaster avant une récolte complète.**
>
> **webmaster@iledelareunion-archive.com** — adresse publiée sur la page
> d’accueil du site. Le site est tenu par l’**association Arbre**, dont les
> relevés sont faits par des bénévoles (« dépouilleurs ») et qui vit d’une
> cotisation de 10 € par an.
>
> Une récolte complète, c’est ~35 000 requêtes sur 28 h de leur bande
> passante. Le User-Agent t’identifie déjà dans leurs journaux
> (`+contact: webmaster@oci-express.re`) — c’est **notre** adresse, celle par
> laquelle ils peuvent nous joindre, pas la leur. Un courriel préalable leur
> évite de découvrir le trafic sans savoir d’où il vient, et vaut mieux qu’un
> blocage d’IP décidé dans l’urgence.
>
> Le délai entre requêtes est réglable : `IDLR_THROTTLE_MS=5000` ralentit si
> on te le demande.


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

## Suivre une récolte en cours

```bash
IDLR_CK=checkpoint-2026.json IDLR_OUT=actes-2026.csv IDLR_HB=heartbeat-2026 \
  npm run suivi-2026        # puis http://localhost:8080
```

L’écran donne le nombre d’actes récoltés, l’avancement, la commune en cours,
le rythme, l’heure de fin estimée et une vignette par commune. Il se
rafraîchit tout seul.

**Deux pourcentages, et il faut les deux.**

| | Répond à |
|---|---|
| **Avancement** | où en est le TRAVAIL |
| **% du relevé précédent** (sous les actes) | si la MOISSON est normale |

Le second est un garde-fou : à mi-parcours on doit être à peu près à la
moitié des 39 369 actes du relevé précédent. Un écart franc signale un
problème — site qui a changé, filtre trop strict — avant qu’on ait perdu 28 h.

> **L’avancement est pondéré par le coût réel des cases.** Compter les cases
> faites traiterait un bucket de 400 actes comme un de 4 000, alors que le
> temps se passe en PAGES (une requête par tranche de 50 actes). Les
> premières communes étant les plus petites, ce comptage annonçait 15 h là où
> le vrai total est de 28 h. Le tableau de bord lit donc la taille de chaque
> case dans le `checkpoint.json` du relevé précédent et s’en sert comme d’un
> devis : ce qui reste est chiffré, pas extrapolé. Sans ce fichier il
> retombe sur le comptage simple.

---

## Rattraper les noms de parents

`actes.csv` porte le **conjoint** depuis toujours (`conjoint_nom`,
`conjoint_prenom`) : 2 963 actes, soit tous les mariages, promesses et
divorces. Le **père** et la **mère** en étaient absents — non parce que le
site les cache, mais parce que `recordToRow()` ne les recopiait pas. Le
parser les lisait déjà (`pere.nom`, `pere.prenom`, `mere.nom`,
`mere.prenom`).

Quatre colonnes ont été ajoutées : `pere_nom`, `pere_prenom`, `mere_nom`,
`mere_prenom`. Elles ne se rempliront que lors d'un moissonnage.

```bash
npm start -- --migrer                 # aligne actes.csv sans rien récolter
npm run refresh -- --types=M,PM,DIV   # ne repasse que sur les actes concernés
npm run import                        # actes.csv -> actes.db
```

**`--types` évite de tout refaire.** Les noms de parents ne figurent que sur
les actes qui portent ces colonnes — les mariages, pour l'essentiel. Sans
l'option, il faudrait repasser sur les 39 000 actes dont 36 000
n'apprendraient rien.

**La migration est automatique et sans perte.** Le moissonneur ÉCRIT EN FIN
DE FICHIER : ajouter une colonne sans réaligner l'en-tête produirait des
lignes plus larges que leur en-tête, et le fichier deviendrait incohérent en
silence — le pire des dégâts, parce qu'il ne se voit qu'à la relecture.
`harvest.cjs` réaligne donc `actes.csv` avant toute écriture, en remettant
les colonnes **par nom** et jamais par position. L'original est conservé en
`actes.csv.avant-migration`. Une colonne ancienne que le moissonneur ne
connaîtrait pas provoque un **refus**, pas un abandon silencieux.

Vérifié sur les 39 369 lignes réelles : **551 166 valeurs comparées, aucun
écart**, y compris les 1 889 champs `obs` contenant une virgule et les 75
contenant des guillemets.

`search.cjs` s'adapte tout seul : il lit le schéma de `actes.db` au démarrage
et ne demande les colonnes parents que si elles existent. Une base ancienne
continue donc de répondre — les demander sans vérifier ferait échouer la
requête entière, donc plus aucun résultat, pour une colonne d'appoint.

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
