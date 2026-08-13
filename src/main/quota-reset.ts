/**
 * QUAND le quota revient — lu dans le refus du provider, jamais deduit.
 *
 * Le registre refuse deliberement de SONDER (`providers/registry.ts` : « re-tester periodiquement si
 * le quota est revenu COUTERAIT du quota »). Cette objection est juste, et ce module ne la contredit
 * pas : il n'interroge personne. Le mur ANNONCE lui-meme son heure de retour, il suffit de la lire.
 *
 * Les quatre formes ci-dessous sont les seules observees reellement, relevees le 2026-08-12 sur les
 * 883 conversations de l'instance canary (2 167 occurrences pour la premiere) :
 *
 *  1. `"resets_at":1786166419` — epoch en secondes. Fait FOI quand il est la : c'est le provider qui
 *     parle, pas une interpretation de son texte.
 *  2. `"resets_in_seconds":331932` — duree relative, appliquee a l'instant du refus.
 *  3. `hit your session limit · resets 5:30pm (Europe/Paris)` — heure locale dans un fuseau nomme.
 *  4. `hit your usage limit. … try again at Aug 8th, 2026 …` — date en clair.
 *
 * Et une cinquieme forme qui n'annonce RIEN : `reached your Fable 5 limit. /model to switch models.`
 * Elle rend `undefined`. Inventer une heure serait pire que ne rien promettre : l'agent se reveillerait
 * sur un mur encore debout, brulerait un appel pour le decouvrir, et recommencerait.
 */

export interface QuotaResetReading {
  /** Instant du retour, en millisecondes epoch. */
  at: number
  /** Ce qui a permis de le lire — sert a expliquer une reprise a l'utilisateur. */
  source: 'resets_at' | 'resets_in_seconds' | 'clock' | 'date'
}

/** Au-dela, la valeur lue n'est pas une heure de reset : c'est une valeur aberrante. */
const MAX_HORIZON_MS = 30 * 24 * 3_600_000

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
}

/**
 * Decalage d'un fuseau NOMME a un instant donne, en minutes. Passer par `Intl` evite d'ecrire une
 * table de regles d'heure d'ete qui se perimerait — et « resets 5:30pm (Europe/Paris) » n'a de sens
 * que dans son fuseau, pas dans celui de la machine.
 */
function zoneOffsetMinutes(zone: string, at: number): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date(at))
    const get = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0')
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second')
    )
    return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000)
  } catch {
    return undefined
  }
}

/** Construit l'instant UTC correspondant a une heure murale dans un fuseau nomme. */
function instantInZone(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  const naive = Date.UTC(year, month, day, hour, minute)
  const offset = zoneOffsetMinutes(zone, naive)
  if (offset === undefined) return naive
  // Deuxieme passe : le decalage peut differer de part et d'autre d'un changement d'heure.
  const corrected = naive - offset * 60_000
  const settled = zoneOffsetMinutes(zone, corrected)
  return settled === undefined ? corrected : naive - settled * 60_000
}

export function readQuotaReset(reason: string, now: number): QuotaResetReading | undefined {
  const plausible = (
    at: number,
    source: QuotaResetReading['source']
  ): QuotaResetReading | undefined =>
    Number.isFinite(at) && at > now && at - now <= MAX_HORIZON_MS ? { at, source } : undefined

  // 1. L'epoch du provider fait foi.
  const epoch = /"?resets_at"?\s*[:=]\s*(\d{9,13})/i.exec(reason)
  if (epoch) {
    const raw = Number(epoch[1])
    const read = plausible(raw < 1e12 ? raw * 1000 : raw, 'resets_at')
    if (read) return read
  }

  // 2. La duree relative, appliquee a MAINTENANT (l'instant du refus).
  const relative = /"?resets_in_seconds"?\s*[:=]\s*(\d{1,8})/i.exec(reason)
  if (relative) {
    const read = plausible(now + Number(relative[1]) * 1000, 'resets_in_seconds')
    if (read) return read
  }

  const zone = /\(([A-Za-z]+\/[A-Za-z_+-]+)\)/.exec(reason)?.[1]

  // 3. Une date en clair : « resets Jul 28, 2am » ou « try again at Aug 8th, 2026 ».
  const dated =
    /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?(?:,?\s+at)?(?:,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(
      reason
    )
  if (dated && MONTHS[dated[1].toLowerCase()] !== undefined) {
    const month = MONTHS[dated[1].toLowerCase()]
    const day = Number(dated[2])
    const meridiem = dated[6]?.toLowerCase()
    let hour = dated[4] === undefined ? 0 : Number(dated[4])
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    const minute = dated[5] === undefined ? 0 : Number(dated[5])
    const reference = new Date(now)
    // Une annee absente veut dire « la prochaine fois que cette date arrive » : sans ce report, un
    // « resets Jan 3 » lu un 28 decembre renverrait dans le passe et la reprise ne partirait jamais.
    for (const year of [
      dated[3] ? Number(dated[3]) : reference.getUTCFullYear(),
      reference.getUTCFullYear() + 1
    ]) {
      const at = zone
        ? instantInZone(zone, year, month, day, hour, minute)
        : Date.UTC(year, month, day, hour, minute)
      const read = plausible(at, 'date')
      if (read) return read
      if (dated[3]) break
    }
  }

  // 4. Une heure seule : « resets 5:30pm (Europe/Paris) » — aujourd'hui, ou demain si deja passee.
  const clock = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(reason)
  if (clock) {
    const meridiem = clock[3].toLowerCase()
    let hour = Number(clock[1])
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    const minute = clock[2] === undefined ? 0 : Number(clock[2])
    const zoneName = zone ?? 'UTC'
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zoneName,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(now))
    const num = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0')
    for (const dayShift of [0, 1]) {
      const at = instantInZone(
        zoneName,
        num('year'),
        num('month') - 1,
        num('day') + dayShift,
        hour,
        minute
      )
      const read = plausible(at, 'clock')
      if (read) return read
    }
  }

  return undefined
}
