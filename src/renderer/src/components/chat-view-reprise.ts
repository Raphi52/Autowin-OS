import { useMemo, useState, useEffect } from 'react'
import { conversationsCoupeesParQuota, situationsDeReprise } from '../../../shared/reprise-quota'
import { texteFil, traceSilentFailure } from './chat-view-outils'
import type { Msg, RunEntry } from './chat-view-types'
import { hydrateStoredAssistant, type OrchStep } from './chat-view-model'
import { lireLivrableDuRun, relireRun, fusionnerRelecture } from './run-ouvert-a-jour'

// Extrait de ChatView.tsx tel quel, sans changement de comportement (conv-1508).
export type RepriseDesToursCtx = {
  activeRef: React.RefObject<string | null>
  busyConversations: Set<string>
  busyConversationsRef: React.RefObject<Set<string>>
  convs: import('./chat-view-types').Conv[]
  followTailRef: React.RefObject<boolean>
  liveMessagesRef: React.RefObject<Map<string, import('./chat-view-types').Msg[]>>
  openRunPathRef: React.RefObject<string | null>
  openTrace: import('./chat-view-model').OrchStep[] | null
  patchLast: (
    conversationId: string,
    fn: (m: import('./chat-view-model').HydratedAssistantMessage) => void,
    porte?: ((m: import('./chat-view-model').HydratedAssistantMessage) => boolean) | undefined
  ) => void
  publierFil: (conversationId: string | null, fil: import('./chat-view-types').Msg[]) => void
  sendLocksRef: React.RefObject<Set<string>>
  setConversationBusy: (id: string, value: boolean) => void
  setOpenRun: React.Dispatch<React.SetStateAction<import('./WorkflowsPanel').OpenRunState | null>>
  setOpenTrace: React.Dispatch<React.SetStateAction<import('./chat-view-model').OrchStep[] | null>>
  setRunDetailTab: React.Dispatch<React.SetStateAction<import('./WorkflowsPanel').RunDetailTab>>
  tourEncoreVivant: (id: string) => Promise<boolean>
}

// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel (conv-1508).
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useRepriseDesTours(ctx: RepriseDesToursCtx) {
  const {
    activeRef,
    busyConversations,
    busyConversationsRef,
    convs,
    followTailRef,
    liveMessagesRef,
    openRunPathRef,
    openTrace,
    patchLast,
    publierFil,
    sendLocksRef,
    setConversationBusy,
    setOpenRun,
    setOpenTrace,
    setRunDetailTab,
    tourEncoreVivant
  } = ctx
  /**
   * REPRISE DES CONVERSATIONS COUPÉES PAR LE QUOTA (demande du 2026-09-05).
   *
   * Une pastille ROUGE dont le motif est le mur de quota n'est pas un travail raté : c'est un
   * travail arrêté net. Quand l'abonnement revient, il faut relancer chaque fil À LA MAIN, un par
   * un. Ce bouton les reprend tous — et SEULEMENT ceux-là : une pastille rouge tombée sur une
   * vraie erreur se relancerait dans le vide (tri dans `conversationsCoupeesParQuota`).
   *
   * Depuis conv-1423, un fil repart aussi seul, une fois, à l'heure annoncée
   * (`src/main/chat/reprise-fil-apres-quota.ts`). Le bouton reste : il rend la main avant l'heure,
   * et après un essai raté. La ligne d'état dit lequel des deux cas attend l'utilisateur.
   */
  const convsCoupeesParQuota = useMemo(
    () => conversationsCoupeesParQuota(convs, busyConversations),
    [convs, busyConversations]
  )
  const situationsDeLaReprise = useMemo(
    () => situationsDeReprise(convsCoupeesParQuota),
    [convsCoupeesParQuota]
  )
  const [repriseQuotaEnCours, setRepriseQuotaEnCours] = useState(false)
  /**
   * Ou en est la file. Une reprise attend la FIN d'un tour avant de lancer le suivant : sans ce
   * compteur, une file de trois ne montre que le premier fil qui bouge, et se lit comme une panne.
   */
  const [repriseQuotaProgres, setRepriseQuotaProgres] = useState<string | null>(null)
  const [repriseQuotaNotice, setRepriseQuotaNotice] = useState<string | null>(null)
  /* Croix de fermeture (demande du 2026-09-15) : on retient la LISTE des fils coupes au moment du
     clic. Le bloc revient de lui-meme si un nouveau fil est coupe — masquer pour toujours ferait
     rater une coupure suivante. */
  const [repriseQuotaMasqueePour, setRepriseQuotaMasqueePour] = useState<string | null>(null)
  // L'état compte dans la clé : un fil masqué qui passe de « repart seul » à « à la main » revient.
  const cleRepriseQuota = convsCoupeesParQuota
    .map((c) => `${c.id}:${c.repriseQuota?.etat ?? ''}`)
    .sort()
    .join('|')
  // Le compte-rendu de reprise est une information de l'INSTANT : lu, il n'a plus de raison
  // d'occuper la barre. Sans cette expiration, « 2 conversations reprises. » restait affiche
  // indefiniment alors qu'il n'y avait plus rien a reprendre.
  useEffect(() => {
    if (!repriseQuotaNotice) return
    const t = setTimeout(() => setRepriseQuotaNotice(null), 10_000)
    return () => clearTimeout(t)
  }, [repriseQuotaNotice])
  async function reprendreConversationsCoupeesParQuota(): Promise<void> {
    if (repriseQuotaEnCours) return
    const cibles = convsCoupeesParQuota.map((c) => c.id)
    if (cibles.length === 0) return
    setRepriseQuotaEnCours(true)
    setRepriseQuotaNotice(null)
    let reprises = 0
    try {
      // SEQUENTIEL, a dessein : lancer dix fils d'un coup retomberait sur le meme mur, et
      // consommerait le quota qui vient tout juste de revenir.
      for (const [rang, id] of cibles.entries()) {
        setRepriseQuotaProgres(
          texteFil('quota.progres', {
            rang: rang + 1,
            total: cibles.length,
            attente: cibles.length - rang - 1
          })
        )
        try {
          await resumePilotTurn(id)
          reprises += 1
        } catch {
          // Un fil qui refuse ne doit pas emporter les suivants.
        }
      }
    } finally {
      setRepriseQuotaEnCours(false)
      setRepriseQuotaProgres(null)
      setRepriseQuotaNotice(
        reprises === cibles.length
          ? texteFil(reprises > 1 ? 'quota.reprisesFaites' : 'quota.repriseFaite', { n: reprises })
          : texteFil('quota.reprisesPartielles', { n: reprises, total: cibles.length })
      )
    }
  }
  // Le minuteur est armé AVANT que la fonction ne soit définie (ordre des déclarations) : il passe
  // par cette référence plutôt que par une capture, qui serait figée sur un état périmé.

  /**
   * Continue le fil sans recréer ni renvoyer le dernier message utilisateur.
   *
   * `cible` : la reprise groupée des conversations coupées par le quota vise des fils qui ne sont
   * PAS ouverts. Sans ce paramètre, chaque reprise aurait relancé la conversation active.
   */
  async function resumePilotTurn(cible?: string): Promise<void> {
    const conversationId = cible ?? activeRef.current
    if (
      !conversationId ||
      busyConversationsRef.current.has(conversationId) ||
      sendLocksRef.current.has(conversationId)
    )
      return
    const history: Msg[] = [
      ...(liveMessagesRef.current.get(conversationId) ?? []),
      hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    ]
    sendLocksRef.current.add(conversationId)
    liveMessagesRef.current.set(conversationId, history)
    publierFil(conversationId, history)
    setConversationBusy(conversationId, true)
    followTailRef.current = true
    try {
      const result = await window.api.resumePilotChat(conversationId)
      if (!result.ok || result.cancelled)
        patchLast(conversationId, (message) => {
          message.status = result.cancelled ? 'cancelled' : 'failed'
          message.done = true
          if (!result.cancelled)
            message.parts.push({ kind: 'error', cause: 'turn', message: result.error ?? 'erreur' })
        })
    } catch (error) {
      patchLast(conversationId, (message) => {
        message.status = 'failed'
        message.done = true
        message.parts.push({
          kind: 'error',
          cause: 'send',
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      sendLocksRef.current.delete(conversationId)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      if (!(await tourEncoreVivant(conversationId))) {
        patchLast(conversationId, (message) => {
          if (message.status === 'streaming') message.status = 'interrupted'
          message.done = true
        })
        setConversationBusy(conversationId, false)
      }
    }
  }

  /* --- workflows --- */

  async function viewRun(r: RunEntry): Promise<void> {
    // La carte s'ouvre TOUT DE SUITE en attente : sans ce premier etat, le clic ne renvoyait
    // aucun signe de vie jusqu'au retour des deux lectures.
    setOpenRun({ path: r.path, content: '', pending: true })
    setRunDetailTab('trace')
    // Fil des sous-agents (trace) d'abord ; à défaut, le RUN.md brut.
    try {
      const trace = (await window.api.runTrace(r.path)) as OrchStep[] | null
      setOpenTrace(trace && trace.length > 0 ? trace : null)
    } catch (error) {
      traceSilentFailure('run-trace', error)
      setOpenTrace(null)
    }
    // conv-989 : la sortie ENTIÈRE des étapes, voisine du RUN.md — le fil la coupe à 4 000.
    const livrable = await lireLivrableDuRun(window.api, r.path)
    const avecLivrable = livrable ? { livrable } : {}
    try {
      const fichier = await window.api.readNodeFile(r.path)
      setOpenRun({ path: fichier.path, content: fichier.content, mtime: r.mtime, ...avecLivrable })
    } catch (e) {
      setOpenRun({ path: r.path, content: '', error: String(e), mtime: r.mtime, ...avecLivrable })
    }
  }

  /**
   * RELECTURE SILENCIEUSE du run déplié, déclenchée par le panneau quand la date de son RUN.md a
   * bougé (demande du 2026-09-26 : « tout doit se rafraichir tout seul »).
   *
   * Différences avec `viewRun`, pour que la mise à jour ne se VOIE que par son contenu : pas
   * d'état « Ouverture du RUN.md… », l'onglet choisi reste, et un échec de lecture garde le
   * contenu affiché. Le détail et ses tests vivent dans `run-ouvert-a-jour.ts`.
   * Si l'utilisateur a replié ou changé de run pendant la lecture, le résultat est jeté.
   */
  async function relireRunOuvert(r: RunEntry): Promise<void> {
    const relu = await relireRun(window.api, r, openTrace, traceSilentFailure)
    // La fin du run réécrit le RUN.md APRÈS la sortie entière : c'est souvent cette relecture-ci
    // qui la trouve, un run ouvert pendant qu'il tournait n'en avait pas encore (conv-989).
    const livrable = await lireLivrableDuRun(window.api, r.path)
    if (openRunPathRef.current !== r.path) return
    setOpenTrace(relu.trace)
    if (relu.montrerRunMd) setRunDetailTab('runmd')
    setOpenRun((courant) => fusionnerRelecture(courant, r, relu.contenu, livrable))
  }
  return {
    convsCoupeesParQuota,
    situationsDeLaReprise,
    repriseQuotaEnCours,
    repriseQuotaProgres,
    repriseQuotaNotice,
    repriseQuotaMasqueePour,
    setRepriseQuotaMasqueePour,
    cleRepriseQuota,
    reprendreConversationsCoupeesParQuota,
    resumePilotTurn,
    viewRun,
    relireRunOuvert
  }
}
