import { describe, expect, it } from 'vitest'
import { sortieThinkAvecForme, titresBriefingManquants } from './think-briefing'

/**
 * La garde de forme du briefing `think` (`think-briefing.ts`). Mesure du 2026-10-01 : 5 sorties
 * `think` sur 34 dans `run-state/` n'avaient pas les six titres de `skills/think/SKILL.md` §5.
 */
const COMPLET = [
  '## Localisation',
  '- src/main/orchestrator.ts:3643',
  '## Cartographie',
  'recordPhase lit SUITE.',
  '## Décisions',
  '- 2026-09-27 : pas de budget.',
  '## Constats',
  '- conv-1340 coupé.',
  '## Contraintes',
  '- filtre dans recordPhase.',
  '## Trous',
  '- Brain indisponible.'
].join('\n')

describe('garde de forme du briefing `think`', () => {
  it('laisse un briefing complet strictement inchangé', () => {
    expect(sortieThinkAvecForme(COMPLET)).toBe(COMPLET)
  })

  it('met un avertissement en TÊTE quand `## Trous` manque, et garde le texte entier', () => {
    const sansTrous = COMPLET.replace('## Trous\n- Brain indisponible.', '')
    const sortie = sortieThinkAvecForme(sansTrous)
    expect(sortie.startsWith('⚠️ Briefing `think` incomplet')).toBe(true)
    expect(sortie).toContain('`trous`')
    expect(sortie).not.toContain('`localisation`')
    expect(sortie.endsWith(sansTrous)).toBe(true)
  })

  it('reconnaît un SOP rendu à la place d’un briefing (cas mesuré)', () => {
    const sop = '## SOP\n1. lancer les tests\n\n## Besoin\nréparer'
    expect(titresBriefingManquants(sop)).toEqual([
      'localisation',
      'cartographie',
      'decisions',
      'constats',
      'contraintes',
      'trous'
    ])
  })

  it('accepte accents, casse, niveau de titre et précision après le titre', () => {
    const variante = COMPLET.replace('## Décisions', '### DECISIONS (options écartées)')
    expect(titresBriefingManquants(variante)).toEqual([])
  })

  it('ne compte pas un titre cité en prose', () => {
    const prose = COMPLET.replace('## Trous', 'Les trous :')
    expect(titresBriefingManquants(prose)).toEqual(['trous'])
  })

  it('est idempotente : appliquée deux fois, un seul avertissement', () => {
    const une = sortieThinkAvecForme('texte libre')
    expect(sortieThinkAvecForme(une)).toBe(une)
  })

  it('ne pose aucune ligne SUITE : elle ne relance rien', () => {
    expect(sortieThinkAvecForme('texte libre')).not.toMatch(/^\s*SUITE\s*:/imu)
  })
})
