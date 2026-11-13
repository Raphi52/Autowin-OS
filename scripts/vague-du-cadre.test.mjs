// La vague du cadre est CALCULEE par scripts/vague-du-cadre.mjs : la feuille doit porter son bloc a
// jour, sinon un reglage change dans le script ne se verrait jamais a l'ecran (ou une retouche a la
// main dans la feuille serait ecrasee au prochain calcul). ENTREE QUI DOIT FAIRE ECHOUER : une etape
// modifiee a la main dans anneau-activite.css, ou un reglage du script sans relancer le calcul.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEBUT,
  FEUILLE,
  FIN,
  PASSAGES,
  blocCalcule,
  etatsDuPassage,
  feuilleAJour
} from './vague-du-cadre.mjs'

describe('vague du cadre — etapes calculees', () => {
  it('la feuille porte le bloc a jour', async () => {
    const texte = readFileSync(FEUILLE, 'utf8')
    expect(texte).toContain(DEBUT)
    expect(texte).toContain(FIN)
    expect(await feuilleAJour(texte)).toBe(texte)
  })

  it('chaque passage part hors du bloc et en sort, sans a-coup aux bords', () => {
    for (const reglage of PASSAGES) {
      const etats = etatsDuPassage(reglage)
      expect(etats[0].principal.p).toBeLessThan(0)
      expect(etats.at(-1).principal.p).toBeGreaterThan(1)
      // Le second reflet part et arrive avec le premier : hors du bloc lui aussi.
      expect(etats[0].second.p).toBeCloseTo(etats[0].principal.p, 6)
      expect(etats.at(-1).second.p).toBeCloseTo(etats.at(-1).principal.p, 6)
    }
  })

  it('ne pose que deux animations, une par reflet', () => {
    const noms = [...blocCalcule().matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1])
    expect(noms).toEqual(['cadre-vague', 'cadre-vague-second'])
  })
})
