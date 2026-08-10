import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHeadShaResolver } from './brain-source-sha'

let workspace = ''

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sha-resolver-'))
  mkdirSync(join(workspace, 'src', 'main'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'main', 'index.ts'), 'export {}\n', 'utf8')
})
afterEach(() => rmSync(workspace, { recursive: true, force: true }))

describe('createHeadShaResolver — comparer le sha cité au sha courant du fichier', () => {
  it('résout le sha du workspace qui contient réellement le fichier', () => {
    const exec = vi.fn(() => 'abcdef1234567890')
    const resolve = createHeadShaResolver(['C:/absent', workspace], exec)
    expect(resolve('src/main/index.ts')).toBe('abcdef1234567890')
    // Le workspace inexistant n'est jamais interrogé : un seul appel git.
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith(workspace, 'src/main/index.ts')
  })

  it('mémoïse : deux fiches citant le même fichier ne lancent qu’un seul git', () => {
    const exec = vi.fn(() => 'aaa111')
    const resolve = createHeadShaResolver([workspace], exec)
    resolve('src/main/index.ts')
    resolve('src/main/index.ts')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('un fichier absent de tous les workspaces ne lance aucun git et reste inconnu', () => {
    const exec = vi.fn(() => 'aaa111')
    expect(createHeadShaResolver([workspace], exec)('src/fantome.ts')).toBeUndefined()
    expect(exec).not.toHaveBeenCalled()
  })

  it('refuse un chemin absolu ou remontant sans exécuter git', () => {
    const exec = vi.fn(() => 'aaa111')
    const resolve = createHeadShaResolver([workspace], exec)
    for (const path of ['', '/etc/passwd', 'C:/Windows/win.ini', '../../secret']) {
      expect(resolve(path)).toBeUndefined()
    }
    expect(exec).not.toHaveBeenCalled()
  })

  it('un git en échec rend « inconnu », jamais un sha inventé', () => {
    const resolve = createHeadShaResolver([workspace], () => undefined)
    expect(resolve('src/main/index.ts')).toBeUndefined()
  })
})
