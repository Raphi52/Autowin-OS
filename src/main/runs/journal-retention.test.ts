import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_AGE_MS, planJournalGc } from './journal-gc'
import {
  JOURNAL_RETENTION_MS,
  appendTurnEvent,
  listConversationTurnIds,
  pruneFinishedTurnJournals
} from './turn-journal'

/**
 * DEUX PURGES, UNE SEULE FENETRE.
 *
 * Mesure du 2026-09-02 : les sorties brutes partaient a 3 jours (`journal-gc.ts`) pendant que le
 * journal de tour qui les CITE etait garde 7 jours (`turn-journal.ts`). Entre le 4e et le 7e jour, un
 * tour restait donc lisible avec un renvoi vers un fichier deja supprime — la trace promettait une
 * preuve qui n'existait plus. Une seule constante decide desormais, et c'est la plus LONGUE des deux
 * qui gagne : c'est le journal de tour qui garde le lien.
 */
const JOUR = 24 * 60 * 60 * 1000

describe('purges de journaux — une seule fenetre de conservation', () => {
  it('les deux purges partagent la MEME duree par defaut', () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(JOURNAL_RETENTION_MS)
    expect(JOURNAL_RETENTION_MS).toBe(7 * JOUR)
  })

  it('une sortie brute de 4 jours survit — son tour est encore lisible', () => {
    const nowMs = Date.parse('2026-09-02T12:00:00Z')
    const doomed = planJournalGc(
      [
        { path: 'quatre-jours.stdout.jsonl', size: 100, modifiedMs: nowMs - 4 * JOUR },
        { path: 'huit-jours.stdout.jsonl', size: 100, modifiedMs: nowMs - 8 * JOUR }
      ],
      { nowMs }
    )
    expect(doomed).toEqual(['huit-jours.stdout.jsonl'])
  })
})

describe('purge du journal de tour — meme fenetre, verifiee sur disque', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'retention-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('garde un tour termine de 4 jours et supprime celui de 8 jours', () => {
    const now = Date.parse('2026-09-02T12:00:00Z')
    for (const [turnId, age] of [
      ['tour-jeune', 4 * JOUR],
      ['tour-vieux', 8 * JOUR]
    ] as const) {
      appendTurnEvent(root, 'conv-131', turnId, { kind: 'delta', text: 'x' })
      appendTurnEvent(root, 'conv-131', turnId, { kind: 'done' })
      const chemin = join(root, 'conv-131', `${turnId}.jsonl`)
      const instant = (now - age) / 1000
      utimesSync(chemin, instant, instant)
    }
    expect(pruneFinishedTurnJournals(root, JOURNAL_RETENTION_MS, now)).toBe(1)
    expect(listConversationTurnIds(root, 'conv-131')).toEqual(['tour-jeune'])
  })
})
