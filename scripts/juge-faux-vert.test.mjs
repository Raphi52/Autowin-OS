import { describe, expect, it } from 'vitest'
import {
  STRATES,
  allouer,
  estimer,
  generateur,
  lireVerdicts,
  noteDuTexte,
  notesDuJuge,
  populationDesRuns,
  proprietaireDuDossier,
  stratesEtiquetees,
  tirer,
  wilson
} from './juge-faux-vert.mjs'

const ligne = (o) => JSON.stringify(o)

describe('lecture de trust.jsonl', () => {
  it('groupe par run dans l’ordre du temps, garde la dernière confirmation et compte les verdicts sans run', () => {
    const texte = [
      ligne({ judgeModel: 'claude', verdict: 'red' }),
      ligne({
        judgeModel: 'claude',
        verdict: 'green',
        runId: 'run-a',
        conversationId: 'conv-1',
        ts: '2026-10-02T00:00:00Z'
      }),
      ligne({
        judgeModel: 'claude',
        verdict: 'red',
        runId: 'run-a',
        conversationId: 'conv-1',
        ts: '2026-10-01T00:00:00Z'
      }),
      ligne({
        kind: 'confirmation',
        runId: 'run-a',
        humanTruth: 'green',
        ts: '2026-10-03T00:00:00Z'
      }),
      ligne({
        kind: 'confirmation',
        runId: 'run-a',
        humanTruth: 'red',
        ts: '2026-10-04T00:00:00Z'
      }),
      '{ligne coupée'
    ].join('\n')
    const { parRun, confirmations, sansRun } = lireVerdicts(texte)
    expect(sansRun).toBe(1)
    expect(parRun.get('run-a').map((v) => v.verdict)).toEqual(['red', 'green'])
    expect(confirmations.get('run-a')).toBe('red')
  })

  it('lit la DERNIÈRE note du juge et ignore les lignes sans note', () => {
    expect(noteDuTexte('SCORE: 74\n...\nSCORE: 88')).toBe(88)
    expect(noteDuTexte('VALIDE sans note')).toBeNull()
    const notes = notesDuJuge([
      { kind: 'judge', runId: 'run-a', ts: '2', text: 'SCORE: 90' },
      { kind: 'judge', runId: 'run-a', ts: '1', text: 'SCORE: 70' },
      { kind: 'gate', runId: 'run-a', ts: '3', text: 'SCORE: 10' }
    ])
    expect(notes.get('run-a')).toEqual([70, 90])
  })

  it('rattache un dossier de travail au run que sa trace cite le PLUS, pas au run qu’elle mentionne', () => {
    // Cas réel du 2026-10-16 : le RUN.md d'un salvage citait la branche autowin/recovery/run-315e68922bd7-1.
    const trace = `${'run-54b522be50f5-1 '.repeat(40)} fusionne autowin/recovery/run-315e68922bd7-1`
    expect(proprietaireDuDossier(trace)).toEqual({ runId: 'run-54b522be50f5-1', n: 40 })
    expect(proprietaireDuDossier('aucun identifiant')).toBeNull()
  })

  it('classe chaque run sur son dernier verdict et impute la note manquante à la moyenne de sa strate', () => {
    const { parRun } = lireVerdicts(
      [
        ligne({ verdict: 'green', runId: 'run-1', ts: '1' }),
        ligne({ verdict: 'red', runId: 'run-2', ts: '1' }),
        ligne({ verdict: 'green', runId: 'run-2', ts: '2' }),
        ligne({ verdict: 'green', runId: 'run-3', ts: '1' }),
        ligne({ verdict: 'red', runId: 'run-4', ts: '1' })
      ].join('\n')
    )
    const pop = populationDesRuns(
      parRun,
      new Map([
        ['run-1', [80]],
        ['run-2', [90]]
      ])
    )
    const par = Object.fromEntries(pop.map((u) => [u.runId, u]))
    expect(par['run-1'].strate).toBe(STRATES.VERT_1ER)
    expect(par['run-2'].strate).toBe(STRATES.VERT_REPARE)
    expect(par['run-4'].strate).toBe(STRATES.ROUGE)
    expect(par['run-1'].f).toBeCloseTo(0.2)
    expect(par['run-3'].fImpute).toBe(true)
    expect(par['run-3'].f).toBeCloseTo(0.2)
  })
})

