import { describe, expect, it } from 'vitest'
import { buildTurnMessageBlocks } from './chat-turn-messages'

/**
 * CAUSE RACINE (conv-614, 2026-09-16) : `diffEtat` / `blocEtatSuivant` existaient et etaient
 * testes depuis le 2026-08-31, mais n'etaient appeles NULLE PART — une optimisation ecrite,
 * prouvee, jamais branchee. La trace le montrait : l'etat complet (3 043 caracteres) repartait a
 * CHAQUE appel, iterations comprises.
 *
 * Ce que ca coute : ce bloc part cote MESSAGE, donc il change a chaque tour, donc il n'est jamais
 * mis en cache et se repaie PLEIN TARIF. Sur les 3 043 caracteres, 2 821 (93 %) sont la liste des
 * skills, identique d'un tour a l'autre.
 *
 * Les tests de `etat-diff.test.ts` couvrent le CALCUL du diff ; celui-ci couvre son CABLAGE — la
 * chose precise qui manquait.
 */
const base = {
  brainContext: '',
  memoryEcho: '',
  history: [],
  lastUserMessage: 'ok'
}

const etat = (n: number): Record<string, unknown> => ({
  tab: 'chat',
  conversationsCount: n,
  // Taille FIDELE au reel, sinon le gain mesure ne veut rien dire : 21 skills, declencheur borne
  // a ~120 caracteres chacun — 2 821 caracteres releves dans la trace du 2026-09-16.
  skillsDisponibles: Array.from(
    { length: 21 },
    (_, i) => `skill-${i} — ${'declencheur borne a environ cent vingt caracteres, '.repeat(3)}`
  )
})

const etatDuTour = (parts: Parameters<typeof buildTurnMessageBlocks>[0]): string =>
  buildTurnMessageBlocks(parts).find((b) => b.name === 'etatDeLApp')?.text ?? ''

describe('etat de l app pousse en differentiel', () => {
  it('envoie l etat ENTIER quand aucune session n est reprise', () => {
    const texte = etatDuTour({ ...base, snapshot: etat(557) })
    expect(texte).toContain("ÉTAT DE L'APP:")
    expect(texte).toContain('skillsDisponibles')
  })

  it('envoie l etat ENTIER au premier tour d une session reprise', () => {
    const texte = etatDuTour({ ...base, snapshot: etat(557), resumeSessionId: 'sess-1' })
    expect(texte).toContain("ÉTAT DE L'APP:")
    expect(texte).toContain('skillsDisponibles')
  })

  it('n envoie QUE ce qui a change quand la session porte deja un etat', () => {
    const texte = etatDuTour({
      ...base,
      snapshot: etat(558),
      snapshotPrecedent: etat(557),
      resumeSessionId: 'sess-1'
    })
    expect(texte).toContain('CHANGÉ DEPUIS LE DERNIER ÉTAT')
    expect(texte).toContain('558')
    // Le poste le plus lourd, et le plus constant, ne doit plus etre repaye.
    expect(texte).not.toContain('skillsDisponibles')
  })

  it('le dit en une ligne quand rien n a bouge', () => {
    const texte = etatDuTour({
      ...base,
      snapshot: etat(557),
      snapshotPrecedent: etat(557),
      resumeSessionId: 'sess-1'
    })
    expect(texte).toBe('ÉTAT DE L’APP : inchangé')
  })

  /** Le gain doit rester massif, sinon le cablage ne vaut pas sa complexite. */
  it('reduit d au moins 80 % le poids de l etat repete', () => {
    const entier = etatDuTour({ ...base, snapshot: etat(557), resumeSessionId: 'sess-1' })
    const differentiel = etatDuTour({
      ...base,
      snapshot: etat(558),
      snapshotPrecedent: etat(557),
      resumeSessionId: 'sess-1'
    })
    expect(differentiel.length).toBeLessThan(entier.length * 0.2)
  })
})
