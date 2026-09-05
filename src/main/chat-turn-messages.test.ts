import { describe, expect, it } from 'vitest'
import {
  boundedContinuationHistory,
  boundedTurnHistory,
  buildTurnMessages,
  exigeAgirPasAnnoncer,
  consigneApresEchec,
  exigeCorrigerEtPoursuivre,
  signatureDEchec,
  exigeDireLEchec,
  exigeUnChiffreVerifie,
  exigePreuveAvantDePromettre,
  blocVisuelNonFerme,
  nommerPiecesJointes
} from './chat-turn-messages'

describe('boundedTurnHistory', () => {
  it('retire la réponse assistant orpheline créée par la limite de 40 messages', () => {
    const history = Array.from({ length: 20 }, (_, index) => [
      { role: 'user' as const, content: `question-${index + 1}` },
      { role: 'assistant' as const, content: `réponse-${index + 1}` }
    ]).flat()
    history.push({ role: 'user', content: 'question-courante' })

    const bounded = boundedTurnHistory(history, 40)

    // 39 messages retenus + l'AVIS DE COUPE en tete : ce qui a ete retire est DIT.
    expect(bounded).toHaveLength(40)
    expect(bounded[0]?.content).toContain('HISTORIQUE TRONQUE')
    expect(bounded[0]?.content).toContain('2 message(s)')
    expect(bounded[1]).toEqual({ role: 'user', content: 'question-2' })
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

  it('coupe sur le VOLUME quand 40 messages pesent trop lourd, et garde le dernier', () => {
    // 4 caracteres par token : 40 000 caracteres = 10 000 tokens par message.
    const gros = (nom: string): { role: 'user'; content: string } => ({
      role: 'user',
      content: `${nom}:${'x'.repeat(40_000)}`
    })
    const history = [gros('a'), gros('b'), gros('c'), gros('d')]

    // Budget de 25 000 tokens : deux messages tiennent, pas trois.
    const bounded = boundedTurnHistory(history, { maxMessages: 40, maxTokens: 25_000 })

    expect(bounded).toHaveLength(3) // avis + 2 messages
    expect(bounded[0]?.content).toContain('HISTORIQUE TRONQUE')
    expect(bounded[1]?.content.startsWith('c:')).toBe(true)
    expect(bounded.at(-1)?.content.startsWith('d:')).toBe(true)
  })

  it('ne coupe jamais le dernier message, meme s il depasse a lui seul le budget', () => {
    const history = [
      { role: 'user' as const, content: 'ancien' },
      { role: 'user' as const, content: 'x'.repeat(400_000) }
    ]

    const bounded = boundedTurnHistory(history, { maxMessages: 40, maxTokens: 1_000 })

    expect(bounded).toHaveLength(2) // avis + le dernier message, intact
    expect(bounded.at(-1)?.content).toHaveLength(400_000)
  })

  it('n annonce aucune coupe quand rien n a ete ecarte', () => {
    const history = [
      { role: 'user' as const, content: 'question' },
      { role: 'assistant' as const, content: 'reponse' }
    ]

    expect(boundedTurnHistory(history, 40)).toEqual(history)
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
    expect(result.history).toHaveLength(41)
    expect(result.history[0]?.content).toContain('HISTORIQUE TRONQUE')
    expect(result.history[1]?.content).toBe('Analyse ce depot en lecture seule')
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
      "Suite de NOTRE conversation en cours. Ta session en porte normalement l'historique. Si ce n'est " +
        'PAS le cas -- tu ne sais plus de quoi parle la demande, ou elle refere a un echange que ' +
        'tu ne retrouves pas --, ne devine pas et ne fouille pas le code : appelle ' +
        'conversation_search sur les mots de la demande, puis conversation_read sur ' +
        "l'identifiant rendu. L'identifiant de la conversation courante est " +
        "activeConversationId, dans l'ETAT DE L'APP ci-dessus.",
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
      "Suite de NOTRE conversation en cours. Ta session en porte normalement l'historique. Si ce n'est " +
        'PAS le cas -- tu ne sais plus de quoi parle la demande, ou elle refere a un echange que ' +
        'tu ne retrouves pas --, ne devine pas et ne fouille pas le code : appelle ' +
        'conversation_search sur les mots de la demande, puis conversation_read sur ' +
        "l'identifiant rendu. L'identifiant de la conversation courante est " +
        "activeConversationId, dans l'ETAT DE L'APP ci-dessus.",
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
      "Suite de NOTRE conversation en cours. Ta session en porte normalement l'historique. Si ce n'est " +
        'PAS le cas -- tu ne sais plus de quoi parle la demande, ou elle refere a un echange que ' +
        'tu ne retrouves pas --, ne devine pas et ne fouille pas le code : appelle ' +
        'conversation_search sur les mots de la demande, puis conversation_read sur ' +
        "l'identifiant rendu. L'identifiant de la conversation courante est " +
        "activeConversationId, dans l'ETAT DE L'APP ci-dessus.",
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
      "Suite de NOTRE conversation en cours. Ta session en porte normalement l'historique. Si ce n'est " +
        'PAS le cas -- tu ne sais plus de quoi parle la demande, ou elle refere a un echange que ' +
        'tu ne retrouves pas --, ne devine pas et ne fouille pas le code : appelle ' +
        'conversation_search sur les mots de la demande, puis conversation_read sur ' +
        "l'identifiant rendu. L'identifiant de la conversation courante est " +
        "activeConversationId, dans l'ETAT DE L'APP ci-dessus.",
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

describe('exigeCorrigerEtPoursuivre — il voit son erreur, la raconte, et abandonne', () => {
  const ECHEC_NON_CORRIGE = true

  it('mord quand la dernière action a échoué et que le tour se termine sur le constat', () => {
    const vecu =
      'La commande a échoué : le test `pari-liaison` est rouge. ✅ Fait\n📍 Maintenant : le test ne passe pas.'
    expect(exigeCorrigerEtPoursuivre(ECHEC_NON_CORRIGE, vecu)).toBe(true)
  })

  it('ne mord PAS quand la dernière itération a réussi — la reprise a fonctionné', () => {
    // Le discriminant : un échec RATTRAPÉ ne doit plus rien réclamer, sinon la garde harcèle.
    expect(exigeCorrigerEtPoursuivre(false, 'La deuxième tentative est passée : test vert.')).toBe(
      false
    )
  })

  it('ne mord PAS quand la reprise dépend VRAIMENT de l’utilisateur', () => {
    const bloque =
      'La suppression a échoué : il me faut ton autorisation explicite pour toucher la base de prod.'
    expect(exigeCorrigerEtPoursuivre(ECHEC_NON_CORRIGE, bloque)).toBe(false)
  })

  it('ne mord PAS sur une réponse vide — le tour muet a sa propre garde', () => {
    expect(exigeCorrigerEtPoursuivre(ECHEC_NON_CORRIGE, '   ')).toBe(false)
  })
})

describe('auto-kaizen en cours de tour — la MÊME erreur ne se rejoue pas', () => {
  it('normalise chemins, nombres et casse : deux occurrences du même mur ont une seule signature', () => {
    // Antislashs DOUBLES a dessein : `\\A` n'est pas un echappement valide, JS le lisait `A` et la
    // chaine ne portait donc AUCUN antislash -- ce test passait sans jamais exercer un chemin Windows.
    const a = signatureDEchec('edit_file', 'ENOENT: C:\\Amitel\\Autowin OS\\src\\a.ts introuvable')
    const b = signatureDEchec('edit_file', 'enoent: C:\\Amitel\\Autowin OS\\src\\b.ts introuvable')
    expect(a).toBe(b)
  })

  it('deux murs DIFFÉRENTS gardent des signatures distinctes', () => {
    const enoent = signatureDEchec('edit_file', 'ENOENT: chemin introuvable')
    const droits = signatureDEchec('edit_file', 'EACCES: permission refusée')
    expect(enoent).not.toBe(droits)
  })

  it('la même erreur sur DEUX outils différents reste distincte', () => {
    expect(signatureDEchec('edit_file', 'ENOENT: x')).not.toBe(
      signatureDEchec('run_tests', 'ENOENT: x')
    )
  })

  it('la consigne ESCALADE à la deuxième rencontre du même mur', () => {
    const sig = signatureDEchec('edit_file', 'ENOENT: chemin introuvable')
    const premiere = consigneApresEchec([], sig)
    const seconde = consigneApresEchec([sig], sig)
    expect(premiere).not.toBe(seconde)
    // La première demande de corriger ; la seconde interdit de rejouer et EXIGE de capitaliser.
    expect(premiere).toContain('CAUSE')
    expect(seconde).toContain('DÉJÀ')
    expect(seconde).toContain('remember')
  })

  it('un mur JAMAIS vu ne déclenche pas l’escalade', () => {
    const vu = signatureDEchec('edit_file', 'ENOENT: chemin introuvable')
    const neuf = signatureDEchec('run_tests', 'assertion rouge')
    expect(consigneApresEchec([vu], neuf)).toBe(consigneApresEchec([], neuf))
  })
})

describe('signatureDEchec — les pieges de normalisation trouves par l’audit', () => {
  it('deux occurrences du MÊME mur differant par un segment de CHEMIN non numerique fusionnent', () => {
    // Trouve par l'audit du 2026-08-21 : la regle de chemin ne matchait jamais (un antislash au
    // lieu de deux), et le test d'origine passait grace a la regle de NOM DE FICHIER ajoutee
    // ensuite — vert pour la mauvaise raison. Ici aucun nom de fichier ne peut masquer la panne.
    // L'antislash est construit, jamais ecrit en litteral : un echappement mal transmis a
    // DEJA fabrique ce defaut une fois, il ne doit pas pouvoir le refabriquer dans le test.
    const SEP = String.fromCharCode(92)
    const chemin = (run: string): string =>
      `ENOENT: dossier absent C:${SEP}tmp${SEP}${run}${SEP}sortie`
    const a = signatureDEchec('fs', chemin('runA'))
    const b = signatureDEchec('fs', chemin('runB'))
    expect(a).toBe(b)
  })

  it('deux erreurs DIFFERENTES a long prefixe commun ne fusionnent PAS', () => {
    // La troncature a 80 caracteres jetait le suffixe DISCRIMINANT : une coupure reseau transitoire
    // et une panne de destination devenaient le meme mur, donc « interdit de rejouer » sur un
    // diagnostic faux.
    const prefixe =
      'Erreur reseau lors de la connexion au service distant apres plusieurs tentatives, motif: '
    expect(signatureDEchec('net', prefixe + 'ECONNRESET')).not.toBe(
      signatureDEchec('net', prefixe + 'ETIMEDOUT')
    )
  })

  it('la signature reste bornee en longueur', () => {
    const enorme = 'x'.repeat(5000)
    expect(signatureDEchec('outil', enorme).length).toBeLessThanOrEqual(120)
  })
})

describe('exigeCorrigerEtPoursuivre — le mur humain doit etre une VRAIE attente, pas un mot-clé', () => {
  it('ne se tait PAS quand l’agent annonce qu’il corrige, meme si le mot « autorise » apparait', () => {
    // Trouve par l'audit : la co-occurrence lexicale suffisait a desarmer la garde, donc l'agent
    // pouvait abandonner sans etre relance — exactement le defaut qu'elle devait supprimer.
    const texte =
      'La commande a échoué car le fichier de configuration n’autorise pas ce caractère.'
    expect(exigeCorrigerEtPoursuivre(true, texte)).toBe(true)
  })

  it('se tait sur une vraie question suspensive adressee a l’utilisateur', () => {
    expect(exigeCorrigerEtPoursuivre(true, 'Échec : veux-tu que je force la suppression ?')).toBe(
      false
    )
  })

  it('se tait quand l’agent declare la tache HORS DE SA PORTEE, sans mot-clé de permission', () => {
    // Signale par l'audit « nuisance » : un agent qui a RAISON de s'arreter se faisait relancer
    // deux fois puis accuser de tourner en rond, et devait polluer `remember` pour rien.
    const horsPerimetre =
      'La commande a échoué : cette fonctionnalité n’existe pas dans cette application, je ne peux pas le faire.'
    expect(exigeCorrigerEtPoursuivre(true, horsPerimetre)).toBe(false)
  })
})

describe('exigeUnChiffreVerifie — « total » demande un compte comme « combien »', () => {
  it('mord quand le compte est demandé comme un total', () => {
    // Recupere du bureau `autowin/recovery/run-80f9ddeb5982-1` (2026-08-18). Le garde reconnaissait
    // combien / nombre / compte / liste / inventaire, mais PAS « total » : la question passait au
    // travers et un chiffre devine pouvait sortir sans lecture pour l'etayer.
    expect(
      exigeUnChiffreVerifie(
        'Quel est le total de fichiers .test.ts dans src/main ?',
        'Le total est indisponible.',
        false
      )
    ).toBe(true)
  })

  it('une lecture EFFECTUEE desarme le garde, « total » ou pas', () => {
    // L'entree qui doit faire echouer une garde trop large : le garde existe pour reclamer une
    // lecture, pas pour bloquer une reponse qui en a deja une.
    expect(exigeUnChiffreVerifie('Quel est le total de fichiers ?', 'Il y en a 42.', true)).toBe(
      false
    )
  })
})

describe('buildTurnMessages — pieces jointes nommees dans le fil', () => {
  const base = { snapshot: { tab: 'chat' }, brainContext: '', memoryEcho: '' }

  it('nomme la piece jointe du message qui la portait', () => {
    const entries = buildTurnMessages({
      ...base,
      history: [
        {
          role: 'user',
          content: 'Voici la maquette',
          attachments: [{ name: 'maquette.png', kind: 'image' }]
        },
        { role: 'assistant', content: 'Bien recu.' },
        { role: 'user', content: 'reprends la palette' }
      ]
    } as never)

    const maquette = entries.find((e) => e.includes('Voici la maquette'))
    expect(maquette).toContain('[pieces jointes de ce message: maquette.png]')
    // Un message sans piece jointe ne recoit AUCUNE mention : pas de crochet vide dans le fil.
    expect(entries.find((e) => e.includes('reprends la palette'))).not.toContain('pieces jointes')
  })

  it('ne rend rien pour un tableau vide ou des noms vides', () => {
    expect(nommerPiecesJointes([])).toBe('')
    expect(nommerPiecesJointes(undefined)).toBe('')
    expect(nommerPiecesJointes([{ name: '  ' }])).toBe('')
  })
})

describe('exigePreuveAvantDePromettre — la clôture qui promet un message futur', () => {
  it('mord quand le tour a lancé une action et promet de rendre compte plus tard', () => {
    expect(
      exigePreuveAvantDePromettre(
        'Run lancé. Je te rends le résultat vérifié — exit codes réels — dès qu’il rend la main.',
        true
      )
    ).toBe(true)
  })

  it('mord sur « je reviens avec » et « je te tiens au courant »', () => {
    expect(exigePreuveAvantDePromettre('Je reviens avec le compte-rendu.', true)).toBe(true)
    expect(exigePreuveAvantDePromettre('Je te tiens au courant du résultat.', true)).toBe(true)
  })

  it('laisse passer une clôture qui rend compte au PASSÉ', () => {
    expect(exigePreuveAvantDePromettre('Run terminé : exit code 0, 12 tests verts.', true)).toBe(
      false
    )
  })

  it('laisse passer si aucune action n’a eu lieu (autre garde) et si le texte est vide', () => {
    expect(exigePreuveAvantDePromettre('Je te rends le résultat dès que possible.', false)).toBe(
      false
    )
    expect(exigePreuveAvantDePromettre('', true)).toBe(false)
  })

  it('ne mord pas sur un « dès que » qui ne promet aucun compte-rendu de l’agent', () => {
    expect(
      exigePreuveAvantDePromettre(
        'Le cache est invalidé dès que le fichier change ; relance-le quand tu veux.',
        true
      )
    ).toBe(false)
  })
})

describe('blocVisuelNonFerme — la fence html-render jamais refermée', () => {
  it('mord sur une fence fermée par une pseudo-balise au lieu de ```', () => {
    expect(blocVisuelNonFerme('Voici :\n```html-render\n<p>x</p>\n</html-render\n')).toBe(true)
  })

  it('ne mord pas sur une fence correctement refermée', () => {
    expect(blocVisuelNonFerme('```html-render\n<p>x</p>\n```\n')).toBe(false)
  })

  it('ne mord pas sans bloc html-render, ni sur un bloc de code ordinaire', () => {
    expect(blocVisuelNonFerme('texte simple')).toBe(false)
    expect(blocVisuelNonFerme('```ts\nconst a = 1\n```')).toBe(false)
  })

  it('gère plusieurs blocs : le dernier non fermé suffit à mordre', () => {
    expect(
      blocVisuelNonFerme('```html-render\n<p>a</p>\n```\ntexte\n```html-render\n<p>b</p>\n')
    ).toBe(true)
  })
})
