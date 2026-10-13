import { describe, expect, it } from 'vitest'
import { agregerPhasesPourLeJuge, MARQUE_TRONQUE, MENTION_VERSION_REMPLACEE } from './agregat-juge'
import { OUTCOME_LESSON_MARKER, parseAttestedLearningProposal } from './outcome-learning-proposal'
import { AGGREGATE_MAX_CHARS } from './evidence-digest'

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
    // Piste 5 de conv-914 : la place des réponses courtes revient aux longues ; pour que la coupe ait
    // lieu, les quatre réponses prennent les longueurs mesurées les plus grandes (9 054, 10 011, 8 363).
    const sorties = [
      { phase: 'build', text: reponse(9054, lecon('version fausse')) },
      { phase: 'clean', text: reponse(10011) },
      { phase: 'build', text: reponse(8363, lecon('version corrigee')) },
      { phase: 'clean', text: reponse(9054) }
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

  it('sans aucune leçon : en-têtes de phase, et un bloc trop long garde son début ET sa fin', () => {
    // Piste 5 de conv-914 : la coupe gardait le seul début (`y` × 6 000 puis la marque). Elle garde
    // désormais 2/3 du plafond en tête et le reste en fin, raccord compris : 4 000 + 1 + 1 999.
    // Deux blocs au-delà du plafond : la place mise en commun est épuisée, chacun garde sa part.
    const sorties = [
      { phase: 'frame', text: 'x'.repeat(CAP + 10) },
      { phase: 'build', text: 'y'.repeat(CAP + 10) }
    ]
    expect(agregerPhasesPourLeJuge(sorties, CAP)).toBe(
      `[phase frame]\n${'x'.repeat(4000)}${MARQUE_TRONQUE}\n${'x'.repeat(1999)}\n\n` +
        `[phase build]\n${'y'.repeat(4000)}${MARQUE_TRONQUE}\n${'y'.repeat(1999)}`
    )
  })
})

/** Le bloc d'une phase, tel que l'agrégat le rend (entre son en-tête et le suivant). */
function blocDe(agregat: string, phase: string, rang = 0): string {
  const morceaux = agregat
    .split(/\n\n(?=\[phase )/u)
    .filter((m) => m.startsWith(`[phase ${phase}]\n`))
  return morceaux[rang]!.slice(`[phase ${phase}]\n`.length)
}

describe('agrégat remis au juge — piste 5 de conv-914 : la fin d’un cadrage long reste lisible', () => {
  const CAUSE = 'CausalHypothesis: src/main/exemple.ts — la cause nommée en fin de cadrage'
  /** Lignes de 100 caractères, la ligne CAUSE posée au caractère `position`, total ≥ `longueur`. */
  function cadrage(longueur: number, position: number): string {
    const avant = `${'c'.repeat(99)}\n`.repeat(Math.floor(position / 100))
    const reste = longueur - avant.length - CAUSE.length - 1
    const apres = `${'d'.repeat(99)}\n`.repeat(Math.ceil(reste / 100))
    return `${avant}${CAUSE}\n${apres}`
  }

  // fix-ok: réparation 5 de run-a8a70cd0ee56-1 — le juge a relevé que la coupe restait à 6 000 par étape
  // (`JUDGE_PHASE_CAP`) ; un cadrage suivi d'un build court était coupé alors que la place du build restait
  // vide. Les deux premiers tests ci-dessous sont rouges sur la répartition d'avant (code 1).
  it('cadrage de 9 000 caractères suivi d’un build court : il reprend la place du build, rien n’est coupé', () => {
    const texte = cadrage(9000, 7500)
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'frame', text: texte },
        { phase: 'build', text: 'fait' }
      ],
      CAP
    )
    expect(blocDe(agregat, 'frame')).toBe(texte)
    expect(blocDe(agregat, 'build')).toBe('fait')
    expect(agregat.length).toBeLessThanOrEqual(2 * CAP + 2 * MARQUE_TRONQUE.length + 40)
  })

  it('beaucoup d’étapes longues : l’agrégat ne dépasse jamais AGGREGATE_MAX_CHARS, et chacune garde sa fin', () => {
    const sorties = Array.from({ length: 12 }, (_, i) => ({
      phase: 'build',
      text: `${`${'b'.repeat(99)}\n`.repeat(89)}fin du build ${i}`
    }))
    const agregat = agregerPhasesPourLeJuge(sorties, CAP)
    expect(agregat.length).toBeLessThanOrEqual(AGGREGATE_MAX_CHARS)
    for (let i = 0; i < 12; i += 1) expect(agregat).toContain(`fin du build ${i}`)
  })

  it('jumeau : deux étapes longues se partagent la place — chacune coupée à sa part, début ET fin gardés', () => {
    const texte = cadrage(9000, 7500)
    expect(texte.indexOf(CAUSE)).toBe(7500)
    expect(texte.length).toBeGreaterThanOrEqual(9000)
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'frame', text: texte },
        { phase: 'build', text: 'e'.repeat(9000) }
      ],
      CAP
    )
    const bloc = blocDe(agregat, 'frame')
    expect(bloc).toContain(`\n${CAUSE}\n`)
    expect(bloc).toContain(MARQUE_TRONQUE)
    expect(bloc.length).toBeLessThanOrEqual(CAP + MARQUE_TRONQUE.length)
    expect(blocDe(agregat, 'build').length).toBeLessThanOrEqual(CAP + MARQUE_TRONQUE.length)
  })

  it('jumeau : un cadrage au plafond exact n’est pas coupé', () => {
    const texte = 'z'.repeat(CAP)
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'frame', text: texte },
        { phase: 'build', text: 'fait' }
      ],
      CAP
    )
    expect(blocDe(agregat, 'frame')).toBe(texte)
  })
})

describe('agrégat remis au juge — piste 1 de conv-914 : seule la dernière version d’une étape rejouée en entier', () => {
  it('scout rejoué 3 fois : la 3e version est entière, les deux autres remplacées par une mention', () => {
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'scout', text: 'tableau version 1' },
        { phase: 'scout', text: 'tableau version 2' },
        { phase: 'scout', text: 'tableau version 3' }
      ],
      CAP
    )
    expect(agregat).not.toContain('tableau version 1')
    expect(agregat).not.toContain('tableau version 2')
    expect(blocDe(agregat, 'scout', 0)).toBe(MENTION_VERSION_REMPLACEE)
    expect(blocDe(agregat, 'scout', 1)).toBe(MENTION_VERSION_REMPLACEE)
    expect(blocDe(agregat, 'scout', 2)).toBe('tableau version 3')
  })

  it('jumeau : deux build de réparation AJOUTENT un changement chacun — les deux restent', () => {
    const textes = ['cadre', 'correctif 1', 'nettoyage 1', 'correctif 2', 'nettoyage 2']
    const phases = ['frame', 'build', 'clean', 'build', 'clean']
    const agregat = agregerPhasesPourLeJuge(
      textes.map((text, i) => ({ phase: phases[i]!, text })),
      CAP
    )
    for (const texte of textes) expect(agregat).toContain(texte)
    expect(agregat).not.toContain(MENTION_VERSION_REMPLACEE)
  })

  it('la leçon d’une version remplacée reste proposée si aucune réponse plus récente n’en porte', () => {
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'scout', text: reponse(100, lecon('lecon du scout 1')) },
        { phase: 'scout', text: 'tableau version 2' }
      ],
      CAP
    )
    expect(parseAttestedLearningProposal(agregat)?.title).toBe('lecon du scout 1')
    expect(lignesDeLecon(agregat)).toHaveLength(1)
  })
})
