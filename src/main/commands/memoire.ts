// Groupe de commandes « dépôt d’une leçon ou d’une préférence », sorti de AppCommandBus.run (conv-1508, lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import type { RoleBinding } from '../profil/roles'
import { retenirPreferenceAuProfil } from '../profil/profil-utilisateur'
import { envDuBrainPerso, origineBrainPerso, depotsBrainPerso, promouvoirBrainPerso } from '../brain/brain-perso'
import { rememberFact } from '../brain/brain-remember'
import type { OutcomeLearningResult } from '../brain/outcome-learning-supervisor'
import { brainServiceToken } from '../brain/brain-retrieval'
import { appendBrainTrace } from '../activity/brain-trace-spool'
import { noteRemembered } from '../brain/session-memory-echo'

/** Cas de `AppCommandBus.run` : dépôt d’une leçon ou d’une préférence. Corps déplacé tel quel depuis commands.ts (conv-1508, lot 2). */
export async function executerMemoire(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string,
  bindingOverride?: RoleBinding,
  turnId?: string
): Promise<unknown> {
  switch (name) {
    case 'remember': {
      // PRÉFÉRENCE → PROFIL LOCAL (conv-1098, 2026-10-22, demande de l'utilisateur) : le type
      // `preference` s'arrête ICI, avant tout appel au Brain partagé. Voir `retenirPreferenceAuProfil`.
      if (a.type === 'preference') return retenirPreferenceAuProfil(a)
      /*
       * BRAIN PERSO OU BRAIN D'ÉQUIPE (conv-1233, 2026-10-28) : l'agent range lui-même, d'après
       * `portee`. Sans Brain perso réglé, un fait perso est REFUSÉ, jamais rabattu sur l'équipe :
       * ce serait publier à toute l'équipe ce que l'utilisateur voulait garder pour lui.
       */
      const portee =
        String(a.portee ?? '')
          .trim()
          .toLowerCase() === 'perso'
          ? 'perso'
          : 'equipe'
      const envPerso = portee === 'perso' ? envDuBrainPerso() : undefined
      if (portee === 'perso' && !envPerso) {
        return {
          allowed: false,
          stored: false,
          rangement: 'rien',
          detail:
            'rien n’a été retenu — aucun Brain perso n’est réglé (Réglages › Diagnostic › Brain perso). Dis-le à l’utilisateur ; ne le range pas dans le Brain d’équipe à sa place'
        }
      }
      const rangement = portee === 'perso' ? 'Brain perso' : 'Brain d’équipe'
      const convId = conversationId ?? bus.activeConversationId ?? ''
      const learningOutcome =
        a.learningOutcome === 'success' || a.learningOutcome === 'failure'
          ? a.learningOutcome
          : undefined
      const releaseProposal =
        learningOutcome && convId && turnId
          ? bus.outcomeLearning?.reserveProposal(convId, turnId)
          : undefined
      if (learningOutcome && convId && turnId && bus.outcomeLearning && !releaseProposal) {
        return {
          stored: false,
          unknown: false,
          truncated: false,
          note: 'duplicate',
          detail:
            'rien n’a été écrit : ce tour a déjà sa leçon suivie. Si celle-ci corrige ou complète la première, rappelle `remember` sans `learningOutcome` : seul ce champ est limité à un par tour'
        }
      }
      if (a.source === 'session:current' && turnId) a = { ...a, source: `session:${turnId}` }
      let outcome: Awaited<ReturnType<typeof rememberFact>>
      let learning: OutcomeLearningResult | undefined
      try {
        outcome = await rememberFact(a, {
          token: brainServiceToken(envPerso),
          ...(envPerso ? { origin: origineBrainPerso(), deposited: depotsBrainPerso } : {}),
          authorAgent: 'autowin-os',
          model: bus.os.roles.getBinding('orchestrator').model ?? 'autowin',
          workspace: bus.workspaceDuTour
        })
        // Le Brain perso n'attend aucune relecture : le fait est promu puis indexé tout de suite.
        // Le compte-rendu du serveur dit « un humain le promeut » : faux ici, on le remplace.
        if (envPerso && outcome.stored) {
          promouvoirBrainPerso(envPerso)
          outcome = {
            ...outcome,
            detail:
              'rangé dans le Brain perso de l’utilisateur (privé) — promu et indexé tout de suite, sans relecture : trouvable par brain_query d’ici quelques secondes'
          }
        }
        if (outcome.fact && learningOutcome && convId && turnId && bus.outcomeLearning) {
          try {
            const linkedRunId =
              (typeof a.runId === 'string' && a.runId.trim()) ||
              bus.outcomeLearning.latestOutcome(convId, turnId)?.runId
            bus.outcomeLearning.recordProposal({
              conversationId: convId,
              turnId,
              ...(linkedRunId ? { runId: linkedRunId } : {}),
              outcome: learningOutcome,
              ...outcome.fact,
              candidateId: outcome.candidateId,
              stored: outcome.stored,
              unknown: outcome.unknown,
              truncated: outcome.fact.truncated,
              authorAgent: 'autowin-os',
              authorModel:
                bindingOverride?.model ??
                bus.os.roles.getBinding('orchestrator').model ??
                'autowin',
              authorRole: 'orchestrator'
            })
            learning = await bus.outcomeLearning.reconcile(convId, turnId)
          } catch {
            learning = { state: 'unknown', detail: 'ledger Brain indisponible ; dépôt conservé' }
          }
        }
      } finally {
        releaseProposal?.()
      }
      /**
       * L'ÉCRITURE VERS LE BRAIN EST UN APPEL AU BRAIN, et elle n'en laissait aucune trace.
       *
       * Le spool ne connaissait que la LECTURE (`automatic`, `query`). `remember` fait pourtant un
       * aller-retour réseau vers le même service, avec le même jeton — mais l'Observatory, qui
       * annonce « ce que le Brain a fait », n'en montrait rien : un dépôt réussi et un dépôt tombé
       * dans un service injoignable y étaient également invisibles.
       *
       * `injectedChars` vaut 0 À DESSEIN : rien n'est injecté dans le prompt par un dépôt. Le champ
       * mesure ce qui entre dans le contexte, pas le volume de l'échange — y mettre la taille du
       * fait ferait grossir des totaux d'injection avec du texte qui n'a jamais été injecté.
       */
      if (convId) {
        appendBrainTrace({
          timestamp: new Date().toISOString(),
          conversationId: convId,
          ...(turnId ? { turnId } : {}),
          kind: 'depot',
          query: `remember: ${outcome.fact?.title ?? String(a.title ?? '(sans titre)')}`,
          found: outcome.stored,
          status: outcome.stored ? 'found' : outcome.unknown ? 'unavailable' : 'empty',
          injectedChars: 0
        })
      }
      /**
       * ÉCHO : sans ça, le modèle écrit sans jamais relire — la moitié manquante de la mécanique de
       * claude.exe.
       *
       * On alimente dès que le fait est RECEVABLE (`outcome.fact` présent), et pas seulement sur un
       * dépôt réussi. Défaut relevé le 2026-07-30 : quand le Brain ne répond pas — service SMB partagé,
       * préchauffage de 30-40 s, donc cas courant — le fait n'était retenu NI durablement NI dans le
       * fil. Zéro mémoire, soit exactement la régression que l'écho existe pour fermer. L'état du dépôt
       * voyage avec le fait pour que rien ne soit présenté comme partagé alors qu'il ne l'est pas.
       *
       * Le contenu vient de `outcome.fact` — ce qui a été VALIDÉ — et jamais de `a.*`.
       */
      if (outcome.fact) {
        const attache = noteRemembered(convId, {
          title: outcome.fact.title,
          body: outcome.fact.body,
          scope: outcome.fact.scope,
          workspace:
            outcome.fact.scope.trim().toLowerCase() === 'global'
              ? 'global'
              : bus.workspaceDuTour,
          note: outcome.note,
          state: outcome.stored ? 'depose' : outcome.unknown ? 'inconnu' : 'local'
        })
        // Sans conversation, l'écho ne peut pas s'attacher : le DIRE plutôt que le perdre en silence.
        if (!attache) {
          return {
            ...outcome,
            ...(learning ? { learning } : {}),
            rangement,
            detail: `${outcome.detail} (non rattaché à ce fil : aucune conversation active)`
          }
        }
      }
      return { ...outcome, ...(learning ? { learning } : {}), rangement }
    }
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
