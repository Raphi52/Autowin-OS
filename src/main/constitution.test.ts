import { describe, expect, it } from 'vitest'
import { CONSTITUTION } from './constitution'

describe('CONSTITUTION (source unique du soul)', () => {
  it('reste portable entre providers et machines', () => {
    expect(CONSTITUTION).not.toMatch(/[A-Z]:\\Users\\|\/Users\/|~\/[.]claude|[.]brain/i)
    expect(CONSTITUTION).not.toMatch(/Hermes Agent|Claude Code/i)
    expect(CONSTITUTION).toContain('provider-neutral')
    expect(CONSTITUTION).toContain('capacités réellement disponibles')
  })

  it('looks beyond the immediate request instead of stopping at minimum compliance', () => {
    expect(CONSTITUTION).toContain("inférer la destination probable de l'utilisateur")
    expect(CONSTITUTION).toContain('regarder un à deux coups plus loin')
    expect(CONSTITUTION).toContain("Le minimum conforme n'est pas une condition d'arrêt")
    expect(CONSTITUTION).toContain("n'autorise ni extension silencieuse du périmètre ni mutation non demandée")
    expect(CONSTITUTION).toContain("signal explicite de l'utilisateur ou d'un artefact observé")
    expect(CONSTITUTION).toContain('une seule extension concrète à forte valeur, en une phrase')
    expect(CONSTITUTION).toContain('sans lancer de nouvel outil ni de recherche supplémentaire')
    expect(CONSTITUTION).toContain('Une demande explicitement bornée')
    expect(CONSTITUTION).toContain("Un artefact peut confirmer un état, jamais définir à lui seul l'intention utilisateur")
    expect(CONSTITUTION).toContain('sécurité, accès, données personnelles ou secrets')
  })

  it('porte les 13 réflexes et la limite honnête', () => {
    expect(CONSTITUTION).toContain('Les 13 réflexes')
    expect(CONSTITUTION).toContain('La limite honnête')
  })

  it('se termine par un saut de ligne (contrat : concat sûre en tête de pilotage run())', () => {
    expect(CONSTITUTION.endsWith('\n')).toBe(true)
  })
})
