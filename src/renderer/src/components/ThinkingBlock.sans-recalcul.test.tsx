// @vitest-environment happy-dom
/**
 * LE BATTEMENT DU CHRONO NE RECALCULE PLUS LE TOUR (2026-10-31).
 *
 * Le chrono redessine `ThinkingBlock` chaque seconde pendant un tour. Tout y était recalculé depuis le
 * journal et la liste d'actions se redessinait entière : `actionsDuTour`, `sousCommandes` et les lignes
 * de la frise faisaient environ la moitié des 2 Go alloués en 90 s par l'interface pendant un tour
 * (échantillonnage du tas sur l'app ouverte, 22 Mo/s).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : `actionsDuTour` rappelée à chaque battement ; une frise sans
 * `memo`, ou dont `refCorps` est une fonction neuve à chaque rendu.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThinkingBlock } from './ThinkingBlock'
import { actionsDuTour, sousCommandes } from './thinking-block-corps'

const compteurs = vi.hoisted(() => ({ lignesDeFrise: 0 }))

vi.mock('./thinking-block-corps', async (original) => {
  const module = await original<typeof import('./thinking-block-corps')>()
  return { ...module, actionsDuTour: vi.fn(module.actionsDuTour) }
})

// `t` est appelé une fois par ligne de la frise (infobulle de l'état) : compter ces clés compte les
// rendus de la liste, sans dépendre du nom interne des composants.
vi.mock('../textes-ecrans/chat-decisions', async (original) => {
  const module = await original<typeof import('../textes-ecrans/chat-decisions')>()
  return {
    ...module,
    useTextesChatDecisions: () => {
      const textes = module.useTextesChatDecisions()
      return {
        ...textes,
        t: ((...args: Parameters<typeof textes.t>) => {
          if (String(args[0]).startsWith('pensee.action.')) compteurs.lignesDeFrise += 1
          return textes.t(...args)
        }) as typeof textes.t
      }
    }
  }
})

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACTIONS = 50
const journal = Array.from({ length: ACTIONS }, (_, i) => `Read · src/fichier-${i}.ts`)

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(actionsDuTour).mockClear()
  compteurs.lignesDeFrise = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.useRealTimers()
})

const rendre = (statusLog: string[]): void => {
  act(() =>
    root!.render(
      createElement(ThinkingBlock, { text: 'pensée', done: false, statusLog, turnId: 'tour-1' })
    )
  )
}

const battre = (secondes: number): void => {
  act(() => {
    vi.advanceTimersByTime(secondes * 1000)
  })
}

describe('ThinkingBlock — battement du chrono', () => {
  it('ne relit pas le journal à chaque seconde', () => {
    rendre(journal)
    battre(2)
    const apresMontage = vi.mocked(actionsDuTour).mock.calls.length
    battre(10)
    expect(vi.mocked(actionsDuTour).mock.calls.length).toBe(apresMontage)
  })

  it('ne redessine pas la liste d’actions à chaque seconde', () => {
    rendre(journal)
    battre(2)
    const apresMontage = compteurs.lignesDeFrise
    expect(apresMontage).toBeGreaterThanOrEqual(ACTIONS)
    battre(10)
    expect(compteurs.lignesDeFrise).toBe(apresMontage)
  })

  it('une action de plus au journal se voit toujours', () => {
    rendre(journal)
    battre(2)
    rendre([...journal, 'Read · src/nouveau.ts'])
    expect(host!.textContent).toContain('src/nouveau.ts')
  })
})

describe('sousCommandes — découpe inchangée', () => {
  it('coupe hors guillemets, garde les tubes, les antislashs et les here-docs', () => {
    expect(sousCommandes('cd a && git log | head -3; echo "x && y"\nls || true')).toEqual([
      'cd a',
      'git log | head -3',
      'echo "x && y"',
      'ls',
      'true'
    ])
    expect(sousCommandes(`echo 'a;b' ; echo \\; suite`)).toEqual(["echo 'a;b'", 'echo \\; suite'])
    expect(sousCommandes('cat > f <<EOF\nune ligne\nune autre\nEOF')).toEqual([
      'cat > f <<EOF\nune ligne\nune autre\nEOF'
    ])
    expect(sousCommandes('a & b')).toEqual(['a & b'])
    expect(sousCommandes(' ; && ')).toEqual([])
  })

  it('ne dépend pas de la taille d’une commande (un here-doc de 200 ko passe d’un bloc)', () => {
    const longue = `cat <<EOF\n${'x'.repeat(200_000)}\nEOF`
    expect(sousCommandes(longue)).toEqual([longue])
  })
})
