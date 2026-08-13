import { describe, expect, it } from 'vitest'
import { planQuotaResume } from './quota-resume'

const NOW = Date.UTC(2026, 7, 4, 10, 0) // 12:00 à Paris (CEST)
const base = { conversationId: 'conv-7', now: NOW, timeZone: 'Europe/Paris' }

describe('planQuotaResume — une reprise ARMÉE, pas une sonde', () => {
  it('arme une tâche à l’heure ANNONCÉE par le refus', () => {
    const plan = planQuotaResume({
      ...base,
      reason: 'hit your session limit · resets 5:30pm (Europe/Paris)'
    })

    expect(plan?.task.schedule).toEqual({
      startDate: '2026-08-04',
      time: '17:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'none', interval: 1 }
    })
  })

  it('reprend dans LA conversation interrompue, pas dans une nouvelle', () => {
    const plan = planQuotaResume({ ...base, reason: '"resets_in_seconds":3600' })

    expect(plan?.task.destination).toEqual({ kind: 'existing', conversationId: 'conv-7' })
  })

  it('ne se rejoue JAMAIS : un quota épuisé n’est pas un rendez-vous quotidien', () => {
    const plan = planQuotaResume({ ...base, reason: '"resets_in_seconds":3600' })

    expect(plan?.task.schedule?.recurrence).toEqual({ unit: 'none', interval: 1 })
  })

  it('n’arme RIEN quand le refus n’annonce pas d’heure', () => {
    // Cas réel : armer une reprise à une heure inventée réveillerait l'agent sur un mur debout.
    expect(
      planQuotaResume({ ...base, reason: 'reached your Fable 5 limit. /model to switch models.' })
    ).toBeUndefined()
  })

  it('n’arme rien sans conversation à reprendre', () => {
    expect(
      planQuotaResume({ ...base, conversationId: '  ', reason: '"resets_in_seconds":3600' })
    ).toBeUndefined()
  })

  it('le prompt DIT d’où vient l’heure et interdit de foncer si le mur tient encore', () => {
    const plan = planQuotaResume({
      ...base,
      reason: 'hit your session limit · resets 5:30pm (Europe/Paris)',
      interrupted: 'Migration du Task Manager, phase build'
    })

    // La PROVENANCE de l'heure est citée : une reprise doit pouvoir s'expliquer après coup.
    expect(plan?.source).toBe('clock')
    expect(plan?.task.prompt).toContain('`clock`')
    expect(plan?.task.prompt).toContain('Migration du Task Manager')
    expect(plan?.task.prompt).toContain('mur encore debout')
    expect(plan?.task.prompt).toContain('relis les derniers messages')
  })

  it('le titre annonce l’heure, pour qu’une reprise armée se VOIE', () => {
    const plan = planQuotaResume({ ...base, reason: '"resets_at":1786166419' })

    expect(plan?.task.title).toContain('Reprise après quota')
    expect(plan?.task.enabled).toBe(true)
  })

  it('gère minuit sans produire une heure invalide', () => {
    const plan = planQuotaResume({ ...base, reason: 'resets 12am (Europe/Paris)' })

    expect(plan?.task.schedule?.time).toBe('00:00')
  })
})
