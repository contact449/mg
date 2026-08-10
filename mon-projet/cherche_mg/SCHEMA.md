# Schéma de sortie — validé sur pages réelles de cherchemg.fr

Trois formes de sortie : la **fiche** d'un numéro, l'**index** par identité, et
les **feuilles** du classeur.

---

## 1. Fiche — `mgLookup(n)` / `action=fiche`

Sortie réelle pour `mgLookup(1)` (contexte et convois tronqués) :

```jsonc
{
  "ok": true,
  "mg": 1,
  "statut": "trouve",          // trouve | absent | vide
  "trouve": true,
  "serie_ambigue": true,       // mg < 11000 : plusieurs séries ont coexisté
  "nb_engages": 1,
  "engages": [
    {
      "mg": 1,
      "identite": "Tazana",
      "origine": "Inde",             // Inde | Afrique | Madagascar | ...
      "naissance": "",               // "" si absente ; "1844-00-00" = année seule
      "annee_naissance": null,       // entier ou null
      "arrivee": "1838-08-31",       // "0000-00-00" du site est rendu ""
      "annee_arrivee": 1838,
      "convoi": "",
      "immatriculation": "1838-08-31",
      "notes": "5 ans de prison",
      "sources": "Etat des indiens détenus à la géôle de St Denis - IMG_9931.JPG",
      "contributeur": "Claude Rossignol",
      "releveur": "Laurent Coutaye"   // propriétaire des données (mention du site)
    }
  ],

  // --- indices : déduits de la PLAGE du numéro, pas de l'engagé -------------
  "immatriculation": {                // null si le site ne l'affiche pas
    "mg": 50000, "entre_le": "1855-08-06", "et_le": "1855-09-11"
  },
  "convois": [
    { "navire": "Salomée", "arrivee": "1855-08-06",
      "provenance": "Inde | Pondichéry", "remarques": "Indiens ou Palomée",
      "nombre": 241, "sources": "Le Moniteur ... p377" }
  ],
  "contexte": [
    { "debut": "1828-00-00", "fin": "1937-00-00",
      "evenement": "Début et fin de l'application de l'engagisme réunionnais",
      "sources": "" }
  ],
  "periode_peu_documentee": { "sens": "avant", "date": "1844-01-28" },  // ou null

  "url": "https://cherchemg.fr/mg.php?MgChaine=1",
  "warnings": [],
  "cached": false
}
```

### `statut`

| Valeur | Signification | `engages` |
|---|---|---|
| `trouve` | le numéro est dans la base du site | 1 à N |
| `absent` | numéro valide, pas encore relevé | `[]` |
| `vide` | le site n'a rien renvoyé (`n=0`, saisie non numérique) | `[]` |

`absent` ne veut pas dire « ce matricule n'a pas existé » : les relevés ne sont
pas exhaustifs. Les indices (immatriculation, convois) restent renseignés.

### Plusieurs engagés pour un même numéro

Normal en dessous de 11000, où plusieurs séries de numéros ont coexisté. Exemple
réel, `mgLookup(5)` → 3 engagés sans rapport :

| identite | origine | arrivee | releveur |
|---|---|---|---|
| Ramsamy | Inde | 1839-12-22 | Laurent Coutaye |
| DJETTOU Soura | Inde | | Xavier Lecoq |
| AMADI dit Julien | Afrique | | Xavier Lecoq |

Au-dessus de 11000 (`serie_ambigue: false`) un numéro désigne une seule personne.

### Erreur

```jsonc
{ "ok": false, "error": "Numero de MG invalide : 0 (entier attendu entre 1 et 130000)" }
```

---

## 2. Index par identité — `mgPatro(chaine)` / `action=patro`

```jsonc
{
  "ok": true,
  "chaine": "sam",
  "total": 3574,        // lignes renvoyées par le site
  "avecMg": 2491,       // dont porteuses d'un numéro
  "sansMg": 1083,
  "tronque": 3574,      // présent seulement si opts.max a coupé la liste
  "lignes": [
    {
      "patronyme": "#eyen Ramsamy",
      "source":    "604W34 - Immigration - IMG_0722.JPG",
      "sourceUrl": "",          // rempli si la source est un lien bibliocard.php
      "mg":        75544        // number, ou null si la cellule est vide
    }
  ],
  "warnings": []
}
```

