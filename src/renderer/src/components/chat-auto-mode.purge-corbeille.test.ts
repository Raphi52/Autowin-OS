import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deciderRelanceAuto,
  reponseAutoAuDernierAsk,
  suiteAttendUneDonneeUtilisateur
} from './chat-auto-mode'
import type { Msg } from './chat-view-types'

/*
 * LE MODE AUTO NE VIDE PAS LA CORBEILLE À LA PLACE DE L'UTILISATEUR (conv-1341, 2026-10-30).
 *
 * Une suite libre ne passe par aucun filtre destructeur, seule une option de question le fait. Or le
 * `/gc` écrit la purge dans ses suites quand il la propose : le 13/10, le mode auto a renvoyé « Purge
 * définitivement les 8 corbeilles gc » tout seul, et l'agent a refusé de l'exécuter. Une consigne n'a
 * pas suffi : les passes des 27, 28 et 30/10 ont toutes réécrit la purge dans leur rubrique Recommandé,
 * celle du 28/10 aussi dans une ligne de suite (conv-1047). Les phrases ci-dessous sont les leurs.
 * Aucune n'est partie sur ce fil. Le mode auto allumé, seul le gras de leur titre, que
 * `extractRecommendation` ne lit pas, aurait retenu celles des 27 et 30/10.
 *
 * Le refus reste ÉTROIT : ce fichier a déjà souffert de règles trop larges (conv-787). Un fil qui
 * travaille sur le code de la corbeille, ou qui supprime autre chose, garde son enchaînement.
 */
const humain = { role: 'user', content: '/gc passe quotidienne' } as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

const reponse = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg

const decider = (texte: string): ReturnType<typeof deciderRelanceAuto> =>
  deciderRelanceAuto({ ...base, fil: [humain, reponse(texte)] })

const parLaRecommandation = (suite: string): ReturnType<typeof deciderRelanceAuto> =>
  decider(`Bilan.\n\n👉 Recommandé : ${suite}`)

const parLaLigneDeSuite = (suite: string): ReturnType<typeof deciderRelanceAuto> =>
  decider(`Bilan.\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`)

const REELLES = [
  'Purge la corbeille du 16/10',
  'Purge définitivement les 8 corbeilles gc du 21 au 28/09',
  'Purger `gc-corbeille/2026-10-16` (6,1 Mo de journaux, rien à mettre à l’abri).',
  'Purger la corbeille du 13/10 sauf la copie d’avant migration, qui sera mise à l’abri.',
  'Purge the 13/10 and 14/10 trash folders, but first move conversations.json.pre-remake.'
]

describe('mode auto — une purge de corbeille attend toujours l’utilisateur', () => {
  it.each(REELLES)('ne part jamais seule : %s', (suite) => {
    const arret = { action: 'arreter', raison: 'suite-attend-utilisateur' }
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaRecommandation(suite)).toMatchObject(arret)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  it.each([
    'Oui, purge la corbeille du 16/10',
    'Vas-y, vide la corbeille du 16/10',
    'Lance la purge de la corbeille du 16/10',
    'Vider la corbeille',
    'Supprime gc-corbeille/2026-10-16',
    'Efface définitivement gc-corbeille/2026-10-16'
  ])('sous une autre forme non plus : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
  })

  it('une option de purge écartée ne repart pas par la recommandation', () => {
    const question = {
      role: 'assistant',
      content: 'Corbeille du 16/10',
      parts: [
        { kind: 'text', text: 'Bilan.\n\n👉 Recommandé : Purger `gc-corbeille/2026-10-16`.' },
        {
          kind: 'action',
          name: 'ask',
          ok: true,
          data: {
            question: 'Purger la corbeille du 16/10 ?',
            options: ['Oui, purge gc-corbeille/2026-10-16', 'Non, garde']
          }
        }
      ]
    } as unknown as Msg
    expect(deciderRelanceAuto({ ...base, fil: [humain, question] }).action).not.toBe('envoyer')
  })
})

/*
 * LES RÉPONSES EXACTES DE LA QUESTION DU `/gc` (conv-1341, objection du contrôle final, 2026-10-30).
 *
 * Le refus ci-dessus lisait la suite SEULE et exigeait le mot « corbeille » : « Oui, purge cette fois »,
 * que `skills/gc/SKILL.md` venait d'introduire, partait donc seule, comme « Purge both », texte réel de
 * la question du 28/10 (conv-1047, message 11). Ces phrases n'ont de sens que par la réponse qui les
 * entoure, d'où les deux contextes réels ci-dessous : la rubrique de la passe et la question ouverte.
 */
