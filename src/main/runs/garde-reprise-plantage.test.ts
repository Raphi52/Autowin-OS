import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { creerGardeRepriseCrash, DELAI_DE_SURVIE_MS } from './garde-reprise-plantage'

// conv-1150 : la reprise de run-ec2036c0932d-1 faisait planter l'app à chaque démarrage (OOM).
describe('garde de reprise au démarrage', () => {
  const chemin = (): string => join(mkdtempSync(join(tmpdir(), 'garde-reprise-')), 'm.json')

  it("un marqueur resté posé (l'app est morte) condamne la reprise au démarrage suivant", () => {
    const fichier = chemin()
    creerGardeRepriseCrash(fichier, () => undefined).poser('run-a')
    // Nouveau processus : il relit le disque.
    const apresPlantage = creerGardeRepriseCrash(fichier, () => undefined)
    expect(apresPlantage.aPlanteAuparavant('run-a')).toBe(true)
    expect(apresPlantage.aPlanteAuparavant('run-b')).toBe(false)
    apresPlantage.retirer('run-a')
    expect(creerGardeRepriseCrash(fichier).aPlanteAuparavant('run-a')).toBe(false)
  })

  it('une reprise qui survit retire son marqueur seule', () => {
    const fichier = chemin()
    const rappels: { rappel: () => void; delai: number }[] = []
    creerGardeRepriseCrash(fichier, (rappel, delai) => rappels.push({ rappel, delai })).poser(
      'run-a'
    )
    expect(rappels[0].delai).toBe(DELAI_DE_SURVIE_MS)
    rappels[0].rappel()
    expect(creerGardeRepriseCrash(fichier).aPlanteAuparavant('run-a')).toBe(false)
  })
})
