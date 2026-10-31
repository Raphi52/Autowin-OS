import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROMPT_NOUVELLE_CIBLE,
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
 * Ce fichier a déjà souffert de règles trop larges (conv-787) : un fil qui supprime autre chose garde
 * son enchaînement, et un fil de code sur la corbeille aussi si sa phrase commence par un verbe de
 * SUITE_DE_TRAVAIL. Sinon il s'arrête (« Teste la purge de la corbeille ») : ça coûte une réponse à la
 * main, et 3 suites réelles sur 7 306 sont dans ce cas (conv-504, 518 et 1279, mesuré le 31/10).
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

const avecQuestion = (texte: string, options: unknown[], choixMultiple = false): Msg =>
  ({
    role: 'assistant',
    content: texte,
    parts: [
      { kind: 'text', text: texte },
      {
        kind: 'action',
        name: 'ask',
        ok: true,
        data: { question: 'Que fait-on ?', options, ...(choixMultiple && { choixMultiple }) }
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

/*
 * LA RELÈVE DE FIN DE CHAÎNE NE PASSE PAS DEVANT LA QUESTION (conv-1341, 2026-10-30).
 *
 * `skills/gc/SKILL.md` fait finir par `AUTOWIN_FIN_V1` la passe qui pose la question de purge. Le mode
 * auto n'y répondait pas, puis, le fil affiché étant « fini », il envoyait la relève : un tour payant
 * par-dessus la question, mesuré `envoyer` au nettoyage. Toutes les portes de fin de chaîne sont jouées :
 * chacune mène au même envoi.
 */
describe('mode auto — une question destructrice arrête aussi la fin de chaîne', () => {
  const affiche = { ...base, proposerNouvelleCible: true }
  const FINS: [string, string][] = [
    ['fin explicite', '## À purger\n- corbeille du 16/10 (6,1 Mo)\n\nAUTOWIN_FIN_V1'],
    ['recommandation « rien »', 'Bilan.\n\n👉 Recommandé — rien'],
    ['bloc « Fait » vide', '✅ Fait\nrien\n\n👉 Recommandé : rien'],
    ['reste à faire « rien »', 'Bilan.\n\n⏳ Reste à faire : rien']
  ]

  it.each(FINS)('%s : la relève ne part pas, le fil affiché dit pourquoi', (_nom, texte) => {
    const fil = [humain, avecQuestion(texte, OPTIONS_DU_GC)]
    expect(reponseAutoAuDernierAsk(fil)).toBeNull()
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject(arret)
  })

  it('une question destructrice hors passe /gc arrête de même', () => {
    const fil = [
      humain,
      avecQuestion('Bilan.\n\nAUTOWIN_FIN_V1', ['Oui, supprime la branche', 'Non'])
    ]
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject(arret)
  })

  it('jumeau : sans question, la fin de chaîne envoie toujours sa relève', () => {
    const fil = [humain, reponse('## À purger\n- rien\n\nAUTOWIN_FIN_V1')]
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject({
      action: 'envoyer',
      texte: PROMPT_NOUVELLE_CIBLE
    })
  })

  it('jumeau : une question sans réponse destructrice répond toujours seule', () => {
    const fil = [
      humain,
      avecQuestion('Bilan.\n\nAUTOWIN_FIN_V1', ['Ajoute les tests', 'Documente'])
    ]
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject({
      action: 'envoyer',
      texte: expect.stringMatching(/^Ajoute les tests/)
    })
  })

  it('jumeau : un fil d’arrière-plan garde sa raison de fin de chaîne', () => {
    const fil = [humain, avecQuestion('Bilan.\n\nAUTOWIN_FIN_V1', OPTIONS_DU_GC)]
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({
      action: 'arreter',
      raison: 'fin-explicite'
    })
  })

  it('jumeau : une relève déjà faite dans la série laisse le mode allumé', () => {
    const fil = [
      humain,
      { role: 'user', content: PROMPT_NOUVELLE_CIBLE } as Msg,
      avecQuestion('Bilan.\n\nAUTOWIN_FIN_V1', OPTIONS_DU_GC)
    ]
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject({
      action: 'attendre',
      raison: 'chaine-finie'
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

/*
 * LE REFUS NE TIENT PLUS À UNE LISTE DE DÉBUTS DE PHRASE (conv-1341, objection du contrôle final,
 * 2026-10-31). Les phrases ci-dessous sont celles que le contrôle a fait partir seules dans le vrai
 * `deciderRelanceAuto`, plus leurs voisines : le geste n'est pas en tête, ou rien n'est nommé.
 */
const SANS_LE_GESTE_EN_TETE = [
  'Relance la purge de la corbeille du 16/10',
  'Confirme la purge de la corbeille du 16/10',
  'Procède à la purge de la corbeille du 16/10',
  'OK pour purger la corbeille du 16/10',
  'Continue : purge la corbeille du 16/10',
  'Il faut purger la corbeille du 16/10',
  'Vérifie la corbeille du 16/10 puis purge-la',
  'Relis le bilan, puis vide la corbeille du 16/10',
  'Lis le bilan avant de vider la corbeille',
  'Utilise --cette-fois',
  'Passe gc-purge-auto.json à true',
  'Remets enabled à true dans gc-purge-auto.json',
  'Ajoute enabled à gc-purge-auto.json',
  // Une corbeille datée est une cible précise : sans travail annoncé, le verbe ne compte pas.
  'Jette la corbeille du 16/10',
  'Nettoie la corbeille du 16/10',
  'Retire la corbeille du 16/10',
  'Déplace gc-corbeille/2026-10-16 hors du dépôt',
  'Clear the trash'
]

describe('mode auto — le geste de purge s’arrête où qu’il soit dans la phrase', () => {
  it.each(SANS_LE_GESTE_EN_TETE)('hors passe /gc : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  it.each([
    ...SANS_LE_GESTE_EN_TETE,
    'Il faut purger les deux',
    'Oui, cette fois',
    'Cette fois seulement',
    'Retire les deux',
    'Jette les deux dossiers',
    'Proceed',
    'Yes please',
    'Je confirme',
    'Non, garde',
    'Regarde si tu peux purger les deux',
    'Relis le bilan, puis rm -rf le dossier',
    'Relis le bilan, puis retire les deux',
    'Cherche pourquoi la corbeille a grossi, puis jette les deux'
  ])('dans une passe /gc : %s', (suite) => {
    expect(decider(passeGc(suite))).toMatchObject(arret)
  })

  // Le travail sur le code et la lecture gardent leur enchaînement : c'est le jumeau de chaque refus.
  it.each([
    'Vérifie que la purge de la corbeille a marché',
    'Cherche pourquoi la corbeille du 16/10 n’a pas été purgée',
    'Corrige la purge de la corbeille',
    'Documente la purge de la corbeille et ajoute un test',
    'Retire le bouton Corbeille du panneau',
    'Relis le bilan de la corbeille du 16/10',
    'Ajoute un test à la purge de la corbeille, puis documente-la',
    'Implémente la purge de la corbeille, puis ajoute un test de la purge',
    'Supprime gc-purge-auto.json',
    'Retire gc-purge-auto.json'
  ])('jumeau hors passe, part toujours : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(false)
    expect(parLaLigneDeSuite(suite)).toMatchObject({ action: 'envoyer' })
  })

  it.each([
    'Compare les tailles des deux corbeilles',
    'Liste les fichiers de la corbeille du 16/10',
    'Cherche pourquoi la corbeille du 16/10 n’a pas été purgée',
    'Corrige le test qui laisse des dossiers temporaires',
    'Check the 16/10 folder',
    'Vérifie que la place a été libérée'
  ])('jumeau dans une passe /gc, part toujours : %s', (suite) => {
    expect(decider(passeGc(suite))).toMatchObject({ action: 'envoyer' })
  })
})

/*
 * TOUTE LA FAMILLE DU GESTE, PAS LA PHRASE CITÉE (conv-1341, 2026-10-31). Une sonde sur 285 formes en a
 * fait partir 96 seules : « Jeter la corbeille », mais surtout « Supprime la corbeille », « Efface la
 * corbeille », « Delete the trash » : aucun verbe de suppression n'était lu hors de `gc-corbeille`, pour
 * épargner « Supprime le bouton Corbeille ». Le contrôle retrouvait chaque fois la variante d'à côté :
 * ce test croise les formes et les cibles au lieu d'ajouter un exemple de plus.
 */
const FORMES_DU_GESTE = [
  ...['Purge', 'Purger', 'Purgez', 'Purgeons', 'Il faut purger', 'Je vais purger'],
  ...['Vide', 'Vider', 'Videz', 'Vidons', 'Il faut vider', 'On vide'],
  ...['Jette', 'Jeter', 'Jetez', 'Jetons', 'Il faut jeter', 'Je vais jeter'],
  ...['Nettoie', 'Nettoyer', 'Nettoyez', 'Nettoyons', 'Il faut nettoyer'],
  ...['Supprime', 'Supprimer', 'Supprimez', 'Supprimons', 'Il faut supprimer', 'Je vais supprimer'],
  ...['Efface', 'Effacer', 'Effacez', 'Effaçons', 'Il faut effacer'],
  ...['Détruis', 'Détruire', 'Détruisez', 'Il faut détruire'],
  ...['Enlève', 'Enlever', 'Élimine', 'Dégage', 'Vire', 'Débarrasse-toi de'],
  ...['Retire', 'Retirer', 'Il faut retirer'],
  ...['Delete', 'Remove', 'Wipe', 'Erase', 'Destroy', 'Empty', 'Clear', 'Clean', 'Purge']
]
const CIBLES_DU_GESTE = [
  'la corbeille',
  'les corbeilles de plus de 14 jours',
  'les 8 corbeilles gc',
  'la corbeille du 16/10',
  'the trash',
  // Ici seule la corbeille est un lieu : c'est le verbe qui arrête, chacun doit donc être connu.
  'les fichiers dans la corbeille'
]
const FAMILLE_DU_GESTE = FORMES_DU_GESTE.flatMap((forme) =>
  CIBLES_DU_GESTE.map((cible) => `${forme} ${cible}`)
)

describe('mode auto — toutes les formes du geste s’arrêtent, sur toutes les cibles', () => {
  it.each(FAMILLE_DU_GESTE)('%s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  it.each([
    'La corbeille est à supprimer',
    'Les corbeilles de plus de 14 jours sont à retirer',
    'Retire le dossier de la corbeille',
    'Vérifie la corbeille puis supprime-la',
    'Vérifie les corbeilles puis retire-les',
    'Supprime le bouton Corbeille puis efface la corbeille',
    'Supprime le doublon, puis jeter la corbeille',
    'Supprime les fichiers dans la corbeille',
    // Aucun verbe connu : c'est la corbeille visée qui arrête, pas une liste de plus.
    'La corbeille doit être vidée',
    'Fais disparaître la corbeille',
    'Fais le ménage dans la corbeille',
    'Déplace la corbeille hors du disque',
    'Libère la place prise par la corbeille',
    'Ouvre la corbeille du 16/10'
  ])('la cible n’est pas juste après le verbe : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  it.each([
    'Relis le bilan, puis enlève les deux',
    'Relis le bilan, puis débarrasse-toi des deux',
    'Relis le bilan, puis élimine les deux',
    'Compare les tailles, puis vire les deux',
    'Relis le bilan, puis fais le ménage',
    'Compare les tailles, puis libère la place',
    'Relis le bilan, puis fais disparaître les deux'
  ])('dans une passe /gc, un autre verbe de retrait s’arrête aussi : %s', (suite) => {
    expect(decider(passeGc(suite))).toMatchObject(arret)
  })

  // Le jumeau de chaque refus : une corbeille qui n'est qu'un mot de l'interface ou du code.
  it.each([
    'Supprime le bouton Corbeille du panneau',
    'Retire le bouton Corbeille du panneau',
    'Retire l’icône de la corbeille',
    'Supprime le libellé Corbeille',
    'Efface le commentaire sur la corbeille',
    'Supprime le test de la corbeille',
    'Remove the trash icon',
    'Supprime le doublon, puis vérifie la corbeille',
    'Efface le cache, puis relis le bilan de la corbeille',
    'Vérifie que la corbeille a été supprimée',
    'Supprime les jetons expirés',
    'Supprime ce doublon dans X.ts',
    // Tirées de suites réelles (conv-504, 518, 743, 1279, 1167), parfois abrégées : la corbeille y est
    // un lieu ou une destination.
    'Déplace les 13 brouillons de la racine dans un dossier .corbeille/ plutôt que de les supprimer.',
    'Dis-moi ce qu’est page.html à la racine et s’il faut l’exclure, le déplacer dans .corbeille ou le garder.',
    'Montre-moi le bilan /gc de ce matin et confirme que prompt-observability a été mis en corbeille',
    'Relis les fils des parties 1 à 4 de la V1 et ses fichiers dans la corbeille, sans les restaurer, puis résume-moi la V1 plan par plan.',
    'Envoie aussi à la Corbeille %LOCALAPPDATA%/AncienOutil et %LOCALAPPDATA%/AutreOutil.'
  ])('jumeau, part toujours : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(false)
    expect(parLaLigneDeSuite(suite)).toMatchObject({ action: 'envoyer' })
  })
})

/*
 * RETIRER L'ACCORD SE LIT PAR CLAUSE (conv-1341, 2026-10-31). La règle regardait le début de toute la
 * phrase : « Supprime le bouton, puis crée gc-purge-auto.json » passait pour un retrait de l'accord,
 * alors qu'elle en pose un.
 */
describe('mode auto — poser l’accord après un autre retrait s’arrête', () => {
  it.each([
    'Supprime le bouton, puis crée gc-purge-auto.json',
    'Supprime le bouton puis crée gc-purge-auto.json',
    'Retire le bouton et ajoute enabled à gc-purge-auto.json',
    'Retire le bouton, puis écris {"enabled": true} dans gc-purge-auto.json',
    'Supprime le bouton puis passe gc-purge-auto.json à true',
    'Efface le cache ; pose gc-purge-auto.json',
    'Désactive le mode sombre et crée gc-purge-auto.json',
    'Supprime gc-purge-auto.json puis recrée gc-purge-auto.json',
    'Supprime gc-purge-auto.json puis recrée-le avec enabled à true',
    'Supprime le bouton pour créer gc-purge-auto.json'
  ])('%s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
  })

  it.each([
    'Supprime gc-purge-auto.json',
    'Supprime le fichier gc-purge-auto.json',
    'Retire gc-purge-auto.json du dépôt',
    'Retire enabled de gc-purge-auto.json',
    'Remove gc-purge-auto.json',
    'Supprime gc-purge-auto.json, puis relance le /gc',
    'Supprime le bouton, puis vérifie gc-purge-auto.json',
    'Retire le bouton, puis documente gc-purge-auto.json',
    'Passe enabled à true dans settings.json'
  ])('jumeau, part toujours : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(false)
    expect(parLaLigneDeSuite(suite)).toMatchObject({ action: 'envoyer' })
  })
})

/*
 * LA CIBLE NE SE PERD PLUS À LA VIRGULE (conv-1341, contrôle final du 31/10). Chaque clause était jugée
 * seule : « Vérifie la corbeille, puis fais-la disparaître » ouvre par un travail, et sa seconde clause
 * n'a plus de cible à lire. Ces phrases partaient seules. Celles qui n'ont pas de pronom (« puis fais de
 * la place ») montrent pourquoi la règle ne liste pas les pronoms : après la cible, seul un travail
 * annoncé continue.
 */
const CIBLE_PUIS_GESTE = [
  'Vérifie la corbeille, puis fais-la disparaître',
  'Regarde la corbeille, puis libère-la',
  'Vérifie la corbeille, puis débarrasse-toi-en',
  'Vérifie la corbeille et fais-la disparaître',
  'Vérifie les corbeilles puis fais-les disparaître',
  'Compare les corbeilles, puis fais-en table rase',
  'Relis la corbeille du 16/10, puis la faire disparaître',
  'Liste gc-corbeille/2026-10-16 ; supprime-le',
  'Check the trash, then get rid of it',
  'Regarde la corbeille, puis libère la place',
  'Vérifie la corbeille du 16/10, puis fais de la place',
  'Relis gc-purge-auto.json, puis crée-le',
  'Vérifie gc-purge-auto.json puis active-le',
  'Relis gc-purge-auto.json et pose-le',
  'Read gc-purge-auto.json then create it',
  'Relis gc-purge-auto.json, puis autorise la purge',
  'Supprime gc-purge-auto.json puis recrée-le',
  'Supprime gc-purge-auto.json, puis remets-le',
  'Relis la doc de --cette-fois, puis lance-la',
  'Documente --cette-fois, puis utilise-la',
  // « pour » et « avant de » annoncent le même geste qu'un « puis ».
  'Vérifie la corbeille pour la vider',
  'Vérifie la corbeille pour l’effacer',
  'Vérifie la corbeille afin de la vider',
  'Vérifie la corbeille pour la faire disparaître',
  'Vérifie la corbeille avant de la faire disparaître',
  'Relis le bilan pour purger la corbeille',
  'Relis gc-purge-auto.json pour le créer',
  // Une parenthèse ou un tiret ouvrent une clause comme une virgule.
  'Vérifie la corbeille (et vide-la)',
  'Vérifie la corbeille — vide-la ensuite',
  'Vérifie la corbeille – vide-la ensuite',
  'Relis gc-purge-auto.json (crée-le si besoin)',
  // Le fichier se désigne aussi en toutes lettres.
  'Relis le bilan, puis crée le fichier d’accord',
  // Citer le `/gc` ne suffit pas : seul le relancer ne pose aucun accord.
  'Pose gc-purge-auto.json avec /gc',
  // La corbeille n'est qu'un lieu : seul le pronom renvoie à ce qu'elle contient.
  'Relis les fichiers dans la corbeille, puis fais-les disparaître',
  'Regarde ce qu’il y a dans la corbeille, puis supprime-les',
  'Relis les fichiers dans la corbeille, puis vas-y',
  'Relis le fichier dans la corbeille, puis déplace-le',
  'Relis la copie dans la corbeille, puis déplace-la',
  'Regarde dans la corbeille, puis fais-en table rase',
  'Look in the trash, then delete it',
  'Relis les fichiers dans la corbeille, puis libère la place',
  'Regarde dans la corbeille, puis les faire disparaître',
  'Look in the trash, then delete them'
]

// Le contrôle retrouvait chaque fois la variante d'à côté : mêmes ouvertures, toutes les reprises.
const OUVERTURES = [
  'Vérifie la corbeille',
  'Regarde la corbeille du 16/10',
  'Liste gc-corbeille/2026-10-16',
  'Compare les deux corbeilles',
  'Check the trash',
  'Relis gc-purge-auto.json',
  'Vérifie gc-purge-auto.json',
  'Documente --cette-fois'
]
const REPRISES = [
  ', puis fais-la disparaître',
  ' puis libère-la',
  ' et pose-le',
  ' ; lance-le',
  ', ensuite active-le',
  ' then do it',
  ' avant de la faire disparaître'
]
const CROISEMENT = OUVERTURES.flatMap((debut) => REPRISES.map((fin) => `${debut}${fin}`))

describe('mode auto — après la cible, seul un travail annoncé continue', () => {
  it.each(CIBLE_PUIS_GESTE)('hors passe /gc : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
    expect(parLaLigneDeSuite(suite)).toMatchObject(arret)
    expect(parLaRecommandation(suite)).toMatchObject(arret)
  })

  it.each(CIBLE_PUIS_GESTE)('dans une passe /gc : %s', (suite) => {
    expect(decider(passeGc(suite))).toMatchObject(arret)
  })

  it.each(CROISEMENT)('toutes les reprises : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(true)
  })

  // Jumeaux : la même phrase, mais la seconde clause lit, corrige ou retire l'accord.
  it.each([
    'Vérifie la corbeille, puis relis-la',
    'Vérifie la corbeille, puis regarde-la',
    'Vérifie la corbeille, puis résume-la',
    'Compare les deux corbeilles, puis résume',
    'Relis la corbeille du 16/10, puis liste ce qu’elle contient',
    'Ajoute un test à la purge de la corbeille, puis documente-la',
    'Vérifie la corbeille du 16/10.',
    'Vérifie la corbeille du 16/10 :',
    'Vérifie la corbeille sans la vider',
    'Vérifie la corbeille pour savoir ce qui reste',
    'Vérifie la corbeille pour comprendre ce qui reste',
    'Vérifie la corbeille pour voir ce qui reste',
    'Vérifie la corbeille pour confirmer ce qui reste',
    'Vérifie la corbeille, puis dis-moi ce qu’il reste',
    'Vérifie que la place a été libérée',
    'Libère le verrou du fichier',
    'Vérifie la corbeille, ensuite relis-la',
    'Check the trash, then read it',
    'Cherche dans la corbeille, puis dis-le-moi',
    'Ajoute un test pour supprimer le cache',
    // Pas de corbeille visée : « puis » garde son sens ordinaire.
    'Vérifie le bouton Corbeille, puis supprime-le',
    'Cherche ce qui part dans la corbeille, puis corrige le filtre',
    'Relis la doc, puis supprime-la',
    'Relis le bilan, puis publie-le',
    // Le fichier d'accord : le lire, le documenter ou le retirer ne pose rien.
    'Relis le fichier d’accord',
    'Supprime le fichier d’accord',
    'Relis gc-purge-auto.json, puis supprime-le',
    'Vérifie gc-purge-auto.json, puis désactive-le',
    'Relis gc-purge-auto.json, puis documente-le',
    'Relis la doc, puis supprime gc-purge-auto.json',
    'Supprime gc-purge-auto.json, puis relance le /gc',
    'Ajoute un test à l’option --cette-fois, puis documente-la'
  ])('jumeau, part toujours : %s', (suite) => {
    expect(suiteAttendUneDonneeUtilisateur(suite)).toBe(false)
    expect(parLaLigneDeSuite(suite)).toMatchObject({ action: 'envoyer' })
  })
})

/*
 * skills/gc/SKILL.md promet que le mode auto ne répond jamais à la question de purge. C'était faux dès
 * que « Non, garde » était recommandée, ou la question à choix multiple : il envoyait « Non, garde »
 * (objection du contrôle final, 2026-10-31). Rien n'était purgé, mais il tranchait à la place de
 * l'utilisateur. Les deux contextes sont joués : la rubrique de la passe, et la question seule.
 */
describe('mode auto — il ne répond jamais à la question de purge, pas même « Non, garde »', () => {
  const recommandeNon = [
    { libelle: 'Oui, purge cette fois' },
    { libelle: 'Oui, purge et vide seul à l’avenir' },
    { libelle: 'Non, garde', recommande: true }
  ]
  const CONTEXTES = ['## À purger\n- corbeille du 16/10 (6,1 Mo)\n\nAUTOWIN_FIN_V1', 'Bilan.']

  // Sans suite proposée, le mode reste armé et attend : ce qui compte est qu'aucun tour ne parte.
  const rienNePart = (fil: Msg[]): boolean =>
    ['arreter', 'attendre'].includes(
      deciderRelanceAuto({ ...base, proposerNouvelleCible: true, fil }).action
    )

  it.each(CONTEXTES)('« Non, garde » recommandée n’est pas envoyée : %j', (texte) => {
    const fil = [humain, avecQuestion(texte, recommandeNon)]
    expect(reponseAutoAuDernierAsk(fil)).toBeNull()
    expect(rienNePart(fil)).toBe(true)
  })

  it.each(CONTEXTES)('à choix multiple, rien n’est coché seul : %j', (texte) => {
    const fil = [humain, avecQuestion(texte, OPTIONS_DU_GC, true)]
    expect(reponseAutoAuDernierAsk(fil)).toBeNull()
    expect(rienNePart(fil)).toBe(true)
  })

  it('jumeau : hors de cette question, une réponse « Non » recommandée part toujours', () => {
    const fil = [
      humain,
      avecQuestion('Bilan.', [
        { libelle: 'Oui, publie' },
        { libelle: 'Non, garde', recommande: true }
      ])
    ]
    expect(reponseAutoAuDernierAsk(fil)).toBe('Non, garde')
  })
})
