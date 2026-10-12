import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Gels mesurés (gels.jsonl 2026-10-11 20:30, disque D: saturé) : 9 991 ms sur UN `openSync
// …/conv-253.jsonl` (ouverture du journal au premier `append` d'un tour de chat), puis 4 415 ms sur
// le `closeSync` du descripteur évincé — 14 s de fenêtre figée.
/** Compte-rendu de chaque fermeture asynchrone réellement faite par le système (erreur ou null). */
const fermeturesFaites = vi.hoisted(() => [] as { fd: number; erreur: unknown }[])

vi.mock('node:fs', async (orig) => {
  const reel = await orig<typeof import('node:fs')>()
  return {
    ...reel,
    openSync: vi.fn(reel.openSync),
    closeSync: vi.fn(reel.closeSync),
    mkdirSync: vi.fn(reel.mkdirSync),
    close: vi.fn((fd: number, rappel: (erreur: NodeJS.ErrnoException | null) => void) =>
      reel.close(fd, (erreur) => {
        fermeturesFaites.push({ fd, erreur })
        rappel(erreur)
      })
    )
  }
})

import { TraceStore } from './trace-store'
import type { TraceEventV1 } from './trace-event'

function event(conversationId: string, sequence: number): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: `${conversationId}-evt-${sequence}`,
    conversationId,
    turnId: 'turn-1',
    parentId: sequence ? `${conversationId}-evt-${sequence - 1}` : undefined,
    timestamp: new Date(1_000 + sequence).toISOString(),
    sequence,
    type: 'message',
    status: 'completed',
    actor: { id: 'human', kind: 'human', label: 'Vous' },
    recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    channel: 'user',
    payloads: [{ kind: 'user-message', content: `contenu ${sequence}` }],
    observation: { boundary: 'renderer', fidelity: 'exact' }
  }
}

const descripteurs = (store: TraceStore): Map<string, number> =>
  (store as unknown as { descriptors: Map<string, number> }).descriptors

/** Appels BLOQUANTS d'ouverture/fermeture/creation portant sur le journal ou son dossier. */
function appelsBloquants(root: string): string[] {
  const vus: string[] = []
  for (const [chemin] of vi.mocked(fs.openSync).mock.calls)
    if (String(chemin).startsWith(root)) vus.push(`openSync ${String(chemin)}`)
  for (const [chemin] of vi.mocked(fs.mkdirSync).mock.calls)
    if (String(chemin).startsWith(root)) vus.push(`mkdirSync ${String(chemin)}`)
  return vus
}

function remettreLesEspions(): void {
  vi.mocked(fs.openSync).mockClear()
  vi.mocked(fs.closeSync).mockClear()
  vi.mocked(fs.mkdirSync).mockClear()
  vi.mocked(fs.close).mockClear()
}

function dossier(nom: string): string {
  return fs.mkdtempSync(join(tmpdir(), `trace-ouverture-${nom}-`))
}

