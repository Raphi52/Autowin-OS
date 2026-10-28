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

  // conv-247, 2026-10-11 : « n'affiche rien à la place du — quand un geste n'a pas d'heure ».
  // La colonne reste (les heures restent alignées), mais vide.
  it('laisse la colonne de l’heure VIDE quand le geste n’a pas d’heure', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await monter()
    const ligne = [...host.querySelectorAll('.model-log-row')].find((row) =>
      row.textContent?.includes('run_tests')
    ) as HTMLElement
    const heure = ligne.querySelector('time.model-log-time')
    expect(heure).toBeTruthy()
    expect(heure?.textContent).toBe('')
  })

  // conv-247, 2026-10-11 : « retire aussi le — des en-têtes de tour quand le tour n'a pas d'heure
  // de début ». L'en-tête garde son rang et ses chiffres, sans case d'heure vide.
  it('n’écrit pas « — » dans l’en-tête d’un tour sans heure de début', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await monter()
    const entete = host.querySelector('.model-log-tour__head') as HTMLElement
    expect(entete.textContent).toContain('Tour 1')
    expect(entete.textContent).toContain('gestes')
    expect(entete.textContent).not.toContain('—')
  })

  it('garde l’heure de début dans l’en-tête quand le tour en a une', async () => {
    const at = new Date('2026-09-01T07:05:09').getTime()
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([{ kind: 'command', name: 'Bash', actionId: 'c1', at }])
    await monter()
    const entetes = [...host.querySelectorAll('.model-log-tour__head')].map((e) => e.textContent)
    expect(entetes.some((texte) => texte?.includes('07:05:09'))).toBe(true)
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

/**
 * LIGNE UNIQUE (conv-247, 2026-10-11 : maquette « tour 4 », pistes 2 + 3 + 4 retenues par
 * l'utilisateur — « go 2 3 4 »). Au repos, chaque geste tient sur UNE ligne : nature, titre court,
 * résumé gris ; l'heure seule à gauche de la frise ; un clic sur la carte la déplie.
 */
describe('ModelActivityLogPane — la ligne unique', () => {
  async function monterAppelModele(): Promise<HTMLElement> {
    const at = new Date('2026-09-01T07:05:09').getTime()
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([{ kind: 'prompt-call', name: 'claude-opus-5-5', at }])
    await monter()
    return [...host.querySelectorAll('.model-log-row')].find(
      (row) => row.getAttribute('data-log-kind') === 'model-call'
    ) as HTMLElement
  }

  it('affiche le titre COURT sur la ligne et garde le titre complet dans la carte dépliée', async () => {
    const ligne = await monterAppelModele()
    const resume = ligne.querySelector('summary') as HTMLElement
    expect(resume.querySelector('.model-log-label')?.textContent).toBe('opus-5-5')
    expect(resume.textContent).not.toContain('Appel modèle')
    expect(ligne.querySelector('.model-log-expand')?.textContent).toContain(
      'Appel modèle — claude-opus-5-5'
    )
  })

  it('met toute la ligne dans le résumé cliquable de la carte : la carte entière se déplie', async () => {
    const ligne = await monterAppelModele()
    const carte = ligne.querySelector('.model-log-carte details') as HTMLDetailsElement
    expect(carte).toBeTruthy()
    const resume = carte.querySelector(':scope > summary') as HTMLElement
    expect(resume.querySelector('.model-log-kind')?.textContent).toBe('Modèle')
    expect(resume.querySelector('.model-log-label')).toBeTruthy()
    // La source passe dans la partie dépliée : la ligne au repos ne garde que l'essentiel.
    expect(resume.querySelector('.model-log-source')).toBeNull()
    expect(carte.querySelector('.model-log-expand .model-log-source')?.textContent).toBe('journal')
  })

  it('pose l’heure seule à gauche de la frise, avant la perle et la carte', async () => {
    const ligne = await monterAppelModele()
    const enfants = [...ligne.children].map((enfant) => enfant.className.split(' ')[0])
    const iHeure = enfants.indexOf('model-log-time')
    expect(iHeure).toBeGreaterThanOrEqual(0)
    expect(enfants[iHeure + 1]).toBe('model-log-perle')
    expect(enfants[iHeure + 2]).toBe('model-log-carte')
    expect(ligne.querySelector('time')?.textContent).toBe('07:05:09')
  })

  it('quand le titre répète la nature (« Demande »), la ligne affiche le texte à sa place', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await monter()
    const demande = [...host.querySelectorAll('.model-log-row')].find(
      (row) => row.getAttribute('data-log-kind') === 'prompt'
    ) as HTMLElement
    expect(demande.querySelector('summary .model-log-label')?.textContent).toBe('lance les tests')
  })

  it('sans résumé gris, le titre prend toute la ligne au lieu de s’arrêter à 46 %', async () => {
    // Capture du 2026-10-11 : « Signe de vie · Bash · cd /d/A… » coupé à mi-ligne, la droite vide.
    const ligne = await monterAppelModele()
    const label = ligne.querySelector('summary .model-log-label') as HTMLElement
    const resume = ligne.querySelector('summary .model-log-resume')
    expect(label.classList.contains('is-plein')).toBe(resume === null)
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([])
    await monter()
    const demande = [...host.querySelectorAll('.model-log-row')].find(
      (row) => row.getAttribute('data-log-kind') === 'prompt'
    ) as HTMLElement
    expect(demande.querySelector('summary .model-log-label')?.classList.contains('is-plein')).toBe(
      true
    )
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
    // Les LIGNES du journal, sans les têtes de groupe (conv-270) : une rafale semblable repliée
    // ajoute une tête, mais le plafond porte sur les gestes rendus, toujours 300 au plus.
    const lignes = (): number =>
      host.querySelectorAll('.model-log-row:not(.model-log-groupe__tete)').length
    const rendues = lignes()
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
    expect(lignes()).toBeGreaterThan(rendues)
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

  const afficherPistes = async (): Promise<void> => {
    const bouton = host.querySelector('[data-testid="model-log-pistes"]') as HTMLButtonElement
    if (bouton.getAttribute('aria-pressed') !== 'true') await act(async () => bouton.click())
  }

  it('donne à chaque source une VOIE à position fixe, la même sur toutes ses lignes', async () => {
    brancher()
    await monter()
    await afficherPistes()
    const rails = [...host.querySelectorAll('[data-piste-source]')]
    expect(rails.length).toBeGreaterThan(0)
    // Une voie par source PRÉSENTE, pas une de plus : aucune piste vide.
    expect(new Set(rails.map((rail) => rail.getAttribute('data-piste-source')))).toEqual(
      new Set(['thread', 'journal', 'parts', 'causal', 'activity'])
    )
    const indexVoie = new Map<string, string>()
    for (const rail of rails) {
      const source = rail.getAttribute('data-piste-source') as string
      const index = rail.getAttribute('data-piste-index') as string
      // Toutes les lignes d'une source sont SUR la même voie, portée aussi en variable CSS.
      expect(indexVoie.get(source) ?? index).toBe(index)
      indexVoie.set(source, index)
      expect((rail as HTMLElement).style.getPropertyValue('--piste')).toBe(index)
    }
    expect(new Set(indexVoie.values()).size).toBe(indexVoie.size)
  })

  // conv-247, 2026-10-11 : « enlève la légende en haut des logs » — la légende des voies a disparu,
  // même pistes affichées ; isoler une source passe par le menu « Toutes sources ».
  it('n’affiche plus la légende des voies, même pistes affichées', async () => {
    brancher()
    await monter()
    await afficherPistes()
    expect(host.querySelectorAll('[data-piste-source]').length).toBeGreaterThan(0)
    expect(host.querySelector('[data-testid="model-log-voies"]')).toBeNull()
    expect(host.querySelector('[data-voie-source]')).toBeNull()
  })

  it('le menu des sources isole une source, « Toutes sources » la relâche', async () => {
    brancher()
    await monter()
    const menu = host.querySelector('[aria-label="Filtrer par source"]') as HTMLSelectElement
    const choisir = async (valeur: string): Promise<void> =>
      act(async () => {
        menu.value = valeur
        menu.dispatchEvent(new Event('change', { bubbles: true }))
      })
    await choisir('journal')
    let sources = [...host.querySelectorAll('.model-log-row [data-log-source]')].map((n) =>
      n.getAttribute('data-log-source')
    )
    expect(new Set(sources)).toEqual(new Set(['journal']))
    await choisir('')
    sources = [...host.querySelectorAll('.model-log-row [data-log-source]')].map((n) =>
      n.getAttribute('data-log-source')
    )
    expect(new Set(sources).size).toBeGreaterThan(1)
  })

  // conv-247, 2026-10-11 : « enlève la colonne tout à gauche » — la colonne des pistes n'est plus
  // affichée d'office. Elle reste à un clic, par le bouton Pistes.
  it('n’affiche pas la colonne des pistes au montage ; le bouton Pistes l’affiche puis la replie', async () => {
    brancher()
    await monter()
    expect(host.querySelectorAll('[data-piste-source]').length).toBe(0)
    expect(host.querySelector('[data-testid="model-log-voies"]')).toBeNull()
    expect(
      host.querySelector('[data-testid="model-activity-log"]')?.getAttribute('data-pistes')
    ).toBe('false')
    const bouton = host.querySelector('[data-testid="model-log-pistes"]') as HTMLButtonElement
    expect(bouton.getAttribute('aria-pressed')).toBe('false')
    await act(async () => bouton.click())
    expect(host.querySelectorAll('[data-piste-source]').length).toBeGreaterThan(0)
    await act(async () => bouton.click())
    expect(host.querySelectorAll('[data-piste-source]').length).toBe(0)
    // Le flux lui-même est intact : la colonne absente ne filtre rien.
    expect(host.textContent).toContain('je réfléchis')
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

// conv-270, 2026-10-11 : « dans les logs groupe les trucs qui se ressemblent qui se suivent ».
describe('ModelActivityLogPane — lignes semblables qui se suivent', () => {
  const rafale = [
    { kind: 'provider-status', text: 'Bash · git status --short', at: 1 },
    { kind: 'provider-status', text: 'tache de fond en cours - Lint', at: 2 },
    { kind: 'provider-status', text: 'Bash terminé - 3 s', at: 3 }
  ]

  it('replie trois signes de vie consécutifs en UN groupe qui dit leur nombre', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue(rafale)
    await monter()
    const groupes = host.querySelectorAll('[data-testid="model-log-groupe"]')
    expect(groupes).toHaveLength(1)
    const tete = groupes[0].querySelector(':scope > summary') as HTMLElement
    expect(tete.querySelector('.model-log-compte')?.textContent).toBe('×3')
    // La tête dit par où la rafale commence, et porte la teinte de sa nature.
    expect(tete.textContent).toContain('Bash · git status --short')
    expect(tete.getAttribute('data-log-kind')).toBe('status')
    // Replié par défaut : les trois lignes sont dans le groupe, pas à côté.
    expect((groupes[0] as HTMLDetailsElement).open).toBe(false)
    const membres = groupes[0].querySelectorAll('.model-log-groupe__membres .model-log-row')
    expect([...membres].map((row) => row.querySelector('.model-log-label')?.textContent)).toEqual([
      'Bash · git status --short',
      'tache de fond en cours - Lint',
      'Bash terminé - 3 s'
    ])
  })

  it('le menu des natures montre « Action » UNE fois et retient les deux sortes de gestes', async () => {
    // Les lignes du fournisseur (`status`) et les appels d'outil (`action`) portent le même nom
    // affiché : deux entrées « Action » identiques filtraient chacune une moitié différente.
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([rafale[0]])
    await monter()
    const menu = host.querySelector('[aria-label="Filtrer par nature"]') as HTMLSelectElement
    const libelles = [...menu.options].map((option) => option.textContent)
    expect(libelles.filter((libelle) => libelle === 'Action')).toHaveLength(1)
    await act(async () => {
      // Choisie par son TEXTE, comme à l'écran : la valeur de l'option est la clé de texte de la
      // nature, pour qu'un filtre posé survive à un changement de langue (conv-1170).
      menu.value = [...menu.options].find((option) => option.textContent === 'Action')!.value
      menu.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const kinds = [...host.querySelectorAll('.model-log-row')].map((row) =>
      row.getAttribute('data-log-kind')
    )
    expect(new Set(kinds)).toEqual(new Set(['action', 'status']))
  })

  it('laisse en ligne seule un geste sans voisin semblable', async () => {
    ;(window as unknown as { api: { turnJournal: unknown } }).api.turnJournal = vi
      .fn()
      .mockResolvedValue([rafale[0]])
    await monter()
    expect(host.querySelectorAll('[data-testid="model-log-groupe"]')).toHaveLength(0)
    expect(host.textContent).toContain('Bash · git status --short')
  })
})
