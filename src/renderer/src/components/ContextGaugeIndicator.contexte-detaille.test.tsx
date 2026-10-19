// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ContextGaugeDetail } from './ContextGaugeIndicator'
import type { ContextGauge } from '../../../shared/context-gauge'
import { composerContexte, lireReponseContexte } from '../../../shared/contexte-detaille'

/**
 * Le panneau « Contexte » a la maniere de claude.exe (conv-1000, 2026-10-16).
 *
 * Ce qui ferait echouer ce test si la livraison etait fausse :
 *  - sans detail mesure, le panneau doit rester l'ancien (jauge simple) : le detail ne s'invente pas ;
 *  - avec detail, les categories, la barre segmentee et les listes repliables doivent y etre, et une
 *    categorie DIFFEREE doit afficher « — » plutot qu'une part de fenetre qu'elle n'occupe pas.
 */
const jauge: ContextGauge = {
  used: 93_900,
  limit: 1_000_000,
  ratio: 0.0939,
  level: 'ok',
  cacheRead: 80_000,
  fresh: 13_900
}

const statique = lireReponseContexte(
  {
    maxTokens: 1_000_000,
    categories: [
      { name: 'System prompt', tokens: 8_800 },
      { name: 'System tools', tokens: 23_300 },
      { name: 'MCP tools', tokens: 14_400 },
      { name: 'MCP tools (deferred)', tokens: 50_500, isDeferred: true },
      { name: 'Memory files', tokens: 24_700 },
      { name: 'Autocompact buffer', tokens: 33_000 }
    ],
    mcpTools: [
      { name: 'mcp__autowin__get_state', serverName: 'autowin', tokens: 148 },
      { name: 'mcp__autowin__orchestrate', serverName: 'autowin', tokens: 1_100 }
    ],
    memoryFiles: [
      { path: 'C:\\Users\\x\\.claude\\projects\\D--AutoWinOS\\memory\\MEMORY.md', tokens: 2_600 }
    ]
  },
  Date.UTC(2026, 9, 16, 14, 42)
)!

async function rendre(props: Parameters<typeof ContextGaugeDetail>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ContextGaugeDetail, props))
    await Promise.resolve()
  })
  return container
}

describe('panneau Contexte par categorie', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('garde la jauge simple tant qu aucun detail n a ete mesure', async () => {
    const c = await rendre({ gauge: jauge })
    expect(c.querySelector('[data-testid="quota-context-gauge"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="ctx-categories"]')).toBeNull()
  })

  it('montre utilise / fenetre, les categories, la barre et les listes', async () => {
    const contexte = composerContexte(statique, jauge.used, jauge.limit)
    const c = await rendre({ gauge: jauge, contexte, onCompact: () => undefined })
    expect(c.querySelector('[data-testid="ctx-resume"]')?.textContent).toBe('9 % utilisé93.9k / 1M')
    const lignes = [...c.querySelectorAll('[data-testid="ctx-categories"] li')]
    const parCle = (cle: string): string =>
      lignes.find((l) => l.getAttribute('data-categorie') === cle)?.textContent ?? ''
    expect(parCle('memory-files')).toContain('Fichiers mémoire24.7k2,5 %')
    // Messages = occupation reelle − partie fixe (8,8k + 23,3k + 14,4k + 24,7k = 71,2k).
    expect(parCle('messages')).toContain('Messages22.7k2,3 %')
    // Le differe se lit « — » : il n'occupe rien tant que le modele ne l'appelle pas.
    const differe = lignes.find((l) => l.classList.contains('is-differe'))
    expect(differe?.textContent).toBe('Outils MCP (différés)50.5k—')
    expect(c.querySelectorAll('.ctx-barre > i').length).toBe(6)
    const mcp = c.querySelector('[data-testid="ctx-outils-mcp"]') as HTMLDetailsElement
    expect(mcp.open).toBe(true)
    expect(mcp.querySelector('summary')?.textContent).toBe('Outils MCP2')
    expect(mcp.querySelector('li')?.textContent).toBe('autowin · orchestrate1.1k')
    expect(c.querySelector('[data-testid="ctx-fichiers-memoire"] li')?.textContent).toBe(
      '…/memory/MEMORY.md2.6k'
    )
    // Une liste vide ne s'affiche pas (aucune skill mesuree ici).
    expect(c.querySelector('[data-testid="ctx-skills"]')).toBeNull()
    expect(c.querySelector('[data-testid="quota-context-compact"]')).not.toBeNull()
  })
})