describe('TraceStore.preparerEcriture — ouverture du journal sans E/S bloquante', () => {
  it('journal préparé : append écrit sans openSync ni mkdirSync, et l’événement est sur le disque', async () => {
    const root = join(dossier('prepare'), 'causal-trace') // dossier pas encore créé
    const store = new TraceStore(root)
    try {
      remettreLesEspions()
      await store.preparerEcriture('conv-1')
      store.append(event('conv-1', 0)).append(event('conv-1', 1))
      expect(appelsBloquants(root)).toEqual([])
      const lignes = fs.readFileSync(join(root, 'conv-1.jsonl'), 'utf8').trim().split('\n')
      expect(lignes.map((l) => JSON.parse(l).id)).toEqual(['conv-1-evt-0', 'conv-1-evt-1'])
    } finally {
      store.fermer()
    }
  })

  it('le détecteur n’est pas aveugle : sans préparation, append ouvre en bloquant, une seule fois', () => {
    const root = dossier('repli')
    const store = new TraceStore(root)
    try {
      remettreLesEspions()
      store.append(event('conv-1', 0)).append(event('conv-1', 1)).append(event('conv-1', 2))
      // Une ouverture et une création de dossier pour TROIS événements : le `mkdirSync` fait jadis
      // à chaque événement n'est plus fait que pour ouvrir.
      expect(appelsBloquants(root)).toEqual([
        `openSync ${join(root, 'conv-1.jsonl')}`,
        `mkdirSync ${root}`
      ])
    } finally {
      store.fermer()
    }
  })

  it('le descripteur évincé au-delà de 32 est refermé sans closeSync, et vraiment fermé', async () => {
    const root = dossier('eviction')
    const store = new TraceStore(root)
    try {
      store.append(event('conv-0', 0))
      const evince = descripteurs(store).get('conv-0')!
      remettreLesEspions()
      for (let i = 1; i <= 32; i += 1) store.append(event(`conv-${i}`, 0))
      expect(descripteurs(store).has('conv-0')).toBe(false)
      expect(vi.mocked(fs.closeSync)).not.toHaveBeenCalled()
      expect(vi.mocked(fs.close).mock.calls.map(([fd]) => fd)).toEqual([evince])
      // Vraiment fermé : le système a rendu la fermeture SANS erreur. (Pas de `fstatSync(evince)` : le
      // numéro libéré est aussitôt réattribué au prochain fichier ouvert dans le processus.)
      await vi.waitFor(() => expect(fermeturesFaites).toContainEqual({ fd: evince, erreur: null }))
      // Revenir sur la conversation évincée ne perd rien.
      store.append(event('conv-0', 1))
      expect(store.readConversation('conv-0').map((e) => e.id)).toEqual([
        'conv-0-evt-0',
        'conv-0-evt-1'
      ])
    } finally {
      store.fermer()
    }
  })

  it('append arrivé AVANT la fin de l’ouverture : repli bloquant, puis le double est rendu', async () => {
    const root = dossier('course')
    const store = new TraceStore(root)
    try {
      remettreLesEspions()
      const preparation = store.preparerEcriture('conv-1')
      store.append(event('conv-1', 0)) // l'ouverture anticipée n'a pas encore abouti
      const garde = descripteurs(store).get('conv-1')!
      await preparation
      expect(descripteurs(store).get('conv-1')).toBe(garde)
      const rendus = vi.mocked(fs.close).mock.calls.map(([fd]) => fd)
      expect(rendus).toHaveLength(1)
      expect(rendus[0]).not.toBe(garde)
      store.append(event('conv-1', 1))
      expect(store.readConversation('conv-1')).toHaveLength(2)
    } finally {
      store.fermer()
    }
  })

  it('deleteConversation pendant l’ouverture : aucun journal ressuscité', async () => {
    const root = dossier('suppression')
    const store = new TraceStore(root)
    const preparation = store.preparerEcriture('conv-1')
    expect(store.deleteConversation('conv-1')).toBe(false)
    await preparation
    await vi.waitFor(() => expect(fs.existsSync(join(root, 'conv-1.jsonl'))).toBe(false))
    expect(descripteurs(store).size).toBe(0)
  })

  it('fermer pendant l’ouverture : le descripteur arrivé ensuite est rendu, pas gardé', async () => {
    const root = dossier('fermeture')
    const store = new TraceStore(root)
    remettreLesEspions()
    const preparation = store.preparerEcriture('conv-1')
    store.fermer()
    await preparation
    expect(descripteurs(store).size).toBe(0)
    expect(vi.mocked(fs.close)).toHaveBeenCalledTimes(1)
  })

  it('identifiant invalide : la préparation ne lève pas, append le refuse comme avant', async () => {
    const store = new TraceStore(dossier('invalide'))
    await expect(store.preparerEcriture('../evasion')).resolves.toBeUndefined()
    expect(descripteurs(store).size).toBe(0)
  })
})

describe('câblage : le tour de chat prépare le journal avant son premier événement', () => {
  it('run-pilot-chat.ts lance preparerEcriture avant nextSequence', () => {
    const source = fs.readFileSync(join(process.cwd(), 'src/main/chat/run-pilot-chat.ts'), 'utf8')
    const preparation = source.indexOf('void causalTrace.preparerEcriture(conversationId)')
    const sequence = source.indexOf('causalTrace.nextSequence(conversationId) : 0')
    expect(preparation).toBeGreaterThan(-1)
    expect(sequence).toBeGreaterThan(preparation)
    expect(source.indexOf('causalTrace.append(')).toBeGreaterThan(preparation)
  })
})
