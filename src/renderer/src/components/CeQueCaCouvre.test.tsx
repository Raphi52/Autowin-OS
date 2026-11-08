// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CeQueCaCouvre } from './CeQueCaCouvre'

/**
 * Le bloc « Ce que ça couvre » se replie, et ce choix est RETENU : au remontage (changement
 * d'écran, redémarrage) comme dans le second écran qui montre le même bloc.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const lignes = [
  { intitule: 'Couvre', explication: 'Le **choix** du workflow.' },
  { intitule: 'Ne couvre pas', explication: 'Les **réponses** du chat.' }
]

let container: HTMLDivElement
let root: Root

const monter = async (): Promise<void> => {
  await act(async () =>
    root.render(
      <>
        <CeQueCaCouvre id="petites-taches" titre="Ce que ça couvre" lignes={lignes} testId="a" />
        <CeQueCaCouvre id="petites-taches" titre="Ce que ça couvre" lignes={lignes} testId="b" />
        <CeQueCaCouvre id="judge" titre="Ce que ça couvre" lignes={lignes} testId="c" />
      </>
    )
  )
}
const bloc = (testId: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[data-testid="${testId}"]`) as HTMLElement
const deplie = (testId: string): boolean => bloc(testId).querySelector('dl') !== null
const cliquer = async (testId: string): Promise<void> => {
  await act(async () => bloc(testId).querySelector('button')?.click())
}

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('CeQueCaCouvre — repliable et retenu', () => {
  it('est déplié par défaut, avec le mot porteur en gras', async () => {
    await monter()
    expect(deplie('a')).toBe(true)
    expect(bloc('a').querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(bloc('a').querySelector('dd b')?.textContent).toBe('choix')
  })

  it('replié, il reste replié au remontage — les autres blocs ne bougent pas', async () => {
    await monter()
    await cliquer('a')
    expect(deplie('a')).toBe(false)
    expect(bloc('a').querySelector('button')?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => root.unmount())
    root = createRoot(container)
    await monter()
    expect(deplie('a')).toBe(false)
    expect(deplie('c')).toBe(true)
  })

  it('le même bloc montré dans un autre écran suit tout de suite', async () => {
    await monter()
    await cliquer('a')
    expect(deplie('b')).toBe(false)
    await cliquer('b')
    expect(deplie('a')).toBe(true)
  })
})
