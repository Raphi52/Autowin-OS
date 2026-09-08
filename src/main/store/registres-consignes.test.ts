import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chargerShaConsignes } from './registres-consignes'

/**
 * Entrees qui feraient echouer ces tests si la lecture etait laxiste :
 *  - un dossier absent rendant autre chose qu'un ensemble VIDE : une panne de lecture rendrait
 *    supprimable tout un stock que plus rien ne trace ;
 *  - un SHA tronque accepte : on autoriserait une suppression sur une adresse incomplete.
 */
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

function depot(): string {
  const d = mkdtempSync(join(tmpdir(), 'autowin-reg-'))
  racines.push(d)
  return d
}

describe('chargerShaConsignes', () => {
  it('FAIL-CLOSED : sans dossier `docs/salvage`, RIEN n’est consigne', () => {
    expect(chargerShaConsignes(depot()).size).toBe(0)
  })

  it('lit les SHA de TOUS les registres, et ignore les autres fichiers', () => {
    const d = depot()
    mkdirSync(join(d, 'docs', 'salvage'), { recursive: true })
    const a = 'a'.repeat(40)
    const b = 'b'.repeat(40)
    const c = 'c'.repeat(40)
    writeFileSync(join(d, 'docs/salvage/registre-branches.md'), `| ${a} | autowin/x |\n`)
    writeFileSync(join(d, 'docs/salvage/registre-refs.md'), `| ${b} | refs/autowin/y |\n`)
    writeFileSync(join(d, 'docs/salvage/notes.md'), `| ${c} | pas un registre |\n`)
    const set = chargerShaConsignes(d)
    expect(set.has(a)).toBe(true)
    expect(set.has(b)).toBe(true)
    expect(set.has(c)).toBe(false)
  })

  it('n’accepte QUE des SHA complets — une adresse tronquee n’autorise rien', () => {
    const d = depot()
    mkdirSync(join(d, 'docs', 'salvage'), { recursive: true })
    writeFileSync(join(d, 'docs/salvage/registre-x.md'), 'abc1234 est trop court\n')
    expect(chargerShaConsignes(d).size).toBe(0)
  })
})
