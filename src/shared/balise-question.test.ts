import { describe, expect, it } from 'vitest'
import {
  contientUneQuestionPosee,
  masquerLesQuestionsPosees,
  lireLaBalise
} from './balise-question'

const MARQUE = '[masquée]'

describe('balise de question posée ou citée', () => {
  it('une balise entre backticks est une citation', () => {
    const texte = 'La balise `<question>` est fermée.'
    expect(contientUneQuestionPosee(texte)).toBe(false)
    expect(masquerLesQuestionsPosees(texte, MARQUE)).toBe(texte)
  })

  it('une balise dans un bloc ``` ou ~~~ est une citation', () => {
    for (const clotures of ['```', '~~~', '````']) {
      const texte = `Exemple :\n${clotures}json\n<question>{"text":"?"}</question>\n${clotures}\nSuite.`
      expect(contientUneQuestionPosee(texte)).toBe(false)
      expect(masquerLesQuestionsPosees(texte, MARQUE)).toBe(texte)
    }
  })

  it('hors code, la balise reste posée, même sans charge JSON', () => {
    expect(contientUneQuestionPosee('<question>{"text":"Publier ?"}</question>')).toBe(true)
    expect(contientUneQuestionPosee('Texte <QUESTION>sk-test-123')).toBe(true)
    expect(masquerLesQuestionsPosees('Avant <question>sk-test-123', MARQUE)).toBe(`Avant ${MARQUE}`)
  })

  it('une vraie question après un passage ou un bloc refermé est masquée, la citation gardée', () => {
    const texte =
      'Citée : `<question>`.\n```\n<question>exemple</question>\n```\n' +
      '<question>{"text":"secret"}</question> fin'
    expect(contientUneQuestionPosee(texte)).toBe(true)
    expect(masquerLesQuestionsPosees(texte, MARQUE)).toBe(
      `Citée : \`<question>\`.\n\`\`\`\n<question>exemple</question>\n\`\`\`\n${MARQUE} fin`
    )
  })

  it('un backtick isolé ne fait pas d’une vraie question une citation', () => {
    const texte = 'Voici le `souci. <question>{"text":"sk-secret-123"}</question> fin'
    expect(contientUneQuestionPosee(texte)).toBe(true)
    expect(masquerLesQuestionsPosees(texte, MARQUE)).toBe(`Voici le \`souci. ${MARQUE} fin`)
    // Un passage ne traverse pas une ligne vide : sa fermeture au paragraphe suivant ne compte pas.
    expect(contientUneQuestionPosee('un `a <question>secret\n\nb` fin')).toBe(true)
  })

  it('un bloc de code jamais refermé ne fait pas d’une vraie question une citation', () => {
    expect(contientUneQuestionPosee('```\n<question>{"text":"sk-secret-123"}</question>')).toBe(
      true
    )
  })

  it('un passage se referme sur une série de même longueur, pas sur une autre', () => {
    const texte = '``a ` <question>b`` fin'
    expect(lireLaBalise(texte, texte.indexOf('<question>'), true)).toBe('citee')
    const sansFermeture = '``a <question>b` fin'
    expect(lireLaBalise(sansFermeture, sansFermeture.indexOf('<question>'), true)).toBe('posee')
  })

  it('tant que la fermeture peut encore arriver, la lecture est indécise', () => {
    const passage = 'la balise `<question>'
    expect(lireLaBalise(passage, 11, false)).toBe('indecise')
    expect(lireLaBalise(passage, 11, true)).toBe('posee')
    // Une série en toute fin peut encore s'allonger : « ` » deviendrait « `` ».
    expect(lireLaBalise(`${passage}\``, 11, false)).toBe('indecise')
    expect(lireLaBalise(`${passage}\` suite`, 11, false)).toBe('citee')
    const bloc = '```\n<question>\n```'
    expect(lireLaBalise(bloc, 4, false)).toBe('indecise')
    expect(lireLaBalise(`${bloc}\n`, 4, false)).toBe('citee')
  })

  it('un backtick échappé n’ouvre pas de passage de code', () => {
    expect(contientUneQuestionPosee('Un \\` puis <question>secret')).toBe(true)
  })
})