const passeGc = (suite: string): string =>
  `## À purger\n- corbeille du 16/10 (6,1 Mo)\n\n**👉 Recommandé**\n${suite}\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`

const avecQuestion = (texte: string, options: string[]): Msg =>
  ({
    role: 'assistant',
    content: texte,
    parts: [
      { kind: 'text', text: texte },
      {
        kind: 'action',
        name: 'ask',
        ok: true,
        data: { question: 'Que fait-on ?', options }
      }
    ]
  }) as unknown as Msg

const OPTIONS_DU_GC = ['Oui, purge cette fois', 'Oui, purge et vide seul à l’avenir', 'Non, garde']
const arret = { action: 'arreter', raison: 'suite-attend-utilisateur' }

describe('mode auto — les réponses de la question de purge attendent l’utilisateur', () => {
  it.each([
    'Oui, purge cette fois',
    'Oui, purge et vide seul à l’avenir',
    'Purge cette fois',
    'Vide seul à l’avenir',
    'Active la purge automatique',
    'Relance le script avec --cette-fois',
    'Purge --cette-fois',
    '`node --no-warnings scripts/gc-purger-corbeilles.mjs --racine D:/x/.autowin-data/gc-corbeille --cette-fois`',
    'node --no-warnings scripts/gc-purger-corbeilles.mjs --racine D:/x/.autowin-data/gc-corbeille --cette-fois',
    'Écris {"enabled": true} dans gc-purge-auto.json',
    'Crée .autowin-data/autowin-os/gc-purge-auto.json',
    'Ajoute {"enabled": true} à gc-purge-auto.json'
  ])('la phrase seule suffit à arrêter : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  // Lues dans la consigne elle-même : une reformulation de la question ne doit pas rouvrir la porte.
  it('les réponses « oui » écrites dans skills/gc/SKILL.md s’arrêtent toutes', () => {
    const consigne = readFileSync(join(process.cwd(), 'skills/gc/SKILL.md'), 'utf8')
    const reponses = /avec exactement\s+ces réponses :([^.]*)\./u.exec(consigne)?.[1] ?? ''
    const oui = [...reponses.matchAll(/«\s*(Oui[^»]*?)\s*»/gu)].map((m) => m[1])
    expect(oui.length).toBeGreaterThanOrEqual(2)
    for (const reponse of oui) expect(suiteAttendUneDonneeUtilisateur(reponse), reponse).toBe(true)
  })

  const PROPRES_A_LA_REPONSE = [
    'Purge both',
    'Purge both folders, but first move the 21/09 copy to `.autowin-data/sauvegardes/`. That frees **58.6 MB**.',
    'Purge both, but first move conversations.json.pre-remake from 21/09 to .autowin-data/sauvegardes/ (58.6 MB freed)',
    'Purge tout sauf la copie du 21/09',
    'Purge tout sans la copie du 21/09',
    'Supprime les deux dossiers',
    'Vide les deux',
    'Oui',
    'Oui, vas-y',
    'Go ahead'
  ]

  it.each(PROPRES_A_LA_REPONSE)('une passe /gc, sans question : %s', (suite) => {
    expect(decider(passeGc(suite))).toMatchObject(arret)
  })

  it.each(PROPRES_A_LA_REPONSE)('une question de purge ouverte : %s', (suite) => {
    const reponseQuestion = avecQuestion(
      `Bilan.\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`,
      OPTIONS_DU_GC
    )
    expect(deciderRelanceAuto({ ...base, fil: [humain, reponseQuestion] })).toMatchObject(arret)
  })

  it('une suite secondaire ne passe pas la purge à la faveur de la première', () => {
    const texte = `## À purger\n- rien\n\nAUTOWIN_PROMPT_V1: [90] Relis le bilan\nAUTOWIN_PROMPT_V1: [70] Purge both`
    const decision = decider(texte)
    expect(decision).toMatchObject({ action: 'envoyer' })
    expect(decision.action === 'envoyer' ? decision.texte : '').not.toContain('Purge both')
  })
})

describe('mode auto — une question destructrice attend, dans tous les fils', () => {
  it.each([
    ['Oui, supprime les 3 branches vides', 'Supprime les 3 branches vides'],
    ['Oui, supprime les 11 copies vides', 'Oui, vas-y'],
    ['Écraser le fichier de config', 'Relis la config avant de décider']
  ])('la suite ne passe pas devant « %s » : %s', (option, suite) => {
    const reponseQuestion = avecQuestion(`Bilan.\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`, [
      option,
      'Non'
    ])
    expect(deciderRelanceAuto({ ...base, fil: [humain, reponseQuestion] })).toMatchObject(arret)
  })

  it('jumeau accepté : une question sans réponse destructrice part toujours seule', () => {
    const reponseQuestion = avecQuestion('Bilan.\n\nAUTOWIN_PROMPT_V1: [85] Purge le cache', [
      'Garde',
      'Purge le cache'
    ])
    expect(deciderRelanceAuto({ ...base, fil: [humain, reponseQuestion] })).toMatchObject({
      action: 'envoyer',
      texte: expect.stringMatching(/^Garde/)
    })
  })
})

describe('mode auto — ce qui n’est pas une purge de corbeille continue', () => {
  // Un fil qui travaille sur le code de la purge parle de corbeille sans être une passe `/gc`.
  it.each([
    'Supprime ce doublon dans X.ts',
    'Purge le cache du navigateur intégré',
    'Ajoute un test à scripts/gc-purger-corbeilles.mjs',
    'Ajoute un test à l’option --cette-fois',
    'Documente --cette-fois dans la consigne',
    'Relis gc-purge-auto.json',
    'Documente gc-purge-auto.json dans la consigne',
    'Implémente la purge automatique de la corbeille',
    'Oui, vas-y'
  ])('un fil de code sur la corbeille garde son enchaînement : %s', (suite) => {
    const texte = `Le script \`gc-purger-corbeilles.mjs\` purge la corbeille \`gc-corbeille\`.\n\nAUTOWIN_PROMPT_V1: [85] ${suite}`
    expect(decider(texte)).toMatchObject({ action: 'envoyer' })
  })

  // Phrases réelles de la passe du 24/10 (conv-1047, message 5) : le geste n'est pas en tête.
  it.each([
    'Cherche pourquoi la copie %TEMP%\\aw-base-PaV9he\\copie du 23/10 16:10 (src/main/comparaison-a-la-base.ts) n’a pas été effacée par fermer(), puis retire-la proprement',
    'Relis le bilan de la corbeille du 16/10'
  ])('une passe /gc garde ses suites de lecture : %s', (suite) => {
    expect(decider(passeGc(suite))).toMatchObject({ action: 'envoyer' })
  })

  it('jumeau : un verbe d’une autre rubrique que « À purger » ne compte pas', () => {
    const texte = `## À vérifier\n- rien\n\nAUTOWIN_PROMPT_V1: [85] Purge le cache du navigateur intégré`
    expect(decider(texte)).toMatchObject({ action: 'envoyer' })
  })
})

describe('mode auto — ce qui n’est pas une purge de corbeille continue, hors contexte', () => {
  it.each([
    'Supprime ce doublon dans X.ts',
    'Supprime le bouton Corbeille du panneau',
    'Purge le cache du navigateur intégré',
    'Vide le champ de saisie après envoi',
    'Ajoute un test à scripts/gc-purger-corbeilles.mjs',
    'Implémente la purge automatique de la corbeille',
    'Relis le bilan de la corbeille du 16/10'
  ])('part toujours seule : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(false)
    expect(parLaRecommandation(suite)).toMatchObject({ action: 'envoyer' })
    expect(parLaLigneDeSuite(suite)).toMatchObject({ action: 'envoyer' })
  })
})

