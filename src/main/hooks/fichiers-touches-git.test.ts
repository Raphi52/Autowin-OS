import { describe, expect, it } from 'vitest'
import { cheminPorcelain } from './default-gate-hooks'

/**
 * DEFAUT MESURE le 2026-09-12, en sondant le garde-fou de preuve visuelle sur le depot reel :
 * il rapportait des chemins AMPUTES de leur premiere lettre — `rc/renderer/src/components/...`
 * au lieu de `src/renderer/...`.
 *
 * Cause localisee : `fichiersTouchesGit` lisait `git status --porcelain` via un helper qui fait
 * `.trim()` sur chaque ligne AVANT le decoupage `.slice(3)`. Or le porcelain prefixe l'etat sur
 * DEUX colonnes + un espace : une modification non indexee s'ecrit « ␣M␣chemin ». Le `trim()`
 * mange l'espace de tete, `.slice(3)` retire alors « M␣c » — un caractere de trop.
 *
 * Consequence reelle : le garde-fou nomme des fichiers qui n'existent pas dans son motif de refus,
 * et toute regle qui filtrerait par prefixe de dossier (`src/renderer/`) le raterait en silence.
 * Controle negatif inclus : un chemin deja correct ne doit PAS etre retouche.
 */
describe('cheminPorcelain — le prefixe d etat de git status --porcelain', () => {
  it('retire les DEUX colonnes d etat et leur espace, pas une de plus', () => {
    expect(cheminPorcelain(' M src/renderer/src/components/ChatView.tsx')).toBe(
      'src/renderer/src/components/ChatView.tsx'
    )
    expect(cheminPorcelain('?? src/main/nouveau.ts')).toBe('src/main/nouveau.ts')
    expect(cheminPorcelain('M  src/main/indexe.ts')).toBe('src/main/indexe.ts')
    expect(cheminPorcelain(' D skills/ancien/SKILL.md')).toBe('skills/ancien/SKILL.md')
  })

  it('garde la CIBLE d un renommage, pas la source', () => {
    expect(cheminPorcelain('R  ancien/a.ts -> src/main/b.ts')).toBe('src/main/b.ts')
  })

  it('ne casse pas une ligne deja sans prefixe (sortie de git diff --name-only)', () => {
    expect(cheminPorcelain('src/main/deja-propre.ts')).toBe('src/main/deja-propre.ts')
  })

  it('rend une chaine vide sur une ligne vide, jamais un fragment', () => {
    expect(cheminPorcelain('')).toBe('')
    expect(cheminPorcelain('   ')).toBe('')
  })
})

/**
 * GEL DU PROCESS PRINCIPAL — gels.jsonl du 2026-09-24 : 21 gels, 78 s cumules, jusqu'a 24,5 s
 * d'affilee, tous sur `execFileSync git` depuis `fichiersTouchesGit` (demarrage de chaque run,
 * garde-fous de preuve). Ce module tourne sur le fil principal : aucun git synchrone n'y a sa place.
 */
describe('default-gate-hooks — aucun git bloquant sur le fil principal', () => {
  it('ne contient plus aucun appel execFileSync', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(
      fileURLToPath(new URL('./default-gate-hooks.ts', import.meta.url)),
      'utf8'
    )
    // Seul le CODE compte : les commentaires d'historique citent l'ancien appel.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/execFileSync\s*\(/)
  })

  it('fichiersTouchesGit rend une promesse, et une liste vide hors depot', async () => {
    const { fichiersTouchesGit } = await import('./default-gate-hooks')
    const { tmpdir } = await import('node:os')
    const resultat = fichiersTouchesGit(tmpdir())
    expect(resultat).toBeInstanceOf(Promise)
    expect(Array.isArray(await resultat)).toBe(true)
  })
})
