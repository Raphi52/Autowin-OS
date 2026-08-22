import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * VOIR SON ERREUR, LA CORRIGER, PUIS CONTINUER LA TÂCHE.
 *
 * La garde `exigeDireLEchec` obtenait un aveu honnête mais ordonnait de reformuler « SANS aucune
 * commande » : l'agent constatait proprement son échec et RENDAIT LA MAIN, demande non satisfaite.
 * Ces tests vérifient le comportement, pas la fonction pure : la relance doit RE-AUTORISER les
 * commandes, et le tour doit se terminer sur le travail RÉELLEMENT abouti après reprise.
 *
 * PERIMETRE DE CE FICHIER, dit explicitement apres un audit externe du 2026-08-22 : il garde la
 * relance declenchee par l ECHEC DE LA DERNIERE ITERATION. Il ne garde PAS le registre des echecs
 * NON RATTRAPES (`commandesEnEchecNonRattrape`, echec ancien enjambe, clef par nom+cible)
 * — saboter ce mecanisme laissait ce fichier entierement vert malgre son nom. Il est garde par
 * `erreur-captee-en-cours-de-tour.test.ts`, verifie par sabotage. Deux fichiers, deux mecanismes :
 * le dire vaut mieux que dupliquer la couverture.
 */
function pilot(responses: string[], echecs: number) {
  const sent: string[] = []
  let appels = 0
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => {
      appels += 1
      // Les `echecs` premiers appels plantent ; la reprise, elle, doit aboutir.
      return appels <= echecs
        ? { ok: false, error: 'ENOENT: le chemin ciblé n’existe pas' }
        : { ok: true, data: { ok: true } }
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent, bus }
}

