import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dossierModAutowin } from '../main/providers/claude'

/**
 * LE MOD TEL QUE LE CLI LE CHARGE (piste 4 du scout du 05/11).
 * Avant, ce fichier testait `hooks/logique.mjs`, que rien ne chargeait : `hooks.json` ne nomme que
 * `register.js`. Il passait au vert pendant que les runs lisaient encore la promesse fausse sur les
 * tâches de fond. Ici, chaque module est importé d'APRÈS `hooks.json` : le test suit le manifeste.
 */
const HOOKS = join(__dirname, '..', '..', 'mods', 'autowin', 'hooks')
const MODULES: string[] = (
  JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')) as { modules: string[] }
).modules

type Handler = (
  $: unknown,
  e: Record<string, unknown>,
  next: (e: unknown) => Promise<unknown>
) => Promise<unknown>
type Inscrit = { filtre?: { tool?: string[] }; h: Handler }

async function inscrits(): Promise<Map<string, Inscrit>> {
  const m = new Map<string, Inscrit>()
  for (const nom of MODULES) {
    const mod = (await import(pathToFileURL(join(HOOKS, nom)).href)) as {
      register: (on: (ev: string, a: unknown, b?: unknown) => void) => void
    }
    mod.register((ev, a, b) => {
      m.set(
        ev,
        typeof a === 'function'
          ? { h: a as Handler }
          : { filtre: a as Inscrit['filtre'], h: b as Handler }
      )
    })
  }
  return m
}

const contexte = (env: Record<string, string>) => ({
  env: { get: async (k: string) => env[k] },
  plugin: { root: 'D:\\AutoWinOS\\mods\\autowin' },
  ui: { log: () => undefined }
})
const DANS_AUTOWIN = { AUTOWIN_APP_DATA_ROOT: 'D:\\AutoWinOS\\.autowin-data\\autowin-os' }

/**
 * Phrases RÉELLES de Claude Code 2.1.318, copiées de son binaire le 2026-11-05
 * (node_modules/@anthropic-ai/claude-code/bin/claude.exe, gabarit de l'outil shell quand
 * `backgroundShellsKeptElsewhere` est faux — le cas de nos runs, relu dans la description d'un tour).
 * C'est l'entrée qui fait échouer ce test si la correction rate : une regex écrite sur un autre texte
 * (« keeps running across turns » sans le « : it » ni le point final) ne la toucherait pas.
 */
const DESCRIPTION_CLI =
  'Executes a given bash command and returns its output.\n' +
  '- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. ' +
  'With it, `timeout` is how long the command may run in the background (default 600000, max 7200000); ' +
  'at that limit it is stopped and you are re-invoked. No `&` needed.'

async function decrire(
  env: Record<string, string>,
  description = DESCRIPTION_CLI
): Promise<string> {
  const { h } = (await inscrits()).get('tool.describe')!
  const r = (await h(contexte(env), { tool: 'Bash' }, async () => ({ description }))) as {
    description: string
  }
  return r.description
}

describe('mod Autowin — ce que hooks.json charge', () => {
  it('chaque module nommé existe et expose register()', async () => {
    expect(MODULES.length).toBeGreaterThan(0)
    expect((await inscrits()).size).toBeGreaterThan(0)
  })

  it('aucun fichier de code mort dans hooks/ : tout est nommé par hooks.json ou importé par un module chargé', () => {
    const charges = new Set(MODULES.map((m) => m.replace(/^\.\//, '')))
    for (const m of [...charges]) {
      for (const i of readFileSync(join(HOOKS, m), 'utf8').matchAll(/from\s+'\.\/([^']+)'/g))
        charges.add(i[1])
    }
    const code = readdirSync(HOOKS).filter((f) => /\.(m?js)$/.test(f))
    expect(code.filter((f) => !charges.has(f))).toEqual([])
  })
})

describe('mod Autowin — description de l’outil shell (tool.describe du module chargé)', () => {
  it('branché sur Bash ET PowerShell', async () => {
    expect((await inscrits()).get('tool.describe')!.filtre?.tool).toEqual(['Bash', 'PowerShell'])
  })

  it('dans Autowin : la tâche de fond est dite ARRÊTÉE à la fin du tour, plus aucune relance promise', async () => {
    const d = await decrire(DANS_AUTOWIN)
    expect(d).not.toContain('keeps running across turns')
    expect(d).not.toContain('re-invoke')
    expect(d).toContain('STOPPED when the current turn ends')
    expect(d).toContain('at that limit it is stopped.')
    // Les deux suites réelles : relance hors du tour en chat (relance-taches-de-fond.ts), perte en run.
    expect(d).toContain('In a chat turn, Autowin then re-runs the shell command from the start')
    expect(d).toContain('in a run step, its result is lost')
    // Le reste du texte du CLI est gardé, et la règle du bureau caché est ajoutée.
    expect(d).toContain('Executes a given bash command and returns its output.')
    expect(d).toContain('No `&` needed.')
    expect(d).toContain('hdesk-lancer.ps1')
  })

  it('dans Autowin : un second passage rend le même texte (cache stable)', async () => {
    const une = await decrire(DANS_AUTOWIN)
    expect(await decrire(DANS_AUTOWIN, une)).toBe(une)
  })

  it('hors d’Autowin (réglage administrateur, session ordinaire) : la description du CLI reste intacte', async () => {
    // Jumeau du cas précédent : hors d'Autowin, une tâche de fond survit bien au tour.
    expect(await decrire({})).toBe(DESCRIPTION_CLI)
  })
})

describe('mod Autowin — tool.call du module chargé', () => {
  it('dans un run (bureau caché connu), notepad est redirigé vers le lanceur', async () => {
    const { h } = (await inscrits()).get('tool.call')!
    const r = (await h(
      contexte({ AUTOWIN_HDESK_ID: 'run-test-1' }),
      { tool: 'PowerShell', command: 'notepad C:/x.txt' },
      async (e) => e
    )) as { command: string }
    expect(r.command).toMatch(/^powershell -NoProfile -EncodedCommand /)
  })
})

describe('dossierModAutowin', () => {
  it('trouve mods/autowin en remontant depuis out/main/chunks', () => {
    const racine = join('D:', 'Autowin')
    const vise = join(racine, 'mods', 'autowin', '.claude-plugin', 'plugin.json')
    expect(dossierModAutowin([join(racine, 'out', 'main', 'chunks')], (p) => p === vise)).toBe(
      join(racine, 'mods', 'autowin')
    )
  })
  it('rend undefined sans mod', () => {
    expect(dossierModAutowin([join('D:', 'ailleurs')], () => false)).toBeUndefined()
  })
  it('trouve le vrai mod du dépôt', () => {
    expect(dossierModAutowin([__dirname])).toBe(join(__dirname, '..', '..', 'mods', 'autowin'))
  })
})
