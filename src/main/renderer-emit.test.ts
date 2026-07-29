import { describe, expect, it, vi } from 'vitest'
import { emitToLiveWindows, type EmitTarget } from './renderer-emit'

/**
 * LE ROUGE D'ABORD — ce que faisait `event.sender.send` sur une fenêtre fermée.
 *
 * Défaut constaté (index.ts:663 et :1397) : les deux flux longs émettaient vers le WebContents
 * CAPTURÉ au lancement de l'appel. L'app revendique pourtant la survie à la fermeture de fenêtre.
 * Le premier cas ci-dessous reproduit l'erreur réelle d'Electron (« Object has been destroyed ») et
 * prouve qu'elle ne traverse plus la frontière d'émission.
 */
const live = (): EmitTarget & { sent: unknown[] } => {
  const sent: unknown[] = []
  return {
    sent,
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: (_c, p) => void sent.push(p) }
  }
}

/** Fenêtre détruite façon Electron : `send()` lève. */
const destroyedThrowing = (): EmitTarget => ({
  isDestroyed: () => true,
  webContents: {
    isDestroyed: () => true,
    send: () => {
      throw new Error('Object has been destroyed')
    }
  }
})

describe('emitToLiveWindows — émettre ne peut JAMAIS casser le tour', () => {
  it('une fenêtre DÉTRUITE ne provoque aucune exception (le rouge d’origine)', () => {
    expect(() => emitToLiveWindows([destroyedThrowing()], 'pilot:event', { a: 1 })).not.toThrow()
    expect(emitToLiveWindows([destroyedThrowing()], 'pilot:event', {})).toEqual({
      delivered: 0,
      skipped: 1
    })
  })

  it('une fenêtre qui jette MALGRÉ un isDestroyed() faux (course réelle) est absorbée', () => {
    const racing: EmitTarget = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: () => {
          throw new Error('Object has been destroyed')
        }
      }
    }
    expect(() => emitToLiveWindows([racing], 'orchestrate:step', {})).not.toThrow()
    expect(emitToLiveWindows([racing], 'orchestrate:step', {}).skipped).toBe(1)
  })

  it('une fenêtre morte n’empêche PAS les vivantes de recevoir', () => {
    const vivante = live()
    const result = emitToLiveWindows([destroyedThrowing(), vivante], 'pilot:event', { n: 7 })
    expect(result).toEqual({ delivered: 1, skipped: 1 })
    expect(vivante.sent).toEqual([{ n: 7 }])
  })

  it('AUCUNE fenêtre ouverte → aucun envoi, aucune erreur (le tour continue en tray)', () => {
    expect(emitToLiveWindows([], 'pilot:event', {})).toEqual({ delivered: 0, skipped: 0 })
  })
})

describe('emitToLiveWindows — diffusion', () => {
  it('émet vers TOUTES les fenêtres vivantes (rouvrir une fenêtre la rebranche)', () => {
    const a = live()
    const b = live()
    const result = emitToLiveWindows([a, b], 'pilot:event', { delta: 'x' })
    expect(result.delivered).toBe(2)
    expect(a.sent).toEqual([{ delta: 'x' }])
    expect(b.sent).toEqual([{ delta: 'x' }])
  })

  it('transmet le canal et la charge EXACTS', () => {
    const send = vi.fn()
    emitToLiveWindows(
      [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }],
      'orchestrate:step',
      { step: 'exec', costUsd: 1.5 }
    )
    expect(send).toHaveBeenCalledWith('orchestrate:step', { step: 'exec', costUsd: 1.5 })
  })

  it('tolère une fenêtre sans webContents (état transitoire) sans jeter', () => {
    expect(() => emitToLiveWindows([{ isDestroyed: () => false }], 'pilot:event', {})).not.toThrow()
    expect(emitToLiveWindows([{}], 'pilot:event', {}).skipped).toBe(1)
  })
})

/**
 * Contrat de CABLAGE : le patron fautif ne doit pas revenir. `event.sender.send` cible le WebContents
 * capture au lancement de l'appel — incompatible avec la survie a la fermeture de fenetre que l'app
 * revendique (index.ts:213, « le process main reste vivant en TRAY »).
 */
describe('cablage — plus aucune emission vers un WebContents capture', () => {
  const main = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8')
  }

  it('aucun `event.sender.send` ne subsiste', () => {
    expect(main()).not.toContain('event.sender.send')
  })

  it('les deux flux longs passent par la diffusion sure', () => {
    const source = main()
    expect(source).toContain("emitToLiveWindows(BrowserWindow.getAllWindows(), 'orchestrate:step'")
    expect(source).toContain("emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event'")
  })
})
