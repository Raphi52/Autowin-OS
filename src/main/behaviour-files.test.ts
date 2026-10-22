import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { listBehaviourFiles, readBehaviourFileFromManifest } from './behaviour-files'
import { loadProjectContext } from './context-files'
import { codexExecSpec } from './providers/codex'
import { supprimerArbre } from './fs-supprimer'

vi.mock('./capability-controls', () => ({
  listCapabilities: vi.fn(async (kind: string) =>
    kind === 'skills' ? [{ id: 'always-visible', enabled: true }] : []
  )
}))

type TestOptions = {
  workspaceRoot: string
  contextRoot: string
  homeRoot: string
}

type Instruction = Awaited<ReturnType<typeof listBehaviourFiles>>[number]

const sandboxes: string[] = []

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), 'behaviour-files-'))
  sandboxes.push(path)
  return path
}

function put(path: string, contents = path): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
  return path
}

function options(root: string, context = join(root, 'workspace', 'projectA')): TestOptions {
  return {
    workspaceRoot: join(root, 'workspace'),
    contextRoot: context,
    homeRoot: join(root, 'home')
  }
}

function normalized(path: string): string {
  return path.replaceAll('\\', '/')
}

function select(files: Instruction[], engine: Instruction['engine']): Instruction[] {
  return files.filter((file) => file.engine === engine)
}

afterEach(() => {
  for (const path of sandboxes.splice(0)) supprimerArbre(path)
})