describe('allocation et tirage', () => {
  it('répartit exactement n étiquettes, au moins 3 par strate verte, jamais plus que la strate', () => {
    const effectifs = { [STRATES.VERT_1ER]: 60, [STRATES.VERT_REPARE]: 20, [STRATES.ROUGE]: 90 }
    const a = allouer(effectifs, 40, 8)
    expect(a[STRATES.ROUGE]).toBe(8)
    expect(a[STRATES.VERT_1ER] + a[STRATES.VERT_REPARE]).toBe(32)
    expect(a[STRATES.VERT_1ER]).toBe(24)
    expect(a[STRATES.VERT_REPARE]).toBe(8)
    const petit = allouer(
      { [STRATES.VERT_1ER]: 2, [STRATES.VERT_REPARE]: 50, [STRATES.ROUGE]: 3 },
      40,
      8
    )
    expect(petit[STRATES.VERT_1ER]).toBe(2)
    expect(petit[STRATES.ROUGE]).toBe(3)
    expect(petit[STRATES.VERT_1ER] + petit[STRATES.VERT_REPARE]).toBe(37)
  })

  it('rejoue le même tirage avec la même graine, et reste dans chaque strate', () => {
    const population = Array.from({ length: 30 }, (_, i) => ({
      runId: `run-${i}`,
      strate: i < 20 ? STRATES.VERT_1ER : STRATES.ROUGE
    }))
    const alloc = { [STRATES.VERT_1ER]: 5, [STRATES.VERT_REPARE]: 0, [STRATES.ROUGE]: 3 }
    const t1 = tirer(population, alloc, 7)
    expect(tirer(population, alloc, 7)).toEqual(t1)
    expect(tirer(population, alloc, 8)).not.toEqual(t1)
    expect(t1[STRATES.VERT_1ER].aEtiqueter).toHaveLength(5)
    expect(t1[STRATES.VERT_1ER].reserve).toHaveLength(15)
    expect(t1[STRATES.VERT_1ER].aEtiqueter.every((r) => Number(r.slice(4)) < 20)).toBe(true)
  })

  it('ne compte que les confirmations des runs tirés', () => {
    const echantillon = {
      population: [
        { runId: 'run-a', strate: STRATES.VERT_1ER, f: 0.1 },
        { runId: 'run-b', strate: STRATES.VERT_1ER, f: 0.3 },
        { runId: 'run-c', strate: STRATES.VERT_1ER, f: 0.2 }
      ],
      tirage: {
        [STRATES.VERT_1ER]: { aEtiqueter: ['run-a'], reserve: ['run-b'] },
        [STRATES.VERT_REPARE]: { aEtiqueter: [], reserve: [] },
        [STRATES.ROUGE]: { aEtiqueter: [], reserve: [] }
      }
    }
    const confirmations = new Map([
      ['run-a', 'red'],
      ['run-b', 'green'],
      ['run-c', 'red']
    ])
    const [vert1] = stratesEtiquetees(echantillon, confirmations, 'faux-vert')
    expect(vert1.N).toBe(3)
    expect(vert1.etiquettes.map((e) => [e.runId, e.y])).toEqual([
      ['run-a', 1],
      ['run-b', 0]
    ])
    expect(vert1.fPop).toBeCloseTo(0.2)
  })
})

