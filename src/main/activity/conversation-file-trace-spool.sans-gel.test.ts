import * as fs from 'node:fs'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fs-supprimer'
import {
  appendConversationFileTrace,
  attendreEcrituresDesTraces,
  flushConversationFileTraces,
  readConversationFileTraces,
  type ConversationFileTrace
} from './conversation-file-trace-spool'

/**
 * GEL MESURÉ (/gel conv-1118, 2026-10-23, `gels.jsonl`) : de 09:44:09 à 09:44:57 UTC, quatre
 * `appendFileSync` de `conversation-file-trace-spool/events.jsonl` (une ligne de quelques Ko) ont
 * tenu la fenêtre 8,2 s, 10,0 s, 9,8 s puis 7,6 s — 37 s figées depuis le démarrage de 08:01, appelé
 * par `trace-workspace-mutation.ts:91` après chaque écriture d'un outil du chat. Le disque était
 * saturé ; la ligne, elle, est minuscule : c'est l'écriture SUR LE FIL DE LA FENÊTRE qui gèle.
 *
 * DISQUE LENT SIMULÉ, à l'identique pour les deux formes : chaque écriture de `events.jsonl` coûte
 * LATENCE_MS. En synchrone, l'attente se paie sur le fil (attente active) ; en asynchrone, hors du fil
 * (minuterie). C'est exactement la différence que le journal des gels a mesurée.
 */
const etat = vi.hoisted(() => ({ disqueLent: false }))
const LATENCE_MS = 300
const SILENCE_MAX_MS = 100

const versJournal = (chemin: unknown): boolean => String(chemin).endsWith('events.jsonl')

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    appendFileSync: vi.fn((...args: Parameters<typeof original.appendFileSync>) => {
      if (etat.disqueLent && versJournal(args[0])) {
        const fin = performance.now() + 300
        while (performance.now() < fin) {
          /* disque lent : le fil attend */
        }
      }
      return original.appendFileSync(...args)
    })
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    appendFile: vi.fn(async (...args: Parameters<typeof original.appendFile>) => {
      if (etat.disqueLent && versJournal(args[0])) {
        await new Promise((fin) => setTimeout(fin, 300))
      }
      return original.appendFile(...args)
    })
  }
})

const racines: string[] = []
afterEach(() => {
  etat.disqueLent = false
  for (const racine of racines.splice(0)) supprimerArbre(racine)
})

function racineJetable(): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-trace-sans-gel-'))
  racines.push(racine)
  return racine
}

function trace(conversationId: string, eventId?: string): ConversationFileTrace {
  return {
    ...(eventId ? { eventId } : {}),
    timestamp: new Date().toISOString(),
    conversationId,
    turnId: 'tour-1',
    workspaceRoot: 'C:/depot',
    source: 'chat_tool',
    paths: ['src/a.ts']
  }
}

/** Battement de la boucle : rend le plus long silence observé et le nombre de tours. */
function battement(): { arreter: () => { silenceMaxMs: number; tours: number } } {
  let actif = true
  let dernier = performance.now()
  let silenceMaxMs = 0
  let tours = 0
  const tic = (): void => {
    if (!actif) return
    const maintenant = performance.now()
    silenceMaxMs = Math.max(silenceMaxMs, maintenant - dernier)
    dernier = maintenant
    tours += 1
    setImmediate(tic)
  }
  setImmediate(tic)
  return {
    arreter: () => {
      actif = false
      return { silenceMaxMs, tours }
    }
  }
}

describe('journal des traces de fichiers — écrire sans tenir la boucle', () => {
  it(`disque lent (${LATENCE_MS} ms par écriture) : la boucle ne se tait jamais plus de ${SILENCE_MAX_MS} ms`, async () => {
    const racine = racineJetable()
    const journal = join(racine, 'conversation-file-trace-spool', 'events.jsonl')
    etat.disqueLent = true
    vi.mocked(fs.appendFileSync).mockClear()

    const mesure = battement()
    expect(appendConversationFileTrace(trace('conv-a'), racine)).toBe('appended')
    // Lue AUSSITÔT, avant que le disque lent ait fini : la trace fait déjà partie du journal.
    expect(readConversationFileTraces('conv-a', racine)).toHaveLength(1)
    await vi.waitFor(() => expect(readFileSync(journal, 'utf8')).toContain('"conv-a"'), {
      timeout: 5_000,
      interval: 20
    })
    // Un tour de boucle de plus : le battement doit pouvoir constater le silence qui précède.
    await new Promise((fin) => setTimeout(fin, 20))
    const { silenceMaxMs, tours } = mesure.arreter()

    expect(tours, `${tours} tours de boucle`).toBeGreaterThan(0)
    expect(silenceMaxMs, `plus long silence : ${Math.round(silenceMaxMs)} ms`).toBeLessThan(
      SILENCE_MAX_MS
    )
    // Posée UNE fois sur le disque, relue une fois.
    expect(readFileSync(journal, 'utf8').match(/"conv-a"/g)).toHaveLength(1)
    expect(readConversationFileTraces('conv-a', racine)).toHaveLength(1)
    // Aucune écriture synchrone du journal.
    expect(
      vi.mocked(fs.appendFileSync).mock.calls.filter(([chemin]) => versJournal(chemin))
    ).toHaveLength(0)
  })

  it('une publication rejouée pendant que la première écriture est encore en route reste un doublon', async () => {
    const racine = racineJetable()
    const journal = join(racine, 'conversation-file-trace-spool', 'events.jsonl')
    etat.disqueLent = true

    expect(appendConversationFileTrace(trace('conv-b', 'publication:1'), racine)).toBe('appended')
    expect(appendConversationFileTrace(trace('conv-b', 'publication:1'), racine)).toBe('duplicate')
    await vi.waitFor(() => expect(readFileSync(journal, 'utf8')).toContain('"conv-b"'), {
      timeout: 5_000,
      interval: 20
    })
    expect(readFileSync(journal, 'utf8').match(/"conv-b"/g)).toHaveLength(1)
  })

  it("l'arrêt de l'app pose sur le disque, tout de suite, une trace encore en route", async () => {
    const racine = racineJetable()
    const journal = join(racine, 'conversation-file-trace-spool', 'events.jsonl')
    etat.disqueLent = true

    expect(appendConversationFileTrace(trace('conv-c'), racine)).toBe('appended')
    flushConversationFileTraces()
    expect(readFileSync(journal, 'utf8')).toContain('"conv-c"')
    await attendreEcrituresDesTraces()
  })
})
