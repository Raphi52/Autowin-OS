// @vitest-environment happy-dom
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invokedSkillId } from '../../../main/skill-pipeline'
import { MaintenanceSkillsPanel } from './MaintenanceSkillsPanel'
import { GROUPES_MAINTENANCE, SKILLS_MAINTENANCE } from './maintenance-skills'

/**
 * Vue Maintenance (conv-1101, 2026-10-22) : un bouton par skill d'entretien d'Autowin.
 *
 * Ce qui doit FAIRE ÉCHOUER ce fichier : une skill renommée ou supprimée de `skills/` sans retirer
 * son bouton (le clic enverrait une invocation que rien ne charge), une consigne qui ne commence plus
 * par `/<nom>` (le moteur ne reconnaîtrait pas la skill), ou un clic qui n'envoie rien.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let ecouteur: ((event: Event) => void) | undefined

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })

function poserApi(api: Record<string, unknown>): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  if (ecouteur) window.removeEventListener('autowin:prefill-conversation', ecouteur)
  ecouteur = undefined
  vi.restoreAllMocks()
})

describe('skills de maintenance — la liste', () => {
  it('chaque bouton vise une skill qui EXISTE dans skills/ et l’invoque en tête', () => {
    expect(SKILLS_MAINTENANCE.length).toBeGreaterThanOrEqual(10)
    for (const skill of SKILLS_MAINTENANCE) {
      const fichier = resolve(process.cwd(), 'skills', skill.nom, 'SKILL.md')
      expect(existsSync(fichier), `skills/${skill.nom}/SKILL.md`).toBe(true)
      expect(invokedSkillId(skill.prompt)).toBe(skill.nom)
    }
  })

  it('aucun doublon, et chaque skill appartient à un groupe affiché', () => {
    const noms = SKILLS_MAINTENANCE.map((s) => s.nom)
    expect(new Set(noms).size).toBe(noms.length)
    const groupes = new Set(GROUPES_MAINTENANCE.map((g) => g.id))
    for (const skill of SKILLS_MAINTENANCE) expect(groupes.has(skill.groupe)).toBe(true)
  })
})

describe('MaintenanceSkillsPanel — les boutons', () => {
  it('affiche un bouton par skill', async () => {
    poserApi({})
    await act(async () => root.render(<MaintenanceSkillsPanel />))
    for (const skill of SKILLS_MAINTENANCE) {
      const bouton = container.querySelector(`[data-testid="maintenance-skill-${skill.nom}"]`)
      expect(bouton, skill.nom).not.toBeNull()
      expect(bouton?.textContent).toContain(`/${skill.nom}`)
    }
  })

  it('un clic crée une conversation et y ENVOIE la skill', async () => {
    const conversationsCreate = vi.fn().mockResolvedValue({ id: 'conv-77' })
    const appCommand = vi.fn().mockResolvedValue(undefined)
    poserApi({
      roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'claude' } }),
      conversationsCreate,
      appCommand
    })
    const envoyes: Array<{ conversationId?: string; prompt?: string; send?: boolean }> = []
    ecouteur = (event) => envoyes.push((event as CustomEvent).detail)
    window.addEventListener('autowin:prefill-conversation', ecouteur)

    await act(async () => root.render(<MaintenanceSkillsPanel />))
    const bouton = container.querySelector(
      '[data-testid="maintenance-skill-gc"]'
    ) as HTMLButtonElement
    await act(async () => bouton.click())
    await flush()

    expect(conversationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude', title: expect.stringContaining('/gc') })
    )
    expect(appCommand).toHaveBeenCalledWith('navigate', { tab: 'chat' })
    expect(envoyes).toHaveLength(1)
    expect(envoyes[0]).toMatchObject({ conversationId: 'conv-77', send: true })
    expect(invokedSkillId(envoyes[0]?.prompt ?? '')).toBe('gc')
    expect(container.querySelector('[data-testid="maintenance-skills-erreur"]')).toBeNull()
  })

  it('sans modèle IA dans les rôles : n’ouvre rien et DIT pourquoi', async () => {
    const conversationsCreate = vi.fn()
    poserApi({ roles: vi.fn().mockResolvedValue({}), conversationsCreate })
    await act(async () => root.render(<MaintenanceSkillsPanel />))
    const bouton = container.querySelector(
      '[data-testid="maintenance-skill-maintenance"]'
    ) as HTMLButtonElement
    await act(async () => bouton.click())
    await flush()

    expect(conversationsCreate).not.toHaveBeenCalled()
    const erreur = container.querySelector('[data-testid="maintenance-skills-erreur"]')
    expect(erreur?.textContent).toContain('/maintenance')
    expect(erreur?.textContent).toContain('Routage')
  })
})
