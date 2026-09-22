---
name: build
description: >-
  La boucle nommée du PRODUCTEUR (frame → terrain → build → clean → judge) : amener un DÉFAUT jusqu'à
  un état fonctionnellement VÉRIFIÉ. Invoquée par `judge` (qui renvoie les défauts priorisés) ET
  directement par l'utilisateur avec un bug brut.
  Déclencher sur "fix the bug / make it green / the test fails repair it / apply the judge's findings / it's still broken".
  NE PAS utiliser pour : AUDITER un livrable → `judge` ; décider QUOI construire → `frame` ; préparer le harnais → `terrain`.
---

# build — sept réflexes, du défaut au vert vérifié

1. **AU MOMENT où un défaut arrive → REPRODUIS-LE EN ROUGE D'ABORD.** Joue le critère énoncé (test,
   commande, code de sortie) avant de toucher quoi que ce soit, et colle sa sortie rouge. Un correctif sur un bug
   non reproduit répare un peut-être-bug. Pas de rouge → le défaut n'est pas encore localisé, continue de chercher ; n'édite pas.
2. **AU MOMENT où tu tiens le rouge → LIS L'ASSERTION QUI ÉCHOUE, PUIS LE SEUL FICHIER QU'ELLE VISE.** Le précédent ne se cherche QUE si le correctif crée un mécanisme partagé (nouvelle constante publique, nouvelle famille de fichiers) ; pour un défaut local d'une fonction pure, corrige directement et relance le critère.
3. **AU MOMENT où tu tiens l'assertion → LOCALISE LA LIGNE QUI S'EXÉCUTE VRAIMENT.** Grep le symptôme visible
   (la chaîne de caractères, le message d'assertion), ouvre LE seul fichier qu'il nomme, et arrête ta lecture là. Lire
   l'arbre « pour le contexte » est le gaspillage mesuré, pas de la rigueur.
4. **AU MOMENT où la cause est nommée → CORRIGE CETTE CAUSE, AU MINIMUM.** Uniquement la cause nommée. Aucun
   refactor opportuniste, aucun renommage, aucun « tant que j'y suis ». Une garde qui CONTOURNE le défaut, une erreur avalée, une
   assertion desserrée, un timeout élargi = FAUX VERT → refuse-le, ou étiquette-le « rustine — cause réelle : X ».
5. **AU MOMENT où tu dirais « fini » → REJOUE LE MÊME CRITÈRE et lis son code de sortie.** Un artefact
   hors modèle, sinon ça n'a pas eu lieu : test rouge→vert, code de sortie, capture LUE, requête. Jamais un texte auto-déclaré.
6. **AU MOMENT où le rejeu est encore rouge → CHANGE D'APPROCHE, ne répète pas.** Deux tentatives identiques n'en font
   qu'une. Épuise 2 à 3 approches DISTINCTES par sous-objectif avant d'interrompre l'humain. Un fichier, une fixture
   ou un outil manquant, c'est TOI qui le FABRIQUES quand c'est sûr, borné et réversible — ça ne se demande pas.
7. **AU MOMENT où tu es tenté de rendre la main tôt → NE LE FAIS PAS.** Un rapport d'étape, « je continue ? », un plan
   sans exécution coûtent un tour entier à l'utilisateur et ne produisent rien (mesuré : 23,54 $ sur 156,51 $ dépensés en
   tours « reprend », 2026-09-02). Mène-le jusqu'au vert vérifié dans CETTE passe, ou nomme le blocage précis. Puis
   reboucle vers `judge` : build corrige, build ne signe JAMAIS son propre verdict de qualité.
