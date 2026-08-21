# Généalogie des engagés — les trois applications

Ce dépôt réunit trois applications qui répondent ensemble à une seule question :
**quels engagés de La Réunion (1839–1911) portent quel numéro de Matricule
Générale, et que sait-on d'eux ?**

Deux sites associatifs détiennent chacun la moitié de la réponse, et aucun des
deux n'expose d'API. Les trois applications les moissonnent poliment, les
comparent, et rendent le résultat consultable.

> **Ce README couvre les trois applications de généalogie.**
> `mon-projet/README.md` documente une **quatrième** application, sans rapport :
> « Archives — Gestion des demandes d'actes », la web app Apps Script + React
> d'OCI Express. Les deux cohabitent dans le dépôt, et ne partagent qu'un
> client IDLR recopié (voir § 8, *Les pièges*).

---

## 1. En un coup d'œil

| Application | Ce qu'elle fait | Ce qu'elle produit |
|---|---|---|
| [`cherche_mg/`](mon-projet/cherche_mg/) | Récolte **cherchemg.fr** : la liste des matricules et les fiches d'engagés | `mg_matricules.csv`, `mg_fiches.csv` |
| [`ile_archive_de_la_reunion/`](mon-projet/ile_archive_de_la_reunion/) | Récolte **iledelareunion-archive.com** : les actes d'état civil | `actes.csv`, `actes.db` |
| [`croisement_mg_idlr/`](mon-projet/croisement_mg_idlr/) | **Compare** les deux récoltes. Ne moissonne rien | `communs.csv`, les deux fichiers d'écarts, `resume.json` |

Les deux premières **collectent**, la troisième **compare**. C'est toute
l'architecture.

---

## 2. Le domaine, en cinq phrases

- De 1839 à 1911, les engagés arrivés à La Réunion reçoivent un numéro de
  **Matricule Générale** (MG), de 1 à environ 130 000.
- **cherchemg.fr** (Laurent Coutaye, bénévole) recense ces matricules avec
  l'identité de l'engagé, son origine, son convoi.
- **iledelareunion-archive.com** (association Arbre, dépouilleurs bénévoles)
  relève les actes d'état civil — naissances, décès, mariages, promesses,
  divorces — dont les **observations** citent souvent un « n° … » qui est, la
  plupart du temps, une matricule générale.
- Aucun des deux ne connaît tout ce que l'autre connaît. Le rapprochement des
  deux produit un travail de complétion utilisable par les deux communautés.
- **Attention** : un « n° » lu dans un acte n'est pas *garanti* être une
  matricule générale — ce peut être une matricule communale. Le taux de
  recouvrement calculé par la troisième application est précisément le test qui
  tranche. Voir `croisement_mg_idlr/README.md`, § 2.

---

## 3. Les trois applications

### `cherche_mg/` — les matricules et les engagés

Deux moitiés qui font le même métier à deux échelles :

- **Module Apps Script** (`Config.gs`, `Parser.gs`, `Client.gs`, `Api.gs`,
  `Stats.gs`, `Engages.gs` + `Vue.html`, `Recherche.html`) — un proxy JSON
  au-dessus du site, un tableau de bord et un écran de recherche dans Google
  Sheets. C'est lui qui construit l'index : `mgDemarrerBalayage()`, **26
  requêtes en ~90 s**.
- **Moissonneur Node** (`moissonneur/harvest.cjs`) — le même travail hors de
  Google, pour ce qu'Apps Script ne peut pas faire.
- **Deux pages locales** — `moissonneur/recherche.cjs` (port 8094) rejoue
  l'écran « Rechercher un engagé… », `moissonneur/chiffres.cjs` (port 8095)
  rejoue le tableau de bord « Chiffres clés ». Sans classeur ni compte Google,
  et **sans réécrire quoi que ce soit** : `Engages.js`, `Stats.js` et
  `Vue.html` sont des copies conformes chargées dans un contexte `vm`, à qui
  Node substitue seulement la lecture des CSV. Les écrans locaux et ceux du
  classeur ne peuvent donc pas diverger.

La récolte se fait en deux phases très différentes :

