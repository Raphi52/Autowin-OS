import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ensureTestProjects,
  inspectProject,
  loadTestProjects,
  runProjectTests,
  saveTestProjects
} from './tests-view-main'

function racine(pkg?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tests-view-'))
  const projet = join(dir, 'mon-projet')
  mkdirSync(projet, { recursive: true })
  if (pkg) writeFileSync(join(projet, 'package.json'), JSON.stringify(pkg), 'utf8')
  return projet
}

describe('registre des projets', () => {
  it('persiste et relit une liste normalisee', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reg-')), 'test-projects.json')
    const saved = saveTestProjects(
      [{ root: 'C:/dev/a' }, { root: 'C:/dev/a' }, { root: 'C:/dev/b', label: 'B' }],
      path
    )
    expect(saved).toHaveLength(2)
    expect(loadTestProjects(path).map((p) => p.label)).toEqual(['a', 'B'])
  })

  it('rend une liste vide sur registre corrompu au lieu de jeter', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reg-')), 'test-projects.json')
    writeFileSync(path, '{ pas du json', 'utf8')
    expect(loadTestProjects(path)).toEqual([])
  })
})

describe('inspectProject', () => {
  it('dit pourquoi un projet n est pas executable', () => {
    // ENTREE QUI DOIT FAIRE ECHOUER une detection trop permissive : projet SANS vitest/jest.
    const sansHarnais = inspectProject({
      id: 'x',
      label: 'x',
      root: racine({ scripts: { test: 'echo rien' } })
    })
    expect(sansHarnais.runnable).toBe(false)
    expect(sansHarnais.reason).toMatch(/harnais/)
    expect(inspectProject({ id: 'y', label: 'y', root: 'C:/nexistepas-42' }).reason).toMatch(
      /introuvable/
    )
  })

  it('reconnait un projet vitest quelconque (pas seulement autowin)', () => {
    const p = inspectProject({
      id: 'z',
      label: 'z',
      root: racine({ devDependencies: { vitest: '^2' } })
    })
    expect(p).toMatchObject({ runner: 'vitest', runnable: true })
  })
})

describe('runProjectTests', () => {
  const rapport = JSON.stringify({
    testResults: [
      {
        name: 'a.test.ts',
        assertionResults: [
          { fullName: 'ok', status: 'passed' },
          { fullName: 'ko', status: 'failed', failureMessages: ['boom'] }
        ]
      }
    ]
  })

  it('lance le harnais du projet dans SA racine et compte le rapport', async () => {
    const root = racine({ devDependencies: { vitest: '^2' } })
    const vus: Array<{ command: string; args: string[]; cwd: string }> = []
    const r = await runProjectTests(
      { id: 'r', label: 'r', root },
      {
        filter: 'auth',
        run: async (command, args, cwd) => {
          vus.push({ command, args, cwd })
          return { stdout: rapport, stderr: '', exitCode: 1 }
        }
      }
    )
    expect(vus[0].cwd).toBe(root)
    expect(vus[0].args).toEqual(['vitest', 'run', '--reporter=json', 'auth'])
    expect(r.totals).toEqual({ passed: 1, failed: 1, skipped: 0, total: 2 })
    expect(r.report.cases[1].error).toBe('boom')
  })

  it('n invente pas un vert quand le harnais ne rend aucun rapport', async () => {
    const root = racine({ devDependencies: { vitest: '^2' } })
    const r = await runProjectTests(
      { id: 'r', label: 'r', root },
      { run: async () => ({ stdout: '', stderr: 'Cannot find module vitest', exitCode: 1 }) }
    )
    expect(r.report.invalid).toBeTruthy()
    expect(r.totals.total).toBe(0)
  })

  it('refuse de lancer un projet sans harnais', async () => {
    const r = await runProjectTests({
      id: 'n',
      label: 'n',
      root: racine({ scripts: { test: 'echo rien' } })
    })
    expect(r.report.invalid).toMatch(/harnais/)
    expect(r.exitCode).toBeNull()
  })
})

describe('ensureTestProjects', () => {
  // La capture /look montrait une vue Tests VIDE : registre absent => aucun projet => ecran mort.
  // Le semis du workspace courant doit donc etre une fonction TESTEE, pas une ligne dans index.ts.
  it('seme le workspace courant quand le registre est absent', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reg-seed-')), 'test-projects.json')
    const projets = ensureTestProjects('C:/dev/mon-app', path)
    expect(projets.map((p) => p.root)).toEqual(['C:/dev/mon-app'])
    // persiste : un second appel relit, il ne re-seme pas
    expect(loadTestProjects(path).map((p) => p.root)).toEqual(['C:/dev/mon-app'])
  })

  // ENTREE REFUTANTE : registre DEJA peuplé d'une autre racine. Un semis inconditionnel (ou un
  // ajout « tant qu'on y est ») ferait apparaitre C:/dev/mon-app ici — ce test doit alors echouer.
  it('ne touche pas un registre deja peuple', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reg-keep-')), 'test-projects.json')
    saveTestProjects([{ root: 'D:/autre-projet', label: 'Autre' }], path)
    const projets = ensureTestProjects('C:/dev/mon-app', path)
    expect(projets.map((p) => p.root)).toEqual(['D:/autre-projet'])
  })

  it('rend une liste vide sans semer quand aucune racine n est fournie', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reg-none-')), 'test-projects.json')
    expect(ensureTestProjects('   ', path)).toEqual([])
    expect(existsSync(path)).toBe(false)
  })
})
