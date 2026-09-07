// @vitest-environment happy-dom
/**
 * LE MAILLON QUI DEPENSE : ChatView -> CandidatsPickPanel -> envoi du workflow.
 *
 * Le panneau savait s'auto-lancer, mais rien ne testait le CABLAGE — celui qui fait vraiment partir
 * un tour payant. Trois entrees doivent faire echouer ces tests si la regle est fausse :
 *  (a) un scout qui se TERMINE sous nos yeux, mode auto allume, avec un choix ecrit -> le workflow
 *      part sur la seule ligne choisie ;
 *  (b) une conversation ROUVERTE dont le dernier message est deja termine -> rien ne part (le
 *      travail a deja ete paye) ;
 *  (c) mode auto eteint -> rien ne part.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const TEXTE_SCOUT = [
  'CIBLE: 2',
  '',
  '| Score | Type | Quoi | Ancrage | Preuve |',
  '| ---: | --- | --- | --- | --- |',
  '| 92 | fix | Ligne ecartee | src/a.ts:1 | aucun appelant |',
  '| 84 | new | Ligne choisie | src/b.ts:2 | NOT wired |'
].join('\n')

const messageTermine = (): unknown[] => [
  { role: 'user', content: 'scout' },
  { role: 'assistant', done: true, parts: [{ kind: 'text', text: TEXTE_SCOUT }] }
]

let h: Harness | null = null
beforeAll(installRafShim)
afterEach(async () => {
  await h?.unmount()
  h = null
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const promptsEnvoyes = (pilotChat: ReturnType<typeof vi.fn>): string =>
  pilotChat.mock.calls
    .flatMap((appel) =>
      Array.isArray(appel[0]) ? (appel[0] as { role: string; content?: string }[]) : []
    )
    .filter((message) => message.role === 'user')
    .map((message) => message.content ?? '')
    .join(String.fromCharCode(10))

async function monter(
  messages: unknown[],
  auto: boolean
): Promise<{ pilotChat: ReturnType<typeof vi.fn>; emettre: (e: Record<string, unknown>) => void }> {
  let handler: ((event: unknown) => void) | undefined
  const pilotChat = vi.fn().mockResolvedValue({ ok: true })
  h = await mountChat(
    chatApi({
      pilotChat,
      onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
        handler = cb
        return vi.fn()
      }),
      conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
      conversation: vi.fn(async (id: string) => conversation(id, messages))
    })
  )
  await h.click('.conv-item .conv-pick')
  if (auto) await h.click('[data-testid="composer-auto-toggle"]')
  const abonne = handler
  return { pilotChat, emettre: (e) => abonne?.(e) }
}

describe('ChatView — le clic automatique sur les candidats', () => {
  it('(a) un scout qui SE TERMINE en mode auto lance le workflow sur la ligne choisie', async () => {
    const { pilotChat, emettre } = await monter([], true)
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'delta', text: TEXTE_SCOUT, streamId: 's' })
    })
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'done' })
      await Promise.resolve()
    })
    const envoyes = promptsEnvoyes(pilotChat)
    expect(envoyes, 'le workflow doit partir tout seul').toContain(
      'Traite ce candidat issu du scout'
    )
    expect(envoyes).toContain('Ligne choisie')
    expect(envoyes, 'la ligne ecartee par le scout ne doit pas partir').not.toContain(
      'Ligne ecartee'
    )
  })

  it('(b) une conversation ROUVERTE ne relance pas un workflow deja paye', async () => {
    const { pilotChat } = await monter(messageTermine(), true)
    // Laisser les effets du panneau se jouer : sans ce tour de boucle, l'absence d'envoi ne
    // prouverait qu'un retard.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      h?.container.querySelector('[data-testid="candidats-pick"]'),
      'le panneau doit bien etre a l ecran — sinon ce test ne prouve rien'
    ).not.toBeNull()
    expect(promptsEnvoyes(pilotChat)).not.toContain('Traite ce candidat issu du scout')
  })

  it('(c) mode auto ETEINT : rien ne part tout seul', async () => {
    const { pilotChat, emettre } = await monter([], false)
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'delta', text: TEXTE_SCOUT, streamId: 's' })
    })
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'done' })
      await Promise.resolve()
    })
    expect(promptsEnvoyes(pilotChat)).not.toContain('Traite ce candidat issu du scout')
  })
})
