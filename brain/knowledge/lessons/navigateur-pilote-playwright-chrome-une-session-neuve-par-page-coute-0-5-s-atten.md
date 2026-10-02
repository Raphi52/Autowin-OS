---
schema: amitel-brain/v1
uid: global/lesson/navigateur-pilote-playwright-chrome-une-session-neuve-par-page-coute-0-5-s-atten
type: lesson
kind: lesson
scope: "global"
author_agent: "autowin-os"
model: claude-opus-5-5
created: 2026-10-01
updated: 2026-10-02
status: active
confidence: derived
sources: ["file:C:/Users/viral/Desktop/maxencebonnetcarrier-ship-it/glaneur/src/browser.ts"]
supersedes: []
reviewed_by: ["autowin-app-curation"]
reviewed_at: 2026-10-02
mocs: ["knowledge/_maps/brain"]
tags: ["playwright", "chrome", "performance", "scraping", "theme/gouvernance"]
---

# Navigateur piloté (Playwright/Chrome) : une session neuve par page coûte ~0,5 s ; attente courte sûre si l'on suit minuteurs, intervalles, animations et MessageChannel

Mesuré le 2026-10-01 dans le dépôt glaneur (src/browser.ts, bench/live/leviers-js.mjs, bench/live/js-glaneur.mjs, bench/README.md §8), Chrome 148, navigateur déjà lancé, quotes.toscrape.com/js. (1) Ouvrir un BrowserContext neuf par page rouvre toutes les connexions (DNS, TCP, TLS des scripts de la page) : page arrivée en 846 ms avec une session neuve, 367 ms dans une session déjà ouverte, 244 ms dans le même onglet ; servir le document déjà téléchargé sans garder la session ne gagne que 80 ms. (2) Chromium enregistre les Set-Cookie d'une réponse servie par route.fulfill (vérifié : document.cookie et cookie renvoyé à l'API de la page), donc on peut servir au navigateur le HTML déjà téléchargé avec ses cookies. (3) Une attente « page posée » de 100 ms au lieu de 300 ms ne rate rien seulement si l'on suit, dans la page, setTimeout en attente (piège : fetch lancé 250 ms après), setInterval actifs (animations jQuery 1/2, ex. indicateur Loading masqué en 200 ms), requestAnimationFrame (jQuery 3), requestIdleCallback, et les programmations sans minuteur MessageChannel/postMessage/scheduler.postTask (ordonnanceur de React) ; chaque cas a un test qui échoue sans son repérage. Résultat : 1 637 → 625 ms par page JavaScript (Crawl4AI 561 ms le même jour, qui rate les données tardives), crawl de 10 pages JS 15,9 → 8,7 s. Le MutationObserver existant ne voit pas les animations de style (pas d'observation des attributs).
