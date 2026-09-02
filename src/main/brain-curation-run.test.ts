import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURATION_REVIEWER,
  pendingCandidateCount,
  resetBrainCurationAttempt,
  startBrainCuration
} from './brain-curation-run'

function fauxBrain(candidats: string[]): { root: string; tooling: string; python: string } {
  const root = mkdtempSync(join(tmpdir(), 'curation-'))
  const tooling = join(root, 'tooling')
  mkdirSync(join(root, 'inbox'), { recursive: true })
  mkdirSync(tooling, { recursive: true })
  writeFileSync(join(root, 'inbox', 'README.md'), '# Inbox')
  for (const nom of candidats) writeFileSync(join(root, 'inbox', nom), '---\nstatus: candidate\n---\n')
  const python = join(tooling, 'python.exe')
  writeFileSync(python, '')
  writeFileSync(join(tooling, 'brain_curate.py'), '')
  return { root, tooling, python }
}

describe('déclencheur de curation Brain', () => {
  afterEach(() => resetBrainCurationAttempt())

  it('ne compte pas le README parmi les candidats en attente', () => {
    const { root } = fauxBrain(['a.md', 'b.md'])
    expect(pendingCandidateCount(root)).toBe(2)
  })

  it('lance la curation en --apply avec un relecteur distinct de l’auteur', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const appels: string[][] = []
    const spawnFn = (_bin: string, args: readonly string[]) => {
      appels.push([...args])
      return { unref: vi.fn() }
    }
    const resultat = startBrainCuration(
      { AMITEL_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AMITEL_BRAIN_PYTHON: python },
      spawnFn
    )
    expect(resultat.status).toBe('launched')
    const args = appels[0]
    expect(args).toContain('--apply')
    expect(args[args.indexOf('--reviewer') + 1]).toBe(CURATION_REVIEWER)
    expect(CURATION_REVIEWER.split(':')[0]).not.toBe('autowin-os')
  })

  it('ne lance rien quand la file est vide', () => {
    const { root, tooling, python } = fauxBrain([])
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const resultat = startBrainCuration(
      { AMITEL_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AMITEL_BRAIN_PYTHON: python },
      spawnFn
    )
    expect(resultat.status).toBe('nothing-to-do')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('ne relance pas une deuxième fois dans la même session', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const env = { AMITEL_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AMITEL_BRAIN_PYTHON: python }
    startBrainCuration(env, spawnFn)
    expect(startBrainCuration(env, spawnFn).status).toBe('nothing-to-do')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })
})
