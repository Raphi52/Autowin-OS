// Groupe de commandes « lancement d’un workflow », sorti de AppCommandBus.run (lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { watchdogEvidenceIdentity } from './orchestration-entrees'
import { composerTacheDOrchestration, collecterContexteDOrchestration } from './orchestration-tache'
import { actionFingerprint } from './rejeu'
import type { RoleBinding } from '../profil/roles'
import type { WatchdogMutationClaimsSink } from '../task-manager/types'
import { classifyRegime, regimePhases } from '../orchestration/task-regime'
import { phasesAvecJuge } from '../orchestration/orchestration-memoire'
import { reuseOrCreateConvRun, populateConvRunSections, saveConvRunTrace, closeConvRun, statutDuRunMd, ligneDeClotureDuMoteur, ligneJournalDErreur } from '../runs/conv-runs'
import { randomUUID } from 'node:crypto'
import type { OrchestrationStep } from '../orchestration/orchestrator'
import { battementDOrchestration, VERIFY_BATTEMENT_MS, bornerLigneDeVie, EN_REFLEXION } from '../verify/verify-battement'
import { defaultProcessIdentity } from '../store/worktree-manager'
import { publishedWorktreeProofForResume } from '../runs/startup-resume-publication'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import { persistOrchestrationStep, persistOrchestrationPhaseStart, persistRunLifecycle } from '../activity/orchestration-observability'
import { appendNativeTrace } from '../activity/native-trace-spool'
import { mettreAJourPlanDuRun } from '../runs/plan-en-vagues'
import { hypothesesDuCadrage } from '../../shared/cadrage-confiance'
import { appendConvActivity, effortEnvoyeDeLEnveloppe } from '../activity/conv-activity'
import { appendBrainTrace } from '../activity/brain-trace-spool'
import { reconcileLateRunLifecycle } from '../activity/late-run-usage-settlement'
import { formatExecutionCostCoverage, executionCostCoverageFields } from '../../shared/orchestration-outcome'
import { appendExecutionEvidenceFileTrace } from '../activity/conversation-file-trace-spool'
import { OUTCOME_LESSON_MARKER } from '../brain/outcome-learning-proposal'
import { type OutcomeLearningResult, avecNotesDeposees } from '../brain/outcome-learning-supervisor'
import { cheminDuLivrableDuRun, ecrireLivrableDuRun } from '../runs/livrable-entier'
import { ligneDeJournalDeRelecture } from '../juge/objections-juge'
import { messageDuRun } from '../../shared/message-du-run'
import { classeTerminaleDEchec, causeDInterruption } from '../orchestration/classe-terminale-echec'

