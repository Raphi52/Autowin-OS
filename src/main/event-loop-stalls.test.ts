import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { surveillerBoucleEvenements, withSection, sectionEnCours } from './event-loop-stalls'

const attendre = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('detecteur de gel du processus principal', () => {
  it('nomme la section en cours pendant un travail synchrone', () => {
    expect(sectionEnCours()).toBeUndefined()
    const vu = withSection('snapshot-conversations', () => sectionEnCours())
    expect(vu).toBe('snapshot-conversations')
    expect(sectionEnCours()).toBeUndefined()
  })

  it('journalise un blocage synchrone reel de la boucle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stalls-'))
    const arreter = surveillerBoucleEvenements(dir, 120, 200)
    const fin = Date.now() + 350
    while (Date.now() < fin) {
      /* blocage synchrone volontaire */
    }
    await attendre(500)
    arreter()
    const fichier = join(dir, 'event-loop-stalls.jsonl')
    expect(existsSync(fichier)).toBe(true)
    const lignes = readFileSync(fichier, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lignes[0].type).toBe('event-loop-stall')
    expect(lignes[0].blocageMs).toBeGreaterThanOrEqual(120)
  })
})