| | Phase 1 — l'index | Phase 2 — les fiches |
|---|---|---|
| Requête | `POST /patro.php` × 26 | `GET /mg.php?MgChaine=N`, une par matricule |
| Durée | ~90 s | **~33 h** pour 20 000 matricules |
| Sortie | `mg_matricules.csv` | `mg_fiches.csv` |
| Apps Script sait faire ? | oui | non — il coupe à 6 min par exécution |

La phase 1 tient en 26 requêtes grâce à une trouvaille de reverse engineering :
le champ `PatroChaine` n'est validé que **côté client**, le serveur accepte donc
une seule lettre et renvoie des dizaines de milliers de lignes d'un coup.
Énumérer les fiches une à une demanderait 130 000 requêtes, soit ~9 jours.

### `ile_archive_de_la_reunion/` — les actes d'état civil

Même découpage, mais le moissonneur y est bien plus outillé parce que la récolte
dure une nuit entière.

- **Module Apps Script** (`Config.gs`, `Parser.gs`, `Client.gs`, `Api.gs`) — un
  proxy JSON, sans interface. Le site impose une **session PHP** : GET du
  formulaire pour poser le cookie et fixer le périmètre, puis POST des critères,
  puis pagination en GET. Le module reproduit ce flux à l'identique.
- **Moissonneur Node** (`moissonneur/`) — sept scripts, chacun avec son rôle :

| Script | Rôle | Port |
|---|---|---|
| `harvest.cjs` | la récolte : ~3 250 buckets (commune × type × initiale), ~35 000 requêtes, **15 à 28 h** | — |
| `importer.cjs` | `actes.csv` → `actes.db` (SQLite), en écartant les doublons | — |
| `search.cjs` | moteur de recherche dans les actes | 8091 |
| `serve.cjs` | tableau de bord d'une récolte en cours | 8080 |
| `superviseur.cjs` | relance `harvest.cjs` quand il meurt, attente doublante et abandon final | — |
| `notify.cjs` | suivi Discord (lit seulement le checkpoint et le heartbeat) | — |
| `fixmat.cjs` | réparation ponctuelle de la colonne `matricule` dans la base | — |

`actes.csv` est la **source de vérité** ; `actes.db` n'est qu'un index de
consultation, refabriqué en une commande. Les deux ne se dédoublonnent pas
pareil : la clé d'unicité est la **ligne entière**, surtout pas `numero` —
celui-ci identifie une *photo*, et une même photo porte souvent les deux époux
d'un mariage, chacun avec sa matricule. Dédoublonner sur `numero` détruirait
6 647 matricules sur 22 399. Le selftest de `importer.cjs` verrouille ce point.

### `croisement_mg_idlr/` — la comparaison

Pas de partie Apps Script, pas de moissonnage : **du Node pur qui lit deux
sorties et les compare**. Il tourne sur le VPS parce que c'est là que vivent les
actes, qui n'iront jamais dans Google Sheets.

| Commande | Rôle | Port |
|---|---|---|
| `node croiser.cjs` | le croisement et ses cinq fichiers de sortie | — |
| `node serve.cjs` | tableau de bord du croisement | 8092 |
| `node recherche.cjs` | **recherche croisée** : une requête dans les trois sources à la fois, une ligne par matricule | 8093 |
| `node maj.cjs` | la mise à jour semestrielle, de bout en bout | — |
| `node mg.cjs` / `node idlr.cjs` | diagnostics : « que vois-tu de ton côté ? » | — |

Le croisement répond dans les deux sens :

| Question | Sortie |
|---|---|
| Les matricules lus dans les actes sont-ils connus de MG ? | `idlr_absents_de_mg.csv` |
| Les matricules de MG apparaissent-ils dans les actes ? | `mg_absents_didlr.csv` |
| Les deux à la fois, avec test de ressemblance des noms | `communs.csv` |

`idlr_absents_de_mg.csv` est le livrable le plus directement utile : des
matricules **sourcés par un acte d'état civil**, photo à l'appui, que
cherchemg.fr ne connaît pas encore.

