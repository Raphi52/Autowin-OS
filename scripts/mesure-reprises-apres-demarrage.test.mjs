import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  causesDeFermeture,
  lireDemarrages,
  mesurer,
  mediane,
  reprisesDuJournal
} from './mesure-reprises-apres-demarrage.mjs'

/**
 * Le chantier « moteur remplaçable » (conv-1338) se décide sur ces chiffres : ils doivent se
 * rejouer, et une ligne abîmée d'un journal ne doit ni faire planter la mesure ni la fausser.
 */
const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'mesure-reprises-apres-demarrage.mjs'
)

const ligneDemarrage = (ts, moteur, total) =>
  JSON.stringify({
    ts,
    pid: 1,
    jalons: [
      { etape: "chargement de l'interface demandé", ms: moteur },
      { etape: 'interface chargée', ms: total }
    ]
  })

describe('lireDemarrages', () => {
  it('sépare le temps du moteur de celui de la fenêtre', () => {
    expect(lireDemarrages(ligneDemarrage('2026-10-30T10:00:00.000Z', 1000, 8000))).toEqual([
      { ts: Date.parse('2026-10-30T10:00:00.000Z'), moteurMs: 1000, interfaceMs: 7000 }
    ])
  })

  it('ignore une ligne abîmée, et garde un démarrage sans jalons sans lui inventer de durée', () => {
    const texte = ['{pas du json', JSON.stringify({ ts: '2026-10-30T10:00:00.000Z' })].join('\n')
    expect(lireDemarrages(texte)).toEqual([
      { ts: Date.parse('2026-10-30T10:00:00.000Z'), moteurMs: null, interfaceMs: null }
    ])
  })
})

describe('reprisesDuJournal', () => {
  it('ne prend que les lignes de reprise, pas un option `resumed` dans un appel de modèle', () => {
    const texte = [
      '{"kind":"resumed","at":42}',
      '{"kind":"prompt-call","options":{"resumed":false}}',
      '{"kind":"resumed"'
    ].join('\n')
    expect(reprisesDuJournal(texte)).toEqual([42])
  })
})

describe('causesDeFermeture', () => {
  it('compte par origine, sans les lignes de processus ni ce qui précède la période', () => {
    const texte = [
      '2026-10-20T10:00:00 fermeture demandee-par=restart_app (conv-1) — trop ancienne',
      '2026-10-30T10:00:00 fermeture demandee-par=restart_app (conv-2) — code modifié',
      '2026-10-30T10:01:00 fermeture demandee-par=restart_app (conv-3) — code modifié',
      '2026-10-30T10:02:00 fermeture demandee-par=moteur modifie — relance automatique au repos',
      '2026-10-30T10:03:00 electron pid=12 code=2 (0x00000002)'
    ].join('\n')
    expect(causesDeFermeture(texte, Date.parse('2026-10-25T00:00:00Z'))).toEqual({
      restart_app: 2,
      'moteur modifie': 1
    })
  })
})

describe('mediane', () => {
  it('prend le milieu, et la moyenne des deux milieux sur un nombre pair', () => {
    expect(mediane([3, 1, 2])).toBe(2)
    expect(mediane([1, 2, 3, 10])).toBe(2.5)
  })

  it('rend null sur rien, plutôt qu’un zéro qu’on lirait comme une mesure', () => {
    expect(mediane([])).toBeNull()
  })
})

describe('mesurer', () => {
  const t0 = Date.parse('2026-10-30T10:00:00.000Z')
  const demarrages = [
    { ts: t0, moteurMs: 1000, interfaceMs: 5000 },
    { ts: t0 + 3_600_000, moteurMs: 2000, interfaceMs: 7000 }
  ]

  it('rattache chaque reprise au démarrage qui la précède et mesure son délai', () => {
    const mesure = mesurer({
      demarrages,
      reprises: [t0 + 30_000, t0 + 60_000, t0 + 3_600_000 + 600_000],
      causes: { restart_app: 1 }
    })
    expect(mesure.demarrages).toMatchObject({
      nombre: 2,
      medianes: { moteurMs: 1500, interfaceMs: 6000 }
    })
    expect(mesure.reprises).toEqual({
      nombre: 3,
      delaiMedianSecondes: 60,
      dans120Secondes: 2,
      demarragesSuivisDans120Secondes: 1,
      maxParDemarrage: 2
    })
    expect(mesure.fermetures).toEqual({ restart_app: 1 })
  })

  it('écarte une reprise plus ancienne que le premier démarrage connu', () => {
    const mesure = mesurer({ demarrages, reprises: [t0 - 1], causes: {} })
    expect(mesure.reprises.nombre).toBe(0)
    expect(mesure.reprises.delaiMedianSecondes).toBeNull()
  })
})

describe('en ligne de commande', () => {
  let racine
  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'mesure-reprises-'))
  })
  afterEach(() => rmSync(racine, { recursive: true, force: true }))

  it('lit les journaux de la racine donnée et rend le JSON de la mesure', () => {
    const donnees = join(racine, 'autowin-os')
    const tours = join(donnees, 'turn-journals', 'conv-1')
    mkdirSync(tours, { recursive: true })
    writeFileSync(
      join(donnees, 'demarrages.jsonl'),
      ligneDemarrage('2026-10-30T10:00:00.000Z', 1000, 8000) + '\n'
    )
    const journal = join(tours, 'tour.jsonl')
    const at = Date.parse('2026-10-30T10:01:00.000Z')
    writeFileSync(journal, `{"kind":"resumed","at":${at}}\n`)
    // Un journal touché avant le premier démarrage ne peut rien contenir d'utile : il est sauté.
    utimesSync(journal, new Date(at), new Date(at))
    // `app-exits.log` est écrit en heure LOCALE : le lendemain, l'essai tient dans tout fuseau.
    writeFileSync(
      join(racine, 'app-exits.log'),
      '2026-10-31T10:30:00 fermeture demandee-par=restart_app (conv-1) — essai\n'
    )
    const sortie = execFileSync(process.execPath, [SCRIPT, '--data', donnees], {
      encoding: 'utf8'
    })
    expect(JSON.parse(sortie)).toMatchObject({
      demarrages: { nombre: 1, medianes: { moteurMs: 1000, interfaceMs: 7000 } },
      reprises: { nombre: 1, delaiMedianSecondes: 60, dans120Secondes: 1 },
      fermetures: { restart_app: 1 }
    })
  })

  it('sort en code 2 quand la racine de données n’existe pas', () => {
    let code = 0
    try {
      execFileSync(process.execPath, [SCRIPT, '--data', join(racine, 'absente')], {
        stdio: 'pipe'
      })
    } catch (erreur) {
      code = erreur.status
    }
    expect(code).toBe(2)
  })
})