/** Cas de `AppCommandBus.run` : lancement d’un workflow. Corps déplacé tel quel depuis commands.ts (lot 2). */
export async function executerOrchestration(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string,
  bindingOverride?: RoleBinding,
  turnId?: string,
  onProgress?: (text: string) => void
): Promise<unknown> {
  switch (name) {
    case 'orchestrate': {
      // Une tâche lancée depuis une conversation laisse SON workflow (RUN.md) dans
      // le dossier de la conversation — clos green/red selon le gate, red si crash.
      // Les ÉTAPES (sous-agent → juge → gate) sont diffusées LIVE + persistées (fil sous-agents).
      // Priorité à args.conversationId : un pilotage PROGRAMMATIQUE (agent, driver) peut
      // cibler une vraie conversation sans passer par l'UI (sinon fallback __autonomous__,
      // non ouvrable depuis le badge « agents actif »).
      const convId =
        (typeof a.conversationId === 'string' && a.conversationId) ||
        conversationId ||
        bus.activeConversationId ||
        '__autonomous__'
      const causalWatchPaths = Array.isArray(a.causalWatchPaths)
        ? a.causalWatchPaths
            .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
            .slice(0, 16)
        : []
      // Le contenu observé n'entre jamais dans `task` ni dans le contexte provider : il peut être
      // contrôlé par un log. Son hash distingue les incidents sans lui donner d'autorité.
      const watchdogEvidenceId = watchdogEvidenceIdentity(a.watchdogEvidence)
      const onLateMutationClaims =
        typeof a.onLateMutationClaims === 'function'
          ? (a.onLateMutationClaims as WatchdogMutationClaimsSink)
          : undefined
      // Rang pris ICI, dans le préfixe synchrone de `exec` : c'est le seul point qui reflète
      // l'ordre d'APPEL. Plus loin, le préambule asynchrone peut réordonner les lancements.
      const orchestrationRank = ++bus.orchestrationRank
      const { requestedTask, conversation, task } = composerTacheDOrchestration(
        bus,
        a,
        convId,
        causalWatchPaths
      )
      const fingerprint = actionFingerprint('orchestrate', {
        convId,
        task,
        bindingOverride,
        causalWatchPaths,
        watchdogEvidenceId
      })
      const existingRun = bus.activeOrchestrationByFingerprint.get(fingerprint)
      if (existingRun) {
        const existing = await existingRun
        return {
          runId: existing?.path,
          runPath: existing?.path,
          status: 'running',
          reused: true
        }
      }
      const substantial = classifyRegime(task) !== 'trivial'
      const collectedContext = substantial
        ? await collecterContexteDOrchestration(bus, task, conversation, convId, watchdogEvidenceId)
        : ''
      // La DoD du RUN.md est croisée avec les phases que ce run va RÉELLEMENT jouer : sans cela,
      // une demande limitée à `/frame` se voyait semer des cases « mutation / tests / commit »
      // qu'aucune phase de lecture ne peut cocher (« DoD 0/1 » sur un livrable complet).
      const runReady = substantial
        ? reuseOrCreateConvRun(
            convId,
            requestedTask,
            undefined,
            undefined,
            regimePhases(requestedTask)
          )
        : Promise.resolve(undefined)
      bus.activeOrchestrationByFingerprint.set(fingerprint, runReady)
      let run: { path: string; reused: boolean } | undefined
      try {
        run = await runReady
      } catch (error) {
        if (bus.activeOrchestrationByFingerprint.get(fingerprint) === runReady) {
          bus.activeOrchestrationByFingerprint.delete(fingerprint)
        }
        throw error
      }
      const runPath = run?.path
      const orchestrationTurnId = turnId ?? randomUUID()
      const steps: OrchestrationStep[] = []
      // Sous-agent STOPPABLE : un AbortController par conversation, coupé par abortOrchestration.
      const abortController = new AbortController()
      const debutRun = Date.now()
      /*
       * L'HORLOGE DU SIGNE DE VIE. Sans elle, le fil ne parlait que quand le modele parlait.
       *
       * DEFAUT MESURE le 2026-09-07 : un run a travaille de 09:45 a 10:08 sans une
       * ligne dans le fil, et l'utilisateur l'a signale comme un « arret » alors qu'il a fini
       * VERT. Les signes de vie existants sont tous EVENEMENTIELS (fin de phase, fragment de
       * raisonnement) : pendant qu'un sous-agent passe vingt minutes dans ses outils, il ne se
       * produit aucun evenement, donc rien ne distingue un travail en cours d'une app morte.
       * `verify` avait deja son battement periodique ; celui-ci le donne a l'orchestration, en
       * REUTILISANT le dernier fait connu au lieu d'inventer une seconde verite.
       */
      let dernierSigneDeVie: string | undefined
      /**
       * LA PHASE EN COURS, gardee a part du dernier fait.
       *
       * DEFAUT MESURE le 2026-09-16 (run c295e4061094) : releve du DOM de l'app reelle
       * pendant que l'utilisateur demandait « la conv semble a l'arret ? », le battement affichait
       * « 23 min 53 s · Bash · cd "C:/…/agent__run-c295e4061094-1" && cp /tmp/pee… ». Il TOURNAIT
       * donc, mais la seule source qui l'alimentait etait la note d'outil : la moindre commande
       * Bash ECRASE le nom de la phase, et trois phases se sont succede sans jamais etre nommees.
       * Les deux faits ne se remplacent pas — « ou en est-on » et « que fait-il a l'instant » —,
       * on les garde donc dans deux variables au lieu d'une.
       */
      let phaseCourante: string | undefined
      const battementOrchestration = onProgress
        ? setInterval(() => {
            onProgress(
              battementDOrchestration(dernierSigneDeVie, Date.now() - debutRun, phaseCourante)
            )
          }, VERIFY_BATTEMENT_MS)
        : undefined
      // Un battement ne doit JAMAIS retenir la fermeture du process : le timer suit le run.
      battementOrchestration?.unref?.()
      bus.claimOrchestration(convId, orchestrationRank, abortController)
      try {
        await bus.os.waitUntilReady?.()
        const runtimeSnapshot = bus.os.captureOrchestrationRuntime?.()
        // REPRISE depuis le chat : le chemin de reprise n'existait qu'au REDEMARRAGE de l'app, donc
        // « reprend » relancait de zero et REPAYAIT les phases deja produites (2026-07-29). On cherche
        // un acquis de la MEME tache dans LA MEME conversation, recent et non vide.
        const trouve =
          bus.os.resumableOrchestrationForTask?.(
            task,
            convId,
            Date.now(),
            bindingOverride,
            runtimeSnapshot
          ) ?? null
        // fix-ok: checkpoint lu sur disque : activeCalls=1 avec agent build PID 28028 mort ; test commands.test.ts rouge sur HEAD, vert avec ce correctif.
        // UN VERROU LAISSE PAR UN PROCESS MORT SE RECONCILIE AUSSI DEPUIS LE CHAT (
        // 2026-09-18). Un agent qui survit a la fermeture de l app garde activeCalls=1 dans le
        // checkpoint : seul le process qui l a lance pouvait le regler. Le demarrage reconcilie
        // (relaunch-resumable-run.ts) ; ce chemin reprenait le compteur tel quel, et chaque relance
        // etait refusee « appel(s) provider encore actif(s) ». Un agent encore VIVANT laisse l etat
        // inchange : le refus protecteur du superviseur reste entier.
        const resumable =
          trouve && (trouve.usage?.activeCalls ?? 0) > 0
            ? (bus.os.reconcileResumableOrchestrationForRelaunch?.(
                trouve.runId,
                defaultProcessIdentity
              ) ?? trouve)
            : trouve
        // UN RUN VIVANT NE SE REPREND PAS, IL SE REJOINT (2026-09-18) : le mode
        // auto avait lance le run avec le prompt suggere, puis le meme texte revenait en tour
        // utilisateur. La cle de reprise designait ce run encore en cours dans CE process ; la
        // reprise attendait 60 s puis rendait « Reprise refusee » alors que le run travaillait.
        if (resumable && bus.os.isOrchestrationLive?.(resumable.runId)) {
          return { runId: resumable.runId, status: 'running', reused: true }
        }
        // LE MEME TOUR SE REJOINT AUSSI QUAND SA TACHE A ETE REECRITE (2026-09-30) : le
        // tour de chat restaure apres un redemarrage relance `orchestrate` avec un autre libelle,
        // pendant que la reprise de demarrage fait deja tourner le run de ce tour. Sans ce
        // rattachement, un second run repart de zero et repaie `think` (run-66d6d5bdfc5a-1, 1,94 $).
        // fix-ok: causal-trace/conv-890 sequences 802 et 805, meme tour 386f4c48 ; commands.test.ts
        // « rejoint le run vivant du MEME tour » rouge avant, vert apres (reparation 4, run-85d8).
        const vivantDuTour = bus.os.liveOrchestrationForTurn?.(convId, orchestrationTurnId)
        if (vivantDuTour) return { runId: vivantDuTour, status: 'running', reused: true }
        // Publication Git DÉJÀ acquise pour ce checkpoint → le tour se clôt en SUCCÈS, sans
        // repayer aucun provider. Mesuré (13/08) : le run avait publié — verdict
        // green, publication complete, SHA poussé sur origin/auto/… — puis la reprise du
        // checkpoint encore présent a été refusée (« publication complete déjà engagée ») et ce
        // refus marquait le TOUR ENTIER failed : une réussite à 10 $ affichée comme un échec.
        // Le démarrage clôt déjà ce cas en succès ; le chemin du chat fait désormais pareil.
        if (resumable) {
          const activity = bus.os.getWorktreeActivity?.() as
            { agents?: unknown[] } | unknown[] | undefined
          const agents = (Array.isArray(activity) ? activity : (activity?.agents ?? [])) as never
          const preuve = publishedWorktreeProofForResume(resumable.runId, agents)
          if (preuve) {
            bus.os.forgetResumableOrchestration?.(resumable.runId)
            const sha = preuve.publishedSha ? ` (commit ${preuve.publishedSha.slice(0, 8)})` : ''
            return {
              ok: true,
              data: {
                result:
                  `Publication Git déjà acquise${sha} : le travail de ce checkpoint est déjà ` +
                  `mergé et poussé. Reprise annulée sans nouvel appel provider.`,
                publication: preuve.publication,
                ...(preuve.publishedSha ? { publishedSha: preuve.publishedSha } : {})
              }
            }
          }
        }
        // Repli quand aucune reprise STRICTE n'existe (le libellé a changé entre deux tours) :
        // on récupère quand même l'analyse en lecture seule déjà produite dans CETTE
        // conversation, plutôt que de la repayer. Mesuré : « scout … vue Chat »
        // puis « Fais tout … » ne s'apparient pas, et le scout est intégralement rejoué.
        // Aucun checkpoint n'est repris ici : seuls des textes de phase sont réinjectés.
        // Le tour et le dossier du run : `think` n'est repris que pour la même demande, et si les
        // fichiers que son briefing cite n'ont pas changé depuis (`think-briefing.ts`).
        const resumeOutputs =
          resumable?.phaseOutputs ??
          (await bus.os.acquiredAnalysisForConversation?.(task, convId, Date.now(), {
            turnId: orchestrationTurnId,
            workspace: bus.workspaceDuTour
          })) ??
          []
        bus.broadcast({ type: 'orchestrate-start', convId, runPath, task: requestedTask })
        let currentRunId: string | undefined
        let terminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
        let publishedCommitSha: string | undefined
        let resumedCheckpointReleased = false
        let phaseStartIteration = 0
        const r = await bus.os.runTask(
          task,
          (step) => {
            steps.push(step)
            /*
             * SIGNE DE VIE vers le tour de chat qui attend cette commande.
             *
             * `onProgress` n'etait branche que sur `run` et `verify` : une orchestration
             * n'emettait RIEN pendant tout son travail. Le veilleur d'inactivite du tour
             * (`run-pilot-chat.ts`, plafond 20 min) la prenait donc pour morte et coupait le tour
             * pendant qu'elle tournait encore. Mesure (2026-09-02) : run de 25 min, tour
             * coupe a 20, compte-rendu perdu alors que le run a fini VERT. Chaque phase battue ici
             * remet le veilleur a zero — il distingue enfin « long » de « mort ».
             */
            dernierSigneDeVie = bornerLigneDeVie(
              `phase ${step.step}${step.status ? ` · ${step.status}` : ''}${
                step.detail ? ` · ${step.detail}` : ''
              }`
            )
            onProgress?.(dernierSigneDeVie)
            persistOrchestrationStep(
              step,
              {
                conversationId: convId,
                turnId: orchestrationTurnId,
                iteration: step.step === 'exec' ? 0 : 1,
                runId: currentRunId
              },
              undefined,
              bus.traceStore
            )
            // A3 — peuplement LIVE du RUN.md : à chaque phase exec terminée, on réécrit le
            // livrable dans le RUN.md que Workflows affiche (au lieu d'un template vide 7 min).
            // Chantier 3 — trace native (spool Autowin) pour l'observabilité RAG/injection.
            if (step.prompt) {
              appendNativeTrace({
                provider: step.prompt.provider,
                model: step.prompt.model,
                conversationId: convId,
                turnId: orchestrationTurnId,
                system: step.prompt.system,
                messages: step.prompt.messages,
                timestamp: new Date().toISOString()
              })
            }
            if (runPath && step.step === 'exec' && step.text) {
              const livePhases = steps
                .filter((s) => s.step === 'exec' && s.text)
                .map((s) => ({
                  phase:
                    (s.detail ?? '').replace(/^phase /, '').replace(/ \(réparation\)$/, '') ||
                    'build',
                  text: s.text as string,
                  executionEvidence: s.evidence
                }))
              populateConvRunSections(runPath, livePhases)
            }
            // Le plan du build découpé, relisible AVANT le code et suivi sous-tâche par sous-tâche.
            // Sans découpage, aucune lecture du RUN.md.
            if (runPath) mettreAJourPlanDuRun(runPath, steps)
            /*
             * LA TRACE SUR DISQUE SUIT LE RUN ÉTAPE PAR ÉTAPE (2026-10-19).
             *
             * Elle n'était écrite qu'à la fin du run : une interface rechargée en plein run (
             * 2 h de boucle juge → réparation) avait perdu tout ce qui précédait, et rien sur disque ne
             * pouvait le lui rendre. Écrite AVANT la diffusion de l'étape et en synchrone : quand
             * l'interface reçoit `orchestrate-step` et relit le fichier, il porte déjà cette étape.
             * Coût mesuré sur la plus grosse trace du poste (2,9 Mo, 54 étapes) : 14 ms
             * par réécriture, 0,45 s cumulées sur tout le run.
             */
            if (runPath) saveConvRunTrace(runPath, steps)
            bus.broadcast({ type: 'orchestrate-step', convId, runPath, step })
            /*
             * Le cadrage devient CONTESTABLE ici, et nulle part ailleurs.
             *
             * Le brief de FRAME impose depuis toujours une section `## Confiance` etiquetant chaque
             * affirmation porteuse. Mesure du 20/08 : personne ne la lisait — l'utilisateur
             * decouvrait le malentendu a la fin, dans un livrable deja bati dessus. La phase est
             * lue telle que le code voisin la lit (`detail` = « phase frame »), avec
             * `execution.phase` quand il est renseigne.
             */
            if (convId) {
              const phaseDuStep =
                step.execution?.phase ??
                (step.detail ?? '').replace(/^phase /, '').replace(/ \(réparation\)$/, '')
              if (phaseDuStep === 'frame') {
                const hypotheses = hypothesesDuCadrage(step.text)
                if (hypotheses.length) {
                  bus.broadcast({
                    type: 'orchestrate-hypotheses',
                    convId,
                    runPath,
                    hypotheses
                  })
                }
              }
            }
            // Journal d'activité de la conversation : chaque étape facturée + coût tokens.
            if (convId) {
              appendConvActivity(convId, {
                kind: step.step,
                label: step.role ?? step.step,
                provider: step.provider,
                model: step.model,
                // Meme champ que les lignes du chat (2026-10-16) : l'effort lu dans l'argv envoye.
                reasoningEffort: effortEnvoyeDeLEnveloppe(step.prompt),
                inputTokens: step.usage?.inputTokens,
                outputTokens: step.usage?.outputTokens,
                cacheReadTokens: step.usage?.cacheReadTokens,
                costUsd: step.usage?.costUsd ?? step.costUsd,
                usageCallId: step.usageCallId,
                // Rattachement EXACT au tour et a la phase : sans eux, le rapport de rendement
                // ne pouvait relier une depense a une demande que par l'heure, donc a peu pres.
                turnId: orchestrationTurnId,
                // Sans le run, une depense de sous-agent n'est rattachable a aucun bras de banc.
                runId: currentRunId ?? step.execution?.runId,
                phase:
                  (step.execution?.phase ??
                    (step.detail ?? '').replace(/^phase /, '').replace(/ \(réparation\)$/, '')) ||
                  undefined,
                // La duree etait DEJA mesuree par l'orchestrateur et jetee ici : sans elle, on ne
                // pouvait repondre qu'a « quelle phase coute », pas a « quelle phase est LENTE ».
                durationMs: step.durationMs,
                text: step.text ?? step.detail
              })
            }
          },
          (phase) => {
            /*
             * LE DEBUT DE PHASE ARRIVE ENFIN DANS LE FIL.
             *
             * Ce rappel existait deja, mais il ne parlait qu'a la carte du panneau Workflows
             * (`orchestrate-phase`) et a la trace causale. Le fil, lui, n'apprenait jamais qu'on
             * passait de `frame` a `build`. On REUTILISE la source existante plutot que d'en
             * fabriquer une seconde — meme regle que la note d'outil juste en dessous.
             *
             * Le dernier fait connu est REMIS A ZERO au passage : garder la derniere commande de
             * la phase precedente afficherait un fait perime sous le nom de la nouvelle phase.
             */
            if (phase.phase) {
              phaseCourante = phase.phase
              dernierSigneDeVie = undefined
              onProgress?.(
                battementDOrchestration(undefined, Date.now() - debutRun, phaseCourante)
              )
            }
            if (currentRunId) {
              persistOrchestrationPhaseStart(
                phase,
                {
                  conversationId: convId,
                  turnId: orchestrationTurnId,
                  iteration: phaseStartIteration++,
                  runId: currentRunId
                },
                bus.traceStore
              )
            }
            bus.broadcast({ type: 'orchestrate-phase', convId, runPath, phase })
          },
          (step, delta, note, raisonnement) => {
            // Une NOTE (« Bash en cours — 2 min 30 s ») voyage sur le meme evenement mais dans
            // son propre champ : le renderer la range hors du texte, qui est le livrable.
            //
            // ELLE PART AUSSI DANS LE FIL, et c'est le correctif du 2026-08-25. Mesure dans l'app
            // reelle : « 1 action en cours · Orchestration » est reste muet ONZE minutes, parce
            // que cette note n'alimentait que la carte du panneau Workflows. Le battement livre la
            // veille ne couvrait que `verify` : le trou noir n'avait pas disparu, il s'etait
            // deplace d'un cran. On REUTILISE la note existante — en fabriquer une seconde ferait
            // diverger deux verites sur le meme fait.
            if (note) {
              dernierSigneDeVie = bornerLigneDeVie(note)
              onProgress?.(dernierSigneDeVie)
            }
            /*
             * LE RAISONNEMENT N'EST PAS UNE LIGNE D'ETAT (2026-10-13).
             *
             * Ses fragments arrivaient comme des notes : chacun ECRASAIT la ligne de vie, qui
             * affichait trois mots de reflexion en anglais (« and now 1/2 could ») au lieu de ce
             * que l'agent fait — et ces mots n'etaient gardes nulle part. La ligne dit donc
             * seulement « réfléchit… » tant qu'il reflechit (une fois par serie, pas a chaque
             * fragment), et le texte entier part au fil, qui l'accumule sous la phase.
             */
            if (raisonnement && dernierSigneDeVie !== EN_REFLEXION) {
              dernierSigneDeVie = EN_REFLEXION
              onProgress?.(
                battementDOrchestration(dernierSigneDeVie, Date.now() - debutRun, phaseCourante)
              )
            }
            bus.broadcast({
              type: 'orchestrate-delta',
              convId,
              runPath,
              deltaStep: step,
              delta,
              ...(note ? { note } : {}),
              ...(raisonnement
                ? {
                    reasoning: raisonnement,
                    ...(phaseCourante ? { reasoningPhase: phaseCourante } : {})
                  }
                : {})
            })
          },
          abortController.signal,
          collectedContext,
          resumeOutputs,
          // `conversationId` MANQUAIT aussi : sans lui, l'acquis persiste sans conversation et une
          // reprise ne peut plus etre rattachee a son fil.
          convId,
          bindingOverride,
          (brain) =>
            appendBrainTrace({
              ...brain,
              conversationId: convId,
              turnId: orchestrationTurnId,
              kind: brain.kind ?? 'automatic'
            }),
          orchestrationTurnId,
          (lifecycle) => {
            currentRunId = lifecycle.runId
            if (lifecycle.stage === 'git' && lifecycle.git.outcome === 'merged') {
              publishedCommitSha = lifecycle.git.commitSha
            }
            // Le supervisor refuse une reprise avec provider encore actif AVANT d'entrer ici.
            // Conserver l'ancien checkpoint jusque ce premier evenement evite de perdre les phases
            // deja payees lorsqu'une admission echoue. Une fois admis, le nouveau run prend le relais.
            if (resumable && !resumedCheckpointReleased) {
              resumedCheckpointReleased = true
              // La reprise conserve désormais son runId pour rouvrir le même worktree. Dans ce
              // cas l'orchestrateur vient de réécrire CE checkpoint : l'effacer ici détruirait la
              // prochaine reprise si le process retombe avant la phase suivante.
              if (currentRunId !== resumable.runId) {
                bus.os.forgetResumableOrchestration(resumable.runId)
              }
              const reused = resumeOutputs.map((output) => output.phase).join(', ')
              bus.broadcast({
                type: 'orchestrate-step',
                convId,
                runPath,
                step: {
                  step: 'exec',
                  role: 'subagent',
                  text: '',
                  status: 'completed',
                  detail: `reprise : phases deja acquises reutilisees (${reused})`
                } as OrchestrationStep
              })
            }
            if (lifecycle.stage === 'closure') {
              terminalLifecycle = lifecycle
              // Le lifecycle terminal est le premier verdict durable du moteur. Un commit peut
              // redémarrer Electron avant que runTask retourne : attendre ce retour laissait alors
              // le RUN.md ouvert malgré une clôture déjà acquise dans la trace.
              if (runPath && lifecycle.closure.status !== 'open') {
                closeConvRun(
                  runPath,
                  // Coupé par Stop, quota ou panne : `interrupted`, pas `red` (piste 4).
                  statutDuRunMd(lifecycle.closure),
                  ligneDeClotureDuMoteur(lifecycle.closure)
                )
                bus.broadcast({ type: 'refresh', scope: 'workflows' })
              }
            }
            persistRunLifecycle(
              lifecycle,
              {
                conversationId: convId,
                turnId: orchestrationTurnId,
                runPath
              },
              bus.traceStore
            )
          },
          resumable ?? undefined,
          (usage) => {
            if (!currentRunId) return
            const settledLifecycle = reconcileLateRunLifecycle(terminalLifecycle, usage)
            if (!settledLifecycle) return
            terminalLifecycle = settledLifecycle
            persistRunLifecycle(
              terminalLifecycle,
              { conversationId: convId, turnId: orchestrationTurnId, runPath },
              bus.traceStore
            )
            const costCoverage = formatExecutionCostCoverage({
              costUsd: usage.knownCostUsd ?? 0,
              knownCostUsd: usage.knownCostUsd,
              unpricedCalls: usage.unpricedCalls
            })
            if (runPath) {
              closeConvRun(
                runPath,
                statutDuRunMd(terminalLifecycle.closure),
                `Usage provider finalisee apres cloture: ${usage.totalTokens} tokens, ${costCoverage ?? 'cout non rapporte'}, ${usage.activeCalls} appel(s) actif(s).`
              )
            }
            bus.broadcast({ type: 'orchestrate-usage', convId, runPath })
            bus.broadcast({ type: 'refresh', scope: 'workflows' })
            bus.broadcast({ type: 'refresh', scope: 'orchestration' })
          },
          runtimeSnapshot,
          causalWatchPaths,
          onLateMutationClaims,
          // LE DOSSIER DU TOUR SUIT JUSQU'AU PIPELINE (2026-09-17).
          // La correction du 2026-09-16 n'avait rebranche que les commandes de fichier et
          // `verify` : `orchestrate` laissait l'orchestrateur lire `deps.executionWorkspace`,
          // fige au demarrage de l'app. Une conversation rangee sur un AUTRE depot lancait donc
          // son run dans le depot d'Autowin. Mesure : une demande visant
          // D:/ContosoV3Desktop a produit un run analysant D:/AutoWinOS, 11,65 $ perdus.
          { workspace: bus.workspaceDuTour }
        )
        if (!r.gateBlocked) {
          const causalEvidence = causalWatchPaths.length
            ? (r.causalMutationEvidence ?? [])
            : steps.flatMap((step) => step.evidence ?? [])
          appendExecutionEvidenceFileTrace(causalEvidence, {
            conversationId: convId,
            turnId: orchestrationTurnId,
            workspaceRoot: bus.workspaceDuTour,
            published: true
          })
        }
        const lessonStep = [...steps]
          .reverse()
          .find((step) => step.text?.includes(OUTCOME_LESSON_MARKER))
        const learning: OutcomeLearningResult | undefined = await bus.observeOutcomeLearning({
          conversationId: convId,
          turnId: orchestrationTurnId,
          runId: currentRunId ?? runPath ?? orchestrationTurnId,
          resultText: r.result,
          valid: r.valid,
          gateBlocked: r.gateBlocked,
          gateReasons: r.gateReasons,
          reused: run?.reused ?? false,
          evidence: r.phaseOutputs.flatMap((output) => output.executionEvidence ?? []),
          model:
            lessonStep?.model ??
            bindingOverride?.model ??
            bus.os.roles.getBinding('orchestrator').model ??
            'autowin',
          role: lessonStep?.role ?? 'orchestrator',
          proposalAttestations: r.learningAttestations
        })
        // Les notes que l'étape learn a déposées au Brain comptent dans l'état affiché.
        const learningDuRun = avecNotesDeposees(learning, r.notesBrainDeposees)
        const terminalStatus =
          r.gateBlocked || !r.valid
            ? 'red'
            : terminalLifecycle && terminalLifecycle.closure.status !== 'open'
              ? terminalLifecycle.closure.status
              : 'green'
        const terminalDetail = r.gateBlocked
          ? `Gate BLOQUÉ: ${r.gateReasons.join('; ')}`
          : !r.valid
            ? 'Livrable refusé par le juge.'
            : undefined
        // La sortie ENTIÈRE des étapes, à côté du RUN.md. Le panneau du run la lit par
        // ce nom, et la bulle coupée la nomme (copie permanente, contrairement à `run-livrables`).
        const livrableDuRun =
          runPath && r.phaseOutputs.some((sortie) => sortie.text.trim())
            ? cheminDuLivrableDuRun(runPath)
            : undefined
        if (runPath && livrableDuRun)
          void ecrireLivrableDuRun(runPath, currentRunId ?? runPath, r.phaseOutputs).catch(
            () => undefined
          )
        if (runPath) {
          const costCoverage = formatExecutionCostCoverage({
            costUsd: r.costUsd,
            knownCostUsd: r.usage?.knownCostUsd,
            unpricedCalls: r.usage?.unpricedCalls
          })
          saveConvRunTrace(runPath, steps)
          if (publishedCommitSha && !r.gateBlocked && r.valid) {
            try {
              bus.onRunVertPublie?.({ task, publishedCommitSha })
            } catch {
              // Le save est un bonus de capitalisation : il n'a pas le droit de toucher au run.
            }
          }
          // J2 — RUN.md peuplé du vrai livrable, VERDICT DU JUGE COMPRIS : c'est la seule
          // source que `orchestration-memoire` sait relire au run suivant.
          populateConvRunSections(runPath, phasesAvecJuge(r.phaseOutputs, r.judgeText), {
            publishedCommitSha
          })
          closeConvRun(
            runPath,
            terminalStatus,
            terminalDetail ??
              // Piste 5 : une relecture livrée avec défauts ne s'écrit pas « validé ».
              (r.defautsDuTravailRelu?.length
                ? ligneDeJournalDeRelecture(
                    r.defautsDuTravailRelu,
                    costCoverage ?? 'coût non rapporté'
                  )
                : `Juge: validé — clôture autorisée (${costCoverage ?? 'coût non rapporté'}).`)
          )
        }
        bus.broadcast({
          type: 'orchestrate-end',
          convId,
          runPath,
          // L'EVENEMENT reste binaire (son contrat est `'green' | 'red'`), mais il compte
          // desormais le refus du juge : `!r.valid` valait « vert » jusqu'ici, alors que le
          // livrable avait ete REFUSE. Le statut de cloture, lui, garde toute sa finesse
          // (`degraded-closed` compris) et part dans `closeConvRun` juste au-dessus.
          status: r.gateBlocked || !r.valid ? 'red' : 'green',
          ...(terminalDetail ? { detail: terminalDetail } : {})
        })
        bus.broadcast({ type: 'refresh', scope: 'workflows' })
        bus.broadcast({ type: 'refresh', scope: 'orchestration' })
        const resolvedModel = [...steps]
          .reverse()
          .find(
            (step) =>
              step.step === 'exec' &&
              step.status === 'completed' &&
              step.provider === bindingOverride?.provider &&
              Boolean(step.model)
          )?.model
        // Modèle retenu pour TARIFER les appels non chiffrés : à défaut d'une étape exec relevée,
        // le modèle demandé reste une source tracée (jamais une famille devinée).
        const pricingModel =
          resolvedModel ??
          bindingOverride?.model ??
          bus.os.roles.getBinding('orchestrator').model
        return {
          valid: r.valid,
          gateBlocked: r.gateBlocked,
          costUsd: r.costUsd,
          // Couverture de coût : projection PARTAGÉE avec le handler direct `os:orchestrate`, pour
          // que les deux lignées d'une même pastille disent la même chose (`shared/`).
          ...executionCostCoverageFields(r.usage, pricingModel),
          ...(resolvedModel ? { resolvedModel } : {}),
          result: r.result,
          gateReasons: r.gateReasons,
          turnId: orchestrationTurnId,
          runId: runPath ?? orchestrationTurnId,
          runPath,
          // La bulle coupée nomme la copie entière des sorties d'étapes — la voisine du
          // RUN.md quand elle existe (permanente), sinon celle de `run-livrables`.
          ...((livrableDuRun ?? r.livrableEntier)
            ? { livrableEntier: livrableDuRun ?? r.livrableEntier }
            : {}),
          /*
           * PORTEE REELLEMENT JOUEE. Cette lignee recompose l'issue champ par champ (les deux
           * autres font `...result`) et OUBLIAIT `phaseOutputs`. Le pied de cloture derive la
           * portee de ce champ : vide, il tombe dans la branche « portee inconnue » et sort
           * « rien ne prouve que le besoin est fait » APRES un `/frame` parfaitement joue
           * (mesure du 2026-08-28, run frame-traite-ensemble-ces-6-candidats). Seuls les NOMS de
           * phase voyagent : le texte vit deja dans `result` et dans RUN.md, l'y remettre
           * doublerait le poids de l'issue sur l'IPC.
           */
          // Le JUGE joue compte aussi : son verdict vit a part (`judgeText`), et sans
          // lui la cloture d'un run deja juge recommandait « lancer judge » -- un juge paye de trop.
          phaseOutputs: phasesAvecJuge(r.phaseOutputs, r.judgeText).map((output) => ({
            phase: output.phase,
            text: ''
          })),
          status: r.gateBlocked ? 'failed' : 'succeeded',
          // Le texte du juge ne voyage pas (il vit dans RUN.md) : son verdict LU, si.
          ...(r.verdictDuJuge ? { verdictDuJuge: r.verdictDuJuge } : {}),
          reused: run?.reused ?? false,
          // Le travail est-il reste dans la copie isolee ? C'est ce signal — jamais le vocabulaire
          // du conseil — qui decide si le `👉 Recommandé` du worker s'adresse encore a un arbre
          // qui a recu son code (cf. `demoteUnvalidatedSuccessClaims`).
          workRetained: r.retainedWorkspace !== undefined,
          ...(learningDuRun ? { learning: learningDuRun } : {}),
          /*
           * LE RUN PARLE LUI-MEME A LA FIN : la question du bilan de sa derniere
           * etape devient une carte « Message du run » dans le fil (ask-choices.ts). Seulement
           * sur un run LIVRE : apres un refus du juge ou du controle final, une question comme
           * « je publie ? » porterait sur un travail que personne n'a accepte.
           */
          ...(() => {
            const message = r.valid && !r.gateBlocked ? messageDuRun(r.phaseOutputs) : undefined
            return message ? { messageDuRun: message } : {}
          })()
        }
      } catch (e) {
        await bus.observeOutcomeLearning({
          conversationId: convId,
          turnId: orchestrationTurnId,
          runId: runPath ?? orchestrationTurnId,
          resultText: '',
          valid: false,
          gateBlocked: true,
          gateReasons: [e instanceof Error ? e.message : String(e)],
          reused: run?.reused ?? false,
          evidence: steps.flatMap((step) => step.evidence ?? []),
          model:
            bindingOverride?.model ?? bus.os.roles.getBinding('orchestrator').model ?? 'autowin',
          role: 'orchestrator',
          // Quota, surcharge ou session expirée : la cause est hors du travail jugé, donc jamais
          // une leçon publiable sur le code (`classe-terminale-echec.ts`).
          terminalClass: classeTerminaleDEchec(e, abortController.signal.aborted)
        })
        if (runPath) {
          saveConvRunTrace(runPath, steps)
          // Le moteur a d'ordinaire déjà écrit le statut (clôture du cycle de vie) ; ce chemin
          // couvre l'erreur levée avant elle. Même règle : arrêt extérieur → `interrupted`.
          const interrompu = causeDInterruption(e, abortController.signal.aborted)
          closeConvRun(
            runPath,
            interrompu ? 'interrupted' : 'red',
            `${interrompu ? 'Orchestration interrompue' : 'Orchestration en échec'}: ${ligneJournalDErreur(e)}`
          )
        }
        bus.broadcast({
          type: 'orchestrate-end',
          convId,
          runPath,
          status: 'red',
          detail: e instanceof Error ? e.message : String(e)
        })
        bus.broadcast({ type: 'refresh', scope: 'workflows' })
        throw e
      } finally {
        if (battementOrchestration) clearInterval(battementOrchestration)
        bus.clearOrchestration(convId, abortController)
        if (bus.activeOrchestrationByFingerprint.get(fingerprint) === runReady) {
          bus.activeOrchestrationByFingerprint.delete(fingerprint)
        }
      }
    }
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
