import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { failedActionRunId, pickRunForTrace, runIdFromActionData } from './run-trace-target'

const run = (path: string, mtime: number) => ({ path, mtime })

describe('runIdFromActionData — tolerant a une donnee de forme libre', () => {
  it('extrait un runId presentable', () => {
    expect(runIdFromActionData({ runId: 'run-a-1' })).toBe('run-a-1')
  })

  it('ignore ce qui n’est pas un identifiant utilisable', () => {
    expect(runIdFromActionData(undefined)).toBeUndefined()
    expect(runIdFromActionData(null)).toBeUndefined()
    expect(runIdFromActionData('run-a-1')).toBeUndefined() // pas un objet
    expect(runIdFromActionData({ runId: 42 })).toBeUndefined()
    expect(runIdFromActionData({ runId: '   ' })).toBeUndefined()
    expect(runIdFromActionData({})).toBeUndefined()
  })
})

describe('failedActionRunId — cible l’action FAUTIVE, pas une reussie', () => {
  it('prend le runId de l’action en echec', () => {
    const actions = [
      { ok: true, data: { runId: 'run-ok' } },
      { ok: false, data: { runId: 'run-casse' } }
    ]
    expect(failedActionRunId(actions)).toBe('run-casse')
  })

  it('prend le runId de l’action INTERROMPUE', () => {
    const actions = [
      { ok: true, data: { runId: 'run-ok' } },
      { interrupted: true, data: { runId: 'run-interrompu' } }
    ]
    expect(failedActionRunId(actions)).toBe('run-interrompu')
  })

  it('a defaut d’action fautive identifiable, retombe sur le premier runId connu', () => {
    expect(failedActionRunId([{ ok: false }, { ok: true, data: { runId: 'run-x' } }])).toBe('run-x')
  })

  it('aucun runId nulle part → undefined (l’appelant degrade proprement)', () => {
    expect(failedActionRunId([{ ok: false }, { ok: true }])).toBeUndefined()
    expect(failedActionRunId([])).toBeUndefined()
  })
})

describe('pickRunForTrace — degradation successive, jamais de pari', () => {
  it('1. correspondance EXACTE par le chemin qui porte le runId', () => {
    const runs = [
      run('C:/runs/sess/autre-workspace/RUN.md', 500),
      run('C:/runs/sess/run-a-1-workspace/RUN.md', 100)
    ]
    expect(pickRunForTrace(runs, 'run-a-1')?.path).toContain('run-a-1')
  })

  it('la correspondance exacte PRIME sur le plus recent', () => {
    const runs = [run('C:/runs/recent/RUN.md', 9_999), run('C:/runs/run-cible/RUN.md', 1)]
    expect(pickRunForTrace(runs, 'run-cible')?.mtime).toBe(1)
  })

  it('tolere les separateurs Windows et la casse', () => {
    const runs = [run('C:\\runs\\sess\\RUN-A-1-workspace\\RUN.md', 10)]
    expect(pickRunForTrace(runs, 'run-a-1')).toBeDefined()
  })

  it('2. sans runId, prend le plus RECENT (l’erreur vient du dernier run)', () => {
    const runs = [run('a', 10), run('b', 30), run('c', 20)]
    expect(pickRunForTrace(runs)?.path).toBe('b')
  })

  it('2bis. runId INTROUVABLE → plus recent, plutot que rien', () => {
    const runs = [run('a', 10), run('b', 30)]
    expect(pickRunForTrace(runs, 'run-inexistant')?.path).toBe('b')
  })

  it('3. aucun run → undefined (le clic garde son comportement d’origine, aucune regression)', () => {
    expect(pickRunForTrace([], 'run-a-1')).toBeUndefined()
    expect(pickRunForTrace([])).toBeUndefined()
  })
})

/**
 * Contrat de CABLAGE : la resolution doit etre reellement utilisee par le clic, sinon elle reste un
 * module jamais appele et le clic continue d'ouvrir la seule liste des runs.
 */
describe('cablage du clic « action avec erreur » → trace', () => {
  const read = (file: string): string =>
    readFileSync(join(__dirname, file), 'utf8')

  it('le bloc d’activite transmet le run FAUTIF au clic', () => {
    const parts = read('ChatView.parts.tsx')
    expect(parts).toContain('failedActionRunId(actions)')
    expect(parts).toMatch(/onOpenLiveAction\?:\s*\(mode: 'live' \| 'history', runId\?: string\)/)
  })

  it('le Chat OUVRE la trace du run resolu (et ne se contente plus de cadrer la liste)', () => {
    const chat = read('ChatView.tsx')
    expect(chat).toContain('pickRunForTrace(runsRef.current, runId)')
    expect(chat).toContain('void viewRun(target)')
    // Degradation preservee : sans run resolu, on garde le cadrage d'origine.
    expect(chat).toContain("setRunScope('conv')")
  })
})

/**
 * CAS REEL du contrat `orchestrate` : commands.ts retourne `{ runId: runPath, runPath }` — la
 * reference remise au chat EST le chemin du RUN.md. Le ciblage est donc deterministe, et ces cas
 * l'attestent (une premiere analyse supposait a tort deux identites distinctes).
 */
describe('contrat reel orchestrate — la reference EST un chemin', () => {
  const RUN_PATH = 'C:\\Users\\x\\.claude\\runs\\sess-1\\audit-workspace\\RUN.md'

  it('cible EXACTEMENT le run dont le chemin est retourne, meme s’il n’est pas le plus recent', () => {
    const runs = [
      { path: 'C:/Users/x/.claude/runs/sess-1/autre-workspace/RUN.md', mtime: 9_999 },
      { path: 'C:/Users/x/.claude/runs/sess-1/audit-workspace/RUN.md', mtime: 1 }
    ]
    const runId = failedActionRunId([{ ok: false, data: { runId: RUN_PATH, runPath: RUN_PATH } }])
    expect(pickRunForTrace(runs, runId)?.mtime).toBe(1)
  })

  it('prefere `runPath` a `runId` (champ explicite du contrat)', () => {
    expect(runIdFromActionData({ runId: 'ancien', runPath: 'chemin/attendu' })).toBe(
      'chemin/attendu'
    )
    // `runId` reste accepte seul (retro-compat du champ historique).
    expect(runIdFromActionData({ runId: 'seulement-runid' })).toBe('seulement-runid')
  })

  it('un run PURGE (chemin plus liste) retombe sur le plus recent, sans jamais rien ouvrir de faux', () => {
    const runs = [{ path: 'C:/runs/encore-la/RUN.md', mtime: 5 }]
    const runId = failedActionRunId([
      { interrupted: true, data: { runPath: 'C:/runs/disparu/RUN.md' } }
    ])
    expect(pickRunForTrace(runs, runId)?.path).toBe('C:/runs/encore-la/RUN.md')
  })
})

describe('contrat cote main — orchestrate expose bien le chemin du run', () => {
  it('retourne runPath (et runId aligne dessus)', () => {
    const commands = readFileSync(join(__dirname, '..', '..', '..', 'main', 'commands.ts'), 'utf8')
    // Si ce contrat disparait, le clic perd sa cible exacte et retombe silencieusement sur
    // « le plus recent » — d'ou cette assertion.
    expect(commands).toContain('runPath')
    expect(commands).toMatch(/runId:\s*runPath/)
  })
})
