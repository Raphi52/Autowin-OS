// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelActivityLogPane } from './ModelActivityLogPane'
import type { Msg } from './chat-view-types'

const messages = [
  { role: 'user', content: 'lance les tests' },
  {
    role: 'assistant',
    turnId: 'turn-1',
    status: 'completed',
    done: true,
    parts: [{ kind: 'action', name: 'run_tests', ok: true }]
  }
] as unknown as Msg[]

let host: HTMLDivElement
let root: Root

async function monter(): Promise<void> {
  await act(async () => {
    root.render(<ModelActivityLogPane conversationId="conv-1" messages={messages} />)
  })
  // laisse la promesse de lecture du journal se résoudre
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(window as unknown as { api: Record<string, unknown> }).api = {}
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ModelActivityLogPane — la trace de ce que les modèles ont fait', () => {
  it('affiche les gestes depuis les parts durables quand le journal a été nettoyé', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await monter()
    expect(host.textContent).toContain('run_tests')
    expect(host.textContent).toContain('lance les tests')
  })

  it('préfère le journal du tour : appel modèle, commande et VERDICT', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([
        { kind: 'prompt-call', name: 'gpt-5' },
        { kind: 'command', name: 'Bash', actionId: 'c1', args: { command: 'ls' } },
        { kind: 'result', name: 'Bash', actionId: 'c1', ok: false, data: 'exit 1' }
      ])
    await monter()
    expect(host.textContent).toContain('Appel modèle — gpt-5')
    expect(host.textContent).toContain('Bash')
    const ligne = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('Bash')
    )
    expect(ligne?.querySelector('.st-err')).toBeTruthy()
    // UNION : le journal s'AJOUTE aux parts du meme tour, il ne les remplace plus — l'action
    // persistee reste donc lisible, avec sa source.
    expect(host.textContent).toContain('run_tests')
    const persistee = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('run_tests')
    )
    expect(persistee?.querySelector('.model-log-source')?.textContent).toBe('persisté')
  })

  it('horodate chaque geste dont le journal porte l’heure', async () => {
    const at = new Date('2026-09-01T07:05:09').getTime()
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([{ kind: 'command', name: 'Bash', actionId: 'c1', at }])
    await monter()
    const ligne = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('Bash')
    )
    expect(ligne?.querySelector('time')?.textContent).toBe('07:05:09')
  })

  it('un IPC de journal en échec ne vide pas le panneau', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockRejectedValue(new Error('ipc down'))
    await monter()
    expect(host.textContent).toContain('run_tests')
  })
  it('déplie les champs du geste clé par clé, et non en une seule chaîne', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([
        {
          kind: 'command',
          name: 'Bash',
          actionId: 'c1',
          args: { command: 'ls', cwd: '/tmp' },
          sessionId: 'sess-7'
        }
      ])
    await monter()
    const ligne = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('Bash')
    ) as HTMLElement
    const detail = ligne.querySelector('details') as HTMLDetailsElement
    expect(detail).toBeTruthy()
    await act(async () => {
      detail.open = true
    })
    // Chaque champ est une LIGNE clé → valeur de l'arbre, pas un fragment de JSON collé.
    const cles = [...detail.querySelectorAll('.human-json__key')].map((noeud) => noeud.textContent)
    expect(cles).toContain('sessionId')
    expect(cles).toContain('command')
    expect(cles).toContain('cwd')
    // La provenance exacte de la ligne reste lisible une fois dépliée.
    expect(detail.querySelector('.model-log-meta')?.textContent).toContain('tour turn-1')
    expect(detail.querySelector('.model-log-copy')).toBeTruthy()
  })
})

