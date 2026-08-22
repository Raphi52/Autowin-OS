import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot } from './agent-pilot'
import { exigeCorrigerEtPoursuivre, exigeDireLEchec } from './chat-turn-messages'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * UNE ACTION EN ERREUR EST CAPTEE EN COURS DE TOUR, ET CORRIGEE AVANT LA FIN.
 *
 * Demande de l'utilisateur le 2026-08-22. La machinerie existait deja et etait armee pour le chat
 * (`index.ts`, litteral `true`) : ce qui manquait, ce sont deux trous mesures par sonde.
 *
 * T1 — la reprise qui REND la main aux commandes ne regardait que l'echec de la DERNIERE iteration,
 * remis a plat a chaque tour de boucle. Un echec enjambe a l'iteration 2 ne pouvait plus etre
 * corrige a l'iteration 7 : il tombait dans l'aveu d'echec, qui reformule « SANS aucune commande ».
 * Capte, donc — mais explicitement NON corrige, l'ecart exact que cette demande vise.
 *
 * T2 — l'aveu d'echec testait la simple PRESENCE d'un mot. « tous les tests passent sans erreur »
 * contient « erreur » : la garde se desarmait sur une NEGATION, et une action reellement plantee
 * cloturait le tour sans etre ni corrigee ni avouee.
 */
describe('une negation ne desarme plus l aveu d echec', () => {
  it('« sans erreur » pose sur un echec reel declenche la garde', () => {
    expect(exigeDireLEchec(true, '✅ Fait — la suite est verte, tous les tests passent sans erreur.')).toBe(
      true
    )
  })

  it('« aucune erreur » non plus', () => {
    expect(exigeDireLEchec(true, 'Termine, aucune erreur rencontree.')).toBe(true)
  })

  it('« 0 erreur » non plus', () => {
    expect(exigeDireLEchec(true, 'Build termine : 0 erreur, 0 warning.')).toBe(true)
  })

  it('une phrase qui NOMME vraiment l echec desarme toujours la garde', () => {
    // La contrepartie : on ne doit pas harceler un agent qui a fait son travail d honnetete.
    expect(exigeDireLEchec(true, "L edition a echoue : le chemin est introuvable.")).toBe(false)
  })

  it('nommer l echec ET nier ailleurs desarme quand meme : le retrait est chirurgical', () => {
    expect(
      exigeDireLEchec(true, "L edition a echoue. En revanche la suite passe sans erreur.")
    ).toBe(false)
  })

  it('sans echec reel, la garde reste muette quoi qu il soit ecrit', () => {
    expect(exigeDireLEchec(false, '✅ Fait — sans erreur.')).toBe(false)
  })
})

/**
 * LE COMPORTEMENT, pas le predicat. `exigeCorrigerEtPoursuivre` est une fonction pure d'un booleen :
 * le defaut T1 vivait au SITE D'APPEL, dans ce qu'on lui passait. Un test sur le predicat seul serait
 * tautologique — il l'etait dans ma premiere version, et n'aurait rien garde.
 */
function pilot(reponses: string[], echoue: (nom: string, appel: number) => boolean) {
  const sent: string[] = []
  let appels = 0
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: reponses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [
      { name: 'edit_file', args: {}, description: 'edite' },
      { name: 'get_state', args: {}, description: 'etat' }
    ]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async (nom: string) => {
      appels += 1
      return echoue(nom, appels)
        ? { ok: false, error: 'ENOENT: le chemin cible n existe pas' }
        : { ok: true, data: { ok: true } }
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent, bus }
}

const MARQUEUR = 'ta dernière action a ÉCHOUÉ et tu t’arrêtes sur ce constat'
const history: Message[] = [{ role: 'user', content: 'corrige le fichier de config' }]
const SOIGNEE = true

