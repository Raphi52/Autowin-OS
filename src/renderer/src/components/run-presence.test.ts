import { describe, expect, it } from 'vitest'
import { presenceDepuisRunsVivants } from './run-presence'
import { presenceSysteme } from '../../../shared/os-presence'

describe('présence des runs vivants vue de la fenêtre', () => {
  it('ne compte que les runs en cours, et additionne leurs étapes', () => {
    const etat = presenceDepuisRunsVivants({
      a: { status: 'running', steps: [1, 2] },
      b: { status: 'green', steps: [1, 2, 3] },
      c: { status: 'running', steps: [1] },
      d: undefined
    })
    expect(etat).toEqual({ runsActifs: 2, etapesFaites: 3, etapesTotales: 0 })
    expect(presenceSysteme(etat).infobulle).toBe('Autowin OS — 2 travaux en cours')
  })

  it('rend un état de repos quand plus rien ne tourne', () => {
    const etat = presenceDepuisRunsVivants({ a: { status: 'green', steps: [1] } })
    expect(etat.runsActifs).toBe(0)
    expect(presenceSysteme(etat).progression).toBe(-1)
  })
})
