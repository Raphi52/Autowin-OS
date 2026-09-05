import { describe, expect, it, vi } from 'vitest'
import { creerReprendreTout } from './resume-all-interrupted-runs'
import { StartupResumeQueue } from './startup-resume-queue'

type Etat = { runId: string }

function monter(
  etats: Etat[],
  options: Partial<{
    publie: (e: Etat) => boolean
    action: (e: Etat) => 'relancer' | 'rattacher' | 'bloquer' | 'ignorer'
    relancer: (e: Etat) => Promise<void>
  }> = {}
) {
  const queue = new StartupResumeQueue()
  const relancer = vi.fn(options.relancer ?? (async () => undefined))
  const api = creerReprendreTout<Etat>({
    listerRunsReprenables: () => etats,
    publicationDejaProuvee: options.publie ?? (() => false),
    actionDeReprise: options.action ?? (() => 'relancer'),
    mettreEnFile: (t) => queue.enqueue(t),
    relancer
  })
  return { api, relancer }
}

describe('Reprendre tout', () => {
  it('relance chaque run interrompu, un seul a la fois', async () => {
    const ordre: string[] = []
    let enCours = 0
    const { api, relancer } = monter([{ runId: 'a' }, { runId: 'b' }, { runId: 'c' }], {
      relancer: async (e) => {
        enCours += 1
        expect(enCours).toBe(1)
        ordre.push(e.runId)
        await Promise.resolve()
        enCours -= 1
      }
    })
    const resume = await api.reprendreTout()
    expect(resume.relances).toEqual(['a', 'b', 'c'])
    expect(ordre).toEqual(['a', 'b', 'c'])
    expect(relancer).toHaveBeenCalledTimes(3)
  })

  it('ne relance pas un run deja publie', async () => {
    const { api, relancer } = monter([{ runId: 'a' }, { runId: 'b' }], {
      publie: (e) => e.runId === 'a'
    })
    const resume = await api.reprendreTout()
    expect(resume.ignores).toEqual([{ runId: 'a', raison: 'deja-publie' }])
    expect(resume.relances).toEqual(['b'])
    expect(relancer).toHaveBeenCalledTimes(1)
  })

  it('ne relance pas par-dessus un agent encore vivant, ni sans preuve de fin', async () => {
    const { api, relancer } = monter([{ runId: 'vif' }, { runId: 'muet' }, { runId: 'fini' }], {
      action: (e) => (e.runId === 'vif' ? 'rattacher' : e.runId === 'muet' ? 'bloquer' : 'ignorer')
    })
    const resume = await api.reprendreTout()
    expect(resume.relances).toEqual([])
    expect(resume.ignores).toEqual([
      { runId: 'vif', raison: 'agent-vivant' },
      { runId: 'muet', raison: 'sans-preuve-de-fin' },
      { runId: 'fini', raison: 'terminal' }
    ])
    expect(relancer).not.toHaveBeenCalled()
  })

  it('un second clic pendant la reprise ne relance rien', async () => {
    let liberer!: () => void
    const { api, relancer } = monter([{ runId: 'a' }], {
      relancer: () => new Promise<void>((resolve) => (liberer = resolve))
    })
    const premier = api.reprendreTout()
    await vi.waitFor(() => expect(relancer).toHaveBeenCalledTimes(1))
    const second = await api.reprendreTout()
    expect(second.dejaEnCours).toBe(true)
    liberer()
    await premier
    expect(relancer).toHaveBeenCalledTimes(1)
    expect(api.enCours()).toBe(false)
  })

  it('une relance rouge n empeche pas les suivantes', async () => {
    const vus: string[] = []
    const { api } = monter([{ runId: 'a' }, { runId: 'b' }], {
      relancer: async (e) => {
        vus.push(e.runId)
        if (e.runId === 'a') throw new Error('run rouge')
      }
    })
    const resume = await api.reprendreTout()
    expect(vus).toEqual(['a', 'b'])
    expect(resume.relances).toEqual(['a', 'b'])
  })
})