let racine = ''
beforeEach(() => {
  // Le registre des murs PERSISTE sur disque : sans racine temporaire ces tours ecriraient dans
  // l'APPDATA reel et se liraient les uns les autres.
  racine = mkdtempSync(join(tmpdir(), 'erreur-captee-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

const lancer = (p: AgentPilot): Promise<void> =>
  p.chat(history, () => {}, undefined, 8, 'conv-T1', undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)

describe('un echec ANCIEN et jamais repare est corrige avant la fin du tour', () => {
  it('un echec enjambe a l iteration 1 declenche encore la reprise qui rend la main aux commandes', async () => {
    // `edit_file` plante, l'agent l'ENJAMBE et fait autre chose qui reussit, puis conclut « Fait ».
    // L'echec n'a jamais ete repare : le tour ne doit pas se clore dessus.
    const { pilot: p, sent, bus } = pilot(
      [
        'Je corrige.<cmd>{"name":"edit_file","args":{}}</cmd>',
        'Je regarde autre chose.<cmd>{"name":"get_state","args":{}}</cmd>',
        '✅ Fait — config corrigee.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : commit.',
        'Chemin corrige.<cmd>{"name":"edit_file","args":{}}</cmd>',
        '✅ Fait — config reellement corrigee.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : commit.'
      ],
      (nom, appel) => nom === 'edit_file' && appel === 1
    )
    await lancer(p)
    const relance = sent.find((c) => c.includes(MARQUEUR))
    expect(relance, 'un echec non repare doit relancer, meme ancien').toBeDefined()
    // LE point : la reprise REND la main aux commandes, au lieu du seul aveu.
    expect(relance).toContain('ÉMETTRE DES COMMANDES')
    // Et le travail a REELLEMENT reprise : `edit_file` a ete rejoue.
    expect(bus.exec.mock.calls.filter((c) => c[0] === 'edit_file').length).toBe(2)
  })

  it('un echec RATTRAPE par un succes de la meme commande ne relance RIEN', async () => {
    // Le discriminant a preserver : generaliser ne doit pas noyer le cas deja correct.
    const { pilot: p, sent } = pilot(
      [
        'Je corrige.<cmd>{"name":"edit_file","args":{}}</cmd>',
        'Echec vu, je reprends.<cmd>{"name":"edit_file","args":{}}</cmd>',
        '✅ Fait — reprise aboutie.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
      ],
      (nom, appel) => nom === 'edit_file' && appel === 1
    )
    await lancer(p)
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(false)
  })
})

/**
 * LA NEGATION EST UNE CLASSE, PAS UNE LISTE DE COUPLES.
 *
 * Trois juges externes ont mesure la meme faille le 2026-08-22, sur la version qui enumerait des
 * paires « quantifieur + substantif » : « rien n'a echoue », « aucun refus », « pas eu d'erreur »,
 * « rien d'impossible », « l'edition n'a pas echoue » traversaient tous la garde. Le mot d'echec
 * restait dans le texte, donc il etait lu comme un AVEU alors qu'il etait un DENI.
 *
 * Ma DoD annoncait « 3 negations couvertes » : litteralement vrai, fonctionnellement trompeur — trois
 * formes choisies DANS la classe, pas la classe. Ces cas sont la classe.
 */
describe('toute tournure qui NIE un echec declenche la garde', () => {
  const DENIS = [
    "Rien n'a échoué durant ce tour.",
    "L'édition n'a pas échoué, tout est en ordre.",
    'Fait — aucun refus.',
    "Fait — pas eu d'erreur.",
    "Fait — rien d'impossible.",
    'Sans erreur, tout est vert.',
    'Aucune erreur rencontrée.',
    'Build terminé : 0 erreur, 0 warning.',
    "Il n'y a pas d'échec à signaler ici.",
    'Sans aucun souci particulier, tout roule.'
  ]
  for (const deni of DENIS) {
    it(`nie sans avouer : ${deni}`, () => {
      expect(exigeDireLEchec(true, deni)).toBe(true)
    })
  }

  const AVEUX = [
    "L'édition a échoué : le chemin est introuvable.",
    "je n'ai pas pu corriger, l'édition a échoué",
    'La suppression a été refusée par le système.',
    'Le patch a échoué, la ligne visée est impossible à localiser.',
    'Le build est bloqué sur une dépendance.'
  ]
  for (const aveu of AVEUX) {
    it(`avoue vraiment, on ne le harcele pas : ${aveu}`, () => {
      expect(exigeDireLEchec(true, aveu)).toBe(false)
    })
  }

  it('la fenetre reste BORNEE : un aveu eloigne d un negateur survit', () => {
    // « je n'ai pas pu corriger, l'edition a echoue » — le negateur `pas` est loin du mot d'echec.
    // Une fenetre large retirerait cet aveu et harcelerait un agent honnete.
    expect(exigeDireLEchec(true, "je n'ai pas pu corriger, l'édition a échoué")).toBe(false)
  })

  it('la regex globale reutilisee ne derive pas entre appels', () => {
    // `NEGATIONS_DECHEC` porte le drapeau /g et vit au niveau module : un juge a soupconne une derive
    // de `lastIndex` entre deux appels. `String.replace` le remet a zero — mesure, pas croyance.
    const texte = 'Fait — aucune erreur.'
    expect([
      exigeDireLEchec(true, texte),
      exigeDireLEchec(true, texte),
      exigeDireLEchec(true, texte)
    ]).toEqual([true, true, true])
  })
})

describe('« impossible » ne desarme plus la reprise par sa seule presence', () => {
  it('un echec DECRIT avec le mot impossible arme encore la reprise', () => {
    // Mesure du 2026-08-22 : cette phrase desarmait les DEUX gardes — la reprise (le mot satisfaisait
    // `declareHorsDePortee`) et l'aveu (il satisfaisait la detection d'aveu). L'echec finissait
    // CONSTATE et jamais corrige, ce qui est exactement le mot que la demande visait.
    expect(
      exigeCorrigerEtPoursuivre(true, 'Le patch a échoué, la ligne visée est impossible à localiser.')
    ).toBe(true)
  })

  it('un vrai hors-perimetre desarme toujours', () => {
    expect(
      exigeCorrigerEtPoursuivre(true, "Cette fonctionnalité n'existe pas, je ne peux pas le faire.")
    ).toBe(false)
  })

  it('une tournure performative desarme aussi', () => {
    expect(
      exigeCorrigerEtPoursuivre(true, "Il m'est impossible de continuer sans un accès à la base.")
    ).toBe(false)
  })

  it('une vraie attente humaine desarme toujours', () => {
    expect(
      exigeCorrigerEtPoursuivre(
        true,
        'La suppression a échoué : il me faut ton autorisation pour la prod.'
      )
    ).toBe(false)
  })
})

/**
 * UN SUCCES SUR UNE AUTRE CIBLE NE REPARE PAS L'ECHEC.
 *
 * Defaut mesure le 2026-08-22 par deux juges externes independants : le registre etait clef par NOM
 * de commande seul, si bien qu'un `edit_file` reussi sur `b.ts` purgeait l'echec jamais rejoue sur
 * `a.ts`. Mes deux tests d'origine portaient tous les deux sur la MEME cible — ils ne pouvaient pas
 * voir le trou.
 */
describe('la reparation se juge par CIBLE, pas par nom de commande', () => {
  function pilotCible(reponses: string[], echoue: (chemin: string) => boolean) {
    const sent: string[] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        sent.push(messages.at(-1)?.content ?? '')
        return { text: reponses.shift() ?? '', sessionId: 'sess' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'edit_file', args: {}, description: 'edite' }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async (_nom: string, args: Record<string, unknown>) =>
        echoue(String(args?.path ?? ''))
          ? { ok: false, error: 'ENOENT: le chemin cible n existe pas' }
          : { ok: true, data: { ok: true } }
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
  }

  it('un succes sur b.ts ne fait PAS disparaitre l echec sur a.ts', async () => {
    const { pilot: p, sent } = pilotCible(
      [
        'Je corrige a.<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>',
        'Je fais b.<cmd>{"name":"edit_file","args":{"path":"b.ts"}}</cmd>',
        '✅ Fait — tout est corrige.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : commit.',
        'Je reprends a.<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>',
        '✅ Fait — a.ts corrige.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
      ],
      (chemin) => chemin === 'a.ts'
    )
    await lancer(p)
    expect(
      sent.find((c) => c.includes(MARQUEUR)),
      'un succes sur une AUTRE cible ne repare pas a.ts'
    ).toBeDefined()
  })

  it('une reprise de la MEME cible, contenu corrige, ne relance PAS', async () => {
    // La contrepartie qui borne le correctif : la clef ne retient que les arguments IDENTIFIANTS,
    // donc un second essai sur a.ts avec un contenu different reste la MEME cible — sinon l'agent se
    // ferait relancer alors qu'il vient justement de reparer.
    let essais = 0
    const { pilot: p, sent } = pilotCible(
      [
        'Essai 1.<cmd>{"name":"edit_file","args":{"path":"a.ts","content":"v1"}}</cmd>',
        'Je corrige le contenu.<cmd>{"name":"edit_file","args":{"path":"a.ts","content":"v2"}}</cmd>',
        '✅ Fait — a.ts corrige au second essai.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
      ],
      () => ++essais === 1
    )
    await lancer(p)
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(false)
  })
})
