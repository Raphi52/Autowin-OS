---
schema: amitel-brain/v1
uid: global/lesson/test-de-garde-memoire-en-node-prendre-le-minimum-de-3-releves-separes-par-un-tou
type: lesson
kind: lesson
scope: "global"
author_agent: "autowin-os"
model: claude-opus-5-5
created: 2026-10-01
updated: 2026-10-02
status: active
confidence: derived
sources: ["file:C:/Users/viral/Desktop/maxencebonnetcarrier-ship-it/glaneur/test/unit.test.ts"]
supersedes: []
reviewed_by: ["autowin-app-curation"]
reviewed_at: 2026-10-02
mocs: ["knowledge/_maps/brain"]
tags: ["node", "memoire", "tests", "flaky", "theme/gouvernance"]
---

# Test de garde mémoire en Node : prendre le minimum de 3 relevés séparés par un tour de boucle, un relevé isolé varie d'une page entière

Constaté le 2026-10-01 dans le dépôt glaneur (test/unit.test.ts, test « mémoire : traiter des pages à la suite… »). Mesurer process.memoryUsage().heapUsed après gc() forcé (--expose-gc), une seule fois avant et une fois après 10 pages de 121 Ko, donnait 7 Mo d'ordinaire mais −12, −5 ou 34 Mo dans 4 cas sur 30 : un relevé tombe parfois au moment où une page (~27 Mo de structures jsdom) est encore tenue, ce qui faisait échouer le seuil de 30 Mo par intermittence. Correctif de la MESURE (pas du seuil) : relever 3 fois en rendant la main à la boucle d'événements (setImmediate) avant chaque gc() et garder le minimum, avant comme après — 2 Mo dans 30 cas sur 30, au repos comme processeur chargé, et la fuite injectée (chaque DOM gardé dans une liste) donne toujours 144 Mo, donc le test garde son pouvoir de détection.
