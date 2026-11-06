import { describe, expect, it } from 'vitest'
import { appliquerPresenceSysteme } from './os-presence-main'

function faux(): {
  appels: string[]
  fenetre: { isDestroyed(): boolean; setProgressBar(p: number, o?: { mode: string }): void }
  icone: { setToolTip(t: string): void }
  detruite: { valeur: boolean }
} {
  const appels: string[] = []
  const detruite = { valeur: false }
  return {
    appels,
    detruite,
    fenetre: {
      isDestroyed: () => detruite.valeur,
      setProgressBar: (p, o) => appels.push(`progress:${p}:${o?.mode}`)
    },
    icone: { setToolTip: (t) => appels.push(`tooltip:${t}`) }
  }
}

describe('application de la présence système', () => {
  it('pose la jauge ET le texte quand un run tourne', () => {
    const f = faux()
    appliquerPresenceSysteme(f, { runsActifs: 1, etapesFaites: 3, etapesTotales: 6 })
    expect(f.appels).toEqual(['progress:0.5:normal', 'tooltip:Autowin OS — 1 travail en cours'])
  })

  it('remet la jauge à -1 en fin de run', () => {
    const f = faux()
    appliquerPresenceSysteme(f, { runsActifs: 0, etapesFaites: 6, etapesTotales: 6 })
    expect(f.appels[0]).toBe('progress:-1:none')
  })

  it('ne touche pas une fenêtre détruite et survit à une cible absente', () => {
    const f = faux()
    f.detruite.valeur = true
    appliquerPresenceSysteme(f, { runsActifs: 2, etapesFaites: 1, etapesTotales: 4 })
    expect(f.appels).toEqual(['tooltip:Autowin OS — 2 travaux en cours'])
    expect(() =>
      appliquerPresenceSysteme({}, { runsActifs: 1, etapesFaites: 0, etapesTotales: 0 })
    ).not.toThrow()
  })
})
