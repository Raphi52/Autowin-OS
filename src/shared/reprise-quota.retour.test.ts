import { describe, expect, it } from 'vitest'
import { instantDeRetourAnnonce } from './reprise-quota'

/**
 * Les textes de ce fichier sont RECOPIÉS de `.autowin-data/autowin-os/causal-trace/*.jsonl`
 * (relevé du 2026-09-16) : ce sont les refus que Claude a réellement écrits, pas des exemples.
 */
describe("instantDeRetourAnnonce — l'heure que le refus promet", () => {
  const refusReel = 'session limit · resets 3:20pm (Europe/Paris)'

  it('rend l’instant de 15h20 à Paris quand le refus tombe à 15h05', () => {
    const maintenant = new Date('2026-09-15T13:05:00Z') // 15h05 à Paris (UTC+2 en septembre)
    expect(instantDeRetourAnnonce(refusReel, maintenant)).toBe(
      new Date('2026-09-15T13:20:00Z').valueOf()
    )
  })

  it('rend une heure DÉJÀ PASSÉE comme échéance du lendemain, jamais comme instant passé', () => {
    // 15h31 à Paris : les deux refus réellement enregistrés ce jour-là, 11 minutes APRÈS 15h20.
    const maintenant = new Date('2026-09-15T13:31:00Z')
    const retour = instantDeRetourAnnonce(refusReel, maintenant)
    expect(retour).toBeGreaterThan(maintenant.valueOf())
    expect(retour).toBe(new Date('2026-09-16T13:20:00Z').valueOf())
  })

  it('lit « resets 6pm » sans minutes et « resets 2am » qui bascule au lendemain', () => {
    const soir = new Date('2026-09-15T13:00:00Z') // 15h à Paris
    expect(instantDeRetourAnnonce('session limit · resets 6pm (Europe/Paris)', soir)).toBe(
      new Date('2026-09-15T16:00:00Z').valueOf()
    )
    const nuit = new Date('2026-09-15T21:00:00Z') // 23h à Paris
    expect(instantDeRetourAnnonce('session limit · resets 2am (Europe/Paris)', nuit)).toBe(
      new Date('2026-09-16T00:00:00Z').valueOf()
    )
  })

  it('ne devine rien quand le refus n’annonce aucune heure', () => {
    expect(instantDeRetourAnnonce('Claude usage limit reached')).toBeUndefined()
    expect(instantDeRetourAnnonce('')).toBeUndefined()
    expect(instantDeRetourAnnonce(undefined)).toBeUndefined()
  })

  it('ignore un fuseau illisible plutôt que de le remplacer par celui du poste', () => {
    expect(
      instantDeRetourAnnonce('session limit · resets 3:20pm (Mars/Olympus_Mons)', new Date())
    ).toBeUndefined()
  })
})
