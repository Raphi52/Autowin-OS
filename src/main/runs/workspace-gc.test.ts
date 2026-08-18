import { mkdirSync, mkdtempSync, rmSync, existsSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectRunWorkspaces,
  DEFAULT_MAX_PER_CONVERSATION,
  planWorkspaceGc,
  type WorkspaceEntry
} from './workspace-gc'

const JOUR = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

function entree(over: Partial<WorkspaceEntry> & { path: string }): WorkspaceEntry {
  return {
    convId: 'conv-1',
    status: 'green',
    modifiedMs: NOW - 60 * JOUR,
    ...over
  }
}

describe('planWorkspaceGc — la politique PURE', () => {
  it('supprime un run CLOS et ancien : c est la masse mesuree (9 341 green)', () => {
    const plan = planWorkspaceGc([entree({ path: 'a' })], {
      nowMs: NOW,
      maxPerConversation: 0
    })
    expect(plan.doomed).toEqual(['a'])
  })

  it('ne supprime AUCUN run non clos, quel que soit son age', () => {
    const vieux = 400 * JOUR
    const entrees = ['open', 'red', 'failed', 'pending', 'running', 'unknown', 'inconnu'].map(
      (status) => entree({ path: `ws-${status}`, status, modifiedMs: NOW - vieux })
    )

    const plan = planWorkspaceGc(entrees, { nowMs: NOW, maxPerConversation: 0 })

    expect(plan.doomed).toEqual([])
  })

  it('garde tout run de moins de 7 jours, meme clos', () => {
    const plan = planWorkspaceGc([entree({ path: 'a', modifiedMs: NOW - 6 * JOUR })], {
      nowMs: NOW,
      maxPerConversation: 0
    })
    expect(plan.doomed).toEqual([])
  })

  it('garde les N plus recents PAR CONVERSATION et ne les vole pas a une autre', () => {
    const entrees: WorkspaceEntry[] = []
    for (const conv of ['conv-A', 'conv-B']) {
      for (let i = 0; i < DEFAULT_MAX_PER_CONVERSATION + 10; i++) {
        entrees.push(
          entree({ path: `${conv}/${i}`, convId: conv, modifiedMs: NOW - (10 + i) * JOUR })
        )
      }
    }

    const plan = planWorkspaceGc(entrees, { nowMs: NOW })

    // 10 sacrifies de chaque cote — jamais 20 d un seul, sinon le plafond serait global.
    expect(plan.doomed.filter((p) => p.startsWith('conv-A/'))).toHaveLength(10)
    expect(plan.doomed.filter((p) => p.startsWith('conv-B/'))).toHaveLength(10)
    // Ce sont les plus ANCIENS qui partent.
    expect(plan.doomed).toContain(`conv-A/${DEFAULT_MAX_PER_CONVERSATION + 9}`)
    expect(plan.doomed).not.toContain('conv-A/0')
  })

  it('LE CAS QUI COMPTE : un run reprenable en vol -> 0 suppression', () => {
    const enVol = entree({
      path: '/racine/conv-1/run-5f5a75a0208d-1-workspace',
      modifiedMs: NOW - 90 * JOUR
    })

    const sans = planWorkspaceGc([enVol], { nowMs: NOW, maxPerConversation: 0 })
    const avec = planWorkspaceGc([enVol], {
      nowMs: NOW,
      maxPerConversation: 0,
      protectedRunIds: ['run-5f5a75a0208d-1']
    })

    expect(sans.doomed).toHaveLength(1) // discriminant : sans la garde, il partait
    expect(avec.doomed).toHaveLength(0)
  })

  it('le protege survit meme au plafond par conversation', () => {
    const entrees = [
      entree({ path: 'garde/run-abc-workspace', modifiedMs: NOW - 500 * JOUR }),
      ...Array.from({ length: DEFAULT_MAX_PER_CONVERSATION + 5 }, (_, i) =>
        entree({ path: `x/${i}`, modifiedMs: NOW - (100 + i) * JOUR })
      )
    ]

    // Sans la garde il partirait : il est le PLUS ANCIEN, donc le premier hors plafond.
    const sans = planWorkspaceGc(entrees, { nowMs: NOW })
    const avec = planWorkspaceGc(entrees, { nowMs: NOW, protectedRunIds: ['run-abc'] })

    expect(sans.doomed).toContain('garde/run-abc-workspace')
    expect(avec.doomed).not.toContain('garde/run-abc-workspace')
  })

  it('garde de vivacite : un run clos touche il y a 1 h reste intact', () => {
    const plan = planWorkspaceGc([entree({ path: 'a', modifiedMs: NOW - 60 * 60 * 1000 })], {
      nowMs: NOW,
      maxAgeMs: 0,
      maxPerConversation: 0
    })
    expect(plan.doomed).toEqual([])
  })

  it('le plafond de travail RENVOIE le reste au lieu de le taire', () => {
    const entrees = Array.from({ length: 12 }, (_, i) =>
      entree({ path: `p${i}`, convId: `conv-${i}` })
    )

    const plan = planWorkspaceGc(entrees, {
      nowMs: NOW,
      maxPerConversation: 0,
      maxDeletions: 5
    })

    expect(plan.doomed).toHaveLength(5)
    expect(plan.remaining).toBe(7)
  })
})

describe('collectRunWorkspaces — l applicateur mince', () => {
  const racines: string[] = []

  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  function racine(): string {
    const r = mkdtempSync(join(tmpdir(), 'autowin-ws-gc-'))
    racines.push(r)
    return r
  }

  function workspace(root: string, conv: string, nom: string, status: string, ageJours: number) {
    const dossier = join(root, conv, `${nom}-workspace`)
    mkdirSync(dossier, { recursive: true })
    writeFileSync(join(dossier, 'RUN.md'), `status: ${status}\n\n## Besoin\n- [x] ok\n`)
    writeFileSync(join(dossier, 'trace.json'), '[]')
    const t = new Date(Date.now() - ageJours * JOUR)
    utimesSync(join(dossier, 'RUN.md'), t, t)
    return dossier
  }

  it('supprime le DOSSIER entier — le sidecar trace.json ne reste pas orphelin', () => {
    const root = racine()
    const vieuxVert = workspace(root, 'conv-1', 'ancien', 'green', 60)
    const jeuneVert = workspace(root, 'conv-1', 'recent', 'green', 1)
    const vieuxRouge = workspace(root, 'conv-1', 'echec', 'red', 60)

    const bilan = collectRunWorkspaces(root, { maxPerConversation: 1 })

    expect(bilan.removed).toBe(1)
    expect(bilan.paths).toEqual([vieuxVert])
    expect(existsSync(vieuxVert)).toBe(false)
    expect(existsSync(join(vieuxVert, 'trace.json'))).toBe(false)
    expect(existsSync(jeuneVert)).toBe(true)
    expect(existsSync(vieuxRouge)).toBe(true) // non clos : intact, quel que soit son age
  })

  it('une racine absente n est pas une erreur', () => {
    expect(collectRunWorkspaces(join(tmpdir(), 'autowin-gc-inexistant-xyz'))).toEqual({
      removed: 0,
      remaining: 0,
      paths: []
    })
  })
})
