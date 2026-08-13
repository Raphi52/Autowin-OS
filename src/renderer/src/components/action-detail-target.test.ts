import { describe, expect, it } from 'vitest'
import { hasConsultableRun, localActionDetails } from './action-detail-target'

/**
 * Constate en usage reel : « 1 action terminee · 1 action en cours — edit_file · verify », clic sur le
 * bloc -> RIEN. Seule une orchestration produit une carte dans Workflows ; les commandes locales n'en
 * creent aucune, donc le scroll visait un element inexistant.
 */
describe('hasConsultableRun — ne promet Workflows que s’il y a un run', () => {
  it('FAUX pour les commandes locales (le cas du bug)', () => {
    expect(hasConsultableRun([{ name: 'edit_file' }, { name: 'verify' }])).toBe(false)
    expect(hasConsultableRun([{ name: 'brain_query' }])).toBe(false)
    expect(hasConsultableRun([])).toBe(false)
  })

  it('VRAI pour une orchestration', () => {
    expect(hasConsultableRun([{ name: 'orchestrate' }])).toBe(true)
    // Groupe mixte : un seul run suffit a rendre Workflows pertinent.
    expect(hasConsultableRun([{ name: 'edit_file' }, { name: 'orchestrate' }])).toBe(true)
  })

  it('VRAI si l’action porte une reference de run, quel que soit son nom', () => {
    expect(hasConsultableRun([{ name: 'autre', data: { runPath: 'C:/runs/x/RUN.md' } }])).toBe(true)
    expect(hasConsultableRun([{ name: 'autre', data: { runId: 'r-1' } }])).toBe(true)
    expect(hasConsultableRun([{ name: 'autre', data: { runPath: 42 } }])).toBe(false)
  })
})

describe('localActionDetails — ce qui s’affiche SUR PLACE faute de run', () => {
  it('montre le DIFF d’une edition', () => {
    const [detail] = localActionDetails([
      { name: 'edit_file', ok: true, data: { allowed: true, diff: '- a\n+ b' } }
    ])
    expect(detail).toMatchObject({ name: 'edit_file', ok: true })
    expect(detail.text).toContain('+ b')
  })

  it('une verification qui PASSE ne montre que son verdict', () => {
    // La sortie d'un succes est du bruit : des milliers de lignes d'outil, tronquees a leur queue,
    // sous un « exit 0 » qui disait deja tout. Personne ne les lit.
    const [detail] = localActionDetails([
      { name: 'verify', ok: true, data: { allowed: true, exitCode: 0, output: '1 test pass' } }
    ])
    expect(detail.text).toBe('exit 0')
  })

  it('une verification qui ECHOUE montre sa sortie — c’est la qu’on la lit', () => {
    const [detail] = localActionDetails([
      { name: 'verify', ok: true, data: { allowed: true, exitCode: 1, output: 'assertion failed' } }
    ])
    expect(detail.text).toContain('exit 1')
    expect(detail.text).toContain('assertion failed')
  })

  it('un REFUS montre sa raison, et est marque non-ok', () => {
    const [detail] = localActionDetails([
      { name: 'edit_file', data: { allowed: false, reason: 'chemin hors du workspace' } }
    ])
    expect(detail.ok).toBe(false)
    expect(detail.text).toBe('chemin hors du workspace')
  })

  it('la raison PRIME sur le reste (c’est l’info la plus utile)', () => {
    const [detail] = localActionDetails([
      { name: 'verify', data: { allowed: false, reason: 'aucun script test', output: 'bruit' } }
    ])
    expect(detail.text).toBe('aucun script test')
  })

  it('ignore ce qui n’a rien a lire (pas de ligne vide dans le fil)', () => {
    expect(
      localActionDetails([
        { name: 'x' },
        { name: 'y', data: {} },
        { name: 'z', data: { output: '  ' } }
      ])
    ).toEqual([])
  })

  it('exit code SEUL suffit (une verification sans sortie reste informative)', () => {
    expect(localActionDetails([{ name: 'verify', data: { exitCode: 1 } }])[0].text).toBe('exit 1')
  })
})

/** Contrat de CABLAGE : le bloc ne doit plus promettre Workflows quand il n'y a rien a y voir. */
describe('cablage du bloc d’activite', () => {
  const parts = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'ChatView.parts.tsx'), 'utf8')
  }

  it('le clic est INERTE sans run consultable (au lieu de scroller vers rien)', () => {
    const source = parts()
    expect(source).toContain('hasConsultableRun(actions)')
    expect(source).toContain('if (!runConsultable) return')
  })

  it('la fleche « ouvrir » ne s’affiche que s’il y a vraiment un run', () => {
    expect(parts()).toContain('{runConsultable && (')
  })

  it('le detail local est rendu dans le fil', () => {
    const source = parts()
    expect(source).toContain('localActionDetails(actions)')
    expect(source).toContain('activity-local-details')
  })
})
