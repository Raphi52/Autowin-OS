import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * CLOTURE SUR PROMESSE — un tour ne peut plus renvoyer son resultat a un futur inexistant.
 *
 * Mesure le 2026-08-31 (kaizen de la conversation courante) : le tour lance `orchestrate` puis clot
 * sur « Je te rends le resultat verifie [...] des qu'il rend la main ». Le tour se termine la ;
 * aucun second message ne part jamais. Le run a fini `degraded-closed`, ses 20 fichiers sont restes
 * dans un worktree isole jamais fusionne, et l'utilisateur a du refaire le travail ailleurs
 * (commit `4bbab009`). Le cout n'est pas la phrase : c'est le travail perdu derriere elle.
 *
 * La regle existait DEJA en prose (constitution : « rendre la main plus tot est un ECHEC » ; prompt
 * de pilotage : « n'annonce jamais un lancement avant son resultat observable ») et n'a pas suffi :
 * les deux ont ete enfreintes dans le meme message. Ce test garde la version MECANIQUE.
 *
 * SCENARIO REEL reproduit ici : l'action part a l'iteration 0, et la CLOTURE (sans commande) arrive
 * ensuite. Les gardes de forme ne sont evaluees qu'a ce moment-la — tant qu'une commande suit, le
 * tour continue de lui-meme.
 */
function pilot(responses: string[]) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'etat' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const history: Message[] = [{ role: 'user', content: 'corrige le bug puis dis-moi' }]

/** `exigerExperienceSoignee` est le 16e parametre de `chat()` — la politique qui arme ces gardes. */
async function tour(p: AgentPilot): Promise<void> {
  await p
    .chat(
      history,
      () => {},
      undefined,
      6,
      'conv-KZ',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    )
    .catch(() => undefined)
}

const ACTION = '<cmd>{"name":"get_state","args":{}}</cmd>'
const PROMESSE =
  'Run lancé. Je te rends le résultat vérifié — exit codes réels — dès qu’il rend la main.'
const CONCLUSION =
  'Run terminé : exit code 0, 57 tests verts.\n\n✅ Fait\n📍 Maintenant\n⏳ Reste à faire\n👉 Recommandé'
const FENCE_OUVERTE = '```html-render\n<p>x</p>\n</html-render\n'
const FENCE_FERMEE =
  'Voici :\n```html-render\n<p>x</p>\n```\n\n✅ Fait\n📍 Maintenant\n⏳ Reste à faire\n👉 Recommandé'

describe('une cloture qui PROMET un compte-rendu futur relance le tour', () => {
  it('reinjecte l’ordre de prouver MAINTENANT, et le tour repart', async () => {
    const { pilot: p, sent } = pilot([ACTION, PROMESSE, CONCLUSION])
    await tour(p)
    const relance = sent.find((c) => c.includes('ta clôture PROMET un compte-rendu ultérieur'))
    expect(relance).toBeDefined()
    expect(relance).toContain('aucun second message ne partira')
  })

  it('est bornée à une seule relance (jamais de boucle payante)', async () => {
    const { pilot: p, sent } = pilot([ACTION, PROMESSE, PROMESSE, PROMESSE])
    await tour(p)
    expect(
      sent.filter((c) => c.includes('ta clôture PROMET un compte-rendu ultérieur'))
    ).toHaveLength(1)
  })

  it('une clôture qui rend compte au PASSÉ ne déclenche aucune relance', async () => {
    const { pilot: p, sent } = pilot([ACTION, CONCLUSION])
    await tour(p)
    expect(sent.some((c) => c.includes('ta clôture PROMET un compte-rendu ultérieur'))).toBe(false)
  })
})

describe('une fence html-render laissée ouverte relance le tour', () => {
  it('reinjecte l’ordre de refermer la fence', async () => {
    const { pilot: p, sent } = pilot([ACTION, FENCE_OUVERTE, FENCE_FERMEE])
    await tour(p)
    const relance = sent.find((c) => c.includes('sans jamais le REFERMER'))
    expect(relance).toBeDefined()
    expect(relance).toContain('bloc de code BRUT')
  })

  it('une fence correctement refermée ne déclenche aucune relance', async () => {
    const { pilot: p, sent } = pilot([ACTION, FENCE_FERMEE])
    await tour(p)
    expect(sent.some((c) => c.includes('sans jamais le REFERMER'))).toBe(false)
  })
})
