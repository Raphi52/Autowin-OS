---
name: gel
description: >-
  Enquête sur un GEL d'Autowin OS (« j'ai eu un freeze », « l'app a figé », « ne répond plus », « ça a
  gelé en ouvrant X ») : classe le journal des gels par opération et par appelant, remonte chaque
  appelant du bundle à son fichier:ligne dans src/, reproduit dans une instance cachée, puis rend une
  cible chiffrée à `heal` ou `build`. NE PAS utiliser pour : une lenteur sans gel ni un projet autre
  qu'Autowin (→ `heal`), un plantage ou une fermeture de l'app, un défaut d'affichage sans fenêtre
  figée (→ `build`). Ne corrige rien : elle désigne le coupable.
---

# gel — trouver le coupable d'un gel dans le journal, avant de toucher au code

## À quoi ça sert

Chaque « /heal j'ai eu un freeze » refaisait la même enquête à la main : découvrir le journal des gels,
l'agréger avec un script jetable, puis chercher dans `src/` d'où venait `main/index.js:16278`
(13 fils entre conv-63 et conv-842). Les instruments existent : le journal, écrit par le battement du
processus principal (`src/main/gel-main.ts`), et les cartes `.map` à côté du bundle. Cette skill les
enchaîne et rend UNE cible : un `fichier:ligne`, un chiffre avant, et une façon de reproduire.

## Contrôle d'entrée

- Le symptôme est une fenêtre FIGÉE (plus de clic, plus de frappe, « ne répond pas »), pas une simple
  lenteur. Lenteur sans gel → `heal`. Plantage ou fermeture → pas cette skill : le journal des gels
  ne voit pas une sortie de l'app.
- La cible est Autowin OS lui-même. Le journal est `.autowin-data/autowin-os/gels.jsonl`.

## Procédure

### 1. CLASSER — chiffrer avant de lire du code

```
node scripts/gels-classement.mjs --jours 2        # ou --depuis 2026-10-21T07:00:00Z, --top 15, --json
```

Il rend trois familles, que tu ne dois JAMAIS additionner entre elles :

- **Fenêtre figée** : le processus principal ne répondait plus. C'est le chiffre qui compte pour l'utilisateur.
- **Rendu** (`renderer:*`) : l'interface elle-même était tenue. Les événements d'une même chaîne de
  réanimation (silence, affichage forcé, fenêtre réanimée) décrivent souvent le MÊME gel : ce cumul
  est un ordre de grandeur, pas une somme exacte.
- **Appels lents unitaires** (`io:*`) : déjà inclus dans le gel de fenêtre qui les contient. Le panneau
  de l'app les additionne, le script non : ses totaux sont plus bas, et c'est voulu.

Si l'utilisateur dit « là, maintenant », prends une période courte autour de son message. Un gel
qu'il a vécu doit apparaître dans la période ; s'il n'y est pas, dis-le avant d'aller plus loin.
Sortie 3 = ni gel ni démarrage de l'instrument dans la période : élargis, ne conclus pas.

### 2. REMONTER — de l'appelant à la ligne de code

Le tableau « Qui tient la fenêtre » remonte chaque appelant aux sources par les cartes du bundle.
Lis la colonne **Carte** avant de croire une source :

- `en-vigueur` : la carte date d'avant le démarrage qui précède le gel, donc du code que l'app avait
  chargé. Ouvre le `fichier:ligne` et vérifie qu'il porte bien l'appel nommé (`readFileSync`,
  `spawn git status`…).
- `archivee` : la carte du code qui tournait, retrouvée dans l'archive que chaque build remplit
  (`.autowin-data/autowin-os/gels-cartes/`, `scripts/gels-cartes-archive.mjs`, depuis conv-1055) :
  la dernière construction écrite avant le démarrage qui précède le gel. Consultée SEULEMENT quand
  ce démarrage est connu. Aussi fiable que `en-vigueur` : même vérification de la ligne.