La recherche croisée (port 8093) ajoute une **troisième provenance** : `mg oci`,
la saisie manuelle. C'est le seul endroit de toute la chaîne où une application
*écrit* une donnée métier, dans `mgoci.csv`. Un matricule déjà présent dans une
des deux bases y est refusé — mg oci comble les trous, il ne double pas
l'existant, sans quoi la couverture compterait deux fois le même numéro.

---

## 4. Comment les trois s'articulent

### Le contrat entre applications, ce sont des fichiers

Aucune application n'appelle l'API d'une autre. Elles s'échangent des **CSV
posés sur le disque**, dont les colonnes sont lues **par leur nom, jamais par
leur position**. C'est ce qui permet de remplacer une source par une autre sans
rien reconfigurer, et de copier chaque dossier seul sur le VPS.

```
              cherchemg.fr                        iledelareunion-archive.com
             (site bénévole)                           (site bénévole)
                    |                                         |
      26 req. ~90 s |  1 req. / matricule       ~35 000 req. / 15 à 28 h
                    v                                         v
   +---------------------------------+     +---------------------------------+
   |  cherche_mg/moissonneur         |     |  ile_archive.../moissonneur     |
   |  harvest.cjs                    |     |  harvest.cjs                    |
   +---------------------------------+     +---------------------------------+
          |                  |                              |
   mg_matricules.csv   mg_fiches.csv                    actes.csv
   (23 892 lignes)     (27 125 lignes)                (39 369 lignes)
          |                  |                              |
          |                  |                        importer.cjs
          |                  |                              v
          |                  |                          actes.db  -->  search.cjs
          |                  |                     (34 209 uniques)        :8091
          |                  |                              |
          v                  v                              v
   +-----------------------------------------------------------------------+
   |  croisement_mg_idlr                                                   |
   |    croiser.cjs          -> communs.csv, les 2 écarts, resume.json     |
   |    serve.cjs      :8092 -> tableau de bord du croisement              |
   |    recherche.cjs  :8093 -> recherche croisée + saisie -> mgoci.csv    |
   |    maj.cjs              -> relance les deux moissonneurs, puis croise |
   +-----------------------------------------------------------------------+
```

### Qui lit quoi, exactement

| Producteur | Fichier | Consommateur |
|---|---|---|
| `cherche_mg/moissonneur` | `mg_matricules.csv` | `croiser.cjs` (variable `MG_OUT`) |
| `cherche_mg/moissonneur` | `mg_fiches.csv` | `recherche.cjs`, en repli |
| **personne** — fichier déposé à la main | `cherche_mg/engages.csv` | `recherche.cjs`, **source MG préférée** ; import vers la feuille `MG_Engages` |
| `ile_archive.../moissonneur` | `actes.csv` | `importer.cjs`, `croiser.cjs`, `recherche.cjs` |
| `importer.cjs` | `actes.db` | `search.cjs` (8091), `croiser.cjs` |
| `recherche.cjs` | `mgoci.csv` | `recherche.cjs` lui-même — personne d'autre |

`engages.csv` (27 096 lignes) est le seul fichier de la chaîne qu'**aucune
commande ne régénère** : il se dépose à la main, et `Engages.gs` sait
l'importer dans Google Sheets. S'il manque, `recherche.cjs` retombe sur
`mg_fiches.csv`, puis sur `mg_matricules.csv` — les colonnes étant lues par
leur nom, les trois formats conviennent sans réglage.

**Deux consommateurs, deux sources MG différentes**, et ce n'est pas un oubli :
`croiser.cjs` a besoin de l'index complet (`mg_matricules.csv`, 19 541
matricules distincts) pour compter des présences ; `recherche.cjs` a besoin de
fiches riches à afficher, d'où `engages.csv` en premier. Les chemins se
surchargent par les **mêmes variables d'environnement que les moissonneurs**
(`MG_OUT`, `IDLR_OUT`, `IDLR_DB`) : un chemin se déclare une fois pour toute la
chaîne.

### La seule dépendance de code

`croisement_mg_idlr/maj.cjs` **lance les deux moissonneurs** par leur chemin
relatif, dans cet ordre :

1. `ile_archive_de_la_reunion/moissonneur/superviseur.cjs --refresh` — relit le
   total de chaque bucket et ne re-récolte que ceux qui ont grossi. 15 à 28 h,
   sous supervision : `harvest.cjs` abandonne après 5 échecs d'affilée, et sur
   une nuit entière ça arrive.
