import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AMITEL_BRAIN_THEMES,
  loadBrainGraph,
  loadVaultBrainGraph,
  loadVaultBrainNodesForThemes,
  loadVaultBrainGraphPreviewAsync,
  loadVaultBrainNeighborhood,
  readNodeFile,
  scanBrainGraphs,
  searchVaultBrainNotes
} from './fs-brains'

describe('Amitel Brain graph', () => {
  it('discovers Amitel Brain with a broad multi-category catalog', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-brain-'))
    mkdirSync(join(root, 'projects'))

    expect(scanBrainGraphs([join(root, 'projects')], root)[0]).toMatchObject({
      id: 'amitel-brain',
      label: 'Amitel Brain',
      path: root,
      kind: 'vault',
      themes: AMITEL_BRAIN_THEMES
    })
    expect(AMITEL_BRAIN_THEMES).toHaveLength(22)
    expect(AMITEL_BRAIN_THEMES.map((theme) => theme.id)).toEqual(
      expect.arrayContaining([
        'category/brain',
        'category/procedures',
        'category/justice',
        'category/rcs',
        'category/moteur-ui',
        'project/rig-tv',
        'project/rig-processus',
        'project/rig-etapercs'
      ])
    )
  })

  it('assigns several derived categories to the same note and preserves wiki links', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-vault-'))
    mkdirSync(join(root, 'projects/rig-tv/obsidian'), { recursive: true })
    mkdirSync(join(root, 'knowledge/domain/rigapplication-documentation/reference/60-metier-rcs'), {
      recursive: true
    })
    writeFileSync(
      join(root, 'HOME.md'),
      '# Accueil\n[[projects/rig-tv/obsidian/rig-tv]]\n[[knowledge/domain/rigapplication-documentation/reference/60-metier-rcs/inscription]]\n',
      'utf8'
    )
    writeFileSync(
      join(root, 'projects/rig-tv/obsidian/rig-tv.md'),
      '# RIG-TV\nTests KBIS, build et déploiement EDI.\n',
      'utf8'
    )
    writeFileSync(
      join(
        root,
        'knowledge/domain/rigapplication-documentation/reference/60-metier-rcs/inscription.md'
      ),
      '# Inscription RCS\nImmatriculation au registre du commerce avec modèle SQL.\n',
      'utf8'
    )

    const graph = loadVaultBrainGraph(root, 20)
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'HOME', themes: ['category/brain'] }),
        expect.objectContaining({
          id: 'projects/rig-tv/obsidian/rig-tv',
          themes: expect.arrayContaining([
            'category/rig',
            'category/echanges-services',
            'category/build-diagnostic',
            'project/rig-tv'
          ])
        }),
        expect.objectContaining({
          id: 'knowledge/domain/rigapplication-documentation/reference/60-metier-rcs/inscription',
          themes: expect.arrayContaining([
            'category/rig',
            'category/documentation',
            'category/rcs',
            'category/donnees'
          ])
        })
      ])
    )
    expect(graph.links).toHaveLength(2)
  })

  it('discovers YAML themes dynamically and searches notes outside the displayed LOD', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-dynamic-theme-'))
    mkdirSync(join(root, 'knowledge/domain'), { recursive: true })
    writeFileSync(
      join(root, 'knowledge/domain/autowin.md'),
      '---\ntags: [theme/autowin-os, theme/architecture]\n---\n# Autowin OS\n',
      'utf8'
    )
    writeFileSync(
      join(root, 'knowledge/domain/other.md'),
      '---\ntags: [theme/autowin-os]\n---\n# Other\n',
      'utf8'
    )

    const ref = scanBrainGraphs([], root)[0]
    expect(ref.themes).toEqual(
      expect.arrayContaining([
        { id: 'theme/autowin-os', label: 'Autowin OS' },
        { id: 'theme/architecture', label: 'Architecture' }
      ])
    )

    // LOD 1 masque au moins une note, mais la recherche reste exhaustive.
    expect(loadVaultBrainGraph(root, 1).nodes).toHaveLength(1)
    expect(searchVaultBrainNotes(root, 'autowin')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'knowledge/domain/autowin',
          label: 'Autowin OS',
          themes: expect.arrayContaining(['theme/autowin-os', 'theme/architecture'])
        })
      ])
    )
    expect(searchVaultBrainNotes(root, 'theme/autowin-os')).toHaveLength(2)
    expect(loadVaultBrainNodesForThemes(root, ['theme/autowin-os'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'knowledge/domain/autowin', label: 'Autowin OS' }),
        expect.objectContaining({ id: 'knowledge/domain/other', label: 'Other' })
      ])
    )
  })

  it('loads only an out-of-LOD note and its direct neighbourhood', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-neighbourhood-'))
    mkdirSync(join(root, 'knowledge'), { recursive: true })
    writeFileSync(join(root, 'hub.md'), '# Hub\n[[knowledge/left]]\n[[knowledge/right]]\n', 'utf8')
    writeFileSync(join(root, 'knowledge/left.md'), '# Left\n', 'utf8')
    writeFileSync(join(root, 'knowledge/right.md'), '# Right\n', 'utf8')
    writeFileSync(join(root, 'unrelated.md'), '# Unrelated\n', 'utf8')

    const delta = loadVaultBrainNeighborhood(root, 'hub')

    expect(delta.nodes.map((node) => node.id).sort()).toEqual([
      'hub',
      'knowledge/left',
      'knowledge/right'
    ])
    expect(delta.links).toHaveLength(2)
    expect(delta.nodes.some((node) => node.id === 'unrelated')).toBe(false)
  })

  it('returns a bounded preview before the full vault graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-preview-'))
    writeFileSync(join(root, 'a.md'), '# A\n', 'utf8')
    writeFileSync(join(root, 'b.md'), '# B\n', 'utf8')
    writeFileSync(join(root, 'c.md'), '# C\n', 'utf8')

    const preview = await loadVaultBrainGraphPreviewAsync(root, 1)

    expect(preview.nodes).toHaveLength(1)
    expect(preview.totalNodes).toBe(3)
  })

  it('does not expose an arbitrary directory through the renderer loader', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-forbidden-vault-'))
    writeFileSync(join(root, 'secret.md'), '# Secret\n', 'utf8')
    expect(() => loadBrainGraph(root)).toThrow('brain vault hors périmètre autorisé')
  })

  it('rejects a file in a sibling whose name only shares an allowed-root prefix', () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-os-home-'))
    const sibling = join(home, '.graphify-evil')
    mkdirSync(sibling)
    const file = join(sibling, 'secret.md')
    writeFileSync(file, '# Secret\n', 'utf8')
    const previousHome = process.env.USERPROFILE
    process.env.USERPROFILE = home
    try {
      expect(() => readNodeFile(file)).toThrow('fichier hors périmètre autorisé')
    } finally {
      process.env.USERPROFILE = previousHome
    }
  })

  it('reads an Autowin workflow RUN.md without opening an AppData sibling', () => {
    const appData = mkdtempSync(join(tmpdir(), 'autowin-os-appdata-'))
    const runRoot = join(appData, 'autowin-os', 'runs')
    const runFile = join(runRoot, 'conv-1', 'subject-workspace', 'RUN.md')
    const sibling = join(appData, 'autowin-os-private', 'secret.md')
    mkdirSync(dirname(runFile), { recursive: true })
    mkdirSync(dirname(sibling), { recursive: true })
    writeFileSync(runFile, '# Workflow\n', 'utf8')
    writeFileSync(sibling, '# Secret\n', 'utf8')
    const previousAppData = process.env.APPDATA
    process.env.APPDATA = appData
    try {
      expect(readNodeFile(runFile).content).toBe('# Workflow\n')
      expect(() => readNodeFile(sibling)).toThrow('fichier hors périmètre autorisé')
    } finally {
      process.env.APPDATA = previousAppData
    }
  })
})
