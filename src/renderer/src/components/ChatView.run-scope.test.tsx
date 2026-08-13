// @vitest-environment happy-dom
/**
 * La barre de droite ne montre QUE la conversation courante.
 *
 * Le cadrage « tous » existait et laissait lire des compteurs GLOBAUX (46 open / 225 green
 * mesurés le 2026-08-12) sous une conversation qui n'en portait que deux, sans que le bouton
 * replié ne signale la portée. On ne s'y retrouvait plus. Trois garanties ici :
 * aucun sélecteur de portée, aucun appel à l'IPC globale, compteurs = ceux de la conversation.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const stubs = [
  { id: 'A', title: 'Conversation A', category: 'codex', provider: 'codex', updatedAt: 1 },
  { id: 'B', title: 'Conversation B', category: 'codex', provider: 'codex', updatedAt: 2 }
]

const run = (subject: string, status: string): Record<string, unknown> => ({
  subject,
  session: 's',
  path: `C:/runs/${subject}/RUN.md`,
  mtime: 1,
  summary: { status, dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
})

// Le global écrase la conversation d'un ordre de grandeur : si la portée fuit, le compteur le dit.
const RUNS_GLOBAUX = [
  ...Array.from({ length: 46 }, (_, i) => run(`g${i}`, 'open')),
  ...Array.from({ length: 225 }, (_, i) => run(`v${i}`, 'green'))
]
const RUNS_DE_A = [run('a1', 'open'), run('a2', 'green')]

describe('ChatView — portée du panneau Workflows', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function monter(): Promise<{ listRuns: ReturnType<typeof vi.fn> }> {
    const listRuns = vi.fn().mockResolvedValue(RUNS_GLOBAUX)
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(stubs),
        conversation: vi.fn(async (id: string) => ({ ...stubs[0], id, messages: [] })),
        conversationRuns: vi.fn().mockResolvedValue(RUNS_DE_A),
        listRuns
      })
    )
    await h.click('.conv-pick')
    return { listRuns }
  }

  const bouton = (): HTMLElement => h?.container.querySelector('.workflow-toggle') as HTMLElement

  it('le sélecteur de portée n’existe plus dans le panneau', async () => {
    await monter()
    await h!.click('.workflow-toggle')
    const libelles = [...h!.container.querySelectorAll('button')].map((b) => b.textContent ?? '')
    expect(libelles.some((t) => t.trim() === 'tous')).toBe(false)
    expect(libelles.some((t) => t.trim() === 'cette conversation')).toBe(false)
  })

  it('les compteurs comptent la conversation, pas le dépôt entier', async () => {
    await monter()
    const texte = bouton().textContent ?? ''
    // 1 open / 1 green viennent de RUNS_DE_A ; 46/225 seraient la fuite globale.
    expect(texte).toContain('1 open')
    expect(texte).toContain('1 green')
    expect(texte).not.toContain('46')
    expect(texte).not.toContain('225')
  })

  it('l’IPC globale `listRuns` n’est jamais appelée par le panneau', async () => {
    const { listRuns } = await monter()
    await h!.click('.workflow-toggle')
    expect(listRuns).not.toHaveBeenCalled()
  })
})
