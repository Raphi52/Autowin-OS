import { describe, expect, it } from 'vitest'
import { parseGeneratedLoop } from './loop-draft'

describe('parseGeneratedLoop', () => {
  it('accepte seulement les skills autorisees et normalise le draft', () => {
    const result = parseGeneratedLoop('{"steps":[{"skill":"autowin:frame","capabilities":["autowin:see","fake"],"prompt":"Cadre."}],"passes":2,"stopOnFailure":false,"carryOutput":false}', new Set(['autowin:frame', 'autowin:see']))
    expect(result.steps[0].id).toBe('step-1')
    expect(result.steps[0].capabilities).toEqual(['autowin:see'])
    expect(result.passes).toBe(1)
    expect(result.stopOnFailure).toBe(true)
    expect(result.carryOutput).toBe(true)
  })
  it('rejette une skill inventee', () => {
    expect(() => parseGeneratedLoop('{"steps":[{"skill":"fake","prompt":"x"}]}', new Set())).toThrow('Skill invalide')
  })
  it('rejette une etape qui repete la description de la skill', () => {
    expect(() => parseGeneratedLoop('{"steps":[{"skill":"autowin:frame","prompt":"Cadre le besoin"}]}', new Set(['autowin:frame']))).toThrow('trop generique')
  })
  it('remet les phases generees dans leur ordre semantique', () => {
    const result = parseGeneratedLoop('{"steps":[{"skill":"autowin:build","prompt":"Produire le correctif."},{"skill":"autowin:frame","prompt":"Définir les critères précis."}]}', new Set(['autowin:frame', 'autowin:build']))
    expect(result.steps.map((step) => step.skill)).toEqual(['autowin:frame', 'autowin:build'])
  })
})
