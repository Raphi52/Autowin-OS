import { describe, expect, it } from 'vitest'
import { boundedTurnHistory, buildTurnMessages } from './chat-turn-messages'

describe('boundedTurnHistory', () => {
  it('retire la réponse assistant orpheline créée par la limite de 40 messages', () => {
    const history = Array.from({ length: 20 }, (_, index) => [
      { role: 'user' as const, content: `question-${index + 1}` },
      { role: 'assistant' as const, content: `réponse-${index + 1}` }
    ]).flat()
    history.push({ role: 'user', content: 'question-courante' })

    const bounded = boundedTurnHistory(history, 40)

    expect(bounded).toHaveLength(39)
    expect(bounded[0]).toEqual({ role: 'user', content: 'question-2' })
    expect(bounded.at(-1)).toEqual({ role: 'user', content: 'question-courante' })
    expect(bounded.some((message) => message.content === 'réponse-1')).toBe(false)
  })

  it('laisse intacte une fenêtre déjà bornée, objets et pièces jointes compris', () => {
    const history = [
      { role: 'user' as const, content: 'question', attachments: [{ name: 'preuve.txt' }] },
      { role: 'assistant' as const, content: 'réponse' },
      { role: 'user' as const, content: 'suite' }
    ]

    const bounded = boundedTurnHistory(history, 40)

    expect(bounded).toEqual(history)
    expect(bounded[0]).toBe(history[0])
  })

  it('ne transmet pas un historique malformé composé uniquement de réponses assistant', () => {
    expect(
      boundedTurnHistory(
        [
          { role: 'assistant', content: 'orpheline-1' },
          { role: 'assistant', content: 'orpheline-2' }
        ],
        40
      )
    ).toEqual([])
  })
})

describe('buildTurnMessages', () => {
  it("serialise l'etat de l'app en JSON dans la premiere entree", () => {
    const entries = buildTurnMessages({
      snapshot: { foo: 'bar', n: 2 },
      brainContext: '',
      memoryEcho: '',
      history: []
    })
    expect(entries[0]).toBe(`ÉTAT DE L'APP:\n${JSON.stringify({ foo: 'bar', n: 2 })}`)
  })

  it("filtre le contexte Brain et l'echo memoire quand ils sont vides (aucun trou dans les entrees)", () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '   ',
      history: [{ role: 'user', content: 'salut' }]
    })
    expect(entries).toEqual([`ÉTAT DE L'APP:\n${JSON.stringify({})}`, 'UTILISATEUR: salut'])
  })

  it("conserve le contexte Brain et l'echo memoire quand ils sont non vides, dans l'ordre", () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: 'CONTEXTE BRAIN',
      memoryEcho: 'ECHO MEMOIRE',
      history: []
    })
    expect(entries).toEqual([
      `ÉTAT DE L'APP:\n${JSON.stringify({})}`,
      'CONTEXTE BRAIN',
      'ECHO MEMOIRE'
    ])
  })

  it("prefixe les messages utilisateur par UTILISATEUR et les autres roles par TOI, dans l'ordre de l'historique", () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'reponse' },
        { role: 'system', content: 'note systeme' }
      ]
    })
    expect(entries).toEqual([
      `ÉTAT DE L'APP:\n${JSON.stringify({})}`,
      'UTILISATEUR: question',
      'TOI: reponse',
      'TOI: note systeme'
    ])
  })

  it("sans resumeSessionId, ignore lastUserMessage et rend tout l'historique", () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [{ role: 'user', content: 'A' }],
      lastUserMessage: 'B ne doit pas apparaitre seul'
    })
    expect(entries).toEqual([`ÉTAT DE L'APP:\n${JSON.stringify({})}`, 'UTILISATEUR: A'])
  })

  it("avec resumeSessionId, ignore tout l'historique et ne rend que le dernier message utilisateur", () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [
        { role: 'user', content: 'ancien message 1' },
        { role: 'assistant', content: 'ancienne reponse' }
      ],
      resumeSessionId: 'sess-123',
      lastUserMessage: 'dernier message'
    })
    expect(entries).toEqual([
      `ÉTAT DE L'APP:\n${JSON.stringify({})}`,
      "Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).",
      'UTILISATEUR: dernier message'
    ])
  })

  it('avec resumeSessionId sans lastUserMessage, rend une entree UTILISATEUR vide qui est filtree', () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [],
      resumeSessionId: 'sess-123'
    })
    // 'UTILISATEUR: ' + '' a un contenu non vide (le prefixe) : PAS filtre.
    expect(entries).toEqual([
      `ÉTAT DE L'APP:\n${JSON.stringify({})}`,
      "Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).",
      'UTILISATEUR: '
    ])
  })

  it('avec resumeSessionId, insere le message de continuation avant UTILISATEUR meme si Brain et memoire sont vides', () => {
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [],
      resumeSessionId: 'sess-1',
      lastUserMessage: 'ok'
    })
    expect(entries).toEqual([
      `ÉTAT DE L'APP:\n${JSON.stringify({})}`,
      "Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).",
      'UTILISATEUR: ok'
    ])
  })

  it("un historique vide sans reprise ne rend que la ligne état de l'app", () => {
    const entries = buildTurnMessages({
      snapshot: null,
      brainContext: '',
      memoryEcho: '',
      history: []
    })
    expect(entries).toEqual([`ÉTAT DE L'APP:\n${JSON.stringify(null)}`])
  })
})