- `posterieure-au-gel` ou `posterieure-au-demarrage` : le bundle a été reconstruit après le chargement
  du code qui a gelé, et l'archive ne remonte pas jusqu'à ce code (gel antérieur au 2026-10-22, ou
  archive vidée). La frame reste brute, `(non résolu)`. Ne cherche pas la ligne à la main dans le
  bundle actuel : attends un gel survenu après le dernier démarrage, ou reproduis (étape 3).
- `absente` : aucune carte. Cherche l'appel nommé dans `src/main` avec grep, sans conclure sur une ligne.

Puis cherche si ce coupable a DÉJÀ été traité : un `.test.ts` dont le commentaire cite `gels.jsonl`
et le même appel (grep `gels.jsonl` dans `src/`). Un correctif déjà livré qui revient = une
régression, à traiter comme telle.

### 3. REPRODUIRE — dans une instance cachée, jamais dans l'app de l'utilisateur

Pour un gel attaché à une vue (le rendu, ou un clic qui fige) :

```
node scripts/avec-instance-headless.mjs --code-dev -- node scripts/banc-gel.mjs <vue> [essais]
```

Le banc refuse de viser l'app ouverte sans `--app-ouverte` : il clique une vue et attend qu'elle gèle,
donc sur l'app ouverte c'est la fenêtre de l'utilisateur qui se fige. Verdict : sortie 0 = vivante,
1 = gel (avec la réanimation lue dans le journal de l'instance), 2 = aucune cible.

Pour un gel du FIL (`renderer:vue-chat-fil`, `renderer:chat-fil`), qui ne porte jamais de pile, ouvre
une conversation longue réelle sous le profileur CPU — la sonde la copie dans sa propre instance
cachée, puis l'efface :

```
node scripts/cdp-profil-ouverture-fil.mjs --conversation <id> [--essais 3] [--out <rapport.json>]
```

Elle classe le temps PROPRE par fonction (`fichier:ligne` du code servi par le serveur de dev — lis
la ligne dans `http://localhost:5173/src/...`, pas dans la source TSX). Une fonction de mesure
(`scrollHeight`, `getBoundingClientRect`, `getBBox`) en tête paie la mise en page du fil entier :
c'est le PREMIER lecteur qui la paie, donc retirer une lecture déplace le coût vers la suivante
(conv-1055 : 818 ms de `FilDePensee.mesurer` devenus ~730 ms d'`ajusterALaLargeur`). Un gain réel
vient d'une CASCADE supprimée (écriture entre deux lectures : plusieurs mises en page au lieu d'une)
ou d'un fil moins coûteux à mettre en page — pas d'une lecture de moins. Compare avant/après sur le
MÊME arbre : un autre fil peut avoir ajouté du code au fil entre deux mesures.
Pour un gel du processus principal sans vue précise, la reproduction est un test `src/main/*.test.ts`
qui prouve l'appel synchrone sur le chemin nommé (`src/main/behaviour-files.sans-gel.test.ts` en est le modèle).

### 4. PASSER LA MAIN

Rends la cible, puis enchaîne : `heal` (étape 1, la cible est déjà mesurée) quand il y a plusieurs
coupables à traiter, `build` quand il n'y en a qu'un.

## Rapport

Le tableau du classement collé tel quel, la période, puis UNE ligne par coupable retenu :
`fichier:ligne` · l'appel · le cumul et le pire · la carte (`en-vigueur` ou non) · la reproduction
(commande et verdict, ou « non reproduit »). Termine par la skill qui prend la suite.

## À ne pas faire

- Additionner fenêtre, rendu et appels unitaires en un seul « temps figé ».
- Donner une ligne de code tirée d'une carte `posterieure-au-gel` ou `posterieure-au-demarrage`.
- Lancer le banc sur l'app ouverte de l'utilisateur pour « gagner du temps ».
- Corriger dans cette skill : elle désigne, `heal` ou `build` réparent.
