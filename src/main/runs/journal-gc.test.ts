import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  collectStdoutJournals,
  DEFAULT_ASSUME_DEAD_MS,
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

/**
 * LE defaut trouve par l'audit adverse du 2026-07-29, avec sa sequence exacte. La regle « un ecrivain
 * actif est un fichier recemment modifie » etait FAUSSE : mtime d'un journal fraichement cree est
 * l'instant de CREATION, et un raisonnement long n'ecrit rien pendant des minutes.
 */
describe('planJournalGc — un run VIVANT n’est jamais sacrifie', () => {
  it('un journal VIDE inactif 11 min (run detache en cours) n’est PAS condamne', () => {
    const vivant = entry('/j/run-vivant.stdout.jsonl', {
      size: 0,
      modifiedMs: NOW - DEFAULT_MIN_IDLE_MS - 60_000
    })
    expect(planJournalGc([vivant], { nowMs: NOW })).toEqual([])
  })

  it('un journal AVEC sortie inactif 20 min n’est pas sacrifie par le plafond', () => {
    // Variante reproduite par l'audit : meme un run qui A deja ecrit perdait son journal.
    const vivant = entry('/j/ecrit.stdout.jsonl', { modifiedMs: NOW - 20 * 60_000 })
    const jeunes = Array.from({ length: 3 }, (_, i) =>
      entry(`/j/jeune-${i}.stdout.jsonl`, { modifiedMs: NOW - 1000 })
    )
    expect(planJournalGc([vivant, ...jeunes], { nowMs: NOW, maxFiles: 3 })).toEqual([])
  })

  it('au-dela du seuil de mort presumee, le plafond sacrifie d’abord les journaux VIDES', () => {
    const mort = (name: string, over: Partial<JournalEntry>): JournalEntry =>
      entry(name, { modifiedMs: NOW - DEFAULT_ASSUME_DEAD_MS - 1000, ...over })
    const plan = planJournalGc(
      [
        mort('/j/plein-ancien.stdout.jsonl', { size: 900, modifiedMs: NOW - DEFAULT_ASSUME_DEAD_MS - 9000 }),
        mort('/j/vide.stdout.jsonl', { size: 0 }),
        mort('/j/plein.stdout.jsonl', { size: 500 })
      ],
      { nowMs: NOW, maxFiles: 2 }
    )
    // A age comparable, le vide part le premier : il ne porte aucun diagnostic.
    expect(plan).toEqual(['/j/vide.stdout.jsonl'])
  })
})

describe('planJournalGc — politique', () => {
  it('supprime un journal vide UNE FOIS hors fenetre, jamais sur sa seule inactivite', () => {
    // Contrat CORRIGE : la version d'origine condamnait un journal vide des 10 min d'inactivite, ce
    // qui tuait des runs vivants. Il faut desormais qu'il soit AUSSI sorti de la fenetre.
    const videJeune = entry('/j/vide-jeune.stdout.jsonl', { size: 0 })
    expect(planJournalGc([videJeune], { nowMs: NOW })).toEqual([])

    const videVieux = entry('/j/vide-vieux.stdout.jsonl', {
      size: 0,
      modifiedMs: NOW - DEFAULT_MAX_AGE_MS - 1
    })
    expect(planJournalGc([videVieux, entry('/j/plein.stdout.jsonl')], { nowMs: NOW })).toEqual([
      '/j/vide-vieux.stdout.jsonl'
    ])
  })

  it('supprime au-dela de la fenetre de diagnostic, garde en dessous', () => {
    const vieux = entry('/j/vieux.stdout.jsonl', { modifiedMs: NOW - DEFAULT_MAX_AGE_MS - 1 })
    const recent = entry('/j/recent.stdout.jsonl', { modifiedMs: NOW - DEFAULT_MAX_AGE_MS + 1000 })
    expect(planJournalGc([vieux, recent], { nowMs: NOW })).toEqual(['/j/vieux.stdout.jsonl'])
  })

  it('applique le plafond en sacrifiant les PLUS ANCIENS parmi les presumes morts', () => {
    // Ages au-dela du seuil de mort presumee : sans cela, aucun n'est touchable (garde run vivant).
    const base = NOW - DEFAULT_ASSUME_DEAD_MS - 60_000
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(`/j/n${i}.stdout.jsonl`, { modifiedMs: base - (5 - i) * 1000 })
    )
    const plan = planJournalGc(entries, { nowMs: NOW, maxFiles: 2 })
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