2. `cherche_mg/moissonneur/harvest.cjs --index --force` — 26 requêtes, ~90 s.
3. Le croisement, puis le rapport Discord — **le bilan part ici**, pas à la fin.
4. `cherche_mg/moissonneur/harvest.cjs --fiches` — ~33 h. En dernier, parce que
   le croisement lit `mg_matricules.csv` et jamais `mg_fiches.csv` : les mettre
   avant retarderait le rapport de deux jours sans rien y ajouter.

C'est le seul endroit où une application en exécute une autre. Si un moissonneur
est absent, `maj.cjs` le dit et continue plutôt que d'échouer.

Un timer systemd déclenche cet enchaînement le **1ᵉʳ janvier et le 1ᵉʳ juillet à
03h00** (`croisement_mg_idlr/systemd/`), avec `Persistent=true` pour rattraper
un VPS éteint. Pendant l'exécution, `node maj.cjs --etat` dit quelle étape
tourne et depuis quand ; avec un webhook Discord, la mise à jour se signale
d'elle-même du démarrage à la fin. Voir `croisement_mg_idlr/README.md`, § 7.

### Ce qu'aucune application ne fait

- **Le croisement ne moissonne rien.** Chaque source possède sa propre collecte.
- **Les moissonneurs ne comparent rien.** Ils écrivent un CSV, point.
- **Rien n'écrit dans les fichiers d'une autre application**, à une exception
  près : `maj.cjs` déclenche leur écriture en les exécutant.

---

## 5. Ce qui est identique dans les trois

Ces conventions se retrouvent partout. Les connaître évite de les redécouvrir
trois fois.

**Dossier autonome.** Aucune dépendance npm, Node ≥ 20 suffit (le dépôt tourne
sur Node 24, voir `.nvmrc`). Chaque dossier se copie seul sur le VPS. Les
scripts résolvent leurs fichiers par `__dirname`, jamais par le répertoire
courant — mais `node search.cjs` n'existe que dans le dossier du script :
**préférer `npm run`**, dont les noms sont identiques dans un dossier et dans
son `moissonneur/`.

**Les copies conformes.** `Config`, `Parser` et — côté MG — `Engages` existent
en double : une version `.gs` pour Apps Script, une version `.js` chargée dans
un contexte `vm` par les outils Node. Elles sont **identiques à l'octet près**
— vérifié — et les selftests refusent de passer si elles ont dérivé. Après une
évolution du module Apps Script :

```bash
cp ../Config.gs Config.js && cp ../Parser.gs Parser.js
cp ../Engages.gs Engages.js && cp ../Stats.gs Stats.js && cp ../Vue.html Vue.html
node harvest.cjs --selftest && node recherche.cjs --selftest && node chiffres.cjs --selftest
```

C'est ce qui permet de faire tourner du code Apps Script hors de Google sans le
réécrire : le moissonneur emprunte le parser du site, la recherche des engagés
emprunte le moteur de filtrage de l'écran Sheets, et le tableau de bord local
sert carrément le **fichier de vue du module**, chiffres injectés là où Apps
Script injecte les siens.

`Env.js` est la troisième copie conforme, présente à l'identique dans les trois
dossiers Node.

**Dev par défaut, prod déclarée.** Sans `OCI_ENV`, on est en développement, et
**toute requête vers les deux sites est refusée**. Les selftests, l'import, les
serveurs de consultation et le croisement restent libres : on développe toute la
chaîne sans jamais toucher aux sites. Détails dans
[`ENVIRONNEMENTS.md`](mon-projet/ENVIRONNEMENTS.md).

**Reprise après coupure.** IDLR note chaque bucket traité dans
`checkpoint.json` ; la phase 2 de MG n'a pas d'état séparé du tout — **le
fichier de sortie EST le checkpoint**, relu au démarrage pour sauter ce qui est
fait, y compris les matricules sans fiche, tracés `statut=absent`. Dans les deux
cas : relancer la même commande.

