import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  collectStdoutJournals,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MIN_IDLE_MS,
  planJournalGc,
  type JournalEntry
} from './journal-gc'

const NOW = 1_800_000_000_000
const OLD_ENOUGH = NOW - DEFAULT_MIN_IDLE_MS - 1000

const entry = (path: string, over: Partial<JournalEntry> = {}): JournalEntry => ({
  path,
  size: 500,
  modifiedMs: OLD_ENOUGH,
  ...over
})

describe('planJournalGc — la garde qui compte', () => {
  it('ne touche JAMAIS un journal encore en cours d’ecriture (run detache vivant)', () => {
    // Le cas destructeur : un CLI spawne detache ecrit pendant que l'app est fermee. Le supprimer
    // casserait un run vivant. Ici il est vide ET vieux — deux raisons de le jeter — mais actif.
    const live = entry('/j/live.stdout.jsonl', { size: 0, modifiedMs: NOW - 1000 })
    expect(planJournalGc([live], { nowMs: NOW })).toEqual([])
  })

  it('ne sacrifie pas un journal actif meme quand le plafond est depasse', () => {
    const actifs = Array.from({ length: 5 }, (_, i) =>
      entry(`/j/actif-${i}.stdout.jsonl`, { modifiedMs: NOW - 1000 })
    )
    const plan = planJournalGc(actifs, { nowMs: NOW, maxFiles: 2 })
    expect(plan).toEqual([]) // aucun n'est touchable : on preserve, on ne casse pas
  })
})

describe('planJournalGc — politique', () => {
  it('supprime les journaux vides (aucune valeur de diagnostic)', () => {
    const plan = planJournalGc(
      [entry('/j/vide.stdout.jsonl', { size: 0 }), entry('/j/plein.stdout.jsonl')],
      { nowMs: NOW }
    )
    expect(plan).toEqual(['/j/vide.stdout.jsonl'])
  })

  it('supprime au-dela de la fenetre de diagnostic, garde en dessous', () => {
    const vieux = entry('/j/vieux.stdout.jsonl', { modifiedMs: NOW - DEFAULT_MAX_AGE_MS - 1 })
    const recent = entry('/j/recent.stdout.jsonl', { modifiedMs: NOW - DEFAULT_MAX_AGE_MS + 1000 })
    expect(planJournalGc([vieux, recent], { nowMs: NOW })).toEqual(['/j/vieux.stdout.jsonl'])
  })

  it('applique le plafond en sacrifiant les PLUS ANCIENS', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(`/j/n${i}.stdout.jsonl`, { modifiedMs: OLD_ENOUGH - (5 - i) * 1000 })
    )
    const plan = planJournalGc(entries, { nowMs: NOW, maxFiles: 2 })
    // n0 et n1 sont les plus anciens ; n2 est aussi sacrifie pour tenir le plafond de 2.
    expect(plan.sort()).toEqual(['/j/n0.stdout.jsonl', '/j/n1.stdout.jsonl', '/j/n2.stdout.jsonl'])
    expect(plan).not.toContain('/j/n4.stdout.jsonl')
  })

  it('ne rend rien quand tout est jeune, plein et sous le plafond', () => {
    expect(planJournalGc([entry('/j/ok.stdout.jsonl')], { nowMs: NOW })).toEqual([])
  })

  it('ne compte pas deux fois un journal a la fois vide et hors fenetre', () => {
    const plan = planJournalGc(
      [entry('/j/x.stdout.jsonl', { size: 0, modifiedMs: NOW - DEFAULT_MAX_AGE_MS - 1 })],
      { nowMs: NOW }
    )
    expect(plan).toEqual(['/j/x.stdout.jsonl'])
  })
})

describe('collectStdoutJournals — application au disque', () => {
  it('supprime reellement, rend le compte et les octets liberes', () => {
    const root = mkdtempSync(join(tmpdir(), 'journal-gc-'))
    try {
      const vieux = join(root, 'vieux.stdout.jsonl')
      const vide = join(root, 'vide.stdout.jsonl')
      const garde = join(root, 'garde.stdout.jsonl')
      writeFileSync(vieux, 'x'.repeat(100))
      writeFileSync(vide, '')
      writeFileSync(garde, 'y'.repeat(50))
      // Vieillit les deux premiers au-dela de la fenetre ; `garde` reste jeune mais doit etre INACTIF
      // pour que la garde d'ecrivain ne le protege pas artificiellement dans les autres cas.
      const vieuxDate = new Date(Date.now() - DEFAULT_MAX_AGE_MS - 60_000)
      utimesSync(vieux, vieuxDate, vieuxDate)
      utimesSync(vide, vieuxDate, vieuxDate)
      const gardeDate = new Date(Date.now() - DEFAULT_MIN_IDLE_MS - 60_000)
      utimesSync(garde, gardeDate, gardeDate)

      const outcome = collectStdoutJournals(root)

      expect(outcome.removed).toBe(2)
      expect(outcome.freedBytes).toBe(100)
      expect(existsSync(vieux)).toBe(false)
      expect(existsSync(vide)).toBe(false)
      expect(existsSync(garde)).toBe(true) // dans la fenetre → conserve
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignore ce qui n’est pas un journal (et les sous-dossiers)', () => {
    const root = mkdtempSync(join(tmpdir(), 'journal-gc-'))
    try {
      const autre = join(root, 'notes.txt')
      writeFileSync(autre, '')
      mkdirSync(join(root, 'sous-dossier.stdout.jsonl'))
      const vieuxDate = new Date(Date.now() - DEFAULT_MAX_AGE_MS - 60_000)
      utimesSync(autre, vieuxDate, vieuxDate)

      expect(collectStdoutJournals(root).removed).toBe(0)
      expect(existsSync(autre)).toBe(true)
      expect(readdirSync(root)).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('un dossier absent n’est pas une erreur (premier lancement)', () => {
    const outcome = collectStdoutJournals(join(tmpdir(), 'journal-gc-inexistant-xyz'))
    expect(outcome).toEqual({ removed: 0, freedBytes: 0 })
  })
})
