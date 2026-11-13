// La vague du cadre est CALCULEE par scripts/vague-du-cadre.mjs : la feuille doit porter son bloc a
// jour, sinon un reglage change dans le script ne se verrait jamais a l'ecran (ou une retouche a la
// main dans la feuille serait ecrasee au prochain calcul). ENTREE QUI DOIT FAIRE ECHOUER : une etape
// modifiee a la main dans anneau-activite.css, ou un reglage du script sans relancer le calcul.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ANIMATIONS_DE_VAGUE } from '../src/renderer/src/components/anneau-activite-calcul'
import {
  COEUR_DEMI_PX,
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

  // ENTREE QUI DOIT FAIRE ECHOUER : un coeur encore enfle au bord du bloc (ses franges ecartees y
  // entreraient ou en sortiraient en sautant), ou un second reflet qui part sans le premier.
  it('chaque passage part hors du bloc et en sort, sans a-coup aux bords', () => {
    for (const reglage of PASSAGES) {
      const etats = etatsDuPassage(reglage)
      expect(etats[0].principal.p).toBeLessThan(0)
      expect(etats.at(-1).principal.p).toBeGreaterThan(1)
      for (const bord of [etats[0], etats.at(-1)]) {
        expect(bord.principal.largeur).toBeCloseTo(1, 6)
        expect(bord.principal.ecart).toBeCloseTo(0, 6)
      }
      // Le second reflet part et arrive avec le premier : hors du bloc lui aussi.
      expect(etats[0].second.p).toBeCloseTo(etats[0].principal.p, 6)
      expect(etats.at(-1).second.p).toBeCloseTo(etats.at(-1).principal.p, 6)
    }
  })

  // Mesure de la video : quand le blanc enfle, ses franges gardent leur largeur. ENTREE QUI DOIT
  // FAIRE ECHOUER : un ecart des franges qui ne suit pas le bord du coeur (une fente blanche ou un
  // recouvrement de couleur sur le blanc).
  it('ecarte chaque frange de ce que gagne le bord du coeur', () => {
    for (const reglage of PASSAGES)
      for (const { principal } of etatsDuPassage(reglage))
        expect(principal.ecart).toBeCloseTo(COEUR_DEMI_PX * (principal.largeur - 1), 9)
  })

  it('pose une animation par piece, celles que le composant cale sur l horloge commune', () => {
    const noms = [...blocCalcule().matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1])
    expect(noms).toEqual([...ANIMATIONS_DE_VAGUE])
  })
})
