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
  (panels de modèles). _(Routage par skill installée : en cours.)_
- 🟢 **Hooks pour Codex et les autres** — un HookBus interne s'applique **quel que soit** le support
  natif du provider (dont un _verify-replay_ qui rejoue réellement la vérification).
- 🟢 **Worktrees git isolés par agent** — création isolée, publication, fusion, détection de conflits,
  cartographie ; parallélisme sans collisions.
- 🟢 **Traiter en masse les work items** — bouton qui lance jusqu'à 3 traitements parallèles, **une
  conversation dédiée par ticket**, avec annulation. Filtre par ton nom → tes tickets.
- 🟢 **Parallélisation, premier agent revenu débloque la suite** (mode greedy, `Promise.race`).
  _(Le fan-out d'agrégation attend, lui, tous ses membres avant la synthèse.)_

## Transparence & mémoire (avec les limites honnêtes)

- 🔧 **Traçabilité de bout en bout — jusqu'à la frontière Autowin** : agents, actions git, RUN.md,
  workflows, injections de contexte et tokens sont tracés dans l'Observatory. _Limite assumée : les
  instructions internes des providers ne sont pas exposables, et certaines traces sont tronquées/masquées._
- 🔧 **Rétrospective détaillée des actions** (appels, outils, réponses, RAG, tokens, étapes) —
  _dans les limites de ce que les providers exposent (redaction)._
- 🔧 **Mémoire d'équipe partagée et persistante** — récupération Amitel Brain (RAG local), fichiers
  Markdown versionnés (git, portable, zéro lock-in), signature HMAC et protections de chemins.
  _Contribution en append/supersede ; audit de sécurité formel et mesure de coût : à publier._

## Robustesse & mises à jour

- 🔧 **Fermer la fenêtre ne coupe pas le travail** — l'app reste en tray, les runs continuent.
  _Reprise après un kill complet du process : en cours (niveau 2)._
- 🔧 **Mises à jour automatiques depuis le dépôt** — vérification au démarrage + application en 1 clic
  (pull + relaunch). _Distributions clonées ; installation packagée : à venir._

## Kaizen — autonomie et traçabilité des workflows

- Les commandes de développement ordinaires restent automatiques ; seule une action marquée destructive demande confirmation. Une correction interne ne crée donc pas sa propre décision.
- Un lancement `orchestrate` équivalent (même conversation et même tâche) déjà en cours est réutilisé : le résultat porte `runId`, `status: running` et `reused: true`, au lieu de créer un second RUN.
- Chaque RUN persiste `pending`, puis `running`, puis `succeeded` ou `failed`; le panneau Workflows et l'état injecté à l'agent lisent ce même artefact. Un lancement n'est annoncé qu'après création du RUN.
- La résolution d'une décision est idempotente pour le même choix : un double clic renvoie la résolution existante sans rejouer l'action. Un choix contradictoire reste refusé. L'UI propose déjà les choix bornés, dont Annuler, sans exposer cette autorité au modèle.
- La boîte destructive de suppression se ferme par clic extérieur; ce comportement est présent dans le composant et testable dans le runtime DOM. Aucun support de capture/clic live n'est inféré de ce fait.
- Preview développement : `scripts/launch-dev.ps1` lance `npm run dev` dans un terminal minimisé avec `AUTOWIN_OS_DEV=1`. Le serveur Vite se vérifie sur son endpoint local; le rafraîchissement visuel après une modification exige encore une session Electron observable (capture ou contrôle de fenêtre), capacité non fournie par tous les runtimes.

Sources techniques vérifiées le 2026-07-27 : `src/main/conversation-capabilities.ts` (seuil de confirmation), `src/main/commands.ts` (déduplication, annonces et état de lancement), `src/main/runs/conv-runs.ts` (persistance des transitions), `src/main/authority/sas.ts` (résolution idempotente), `src/renderer/src/components/ChatView.behavior.test.tsx` (clic extérieur) et `scripts/launch-dev.ps1` (chemin de preview). Les garanties ci-dessus sont limitées à ces contrats locaux ; elles n'attestent pas un contrôle visuel Electron lorsqu'il n'est pas disponible dans le runtime.

## La promesse de fond

- 🟢 **Tu possèdes le code de ton IDE agentique** — toutes tes idées deviennent possibles, en local et souverain.
