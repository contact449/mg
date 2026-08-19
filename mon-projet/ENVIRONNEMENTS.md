# Dev et prod — les trois applications

Deux principes gouvernent tout ce qui suit.

**1. Dev par défaut.** Sans `OCI_ENV`, on est en développement. La production
doit être déclarée ; on ne bascule jamais en prod par oubli.

**2. Rien de dangereux sans autorisation.** En dev, toute requête vers
cherchemg.fr ou iledelareunion-archive.com est refusée. Ces deux sites sont
tenus par des bénévoles, et une commande lancée par mégarde représente des
heures de trafic sur leur serveur.

---

## 1. Vue d'ensemble

| | Dev | Prod |
|---|---|---|
| Node (les 3 apps) | ton poste, `OCI_ENV` absent | le VPS, `OCI_ENV=prod` |
| Requêtes vers les sites réels | **refusées** | autorisées |
| Apps Script | projet `…-DEV` + classeur de dev | projet `…-PROD` + classeur réel |
| Planification semestrielle | jamais | timer systemd uniquement |

```bash
# bash / VPS
OCI_ENV=prod node maj.cjs

# PowerShell
$env:OCI_ENV = "prod"; node maj.cjs
```

---

## 2. Côté Node

Le noyau est `Env.js`, **copie conforme** présente dans les trois dossiers
(`ile_archive_de_la_reunion/moissonneur/`, `cherche_mg/moissonneur/`,
`croisement_mg_idlr/`). Chaque dossier reste ainsi copiable seul sur le VPS.
Les selftests vérifient que les copies n'ont pas dérivé.

| Variable | Effet |
|---|---|
| `OCI_ENV` | `dev` (défaut) ou `prod`. Une autre valeur est refusée au démarrage. |
| `OCI_RESEAU=1` | autorise, en dev, un appel réel ponctuel |
| `OCI_DONNEES` | déporte la racine des données (rarement utile) |

### Ce que le garde-fou bloque

```
$ node harvest.cjs

Environnement dev : requete vers iledelareunion-archive.com bloquee.

  harvest.cjs va parcourir 3 250 buckets, soit 15 a 26 h de requetes.
  …
Pour un appel reel ponctuel depuis le dev :
  bash        OCI_RESEAU=1 <ta commande>
  PowerShell  $env:OCI_RESEAU = "1"; <ta commande>
```

Ce qui **reste libre en dev**, parce que rien ne sort : tous les `--selftest`,
`importer.cjs`, `search.cjs`, `serve.cjs`, `croiser.cjs`, et la lecture des
fichiers déjà récoltés. On peut donc développer et tester toute la chaîne sans
jamais toucher aux sites.

### Savoir où l'on est

Chaque service annonce son environnement au démarrage :

```
[dev] recherche IDLR - reseau bloque (OCI_RESEAU=1 pour autoriser)
[PROD] moissonneur IDLR - reseau autorise
```

Et l'écran de recherche IDLR porte un badge orange **DEV**, absent en prod.

### Les données ne bougent pas

Dev et prod vivent déjà sur des machines différentes : ton poste Windows d'un
côté, le VPS de l'autre. Les chemins par défaut sont donc inchangés — relocaliser
les fichiers casserait les installations existantes sans rien protéger.

---

## 3. Côté Apps Script

Apps Script n'a pas de variables d'environnement : la séparation se fait par
**deux projets distincts**, chacun avec son classeur.

| | Projet DEV | Projet PROD |
|---|---|---|
| Classeur | « MG (dev) » — un extrait suffit | le classeur réel |
| Propriété `MG_ENV` | `dev` (défaut) | `prod`, posé une fois |
| Déploiement web | tête (toujours le dernier code) | déploiement versionné figé |

### Mise en place

1. Créer un second projet Apps Script, et un second classeur.
2. Dans **chaque** projet, lier le classeur : `mgDefinirClasseur('<ID>')`.
3. Dans le projet **PROD uniquement**, déclarer l'environnement, une fois :

```js
mgDefinirEnv('prod')
```

Sans cet appel, un projet se considère en dev — c'est voulu : un projet
fraîchement créé ne peut pas se faire passer pour la production.

4. Pousser le code dans les deux, avec deux fichiers clasp :

```bash
clasp push --project .clasp.dev.json
clasp push --project .clasp.prod.json
```

### Repère visuel

Le tableau de bord et l'écran de recherche affichent un badge **DEV** tant que
`MG_ENV` ne vaut pas `prod`. Deux onglets identiques ne peuvent donc pas être
confondus — c'est le seul garde-fou qui tienne quand les deux projets portent
exactement le même code.

---

## 4. La planification n'existe qu'en prod

`systemd/croisement.service` porte `Environment=OCI_ENV=prod`. Sans cette ligne,
la mise à jour semestrielle tournerait en dev et les deux moissonneurs
refuseraient de sortir — l'unité échouerait bruyamment plutôt que de récolter en
silence depuis une machine de développement.

N'installe le timer **que** sur le VPS.

---

## 5. Vérifier

```bash
cd croisement_mg_idlr && node croiser.cjs --selftest
cd cherche_mg/moissonneur && node harvest.cjs --selftest
cd ile_archive_de_la_reunion/moissonneur && node harvest.cjs --selftest
```

Chacun contrôle son environnement, et deux d'entre eux vérifient en plus que
les copies de `Env.js`, `Config.js` et `Parser.js` n'ont pas dérivé de leur
référence. C'est ce contrôle qui a rattrapé, dès sa première exécution, une
copie de `Config.js` laissée en arrière après une modification du module Apps
Script.
