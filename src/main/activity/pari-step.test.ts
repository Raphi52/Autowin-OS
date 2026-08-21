import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PariPhaseStore } from './pari-phase-store'
import { traiterStepPourPari, type StepObserve } from './pari-step'

const store = (): PariPhaseStore =>
  new PariPhaseStore(join(mkdtempSync(join(tmpdir(), 'autowin-paristep-')), 'paris-v1.jsonl'))

const stepBuild = (texte: string, status = 'completed'): StepObserve => ({
  step: 'exec',
  status,
  text: texte,
  execution: { phase: 'build' }
})

const LIGNE = 'AUTOWIN_PARI_V1: {"confiance":0.8,"refutateur":"le juge trouve un défaut"}'

describe('traitement d’un step pour le pari', () => {
  it('dépose le pari d’une phase BUILD achevée', () => {
    const s = store()
    traiterStepPourPari(stepBuild(`travail\n${LIGNE}`), 'run-1', s)
    expect(s.lire()).toHaveLength(1)
    expect(s.lire()[0]?.confiance).toBe(0.8)
    expect(s.lire()[0]?.phase).toBe('build')
  })

  it('NE DÉPOSE RIEN pour une phase échouée : le pari d’une tentative avortée n’est pas une prédiction', () => {
    const s = store()
    traiterStepPourPari(stepBuild(`travail\n${LIGNE}`, 'failed'), 'run-1', s)
    expect(s.lire()).toEqual([])
  })

  it('ne dépose rien sans identifiant de run', () => {
    const s = store()
    traiterStepPourPari(stepBuild(LIGNE), undefined, s)
    expect(s.lire()).toEqual([])
  })

  it('ne dépose rien quand la phase est inconnue', () => {
    const s = store()
    traiterStepPourPari(
      { step: 'exec', status: 'completed', text: LIGNE, execution: {} },
      'run-1',
      s
    )
    expect(s.lire()).toEqual([])
  })

  it('IGNORE le vote d’un membre du panel : seule la synthèse arbitre', () => {
    const s = store()
    traiterStepPourPari(stepBuild(LIGNE), 'run-1', s)
    traiterStepPourPari(
      { step: 'judge', status: 'completed', detail: 'vote: VALIDE', text: '', execution: {} },
      'run-1',
      s
    )
    expect(s.lireIssues()).toEqual([])
  })

  it('arbitre sur le verdict de SYNTHÈSE et rend la mesure sur tout l’HISTORIQUE', () => {
    const s = store()
    traiterStepPourPari(stepBuild(LIGNE), 'run-1', s)
    const mesure = traiterStepPourPari(
      { step: 'judge', status: 'completed', detail: 'validé', text: 'VALIDE', execution: {} },
      'run-1',
      s
    )
    expect(s.lireIssues()).toEqual([{ runId: 'run-1', phase: 'build', reussie: true, jugee: true }])
    expect(mesure?.n).toBe(1)
  })

  it('la mesure CUMULE les runs précédents, elle ne repart pas du run courant', () => {
    const s = store()
    traiterStepPourPari(stepBuild(LIGNE), 'run-1', s)
    traiterStepPourPari(
      { step: 'judge', status: 'completed', detail: 'validé', text: '', execution: {} },
      'run-1',
      s
    )
    traiterStepPourPari(stepBuild(LIGNE), 'run-2', s)
    const mesure = traiterStepPourPari(
      { step: 'judge', status: 'completed', detail: 'défaut', text: '', execution: {} },
      'run-2',
      s
    )
    expect(mesure?.n).toBe(2)
  })

  it('compte les VERDICTS distincts, pas seulement les paris — les phases d’un run partagent une issue', () => {
    const s = store()
    traiterStepPourPari(stepBuild(LIGNE), 'run-1', s)
    traiterStepPourPari({ ...stepBuild(LIGNE), execution: { phase: 'clean' } }, 'run-1', s)
    const mesure = traiterStepPourPari(
      { step: 'judge', status: 'completed', detail: 'validé', text: '', execution: {} },
      'run-1',
      s
    )
    expect(mesure?.n).toBe(2)
    expect(mesure?.verdictsDistincts).toBe(1)
  })

  it('ne jette JAMAIS et SIGNALE la cause : une métrique ne doit pas interrompre un run', () => {
    const casse = {
      lire: () => {
        throw new Error('journal illisible')
      }
    } as unknown as PariPhaseStore
    const avert = vi.fn()
    expect(() => traiterStepPourPari(stepBuild(LIGNE), 'run-1', casse, avert)).not.toThrow()
    expect(avert).toHaveBeenCalledOnce()
  })

  it('signale un pari refusé pour confiance hors bornes au lieu de l’avaler', () => {
    const s = store()
    const avert = vi.fn()
    traiterStepPourPari(
      stepBuild('AUTOWIN_PARI_V1: {"confiance":0.5,"refutateur":""}'),
      'run-1',
      s,
      avert
    )
    expect(s.lire()).toEqual([])
    expect(avert).not.toHaveBeenCalled() // pari mal formé = pas de pari, pas une erreur
  })
})
