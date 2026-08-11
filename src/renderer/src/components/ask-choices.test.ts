import { describe, expect, it } from 'vitest'
import { parseAskChoices } from './ask-choices'

const action = (
  data: unknown,
  patch: Record<string, unknown> = {}
): Parameters<typeof parseAskChoices>[0] => ({
  kind: 'action',
  name: 'ask',
  ok: true,
  data,
  ...patch
})

describe('parseAskChoices — des réponses cliquables, déclarées et non devinées', () => {
  it('rend la question en titre et chaque réponse en chip', () => {
    const groups = parseAskChoices(
      action({ question: 'On corrige quoi en premier ?', options: ['Le budget', 'Le manifeste'] })
    )

    expect(groups).toHaveLength(1)
    expect(groups?.[0].title).toBe('On corrige quoi en premier ?')
    // Le label EST le prompt renvoyé au clic — même contrat que les suggestions existantes.
    expect(groups?.[0].items.map((item) => item.label)).toEqual(['Le budget', 'Le manifeste'])
  })

  it('n’affiche RIEN pour une réponse unique — ce n’est pas un choix', () => {
    // Un bouton seul ressemble à une validation, pas à une question.
    expect(parseAskChoices(action({ question: 'On y va ?', options: ['Oui'] }))).toBeNull()
  })

  it('ignore une action qui n’est pas `ask`', () => {
    expect(
      parseAskChoices(action({ question: 'q', options: ['a', 'b'] }, { name: 'orchestrate' }))
    ).toBeNull()
  })

  it('ignore une action en ÉCHEC ou encore en cours', () => {
    const data = { question: 'q', options: ['a', 'b'] }
    expect(parseAskChoices(action(data, { ok: false }))).toBeNull()
    expect(parseAskChoices(action(data, { ok: undefined }))).toBeNull()
  })

  it('ignore une partie de texte', () => {
    expect(
      parseAskChoices({ kind: 'text', ok: true, data: { question: 'q', options: ['a', 'b'] } })
    ).toBeNull()
  })

  it('résiste à un `data` malformé plutôt que de casser le fil', () => {
    expect(parseAskChoices(action(undefined))).toBeNull()
    expect(parseAskChoices(action({ question: '   ', options: ['a', 'b'] }))).toBeNull()
    expect(parseAskChoices(action({ question: 'q', options: 'a, b' }))).toBeNull()
    expect(parseAskChoices(action({ question: 'q', options: [1, 2] }))).toBeNull()
  })

  it('écarte les réponses vides sans perdre les valides', () => {
    const groups = parseAskChoices(action({ question: 'q', options: ['Oui', '  ', 'Non'] }))

    expect(groups?.[0].items.map((item) => item.label)).toEqual(['Oui', 'Non'])
  })
})
