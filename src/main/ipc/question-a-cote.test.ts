/**
 * Canaux de la question à côté (conv-1362, lot 1/3), Electron simulé.
 *
 * Ce qui est prouvé : les canaux branchés sont EXACTEMENT ceux du contrat, tous derrière le contrôle
 * d'expéditeur, et le contrôle passe AVANT tout effet ; une question vide ou trop longue et un
 * identifiant vide sont refusés avant le moteur, et la valeur jumelle à la même borne passe ; côté pont,
 * le VRAI preload envoie chaque méthode sur son canal.
 */
import { tmpdir } from 'node:os'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANAUX_QUESTION_A_COTE, QUESTION_A_COTE_MAX } from '../../shared/question-a-cote'

const simule = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  gardes: [] as string[],
  refuser: false,
  exposes: new Map<string, unknown>(),
  invocations: [] as unknown[][],
  poser: [] as unknown[][],
  annuler: [] as unknown[]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => simule.handlers.set(canal, fn)
  },
  app: { getPath: () => tmpdir() },
  contextBridge: {
    exposeInMainWorld: (nom: string, valeur: unknown) => simule.exposes.set(nom, valeur)
  },
  ipcRenderer: {
    invoke: async (...args: unknown[]) => {
      simule.invocations.push(args)
    },
    on: () => undefined,
    removeListener: () => undefined,
    sendSync: () => undefined,
    send: () => undefined
  },
  webUtils: { getPathForFile: () => '' }
}))

vi.mock('./ipc-senders', () => ({
  assertTrustedRendererSender: (_event: unknown, portee: string) => {
    simule.gardes.push(portee)
    if (simule.refuser) throw new Error('expéditeur refusé')
  }
}))

vi.mock('../chat/question-a-cote', () => ({
  QuestionsACote: class {
    poser(...args: unknown[]): Promise<unknown> {
      simule.poser.push(args)
      return Promise.resolve({ ok: true, reponse: 'r', outilRefuse: false })
    }
    annuler(id: unknown): void {
      simule.annuler.push(id)
    }
  }
}))

const evenement = {}
const appeler = (canal: string, ...args: unknown[]): unknown =>
  simule.handlers.get(canal)?.(evenement, ...args)

beforeAll(async () => {
  const { registerQuestionACoteIpc } = await import('./question-a-cote')
  registerQuestionACoteIpc({ catalogue: () => [], comptes: () => [] })
})

beforeEach(() => {
  simule.gardes.length = 0
  simule.poser.length = 0
  simule.annuler.length = 0
  simule.refuser = false
})

describe('canaux de la question à côté', () => {
  it('branche exactement les canaux du contrat', () => {
    expect([...simule.handlers.keys()].sort()).toEqual(
      Object.values(CANAUX_QUESTION_A_COTE).slice().sort()
    )
  })

  it('contrôle l’expéditeur de chaque canal, avant tout effet', () => {
    simule.refuser = true
    expect(() => appeler('question-a-cote:poser', 'conv-1', 'q')).toThrow('expéditeur refusé')
    expect(() => appeler('question-a-cote:annuler', 'conv-1')).toThrow('expéditeur refusé')
    expect(simule.gardes).toEqual(['Question à côté', 'Question à côté'])
    expect(simule.poser).toHaveLength(0)
    expect(simule.annuler).toHaveLength(0)
  })

  it('refuse une question vide ou trop longue, accepte la limite exacte', async () => {
    expect(() => appeler('question-a-cote:poser', 'conv-1', '   ')).toThrow('question vide')
    const trop = 'x'.repeat(QUESTION_A_COTE_MAX + 1)
    expect(() => appeler('question-a-cote:poser', 'conv-1', trop)).toThrow('trop longue')
    expect(() => appeler('question-a-cote:poser', 'conv-1', 12)).toThrow('string attendue')
    expect(simule.poser).toHaveLength(0)

    const juste = 'x'.repeat(QUESTION_A_COTE_MAX)
    await appeler('question-a-cote:poser', 'conv-1', juste)
    expect(simule.poser).toEqual([['conv-1', juste]])
  })

  it('refuse un identifiant de fil vide ou trop long', () => {
    expect(() => appeler('question-a-cote:annuler', '  ')).toThrow('identifiant invalide')
    expect(() => appeler('question-a-cote:annuler', 'x'.repeat(201))).toThrow(
      'identifiant invalide'
    )
    appeler('question-a-cote:annuler', 'x'.repeat(200))
    expect(simule.annuler).toEqual(['x'.repeat(200)])
  })
})

describe('le pont', () => {
  it('envoie chaque méthode sur son canal', async () => {
    // Le preload refuse de s'exposer hors isolation de contexte : on se place dans le cas réel.
    const avant = (process as { contextIsolated?: boolean }).contextIsolated
    ;(process as { contextIsolated?: boolean }).contextIsolated = true
    try {
      await import('../../preload/index')
    } finally {
      ;(process as { contextIsolated?: boolean }).contextIsolated = avant
    }
    const api = simule.exposes.get('api') as {
      questionACote: {
        poser(id: string, q: string): Promise<unknown>
        annuler(id: string): Promise<void>
      }
    }
    await api.questionACote.poser('conv-1', 'q')
    await api.questionACote.annuler('conv-1')
    expect(simule.invocations).toEqual([
      ['question-a-cote:poser', 'conv-1', 'q'],
      ['question-a-cote:annuler', 'conv-1']
    ])
  })
})
