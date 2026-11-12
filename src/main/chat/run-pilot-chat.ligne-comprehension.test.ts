import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FLUX_LECTURE_RETENUE } from '../../shared/lecture-retenue'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * LA LIGNE « COMPRÉHENSION » N'EST PAS DU TEXTE DIT PAR LE MODÈLE.
 *
 * Elle part en parallèle de la réponse (`lectures-du-tour.ts`) et peut donc tomber AU MILIEU du
 * texte que le modèle diffuse. Comptée dans le déjà-dit, elle s'y intercale (début + ligne + fin) :
 * `resteADire` n'y retrouve plus le texte final du modèle (début + fin), et la fin du tour republie
 * toute la réponse. MESURÉ du 01/11 au 12/11 : 28 réponses sur les 76 où la ligne est arrivée au
 * milieu portaient deux fois le même bloc « ✅ Fait », contre 8 sur 824 quand elle arrive en tête.
 *
 * Le VRAI tour de chat tourne ici (vrai stockage, faux modèle), et l'on lit le fil enregistré.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => {} }))

/** Accepte tout appel et rend un objet du même genre : les dépendances non observées. */
function souple(): never {
  const fn = (): unknown => souple()
  return new Proxy(fn, {
    get: (_cible, cle) => {
      if (cle === 'then') return undefined
      if (cle === Symbol.iterator) return () => [][Symbol.iterator]()
      if (cle === Symbol.toPrimitive) return () => ''
      return souple()
    },
    apply: () => souple()
  }) as never
}

const avecRepli = <T extends object>(propres: T): T =>
  new Proxy(propres, {
    get: (cible, cle) => (cle in cible ? cible[cle as keyof T] : souple())
  })

const LIGNE = 'Compréhension : « Agrandir le chiffre du médaillon »\n\n'
const DEBUT = 'Je grossis le chiffre du médaillon. '
const FIN = "C'est fait : le chiffre passe à 16 px.\n\n✅ Fait\n1. Taille changée, test vert."

type Evenement = { kind: string; streamId?: string; text?: string; iteration?: number }
type PartTexte = { streamId?: string; text: string }

/** Joue un tour dont le modèle émet `evenements`, et rend les parts texte du message enregistré. */
async function partsApres(evenements: Evenement[]): Promise<PartTexte[]> {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const fil = store.create({ title: 'comprehension', provider: 'claude' })
  const pilot = {
    chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
      for (const e of evenements) surEvenement(e)
      return { text: '' }
    })
  }
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: {
      bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }),
      routageChatLectureSeuleActif: () => false,
      getBinding: () => ({ provider: 'claude', model: 'modele-test' })
    },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot,
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-ligne-comprehension-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  await createRunPilotChat(deps)(
    undefined,
    [{ role: 'user', content: 'le chiffre sur le medaillon est trop petit' }],
    fil.id
  )
  const dernier = [...(store.get(fil.id)?.messages ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant')
  return (dernier?.parts ?? []).flatMap((p) =>
    p.kind === 'text' ? [{ streamId: p.streamId, text: p.text }] : []
  )
}

const modele = (text: string): Evenement => ({
  kind: 'delta',
  streamId: '0:0',
  text,
  iteration: 0
})
const ligne: Evenement = {
  kind: 'delta',
  streamId: FLUX_LECTURE_RETENUE,
  text: LIGNE,
  iteration: 0
}
const fin: Evenement = { kind: 'done', text: `${DEBUT}${FIN}` }
const republiees = (parts: PartTexte[]): PartTexte[] =>
  parts.filter((p) => String(p.streamId).endsWith(':closing'))

describe('ligne « Compréhension » arrivée au milieu de la réponse', () => {
  it('la réponse finale n’est pas republiée une seconde fois', async () => {
    const parts = await partsApres([modele(DEBUT), ligne, modele(FIN), fin])

    expect(republiees(parts)).toEqual([])
    expect(
      parts
        .map((p) => p.text)
        .join('\n')
        .match(/✅ Fait/g)
    ).toHaveLength(1)
    // La ligne reste affichée : seul son poids dans le « déjà dit » change.
    expect(parts.some((p) => p.streamId === FLUX_LECTURE_RETENUE)).toBe(true)
  })

  it('un texte final NEUF après la ligne est livré, et seulement lui', async () => {
    const parts = await partsApres([modele(DEBUT), ligne, fin])

    expect(republiees(parts).map((p) => p.text)).toEqual([FIN])
  })

  it('ligne arrivée en tête : toujours aucune copie', async () => {
    const parts = await partsApres([ligne, modele(DEBUT), modele(FIN), fin])

    expect(republiees(parts)).toEqual([])
  })
})
