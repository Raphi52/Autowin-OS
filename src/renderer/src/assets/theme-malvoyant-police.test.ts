import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Thèmes malvoyants : la police FORCÉE sur l'interface et le jeton `--font` doivent être la même.
 * Pourquoi (conv-1322, 2026-10-30) : mermaid mesure ses étiquettes hors de `.shell`, avec la police
 * qu'il lit dans `--font` (theme-mermaid.ts). Le thème forçait Atkinson Hyperlegible sur `.shell *`
 * mais laissait `--font` en Segoe UI : mesuré, 8 étiquettes sur 25 du schéma de conv-1321 avaient
 * leur fin de mot coupée. ENTRÉE QUI DOIT FAIRE ÉCHOUER : une police écrite en dur dans la règle
 * forcée, ou un `--font` malvoyant absent.
 */
const css = readFileSync('src/renderer/src/assets/theme-modes.css', 'utf8')

/** Les déclarations de TOUTES les règles qui portent exactement ce sélecteur, mises bout à bout. */
function declarations(selecteur: string): string {
  const echappe = selecteur.replace(/[[\]^$.*+?()|\\]/g, '\\$&')
  const regles = [...css.matchAll(new RegExp(`^${echappe}\\s*\\{([^}]*)\\}`, 'gm'))]
  if (regles.length === 0) throw new Error(`règle ${selecteur} introuvable`)
  return regles.map((m) => m[1]).join('\n')
}

describe('police des thèmes malvoyants', () => {
  it('le jeton --font des thèmes malvoyants nomme Atkinson Hyperlegible en premier', () => {
    const jeton = /--font:\s*([^;]+);/.exec(declarations(":root[data-theme^='malvoyant-']"))
    expect(jeton?.[1].trim().startsWith("'Atkinson Hyperlegible'")).toBe(true)
  })

  it("la règle qui force la police sur l'interface passe par var(--font), sans police en dur", () => {
    const regle = declarations(
      ":root[data-theme^='malvoyant-'] .shell *:not(code):not(pre):not(pre *):not(kbd):not(samp)"
    )
    expect(regle).toMatch(/font-family:\s*var\(--font\)\s*!important/)
    expect(regle).not.toMatch(/Atkinson/)
  })
})
