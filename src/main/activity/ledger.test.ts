import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TraceLedger } from './ledger'

/** Saut de ligne sans sequence d'echappement : cinq fois dans cette session un `\n` injecte a ete
 * transforme en vrai retour a la ligne, cassant la source. */
const SAUT = String.fromCharCode(10)

const dir = mkdtempSync(join(tmpdir(), 'aos-ledger-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('TraceLedger — traçage append-only des agents in-app', () => {
  it('append puis relit (du plus récent au plus ancien)', () => {
    const l = new TraceLedger(dir)
    l.append({ source: 'bus', name: 'navigate', detail: '{"tab":"memory"}', ok: true })
    l.append({ source: 'bus', name: 'create_conversation', ok: true })
    l.append({ source: 'orchestrate', name: 'judge', detail: 'judge codex' })
    const r = l.recent(10)
    expect(r).toHaveLength(3)
    expect(r[0].name).toBe('judge') // le plus récent d'abord
    expect(r[2]).toMatchObject({ source: 'bus', name: 'navigate', ok: true })
  })

  it('cap n respecté', () => {
    const l = new TraceLedger(dir)
    expect(l.recent(2)).toHaveLength(2)
  })

  it('dossier vide/absent → liste vide, append ne jette jamais', () => {
    const l = new TraceLedger(join(dir, 'sub-nexiste-pas'))
    expect(l.recent()).toEqual([])
    expect(() => l.append({ source: 'pilot', name: 'x' })).not.toThrow()
    expect(l.recent()).toHaveLength(1) // le dossier a été créé au premier append
  })
})

/**
 * DEUX CANDIDATS DU SCOUT DE L'APP (2026-08-19, scores 86 et 65), confirmés par son juge
 * (« ledger entier dans ledger.ts:59 », « erreurs de ledger silencieuses dans ledger.ts:27-39 »)
 * puis vérifiés dans le code.
 *
 * 86 — `recent(n)` lisait le fichier ENTIER pour n'en garder que les n dernières lignes. Sur une
 *      journée chargée, le diagnostic devenait la chose la plus coûteuse de la session. La lecture
 *      part désormais de la FIN, avec un budget d'octets.
 *
 * 65 — tout échec était avalé : dossier absent, disque plein, permission refusée, ligne corrompue.
 *      Le système de traces pouvait être totalement mort sans que rien ne le dise — et un ledger
 *      muet se lit comme un ledger vide, c'est-à-dire comme « rien ne s'est passé ». Les échecs sont
 *      maintenant COMPTÉS et lisibles, sans jamais casser l'action tracée.
 */
describe('TraceLedger — bornes et santé, candidats du scout interne', () => {
  it('86 — relit la QUEUE, pas le fichier entier', () => {
    const local = mkdtempSync(join(tmpdir(), 'aos-ledger-queue-'))
    try {
      const l = new TraceLedger(local)
      // Fichier ecrit d'un bloc : 4000 `append` successifs prennent ~50 s (une ecriture sync par
      // appel) et ce test mesure la RELECTURE, pas le debit d'ecriture.
      const jour = new Date().toISOString().slice(0, 10)
      const lignes = Array.from({ length: 4000 }, (_, i) =>
        JSON.stringify({
          ts: new Date(1_787_000_000_000 + i).toISOString(),
          source: 'bus',
          name: `evt-${i}`,
          ok: true
        })
      )
      mkdirSync(local, { recursive: true })
      writeFileSync(join(local, `trace-${jour}.jsonl`), lignes.join(SAUT) + SAUT, 'utf8')
      const r = l.recent(5)
      expect(r.map((e) => e.name)).toEqual([
        'evt-3999',
        'evt-3998',
        'evt-3997',
        'evt-3996',
        'evt-3995'
      ])
      const sante = l.sante()
      expect(sante.octetsLus).toBeGreaterThan(0)
      // Le fichier pèse plus de 200 Ko ; une relecture de 5 événements ne doit pas tout charger.
      expect(sante.octetsLus).toBeLessThan(60_000)
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })

  it('86 — une ligne coupée par le début de la fenêtre n’est pas rendue à moitié', () => {
    const local = mkdtempSync(join(tmpdir(), 'aos-ledger-coupe-'))
    try {
      const l = new TraceLedger(local)
      const jour = new Date().toISOString().slice(0, 10)
      const lignes = Array.from({ length: 500 }, (_, i) =>
        JSON.stringify({
          ts: new Date(1_787_000_000_000 + i).toISOString(),
          source: 'bus',
          name: `e${i}`,
          detail: 'x'.repeat(120),
          ok: true
        })
      )
      mkdirSync(local, { recursive: true })
      writeFileSync(join(local, `trace-${jour}.jsonl`), lignes.join(SAUT) + SAUT, 'utf8')
      const r = l.recent(3)
      expect(r).toHaveLength(3)
      expect(r.every((e) => typeof e.name === 'string' && e.name.startsWith('e'))).toBe(true)
      expect(l.sante().lignesCorrompues).toBe(0)
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })

  it('65 — un échec d’écriture est compté et nommé, sans jeter', () => {
    const parent = mkdtempSync(join(tmpdir(), 'aos-ledger-ko-'))
    try {
      // Le « dossier » du ledger est en réalité un FICHIER : `mkdirSync` échouera.
      const occupe = join(parent, 'occupe')
      writeFileSync(occupe, 'pas un dossier', 'utf8')
      const l = new TraceLedger(join(occupe, 'trace'))
      expect(() => l.append({ source: 'bus', name: 'navigate', ok: true })).not.toThrow()
      const sante = l.sante()
      expect(sante.ecrituresEchouees).toBe(1)
      expect(sante.derniereErreur).toBeTruthy()
      expect(sante.enBonneSante).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('65 — une ligne corrompue est comptée, les autres restent lues', () => {
    const local = mkdtempSync(join(tmpdir(), 'aos-ledger-corrompu-'))
    try {
      const l = new TraceLedger(local)
      l.append({ source: 'bus', name: 'avant', ok: true })
      const jour = new Date().toISOString().slice(0, 10)
      appendFileSync(join(local, `trace-${jour}.jsonl`), '{ceci n est pas du json}\n', 'utf8')
      l.append({ source: 'bus', name: 'apres', ok: true })
      expect(l.recent(10).map((e) => e.name)).toEqual(['apres', 'avant'])
      expect(l.sante().lignesCorrompues).toBe(1)
      expect(l.sante().enBonneSante).toBe(false)
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — en marche normale, la santé est vierge', () => {
    const local = mkdtempSync(join(tmpdir(), 'aos-ledger-ok-'))
    try {
      const l = new TraceLedger(local)
      l.append({ source: 'pilot', name: 'x', ok: true })
      expect(l.recent(10)).toHaveLength(1)
      expect(l.sante()).toMatchObject({
        ecrituresEchouees: 0,
        lecturesEchouees: 0,
        lignesCorrompues: 0,
        enBonneSante: true
      })
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })
})