describe('behaviour instruction map', () => {
  it('Codex ne charge que le global : les AGENTS.md de projet sont inactifs, celui retenu par Autowin est dit replié', async () => {
    const root = sandbox()
    const opts = options(root)
    const global = put(join(opts.homeRoot, '.codex', 'AGENTS.md'))
    const workspaceBase = put(join(opts.workspaceRoot, 'AGENTS.md'))
    const workspaceOverride = put(join(opts.workspaceRoot, 'AGENTS.override.md'))
    const projectA = put(join(opts.contextRoot, 'AGENTS.md'))
    const projectB = put(join(opts.workspaceRoot, 'projectB', 'AGENTS.md'))
    const projectBOverride = put(join(opts.workspaceRoot, 'projectB', 'AGENTS.override.md'))

    const codex = select(await listBehaviourFiles(opts), 'codex')
    const active = codex.filter((file) => file.state === 'active')

    // CONTRAT CORRIGÉ (conv-984, 2026-10-16). Ce test affirmait la chaîne NATIVE de Codex :
    // override du workspace et AGENTS.md du projet « active ». Faux sous Autowin : `codexExecSpec`
    // lance toujours le CLI avec `-c project_doc_max_bytes=0`, qui coupe la boucle des fichiers de
    // projet (le global est ajouté avant elle). Seul le global reste chargé par Codex.
    expect(active.map((file) => normalized(file.path))).toEqual([normalized(global)])
    for (const path of [workspaceBase, workspaceOverride, projectA, projectB, projectBOverride]) {
      expect(codex.find((file) => file.path === path)?.state).toBe('shadowed')
      expect(codex.find((file) => file.path === path)?.reason).toMatch(/project_doc_max_bytes=0/)
    }
    // Le fichier que la chaîne d'Autowin retient pour le contexte sélectionné est dit replié par
    // Autowin ; un override n'est lu par personne ; les autres ne le seraient que dans leur dossier.
    expect(codex.find((file) => file.path === projectA)?.reason).toMatch(/Autowin le replie/)
    expect(codex.find((file) => file.path === workspaceOverride)?.reason).toMatch(
      /ne lit pas AGENTS\.override\.md/
    )
    expect(codex.find((file) => file.path === workspaceBase)?.reason).not.toMatch(
      /Autowin le replie/
    )

    const selectedProjectB = select(
      await listBehaviourFiles({ ...opts, contextRoot: join(opts.workspaceRoot, 'projectB') }),
      'codex'
    )
    expect(selectedProjectB.find((file) => file.path === projectB)?.reason).toMatch(
      /Autowin le replie/
    )
    expect(selectedProjectB.find((file) => file.path === projectBOverride)?.state).toBe('shadowed')
  })

  it('resolves Claude user memory and ancestors while a sibling remains conditional', async () => {
    const root = sandbox()
    const opts = options(root)
    const global = put(join(opts.homeRoot, '.claude', 'CLAUDE.md'))
    const workspace = put(join(opts.workspaceRoot, 'CLAUDE.md'))
    const projectA = put(join(opts.contextRoot, 'CLAUDE.local.md'))
    const projectB = put(join(opts.workspaceRoot, 'projectB', 'CLAUDE.md'))

    const claude = select(await listBehaviourFiles(opts), 'claude')

    // CONTRAT CORRIGÉ. Ce test affirmait que la mémoire globale et `CLAUDE.local.md` étaient
    // `active` : c'était faux, et l'utilisateur a légitimement douté de ce qui pilote ses agents en
    // voyant « actif » dans Settings → Behaviour. Deux faits vérifiés dans le code :
    //   1. Autowin lance le CLI Claude avec `--setting-sources ""` (`providers/claude.ts`) → la
    //      mémoire utilisateur globale n'est JAMAIS chargée ici. Elle gouverne les sessions Claude
    //      Code lancées à la main, pas les agents d'Autowin.
    //   2. Ce qui atteint le prompt vient de `PROJECT_CONTEXT_CHAIN` (`context-files.ts`) :
    //      `AGENTS.md` → `CLAUDE.md` → `.cursorrules`, le PREMIER trouvé. `CLAUDE.local.md` n'y est
    //      pas du tout.
    // Seul le `CLAUDE.md` du workspace est donc réellement replié dans un prompt.
    //
    // conv-1067 (2026-10-22) : ce test le déclarait actif sans `.git`, alors que le chargeur ne lisait
    // QUE le contexte sélectionné (`projectA`) — la vue mentait. Le chargeur empile désormais de la
    // racine du dépôt git au contexte : le workspace est donc rendu racine d'un dépôt ici, et le cas
    // hors dépôt est prouvé juste après.
    mkdirSync(join(opts.workspaceRoot, '.git'))
    const claudeEnDepot = select(await listBehaviourFiles(opts), 'claude')
    expect(
      claudeEnDepot.filter((file) => file.state === 'active').map((file) => normalized(file.path))
    ).toEqual([normalized(workspace)])
    expect(claude.find((file) => file.path === workspace)?.state).toBe('shadowed')
    expect(claude.find((file) => file.path === workspace)?.reason).toMatch(/empilement/)
    expect(claude.find((file) => file.path === global)?.state).toBe('shadowed')
    expect(claude.find((file) => file.path === global)?.reason).toMatch(/--setting-sources/)
    expect(claude.find((file) => file.path === projectA)?.state).toBe('shadowed')
    expect(claude.find((file) => file.path === projectB)?.state).toBe('conditional')
  })

  // conv-1067 (2026-10-22) : un fil rangé sur un SOUS-dossier d'un dépôt reçoit aussi les consignes des
  // dossiers parents. La vue doit les montrer injectés — même au-dessus du workspace inspecté — et
  // savoir en lire l'extrait (sinon l'IPC de la vue tombe « hors des racines autorisées »).
  it('un AGENTS.md parent, dans le même dépôt, est affiché EMPILÉ et son extrait se lit', async () => {
    const root = sandbox()
    mkdirSync(join(root, '.git'))
    const parent = put(join(root, 'AGENTS.md'), '# Consignes du dépôt\n')
    const front = join(root, 'front')
    const local = put(join(front, 'AGENTS.md'), '# Consignes du front\n')
    const opts = { workspaceRoot: front, contextRoot: front, homeRoot: join(root, 'home') }

    const manifest = await listBehaviourFiles(opts)
    const autowin = select(manifest, 'autowin')
    const empile = autowin.find((file) => normalized(file.path) === normalized(parent))
    expect(empile?.state).toBe('injected')
    expect(empile?.reason).toMatch(/dossier parent/)
    expect(autowin.find((file) => normalized(file.path) === normalized(local))?.state).toBe(
      'injected'
    )
    expect(
      select(manifest, 'codex').find((file) => normalized(file.path) === normalized(parent))
    ).toBeUndefined()
    await expect(readBehaviourFileFromManifest(empile!.id, manifest, opts)).resolves.toBe(
      '# Consignes du dépôt\n'
    )
  })

  it('un CLAUDE.md voisin d’un AGENTS.md est MASQUÉ : la chaîne prend le premier', async () => {
    const root = sandbox()
    const opts = options(root)
    const claudeMd = put(join(opts.workspaceRoot, 'CLAUDE.md'))
    put(join(opts.workspaceRoot, 'AGENTS.md'))

    const claude = select(await listBehaviourFiles(opts), 'claude')

    const fiche = claude.find((file) => file.path === claudeMd)
    expect(fiche?.state).toBe('shadowed')
    expect(fiche?.reason).toMatch(/AGENTS\.md/)
    expect(fiche?.active).toBe(false)
  })

  // conv-984 (2026-10-16) : la vue Behaviour affichait le AGENTS.md du dépôt en « autowin · declared ·
  // Candidat prioritaire, injection non tracée », alors que `projectContextBlock` le replie dans le
  // prompt de CHAQUE tour du chat (index.ts) et de chaque étape lancée (orchestrator.ts). L'entrée
  // Autowin doit dire ce que fait le chargeur réel : même chaîne, même gagnant.
  it('le fichier retenu par le chargeur de contexte projet est affiché INJECTÉ, pas « déclaré »', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const agents = put(join(opts.workspaceRoot, 'AGENTS.md'), '# Consignes du dépôt\n')
    const claudeMd = put(join(opts.workspaceRoot, 'CLAUDE.md'), '# Autre\n')

    expect(loadProjectContext(opts.workspaceRoot)?.file).toBe('AGENTS.md')
    const autowin = select(await listBehaviourFiles(opts), 'autowin')

    const injecte = autowin.find((file) => file.path === agents)
    expect(injecte?.state).toBe('injected')
    expect(injecte?.active).toBe(true)
    expect(injecte?.reason).toMatch(/prompt/i)
    expect(injecte?.reason).not.toMatch(/non trac/i)
    expect(injecte?.injectedAt).not.toMatch(/non trac/i)

    const masque = autowin.find((file) => file.path === claudeMd)
    expect(masque?.state).toBe('shadowed')
    expect(masque?.reason).toMatch(/AGENTS\.md/)
  })

  it('suit le chargeur jusque dans ses sauts : un AGENTS.md vide cède la place au CLAUDE.md', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const vide = put(join(opts.workspaceRoot, 'AGENTS.md'), '  \n')
    const claudeMd = put(join(opts.workspaceRoot, 'CLAUDE.md'), '# Consignes\n')

    expect(loadProjectContext(opts.workspaceRoot)?.file).toBe('CLAUDE.md')
    const autowin = select(await listBehaviourFiles(opts), 'autowin')

    expect(autowin.find((file) => file.path === claudeMd)?.state).toBe('injected')
    const saute = autowin.find((file) => file.path === vide)
    expect(saute?.state).toBe('shadowed')
    expect(saute?.reason).toMatch(/vide/i)
  })

  // conv-984 (2026-10-16) : la vue affichait le AGENTS.md du dépôt en « codex · active · Applicable au
  // contexte sélectionné », « Au démarrage de la session Codex ». Or Autowin lance TOUJOURS Codex avec
  // `-c project_doc_max_bytes=0` (`providers/codex.ts`, défaut de `codexExecSpec`) : le CLI ne lit
  // aucun AGENTS.md de projet, c'est Autowin qui replie le fichier. Le fichier GLOBAL
  // (`~/.codex/AGENTS.md`) n'est pas concerné : Codex l'ajoute avant la boucle des fichiers de projet,
  // que cette clé seule arrête (codex-rs/core/src/agents_md.rs, `load_project_instructions`, v0.151.0).
  it('un AGENTS.md de projet n’est PAS chargé par Codex (project_doc_max_bytes=0) : Autowin le replie', async () => {
    // Le constat vient de l'argv réel : si la coupure saute, ce test le dit avant la vue.
    const spec = codexExecSpec(
      String.raw`C:\repo`,
      'm',
      'read-only',
      undefined,
      String.raw`C:\AppData`,
      () => true
    )
    const paires = spec.args.map((a, i) => `${spec.args[i - 1] ?? ''} ${a}`)
    expect(paires).toContain('-c project_doc_max_bytes=0')

    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const global = put(join(opts.homeRoot, '.codex', 'AGENTS.md'), '# Global\n')
    const agents = put(join(opts.workspaceRoot, 'AGENTS.md'), '# Consignes du dépôt\n')

    const codex = select(await listBehaviourFiles(opts), 'codex')

    const fiche = codex.find((file) => file.path === agents)
    expect(fiche?.state).toBe('shadowed')
    expect(fiche?.active).toBe(false)
    expect(fiche?.reason).toMatch(/project_doc_max_bytes=0/)
    expect(fiche?.reason).toMatch(/Autowin le replie/)
    expect(fiche?.injectedAt).not.toMatch(/démarrage de la session Codex/)

    // Le global, lui, reste chargé par Codex.
    expect(codex.find((file) => file.path === global)?.state).toBe('active')
  })

  it('does not leak a manifest between two successive workspaces', async () => {
    const root = sandbox()
    const workspaceA = join(root, 'workspace-a')
    const workspaceB = join(root, 'workspace-b')
    const homeRoot = join(root, 'home')
    const onlyA = put(join(workspaceA, 'AGENTS.md'))
    const onlyB = put(join(workspaceB, 'CLAUDE.md'))

    await listBehaviourFiles({ workspaceRoot: workspaceA, contextRoot: workspaceA, homeRoot })
    const second = await listBehaviourFiles({
      workspaceRoot: workspaceB,
      contextRoot: workspaceB,
      homeRoot
    })

    expect(second.some((file) => file.path === onlyA)).toBe(false)
    expect(second.some((file) => file.path === onlyB)).toBe(true)
  })

  it('excludes dependency, VCS, audit and internal Claude worktree trees', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const visible = put(join(opts.workspaceRoot, 'app', 'AGENTS.md'))
    const excluded = [
      put(join(opts.workspaceRoot, 'node_modules', 'pkg', 'AGENTS.md')),
      put(join(opts.workspaceRoot, '.git', 'nested', 'CLAUDE.md')),
      put(join(opts.workspaceRoot, 'Audit', 'run', 'AGENTS.md')),
      put(join(opts.workspaceRoot, 'aUdIt', 'run', 'CLAUDE.md')),
      put(join(opts.workspaceRoot, 'Node_Modules', 'pkg', 'AGENTS.md')),
      put(join(opts.workspaceRoot, 'PLUGINS', 'internal', 'CLAUDE.md')),
      put(join(opts.workspaceRoot, '.Git', 'nested', 'AGENTS.md')),
      put(join(opts.workspaceRoot, '.claude', 'worktrees', 'branch', 'CLAUDE.md'))
    ]

    const files = await listBehaviourFiles(opts)
    const relativePaths = files.map((file) => normalized(relative(opts.workspaceRoot, file.path)))

    expect(relativePaths).toContain(normalized(relative(opts.workspaceRoot, visible)))
    for (const path of excluded) {
      expect(relativePaths).not.toContain(normalized(relative(opts.workspaceRoot, path)))
    }
  })

  it('keeps every engine anchor (codex, claude, autowin) when discovery exceeds the cap', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    put(join(opts.homeRoot, '.codex', 'AGENTS.md'))
    put(join(opts.homeRoot, '.claude', 'CLAUDE.md'))
    put(join(opts.workspaceRoot, 'AGENTS.md'))
    put(join(opts.workspaceRoot, 'CLAUDE.md'))
    for (let index = 0; index < 520; index += 1) {
      put(join(opts.workspaceRoot, `codex-${String(index).padStart(3, '0')}`, 'AGENTS.md'))
    }

    const files = await listBehaviourFiles({
      ...opts,
      localAppDataRoot: join(root, 'local-app-data')
    })

    expect(files.length).toBeLessThanOrEqual(500)
    // Engine natif « autowin » (fichiers d'instruction génériques du contexte) + codex + claude.
    expect(new Set(files.map((file) => file.engine))).toEqual(
      new Set(['codex', 'claude', 'autowin'])
    )
    expect(files.some((file) => file.engine === 'claude' && file.scope === 'global')).toBe(true)
    expect(files.some((file) => file.engine === 'autowin')).toBe(true)
  }, 15_000)

  it('discovers mixed-case instruction names on Windows', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const context = join(opts.workspaceRoot, 'mixed-case')
    const base = put(join(context, 'Agents.md'))
    const override = put(join(context, 'AGENTS.Override.md'))
    const claude = put(join(context, 'claude.local.md'))

    const files = await listBehaviourFiles(opts)
    // Découverts malgré la casse. Côté Codex, un fichier de projet n'est jamais chargé
    // (`project_doc_max_bytes=0`, conv-984) : il ressort donc inactif, pas « conditionnel ».
    expect(files.find((file) => file.path === override)?.state).toBe('shadowed')
    expect(files.find((file) => file.path === override)?.reason).toMatch(/project_doc_max_bytes=0/)
    expect(files.find((file) => file.path === base)?.state).toBe('shadowed')
    expect(files.find((file) => file.path === claude)?.state).toBe('conditional')
  })

  it('falls back to the approved workspace when a context junction targets outside it', async () => {
    const root = sandbox()
    const workspaceRoot = join(root, 'workspace')
    const outside = join(root, 'outside')
    const workspaceFile = put(join(workspaceRoot, 'AGENTS.md'))
    const outsideFile = put(join(outside, 'AGENTS.md'))
    const junction = join(workspaceRoot, 'external-context')
    symlinkSync(outside, junction, 'junction')

    const files = await listBehaviourFiles({
      workspaceRoot,
      contextRoot: junction,
      homeRoot: join(root, 'home')
    })

    // Le repli se voit sur ce qu'Autowin replie : le fichier du workspace approuvé (conv-984 : Codex,
    // lui, ne charge plus aucun fichier de projet, son entrée ne prouve donc plus le repli).
    expect(
      files.find((file) => file.path === workspaceFile && file.engine === 'autowin')?.state
    ).toBe('injected')
    expect(files.some((file) => file.path === outsideFile)).toBe(false)
  })

  it('revalidates size at read time and confines an id to its requested workspace', async () => {
    const root = sandbox()
    const workspaceA = join(root, 'workspace-a')
    const workspaceB = join(root, 'workspace-b')
    const homeRoot = join(root, 'home')
    const pathA = put(join(workspaceA, 'AGENTS.md'), 'small')
    const optsA = { workspaceRoot: workspaceA, contextRoot: workspaceA, homeRoot }
    const manifestA = await listBehaviourFiles(optsA)
    const fileA = manifestA.find((file) => file.path === pathA)
    expect(fileA).toBeDefined()

    writeFileSync(pathA, 'x'.repeat(512_001), 'utf8')
    await expect(readBehaviourFileFromManifest(fileA!.id, manifestA, optsA)).rejects.toThrow(
      /volumineux|512/i
    )

    mkdirSync(workspaceB, { recursive: true })
    await expect(
      readBehaviourFileFromManifest(fileA!.id, manifestA, {
        workspaceRoot: workspaceB,
        contextRoot: workspaceB,
        homeRoot
      })
    ).rejects.toThrow(/inconnu|autoris|workspace|racine/i)
  })

  it('reuses an existing manifest when reading excerpts', async () => {
    const root = sandbox()
    const opts = options(root, join(root, 'workspace'))
    const path = put(join(opts.workspaceRoot, 'AGENTS.md'), 'manifest reuse')
    const manifest = await listBehaviourFiles(opts)
    const file = manifest.find((candidate) => candidate.path === path)

    await expect(readBehaviourFileFromManifest(file!.id, manifest, opts)).resolves.toBe(
      'manifest reuse'
    )
    await expect(readBehaviourFileFromManifest('forged', manifest, opts)).rejects.toThrow(
      /inconnu|autoris|workspace/i
    )
  })
})
