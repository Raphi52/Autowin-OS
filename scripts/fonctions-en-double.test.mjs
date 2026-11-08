import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fichiersSources, fonctionsDuTexte, groupesDeCopies } from './fonctions-en-double.mjs'

/*
 * Une fonction recopiée diverge tôt ou tard : ce script doit retrouver les copies IDENTIQUES
 * (nom et corps), sans se laisser tromper par la mise en forme, et sans confondre deux fonctions
 * qui portent le même nom mais pas le même corps (ni les mêmes types).
 */
const racine = mkdtempSync(join(tmpdir(), 'fonctions-en-double-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

function fichier(chemin, texte) {
  const complet = join(racine, chemin)
  mkdirSync(join(complet, '..'), { recursive: true })
  writeFileSync(complet, texte)
  return complet
}

const A = fichier(
  'src/a.ts',
  `export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
const duree = (ms: number): string => \`\${ms} ms\`
`
)
const B = fichier(
  'src/b.ts',
  `// une copie, autrement mise en forme et commentée
function isRecord(v: unknown): v is Record<string, unknown> {
  /* même corps */ return typeof v === 'object'   &&   v !== null
}
export const duree = (ms: number): string => \`\${ms} ms\`
`
)
const C = fichier(
  'src/c.tsx',
  `function isRecord(v: any): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function duree(ms: number): string {
  return String(ms)
}
`
)
fichier('src/a.test.ts', `function isRecord(v: unknown) { return true }\n`)

describe('fonctionsDuTexte', () => {
  it('lit les déclarations et les fonctions fléchées de premier niveau, pas les imbriquées', () => {
    const noms = fonctionsDuTexte(
      `function f() { function g() {} }\nconst h = () => 1\nconst x = 3\nclass K { m() {} }\n`
    ).map((f) => f.nom)
    expect(noms).toEqual(['f', 'h'])
  })
})

describe('groupesDeCopies', () => {
  const fichiers = fichiersSources(join(racine, 'src'))

  it('ignore les tests', () => {
    expect(fichiers.some((f) => f.endsWith('a.test.ts'))).toBe(false)
  })

  it('regroupe les copies identiques malgré commentaires, blancs et `export`', () => {
    const groupes = groupesDeCopies(fichiers, { racine })
    const isRecord = groupes.find((g) => g.nom === 'isRecord')
    expect(isRecord?.copies.map((c) => c.fichier)).toEqual(['src/a.ts', 'src/b.ts'])
    const duree = groupes.find((g) => g.nom === 'duree')
    expect(duree?.copies.map((c) => c.fichier)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('ne confond pas un même nom au corps ou aux types différents', () => {
    const groupes = groupesDeCopies([A, B, C], { racine })
    expect(groupes.flatMap((g) => g.copies).some((c) => c.fichier === 'src/c.tsx')).toBe(false)
  })

  it('filtre sur un nom, et rend vide quand il ne reste aucune copie', () => {
    expect(groupesDeCopies(fichiers, { racine, nom: 'duree' }).map((g) => g.nom)).toEqual(['duree'])
    expect(groupesDeCopies([A, C], { racine, nom: 'isRecord' })).toEqual([])
  })
})

describe('le code de chaque groupe, pour décider sans rouvrir les fichiers', () => {
  it('rend le corps tel qu’écrit, sans le commentaire qui le précède', () => {
    const [fonction] = fonctionsDuTexte(`// note\nconst f = (x: number): number =>\n  x + 1\n`)
    expect(fonction.corps).toBe('const f = (x: number): number =>\n  x + 1')
    expect(fonction.exportee).toBe(false)
  })

  it('dit quelles copies sont exportées, et garde le corps de la première', () => {
    const fichiers = fichiersSources(join(racine, 'src'))
    const isRecord = groupesDeCopies(fichiers, { racine, nom: 'isRecord' })[0]
    expect(isRecord.copies.map((c) => c.exportee)).toEqual([true, false])
    expect(isRecord.corps.startsWith('export function isRecord(v: unknown)')).toBe(true)
  })
})