Recherche **« contient »**, insensible à la casse. Une même personne apparaît
autant de fois qu'elle a de sources.

---

## 3. Feuilles du classeur

### `MG_Matricules` — la liste des matricules

| MG | Identite | Source | URL source | Trouve par | Cle |
|---|---|---|---|---|---|
| 75544 | #eyen Ramsamy | 604W34 - Immigration - IMG_0722.JPG | | sam | `75544-1f3k9x2p0` |

Une ligne par **(matricule, identité, source)**. `Trouve par` = la chaîne du
balayage qui a ramené la ligne (traçabilité). `Cle` = `MG + '-' + hash64` :
c'est elle qui rend le balayage idempotent — ne pas la modifier à la main.

Pour la liste des numéros seuls, un tableau croisé dynamique sur la colonne `MG`
suffit ; `mgResume()` en donne directement le compte distinct.

### `MG_Sans_numero` — identités sans matricule

Mêmes colonnes sans `MG`. Environ 27 % des lignes de l'index : l'identité est
relevée, le matricule reste inconnu.

### `MG_Fiches` — détail (phase 2)

`MG · Identite · Origine · Naissance · Arrivee · Convoi · Immatriculation ·
Notes · Sources · Contributeur · Releveur · Immat. entre le · Immat. et le ·
Recupere le`

Une ligne par engagé (donc parfois plusieurs par numéro). Un numéro présent
dans l'index mais sans fiche donne une ligne avec le seul `MG` renseigné : la
trace est conservée, on ne le redemandera pas.

---

## 4. Statistiques — `mgStatistiques()`

Ce que consomme le tableau de bord. Un seul parcours des feuilles.

```jsonc
{
  "ok": true,
  "genere_le": "10/08/2026 11:45",
  "classeur": "https://docs.google.com/spreadsheets/d/…",

  "matriculesDistincts": 18894,   // le chiffre héros
  "engagesDistincts":    22968,   // couples (matricule, identité) distincts
  "lignesIndex":         26007,   // lignes de MG_Matricules
  "identitesSansNumero":  9652,
  "lignesFiches":         4041,
  "plage": { "min": 1, "max": 126033 },

  "serieAmbigue":    4749,        // < 11000
  "seriePrincipale": 14145,       // >= 11000
  "seuilSerie":      11000,

  "tailleTranche": 10000,
  "tranches": [ { "debut": 1, "fin": 10000, "n": 4520 }, … ],   // 13 entrées
  "distribution": [ { "engages": 1, "n": 15824 }, …,
                    { "engages": 4, "n": 193 } ],               // 4 = « 4 et + »
  "releveurs": [ { "nom": "Laurent Coutaye", "n": 1840 }, … ],  // [] avant la phase 2

  "balayage": { … }               // identique à mgEtatBalayage()
}
```

`distribution` renvoie un **nombre**, pas un libellé : les fichiers `.gs` sont
ASCII, la mise en mots accentuée appartient à `Vue.html`.

Invariants vérifiés par les tests : `Σ tranches[].n = matriculesDistincts`,
`Σ distribution[].n = matriculesDistincts`, et
`serieAmbigue + seriePrincipale = matriculesDistincts`.

---

## 5. `warnings[]` — jamais d'échec silencieux

| Code | Sens |
|---|---|
| `CHAMP_INCONNU:x,y` | libellé inattendu dans une fiche (le site a ajouté un champ) |
| `TABLE_ENGAGES_VIDE` | `anchortablemg` présente mais aucune ligne exploitable |
| `MG_INCOHERENT:n` | un engagé porte un numéro différent de celui demandé |
| `LIGNES_IGNOREES:n` | n lignes de l'index n'avaient pas 3 cellules |
| `TABLE_ABSENTE` | `anchortableidt` introuvable (0 résultat, ou mise en page changée) |
| `AUCUNE_LIGNE` | table présente mais vide |

Un `CHAMP_INCONNU` ou un `TABLE_ABSENTE` répété = le site a bougé : lance
`mgTestStructure()` puis les tests hors ligne pour situer la casse.
