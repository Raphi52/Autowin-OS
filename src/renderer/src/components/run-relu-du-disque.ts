import { useEffect, useState } from 'react'
import type { LiveRunPhase, ScopedLiveRun } from './chat-view-model'
import type { StepDeRun } from './juges-votes'

/**
 * LE RUN QUE L'INTERFACE A PERDU, RELU SUR DISQUE (conv-1021, 2026-10-19).
 *
 * Les runs en direct du fil (`liveRuns`, ChatView) naissent à `orchestrate-start`. Une interface
 * rechargée en plein run (rechargement à chaud, Ctrl+R) a manqué ce départ, et le réducteur ignore
 * ensuite TOUS les événements d'un run inconnu (`reduceScopedLiveRuns` : `if (!existing) return`).
 * Le bloc des juges restait donc vide jusqu'à la fin du run — 2 h sur conv-1019. Le main écrit
 * désormais `trace.json` à chaque étape, avant de la diffuser (`commands.ts`) : on relit ce fichier,
 * puis on suit les événements suivants du même run.
 *
 * Ce que le disque ne dit pas : la phase en cours et le texte qu'elle a déjà écrit. Après un
 * rechargement au milieu d'un juge, son texte n'apparaît qu'au juge suivant ; son verdict, lui,
 * arrive dès qu'il tombe.
 */

/** Un RUN.md encore ouvert. Un run clos a fini : le bloc du tour terminé prendra le relais. */
const RUN_OUVERT = new Set(['open', 'running', 'pending'])

export interface RunDeLaConversation {
  path?: string
  summary?: { status?: string }
}

export interface EvenementDuRun {
  type: string
  convId?: string
  runPath?: string
  status?: string
  phase?: LiveRunPhase
  delta?: string
}

export interface LecteurDuRunPerdu {
  /** Les runs de la conversation, du plus récent au plus ancien (`conversationRuns`). */
  runs: (convId: string) => Promise<readonly RunDeLaConversation[]>
  /** Le fil des sous-agents d'un run (`runTrace` → `trace.json`). */
  trace: (path: string) => Promise<unknown>
  /** Les événements du bus (`onAppEvent`) ; rend la fonction qui se désabonne. */
  ecouter: (cb: (e: EvenementDuRun) => void) => () => void
}

const lecteurDeLApp: LecteurDuRunPerdu = {
  runs: async (convId) => (await window.api?.conversationRuns?.(convId)) ?? [],
  trace: async (path) => (await window.api?.runTrace?.(path)) ?? null,
  ecouter: (cb) => window.api?.onAppEvent?.(cb) ?? (() => undefined)
}

/**
 * Un événement du bus appliqué au run relu. Une étape terminée ne s'AJOUTE pas ici : le fichier,
 * relu juste après, la porte déjà — l'ajouter aussi la compterait deux fois.
 */
export function suivreLeRunRelu(
  run: ScopedLiveRun<StepDeRun>,
  e: EvenementDuRun
): ScopedLiveRun<StepDeRun> {
  if (e.runPath && run.runPath && e.runPath !== run.runPath) return run
  switch (e.type) {
    case 'orchestrate-phase':
      return e.phase ? { ...run, phase: e.phase, liveText: '' } : run
    case 'orchestrate-delta':
      // Seul le texte du JUGE sert au bloc : celui d'un build de 30 min ne ferait que le redessiner.
      return typeof e.delta === 'string' && run.phase?.step === 'judge'
        ? { ...run, liveText: (run.liveText ?? '') + e.delta }
        : run
    case 'orchestrate-step':
      return { ...run, phase: undefined, liveText: undefined }
    case 'orchestrate-end':
      return {
        ...run,
        status: e.status === 'red' ? 'red' : 'green',
        phase: undefined,
        liveText: undefined
      }
    default:
      return run
  }
}

/**
 * Le run en cours de la conversation, reconstruit depuis `trace.json` puis tenu à jour par le bus.
 * `actif` faux (l'interface a le run en direct) : rien n'est lu, rien n'est écouté.
 */
export function useRunReluDuDisque(
  conversationId: string,
  actif: boolean,
  lecteur: LecteurDuRunPerdu = lecteurDeLApp
): ScopedLiveRun<StepDeRun> | undefined {
  const [run, setRun] = useState<ScopedLiveRun<StepDeRun>>()
  useEffect(() => {
    if (!actif) return
    let vivant = true
    let chemin: string | undefined
    let demandes = 0
    let appliquee = 0
    const relire = (path: string): void => {
      const rang = ++demandes
      void lecteur
        .trace(path)
        .catch(() => null)
        .then((lue) => {
          // Une relecture plus ancienne ne doit jamais écraser une plus récente.
          if (!vivant || rang < appliquee || !Array.isArray(lue)) return
          appliquee = rang
          setRun((courant) => ({
            ...(courant ?? { convId: conversationId, task: '', status: 'running' as const }),
            runPath: path,
            steps: lue as StepDeRun[]
          }))
        })
    }
    const adopter = (path: string): void => {
      if (chemin) return
      chemin = path
      relire(path)
    }
    const desabonner = lecteur.ecouter((e) => {
      if (!vivant || e.convId !== conversationId) return
      if (!chemin) {
        // Pas de run ouvert trouvé au montage : la première étape diffusée désigne le bon.
        if (e.type === 'orchestrate-step' && e.runPath) adopter(e.runPath)
        return
      }
      if (e.runPath && e.runPath !== chemin) return
      setRun((courant) => (courant ? suivreLeRunRelu(courant, e) : courant))
      if (e.type === 'orchestrate-step') relire(chemin)
    })
    void lecteur
      .runs(conversationId)
      .catch(() => [] as RunDeLaConversation[])
      .then((runs) => {
        const dernier = runs[0]
        if (!vivant || !dernier?.path || !RUN_OUVERT.has(dernier.summary?.status ?? '')) return
        adopter(dernier.path)
      })
    return () => {
      vivant = false
      desabonner()
    }
  }, [conversationId, actif, lecteur])
  return actif ? run : undefined
}
