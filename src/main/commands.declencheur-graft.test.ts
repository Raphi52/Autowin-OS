import { describe, expect, it } from 'vitest'
import { skillsInvocables } from './commands'

/**
 * `graft` (creer la skill manquante) doit se declencher SEULE, comme `forge` (creer l'outil
 * manquant). Le declencheur remis au modele est le debut de la `description` du front-matter,
 * tronque a 200 caracteres : ce test verifie que le MOMENT tient DANS cette troncature, et que
 * graft ne se confond pas avec forge.
 *
 * Entree qui doit faire ECHOUER ce test si la correction est fausse : une description de graft
 * dont les 200 premiers caracteres ne portent que la philosophie (« graft extends the kit... »)
 * sans le MOMENT — la ligne existerait, le declencheur serait muet.
 */
describe('declencheur automatique — graft', () => {
  const ligne = (id: string): string | undefined =>
    skillsInvocables().find((l) => l === id || l.startsWith(`${id} — `))

  it('graft est presente avec un declencheur, pas un nom nu', () => {
    const graft = ligne('graft')
    expect(graft, 'skill graft absente du snapshot').toBeDefined()
    expect(graft).toContain(' — ')
  })

  it('le MOMENT survit a la troncature a 200 caracteres', () => {
    const graft = ligne('graft')!
    const declencheur = graft.slice(graft.indexOf(' — ') + 3).toLowerCase()
    expect(declencheur).toContain('skill')
    expect(declencheur).toMatch(/trigger the moment|le moment/u)
  })

  it('ne se confond pas avec forge : outil vs procedure', () => {
    const graft = ligne('graft')!.toLowerCase()
    const forge = ligne('forge')!.toLowerCase()
    expect(forge).toContain('tool')
    expect(graft).toContain('procedure')
    expect(graft).not.toBe(forge)
  })
})
