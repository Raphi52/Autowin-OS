import { describe, expect, it } from 'vitest'
import { readQuotaReset } from './quota-reset'

/**
 * Les chaines ci-dessous sont VERBATIM celles relevees le 2026-08-12 sur les 883 conversations de
 * l'instance canary. Aucune n'est inventee : un lecteur de messages de quota teste sur des messages
 * imagines ne prouve rien le jour ou le provider parle.
 */
// 2026-08-04 10:00 UTC = 12:00 a Paris (CEST). Cale sur la DATE du message reel : son
// `resets_at` vaut 2026-08-08T05:20:19Z, donc bien dans le futur a cet instant.
const NOW = Date.UTC(2026, 7, 4, 10, 0)

describe('readQuotaReset — l’heure vient du refus, jamais d’une supposition', () => {
  it('privilégie `resets_at`, l’epoch du provider (2167 occurrences observées)', () => {
    const reason =
      'usage limit has been reached","plan_type":"pro","resets_at":1786166419,"eligible_promo":null,"resets_in_seconds":331932}'

    const read = readQuotaReset(reason, NOW)

    expect(read?.source).toBe('resets_at')
    expect(read?.at).toBe(1786166419 * 1000)
  })

  it('retombe sur `resets_in_seconds` quand l’epoch manque', () => {
    const read = readQuotaReset('usage limit has been reached","resets_in_seconds":3600}', NOW)

    expect(read?.source).toBe('resets_in_seconds')
    expect(read?.at).toBe(NOW + 3_600_000)
  })

  it('lit une heure locale AVEC son fuseau — « resets 5:30pm (Europe/Paris) »', () => {
    const read = readQuotaReset('hit your session limit · resets 5:30pm (Europe/Paris)', NOW)

    // 17h30 à Paris en CEST = 15h30 UTC, le jour même (il est 12h à Paris).
    expect(read?.source).toBe('clock')
    expect(new Date(read!.at).toISOString()).toBe('2026-08-04T15:30:00.000Z')
  })

  it('reporte au LENDEMAIN une heure déjà passée', () => {
    // Il est 12h à Paris ; « resets 2:10pm » serait aujourd'hui, « resets 9am » forcément demain.
    const read = readQuotaReset('hit your session limit · resets 9am (Europe/Paris)', NOW)

    expect(new Date(read!.at).toISOString()).toBe('2026-08-05T07:00:00.000Z')
  })

  it('lit une date en clair — « resets Jul 28, 2am (Europe/Paris) »', () => {
    // Une limite HEBDOMADAIRE repart à quelques jours : on se place donc à la date où ce message a
    // réellement été émis, pas dans un août qui renverrait à juillet PROCHAIN.
    const enJuillet = Date.UTC(2026, 6, 25, 10, 0)
    const read = readQuotaReset(
      'hit your weekly limit · resets Jul 28, 2am (Europe/Paris)',
      enJuillet
    )

    expect(read?.source).toBe('date')
    // 2h à Paris en CEST = 0h UTC, le 28.
    expect(new Date(read!.at).toISOString()).toBe('2026-07-28T00:00:00.000Z')
  })

  it('REFUSE une date au-delà de l’horizon plutôt que d’armer un réveil dans un an', () => {
    // « resets Jul 28 » lu un 4 août renverrait à juillet PROCHAIN : ce n'est plus un reset.
    expect(
      readQuotaReset('hit your weekly limit · resets Jul 28, 2am (Europe/Paris)', NOW)
    ).toBeUndefined()
  })

  it('lit la forme Codex — « try again at Aug 8th, 2027 »', () => {
    const read = readQuotaReset(
      'You hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026.',
      NOW
    )

    expect(read?.source).toBe('date')
    expect(new Date(read!.at).getUTCMonth()).toBe(7)
    expect(new Date(read!.at).getUTCDate()).toBe(8)
  })

  it('ne PROMET RIEN quand le mur n’annonce pas d’heure', () => {
    // Cas réel observé. Inventer une heure ferait se réveiller l'agent sur un mur encore debout :
    // il brûlerait un appel pour le découvrir, et recommencerait.
    expect(
      readQuotaReset('reached your Fable 5 limit. /model to switch models.', NOW)
    ).toBeUndefined()
  })

  it('refuse une heure PASSÉE ou aberrante plutôt que de la retenir', () => {
    expect(readQuotaReset('"resets_at":1000000000', NOW)).toBeUndefined()
    expect(readQuotaReset('"resets_at":9999999999999', NOW)).toBeUndefined()
    // Au-delà de 30 jours, ce n'est plus une heure de reset mais une valeur aberrante.
    expect(readQuotaReset('"resets_in_seconds":99999999', NOW)).toBeUndefined()
  })

  it('ignore un rate-limit passager sans heure', () => {
    expect(readQuotaReset('rate limit exceeded, retry after 30s', NOW)).toBeUndefined()
  })

  it('accepte l’epoch en millisecondes comme en secondes', () => {
    const seconds = readQuotaReset('"resets_at":1786166419', NOW)
    const millis = readQuotaReset('"resets_at":1786166419000', NOW)

    expect(seconds?.at).toBe(millis?.at)
  })
})
