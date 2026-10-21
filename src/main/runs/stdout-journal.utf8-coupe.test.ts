/**
 * UN CARACTÈRE COUPÉ ENTRE DEUX LECTURES DU JOURNAL NE DEVIENT PAS « � » (audit conv-1040, 2026-10-21).
 *
 * Le journal est relu par morceaux pendant que le CLI l'écrit. Chaque morceau était décodé SEUL :
 * un « é » (2 octets) dont le premier octet tombait à la fin d'une lecture donnait « r��ponse ».
 * Pire pour la reprise : `tailJournalOnce` recalcule la position à partir du texte décodé, et un
 * « � » ne pèse pas le même nombre d'octets que le morceau de caractère qu'il remplace — la position
 * repart alors au MILIEU de la ligne précédente.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readChunkFrom, readChunkFromAsync, tailJournalOnce, tailJsonLines } from './stdout-journal'

const E_ACCENT = Buffer.from('é', 'utf8') // c3 a9
let racine: string
let chemin: string

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'journal-utf8-'))
  chemin = join(racine, 'appel.stdout.jsonl')
})
afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
})

/** Écrit le début de la ligne, jusqu'au PREMIER octet du « é » seulement (écriture en cours). */
function ecrireDebutCoupe(prefixe = ''): void {
  writeFileSync(chemin, Buffer.concat([Buffer.from(`${prefixe}{"t":"r`), E_ACCENT.subarray(0, 1)]))
}
function ecrireFin(): void {
  appendFileSync(chemin, Buffer.concat([E_ACCENT.subarray(1), Buffer.from('ponse"}\n')]))
}

describe('lecture par morceaux : jamais de caractère coupé', () => {
  it('readChunkFrom s’arrête AVANT le caractère incomplet, la lecture suivante le rend entier', () => {
    ecrireDebutCoupe()
    const premier = readChunkFrom(chemin, 0)
    ecrireFin()
    const second = readChunkFrom(chemin, premier.next)
    expect(premier.text + second.text).toBe('{"t":"réponse"}\n')
    expect(premier.text).not.toContain('�')
  })

  it('readChunkFromAsync : même garantie', async () => {
    ecrireDebutCoupe()
    const premier = await readChunkFromAsync(chemin, 0)
    ecrireFin()
    const second = await readChunkFromAsync(chemin, premier.next)
    expect(premier.text + second.text).toBe('{"t":"réponse"}\n')
  })

  it('tailJsonLines livre la ligne intacte quand l’écriture coupe un caractère', async () => {
    ecrireDebutCoupe()
    let fini = false
    const lignes: string[] = []
    const suivi = tailJsonLines(chemin, (ligne) => lignes.push(ligne), {
      pollMs: 20,
      isComplete: () => fini
    })
    await new Promise((r) => setTimeout(r, 60)) // au moins une lecture tombe sur l'octet seul
    ecrireFin()
    fini = true
    await suivi
    expect(lignes).toEqual(['{"t":"réponse"}'])
  })

  it('tailJournalOnce laisse la position au DÉBUT de la ligne partielle, au bon octet', () => {
    ecrireDebutCoupe('{"a":1}\n')
    const lignes: string[] = []
    const { offset } = tailJournalOnce(chemin, 0, (ligne) => lignes.push(ligne))
    expect(lignes).toEqual(['{"a":1}'])
    expect(offset).toBe(Buffer.byteLength('{"a":1}\n'))
    ecrireFin()
    const suite: string[] = []
    tailJournalOnce(chemin, offset, (ligne) => suite.push(ligne))
    expect(suite).toEqual(['{"t":"réponse"}'])
  })

  it('un octet invalide AU MILIEU reste décodé tel quel : seule la fin incomplète attend', () => {
    writeFileSync(
      chemin,
      Buffer.concat([Buffer.from('a'), Buffer.from([0xff]), Buffer.from('b\n')])
    )
    const { text, next } = readChunkFrom(chemin, 0)
    expect(text).toBe('a�b\n')
    expect(next).toBe(4)
  })
})
