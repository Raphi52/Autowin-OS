// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PetitesTachesReglage } from './PetitesTachesReglage'

/**
 * Le modèle des petites tâches dit ce qu'il couvre, dans Agent Studio comme dans Réglages : le même
 * bloc, la même mémoire repliée. Les usages affirmés sont ceux qui appellent
 * `bindingDesPetitesTaches` dans le processus principal (choix du workflow, deux lectures,
 * rangement du premier message, arbitrage d'une dérive, relecture du cadrage, message de commit,
 * condensé d'une note du Brain).
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const monterDeuxEcrans = async (): Promise<void> => {
  await act(async () =>
    root.render(
      <>
        <PetitesTachesReglage active idBase="studio" testId="studio" models={[]} catalogLoaded />
        <PetitesTachesReglage
          active
          idBase="reglages"
          testId="reglages"
          models={[]}
          catalogLoaded
        />
      </>
    )
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const bloc = (ecran: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="${ecran}-couvre"]`)

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    petitesTaches: async () => ({
      reglage: null,
      effectif: { provider: 'claude', model: 'haiku', reasoningEffort: 'low' }
    }),
    onAppEvent: () => () => undefined
  }
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('Petites tâches — ce que ça couvre', () => {
  it('nomme chacun de ses usages et ce qu’il ne couvre pas', async () => {
    await monterDeuxEcrans()
    const texte = bloc('studio')?.textContent ?? ''
    for (const usage of [
      'choisir le workflow',
      'deux lectures',
      'rangement du premier message',
      'arbitre une dérive',
      'relit à froid le cadrage',
      'écrit le message de commit',
      'condense une note du Brain',
      'réponses du chat'
    ]) {
      expect(texte).toContain(usage)
    }
  })

  it('replié dans un écran, il l’est aussi dans l’autre', async () => {
    await monterDeuxEcrans()
    await act(async () => bloc('studio')?.querySelector('button')?.click())
    expect(bloc('studio')?.querySelector('dl')).toBeNull()
    expect(bloc('reglages')?.querySelector('dl')).toBeNull()
  })
})