describe('mode auto — dans une passe /gc, il ne répond pas seul à la question de purge', () => {
  const dansUnePasse = (options: string[]): Msg =>
    avecQuestion('## À purger\n- corbeille du 16/10 (6,1 Mo)', options)
  const repondu = (options: string[]): ReturnType<typeof deciderRelanceAuto> =>
    deciderRelanceAuto({ ...base, fil: [humain, dansUnePasse(options)] })

  // L'option ne porte aucun mot destructeur : c'est la question qui parle de purge.
  it.each([
    [['Oui', 'Non']],
    [['Oui, vas-y', 'Non, garde']],
    // « sans » retire la protection de `estCibleDestructrice` : le verbe en tête la rend ici.
    [['Purge tout sans la copie du 21/09', 'Non']]
  ])('aucune réponse ne part : %j', (options) => {
    expect(reponseAutoAuDernierAsk([humain, dansUnePasse(options)])).toBeNull()
    expect(repondu(options).action).not.toBe('envoyer')
  })

  it('jumeau : hors passe /gc, un « Oui » ordinaire répond toujours seul', () => {
    const question = avecQuestion('Bilan.', ['Oui', 'Non'])
    expect(reponseAutoAuDernierAsk([humain, question])).toBe('Oui')
  })

  it('jumeau : une première réponse sans geste part toujours, même dans une passe', () => {
    expect(reponseAutoAuDernierAsk([humain, dansUnePasse(['Relis le bilan', 'Oui'])])).toBe(
      'Relis le bilan'
    )
  })
})