describe('ModelActivityLogPane — tenue du volume', () => {
  it('borne le nombre de lignes RENDUES et laisse remonter plus ancien', async () => {
    const parts = Array.from({ length: 20_000 }, (_, index) => ({
      kind: 'text',
      text: `ligne ${index}`
    }))
    const gros = [
      {
        role: 'assistant',
        turnId: 'turn-1',
        status: 'completed',
        done: true,
        parts
      }
    ] as unknown as Msg[]
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await act(async () => {
      root.render(<ModelActivityLogPane conversationId="conv-1" messages={gros} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    const rendues = host.querySelectorAll('.model-log-row').length
    expect(rendues).toBeLessThanOrEqual(300)
    // ce qui est rendu, c'est la FIN du journal (l'activité récente)
    expect(host.textContent).toContain('ligne 19999')
    expect(host.textContent).not.toContain('ligne 0 ')
    const bouton = host.querySelector('[data-testid="model-log-plus"]') as HTMLButtonElement | null
    expect(bouton).not.toBeNull()
    expect(bouton?.textContent ?? '').toContain('ancien')
    await act(async () => {
      bouton?.click()
    })
    expect(host.querySelectorAll('.model-log-row').length).toBeGreaterThan(rendues)
  })
})

describe('ModelActivityLogPane — les quatre sources jusqu’à l’écran', () => {
  const brancher = (causalKo = false): void => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.turnJournal = vi
      .fn()
      .mockResolvedValue([{ kind: 'reasoning', text: 'je réfléchis', at: 1 }])
    api.causalTrace = causalKo
      ? vi.fn().mockRejectedValue(new Error('trace illisible'))
      : vi.fn().mockResolvedValue([
          {
            id: 'e1',
            type: 'injection',
            timestamp: '2026-09-01T10:00:00.000Z',
            payloads: [{ kind: 'contexte', name: 'état app', content: 'onglet chat' }]
          }
        ])
    api.conversationActivity = vi
      .fn()
      .mockResolvedValue([
        { ts: '2026-09-01T10:00:05.000Z', kind: 'appel', provider: 'claude', costUsd: 0.02 }
      ])
  }

  it('affiche une ligne par source, chacune marquée de son origine', async () => {
    brancher()
    await monter()
    const sources = [...host.querySelectorAll('[data-log-source]')].map((n) =>
      n.getAttribute('data-log-source')
    )
    expect(new Set(sources)).toEqual(new Set(['thread', 'journal', 'parts', 'causal', 'activity']))
    const menu = host.querySelector('[aria-label="Filtrer par source"]') as HTMLSelectElement
    const options = [...menu.options].map((option) => option.value)
    for (const source of ['journal', 'parts', 'causal', 'activity'])
      expect(options).toContain(source)
  })

  it('une source illisible n’efface pas les autres', async () => {
    brancher(true)
    await monter()
    const sources = [...host.querySelectorAll('[data-log-source]')].map((n) =>
      n.getAttribute('data-log-source')
    )
    expect(sources).not.toContain('causal')
    expect(new Set(sources)).toEqual(new Set(['thread', 'journal', 'parts', 'activity']))
    expect(host.textContent).toContain('je réfléchis')
  })
})

describe('ModelActivityLogPane — lecture en profondeur', () => {
  const deuxTours = [
    { role: 'user', content: 'un' },
    {
      role: 'assistant',
      turnId: 'turn-1',
      status: 'completed',
      done: true,
      parts: [{ kind: 'action', name: 'run_tests', ok: true }]
    },
    { role: 'user', content: 'deux' },
    {
      role: 'assistant',
      turnId: 'turn-2',
      status: 'completed',
      done: true,
      parts: [{ kind: 'error', cause: 'turn', text: 'ça a cassé' }]
    }
  ] as unknown as Msg[]

  async function monterAvec(msgs: Msg[]): Promise<void> {
    await act(async () => {
      root.render(<ModelActivityLogPane conversationId="conv-1" messages={msgs} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('range les gestes par TOUR, avec un en-tête par tour', async () => {
    await monterAvec(deuxTours)
    const entetes = [...host.querySelectorAll('[data-testid="model-log-tour"]')]
    expect(entetes).toHaveLength(2)
    expect(entetes[0].textContent).toContain('Tour 1')
    expect(entetes[1].textContent).toContain('Tour 2')
    // Le tour qui a echoue le DIT dans son en-tete, sans qu'on ait a le deplier.
    expect(entetes[1].textContent).toContain('échec')
    expect(entetes[0].textContent).not.toContain('échec')
  })

  it('ne garde que les gestes en échec quand on demande les erreurs', async () => {
    await monterAvec(deuxTours)
    const bouton = host.querySelector('[data-testid="model-log-erreurs"]') as HTMLButtonElement
    await act(async () => bouton.click())
    const liste = host.querySelector('[data-testid="model-activity-log"]') as HTMLElement
    expect(liste.textContent).toContain('ça a cassé')
    expect(liste.textContent).not.toContain('run_tests')
    expect(bouton.getAttribute('aria-pressed')).toBe('true')
  })

  it('exporte les lignes affichées au format JSON', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await monterAvec(deuxTours)
    const bouton = host.querySelector('[data-testid="model-log-export"]') as HTMLButtonElement
    await act(async () => bouton.click())
    expect(writeText).toHaveBeenCalledTimes(1)
    const copie = JSON.parse(writeText.mock.calls[0][0] as string) as Array<{ turnId: string }>
    expect(copie.length).toBeGreaterThan(0)
    expect(copie.some((ligne) => ligne.turnId === 'turn-2')).toBe(true)
  })
})

describe('ModelActivityLogPane — la source Brain', () => {
  it('lit les traces Brain de la conversation et les affiche comme gestes', async () => {
    const brainTraces = vi.fn(async () => [
      {
        id: 'b1',
        timestamp: '2026-09-02T10:00:00.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        kind: 'query',
        query: 'contrainte du graphe',
        status: 'found',
        found: true,
        injectedChars: 1_200
      },
      // Une trace d'UNE AUTRE conversation ne doit jamais s'inviter dans ce fil.
      {
        id: 'b2',
        timestamp: '2026-09-02T10:01:00.000Z',
        conversationId: 'conv-9',
        kind: 'query',
        query: 'sujet etranger',
        injectedChars: 5
      }
    ])
    ;(window as unknown as { api: Record<string, unknown> }).api = { brainTraces }
    await monter()
    await act(async () => {
      await Promise.resolve()
    })
    expect(brainTraces).toHaveBeenCalledWith('conv-1')
    const liste = host.querySelector('[data-testid="model-activity-log"]') as HTMLElement
    expect(liste.textContent).toContain('contrainte du graphe')
    expect(liste.textContent).toContain('brain_query')
    expect(liste.textContent).not.toContain('sujet etranger')
  })

  it('ne casse pas le journal quand le Brain est hors ligne', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      brainTraces: vi.fn(async () => {
        throw new Error('brain hors ligne')
      })
    }
    await monter()
    await act(async () => {
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="model-activity-log"]')).not.toBeNull()
  })
})

describe('ModelActivityLogPane — les appels prompt', () => {
  it('lit les appels prompt de la conversation et montre ce qui est parti au modèle', async () => {
    const promptCalls = vi.fn(async () => [
      {
        id: 'p1',
        ts: '2026-09-02T10:00:00.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        iteration: 1,
        actor: 'producteur',
        provider: 'claude',
        model: 'opus-5',
        systemBlocks: [{ name: 'discipline', chars: 1_800 }],
        messages: [],
        options: {},
        response: 'ok',
        status: 'completed'
      }
    ])
    ;(window as unknown as { api: Record<string, unknown> }).api = { promptCalls }
    await monter()
    await act(async () => {
      await Promise.resolve()
    })
    expect(promptCalls).toHaveBeenCalledWith('conv-1')
    const liste = host.querySelector('[data-testid="model-activity-log"]') as HTMLElement
    expect(liste.textContent).toContain('producteur')
    expect(liste.textContent).toContain('discipline (1800)')
  })

  it('ne casse pas le journal quand les appels prompt sont illisibles', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      promptCalls: vi.fn(async () => {
        throw new Error('spool illisible')
      })
    }
    await monter()
    await act(async () => {
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="model-activity-log"]')).not.toBeNull()
  })
})
