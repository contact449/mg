# Moissonneur MG

Récupère cherchemg.fr en deux phases et l'écrit en CSV. Pendant du
[moissonneur IDLR](../../ile_archive_de_la_reunion/moissonneur/README.md), même
conception : dossier **autonome** (rien à installer, juste Node ≥ 20), throttle
poli, reprise après coupure, fait pour tourner détaché sur un VPS.

## Pourquoi il existe

Le module Apps Script `cherche_mg/` sait déjà balayer l'index — c'est
`mgDemarrerBalayage()`, 26 requêtes, ~90 s. Il n'a jamais eu de moissonneur
parce qu'il n'en avait pas besoin.

**La phase 2, elle, ne peut pas y tourner.** Récupérer la fiche détaillée de
chaque matricule demande une requête par numéro, à ~6 s : pour 20 000
matricules, **~33 heures**. Apps Script coupe à 6 minutes par exécution et
plafonne le nombre de déclencheurs. C'est exactement le cas d'usage qui a donné
naissance au moissonneur IDLR, et c'est celui-ci.

| | Phase 1 — l'index | Phase 2 — les fiches |
|---|---|---|
| Requête | `POST /patro.php` × 26 | `GET /mg.php?MgChaine=N` × N |
| Durée | ~90 s | ~33 h pour 20 000 matricules |
| Sortie | `mg_matricules.csv` | `mg_fiches.csv` |
| Apps Script sait faire ? | oui (`mgDemarrerBalayage`) | non — d'où ce dossier |

## Contenu

| Fichier | Rôle |
|---|---|
| `harvest.cjs` | le moissonneur (réseau + les deux phases) |
| `recherche.cjs` | la recherche d'engagés en page web locale (port 8094) |
| `chiffres.cjs` | les chiffres clés en page web locale (port 8095) |
| `Config.js` | **copie conforme** de `../Config.gs`, réutilisée telle quelle |
| `Parser.js` | **copie conforme** de `../Parser.gs`, réutilisée telle quelle |
| `Engages.js` | **copie conforme** de `../Engages.gs` : le moteur de recherche |
| `Stats.js` | **copie conforme** de `../Stats.gs` : le calcul des agrégats |
| `Vue.html` | **copie conforme** de `../Vue.html` : la page du tableau de bord |
| `test/fixtures/` | pages réelles pour le selftest hors ligne |

Les sorties `mg_matricules.csv`, `mg_fiches.csv` et `mg_etat.json` sont créées à
l'exécution.

Comme pour IDLR, le parser n'est pas réécrit : les deux copies sont chargées
dans un contexte `vm`, seule la couche réseau est en Node. Après une évolution
du module Apps Script, resynchronise :

```bash
cp ../Config.gs Config.js && cp ../Parser.gs Parser.js
cp ../Engages.gs Engages.js && cp ../Stats.gs Stats.js && cp ../Vue.html Vue.html
node harvest.cjs --selftest      # Config.js et Parser.js
node recherche.cjs --selftest    # Config.js et Engages.js
node chiffres.cjs --selftest     # Config.js, Stats.js et Vue.html
```

## Lancer

```bash
node harvest.cjs                 # index si périmé, puis fiches (reprise)
node harvest.cjs --index         # phase 1 seule (~90 s)
node harvest.cjs --fiches        # phase 2 seule
node harvest.cjs --limite 200    # borne la phase 2, pour un essai
node harvest.cjs --selftest      # hors ligne, aucune requête

node recherche.cjs               # la recherche d'engagés, http://localhost:8094
node recherche.cjs --selftest    # 39 assertions, hors ligne

node chiffres.cjs                # les chiffres clés,       http://localhost:8095
node chiffres.cjs --selftest     # 37 assertions, hors ligne
```

`recherche.cjs` et `chiffres.cjs` servent les deux écrans du module sans
classeur : ils chargent les copies conformes dans un contexte `vm` et leur
substituent la lecture des CSV. `chiffres.cjs` va plus loin — il sert le
**fichier `Vue.html` du module**, chiffres injectés là où Apps Script injecte
les siens. Voir [`../README.md`](../README.md), § « La même recherche en local »
et § « Le même tableau de bord en local ».

Pour survivre à une déconnexion SSH :

```bash
nohup node harvest.cjs --fiches > harvest.log 2>&1 &
tail -f harvest.log
```

## Reprise

**Le fichier de sortie EST le checkpoint.** Au démarrage, la phase 2 relit
`mg_fiches.csv` et saute les matricules déjà traités — y compris ceux dont le
site n'a pas de fiche, tracés avec `statut=absent` pour ne pas être redemandés à
chaque reprise. Aucun état séparé à garder cohérent avec la sortie.

Si ça coupe (VPS, réseau, Ctrl-C), relance la **même** commande. Pour tout
refaire : supprime `mg_fiches.csv`.

## Réglages (optionnels)

| Variable | Défaut | Effet |
|---|---|---|
| `MG_THROTTLE_MS` | `3000` | délai mini entre deux requêtes |
| `MG_OUT` | `mg_matricules.csv` | chemin de l'index |
| `MG_FICHES` | `mg_fiches.csv` | chemin des fiches |
| `MG_ETAT` | `mg_etat.json` | date et compteurs du dernier index |
| `MG_ENGAGES` | `../engages.csv` | source préférée de `recherche.cjs` |
| `MG_SANS` | `mg_sans_numero.csv` | identités sans numéro, pour `chiffres.cjs` |
| `PORT` / `HOST` | `8094` / `8095` | écoute de `recherche.cjs` / `chiffres.cjs` |
| `MG_UA` | User-Agent OCI | identification auprès du site |

Le throttle par défaut est volontairement poli : le site est tenu par un
bénévole, et il s'auto-limite déjà à ~1 requête / 6 s.

## Résultat

`mg_matricules.csv` — une ligne par (matricule, identité, source) :

```
matricule,identite,source,trouve_par
```

`mg_fiches.csv` — une ligne par engagé (donc parfois plusieurs par matricule) :

```
matricule,statut,identite,origine,naissance,arrivee,convoi,immatriculation,
notes,sources,contributeur,releveur,immat_entre_le,immat_et_le,recupere_le
```

`statut` vaut `trouve` ou `absent`. Les colonnes **contributeur** et
**releveur** sont conservées : le site précise que les données dépouillées sont
la propriété des releveurs.

## Qui consomme ces fichiers

`croisement_mg_idlr/` lit `mg_matricules.csv` pour le rapprochement avec les
actes des Archives. Il ne moissonne rien lui-même : chaque module source possède
sa collecte, le croisement se contente de comparer deux sorties.

> Courtoisie : le site indique un usage personnel et non commercial, et les
> données appartiennent à leurs contributeurs et releveurs. Un mot à l'auteur
> avant une récolte complète : <https://cherchemg.fr/contact.php>.