const ask = undefined
const history: Message[] = [{ role: 'user', content: 'corrige le fichier de config' }]
// Les gardes d'experience sont une OPTION (`false` par defaut) : sans ce drapeau, tout est inerte.
const SOIGNEE = true
/*
 * ISOLATION OBLIGATOIRE : le registre des murs PERSISTE sur disque. Sans racine temporaire, ces
 * tours ecriraient dans l'APPDATA reel de l'utilisateur — et se liraient les uns les autres, donc
 * l'escalade tomberait au deuxieme test parce que le premier a laisse son mur. Un harnais qui
 * modifie ce qu'il mesure invalide la mesure.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'murs-corr-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

const MARQUEUR = 'ta dernière action a ÉCHOUÉ et tu t’arrêtes sur ce constat'

describe('après un échec, l’agent CORRIGE et POURSUIT au lieu de s’arrêter', () => {
  it('un tour qui s’arrête sur son échec est relancé AVEC droit d’agir', async () => {
    const { pilot: p, sent, bus } = pilot(
      [
        'Je tente la correction.<cmd>{"name":"get_state","args":{}}</cmd>',
        'La commande a échoué : le chemin est introuvable.',
        'Chemin corrigé.<cmd>{"name":"get_state","args":{}}</cmd>',
        '✅ Fait — config corrigée.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : commit.'
      ],
      1
    )
    await p.chat(history, () => {}, ask, 8, 'conv-A', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)

    const relance = sent.find((c) => c.includes(MARQUEUR))
    expect(relance).toBeDefined()
    // LE point : contrairement à l'aveu d'échec, elle REND la main aux commandes.
    expect(relance).toContain('ÉMETTRE DES COMMANDES')
    expect(relance).toContain('CAUSE')
    // Et la tâche a réellement repris : une seconde commande a bien été exécutée.
    expect(bus.exec.mock.calls.length).toBe(2)
  })

  it('un échec RATTRAPÉ tout seul ne déclenche AUCUNE relance', async () => {
    // Le discriminant : sans le suivi par itération, `anyActionFailed` resterait vrai et la garde
    // harcèlerait un tour qui s'est déjà corrigé — exactement le comportement à encourager.
    const { pilot: p, sent } = pilot(
      [
        'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
        'Échec vu, je reprends.<cmd>{"name":"get_state","args":{}}</cmd>',
        '✅ Fait — la reprise a échoué puis abouti.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
      ],
      1
    )
    await p.chat(history, () => {}, ask, 8, 'conv-A', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(false)
  })

  it('un mur qui appartient VRAIMENT à l’humain n’est pas relancé', async () => {
    const { pilot: p, sent } = pilot(
      [
        'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
        'La suppression a échoué : il me faut ton autorisation pour toucher la prod.'
      ],
      1
    )
    await p.chat(history, () => {}, ask, 8, 'conv-A', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(false)
  })
})

describe('auto-kaizen en cours de tour : le MÊME mur deux fois change la consigne', () => {
  it('rejouer la même erreur déclenche l’ESCALADE, pas la même consigne', async () => {
    // Deux echecs identiques d'affilee : l'agent tourne en rond. La 2e reprise doit INTERDIRE la
    // repetition et exiger de capitaliser, sinon on a juste rendu le trou de lapin plus rapide.
    const { pilot: p, sent } = pilot(
      [
        'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
        'La commande a échoué : chemin introuvable.',
        'Je réessaie.<cmd>{"name":"get_state","args":{}}</cmd>',
        'La commande a encore échoué : chemin introuvable.',
        'Autre approche.<cmd>{"name":"get_state","args":{}}</cmd>',
        '✅ Fait — repris autrement.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
      ],
      2
    )
    await p.chat(history, () => {}, ask, 10, 'conv-A', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)

    const escalade = sent.find((c) => c.includes('tu as DÉJÀ rencontré exactement cette erreur'))
    expect(escalade).toBeDefined()
    expect(escalade).toContain('INTERDIT de rejouer')
    // LA moitie apprenante : la lecon doit survivre au tour, via le canal de memoire reel.
    expect(escalade).toContain('remember')
  })

  it('deux murs DIFFÉRENTS ne déclenchent jamais l’escalade', async () => {
    // Le discriminant du registre : sans signature, tout second echec passerait pour un rejeu.
    const sent: string[] = []
    let appels = 0
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        sent.push(messages.at(-1)?.content ?? '')
        return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    const responses = [
      'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
      'Échec : chemin introuvable.',
      'Autre.<cmd>{"name":"get_state","args":{}}</cmd>',
      'Échec : permission refusée.',
      'Encore.<cmd>{"name":"get_state","args":{}}</cmd>',
      '✅ Fait.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
    ]
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async () => {
        appels += 1
        if (appels === 1) return { ok: false, error: 'ENOENT: chemin introuvable' }
        if (appels === 2) return { ok: false, error: 'EACCES: permission refusée' }
        return { ok: true, data: { ok: true } }
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = new AgentPilot(registry as any, roles as any, bus as any)
    await p.chat(history, () => {}, ask, 10, 'conv-A', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)

    expect(sent.some((c) => c.includes('tu as DÉJÀ rencontré exactement cette erreur'))).toBe(false)
    // Mais la reprise ordinaire, elle, a bien eu lieu.
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(true)
  })
})

describe('bornes et interactions — les trous trouves par l’audit du 2026-08-21', () => {
  const rep = (n: number): string[] => {
    const r: string[] = []
    for (let i = 0; i < n; i++) {
      r.push('Tentative.<cmd>{"name":"get_state","args":{}}</cmd>')
      r.push('La commande a échoué : chemin introuvable.')
    }
    const LF = String.fromCharCode(10)
    r.push(['✅ Fait.', '⏳ Reste à faire : rien.', '👉 Recommandé : rien.'].join(LF))
    return r
  }

  it('les reprises restent BORNEES a 2 meme sur cinq murs TOUS DIFFERENTS', async () => {
    /*
     * Ce que ce test prouve, et ce qu'il ne prouve PAS. Il prouve la propriete qui compte pour
     * l'utilisateur : un tour ne peut pas empiler les reprises payantes, quel que soit le motif.
     * Il ne prouve PAS le compteur `reprisesApresEchecRestantes` : en le portant a 99, le nombre
     * observe ne bouge pas — c'est le verrou d'escalade (mur repete) ou le flux lui-meme (murs
     * distincts) qui borne en premier. Le compteur reste un FILET, non exerce par les tests ; le
     * dire vaut mieux qu'un test complaisant qui ferait croire le contraire.
     */
    const reponses: string[] = []
    for (let i = 0; i < 5; i++) {
      reponses.push('Tentative.<cmd>{"name":"get_state","args":{}}</cmd>')
      reponses.push(`La commande a échoué : erreur de type E${i} sur un composant distinct.`)
    }
    reponses.push(['✅ Fait.', '⏳ Reste à faire : rien.', '👉 Recommandé : rien.'].join(String.fromCharCode(10)))
    const sent: string[] = []
    let appels = 0
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        sent.push(messages.at(-1)?.content ?? '')
        // Fixture INEPUISABLE : une liste trop courte rendait '' et le tour muet consommait le
        // verrou, si bien que le test mesurait la longueur de la liste au lieu du cap.
        const suite = reponses.shift()
        return {
          text: suite ?? ['✅ Fait.', '⏳ Reste à faire : rien.', '👉 Recommandé : rien.'].join(String.fromCharCode(10)),
          sessionId: 'sess'
        } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async () => {
        appels += 1
        return { ok: false, error: `panne numero ${appels} sur un composant distinct` }
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = new AgentPilot(registry as any, roles as any, bus as any)
    await p.chat(history, () => {}, ask, 12, 'conv-CAPD', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    const fil = sent.at(-1) ?? ''
    const reprises = fil.split(MARQUEUR).length - 1
    expect(reprises).toBeGreaterThan(0)
    expect(reprises).toBeLessThanOrEqual(2)
  })

  it('le meme mur repete est borne lui aussi', async () => {
    // La DoD cochait « borne » sur la seule LECTURE du code : aucun test ne poussait 3 echecs, donc
    // un test aurait passe a l'identique si le cap avait ete retire. C'est le faux vert typique.
    const { pilot: p, sent } = pilot(rep(5), 99)
    await p.chat(history, () => {}, ask, 12, 'conv-CAP', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    // `sent` capture le prompt CUMULE : compter les messages qui contiennent le marqueur compterait
    // des envois, pas des reprises. On compte donc les occurrences dans le fil final.
    const fil = sent.at(-1) ?? ''
    const occurrences = (motif: string): number => fil.split(motif).length - 1
    const reprises =
      occurrences(MARQUEUR) + occurrences('tu as DÉJÀ rencontré exactement cette erreur')
    expect(reprises).toBe(2)
  })

  it('l’escalade consomme le verrou de relance : aucune relance de forme ne s’y ajoute', async () => {
    // Le depot impose « UNE SEULE relance de forme par tour, toutes gardes confondues » (verrou pose
    // apres un incident du 2026-08-15). La reprise d'ACTION est une exception assumee — mais
    // l'ESCALADE, elle, signifie « on tourne en rond » : elle ne doit plus rien debloquer derriere.
    const { pilot: p, sent } = pilot(rep(5), 99)
    await p.chat(history, () => {}, ask, 12, 'conv-CAP2', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    const fil = sent.at(-1) ?? ''
    const posEscalade = fil.indexOf('tu as DÉJÀ rencontré exactement cette erreur')
    expect(posEscalade).toBeGreaterThan(-1)
    expect(fil.slice(posEscalade).includes('Reformule')).toBe(false)
  })
})

