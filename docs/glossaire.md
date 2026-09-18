# Glossaire Autowin OS

Les mots de la mécanique interne, traduits. Chaque entrée renvoie au fichier qui la définit.

| Terme | Ce que ça veut dire | Où c'est défini |
|---|---|---|
| **Workflow / profil** | Suite d'étapes choisie pour une demande (*Éclair*, *Correctif*, *Feature*, *Chantier Autowin*…). | `src/main/workflow-defaults.ts` |
| **Mode dynamique** | Choisit : réponse directe, profil existant, ou graphe inventé (12 exécutions maximum). Les demandes de moins de 40 caractères et les questions pures ne passent pas par ce choix. | `src/main/workflow-dynamic.ts` (`meriteUneDecision`) |
| **Étapes** (scout, frame, terrain, build, clean, judge) | Explorer, cadrer, préparer le mode opératoire, construire, nettoyer, juger. | `src/main/workflow-defaults.ts` |
| **Juge** | Contrôle final : confronte le résultat aux critères et aux preuves réelles. | `src/main/workflow-defaults.ts` |
| **RUN.md** | Journal d'une orchestration, lu par le panneau Workflows. Un tour de chat direct n'en crée pas. | `src/main/runs/conv-runs.ts` |
| **Copie de travail séparée (worktree)** | Copie isolée du dépôt où un agent travaille ; elle n'est fusionnée que si le run finit vert. | `src/main/worktree-path-rewrite.ts` |
| **Clôture en 4 rubriques** | « ✅ Fait / 📍 Maintenant / ⏳ Reste à faire / 👉 Recommandé », exigée seulement quand le tour a exécuté une commande. | `src/main/response-style.ts`, `src/main/chat-turn-messages.ts` (`exigeUneConclusion`) |
| **Mode auto** | Enchaîne seul les suites recommandées ; une rubrique réduite à « rien » l'arrête. | `src/renderer/src/components/chat-auto-mode.ts` |
| **Tour muet** | Tour qui agit sans écrire un mot. Dans le chat de l'app, le pilote redemande la conclusion une seule fois. Pour les agents lancés via claude.exe, la relance « Continue from where you left off. » vient de claude.exe lui-même, pas de ce dépôt. | `src/main/agent-pilot.ts:2466-2470` (`muted-turn`), `docs/tours-muets-etat-des-lieux.md` |
| **Verify rejoué** | Rejoue la vérification avant d'accepter un « vert ». Désactivé par défaut, volontairement. | `src/main/hooks/verify-replay-config.ts` |
| **/salvage** | Tri des travaux non publiés avant toute publication. | `src/main/response-style.ts` (règle PUBLICATION) |
| **Brain** | Base de connaissances partagée, consultée au démarrage d'un run. | `src/main/orchestrator.ts` |
