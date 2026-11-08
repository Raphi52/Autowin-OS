/**
 * L'ÉCHELLE AVANT D'ÉCRIRE DU CODE (Ponytail, MIT) doit être DANS le texte injecté à l'agent de
 * construction : mesurée par JetBrains, la même échelle posée en skill ne s'est jamais activée seule.
 * Chiffres et sources : le commentaire au-dessus de `build` dans `phase-briefs.ts`.
 *
 * L'ordre compte — « le premier oui gagne » — donc les échelons vont du moins de code au plus.
 */
import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS, phaseBrief } from './phase-briefs'

const ECHELLE: Array<[string, RegExp]> = [
  ['faut-il l’écrire', /faut-il l'écrire \?/],
  ['déjà dans le dépôt', /dans le dépôt \?/],
  [
    'bibliothèque standard, plateforme ou dépendance installée',
    /bibliothèque standard, la plateforme ou une dépendance installée/
  ],
  ['une ligne suffit', /une ligne suffit \?/],
  ['sinon le minimum', /Sinon, fix minimal/]
]

describe('brief build : échelle avant d’écrire du code', () => {
  it('pose les cinq échelons, du moins de code au plus', () => {
    const build = PHASE_BRIEFS.build
    let precedent = -1
    for (const [nom, motif] of ECHELLE) {
      const position = build.search(motif)
      expect(position, nom).toBeGreaterThan(precedent)
      precedent = position
    }
  })

  it('ne rogne jamais ce qui protège : validation, erreurs, sécurité', () => {
    expect(PHASE_BRIEFS.build).toMatch(/sans rogner validation, erreurs ni sécurité/)
  })

  it('sur un gros fichier, fait lire la fonction et pas le fichier entier', () => {
    expect(PHASE_BRIEFS.build).toMatch(
      /Gros fichier : lis la fonction \(grep -n\), pas le fichier entier/
    )
  })

  it('arrive dans la consigne réellement envoyée à l’agent de construction', () => {
    const envoyee = phaseBrief('build')
    for (const [nom, motif] of ECHELLE) expect(envoyee, nom).toMatch(motif)
  })

  it('reste propre à la construction : les étapes en lecture seule ne la reçoivent pas', () => {
    for (const phase of ['scout', 'frame', 'terrain', 'judge'] as const)
      expect(PHASE_BRIEFS[phase], phase).not.toMatch(/faut-il l'écrire \?/)
  })
})
