import { describe, expect, it } from 'vitest'
import { lineFingerprint } from './watchdog-line'
import { DEFAULT_WATCHDOG_GUARDS, WatchdogGuardBook, lineSignature } from './watchdog-guards'
import type { WatchdogGuards } from './types'

const guards = (patch: Partial<WatchdogGuards> = {}): WatchdogGuards => ({
  ...DEFAULT_WATCHDOG_GUARDS,
  ...patch
})

/** Horloge pilotee : ces gardes sont des fonctions du TEMPS, les eprouver en temps reel serait flaky. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let value = start
  return { now: () => value, advance: (ms) => (value += ms) }
}

describe('WatchdogGuardBook — les bornes du reveil evenementiel', () => {
  it('admet un signal nouveau', () => {
    const book = new WatchdogGuardBook(guards(), clock().now)
    expect(book.admit('erreur A', 0).admitted).toBe(true)
  })

  it('ANTI-RECURSION : refuse un reveil ne d un reveil, par defaut', () => {
    // Le cas exact du cadrage : une reparation en autorite `auto` reecrit dans le fichier surveille.
    const book = new WatchdogGuardBook(guards(), clock().now)

    expect(book.admit('erreur A', 0).admitted).toBe(true)
    const chained = book.admit('erreur B', 1)

    expect(chained.admitted).toBe(false)
    expect(chained.admitted === false && chained.reason).toBe('depth')
  })

  it('autorise une chaine seulement si elle a ete demandee explicitement', () => {
    const book = new WatchdogGuardBook(guards({ maxChainDepth: 1 }), clock().now)

    expect(book.admit('a', 1).admitted).toBe(true)
    const tooDeep = book.admit('b', 2)
    expect(tooDeep.admitted === false && tooDeep.reason).toBe('depth')
  })

  it('DEDUP : le meme signal dans la fenetre est ignore, puis re-admis apres', () => {
    const time = clock()
    const book = new WatchdogGuardBook(guards({ dedupWindowMs: 60_000 }), time.now)

    expect(book.admit('meme erreur', 0).admitted).toBe(true)
    time.advance(59_000)
    const suppressed = book.admit('meme erreur', 0)
    expect(suppressed.admitted === false && suppressed.reason).toBe('dedup')

    time.advance(2_000)
    expect(book.admit('meme erreur', 0).admitted).toBe(true)
  })

  it('un signal DIFFERENT n est pas etouffe par la fenetre d un autre', () => {
    const book = new WatchdogGuardBook(guards(), clock().now)

    expect(book.admit('erreur A', 0).admitted).toBe(true)
    expect(book.admit('erreur B', 0).admitted).toBe(true)
  })

  it('RAFALE : 100 signaux distincts produisent un nombre BORNE de reveils, pas 100', () => {
    // Le DoD du cadrage, verbatim.
    const book = new WatchdogGuardBook(
      guards({ maxTriggersPerHour: 12, dedupWindowMs: 0 }),
      clock().now
    )

    const admitted = Array.from({ length: 100 }, (_, i) => book.admit(`erreur ${i}`, 0)).filter(
      (verdict) => verdict.admitted
    ).length

    expect(admitted).toBe(12)
  })

  it('le plafond est GLISSANT : il se libere une heure plus tard', () => {
    const time = clock()
    const book = new WatchdogGuardBook(
      guards({ maxTriggersPerHour: 2, dedupWindowMs: 0 }),
      time.now
    )

    expect(book.admit('a', 0).admitted).toBe(true)
    expect(book.admit('b', 0).admitted).toBe(true)
    expect(book.admit('c', 0).admitted).toBe(false)

    time.advance(3_600_001)
    expect(book.admit('d', 0).admitted).toBe(true)
  })

  it('un signal REFUSE ne consomme pas le budget horaire', () => {
    // Sinon une rafale refusee murerait la regle contre le signal legitime qui suit.
    const time = clock()
    const book = new WatchdogGuardBook(
      guards({ maxTriggersPerHour: 2, dedupWindowMs: 60_000 }),
      time.now
    )

    expect(book.admit('repetee', 0).admitted).toBe(true)
    for (let i = 0; i < 50; i += 1) expect(book.admit('repetee', 0).admitted).toBe(false)

    expect(book.admittedLastHour()).toBe(1)
    expect(book.admit('nouvelle', 0).admitted).toBe(true)
  })

  it('la profondeur est evaluee AVANT le budget : une boucle ne vide pas le quota', () => {
    const book = new WatchdogGuardBook(
      guards({ maxTriggersPerHour: 2, dedupWindowMs: 0 }),
      clock().now
    )

    for (let i = 0; i < 20; i += 1) expect(book.admit(`chaine ${i}`, 1).admitted).toBe(false)

    expect(book.admittedLastHour()).toBe(0)
    expect(book.admit('vrai signal', 0).admitted).toBe(true)
  })
})

describe('lineSignature — ce qui compte comme « le meme incident »', () => {
  it('neutralise l horodatage : deux occurrences du meme incident ont la meme signature', () => {
    const a = '2026-08-08T10:12:31.442Z ERROR connexion perdue'
    const b = '2026-08-08T10:19:07.001Z ERROR connexion perdue'

    expect(lineSignature(a)).toBe(lineSignature(b))
  })

  it('neutralise nombres, uuid et adresses hexa', () => {
    const a = 'ERROR pid 4821 job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 at 0xdeadbeef'
    const b = 'ERROR pid 991 job 8a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9 at 0x00ff12'

    expect(lineSignature(a)).toBe(lineSignature(b))
  })

  it('garde DISTINCTS deux incidents reellement differents', () => {
    expect(lineSignature('ERROR connexion perdue')).not.toBe(lineSignature('ERROR disque plein'))
  })
})

describe('largeur de cascade — la garde que la profondeur seule ne remplace pas', () => {
  it('borne le nombre de reveils issus d une MEME cause racine', () => {
    // Mesure du depot (2026-08-04, AutoKaizenLimits) : maxDepth TENAIT pendant que la cascade
    // s'elargissait 8 -> 11 -> 104 -> 681 par niveau. Chaque signal est distinct (donc le dedup ne
    // mord pas) et de profondeur 0 (donc la garde de profondeur ne mord pas) : seule la largeur
    // peut arreter ca.
    const book = new WatchdogGuardBook(
      guards({ maxPerRoot: 20, maxTriggersPerHour: 1000, dedupWindowMs: 0 }),
      clock().now
    )

    const admitted = Array.from({ length: 681 }, (_, i) =>
      book.admit(`symptome distinct ${i}`, 0, 'la meme panne racine')
    ).filter((verdict) => verdict.admitted).length

    expect(admitted).toBe(20)
  })

  it('nomme le refus « largeur », pas « profondeur » — le diagnostic doit etre juste', () => {
    const book = new WatchdogGuardBook(guards({ maxPerRoot: 1, dedupWindowMs: 0 }), clock().now)
    book.admit('a', 0, 'racine')

    const refused = book.admit('b', 0, 'racine')
    expect(refused.admitted).toBe(false)
    expect(refused.admitted === false && refused.reason).toBe('root-width')
    expect(refused.admitted === false && refused.detail).toContain('largeur')
  })

  it('deux causes racines DIFFERENTES ne se partagent pas le plafond', () => {
    const book = new WatchdogGuardBook(guards({ maxPerRoot: 1, dedupWindowMs: 0 }), clock().now)

    expect(book.admit('x', 0, 'panne A').admitted).toBe(true)
    expect(book.admit('y', 0, 'panne B').admitted).toBe(true)
  })

  it('oublie une cause racine après une heure au lieu de la bloquer à vie', () => {
    const time = clock()
    const book = new WatchdogGuardBook(
      guards({ maxPerRoot: 1, maxTriggersPerHour: 3, dedupWindowMs: 0 }),
      time.now
    )

    expect(book.admit('premier', 0, 'racine').admitted).toBe(true)
    expect(book.admit('deuxième', 0, 'racine').admitted).toBe(false)
    time.advance(3_600_001)

    expect(book.admit('troisième', 0, 'racine').admitted).toBe(true)
  })

  it('une cascade trop large ne consomme pas le budget horaire de la regle', () => {
    // Sinon elle etoufferait les signaux legitimes en plus de se propager.
    const book = new WatchdogGuardBook(
      guards({ maxPerRoot: 1, maxTriggersPerHour: 3, dedupWindowMs: 0 }),
      clock().now
    )
    book.admit('premier', 0, 'racine')
    for (let i = 0; i < 50; i += 1) book.admit(`symptome ${i}`, 0, 'racine')

    expect(book.admittedLastHour()).toBe(1)
    expect(book.admit('signal sans rapport', 0, 'autre racine').admitted).toBe(true)
  })
})

describe('lineFingerprint - attribution exacte d une ecriture', () => {
  it('ne confond pas deux lignes que la deduplication normalise ensemble', () => {
    expect(lineFingerprint('ERROR commande 41')).not.toBe(lineFingerprint('ERROR commande 42'))
  })
})
