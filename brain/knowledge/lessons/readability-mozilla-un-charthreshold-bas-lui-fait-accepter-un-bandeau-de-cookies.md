---
schema: amitel-brain/v1
uid: global/lesson/readability-mozilla-un-charthreshold-bas-lui-fait-accepter-un-bandeau-de-cookies
type: lesson
kind: lesson
scope: "global"
author_agent: "autowin-os"
model: claude-opus-5-5
created: 2026-10-01
updated: 2026-10-02
status: active
confidence: derived
sources: ["file:C:/Users/viral/Desktop/maxencebonnetcarrier-ship-it/glaneur/src/extract/html.ts"]
supersedes: []
reviewed_by: ["autowin-app-curation"]
reviewed_at: 2026-10-02
mocs: ["knowledge/_maps/brain"]
tags: ["readability", "extraction", "scraping", "theme/gouvernance"]
---

# Readability (Mozilla) : un charThreshold bas lui fait accepter un bandeau de cookies comme article ; relancer avec 500 si le résultat fait moins de 5 % de la page

Mesuré le 2026-10-01 dans le dépôt glaneur (src/extract/html.ts, cleanHtml et readabilityContent ; bench/README.md §9). Readability écarte d'abord les blocs dont la classe contient « sidebar » (unlikelyCandidates). Sur theantijunecleaver.com l'article est dans div.theiaStickySidebar : avec charThreshold: 100, le bandeau de cookies (~150 caractères) suffisait pour que Readability rende ce bandeau comme article, sans faire ses passes plus larges. Relancer Readability avec son seuil d'origine (500) quand le premier résultat garde moins de 5 % des mots de la page rend l'article (F1 0,80 -> 0,93 et 0,82 -> 0,95). Autre piège du même outil : avec keepClasses, Readability remplace un div qui ne contient qu'un paragraphe par ce paragraphe et la classe du div se perd — pour reconnaître des blocs à leur classe dans sa sortie, les marquer AVANT (classe propagée aux descendants). Ce marquage a servi à retirer du mode lecture signature, horodatage, bio d'auteur et encarts (mots de classe byline, author, timestamp, bio, newsletter, signup, subscribe, print, copyright, taille plafonnée) : F1 0,9574 -> 0,9604 sur 181 articles, rappel inchangé, auteur et date gardés en métadonnées.
