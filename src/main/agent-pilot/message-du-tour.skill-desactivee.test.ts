import { describe, expect, it, vi } from 'vitest'

/**
 * « /nom » D'UNE SKILL DÉSACTIVÉE N'INJECTE PLUS SA PROCÉDURE (2026-11-05).
 *
 * Avant : `messageDuTour` chargeait le corps du SKILL.md tapé en « /nom » sans lire l'interrupteur
 * de Settings › Skills ; seul `skill_charger` refusait une skill désactivée. Ici, le vrai assemblage
 * du message d'ouverture, avec un registre où `steal` est désactivée et `clean` active.
 * (`steal` et non plus `terrain` : la skill `terrain` a été retirée du kit le 2026-11-06.)
 */
vi.mock('../app/native-registry', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../app/native-registry')>()
  return {
    ...reel,
    nativeSkills: () =>
      reel
        .nativeSkills()
        .map((skill) =>
          skill.id === 'steal'
            ? { ...skill, enabled: false }
            : skill.id === 'clean'
              ? { ...skill, enabled: true }
              : skill
        )
  }
})

const { messageDuTour } = await import('./message-du-tour')

const ouverture = (demande: string): string => {
  const tour = messageDuTour({
    history: [{ role: 'user', content: demande }],
    conversationId: undefined,
    workspaceDuTour: '',
    resumeSessionId: undefined,
    snapshot: {},
    retrievedContext: '',
    tourCoupePourCeMessage: undefined,
    lectureRetenue: undefined,
    bus: {} as never,
    growDejaEnvoye: new Set(),
    rappelDejaEnvoye: new Map(),
    dernierEtatPousse: new Map(),
    consommerCompteRendu: () => undefined
  })
  return tour.convo.join('\n')
}

describe('« /nom » et l’interrupteur des skills', () => {
  it('une skill désactivée donne la note, pas sa procédure', () => {
    const texte = ouverture('/steal recense les éditeurs de cockpits d’agents')
    expect(texte).toContain('=== SKILL DÉSACTIVÉE ===')
    expect(texte).toContain('« /steal »')
    expect(texte).not.toContain('=== SKILL STEAL')
  })

  it('une skill active garde sa procédure (témoin)', () => {
    const texte = ouverture('/clean relis le livrable du lot 6')
    expect(texte).not.toContain('=== SKILL DÉSACTIVÉE ===')
    expect(texte).toContain('=== SKILL CLEAN (kit) ===')
  })
})
