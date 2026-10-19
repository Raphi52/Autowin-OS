import { describe, expect, it } from 'vitest'
import { avisMessageDuRun, lireMessageDuRun, messageDuRun, questionDuBilan } from './message-du-run'
import {
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele
} from './orchestration-outcome'

/**
 * LE RUN PARLE LUI-MEME A LA FIN (conv-1008) : la ligne `- Question :` du bilan de fin d'etape
 * devient une carte dans le fil, avec ses reponses cliquables. Ces tests fixent ce qui en est lu —
 * et surtout ce qui n'en est PAS lu : une question mal formee ne doit jamais devenir des boutons.
 */
const bilan = (question: string, reste = 'aucun reste'): string =>
  [
    '### Bilan de l’étape',
    '- Verdict : fait — Tests ajoutés pour orchestrator (19) et pour 4 fichiers de src/main (15)',
    '- Fichiers touchés : src/main/orchestrator.test.ts',
    '- Preuves : npx vitest run src/main/orchestrator.test.ts → 0',
    `- Reste à faire : ${reste}`,
    `- Question : ${question}`
  ].join('\n')

describe('questionDuBilan', () => {
  it('lit la question et ses réponses, la première recommandée', () => {
    expect(
      questionDuBilan(
        bilan('Je publie sur une branche dédiée ? → Oui, branche + PR | Pas maintenant')
      )
    ).toEqual({
      question: 'Je publie sur une branche dédiée ?',
      reponses: [{ libelle: 'Oui, branche + PR', recommande: true }, { libelle: 'Pas maintenant' }]
    })
  })

  it('tolère `->`, les backticks et les guillemets autour des libellés', () => {
    expect(
      questionDuBilan(bilan('`On garde l’ancien format ?` -> « Oui » | `Non, je le retire`'))
    ).toEqual({
      question: 'On garde l’ancien format ?',
      reponses: [{ libelle: 'Oui', recommande: true }, { libelle: 'Non, je le retire' }]
    })
  })

  it('« aucune » (le défaut) ne produit rien', () => {
    expect(questionDuBilan(bilan('aucune'))).toBeUndefined()
    expect(questionDuBilan(bilan('Aucune question'))).toBeUndefined()
  })

  it('une ligne mal formée ne devient jamais des boutons', () => {
    // Sans flèche : on ne devine pas les réponses.
    expect(questionDuBilan(bilan('Je publie ? Oui | Non'))).toBeUndefined()
    // Une seule réponse n'est pas un choix.
    expect(questionDuBilan(bilan('Je publie ? → Oui'))).toBeUndefined()
    // Plus de quatre : ce n'est plus une décision en un clic.
    expect(questionDuBilan(bilan('Lequel ? → A | B | C | D | E'))).toBeUndefined()
    // Deux flèches : on ne sait plus où finit la question.
    expect(questionDuBilan(bilan('A → B → C | D'))).toBeUndefined()
    // Deux réponses identiques.
    expect(questionDuBilan(bilan('Je publie ? → Oui | oui'))).toBeUndefined()
  })

  it('le gabarit recopié tel quel n’est pas une question', () => {
    expect(
      questionDuBilan(bilan('<question> → <réponse recommandée> | <autre réponse>'))
    ).toBeUndefined()
  })

  it('sans ligne Question : rien', () => {
    expect(questionDuBilan('### Bilan de l’étape\n- Verdict : fait — ok')).toBeUndefined()
  })
})

describe('messageDuRun', () => {
  it('prend la DERNIÈRE étape qui porte un bilan, et compose le résumé', () => {
    const message = messageDuRun([
      { phase: 'frame', text: `cadrage\n${bilan('Je lance le build ? → Oui | Non')}` },
      {
        phase: 'build',
        text: `corps du build\n${bilan('Je publie ? → Oui, branche + PR | Pas maintenant', 'les 4 découpages attendent tes cartes')}\nSUITE: fin`
      },
      // Le juge n'a pas de bilan : il ne masque pas la question du build.
      { phase: 'judge', text: 'VERDICT: green' }
    ])
    expect(message).toEqual({
      resume:
        'Tests ajoutés pour orchestrator (19) et pour 4 fichiers de src/main (15). Reste à faire : les 4 découpages attendent tes cartes.',
      question: 'Je publie ?',
      reponses: [{ libelle: 'Oui, branche + PR', recommande: true }, { libelle: 'Pas maintenant' }]
    })
  })

  it('une question d’une étape antérieure, dépassée par la suivante, ne ressort pas', () => {
    expect(
      messageDuRun([
        { phase: 'frame', text: bilan('Je lance le build ? → Oui | Non') },
        { phase: 'build', text: bilan('aucune') }
      ])
    ).toBeUndefined()
  })

  it('aucune sortie, ou aucune étape avec bilan : rien', () => {
    expect(messageDuRun(undefined)).toBeUndefined()
    expect(messageDuRun([])).toBeUndefined()
    expect(messageDuRun([{ phase: 'judge', text: 'VERDICT: green' }])).toBeUndefined()
  })
})

describe('avisMessageDuRun', () => {
  it('dit à l’agent du chat que la question est déjà à l’écran', () => {
    const avis = avisMessageDuRun({
      question: 'Je publie ?',
      reponses: [{ libelle: 'Oui', recommande: true }, { libelle: 'Non' }]
    })
    expect(avis).toContain('DÉJÀ AFFICHÉE')
    expect(avis).toContain('« Je publie ? »')
    expect(avis).toContain('Ne la repose pas avec ask')
    expect(avisMessageDuRun(undefined)).toBeUndefined()
  })
})

describe('lireMessageDuRun — relu du disque ou de l’IPC', () => {
  it('rend le message tel quel quand sa forme est la bonne', () => {
    const message = {
      resume: 'Fait.',
      question: 'Je publie ?',
      reponses: [{ libelle: 'Oui', recommande: true }, { libelle: 'Non' }]
    }
    expect(lireMessageDuRun(message)).toEqual(message)
  })

  it('une forme inattendue ne produit rien', () => {
    expect(lireMessageDuRun(undefined)).toBeUndefined()
    expect(lireMessageDuRun('Je publie ?')).toBeUndefined()
    expect(
      lireMessageDuRun({ question: 'Je publie ?', reponses: [{ libelle: 'Oui' }] })
    ).toBeUndefined()
    expect(
      lireMessageDuRun({ question: '', reponses: [{ libelle: 'A' }, { libelle: 'B' }] })
    ).toBeUndefined()
  })
})

describe('l’agent du chat apprend que la question est déjà affichée', () => {
  const issue = {
    status: 'succeeded',
    valid: true,
    gateBlocked: false,
    reused: false,
    runPath: 'C:/runs/conv/x/RUN.md',
    result: 'Travail fait.',
    messageDuRun: {
      question: 'Je publie ?',
      reponses: [{ libelle: 'Oui, branche + PR', recommande: true }, { libelle: 'Pas maintenant' }]
    }
  }

  it('le compte-rendu POUR LE MODÈLE porte l’avis', () => {
    expect(formatOrchestrationOutcomePourLeModele(true, issue)).toContain(
      'QUESTION DU RUN DÉJÀ AFFICHÉE'
    )
  })

  it('la bulle affichée ne le porte pas : elle a la carte', () => {
    expect(formatOrchestrationOutcome(true, issue)).not.toContain('QUESTION DU RUN')
  })

  it('sans message du run, le compte-rendu du modèle ne change pas', () => {
    const sans = { ...issue, messageDuRun: undefined }
    expect(formatOrchestrationOutcomePourLeModele(true, sans)).not.toContain('QUESTION DU RUN')
  })
})
