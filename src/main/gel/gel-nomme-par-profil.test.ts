import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { demarrerDetecteurDeGel, marquerOperation } from './gel-main'
import type { Gel } from '../../shared/gel-detector'

// La pile d'opérations est un état de MODULE : sans remise à zéro, un test en contamine un autre.
beforeEach(() => marquerOperation(''))

/** Tient la boucle d'événements le temps demandé : un gel de pur calcul, sans aucun appel instrumenté. */
function tenirLaBoucle(ms: number): void {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    /* calcul pur */
  }
}

/** Lance le détecteur avec un lecteur de nom donné, fait un gel, rend les gels reçus. */
async function gelerAvecLeDetecteur(nomDuProfil: () => string | undefined): Promise<Gel[]> {
  const captures: Gel[] = []
  const arreter = demarrerDetecteurDeGel(
    mkdtempSync(join(tmpdir(), 'gel-')),
    20,
    (g) => captures.push(g),
    30,
    undefined,
    undefined,
    nomDuProfil
  )
  tenirLaBoucle(60)
  await new Promise((r) => setTimeout(r, 80))
  arreter()
  return captures.filter((g) => g.temoin === undefined && g.blocageMs > 0)
}

describe('gel « inconnu » — la ligne du journal porte le nom trouvé dans le profil', () => {
  it('écrit « profil: <fonction> » quand rien n’a été déclaré', async () => {
    const gels = await gelerAvecLeDetecteur(() => 'boucleTestNommee')
    expect(gels.length).toBeGreaterThan(0)
    expect(gels[0]?.operation).toBe('profil: boucleTestNommee')
  })

  it('n’écrase JAMAIS une opération déclarée par le profil', async () => {
    marquerOperation('test:declaree')
    const gels = await gelerAvecLeDetecteur(() => 'boucleTestNommee')
    expect(gels.length).toBeGreaterThan(0)
    expect(gels[0]?.operation).toBe('test:declaree')
  })

  it('reste « inconnu » quand le profil ne donne aucun nom', async () => {
    const gels = await gelerAvecLeDetecteur(() => undefined)
    expect(gels.length).toBeGreaterThan(0)
    expect(gels[0]?.operation).toBe('inconnu')
  })
})