describe('une commande qui JETTE est un echec comme un autre — sauf l’annulation', () => {
  const LF = String.fromCharCode(10)
  const CLOTURE = ['✅ Fait.', '⏳ Reste à faire : rien.', '👉 Recommandé : rien.'].join(LF)

  function harnaisJetant(jet: () => never | Promise<never>, reponses: string[]) {
    const sent: string[] = []
    let appels = 0
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        sent.push(messages.at(-1)?.content ?? '')
        return { text: reponses.shift() ?? CLOTURE, sessionId: 'sess' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async () => {
        appels += 1
        if (appels === 1) return jet()
        return { ok: true, data: { ok: true } }
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
  }

  it('une exception ordinaire devient un echec visible et declenche la reprise', async () => {
    // Trouve par l'audit : `execCommand` n'avait aucun try/catch. Un timeout ou un gate implemente
    // par un `throw` faisait exploser le tour SANS reprise, SANS aveu, et sans rien enregistrer —
    // exactement la classe de cas que ce chantier devait couvrir.
    const { pilot: p, sent } = harnaisJetant(
      () => {
        throw new Error('ETIMEDOUT: la commande n’a pas repondu')
      },
      [
        'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
        'La commande a échoué : delai depasse.',
        'Autre approche.<cmd>{"name":"get_state","args":{}}</cmd>',
        CLOTURE
      ]
    )
    await p.chat(history, () => {}, ask, 10, 'conv-JET', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    const fil = sent.at(-1) ?? ''
    expect(fil.includes(MARQUEUR)).toBe(true)
    // L'erreur jetee doit apparaitre dans le fil : l'agent doit POUVOIR lire ce qui a casse.
    expect(fil).toContain('ETIMEDOUT')
  })

  it('une ANNULATION continue de remonter : on ne relance pas un tour interrompu', async () => {
    // Le piege du correctif : l'annulation utilisateur passe par une exception elle aussi. L'avaler
    // ferait repartir l'agent sur une tache que l'utilisateur vient d'arreter.
    const annulation = Object.assign(new Error('interrompu'), { name: 'AbortError' })
    const { pilot: p } = harnaisJetant(
      () => {
        throw annulation
      },
      ['Tentative.<cmd>{"name":"get_state","args":{}}</cmd>']
    )
    await expect(
      p.chat(history, () => {}, ask, 10, 'conv-ABORT', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
    ).rejects.toThrow('interrompu')
  })
})
