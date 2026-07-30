import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Garde sur la FRONTIERE DE SECURITE Electron.
 *
 * Ce que ce test empeche, et qui n'etait garde par rien : qu'une fenetre soit creee sans
 * `contextIsolation: true`. Le preload exposait jusqu'ici un repli qui, dans ce cas, assignait
 * `window.api` DIRECTEMENT — sans `contextBridge`, donc avec toute la surface IPC accessible a
 * n'importe quel script de la page, y compris les commandes qui ecrivent sur le disque. Ce repli echoue
 * desormais bruyamment, mais l'oubli lui-meme ne se verrait qu'au lancement de CETTE fenetre-la.
 * Ici, il se voit au test.
 *
 * Constate le 2026-07-30 : un audit signalait « 2 marqueurs @ts-ignore dans preload, la frontiere de
 * securite Electron ». Les marqueurs n'etaient que du gabarit @electron-toolkit ; le defaut reel etait
 * le repli qu'ils annotaient, et un TROISIEME site de creation de fenetre que l'audit n'avait pas vu.
 */
const mainRoot = join(process.cwd(), 'src', 'main')

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (!entry.endsWith('.ts') || entry.includes('.test.')) continue
    found.push(path)
  }
  return found
}

/** Chaque `new BrowserWindow({...})` avec son bloc d'options, pour inspection. */
function browserWindowBlocks(source: string): string[] {
  const blocks: string[] = []
  for (const match of source.matchAll(/new BrowserWindow\(/g)) {
    // Lit jusqu'a l'equilibrage des parentheses : un `slice` a longueur fixe couperait un bloc long.
    let depth = 0
    let index = match.index + match[0].length - 1
    for (; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1
      else if (source[index] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    blocks.push(source.slice(match.index, index + 1))
  }
  return blocks
}

describe('frontiere de securite Electron', () => {
  it('CHAQUE fenetre creee pose contextIsolation: true', () => {
    const offenders: string[] = []
    let inspected = 0
    for (const file of sourceFiles(mainRoot)) {
      for (const block of browserWindowBlocks(readFileSync(file, 'utf8'))) {
        inspected += 1
        if (!/contextIsolation:\s*true/.test(block)) {
          offenders.push(file.replace(process.cwd(), ''))
        }
      }
    }
    // Non-vacuite : si le compte tombe a 0, ce test passerait pour de mauvaises raisons.
    expect(inspected).toBeGreaterThanOrEqual(3)
    expect(offenders).toEqual([])
  })

  it('le preload n’expose JAMAIS l’API en assignant directement sur window', () => {
    const preload = readFileSync(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
    // Le contournement de contextBridge, sous ses deux formes.
    expect(preload).not.toMatch(/window\.api\s*=/)
    expect(preload).not.toMatch(/window\.electron\s*=/)
    // Et la voie legitime doit rester en place.
    expect(preload).toContain("contextBridge.exposeInMainWorld('api'")
  })

  it('le repli non isole echoue au lieu de degrader en silence', () => {
    const preload = readFileSync(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
    const elseBranch = preload.slice(preload.indexOf('if (process.contextIsolated)'))
    expect(elseBranch).toContain('throw new Error(')
  })
})
