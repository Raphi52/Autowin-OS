import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'WorktreeMapView.css'), 'utf8')
const tsx = readFileSync(join(__dirname, 'WorktreeMapView.tsx'), 'utf8')

/** Déclarations `propriete: valeur`, commentaires retirés. */
function declarations(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/[;{}]/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => /^[a-z-]+\s*:/.test(chunk))
}

describe('WorktreeMapView — conformité visuelle à l’app', () => {
  it('n’introduit aucune couleur en dur : tout passe par les jetons du thème', () => {
    // C'est le defaut constaté par l'utilisateur : la vue avait sa propre palette grise et ne
    // ressemblait pas au reste de l'app — et elle cassait le mode clair.
    const offenders = declarations(css).filter((declaration) =>
      /#[0-9a-f]{3,8}\b|\brgb a?\(|\brgba?\(/i.test(declaration)
    )
    expect(offenders).toEqual([])
    expect(tsx).not.toMatch(/['"]#[0-9a-f]{3,8}['"]/i)
  })

  it('consomme les jetons partagés plutôt que des valeurs propres', () => {
    for (const token of [
      '--surface-panel',
      '--container-border',
      '--container-radius-page',
      '--text-faint',
      '--mono',
      '--cyan',
      '--rose',
      '--gold'
    ]) {
      expect(css).toContain(`var(${token})`)
    }
  })

  it('n’utilise ni halo, ni flou, ni dégradé — contrainte de goût explicite', () => {
    expect(css).not.toMatch(/box-shadow\s*:\s*(?!none)/)
    expect(css).not.toMatch(/filter\s*:/)
    expect(css).not.toMatch(/blur\(/)
    expect(css).not.toMatch(/gradient\(/)
    expect(tsx).not.toMatch(/GaussianBlur|radialGradient|linearGradient/)
  })

  it('garde une barre de défilement horizontale visible', () => {
    expect(css).toContain('overflow-x: auto')
    expect(css).toMatch(/\.wtmap-scroller::-webkit-scrollbar\s*\{[^}]*height/)
    expect(css).toMatch(/\.wtmap-scroller::-webkit-scrollbar-thumb\s*\{/)
  })

  it('reprend l’en-tête de module de l’app', () => {
    // L'en-tête n'est plus recopié ici : il vient de `ViewTopBar`, qui rend `ModuleHeader` (donc
    // `.module-header`) pour TOUTES les vues. Chercher la chaîne littérale reviendrait à exiger la
    // duplication qu'on vient de supprimer. La présence réelle du `.module-header` dans le DOM rendu
    // est vérifiée par `WorktreeMapView.test.tsx` (« .module-header h1 »), pas par ce test de texte.
    expect(tsx).toContain('<ViewTopBar')
  })
})
