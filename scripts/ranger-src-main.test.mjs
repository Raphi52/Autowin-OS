import { describe, expect, it } from 'vitest'
import {
  PLAN,
  familleVersDossier,
  preparerChemins,
  reecrireChemins,
  reecrireCheminsDeTest,
  reecrireImports
} from './ranger-src-main.mjs'

// Le rangement de src/main : les réécritures sont pures, on les prouve sur du texte.
const deplacements = new Map([
  ['src/main/chat-mcp.ts', 'src/main/chat/chat-mcp.ts'],
  ['src/main/chat-mcp.test.ts', 'src/main/chat/chat-mcp.test.ts'],
  ['src/main/os.ts', 'src/main/app/os.ts'],
  ['src/main/commands.ts', 'src/main/commands/commands.ts']
])
const index = {
  complet: new Map(deplacements),
  parBase: new Map([...deplacements].map(([a, n]) => [a.replace(/\.ts$/, ''), n.replace(/\.ts$/, '')]))
}

describe('ranger-src-main', () => {
  it('le plan ne range aucune famille deux fois', () => {
    expect(() => familleVersDossier(PLAN)).not.toThrow()
  })

  it('réécrit les imports depuis un fichier déplacé, vers un fichier déplacé ou resté', () => {
    const texte = [
      "import { a } from './os'",
      "import type { B } from '../shared/types'",
      "vi.mock('./commands', () => ({}))",
      "const m = await import('./index')"
    ].join('\n')
    const r = reecrireImports(texte, 'src/main/chat-mcp.test.ts', 'src/main/chat/chat-mcp.test.ts', index)
    expect(r.texte).toBe(
      [
        "import { a } from '../app/os'",
        "import type { B } from '../../shared/types'",
        "vi.mock('../commands/commands', () => ({}))",
        "const m = await import('../index')"
      ].join('\n')
    )
  })

  it("garde l'extension écrite et ne touche pas un fichier resté qui importe un resté", () => {
    const r = reecrireImports("from './os.js'\nfrom './providers/claude'", 'src/main/index.ts', 'src/main/index.ts', index)
    expect(r.texte).toBe("from './app/os.js'\nfrom './providers/claude'")
  })

  it('réécrit les chemins texte, jamais un dossier homonyme', () => {
    const prep = preparerChemins(deplacements)
    const texte = [
      'src/main/chat-mcp.ts',
      'src\\main\\os.ts',
      "join(racine, 'src', 'main', 'os.ts')",
      'src/main/commands/catalogue.ts',
      "'src/main/chat-mcp*.test.ts'"
    ].join('\n')
    expect(reecrireChemins(texte, prep).texte).toBe(
      [
        'src/main/chat/chat-mcp.ts',
        'src\\main\\app\\os.ts',
        "join(racine, 'src', 'main', 'app', 'os.ts')",
        'src/main/commands/catalogue.ts',
        "'src/main/chat/chat-mcp*.test.ts'"
      ].join('\n')
    )
  })

  it("ne réécrit pas un import CITÉ dans une chaîne (attente d'un test, fichier d'essai)", () => {
    const texte = `expect(src).toContain("import { a } from './os'")\nimport { b } from './os'`
    const r = reecrireImports(texte, 'src/main/chat-mcp.test.ts', 'src/main/chat/chat-mcp.test.ts', index)
    expect(r.texte).toBe(`expect(src).toContain("import { a } from './os'")\nimport { b } from '../app/os'`)
  })

  it("suit un chemin écrit dans une expression régulière", () => {
    const prep = preparerChemins(deplacements)
    expect(reecrireChemins(String.raw`/^git:src\/main\/commands\.ts@/`, prep).texte).toBe(
      String.raw`/^git:src\/main\/commands\/commands\.ts@/`
    )
  })

  it('garde le dossier de départ de join(__dirname, "..", f) et suit les noms lus par lui', () => {
    const existe = (p) => ['src/main/os.ts', 'src/main/index.ts', 'src/main/ipc/terminal.ts'].includes(p)
    const texte = [
      "const lire = (f) => readFileSync(join(__dirname, '..', f), 'utf8')",
      "lire('main/os.ts')",
      "const ICI = dirname(fileURLToPath(import.meta.url))",
      "const RACINE = resolve(ICI, '../..')",
      "readFileSync(join(RACINE, 'src', 'main', 'os.ts'))"
    ].join('\n')
    const r = reecrireCheminsDeTest(texte, 'src/main/chat-mcp.test.ts', 'src/main/chat/chat-mcp.test.ts', index, existe)
    expect(r.texte).toBe(
      [
        "const lire = (f) => readFileSync(join(__dirname, '../..', f), 'utf8')",
        "lire('main/app/os.ts')",
        "const ICI = dirname(fileURLToPath(import.meta.url))",
        "const RACINE = resolve(ICI, '../../..')",
        "readFileSync(join(RACINE, 'src/main/app/os.ts'))"
      ].join('\n')
    )
  })

  it('suit les join(__dirname, …) littéraux et les listes lues par join(__dirname, f)', () => {
    const existe = (p) => ['src/main/os.ts', 'src/main/chat-mcp.ts', 'src/main/index.ts'].includes(p)
    const texte = [
      "readFileSync(join(__dirname, '..', '..', 'skills'))",
      "readFileSync(join(__dirname, 'os.ts'))",
      "for (const f of ['os.ts', 'index.ts']) readFileSync(join(__dirname, f))"
    ].join('\n')
    const r = reecrireCheminsDeTest(texte, 'src/main/chat-mcp.test.ts', 'src/main/chat/chat-mcp.test.ts', index, existe)
    expect(r.texte).toBe(
      [
        "readFileSync(join(__dirname, '../../../skills'))",
        "readFileSync(join(__dirname, '../app/os.ts'))",
        "for (const f of ['app/os.ts', 'index.ts']) readFileSync(join(__dirname, '..', f))"
      ].join('\n')
    )
  })
})
