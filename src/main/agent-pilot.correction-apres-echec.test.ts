import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * VOIR SON ERREUR, LA CORRIGER, PUIS CONTINUER LA TÂCHE.
 *
 * La garde `exigeDireLEchec` obtenait un aveu honnête mais ordonnait de reformuler « SANS aucune
 * commande » : l'agent constatait proprement son échec et RENDAIT LA MAIN, demande non satisfaite.
 * Ces tests vérifient le comportement, pas la fonction pure : la relance doit RE-AUTORISER les
 * commandes, et le tour doit se terminer sur le travail RÉELLEMENT abouti après reprise.
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
