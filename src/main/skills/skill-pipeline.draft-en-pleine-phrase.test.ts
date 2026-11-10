import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { draftDemandeEnPleinePhrase, skillInstruction } from './skill-pipeline'

// Les skills du dépôt, pas celles de la machine : le test lit le vrai SKILL.md de /draft.
const SKILLS_DU_DEPOT = fileURLToPath(new URL('../../../skills', import.meta.url))

describe('draft demandé en pleine phrase', () => {
  it('une demande de draft charge la procédure, même sans barre et hors de la tête du message', () => {
    expect(draftDemandeEnPleinePhrase("nan j'aime pas draft moi plusieurs pandas")).toBe('draft')
    expect(draftDemandeEnPleinePhrase("j'ai demandé un draft et t'as pas fait un draft")).toBe(
      'draft'
    )
    expect(draftDemandeEnPleinePhrase('Draft-moi trois variantes du bouton')).toBe('draft')
    expect(draftDemandeEnPleinePhrase('fais une draft de la page')).toBe('draft')
  })

  it('un mot qui ne demande pas la skill ne charge rien', () => {
    expect(draftDemandeEnPleinePhrase('drafty moi un truc')).toBeUndefined()
    expect(draftDemandeEnPleinePhrase("c'est un draftage")).toBeUndefined()
    expect(draftDemandeEnPleinePhrase('le draft est bon')).toBeUndefined()
    expect(draftDemandeEnPleinePhrase('cite `draft moi` dans le code')).toBeUndefined()
    expect(draftDemandeEnPleinePhrase('')).toBeUndefined()
  })

  it('le corps chargé est la procédure /draft du dépôt', () => {
    const corps = skillInstruction('draft', [SKILLS_DU_DEPOT])
    expect(corps).toContain('SKILL DRAFT (kit)')
    expect(corps).toContain('draft-carrousel.mjs')
  })
})