**Politesse envers les sites.** Throttle de 3 s par défaut, User-Agent qui nous
identifie avec une adresse de contact, abandon plutôt que martèlement quand un
site ne répond plus. Les deux sites sont tenus par des bénévoles ; une récolte
complète représente des heures de leur bande passante. Prévenir avant :
`webmaster@iledelareunion-archive.com` et `cherchemg.fr/contact.php`.

**Tests hors ligne.** Chaque application se teste sans réseau, sur des pages
réelles enregistrées en fixtures :

```bash
cd mon-projet/cherche_mg                && npm test
cd mon-projet/ile_archive_de_la_reunion && npm test
cd mon-projet/croisement_mg_idlr        && npm test
```

**Les données ne sont pas dans le dépôt.** `.gitignore` écarte tous les `*.csv`,
`*.db`, checkpoints et journaux : ils vivent sur le VPS et se régénèrent. Un
dépôt fraîchement cloné n'a donc **aucune donnée** — c'est normal, voir § 7.

---

## 6. Où ça tourne

| Service | Port | Source lue | Application |
|---|---|---|---|
| Tableau de bord de récolte IDLR | 8080 | `checkpoint.json` + `actes.csv` | `ile_archive_de_la_reunion` |
| Recherche dans les actes | 8091 | `actes.db` | `ile_archive_de_la_reunion` |
| Tableau de bord du croisement | 8092 | `resume.json` + `historique.json` | `croisement_mg_idlr` |
| Recherche croisée + saisie mg oci | 8093 | `actes.csv` + `engages.csv` + `mgoci.csv` | `croisement_mg_idlr` |
| Recherche des engagés | 8094 | `engages.csv`, sinon `mg_fiches.csv` | `cherche_mg` |
| Chiffres clés des engagés | 8095 | `mg_matricules.csv` + `mg_fiches.csv` | `cherche_mg` |

Sur le VPS, ces ports passent par WireGuard (`http://10.0.0.1:8091`) ou par un
tunnel SSH :

```bash
ssh -p 2222 -L 8091:localhost:8091 ubuntu@10.0.0.1
```

`HOST` vaut `0.0.0.0` par défaut : c'est l'adresse d'**écoute**, pas une adresse
à taper dans un navigateur. Ouvrir `localhost`.

Les deux modules Apps Script, eux, sont hébergés chez Google et se déploient par
`clasp`. Un projet Apps Script n'a **qu'un seul `doGet()`** : réunir les deux
modules dans un même projet demande d'aiguiller à la main (voir
`cherche_mg/README.md`, § 3).

---

## 7. Reprendre le projet — dans cet ordre

```bash
cd mon-projet

# 1. Vérifier que tout est cohérent, sans réseau et sans données.
cd cherche_mg                && npm test && cd ..
cd ile_archive_de_la_reunion && npm test && cd ..
cd croisement_mg_idlr        && npm test && cd ..
```

Les trois suites doivent passer sur un dépôt vierge. Elles vérifient aussi que
les copies conformes n'ont pas dérivé — c'est ce contrôle qui a rattrapé, dès sa
première exécution, un `Config.js` laissé en arrière.

```bash
# 2. Se procurer des données. Deux voies.
#    a) récupérer actes.csv et mg_matricules.csv du VPS (le plus rapide) ;
#    b) fabriquer l'index MG sur place — 26 requêtes, 3 à 4 min :
cd cherche_mg/moissonneur && OCI_RESEAU=1 node harvest.cjs --index
```

La récolte IDLR complète, elle, prend 15 à 28 h : la rapatrier vaut mieux que la
refaire. Une récolte partielle interrompue par `Ctrl-C` suffit largement pour
développer, le checkpoint reprend.

```bash
# 3. Fabriquer la base de consultation, puis regarder.
cd ile_archive_de_la_reunion && npm run import && npm run search        # :8091
cd ../croisement_mg_idlr     && node croiser.cjs && node recherche.cjs  # :8093
cd ../cherche_mg             && npm run recherche                       # :8094
cd ../cherche_mg             && npm run chiffres                        # :8095
```