describe('estimation', () => {
  it('estimateur classique : calcul à la main, avec correction de population finie', () => {
    const strate = {
      nom: 'vert',
      N: 10,
      fPop: 0,
      etiquettes: [1, 0, 0, 0, 0].map((y) => ({ y, f: 0 }))
    }
    const r = estimer([strate])
    // p = 0,2 ; s² = (0,8² + 4·0,2²)/4 = 0,2 ; var = (1 − 5/10)·0,2/5 = 0,02
    expect(r.estimation).toBeCloseTo(0.2)
    expect(r.ecartType ** 2).toBeCloseTo(0.02)
    expect(r.lambda).toBe(0)
  })

  it('PPI : un prédicteur parfait donne la moyenne de population, sans variance', () => {
    const ys = [1, 0, 0, 1, 0, 0, 0, 0]
    const strate = { nom: 'vert', N: 40, fPop: 0.1, etiquettes: ys.map((y) => ({ y, f: y })) }
    const r = estimer([strate], { ppi: true })
    expect(r.lambda).toBeCloseTo(1)
    expect(r.estimation).toBeCloseTo(0.1)
    expect(r.ecartType).toBeCloseTo(0)
  })

  it('PPI avec un prédicteur constant retombe exactement sur le classique', () => {
    const strate = {
      nom: 'vert',
      N: 30,
      fPop: 0.4,
      etiquettes: [1, 0, 0, 1, 0, 0, 0].map((y) => ({ y, f: 0.4 }))
    }
    expect(estimer([strate], { ppi: true }).estimation).toBeCloseTo(estimer([strate]).estimation)
  })

  it('signale une estimation provisoire quand une strate n’a aucune étiquette', () => {
    const r = estimer([
      { nom: 'a', N: 10, fPop: 0, etiquettes: [{ y: 0, f: 0 }] },
      { nom: 'b', N: 10, fPop: 0, etiquettes: [] }
    ])
    expect(r.provisoire).toBe(true)
    expect(r.stratesSansEtiquette).toEqual(['b'])
    expect(estimer([{ nom: 'b', N: 10, fPop: 0, etiquettes: [] }]).estimation).toBeNull()
  })

  it('Wilson reste dans [0,1] et ne s’écrase pas à zéro quand aucun faux vert n’est observé', () => {
    const iv = wilson(0, 20)
    expect(iv.bas).toBe(0)
    expect(iv.haut).toBeGreaterThan(0.1)
    expect(iv.haut).toBeLessThan(0.2)
  })

  /**
   * Population finie fixe (deux strates vertes, 80 + 40 runs, 20 étiquettes), y lié à f par `lien`.
   * La cible est le vrai taux sur CES runs. Mesuré le 2026-10-16 (conv-996), 3000 tirages : le gain
   * de PPI suit la théorie de l'estimateur par régression, variance ≈ (1 − ρ²) × classique —
   * ρ = 0,26 → rapport 1,00 ; ρ = 0,57 → 0,74 ; ρ = 0,67 → 0,63. Un premier jet de ce test affirmait
   * « PPI moins variable » avec ρ = 0,26 : c'était FAUX à 20 étiquettes (0,00780 contre 0,00780).
   */
  function simuler(lien) {
    const alea = generateur(42)
    const faire = (N) =>
      Array.from({ length: N }, () => {
        const f = alea()
        return { f, y: alea() < lien(f) ? 1 : 0 }
      })
    const pops = [faire(80), faire(40)]
    const vrai = pops.flat().reduce((a, u) => a + u.y, 0) / 120
    const tailles = [12, 8]
    const reps = 3000
    const tirage = generateur(7)
    const est = { classique: [], ppi: [] }
    let couverts = 0
    for (let r = 0; r < reps; r += 1) {
      const strates = pops.map((pop, h) => {
        const idx = pop.map((_, i) => i)
        for (let i = idx.length - 1; i > 0; i -= 1) {
          const j = Math.floor(tirage() * (i + 1))
          ;[idx[i], idx[j]] = [idx[j], idx[i]]
        }
        return {
          nom: `s${h}`,
          N: pop.length,
          fPop: pop.reduce((a, u) => a + u.f, 0) / pop.length,
          etiquettes: idx.slice(0, tailles[h]).map((i) => pop[i])
        }
      })
      const c = estimer(strates)
      const p = estimer(strates, { ppi: true })
      est.classique.push(c.estimationBrute)
      est.ppi.push(p.estimationBrute)
      if (p.wilson.bas <= vrai && vrai <= p.wilson.haut) couverts += 1
    }
    const m = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    const v = (xs) => m(xs.map((x) => (x - m(xs)) ** 2))
    return {
      biaisClassique: Math.abs(m(est.classique) - vrai),
      biaisPpi: Math.abs(m(est.ppi) - vrai),
      rapportVariance: v(est.ppi) / v(est.classique),
      couverture: couverts / reps
    }
  }

  it('simulation, note informative (ρ ≈ 0,57) : sans biais, PPI nettement moins variable, couverture ≥ 90 %', () => {
    const r = simuler((f) => 0.9 * f ** 3)
    expect(r.biaisClassique).toBeLessThan(0.01)
    expect(r.biaisPpi).toBeLessThan(0.01)
    expect(r.rapportVariance).toBeLessThan(0.8)
    expect(r.couverture).toBeGreaterThan(0.9)
  })

  it('simulation, note peu informative (ρ ≈ 0,26) : PPI ne fait pas pire que le classique', () => {
    const r = simuler((f) => 0.03 + 0.45 * f)
    expect(r.biaisPpi).toBeLessThan(0.01)
    expect(r.rapportVariance).toBeLessThan(1.05)
    expect(r.couverture).toBeGreaterThan(0.9)
  })
})
