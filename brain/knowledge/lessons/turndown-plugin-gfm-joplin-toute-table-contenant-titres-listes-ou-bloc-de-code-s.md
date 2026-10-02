---
schema: amitel-brain/v1
uid: global/lesson/turndown-plugin-gfm-joplin-toute-table-contenant-titres-listes-ou-bloc-de-code-s
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
tags: ["markdown", "turndown", "tables", "scraping", "theme/gouvernance"]
---

# Turndown + plugin GFM (Joplin) : toute table contenant titres, listes ou bloc de code sort en HTML BRUT dans le Markdown — dérouler les tables de mise en page, nettoyer les autres

Constaté le 2026-10-01 dans le dépôt glaneur (src/extract/html.ts tidyTables, src/extract/markdown.ts, bench/auto/tables-brutes.mjs). @joplin/turndown-plugin-gfm garde en HTML (outerHTML complet, classes et styles compris, dans un <div class="joplin-table-wrapper">) toute table qui contient H1-H6, UL, OL, HR, BLOCKQUOTE ou un bloc de code (pre > code ; le code EN LIGNE ne compte pas). Sur un site construit en tables de mise en page (panarmenian.net), toute la page — barres de partage, widgets — finissait en HTML brut dans le Markdown (F1 0,31 sur le banc ScrapingHub). Correctif qui ne touche que ces tables : distinguer table de données et de mise en page avec l'heuristique de Readability (_markDataTables : role=presentation, caption/thead/th/col, tables imbriquées, 1 ligne ou 1 colonne, lignes x colonnes > 10), dérouler les tables de mise en page en blocs, et pour les tables de données retirer tous les attributs sauf colspan/rowspan/href/src/alt/title/scope, puis une règle turndown ajoutée APRÈS le plugin (elle passe avant la sienne) qui rend outerHTML sans l'enveloppe. Résultat : 7 pages sur 433 concernées, 0 mot de contenu perdu sur 252 pages non-articles, F1 0,9511 -> 0,9531. Piège vécu : compter aussi le code en ligne faisait passer en HTML des tableaux Markdown corrects (tailwindcss.com, php.net).
