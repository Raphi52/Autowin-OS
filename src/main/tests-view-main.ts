import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { ensureAutowinAppData } from './app-data'
import {
  detectTestRunner,
  normalizeProjects,
  parseTestReport,
  summarizeReport,
  type TestProject,
  type TestReport,
  type TestRunner,
  type TestTotals
} from '../shared/test-projects'

/**
 * Côté processus principal de la vue Tests : registre des projets sur disque + exécution du harnais
 * du projet DEMANDÉ. Rien n'y est spécifique à Autowin OS — la racine est une donnée.
 */

export interface InspectedProject extends TestProject {
  runner: TestRunner
  /** FAUX quand la racine n'existe pas ou ne porte pas de harnais : dit pourquoi, ne devine pas. */
  runnable: boolean
  reason?: string
}

export interface ProjectRunResult {
  root: string
  runner: TestRunner
  totals: TestTotals
  report: TestReport
  exitCode: number | null
  durationMs: number
}

function registryPath(): string {
  return join(ensureAutowinAppData(), 'test-projects.json')
}

export function loadTestProjects(path = registryPath()): TestProject[] {
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    return normalizeProjects((JSON.parse(raw) as { projects?: unknown }).projects)
  } catch {
    return [] // registre corrompu : liste vide, jamais une racine devinée
  }
}

export function saveTestProjects(projects: unknown, path = registryPath()): TestProject[] {
  const normalized = normalizeProjects(projects)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ projects: normalized }, null, 2), 'utf8')
  return normalized
}

/** Lit le package.json de la racine pour dire QUEL harnais la vue pourra lancer. */
export function inspectProject(project: TestProject): InspectedProject {
  const manifest = join(project.root, 'package.json')
  if (!existsSync(project.root)) {
    return { ...project, runner: 'none', runnable: false, reason: 'racine introuvable' }
  }
  if (!existsSync(manifest)) {
    return { ...project, runner: 'none', runnable: false, reason: 'aucun package.json' }
  }
  let pkg: unknown
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return { ...project, runner: 'none', runnable: false, reason: 'package.json illisible' }
  }
  const detected = detectTestRunner(pkg)
  return {
    ...project,
    runner: detected.runner,
    runnable: detected.runner !== 'none',
    ...(detected.runner === 'none' ? { reason: 'aucun harnais vitest/jest declare' } : {})
  }
}

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>

const defaultRunner: CommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code as number)
            : error
              ? null
              : 0
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode: code })
      }
    )
  })

/**
 * Lance la suite du projet et rend un rapport LU. Un exit different de 0 est normal quand des tests
 * echouent : le verdict vient du rapport, pas du code de sortie. Une sortie sans rapport rend
 * `invalid` — la vue affiche l'echec au lieu d'un vert invente.
 */
export async function runProjectTests(
  project: TestProject,
  options: { run?: CommandRunner; filter?: string } = {}
): Promise<ProjectRunResult> {
  const inspected = inspectProject(project)
  if (!inspected.runnable) {
    const report: TestReport = { cases: [], invalid: inspected.reason ?? 'projet non executable' }
    return {
      root: project.root,
      runner: inspected.runner,
      totals: summarizeReport(report),
      report,
      exitCode: null,
      durationMs: 0
    }
  }
  const pkg = JSON.parse(
    readFileSync(join(project.root, 'package.json'), 'utf8').replace(/^\uFEFF/, '')
  ) as unknown
  const detected = detectTestRunner(pkg)
  const filter = options.filter?.trim()
  const args = filter ? [...detected.args, filter] : detected.args
  const started = Date.now()
  const run = options.run ?? defaultRunner
  const result = await run(detected.command, args, project.root)
  const report = parseTestReport(`${result.stdout}\n${result.stderr}`)
  return {
    root: project.root,
    runner: detected.runner,
    totals: summarizeReport(report),
    report,
    exitCode: result.exitCode,
    durationMs: Date.now() - started
  }
}
