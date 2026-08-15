import { describe, expect, it } from 'vitest'
import {
  boundedContinuationHistory,
  boundedTurnHistory,
  buildTurnMessages,
  exigeAgirPasAnnoncer,
  exigeDireLEchec,
  exigeUnChiffreVerifie
} from './chat-turn-messages'

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

describe('boundedContinuationHistory', () => {
  it('conserve le dernier vrai prompt et du contexte apres plus de 40 messages assistant', () => {
    const history = [
      { role: 'user' as const, content: 'Analyse ce depot en lecture seule' },
      ...Array.from({ length: 39 }, (_, index) => ({
        role: 'assistant' as const,
        content: `continuation-${index + 1}`
      })),
      { role: 'user' as const, content: 'INSTRUCTION INTERNE DE CONTINUATION' }
    ]

    const result = boundedContinuationHistory(history, 40)

    expect(result.routingUserMessage?.content).toBe('Analyse ce depot en lecture seule')
    expect(result.history).toHaveLength(40)
    expect(result.history[0]?.content).toBe('Analyse ce depot en lecture seule')
    expect(result.history.some((message) => message.role === 'assistant')).toBe(true)
    expect(result.history.at(-1)?.content).toBe('INSTRUCTION INTERNE DE CONTINUATION')
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

  it('avec resumeSessionId, INJECTE un compte-rendu que le modele n’a jamais vu', () => {
    /*
      LE TROU DE SESSION, constate par l'utilisateur le 2026-08-14. Dans son fil, l'agent a repondu :
      « je vois bien qu'un orchestrate a ete lance dans cette conversation, mais la trace fournie ne
      contient ni son runId, ni ses phases, ni son resultat ».

      Cause : la route `explicit-skill` d'`agent-pilot` execute l'orchestration ELLE-MEME puis `return`
      AVANT tout appel au modele. La bulle affichee est redigee par du code. Le tour suivant reprend la
      session CLI et n'envoie que le dernier message — donc ce tour est ABSENT du transcript du modele.

      Pire que l'absence : on lui AFFIRMAIT « tu en connais deja l'historique par ta session ». C'est
      exactement la faute que le commentaire « RESUME FANTOME » corrige plus haut dans `agent-pilot`
      (mesure du 2026-08-04 : 0 appel reellement repris, 31 prompts amputes) — ici sur son cas frere.
    */
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [],
      resumeSessionId: 'sess-123',
      compteRenduNonVu: 'Workflow termine — run r-42, 3 phases, 0,12 $',
      lastUserMessage: 'on a bien fait tout le processus ?'
    })
    const injecte = entries.find((entry) => entry.includes('run r-42'))
    expect(injecte).toBeDefined()
    // La position compte : le compte-rendu doit precer la question qui l'interroge.
    expect(entries.indexOf(injecte!)).toBeLessThan(
      entries.findIndex((entry) => entry.startsWith('UTILISATEUR:'))
    )
  })

  it('avec un compte-rendu non vu, ne PRETEND PLUS que la session contient tout', () => {
    // Laisser l'affirmation intacte serait garder le mensonge tout en ajoutant le remede : le modele
    // lirait « tu connais deja l'historique » juste au-dessus d'un tour qu'il n'a jamais vu.
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [],
      resumeSessionId: 'sess-123',
      compteRenduNonVu: 'Workflow termine — run r-42',
      lastUserMessage: 'et alors ?'
    })
    expect(entries.some((entry) => entry.includes("tu en connais déjà l'historique"))).toBe(false)
  })

  it('sans compte-rendu non vu, le chemin de reprise reste INCHANGE', () => {
    // Le cas courant ne doit pas payer ce correctif : aucune entree en plus, aucun mot en moins.
    const entries = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [],
      resumeSessionId: 'sess-123',
      lastUserMessage: 'ok'
    })
    expect(entries).toEqual([
      `ÉTAT DE L'APP:\n${JSON.stringify({})}`,
      "Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).",
      'UTILISATEUR: ok'
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

describe('exigeUnChiffreVerifie — la relance mécanique du chiffre deviné', () => {
  const Q = 'Combien de fichiers .test.ts dans src/main ?'

  it('mord quand un NOMBRE est avancé SANS aucune lecture', () => {
    // Le cas mesuré : réponse en 3 s, chiffre faux, zéro outil appelé.
    expect(exigeUnChiffreVerifie(Q, 'Il y en a 42.', false)).toBe(true)
  })

  it('ne mord PAS quand une lecture a eu lieu', () => {
    // C'est le cas nominal des 19 réussites : l'agent a listé, son chiffre est fondé.
    expect(exigeUnChiffreVerifie(Q, 'Il y en a 220.', true)).toBe(false)
  })

  it('ne mord PAS sur une question qui ne demande aucun compte', () => {
    // Un faux positif coûterait une itération, et surtout du temps sur chaque tour ordinaire.
    expect(
      exigeUnChiffreVerifie('Explique-moi ce module en 3 lignes.', 'Il fait 2 choses.', false)
    ).toBe(false)
  })

  it('mord AUSSI sur un refus : list_files sait désormais trancher', () => {
    expect(exigeUnChiffreVerifie(Q, 'Je ne peux pas le déterminer.', false)).toBe(true)
  })

  it('mord sur une ANNONCE sans action — le cas mesuré le 2026-08-15', () => {
    // « Je vais vérifier directement le dossier src/main » : ni chiffre, ni action, tour terminé.
    // La première version de cette garde exigeait un nombre : elle ne pouvait pas voir ce cas.
    expect(
      exigeUnChiffreVerifie(Q, 'Je vais vérifier directement le dossier src/main.', false)
    ).toBe(true)
  })

  it('ne mord PAS sur une réponse vide', () => {
    expect(exigeUnChiffreVerifie(Q, '   ', false)).toBe(false)
  })
})

describe('exigeDireLEchec — un « Fait » posé sur un échec', () => {
  const AVEC_ECHEC = true

  it('mord sur le cas RÉEL de conv-1178 : edit_file en ok:false, texte qui dit « ✅ Fait »', () => {
    const vecu = '### ✅ Fait\nLe défaut reste confirmé dans `src/main/commands.ts`.'
    expect(exigeDireLEchec(AVEC_ECHEC, vecu)).toBe(true)
  })

  it('ne mord PAS quand la réponse NOMME l’échec', () => {
    expect(exigeDireLEchec(AVEC_ECHEC, 'La modification a échoué : le motif était ambigu.')).toBe(
      false
    )
  })

  it('ne mord PAS quand aucune action n’a échoué', () => {
    // Réclamer un aveu d'échec là où tout a réussi produirait un doute injustifié.
    expect(exigeDireLEchec(false, '### ✅ Fait\nTout est passé.')).toBe(false)
  })
})

describe('exigeAgirPasAnnoncer — il parle sans agir', () => {
  const DEMANDE = 'ranges moi mes conversations dans des sous categories adequates'
  const VECU =
    'Je vais d’abord identifier le comportement actuel, écrire un test rouge…\nJe cible maintenant le flux réel de classement.'

  it('mord sur le cas RÉEL de conv-1242 : un plan au futur, zéro action', () => {
    expect(exigeAgirPasAnnoncer(DEMANDE, VECU, false)).toBe(true)
  })

  it('ne mord PAS si une action a réellement eu lieu', () => {
    // Annoncer PUIS faire est legitime : c'est l'absence d'acte qui est en cause, pas la phrase.
    expect(exigeAgirPasAnnoncer(DEMANDE, VECU, true)).toBe(false)
  })

  it('ne mord PAS sur une QUESTION : on n’exige pas d’agir pour répondre', () => {
    expect(exigeAgirPasAnnoncer('combien de fichiers dans src ?', VECU, false)).toBe(false)
  })

  it('ne mord PAS sur un refus argumenté, qui n’annonce rien au futur', () => {
    // Dire « je ne peux pas, voici pourquoi » est une reponse honnete, pas un plan recite.
    expect(
      exigeAgirPasAnnoncer(
        DEMANDE,
        'Je ne peux pas ranger ces conversations : aucune catégorie n’existe.',
        false
      )
    ).toBe(false)
  })
})
