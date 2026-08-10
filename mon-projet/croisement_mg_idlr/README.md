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
node serve.cjs           # PORT=8092 HOST=0.0.0.0
```

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

## 6. Mise à jour semestrielle

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

## 7. Tests

```bash
node test/test_croisement.cjs   # 37 assertions, bout en bout, hors ligne
node croiser.cjs --selftest     # concordance des noms + état des deux sources
```

`test_croisement.cjs` fabrique un index MG et un `actes.csv` de synthèse dans un
dossier temporaire, lance le croisement, puis vérifie les compteurs **et** le
contenu des trois CSV. Les cas piégeux y sont volontaires : série ambiguë,
matricule écrit `N°2-537`, numéro hors plage, et un champ `obs` contenant
virgule, guillemets et saut de ligne — celui qui casse un découpage naïf.

---

## 8. Courtoisie

Les deux sites sont tenus par des bénévoles, et leurs données appartiennent à
leurs contributeurs et releveurs. Ce dossier ne fait que **comparer** ce que les
deux moissonneurs ont déjà collecté ; il n'ajoute qu'un seul appel réseau récurrent
— les 26 requêtes MG, deux fois par an. Avant de leur renvoyer les écarts,
un mot aux auteurs vaut mieux qu'un fichier brut :
`https://cherchemg.fr/contact.php`.
