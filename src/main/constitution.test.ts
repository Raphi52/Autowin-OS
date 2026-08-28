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

  it("porte le mandat d'autonomie : une seule passe jusqu'au vert, sans relâcher la preuve", () => {
    expect(CONSTITUTION).toContain("Autonomie — une seule passe jusqu'au vert")
    expect(CONSTITUTION).toContain('un résultat VÉRIFIÉ ou un blocage NOMMÉ')
    expect(CONSTITUTION).toContain("plan sans exécution — est un ÉCHEC")
    expect(CONSTITUTION).toContain("se FABRIQUE ou se contourne toi-même si c'est sûr, borné et réversible")
    expect(CONSTITUTION).toContain('TOUTES traitées dans la passe')
    expect(CONSTITUTION).toContain('FAUX vert')
  })

  it('porte les 13 réflexes et la limite honnête', () => {
    expect(CONSTITUTION).toContain('Les 13 réflexes')
    expect(CONSTITUTION).toContain('La limite honnête')
  })

  it('rend Kaizen explicite et AUTONOME, garde-fou par réversibilité et non par accord humain', () => {
    expect(CONSTITUTION).toContain('éditions précises APPLIQUÉES directement')
    expect(CONSTITUTION).toContain('commit dédié')
    expect(CONSTITUTION).not.toContain('attente d’un accord humain')
  })

  it('se termine par un saut de ligne pour une concaténation sûre dans les prompts système', () => {
    expect(CONSTITUTION.endsWith('\n')).toBe(true)
  })
})
