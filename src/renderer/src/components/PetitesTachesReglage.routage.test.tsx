// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PetitesTachesReglage } from './PetitesTachesReglage'

/**
 * L'interrupteur « les questions du chat passent par ce modèle » est visible dans le bloc des petites
 * tâches (Agent Studio et Routage), coché par défaut, et sa case écrit le réglage dans le processus
 * principal. Décocher doit rendre TOUT au modèle du chat, sans rien casser d'autre.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let setRoutage: ReturnType<typeof vi.fn>
let etatRoutage = true

const monter = async (modeleSeul = false): Promise<void> => {
  await act(async () =>
    root.render(
      <PetitesTachesReglage
        active
        idBase="studio"
        testId="studio"
        models={[]}
        catalogLoaded
        modeleSeul={modeleSeul}
      />
    )
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const caseRoutage = (): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>('[data-testid="studio-routage"] input[type="checkbox"]')

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setRoutage = vi.fn(async (actif: boolean) => {
    etatRoutage = actif
    return {
      reglage: null,
      effectif: { provider: 'claude', model: 'haiku', reasoningEffort: 'low' },
      routageChat: etatRoutage
    }
  })
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    petitesTaches: async () => ({
      reglage: null,
      effectif: { provider: 'claude', model: 'haiku', reasoningEffort: 'low' },
      routageChat: etatRoutage
    }),
    setRoutageChatLectureSeule: setRoutage,
    onAppEvent: () => () => undefined
  }
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('PetitesTachesReglage — interrupteur du routage des questions du chat', () => {
  it('affiche la case, cochée quand le routage est actif', async () => {
    etatRoutage = true
    await monter()
    expect(caseRoutage()).not.toBeNull()
    expect(caseRoutage()?.checked).toBe(true)
  })

  it('décocher écrit le réglage « routage coupé » et décoche la case', async () => {
    etatRoutage = true
    await monter()
    await act(async () => {
      caseRoutage()?.click()
      await Promise.resolve()
    })
    expect(setRoutage).toHaveBeenCalledWith(false)
    expect(caseRoutage()?.checked).toBe(false)
  })

  it('modèle seul (Agent Studio) : ni case du routage ni retour au défaut', async () => {
    await monter(true)
    expect(container.querySelector('.model-select-shell, [data-testid="studio"]')).not.toBeNull()
    expect(caseRoutage()).toBeNull()
    expect(container.querySelector('.router-petites-taches-reset')).toBeNull()
  })

  it('affiche décochée quand le réglage est coupé dans roles.json', async () => {
    etatRoutage = false
    await monter()
    expect(caseRoutage()?.checked).toBe(false)
  })
})
