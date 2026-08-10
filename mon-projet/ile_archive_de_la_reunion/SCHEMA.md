# Schéma de sortie — validé sur Décès / Naissance / Mariage réels

Chaque acte a **la même forme** quel que soit le type. Les personnes vivent
dans `personnes` : `principal` seul (Naissance, Décès) ou `principal` + `conjoint`
(Mariage, Promesse, Divorce).

```jsonc
{
  "type_acte": "M",              // N | D | M | PM | DIV (extrait du lien photo, fiable par acte)
  "type_acte_libelle": "Mariage",
  "commune": "Saint-Denis",
  "date": "29.08.1939",          // date de l'acte
  "date_iso": "1939-08-29",
  "annee": 1939,
  "obs": "",                     // observations (niveau acte)
  "numero": "STDE_1939_1656",    // N° de photo
  "url_demande_photo": "http://iledelareunion-archive.com/recherche.php?rech=12&...",
  "personnes": {
    "principal": {
      "role": "principal",
      "nom": "KICHENIN",
      "prenom": "Nicolas",
      "sexe": "M",               // présent en Naissance/Décès, absent en Mariage
      "age": "",                 // string : peut valoir "4j", "2 m", "0"...
      "date_naissance": "21.09.1909",     // colonne "Date°" (Mariage) — le ° = né
      "date_naissance_iso": "1909-09-21",
      "origine": "St-André",
      "parrain": "",             // Naissance uniquement
      "marraine": "",            // Naissance uniquement
      "pere":  { "prenom": "Soupramanien", "decede": true },   // nom du père rarement présent
      "mere":  { "nom": "MINATCHY", "prenom": "Anandin", "decede": true }
    },
    "conjoint": {                // présent seulement pour M / PM / DIV
      "role": "conjoint",
      "nom": "KICHENAMA", "prenom": "Angama Antonia",
      "date_naissance": "29.03.1911", "date_naissance_iso": "1911-03-29",
      "origine": "ici",
      "pere": { "prenom": "Antony", "decede": true },
      "mere": { "nom": "CATAN", "prenom": "Pitchama", "decede": false }
    }
  },
  "raw": { "principal.nom": "KICHENIN", "conjoint.mere.prenom": "Pitchama", ... }
}
```

## Règles de parsing (issues des vraies pages)

- **Groupement positionnel** : chaque colonne « Nom » nue ouvre une personne ;
  tout ce qui suit lui appartient jusqu'à la personne suivante / aux colonnes
  de queue (Obs, N° de photo). Nécessaire car en Mariage seule une partie des
  colonnes du conjoint porte le suffixe « Conjoint » (Age, Date°, +, Origine ne
  l'ont pas).
- **`Date°`** = date de naissance (≠ `Date` de l'acte). Distinguées par le `°`.
- **`+`** = parent décédé. 1er `+` du bloc personne → père, 2e → mère (ordre
  constant sur les 3 types).
- **`type_acte`** vient du lien « demande de photo » (`rech=12&TypeActe=…`) →
  fiable acte par acte, même si plusieurs types sont cochés (plusieurs tableaux).

## Colonnes vues par type

| Type | Colonnes personne |
|---|---|
| Naissance | Nom, Prénom, Sexe, [père +], [mère +], Parrain, Marraine |
| Décès | Nom, Prénom, Sexe, Age, [père +], [mère +], Origine |
| Mariage | ×2 (principal + conjoint) : Nom, Prénom, Age, Date°, [+ père], père, mère, [+ mère], Origine |

## `warnings[]` (jamais d'échec silencieux)

- `PLUS_COUNT:role=n` — un bloc personne a un nombre de `+` ≠ 2 (layout inattendu)
- `NO_PERSON_COLUMN` — aucune colonne « Nom » trouvée
- `ROW_WIDTH:x/y` — une ligne n'a pas le nombre de cellules attendu
- `COUNT_MISMATCH:x/y` — total annoncé ≠ actes parsés sur une page unique

Rien n'est jamais perdu : `raw` contient toutes les cellules même si un layout
surprend.
