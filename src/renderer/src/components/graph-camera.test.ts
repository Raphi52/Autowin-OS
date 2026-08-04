import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  readCameraView,
  rememberViewBeforeFocus,
  restoreView,
  type CameraHandle,
  type CameraView
} from './graph-camera'

function faux(
  position = { x: 10, y: 20, z: 30 },
  // `null` = pas de contrôles. `undefined` réactiverait la valeur par défaut et le test ne
  // vérifierait plus rien.
  target: { x: number; y: number; z: number } | null = { x: 1, y: 2, z: 3 }
) {
  const pose = vi.fn()
  const handle = {
    cameraPosition: ((...args: unknown[]) => {
      if (args.length === 0) return position
      pose(...args)
      return undefined
    }) as CameraHandle['cameraPosition'],
    controls: () => (target ? { target } : undefined)
  } as CameraHandle
  return { handle, pose }
}

describe('lire la vue courante', () => {
  it('rend la position ET ce que la caméra regarde', () => {
    // Sans la cible, on rendrait la position mais pas l'orientation : la vue resterait de travers.
    expect(readCameraView(faux().handle)).toEqual({
      position: { x: 10, y: 20, z: 30 },
      target: { x: 1, y: 2, z: 3 }
    })
  })

  it('sans contrôles, la cible retombe sur le centre plutôt que d’échouer', () => {
    expect(readCameraView(faux(undefined, null).handle)?.target).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('un graphe absent ou illisible ne fait pas échouer l’ouverture d’une fiche', () => {
    expect(readCameraView(null)).toBeUndefined()
    const casse = {
      cameraPosition: (() => {
        throw new Error('pas prêt')
      }) as never,
      controls: () => undefined
    } as CameraHandle
    expect(readCameraView(casse)).toBeUndefined()
  })
})

describe('mémoriser avant de s’approcher', () => {
  it('capture la vue d’où l’on part', () => {
    expect(rememberViewBeforeFocus(undefined, faux().handle)?.position).toEqual({
      x: 10,
      y: 20,
      z: 30
    })
  })

  it('n’écrase PAS une mémoire existante — c’est le cœur de la règle', () => {
    // En enchaînant deux nœuds sans refermer, écraser rendrait la vue du nœud intermédiaire :
    // un autre gros plan, pas l'endroit d'où l'utilisateur est parti.
    const origine: CameraView = { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } }
    expect(rememberViewBeforeFocus(origine, faux({ x: 99, y: 99, z: 99 }).handle)).toBe(origine)
  })
})

describe('rendre la vue en refermant', () => {
  it('repose exactement la position ET la cible mémorisées', () => {
    const { handle, pose } = faux()
    const memoire: CameraView = { position: { x: 5, y: 6, z: 7 }, target: { x: 8, y: 9, z: 10 } }
    restoreView(memoire, handle)
    expect(pose).toHaveBeenCalledWith({ x: 5, y: 6, z: 7 }, { x: 8, y: 9, z: 10 }, 700)
  })

  it('LIBÈRE la mémoire, sinon le clic suivant rejouerait une vue périmée', () => {
    const memoire: CameraView = { position: { x: 5, y: 6, z: 7 }, target: { x: 0, y: 0, z: 0 } }
    expect(restoreView(memoire, faux().handle)).toBeUndefined()
  })

  it('sans mémoire, ne touche pas à la caméra', () => {
    const { handle, pose } = faux()
    restoreView(undefined, handle)
    expect(pose).not.toHaveBeenCalled()
  })

  it('une caméra qui refuse ne bloque pas la fermeture de la fiche', () => {
    const casse = {
      cameraPosition: (() => {
        throw new Error('perdu')
      }) as never,
      controls: () => undefined
    } as CameraHandle
    expect(() =>
      restoreView({ position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } }, casse)
    ).not.toThrow()
  })
})

describe('le cycle complet', () => {
  it('consulter deux nœuds puis refermer ramène à la vue de DÉPART', () => {
    const { handle, pose } = faux({ x: 100, y: 0, z: 0 })
    let memoire = rememberViewBeforeFocus(undefined, handle) // clic sur la 1re étoile
    memoire = rememberViewBeforeFocus(memoire, faux({ x: 5, y: 5, z: 5 }).handle) // 2e étoile
    memoire = restoreView(memoire, handle) // fermeture du panneau
    expect(pose).toHaveBeenCalledWith({ x: 100, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }, 700)
    expect(memoire).toBeUndefined()
  })
})

describe('la vue du graphe utilise réellement cette mémoire', () => {
  // Un module parfait qu'on n'appelle pas laisse le bug intact : c'est le câblage qu'on vérifie ici.
  const source = readFileSync(new URL('./GraphView.tsx', import.meta.url), 'utf8')

  it('mémorise AVANT de rapprocher la caméra', () => {
    const memo = source.indexOf('rememberViewBeforeFocus(')
    const rapproche = source.indexOf('graphRef.current?.cameraPosition(', memo)
    expect(memo).toBeGreaterThan(-1)
    expect(rapproche).toBeGreaterThan(memo) // sinon on mémoriserait le gros plan lui-même
  })

  it('restaure la vue quand la fiche se ferme', () => {
    expect(source).toMatch(
      /function clearNodeSelection\(\): void \{[\s\S]{0,400}restoreView\(/
    )
  })

  it('réaffecte la mémoire au retour de restoreView, au lieu de la laisser périmée', () => {
    expect(source).toMatch(/viewBeforeFocusRef\.current = restoreView\(/)
  })
})
