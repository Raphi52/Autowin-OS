import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AMITEL_BRAIN_THEMES,
  loadBrainGraph,
  loadVaultBrainGraph,
  readNodeFile,
  scanBrainGraphs
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
})
