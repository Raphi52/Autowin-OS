import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectDir, readProjectFile, writeProjectFile } from './project-files'

let root = ''
let dehors = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'proj-'))
  dehors = await mkdtemp(join(tmpdir(), 'hors-'))
  await fs.mkdir(join(root, 'src'))
  await fs.mkdir(join(root, 'node_modules'))
  await fs.writeFile(join(root, 'src', 'a.ts'), 'const a = 1\n', 'utf8')
  await fs.writeFile(join(root, 'lisez.md'), '# hello\n', 'utf8')
  await fs.writeFile(join(dehors, 'secret.txt'), 'TOP', 'utf8')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dehors, { recursive: true, force: true })
})

describe('project-files', () => {
  it('liste un dossier, dossiers en tête, sans node_modules', async () => {
    const r = await listProjectDir(root, '')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entries.map((e) => e.name)).toEqual(['src', 'lisez.md'])
  })

  it('lit un fichier sous la racine', async () => {
    const r = await readProjectFile(root, 'src/a.ts')
    expect(r).toMatchObject({ ok: true, content: 'const a = 1\n' })
  })

  it('écrit un fichier EXISTANT sous la racine', async () => {
    const w = await writeProjectFile(root, 'src/a.ts', 'const a = 2\n')
    expect(w.ok).toBe(true)
    expect(await fs.readFile(join(root, 'src', 'a.ts'), 'utf8')).toBe('const a = 2\n')
  })

  it('refuse de CRÉER un fichier', async () => {
    const w = await writeProjectFile(root, 'src/neuf.ts', 'x')
    expect(w).toEqual({ ok: false, reason: 'fichier-inexistant' })
    await expect(fs.stat(join(root, 'src', 'neuf.ts'))).rejects.toBeTruthy()
  })

  it('refuse tout chemin qui SORT de la racine', async () => {
    for (const p of ['../secret.txt', 'src/../../secret.txt', join(dehors, 'secret.txt')]) {
      expect(await readProjectFile(root, p)).toEqual({ ok: false, reason: 'hors-racine' })
      expect(await writeProjectFile(root, p, 'pwn')).toEqual({ ok: false, reason: 'hors-racine' })
      expect(await listProjectDir(root, p)).toEqual({ ok: false, reason: 'hors-racine' })
    }
    expect(await fs.readFile(join(dehors, 'secret.txt'), 'utf8')).toBe('TOP')
  })
})
