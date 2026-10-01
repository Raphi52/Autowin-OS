import { describe, expect, it } from 'vitest'
import { agregerPhasesPourLeJuge, MARQUE_TRONQUE } from './agregat-juge'
import { OUTCOME_LESSON_MARKER, parseAttestedLearningProposal } from './outcome-learning-proposal'

/**
 * UNE LEÇON CORRIGÉE PAR UNE RÉPARATION REMPLACE LA PRÉCÉDENTE.
 *
 * Mesuré sur run-85d8e7f57af2-1 (conv-892, 2026-10-01), `run-state/run-85d8e7f57af2-1.json` :
 * cinq réponses de build portaient une ligne `AUTOWIN_LESSON_V1`, aux caractères 9 054, 10 011,
 * 4 821, 8 363 et 4 559. L'agrégat coupait chaque réponse à 6 000 caractères : seules les versions
 * [8] (fausse) et [12] (corrigée) restaient lisibles, donc DEUX lignes et aucune leçon enregistrable
 * (`parseAttestedLearningProposal` exige une ligne unique). Le juge, dont le VALIDE enregistre la
 * ligne qu'il voit, a refusé la version fausse (réparations 4 et 5), puis bloqué sur la perte de la
 * bonne (réparation 6) : le producteur ne pouvait rien y faire, chaque réparation AJOUTE une phase
 * et n'efface jamais les précédentes. 6 réparations, 38,74 $ au moment de l'arrêt.
 */

const CAP = 6000

function lecon(title: string): string {
  return `${OUTCOME_LESSON_MARKER} ${JSON.stringify({
    outcome: 'success',
    title,
    body: 'Constat mesuré.',
    type: 'lesson',
    scope: 'project',
    tags: ['run'],
    confidence: 'medium'
  })}`
}

function reponse(longueurAvantLecon: number, ligneDeLecon?: string): string {
  const corps = 'x'.repeat(longueurAvantLecon)
  return ligneDeLecon ? `${corps}\n${ligneDeLecon}` : corps
}

function lignesDeLecon(texte: string): string[] {
  return texte.split(/\r?\n/u).filter((l) => l.trimStart().startsWith(OUTCOME_LESSON_MARKER))
}

describe('agrégat remis au juge — leçon proposée', () => {
  it('cas conv-892 : la leçon corrigée, coupée au-delà du plafond, est celle qui reste', () => {
    const sorties = [
      { phase: 'build', text: reponse(4821, lecon('version fausse')) },
      { phase: 'clean', text: reponse(3986) },
      { phase: 'build', text: reponse(8363, lecon('version corrigee')) },
      { phase: 'clean', text: reponse(4615) }
    ]
    const agregat = agregerPhasesPourLeJuge(sorties, CAP)

    expect(lignesDeLecon(agregat)).toHaveLength(1)
    expect(parseAttestedLearningProposal(agregat)?.title).toBe('version corrigee')
    expect(agregat).toContain(MARQUE_TRONQUE)
  })

  it('deux leçons lisibles dans deux réparations : la plus récente est enregistrable', () => {
    const sorties = [
      { phase: 'build', text: reponse(4821, lecon('reparation 3')) },
      { phase: 'build', text: reponse(4559, lecon('reparation 5')) }
    ]
    const agregat = agregerPhasesPourLeJuge(sorties, CAP)

    expect(parseAttestedLearningProposal(agregat)?.title).toBe('reparation 5')
    expect(agregat).not.toContain('"reparation 3"')
    expect(agregat).toMatch(/remplacée/)
  })

  it('une phase sans leçon après la proposition ne la retire pas', () => {
    const sorties = [
      { phase: 'build', text: reponse(100, lecon('seule proposition')) },
      { phase: 'clean', text: reponse(100) },
      { phase: 'build', text: reponse(7000) }
    ]
    expect(parseAttestedLearningProposal(agregerPhasesPourLeJuge(sorties, CAP))?.title).toBe(
      'seule proposition'
    )
  })

  it('deux lignes dans la MÊME réponse restent ambiguës : aucune leçon, pas de repli sur une ancienne', () => {
    const sorties = [
      { phase: 'build', text: reponse(100, lecon('ancienne')) },
      { phase: 'build', text: `${reponse(100, lecon('a'))}\n${lecon('b')}` }
    ]
    const agregat = agregerPhasesPourLeJuge(sorties, CAP)

    expect(parseAttestedLearningProposal(agregat)).toBeUndefined()
    expect(agregat).not.toContain('"ancienne"')
  })

  it('sans aucune leçon, le texte est inchangé (en-têtes de phase, plafond, marque de coupure)', () => {
    const sorties = [
      { phase: 'frame', text: 'cadre' },
      { phase: 'build', text: 'y'.repeat(CAP + 10) }
    ]
    expect(agregerPhasesPourLeJuge(sorties, CAP)).toBe(
      `[phase frame]\ncadre\n\n[phase build]\n${'y'.repeat(CAP)}${MARQUE_TRONQUE}`
    )
  })
})
