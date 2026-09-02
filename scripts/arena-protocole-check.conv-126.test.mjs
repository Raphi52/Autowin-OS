/**
 * Le contrôle du protocole /arena doit REFUSER le banc réel de conv-126.
 *
 * Ce test est le rouge de référence : la conversation conv-126 a produit le seul vrai banc /arena,
 * il est passé au VERT (juge + gate), et pourtant quatre étapes obligatoires de
 * `skills/arena/SKILL.md` manquaient. Un contrôle qui laisserait passer ce run ne servirait à rien.
 *
 * La preuve est jouée sur `tests/fixtures/arena-conv-126/` — copie figée et versionnée du run réel
 * (voir le README de ce dossier : provenance, unique modification, fidélité vérifiée au `diff`).
 * Les données d'origine vivent sous `.autowin-data/`, hors git : un test qui les viserait
 * deviendrait vert le jour où un ménage les efface, c'est-à-dire faux.
 *
 * Ce fichier n'accepte donc PAS de se sauter : fixture absente = échec bruyant.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { verifierProtocole } from './arena-protocole-check.mjs'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(ICI, '..', 'tests', 'fixtures', 'arena-conv-126')
const RUN = path.join(FIXTURE, 'RUN.md')
const BENCH = path.join(FIXTURE, 'bench')
const CONTROLE = path.join(ICI, 'arena-protocole-check.mjs')

/** Les points que conv-126 a réellement ratés, avec la raison lue sur ses fichiers. */
const RATES_ATTENDUS = {
  P1: /section `## Candidats scoutés` absente/,
  P2: /aucune sortie collee/,
  P3: /1 cas limite sur 5 assertions/,
  P11: /aucune ligne Discrimination/
}

describe('arena-protocole-check face au banc réel de conv-126', () => {
  it('la copie figée du run est bien là (sinon ce test ne prouve plus rien)', () => {
    const attendus = [
      RUN,
      path.join(BENCH, 'lance.sh'),
      path.join(BENCH, 'check.mjs'),
      path.join(BENCH, 'tache.txt'),
      path.join(BENCH, 'out-judge.json'),
      ...['a', 'b', 'c', 'x'].flatMap((b) => [
        path.join(BENCH, `prompt-${b}.txt`),
        path.join(BENCH, `out-${b}.json`)
      ])
    ]
    expect(attendus.filter((f) => !existsSync(f))).toEqual([])
  })

  it('refuse le run : ok=false, et RATE exactement P1, P2, P3, P11', () => {
    const res = verifierProtocole({ run: RUN, bench: BENCH })
    expect(res.erreur).toBeUndefined()
    const rates = res.points.filter((p) => !p.ok)
    expect(rates.map((p) => p.id)).toEqual(Object.keys(RATES_ATTENDUS))
    for (const [id, motif] of Object.entries(RATES_ATTENDUS)) {
      expect(rates.find((p) => p.id === id).detail, `détail de ${id}`).toMatch(motif)
    }
    expect(res.ok).toBe(false)
  })

  it('les neuf autres points restent tenus : le refus est ciblé, pas un rejet en bloc', () => {
    const res = verifierProtocole({ run: RUN, bench: BENCH })
    const tenus = res.points.filter((p) => p.ok).map((p) => p.id)
    expect(tenus).toEqual(['P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P12', 'P13'])
    expect(res.points).toHaveLength(13)
  })

  it('en ligne de commande, le contrôle sort en code 1 et dit PROTOCOLE NON TENU', () => {
    const r = spawnSync(process.execPath, [CONTROLE, '--run', RUN, '--bench', BENCH], {
      encoding: 'utf8'
    })
    expect(r.status, r.stderr).toBe(1)
    expect(r.stdout).toMatch(/PROTOCOLE NON TENU/)
    expect(r.stdout).toMatch(/^RATE P1 /m)
  })
})
