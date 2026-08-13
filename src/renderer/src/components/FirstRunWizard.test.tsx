// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunWizard } from './FirstRunWizard'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let outsideButton: HTMLButtonElement | null

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

beforeEach(() => {
  localStorage.clear()
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    recheckPreflight: async () => ({
      ok: false,
      summary: 'incomplète',
      checks: [
        { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' },
        { id: 'claude', label: 'CLI claude', ok: true }
      ]
    })
  }
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  outsideButton?.remove()
  outsideButton = null
})

async function render(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(FirstRunWizard))
  })
  await flush()
}

describe('FirstRunWizard (#5)', () => {
  it('s’affiche quand une dépendance est ROUGE et liste les checks détectés', async () => {
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="frw-check-brain"]')?.className).toContain('ko')
    expect(container.querySelector('[data-testid="frw-check-claude"]')?.className).toContain('ok')
    expect(container.textContent).toContain('injoignable')
  })

  it('ne s’affiche PAS si TOUT est vert (visibilité pilotée par l’état)', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({
        ok: true,
        summary: 'OK',
        checks: [{ id: 'claude', label: 'CLI claude', ok: true }]
      })
    }
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('se referme tout seul si l’état repasse au vert (push onPreflight)', async () => {
    let pushed: ((r: unknown) => void) | undefined
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({
        ok: false,
        summary: 'incomplète',
        checks: [{ id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' }]
      }),
      onPreflight: (cb: (r: unknown) => void) => {
        pushed = cb
        return () => undefined
      }
    }
    await render()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeTruthy()
    await act(async () => {
      pushed?.({
        ok: true,
        summary: 'OK',
        checks: [{ id: 'brain', label: 'brain_server (:8765)', ok: true }]
      })
    })
    await flush()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('"Continuer quand même" ferme le wizard (dismiss de session, sans persistance)', async () => {
    await render()
    const primary = container.querySelector<HTMLButtonElement>('.frw-primary')!
    await act(async () => primary.click())
    expect(localStorage.getItem('autowin:first-run-done')).toBeNull()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
  })

  it('affiche une erreur de diagnostic puis, au 2e essai (encore rouge), l’efface en restant ouvert', async () => {
    const recheckPreflight = vi
      .fn()
      .mockRejectedValueOnce(new Error('IPC indisponible'))
      .mockResolvedValueOnce({
        ok: false,
        summary: 'incomplète',
        checks: [
          { id: 'codex-session', label: 'Session OAuth Codex', ok: true },
          { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' }
        ]
      })
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = { recheckPreflight }

    await render()
    expect(container.textContent).toMatch(/diagnostic.*échoué/i)
    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      /réessayer/i.test(button.textContent ?? '')
    )
    expect(retry).toBeTruthy()

    await act(async () => retry?.click())
    await flush()
    expect(container.querySelector('[data-testid="frw-check-codex-session"]')?.className).toContain(
      'ok'
    )
    expect(container.textContent).not.toMatch(/diagnostic.*échoué/i)
  })

  it('porte un nom accessible et place le focus sur sa première action', async () => {
    outsideButton = document.createElement('button')
    document.body.appendChild(outsideButton)
    outsideButton.focus()

    await render()

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const titleId = dialog.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(container.querySelector(`#${titleId}`)?.textContent).toContain('Bienvenue')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.textContent).toContain('Re-vérifier')
  })

  it('piège Tab et Shift+Tab entre les actions de la modale', async () => {
    await render()
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
    const first = buttons[0]
    const last = buttons.at(-1)!

    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(first)

    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(last)
  })

  it('restaure le focus précédent à la fermeture', async () => {
    outsideButton = document.createElement('button')
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    await render()

    const finish = container.querySelector<HTMLButtonElement>('.frw-primary')!
    await act(async () => finish.click())

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(outsideButton)
  })
})

/**
 * BOUTON « RÉPARER » — constaté en réel (2026-07-29) : la popup affichait « ✗ Session OAuth Codex —
 * npm run codex:login » et rien de plus, alors que l'app sait lancer ce login. On vérifie ici que le
 * bouton EXISTE, qu'il APPELLE le main, et qu'il ne mente pas sur ce qu'il a fait.
 */
describe('réparer un prérequis rouge depuis la popup', () => {
  const withChecks = (
    checks: Array<{ id: string; label: string; ok: boolean; detail?: string }>,
    repair?: (id: string) => Promise<{ started: boolean; detail: string }>
  ): { repairCalls: string[] } => {
    const repairCalls: string[] = []
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({ ok: false, summary: 'incomplète', checks }),
      repairPreflight: async (id: string) => {
        repairCalls.push(id)
        return repair
          ? await repair(id)
          : {
              started: true,
              detail: 'Console de connexion ouverte. Termine le login, puis re-vérifie.'
            }
      }
    }
    return { repairCalls }
  }

  const codexKo = [
    { id: 'codex-session', label: 'Session OAuth Codex', ok: false, detail: 'npm run codex:login' },
    { id: 'brain-token', label: 'token Brain', ok: false, detail: 'absent' },
    { id: 'claude', label: 'CLI claude', ok: true }
  ]

  /**
   * TROU FERMÉ (audit du 2026-07-30) : `checkProvider` mappait `codex-session → codex` mais avait
   * oublié `claude-session → claude`. Conséquence : sur la ligne rouge « Session claude », le bouton
   * « Facultatif — ne plus demander » n'apparaissait PAS (il exige un provider ET `!c.ok`), et la
   * ligne « CLI claude » étant VERTE n'affichait pas le sien non plus. L'utilisateur qui ne veut pas
   * se logguer à claude n'avait donc AUCUNE sortie in-app : le wizard se réclamait à chaque
   * démarrage — alors que Codex, lui, offrait l'échappatoire.
   *
   * La règle verrouillée ici : tout check `<provider>-session` doit résoudre le MÊME provider que
   * `<provider>`, sinon l'affordance « Facultatif » disparaît en silence.
   */
  it('un check « <provider>-session » rouge offre la même sortie « Facultatif » que son provider', async () => {
    withChecks([
      { id: 'claude', label: 'CLI claude', ok: true },
      { id: 'claude-session', label: 'Session claude', ok: false, detail: 'claude auth login' },
      {
        id: 'codex-session',
        label: 'Session OAuth Codex',
        ok: false,
        detail: 'npm run codex:login'
      }
    ])
    await render()

    expect(container.querySelector('[data-testid="frw-optional-claude-session"]')).not.toBeNull()
    // Le pendant Codex, qui marchait déjà : la symétrie est le contrat.
    expect(container.querySelector('[data-testid="frw-optional-codex-session"]')).not.toBeNull()
  })

  it('un rouge RÉPARABLE porte un bouton ; un rouge NON réparable n’en a pas', async () => {
    withChecks(codexKo)
    await render()
    expect(container.querySelector('[data-testid="frw-repair-codex-session"]')).not.toBeNull()
    // Le token est un SECRET : proposer un bouton serait une promesse intenable.
    expect(container.querySelector('[data-testid="frw-repair-brain-token"]')).toBeNull()
    // Un check VERT n'a aucun bouton.
    expect(container.querySelector('[data-testid="frw-repair-claude"]')).toBeNull()
  })

  it('cliquer LANCE la réparation et affiche son compte-rendu, sans dire « réparé »', async () => {
    const { repairCalls } = withChecks(codexKo)
    await render()
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="frw-repair-codex-session"]'
    )
    await act(async () => button?.click())
    await flush()
    expect(repairCalls).toEqual(['codex-session'])
    const note = container.querySelector('[data-testid="frw-repair-note-codex-session"]')
    expect(note?.textContent).toContain('Console de connexion ouverte')
    expect(note?.textContent).not.toMatch(/réparé|résolu/i)
  })

  it('une réparation qui ÉCHOUE le dit — le rouge reste rouge', async () => {
    withChecks(codexKo, async () => ({ started: false, detail: 'venv Python introuvable' }))
    await render()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="frw-repair-codex-session"]')
        ?.click()
    )
    await flush()
    expect(
      container.querySelector('[data-testid="frw-repair-note-codex-session"]')?.textContent
    ).toContain('venv Python introuvable')
    // Le check est toujours affiché en rouge : aucune fausse guérison.
    expect(container.querySelector('[data-testid="frw-check-codex-session"]')?.className).toContain(
      'ko'
    )
  })

  it('un main qui JETTE ne casse pas la popup', async () => {
    withChecks(codexKo, async () => {
      throw new Error('IPC coupé')
    })
    await render()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="frw-repair-codex-session"]')
        ?.click()
    )
    await flush()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="frw-repair-note-codex-session"]')?.textContent
    ).toContain('échoué')
  })

  it('un service qui DÉMARRE affiche un indicateur, puis la fenêtre se ferme seule quand il répond', async () => {
    // Le brain_server chauffe ~30-40 s : sans état « en démarrage », la ligne repassait aussitôt à
    // « ✗ injoignable » et l'utilisateur devait cliquer « Re-vérifier » pour voir le résultat.
    const brainKo = [
      { id: 'brain', label: 'brain_server (:8765)', ok: false, detail: 'injoignable' }
    ]
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let up = false
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({
        ok: up,
        summary: up ? 'complète' : 'incomplète',
        checks: [{ ...brainKo[0], ok: up, detail: up ? undefined : 'injoignable' }]
      }),
      repairPreflight: async () => ({ started: true, detail: 'brain_server lancé' })
    }
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="frw-repair-brain"]')?.click()
    )
    await flush()

    // Pendant la chauffe : indicateur visible, plus de croix, et on ne prétend pas que c'est prêt.
    expect(container.querySelector('[data-testid="frw-spinner-brain"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="frw-check-brain"]')?.className).toContain(
      'pending'
    )
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeTruthy()

    // Le service répond → la fenêtre disparaît d'elle-même, sans clic.
    up = true
    await act(async () => {
      vi.advanceTimersByTime(3500)
    })
    await flush()
    expect(container.querySelector('[data-testid="first-run-wizard"]')).toBeNull()
    vi.useRealTimers()
  })

  it('sans canal de réparation, le bouton le DIT au lieu de ne rien faire', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      recheckPreflight: async () => ({ ok: false, summary: 'incomplète', checks: codexKo })
    }
    await render()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="frw-repair-codex-session"]')
        ?.click()
    )
    await flush()
    expect(
      container.querySelector('[data-testid="frw-repair-note-codex-session"]')?.textContent
    ).toContain('indisponible')
  })
})
