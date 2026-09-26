import { describe, expect, it } from 'vitest'
import { presenceSysteme } from './os-presence'

describe('présence système des runs', () => {
  it('efface la jauge et garde le texte de repos quand rien ne tourne', () => {
    const p = presenceSysteme({ runsActifs: 0, etapesFaites: 3, etapesTotales: 6 })
    expect(p.progression).toBe(-1)
    expect(p.mode).toBe('none')
    expect(p.infobulle).toBe('Autowin OS — actif (les runs continuent fenêtre fermée)')
  })

  it('donne trois textes distincts pour 0, 1 et 3 runs', () => {
    const textes = [0, 1, 3].map(
      (n) => presenceSysteme({ runsActifs: n, etapesFaites: 0, etapesTotales: 0 }).infobulle
    )
    expect(new Set(textes).size).toBe(3)
    expect(textes[1]).toBe('Autowin OS — 1 travail en cours')
    expect(textes[2]).toBe('Autowin OS — 3 travaux en cours')
  })

  it('remplit la jauge à la fraction des étapes faites', () => {
    expect(presenceSysteme({ runsActifs: 1, etapesFaites: 3, etapesTotales: 6 })).toMatchObject({
      progression: 0.5,
      mode: 'normal'
    })
  })

  it('passe en indéterminé quand le plan est inconnu, sans jamais sortir de 0..1', () => {
    expect(presenceSysteme({ runsActifs: 2, etapesFaites: 0, etapesTotales: 0 }).mode).toBe(
      'indeterminate'
    )
    const trop = presenceSysteme({ runsActifs: 1, etapesFaites: 99, etapesTotales: 6 })
    expect(trop.progression).toBe(1)
    expect(presenceSysteme({ runsActifs: 1, etapesFaites: -5, etapesTotales: 6 }).progression).toBe(
      0
    )
  })
})
