# Autowin OS — ce que fait le produit (formulations honnêtes)

> Liste de communication **calibrée sur le réel** : chaque point est défendable aujourd'hui.
> 🟢 vrai · 🔧 vrai avec la limite indiquée. Rien au-dessus de ce que le code prouve.

## Le socle

- 🟢 **Multi-providers via leurs CLI/API** — Claude (CLI), Codex (CLI pour l'exécution, API Responses
  pour le chat), Kimi ; architecture d'adaptateurs **extensible** à d'autres modèles.
- 🟢 **Injection de contexte par défaut supprimée** — Claude lancé `--setting-sources ""`, Codex avec
  `project_doc_max_bytes=0` ; Autowin **compose ensuite explicitement** le contexte. Zéro doublon.
- 🟢 **Orchestrer et exécuter avec des modèles/efforts distincts** — rôles orchestrateur, sous-agent,
  juge, scout, chacun son provider + modèle + effort.
- 🟢 **Choix du modèle par phase du pipeline + agrégation multi-modèles** sur scout / frame / judge
  (panels de modèles). *(Routage par skill installée : en cours.)*
- 🟢 **Hooks pour Codex et les autres** — un HookBus interne s'applique **quel que soit** le support
  natif du provider (dont un *verify-replay* qui rejoue réellement la vérification).
- 🟢 **Worktrees git isolés par agent** — création isolée, publication, fusion, détection de conflits,
  cartographie ; parallélisme sans collisions.
- 🟢 **Traiter en masse les work items** — bouton qui lance jusqu'à 3 traitements parallèles, **une
  conversation dédiée par ticket**, avec annulation. Filtre par ton nom → tes tickets.
- 🟢 **Parallélisation, premier agent revenu débloque la suite** (mode greedy, `Promise.race`).
  *(Le fan-out d'agrégation attend, lui, tous ses membres avant la synthèse.)*

## Transparence & mémoire (avec les limites honnêtes)

- 🔧 **Traçabilité de bout en bout — jusqu'à la frontière Autowin** : agents, actions git, RUN.md,
  workflows, injections de contexte et tokens sont tracés dans l'Observatory. *Limite assumée : les
  instructions internes des providers ne sont pas exposables, et certaines traces sont tronquées/masquées.*
- 🔧 **Rétrospective détaillée des actions** (appels, outils, réponses, RAG, tokens, étapes) —
  *dans les limites de ce que les providers exposent (redaction).*
- 🔧 **Mémoire d'équipe partagée et persistante** — récupération Amitel Brain (RAG local), fichiers
  Markdown versionnés (git, portable, zéro lock-in), signature HMAC et protections de chemins.
  *Contribution en append/supersede ; audit de sécurité formel et mesure de coût : à publier.*

## Robustesse & mises à jour

- 🔧 **Fermer la fenêtre ne coupe pas le travail** — l'app reste en tray, les runs continuent.
  *Reprise après un kill complet du process : en cours (niveau 2).*
- 🔧 **Mises à jour automatiques depuis le dépôt** — vérification au démarrage + application en 1 clic
  (pull + relaunch). *Distributions clonées ; installation packagée : à venir.*

## La promesse de fond

- 🟢 **Tu possèdes le code de ton IDE agentique** — toutes tes idées deviennent possibles, en local et souverain.
