import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AMITEL_BRAIN_THEMES,
  applyBrainRetrievalScores,
  applyBrainRetrievalScoresAsync,
  invalidateBrainCaches,
  loadBrainGraph,
  loadVaultBrainGraph,
  loadVaultBrainNodesForThemes,
  loadVaultBrainGraphPreviewAsync,
  loadVaultBrainNeighborhood,
  readNodeFile,
  scanBrainGraphs,
  searchVaultBrainNotes,
  searchVaultBrainNotesAsync
} from './fs-brains'

describe('Amitel Brain graph', () => {
  it('fusionne les quatre canaux signes du retriever avec les fiches locales', () => {
    const local = [
      {
        id: 'knowledge/decision',
        label: 'Decision',
        file: 'C:\\brain\\knowledge\\decision.md',
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(local, {
      query: 'decision',
      minDense: 0.2,
      root: '\\\\ged2\\rig\\Projets IA\\Amitel Brain',
      candidates: [
        {
          rank: 1,
          path: '//ged2/rig/Projets IA/Amitel Brain/knowledge/decision.md',
          type: 'decision',
          denseCos: 0.81,
          denseScore: 0.72,
          lexicalScore: 0.64,
          graphScore: 0.31,
          fusedScore: 0.93,
          retained: true,
          relations: [{ type: 'supersedes', target: 'knowledge/old.md' }]
        }
      ]
    })

    expect(result).toMatchObject({
      denseScore: 0.72,
      lexicalScore: 0.64,
      graphScore: 0.31,
      fusedScore: 0.93,
      relations: [{ type: 'supersedes', target: 'knowledge/old.md' }]
    })
  })

  it("ignore une navigation provenant d'un autre vault, même pour une note homonyme", () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: 'C:\\vault-a\\knowledge\\shared.md',
        themes: [],
        score: 12,
        relations: [{ type: 'related' as const, target: 'knowledge/local.md' }]
      }
    ]

    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: 'C:\\vault-b',
        candidates: [
          {
            rank: 1,
            path: 'C:\\vault-b\\knowledge\\shared.md',
            type: 'domain',
            denseCos: 0.99,
            denseScore: 0.98,
            fusedScore: 0.97,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      'C:\\vault-a'
    )

    expect(result).toEqual(local[0])
  })

  it('reconnaît les représentations Windows équivalentes de la même racine', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: 'C:\\Amitel\\Brain\\knowledge\\shared.md',
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: 'c:/amitel/brain/',
        candidates: [
          {
            rank: 1,
            path: 'c:/amitel/brain/knowledge/shared.md',
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      'C:\\AMITEL\\BRAIN'
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it("reconnaît les représentations équivalentes de la racine d'un lecteur Windows", () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: 'C:\\knowledge\\shared.md',
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: 'c:/',
        candidates: [
          {
            rank: 1,
            path: 'c:/knowledge/shared.md',
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      'C:\\'
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('reconnaît les noms DOS 8.3 et long du même vault réellement résolus par Node', () => {
    const shortRoot = mkdtempSync(join(tmpdir(), 'autowin-8dot3-proof-'))
    const longRoot = realpathSync.native(shortRoot)
    // Un volume sans alias 8.3 n'offre pas ce contre-exemple ; les autres assertions restent utiles.
    if (shortRoot.toLowerCase() === longRoot.toLowerCase()) return
    mkdirSync(join(shortRoot, 'knowledge'))
    writeFileSync(join(shortRoot, 'knowledge', 'shared.md'), '# Shared', 'utf8')

    const cases = [
      { root: longRoot, candidate: join(shortRoot, 'knowledge', 'shared.md') },
      { root: shortRoot, candidate: join(longRoot, 'knowledge', 'shared.md') },
      { root: `\\\\?\\${shortRoot}`, candidate: join(longRoot, 'knowledge', 'shared.md') },
      { root: `\\\\.\\${shortRoot}`, candidate: join(longRoot, 'knowledge', 'shared.md') }
    ]
    for (const { root, candidate } of cases) {
      const [result] = applyBrainRetrievalScores(
        [
          {
            id: 'knowledge/shared',
            label: 'Shared',
            file: join(longRoot, 'knowledge', 'shared.md'),
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'shared',
          minDense: 0.2,
          root,
          candidates: [
            {
              rank: 1,
              path: candidate,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.88,
              retained: true
            }
          ]
        },
        longRoot
      )

      expect(realpathSync.native(root)).toBe(realpathSync.native(longRoot))
      expect(realpathSync.native(candidate)).toBe(
        realpathSync.native(join(longRoot, 'knowledge', 'shared.md'))
      )
      expect(result.fusedScore).toBe(0.88)
    }

    const foreignRoot = mkdtempSync(join(tmpdir(), 'autowin-8dot3-foreign-'))
    mkdirSync(join(foreignRoot, 'knowledge'))
    writeFileSync(join(foreignRoot, 'knowledge', 'shared.md'), '# Foreign', 'utf8')
    const [foreign] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: join(longRoot, 'knowledge', 'shared.md'),
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: longRoot,
        candidates: [
          {
            rank: 1,
            path: join(foreignRoot, 'knowledge', 'shared.md'),
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'foreign' }]
          }
        ]
      },
      shortRoot
    )
    expect(foreign.fusedScore).toBeUndefined()
    expect(foreign.relations).toEqual([])

    writeFileSync(join(shortRoot, '..note.md'), '# Dot note', 'utf8')
    const [dotNote] = applyBrainRetrievalScores(
      [
        {
          id: '..note',
          label: 'Dot note',
          file: join(longRoot, '..note.md'),
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'dot note',
        minDense: 0.2,
        root: longRoot,
        candidates: [
          {
            rank: 1,
            path: join(shortRoot, '..note.md'),
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      shortRoot
    )
    expect(win32.relative(longRoot, realpathSync.native(join(shortRoot, '..note.md')))).toBe(
      '..note.md'
    )
    expect(dotNote.fusedScore).toBe(0.88)

    mkdirSync(join(shortRoot, 'node_modules', 'npm'), { recursive: true })
    writeFileSync(join(shortRoot, 'node_modules', 'npm', 'README.md'), '# npm', 'utf8')
    const relativeDosCandidate = String.raw`NODE_M~1\npm\README.md`
    if (existsSync(join(shortRoot, relativeDosCandidate))) {
      const [relativeDos] = applyBrainRetrievalScores(
        [
          {
            id: 'node_modules/npm/README',
            label: 'npm',
            file: join(longRoot, 'node_modules', 'npm', 'README.md'),
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'npm',
          minDense: 0.2,
          root: longRoot,
          candidates: [
            {
              rank: 1,
              path: relativeDosCandidate,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.92,
              retained: true,
              relations: [{ type: 'related', target: 'relative-dos-alias' }]
            }
          ]
        },
        shortRoot
      )
      expect(realpathSync.native(win32.resolve(longRoot, relativeDosCandidate))).toBe(
        realpathSync.native(join(longRoot, 'node_modules', 'npm', 'README.md'))
      )
      expect(relativeDos.fusedScore).toBe(0.92)
      expect(relativeDos.relations).toEqual([{ type: 'related', target: 'relative-dos-alias' }])
    }
  })

  it('résout un alias DOS 8.3 situé dans un segment candidat sous une racine commune', () => {
    const shortDirectory = mkdtempSync(join(tmpdir(), 'autowin-internal-8dot3-'))
    const longDirectory = realpathSync.native(shortDirectory)
    if (shortDirectory.toLowerCase() === longDirectory.toLowerCase()) return
    const root = win32.parse(shortDirectory).root
    const shortCandidate = join(shortDirectory, 'shared.md')
    const longCandidate = join(longDirectory, 'shared.md')
    writeFileSync(shortCandidate, '# Shared', 'utf8')
    const localId = win32.relative(root, longCandidate).replace(/\\/g, '/').replace(/\.md$/i, '')

    const [result] = applyBrainRetrievalScores(
      [
        {
          id: localId,
          label: 'Shared',
          file: longCandidate,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root,
        candidates: [
          {
            rank: 1,
            path: shortCandidate,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true,
            relations: [{ type: 'related', target: 'internal-dos-alias' }]
          }
        ]
      },
      root
    )

    expect(realpathSync.native(shortCandidate)).toBe(realpathSync.native(longCandidate))
    expect(result.fusedScore).toBe(0.88)
    expect(result.relations).toEqual([{ type: 'related', target: 'internal-dos-alias' }])
  })

  it("n'utilise pas le pli Unicode de path.win32.relative pour contenir un candidat réel", () => {
    const parent = mkdtempSync(join(tmpdir(), 'autowin-ordinal-containment-'))
    const localRoot = join(parent, '\u01c4')
    const foreignRoot = join(parent, '\u01c5')
    mkdirSync(localRoot)
    mkdirSync(foreignRoot)
    writeFileSync(join(localRoot, 'shared.md'), '# Local', 'utf8')
    writeFileSync(join(foreignRoot, 'shared.md'), '# Foreign', 'utf8')

    const local = [
      {
        id: 'shared',
        label: 'Shared local',
        file: join(localRoot, 'shared.md'),
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: localRoot,
        candidates: [
          {
            rank: 1,
            path: join(foreignRoot, 'shared.md'),
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'foreign' }]
          }
        ]
      },
      localRoot
    )

    expect(realpathSync.native(localRoot)).not.toBe(realpathSync.native(foreignRoot))
    expect(win32.relative(localRoot, join(foreignRoot, 'shared.md'))).toBe('shared.md')
    expect(result).toEqual(local[0])
  })

  it('rejette un candidat relatif ou absolu qui sort réellement du vault par une jonction', () => {
    const parent = mkdtempSync(join(tmpdir(), 'autowin-junction-escape-'))
    const root = join(parent, 'vault')
    const foreign = join(parent, 'foreign')
    mkdirSync(root)
    mkdirSync(foreign)
    writeFileSync(join(foreign, 'shared.md'), '# Foreign', 'utf8')
    symlinkSync(foreign, join(root, 'portal'), 'junction')
    const local = [
      {
        id: 'portal/shared',
        label: 'Shared local',
        file: join(root, 'portal', 'shared.md'),
        themes: [],
        score: 12,
        relations: []
      }
    ]

    for (const candidatePath of ['portal/shared.md', join(root, 'portal', 'shared.md')]) {
      const [result] = applyBrainRetrievalScores(
        local,
        {
          query: 'shared',
          minDense: 0.2,
          root,
          candidates: [
            {
              rank: 1,
              path: candidatePath,
              type: 'domain',
              denseCos: 0.99,
              fusedScore: 0.99,
              retained: true,
              relations: [{ type: 'contradicts', target: 'foreign' }]
            }
          ]
        },
        root
      )

      expect(realpathSync.native(join(root, 'portal', 'shared.md'))).toBe(
        realpathSync.native(join(foreign, 'shared.md'))
      )
      expect(result).toEqual(local[0])
    }
  })

  it("rejette une recherche commencee avant l'invalidation meme si son lease serait capture apres", async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-search-pre-invalidate-'))
    writeFileSync(join(root, 'decision.md'), '# OLD LABEL\nold-cache-proof', 'utf8')

    const staleSearch = searchVaultBrainNotesAsync(root, 'old-cache-proof', 40, root)
    invalidateBrainCaches()

    await expect(staleSearch).rejects.toThrow(/cache Brain invalidé pendant le chargement/)
    writeFileSync(join(root, 'decision.md'), '# NEW LABEL\nnew-cache-proof', 'utf8')
    expect(await searchVaultBrainNotesAsync(root, 'new-cache-proof', 40, root)).toMatchObject([
      { label: 'NEW LABEL' }
    ])
    expect(await searchVaultBrainNotesAsync(root, 'old-cache-proof', 40, root)).toEqual([])
  })

  it('résout les alias UNC sans laisser une jonction sortir du vault', async () => {
    const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'autowin-unc-boundary-')))
    const root = join(parent, 'vault')
    const foreign = join(parent, 'foreign')
    mkdirSync(root)
    mkdirSync(foreign)
    writeFileSync(join(root, 'same.md'), '# Same\nalias-search-proof', 'utf8')
    writeFileSync(join(foreign, 'shared.md'), '# Foreign', 'utf8')
    symlinkSync(foreign, join(root, 'portal'), 'junction')
    const toAdminUnc = (path: string, host: string): string => {
      const parsed = win32.parse(path)
      return `\\\\${host}\\${parsed.root[0]}$\\${path.slice(parsed.root.length)}`
    }
    const localRoot = toAdminUnc(root, 'localhost')
    const aliasRoot = toAdminUnc(root, '127.0.0.1')
    if (!existsSync(localRoot) || !existsSync(aliasRoot)) return

    expect(
      await searchVaultBrainNotesAsync(localRoot, 'alias-search-proof', 40, root)
    ).toMatchObject([{ id: 'same' }])
    invalidateBrainCaches()
    expect(
      await searchVaultBrainNotesAsync(root, 'alias-search-proof', 40, localRoot)
    ).toMatchObject([{ id: 'same' }])

    const escapedLocal = [
      {
        id: 'portal/shared',
        label: 'Shared local',
        file: join(root, 'portal', 'shared.md'),
        themes: [],
        score: 12,
        relations: []
      }
    ]
    for (const candidatePath of [
      'portal/shared.md',
      win32.join(localRoot, 'portal', 'shared.md')
    ]) {
      const [result] = await applyBrainRetrievalScoresAsync(
        escapedLocal,
        {
          query: 'shared',
          minDense: 0.2,
          root: localRoot,
          candidates: [
            {
              rank: 1,
              path: candidatePath,
              type: 'domain',
              denseCos: 0.99,
              fusedScore: 0.99,
              retained: true,
              relations: [{ type: 'contradicts', target: 'foreign-unc' }]
            }
          ]
        },
        localRoot
      )
      expect(result).toEqual(escapedLocal[0])
    }

    for (const candidatePath of ['same.md', win32.join(aliasRoot, 'same.md')]) {
      const [result] = await applyBrainRetrievalScoresAsync(
        [
          {
            id: 'same',
            label: 'Same',
            file: join(root, 'same.md'),
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'same',
          minDense: 0.2,
          root: localRoot,
          candidates: [
            {
              rank: 1,
              path: candidatePath,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.88,
              retained: true,
              relations: [{ type: 'related', target: 'unc-alias' }]
            }
          ]
        },
        aliasRoot
      )
      expect(result.fusedScore).toBe(0.88)
      expect(result.relations).toEqual([{ type: 'related', target: 'unc-alias' }])
    }
  })

  it("reconnaît l'alias local Volume GUID réellement résolu par Node", () => {
    const driveDirectory = realpathSync.native(mkdtempSync(join(tmpdir(), 'autowin-volume-guid-')))
    const driveRoot = win32.parse(driveDirectory).root
    let volumeRoot: string
    try {
      volumeRoot = execFileSync('mountvol', [driveRoot, '/L'], { encoding: 'utf8' }).trim()
    } catch {
      return
    }
    if (!/^\\\\\?\\Volume\{[0-9a-f-]+\}\\$/i.test(volumeRoot)) return
    const volumeDirectory = win32.join(volumeRoot, win32.relative(driveRoot, driveDirectory))
    const dotVolumeDirectory = volumeDirectory.replace('\\\\?\\', '\\\\.\\')
    const driveCandidate = join(driveDirectory, 'shared.md')
    const volumeCandidate = win32.join(volumeDirectory, 'shared.md')
    const dotVolumeCandidate = win32.join(dotVolumeDirectory, 'shared.md')
    writeFileSync(driveCandidate, '# Shared', 'utf8')
    expect(realpathSync.native(volumeDirectory)).toBe(realpathSync.native(driveDirectory))
    expect(realpathSync.native(dotVolumeDirectory)).toBe(realpathSync.native(driveDirectory))
    expect(realpathSync.native(volumeCandidate)).toBe(realpathSync.native(driveCandidate))
    expect(realpathSync.native(dotVolumeCandidate)).toBe(realpathSync.native(driveCandidate))

    const cases = [
      { navigationRoot: volumeDirectory, expectedRoot: driveDirectory, path: 'shared.md' },
      { navigationRoot: driveDirectory, expectedRoot: volumeDirectory, path: driveCandidate },
      { navigationRoot: volumeDirectory, expectedRoot: driveDirectory, path: volumeCandidate },
      { navigationRoot: dotVolumeDirectory, expectedRoot: driveDirectory, path: 'shared.md' },
      { navigationRoot: driveDirectory, expectedRoot: dotVolumeDirectory, path: driveCandidate },
      { navigationRoot: dotVolumeDirectory, expectedRoot: driveDirectory, path: dotVolumeCandidate }
    ]
    for (const testCase of cases) {
      const [result] = applyBrainRetrievalScores(
        [
          {
            id: 'shared',
            label: 'Shared',
            file: driveCandidate,
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'shared',
          minDense: 0.2,
          root: testCase.navigationRoot,
          candidates: [
            {
              rank: 1,
              path: testCase.path,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.95,
              retained: true,
              relations: [{ type: 'related', target: 'volume-alias' }]
            }
          ]
        },
        testCase.expectedRoot
      )

      expect(result.fusedScore).toBe(0.95)
      expect(result.relations).toEqual([{ type: 'related', target: 'volume-alias' }])
    }

    const driveRelativeId = win32
      .relative(driveRoot, driveCandidate)
      .replace(/\\/g, '/')
      .replace(/\.md$/i, '')
    const volumeRelativeCandidate = `${driveRelativeId}.md`
    const exactVolumeLocal = [
      {
        id: driveRelativeId,
        label: 'Shared from volume root',
        file: driveCandidate,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const exactVolumeNavigation = {
      query: 'shared',
      minDense: 0.2,
      root: volumeRoot,
      candidates: [
        {
          rank: 1,
          path: volumeRelativeCandidate,
          type: 'domain',
          denseCos: 0.9,
          fusedScore: 0.96,
          retained: true
        }
      ]
    }
    expect(
      applyBrainRetrievalScores(exactVolumeLocal, exactVolumeNavigation, volumeRoot)[0].fusedScore
    ).toBe(0.96)

    const dotVolumeRoot = volumeRoot.replace('\\\\?\\', '\\\\.\\')
    for (const invalidRoot of [
      volumeRoot.slice(0, -1),
      `${volumeRoot}.`,
      `${volumeRoot}Windows\\..`,
      dotVolumeRoot.slice(0, -1),
      `${dotVolumeRoot}.`,
      `${dotVolumeRoot}Windows\\..`
    ]) {
      const [invalid] = applyBrainRetrievalScores(
        exactVolumeLocal,
        { ...exactVolumeNavigation, root: invalidRoot },
        volumeRoot
      )
      expect(invalid.fusedScore).toBeUndefined()
    }

    for (const invalidRoot of [
      String.raw`\\?\Volume{00000000-0000-0000-0000-000000000000}\missing`,
      String.raw`\\.\Volume{00000000-0000-0000-0000-000000000000}\missing`
    ]) {
      const [invalid] = applyBrainRetrievalScores(
        [
          {
            id: 'shared',
            label: 'Shared',
            file: driveCandidate,
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'shared',
          minDense: 0.2,
          root: invalidRoot,
          candidates: [
            {
              rank: 1,
              path: 'shared.md',
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.99,
              retained: true
            }
          ]
        },
        driveDirectory
      )
      expect(invalid.fusedScore).toBeUndefined()
    }
  })

  it('rejette les racines device terminales que le worker Node ne peut pas parcourir', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared',
        file: String.raw`C:\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const roots = [
      String.raw`\\?\C:`,
      String.raw`\\?\C:\.`,
      String.raw`\\?\C:\Windows\..`,
      String.raw`\\.\C:`,
      String.raw`\\.\C:\.`,
      String.raw`\\.\C:\Windows\..`
    ]

    for (const root of roots) {
      expect(() => realpathSync.native(root)).toThrow()
      const [result] = applyBrainRetrievalScores(
        local,
        {
          query: 'shared',
          minDense: 0.2,
          root,
          candidates: [
            {
              rank: 1,
              path: `${root}\\knowledge\\shared.md`,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.99,
              retained: true,
              relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
            }
          ]
        },
        'C:\\'
      )
      expect(result).toEqual(local[0])
    }
  })

  it('reconnaît un chemin Windows étendu comme sa forme canonique', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`C:\Vault\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\?\C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: String.raw`\\?\C:\Vault\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('reconnaît un chemin UNC étendu comme sa forme canonique', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`\\server\share\brain\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\?\UNC\server\share\brain`,
        candidates: [
          {
            rank: 1,
            path: String.raw`\\?\UNC\server\share\brain\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`\\server\share\brain`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('reconnaît les alias réellement résolus par le runtime Node Windows', () => {
    for (const navigationRoot of [
      String.raw`\\.\C:\Vault`,
      String.raw`\\?\C:/Vault`,
      String.raw`\\?\C:\Vault\.`,
      String.raw`\\?\C:\Vault\folder\..`
    ]) {
      const [result] = applyBrainRetrievalScores(
        [
          {
            id: 'knowledge/shared',
            label: 'Shared',
            file: String.raw`C:\Vault\knowledge\shared.md`,
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'shared',
          minDense: 0.2,
          root: navigationRoot,
          candidates: [
            {
              rank: 1,
              path: `${navigationRoot}\\knowledge\\shared.md`,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.88,
              retained: true
            }
          ]
        },
        String.raw`C:\Vault`
      )

      expect(result.fusedScore).toBe(0.88)
    }
  })

  it("reconnaît l'alias UNC device réellement résolu par le runtime Node Windows", () => {
    const navigationRoot = String.raw`\\.\UNC\server\share\brain`
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`\\server\share\brain\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: navigationRoot,
        candidates: [
          {
            rank: 1,
            path: `${navigationRoot}\\knowledge\\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`\\server\share\brain`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('ne confond pas les suffixes que le runtime Node traite comme des chemins distincts', () => {
    for (const navigationRoot of [
      String.raw`C:\Vault `,
      String.raw`C:\Vault.`,
      String.raw`C:\Vault\...`,
      String.raw`C:\Vault\   `
    ]) {
      const local = [
        {
          id: 'knowledge/shared',
          label: 'Shared local',
          file: String.raw`C:\Vault\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ]
      const [result] = applyBrainRetrievalScores(
        local,
        {
          query: 'shared',
          minDense: 0.2,
          root: navigationRoot,
          candidates: [
            {
              rank: 1,
              path: 'knowledge/shared.md',
              type: 'domain',
              denseCos: 0.99,
              fusedScore: 0.99,
              retained: true,
              relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
            }
          ]
        },
        String.raw`C:\Vault`
      )

      expect(result).toEqual(local[0])
    }
  })

  it("préserve l'espace final significatif d'un chemin Windows étendu", () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`C:\Vault\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\?\C:\Vault `,
        candidates: [
          {
            rank: 1,
            path: String.raw`\\?\C:\Vault \knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(result).toEqual(local[0])
  })

  it("préserve l'espace final significatif d'un chemin UNC étendu", () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`\\server\share\Vault\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\?\UNC\server\share\Vault `,
        candidates: [
          {
            rank: 1,
            path: String.raw`\\?\UNC\server\share\Vault \knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`\\server\share\Vault`
    )

    expect(result).toEqual(local[0])
  })

  it('ne replie pas deux racines Windows Unicode distinctes sur la même identité', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`C:\Vault\İ\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault\i̇`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\i̇\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`C:\Vault\İ`
    )

    expect(result).toEqual(local[0])
  })

  it('préserve une racine Windows titlecase distincte de sa forme uppercase', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`C:\Vault\Ǆ\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault\ǅ`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\ǅ\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`C:\Vault\Ǆ`
    )

    expect(result).toEqual(local[0])
  })

  it('reste fail-closed hors des paires de casse ordinales vérifiées', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`C:\Vault\Ꭳ\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault\ꭳ`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\ꭳ\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`C:\Vault\Ꭳ`
    )

    expect(result).toEqual(local[0])
  })

  it('reconnaît une paire de casse Unicode simple et non expansive sous Windows', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`C:\Vault\É\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`c:\vault\é`,
        candidates: [
          {
            rank: 1,
            path: String.raw`c:\vault\é\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`C:\Vault\É`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('reconnaît les formes uppercase et lowercase ordinales sans la titlecase', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`C:\Vault\Ǆ\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault\ǆ`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\ǆ\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`C:\Vault\Ǆ`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('reconnaît les paires ordinales Windows grecques et cyrilliques', () => {
    for (const [expectedRoot, navigationRoot] of [
      [String.raw`C:\Vault\Α`, String.raw`c:\vault\α`],
      [String.raw`C:\Vault\Б`, String.raw`c:\vault\б`]
    ]) {
      const [result] = applyBrainRetrievalScores(
        [
          {
            id: 'knowledge/shared',
            label: 'Shared',
            file: `${expectedRoot}\\knowledge\\shared.md`,
            themes: [],
            score: 12,
            relations: []
          }
        ],
        {
          query: 'shared',
          minDense: 0.2,
          root: navigationRoot,
          candidates: [
            {
              rank: 1,
              path: `${navigationRoot}\\knowledge\\shared.md`,
              type: 'domain',
              denseCos: 0.9,
              fusedScore: 0.88,
              retained: true
            }
          ]
        },
        expectedRoot
      )

      expect(result.fusedScore).toBe(0.88)
    }
  })

  it('conserve la compatibilité de casse Unicode des appels historiques à deux arguments', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/α',
          label: 'Alpha',
          file: String.raw`C:\Vault\knowledge\α.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'alpha',
        minDense: 0.2,
        root: String.raw`C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\knowledge\Α.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      }
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('ne replie pas deux identifiants de note Unicode distincts sur la même identité', () => {
    const local = [
      {
        id: 'knowledge/K',
        label: 'K local',
        file: String.raw`C:\Vault\knowledge\K.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'K',
        minDense: 0.2,
        root: String.raw`C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\knowledge\K.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(result).toEqual(local[0])
  })

  it("ne retire pas une seconde extension à l'identifiant logique d'une note", () => {
    const results = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/foo',
          label: 'Foo',
          file: String.raw`C:\Vault\knowledge\foo.md`,
          themes: [],
          score: 12,
          relations: []
        },
        {
          id: 'knowledge/foo.md',
          label: 'Foo point md',
          file: String.raw`C:\Vault\knowledge\foo.md.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'foo',
        minDense: 0.2,
        root: String.raw`C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: 'knowledge/foo.md',
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.11,
            retained: true,
            relations: [{ type: 'related', target: 'knowledge/from-foo' }]
          },
          {
            rank: 2,
            path: 'knowledge/foo.md.md',
            type: 'domain',
            denseCos: 0.8,
            fusedScore: 0.22,
            retained: true,
            relations: [{ type: 'related', target: 'knowledge/from-foo-md' }]
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(results.map(({ fusedScore }) => fusedScore)).toEqual([0.11, 0.22])
    expect(results[1].relations).toEqual([{ type: 'related', target: 'knowledge/from-foo-md' }])
  })

  it('normalise lexicalement les segments point dans une racine Windows', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`C:\Vault\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault\.`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\.\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`c:\vault`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('normalise lexicalement les segments parent dans une racine UNC', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`\\server\share\brain\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\server\share\brain\folder\..`,
        candidates: [
          {
            rank: 1,
            path: String.raw`\\server\share\brain\folder\..\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`\\SERVER\SHARE\brain`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('normalise lexicalement les segments parent du chemin candidat', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`C:\Vault\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\folder\..\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('relie une racine Windows étendue à un candidat canonique équivalent', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: String.raw`C:\Vault\knowledge\shared.md`,
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\?\C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it("n'associe pas un candidat qui sort lexicalement de la racine signée", () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`C:\Vault\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]
    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`C:\Vault`,
        candidates: [
          {
            rank: 1,
            path: String.raw`C:\Vault\..\Foreign\knowledge\shared.md`,
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`C:\Vault`
    )

    expect(result).toEqual(local[0])
  })

  it('reconnaît deux écritures équivalentes de la même racine UNC', () => {
    const [result] = applyBrainRetrievalScores(
      [
        {
          id: 'knowledge/shared',
          label: 'Shared',
          file: '\\\\server\\share\\brain\\knowledge\\shared.md',
          themes: [],
          score: 12,
          relations: []
        }
      ],
      {
        query: 'shared',
        minDense: 0.2,
        root: '\\\\SERVER\\Share\\Brain\\',
        candidates: [
          {
            rank: 1,
            path: '\\\\server\\share\\brain\\knowledge\\shared.md',
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      '//server/share/brain'
    )

    expect(result.fusedScore).toBe(0.88)
  })

  it('ne confond pas une racine UNC avec un chemin Windows mono-slash', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: '\\server\\share\\brain\\knowledge\\shared.md',
        themes: [],
        score: 12,
        relations: []
      }
    ]

    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: '\\\\server\\share\\brain',
        candidates: [
          {
            rank: 1,
            path: '\\\\server\\share\\brain\\knowledge\\shared.md',
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.97,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      '\\server\\share\\brain'
    )

    expect(result).toEqual(local[0])
  })

  it('ne confond pas une racine à trois slashs avec une vraie racine UNC', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared local',
        file: String.raw`\\erver\share\brain\knowledge\shared.md`,
        themes: [],
        score: 12,
        relations: []
      }
    ]

    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        root: String.raw`\\\server\share\brain`,
        candidates: [
          {
            rank: 1,
            path: 'knowledge/shared.md',
            type: 'domain',
            denseCos: 0.99,
            fusedScore: 0.99,
            retained: true,
            relations: [{ type: 'contradicts', target: 'knowledge/foreign.md' }]
          }
        ]
      },
      String.raw`\\erver\share\brain`
    )

    expect(result).toEqual(local[0])
  })

  it('ignore une navigation sans racine quand le vault attendu est connu', () => {
    const local = [
      {
        id: 'knowledge/shared',
        label: 'Shared',
        file: 'C:\\vault-a\\knowledge\\shared.md',
        themes: [],
        score: 12,
        relations: []
      }
    ]

    const [result] = applyBrainRetrievalScores(
      local,
      {
        query: 'shared',
        minDense: 0.2,
        candidates: [
          {
            rank: 1,
            path: 'knowledge/shared.md',
            type: 'domain',
            denseCos: 0.9,
            fusedScore: 0.88,
            retained: true
          }
        ]
      },
      'C:\\vault-a'
    )

    expect(result).toEqual(local[0])
  })

  it('branche la recherche Memory sur le retriever signé avant de rendre les scores', () => {
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    const coordinatorSource = readFileSync(join(__dirname, 'brain-search-coordinator.ts'), 'utf8')
    const workerSource = readFileSync(join(__dirname, 'brain-worker.ts'), 'utf8')
    expect(source).toContain('retrieve: retrieveBrainContext')
    expect(source).toContain("'fuseRetrieval'")
    expect(source).toContain('const brainSearchWorker = new BrainWorkerClient(')
    expect(source).toContain('brainSearchCoordinator.invalidate()')
    expect(source).toMatch(/brainSearchWorker\s*\.requestWithTimeout<BrainNoteSearchResult\[\]>/)
    expect(source).toContain('BRAIN_SEARCH_BOUNDARY_TIMEOUT_MS = 2_500')
    expect(coordinatorSource).toContain('.catch(() => [])')
    expect(coordinatorSource).toContain('.catch(() => local)')
    expect(coordinatorSource).toContain('!this.fence.isCurrent(epochAtStart)')
    expect(source).toContain('brainWorker.invalidate()')
    expect(source).toContain('brainSearchWorker.invalidate()')
    expect(source).not.toContain('applyBrainRetrievalScoresAsync')
    expect(workerSource).toContain("case 'fuseRetrieval':")
    expect(workerSource).toContain('await applyBrainRetrievalScoresAsync(')
    expect(workerSource).toContain('await searchVaultBrainNotesAsync(')
    expect(workerSource).toContain('new GenerationCache<')
    expect(workerSource).toContain('!responseFence.isCurrent(epochAtStart)')
    expect(workerSource).toContain('invalidateBrainCaches()')
  })

  it("refuse de rechercher les notes d'un dossier hors du vault autorisé", () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'autowin-os-vault-allowed-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'autowin-os-vault-outside-'))
    writeFileSync(join(outsideRoot, 'secret.md'), '# Secret\nultra-secret-7429', 'utf8')

    expect(() => searchVaultBrainNotes(outsideRoot, 'ultra-secret-7429', 40, allowedRoot)).toThrow(
      /hors périmètre autorisé/
    )
  })

  it('recherche le contenu et recharge une note modifiee apres invalidation', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-vault-search-'))
    const note = join(root, 'decision.md')
    writeFileSync(
      note,
      '---\nrelated: [knowledge/runtime.md]\n---\n# Decision\nLe fournisseur est local uniquement.\n',
      'utf8'
    )

    const first = searchVaultBrainNotes(root, 'fournisseur local', 40, root)
    expect(first[0]).toMatchObject({
      id: 'decision',
      score: expect.any(Number),
      relations: [{ type: 'related', target: 'knowledge/runtime.md' }]
    })

    writeFileSync(note, '# Decision\nLa source devient canonique apres promotion.\n', 'utf8')
    expect(searchVaultBrainNotes(root, 'canonique', 40, root)).toEqual([])
    invalidateBrainCaches()
    expect(searchVaultBrainNotes(root, 'canonique', 40, root)[0]?.id).toBe('decision')
  })

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

  it('projette les relations frontmatter explicites dans le graphe du vault', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-os-vault-health-'))
    mkdirSync(join(root, 'knowledge'), { recursive: true })
    writeFileSync(
      join(root, 'knowledge/current.md'),
      '---\nsupersedes: [[knowledge/old.md]]\ncontradicts: [knowledge/alternative.md]\n---\n# Current\n',
      'utf8'
    )
    writeFileSync(join(root, 'knowledge/old.md'), '# Old\n', 'utf8')
    writeFileSync(join(root, 'knowledge/alternative.md'), '# Alternative\n', 'utf8')
    writeFileSync(
      join(root, 'knowledge/prose.md'),
      '# Prose\n\ncontradicts: [knowledge/alternative.md]\n',
      'utf8'
    )

    const links = loadVaultBrainGraph(root, 20).links
    expect(links).toEqual(
      expect.arrayContaining([
        {
          source: 'knowledge/current',
          target: 'knowledge/old',
          weight: 1,
          relation: 'supersedes'
        },
        {
          source: 'knowledge/current',
          target: 'knowledge/alternative',
          weight: 1,
          relation: 'contradicts'
        }
      ])
    )
    expect(links).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'knowledge/prose',
          target: 'knowledge/alternative',
          relation: 'contradicts'
        })
      ])
    )
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
    expect(searchVaultBrainNotes(root, 'autowin', 40, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'knowledge/domain/autowin',
          label: 'Autowin OS',
          themes: expect.arrayContaining(['theme/autowin-os', 'theme/architecture'])
        })
      ])
    )
    expect(searchVaultBrainNotes(root, 'theme/autowin-os', 40, root)).toHaveLength(2)
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
