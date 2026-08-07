import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GARDE DE CÂBLAGE — « exposé » n'est pas « branché ».
 *
 * Un canal déclaré côté preload mais sans handler côté main échoue seulement à l'exécution, dans la
 * vue, chez l'utilisateur. Un handler sans déclaration preload est du code mort. Ce test vérifie la
 * chaîne ENTIÈRE sur les sources, parce que le typecheck ne la voit pas : les deux extrémités
 * communiquent par une CHAÎNE de caractères, que rien ne rapproche à la compilation.
 */
const CHANNEL = 'os:repoInventory'
const root = join(process.cwd(), 'src')
const source = (relative: string): string => readFileSync(join(root, relative), 'utf8')

describe('canal os:repoInventory — câblé de bout en bout', () => {
  it('le main enregistre le handler et le protège', () => {
    const main = source('main/index.ts')
    expect(main).toContain(`ipcMain.handle('${CHANNEL}'`)
    // Même garde que les autres canaux : un émetteur non fiable ne doit pas lire le disque.
    const bloc = main.slice(main.indexOf(`ipcMain.handle('${CHANNEL}'`))
    expect(bloc.slice(0, 320)).toContain('assertTrustedRendererSender')
    expect(bloc.slice(0, 320)).toContain('readRepoInventory()')
  })

  it('le preload l’expose, et le déclare dans son typage', () => {
    expect(source('preload/index.ts')).toContain(`ipcRenderer.invoke('${CHANNEL}')`)
    expect(source('preload/index.ts')).toContain('repoInventory:')
    expect(source('preload/index.d.ts')).toContain('repoInventory: () => Promise<')
  })

  it('les deux extrémités emploient la MÊME chaîne de canal', () => {
    // Le défaut que ce test attrape : une faute de frappe d'un seul côté, invisible au typecheck.
    const cotes = [source('main/index.ts'), source('preload/index.ts')]
    for (const cote of cotes) expect(cote.includes(`'${CHANNEL}'`)).toBe(true)
  })
})