`croiser.cjs` affiche un **diagnostic** en fin d'exécution. Au 20/08/2026 il
donnait : 9 059 matricules communs, 11 523 connus des seules Archives, 10 482
connus du seul MG, soit **44 % et 46,4 % de recouvrement** — « même série, mais
les deux bases se complètent largement ». Sous 15 %, il faut s'arrêter : ce
seraient deux numérotations différentes, et comparer n'aurait aucun sens.

---

## 8. Les pièges qui coûtent une journée

**Le client IDLR existe en trois exemplaires, dont un divergent.**
`ile_archive_de_la_reunion/Parser.gs` et sa copie dans `moissonneur/` sont
identiques, et les selftests les gardent telles. Mais `src/server/IdlrParser.js`,
dans l'app « Archives », est une **copie plus ancienne** (16 169 octets contre
18 653) que rien ne surveille. Corriger le parser IDLR sans y penser ne corrige
donc pas l'app « Archives ».

**Un « n° » dans un acte n'est pas forcément une matricule générale.** C'est
l'avertissement du site lui-même. Le taux de recouvrement est le test ; tout
numéro hors 1..130 000 est écarté et compté à part.

**Sous 11 000, une égalité de numéro ne prouve pas grand-chose.** Plusieurs
séries ont coexisté : un même numéro peut porter des engagés sans rapport. La
colonne `serie_ambigue` le signale ligne à ligne.

**Ne jamais dédoublonner les actes sur `numero`.** Voir § 3.

**Le site IDLR force `www.`** — taper le domaine sans, et le POST perd son corps
dans la redirection.

**Les colonnes se lisent par leur nom.** Ajouter une colonne à un CSV écrit en
fin de fichier sans réaligner l'en-tête produit des lignes plus larges que leur
en-tête : le fichier devient incohérent en silence. `harvest.cjs` réaligne donc
`actes.csv` avant toute écriture et garde l'original en `.avant-migration`.

**En dev, le réseau est bloqué**, et c'est voulu. `OCI_RESEAU=1` pour un appel
ponctuel, jamais pour une récolte complète depuis un poste de travail.

---

## 9. Où lire la suite

| Document | Ce qu'on y trouve |
|---|---|
| [`mon-projet/ENVIRONNEMENTS.md`](mon-projet/ENVIRONNEMENTS.md) | dev / prod, `OCI_ENV`, garde-fou réseau, planification |
| [`mon-projet/cherche_mg/README.md`](mon-projet/cherche_mg/README.md) | reverse engineering de cherchemg.fr, balayage, écrans Sheets, endpoints |
| [`mon-projet/cherche_mg/SCHEMA.md`](mon-projet/cherche_mg/SCHEMA.md) | format des réponses JSON |
| [`mon-projet/cherche_mg/moissonneur/README.md`](mon-projet/cherche_mg/moissonneur/README.md) | les deux phases, reprise, réglages |
| [`mon-projet/ile_archive_de_la_reunion/README.md`](mon-projet/ile_archive_de_la_reunion/README.md) | flux de session PHP, endpoints, table des codes communes |
| [`mon-projet/ile_archive_de_la_reunion/SCHEMA.md`](mon-projet/ile_archive_de_la_reunion/SCHEMA.md) | colonnes par type d'acte |
| [`mon-projet/ile_archive_de_la_reunion/moissonneur/README.md`](mon-projet/ile_archive_de_la_reunion/moissonneur/README.md) | récolte, rafraîchissement, supervision, base SQLite |
| [`mon-projet/croisement_mg_idlr/README.md`](mon-projet/croisement_mg_idlr/README.md) | croisement, concordance des noms, recherche croisée, saisie mg oci |
| [`mon-projet/README.md`](mon-projet/README.md) | l'app « Archives » (Apps Script + React) — projet distinct |
| [`mon-projet/PRESENTATION-DOSSIERS.md`](mon-projet/PRESENTATION-DOSSIERS.md) | les dossiers du VPS OCI Express |

---

## Courtoisie

Les deux sites moissonnés sont tenus par des bénévoles, et leurs données
appartiennent à leurs contributeurs et releveurs. Les colonnes `contributeur` et
`releveur` sont conservées dans chaque fiche récupérée, les sources sont citées,
le débit est limité. Avant toute récolte complète, écrire aux webmasters — un
accord, voire un export direct, vaut mieux que 35 000 requêtes.
