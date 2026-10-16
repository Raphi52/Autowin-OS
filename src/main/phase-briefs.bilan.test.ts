import { describe, expect, it } from 'vitest'
import { CONSIGNE_BILAN, PHASE_BRIEFS, phaseBrief } from './phase-briefs'
import { extraireBilan } from '../shared/bilan-d-etape'

/**
 * LES ETAPES DE TRAVAIL TERMINENT PAR LE BLOC FIXE (conv-989, 2026-10-16).
 *
 * Le code qui coupe une sortie (bulle affichee, agregat du juge) remonte ce bloc en entier — mais
 * seulement s'il EXISTE, et seulement s'il a la forme qu'il reconnait. Ce test lie les deux bouts :
 * la consigne demande exactement ce que `extraireBilan` sait lire.
 */
const AVEC_BILAN = ['scout', 'frame', 'terrain', 'build', 'clean'] as const
const SANS_BILAN = ['judge', 'kaizen', 'remake'] as const

describe('consigne du bilan de fin d’étape', () => {
  it('les cinq étapes de travail la reçoivent', () => {
    for (const phase of AVEC_BILAN) expect(phaseBrief(phase), phase).toContain(CONSIGNE_BILAN)
  })

  it('le juge garde son format strict, kaizen et remake leur livrable propre', () => {
    for (const phase of SANS_BILAN) expect(phaseBrief(phase), phase).not.toContain(CONSIGNE_BILAN)
  })

  it('le modèle demandé est exactement ce que le code sait extraire', () => {
    const trouve = extraireBilan(`corps de l’étape\n${CONSIGNE_BILAN}\nSUITE: fin`)
    expect(trouve?.bilan).toMatch(/^### Bilan de l’étape/u)
    for (const champ of ['Verdict', 'Fichiers touchés', 'Preuves', 'Reste à faire'])
      expect(trouve?.bilan, champ).toContain(`- ${champ} :`)
    expect(trouve?.apres).toBe('SUITE: fin')
  })

  it('il passe AVANT les lignes techniques qui doivent rester les dernières', () => {
    expect(CONSIGNE_BILAN).toMatch(/AVANT/u)
    expect(CONSIGNE_BILAN).toContain('SUITE:')
    expect(CONSIGNE_BILAN).toContain('AUTOWIN_')
  })

  it('les consignes propres de chaque étape ne changent pas (le bloc est posé par phaseBrief)', () => {
    for (const phase of AVEC_BILAN) expect(PHASE_BRIEFS[phase], phase).not.toContain(CONSIGNE_BILAN)
  })
})
