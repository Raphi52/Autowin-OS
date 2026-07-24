import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, applyUpdate, type GitRunner } from './git-update'

function runnerFrom(map: Record<string, string>, throwOn?: string): GitRunner {
  return async (args) => {
    const key = args.join(' ')
    if (throwOn && key.includes(throwOn)) throw new Error(`fail: ${key}`)
    return { stdout: map[key] ?? '' }
  }
}

describe('checkForUpdate', () => {
  it('en retard de N commits → available avec behind=N', async () => {
    const run = runnerFrom({
      'fetch --quiet': '',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-list --count HEAD..@{u}': '3'
    })
    expect(await checkForUpdate('/r', run)).toEqual({ available: true, behind: 3, branch: 'main' })
  })

  it('à jour (behind=0) → non available', async () => {
    const run = runnerFrom({
      'fetch --quiet': '',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-list --count HEAD..@{u}': '0'
    })
    expect(await checkForUpdate('/r', run)).toMatchObject({ available: false, behind: 0 })
  })

  it('hors repo git / fetch échoue → indisponible silencieux (pas de throw)', async () => {
    const run = runnerFrom({}, 'fetch')
    const r = await checkForUpdate('/r', run)
    expect(r.available).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('applyUpdate', () => {
  it('arbre SALE → refuse, ne pull pas', async () => {
    const pulled = vi.fn()
    const run: GitRunner = async (args) => {
      if (args[0] === 'pull') pulled()
      return { stdout: args.join(' ') === 'status --porcelain' ? ' M src/x.ts' : '' }
    }
    const r = await applyUpdate('/r', run, async () => {})
    expect(r.ok).toBe(false)
    expect(pulled).not.toHaveBeenCalled()
  })

  it('arbre propre → pull ff-only + relaunch, npm install seulement si package a changé', async () => {
    const run: GitRunner = async () => ({ stdout: '' }) // status vide = propre
    const npm = vi.fn().mockResolvedValue(undefined)
    const r = await applyUpdate('/r', run, npm)
    expect(r).toMatchObject({ ok: true, relaunch: true })
    // package.json inchangé (signature identique avant/après ici) → pas de npm install
    expect(npm).not.toHaveBeenCalled()
  })
})
