import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * L'accueil ne montre PAS l'image plate du fond d'ecran : il en montre la reproduction 3D.
 *
 * CHANGEMENT DE DECISION, assume. conv-1358 demandait l'inverse (« sur la vue accueil je vois pas le
 * fond d'ecran ») et ce fichier imposait alors `background: transparent`. Constat utilisateur
 * conv-1397 : « je vois toujours le fond d'ecran qui est present dans toutes les vues dans la vue
 * accueil, ce n'est pas ce que je veux, je veux une reproduction en 3d du fond d'ecran ». Laisser
 * `.home-view` transparent laissait `body` (`theme.css:62-64`, `autowin-galaxy-bg-hq.png`) se voir a
 * travers le canevas efface en alpha 0 : l'utilisateur voyait l'image plate, pas la scene. La couche
 * opaque revient donc ici, et le decor 3D devient la SEULE source du fond sur cette vue.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST si la correction est fausse : remettre
 * `background: transparent` (ou un `rgba(..., 0)`, ou `none`, ou retirer la declaration) dans la
 * regle `.home-view`. Verifie en le reintroduisant : ce test passe au rouge.
 */
describe('HomeView.css — l image plate ne transparait plus, le decor 3D fait le fond', () => {
  const brut = readFileSync(new URL('./HomeView.css', import.meta.url), 'utf8')
  // Les commentaires sont RETIRES avant analyse : sans cela, un commentaire citant la valeur fautive
  // suffisait a faire echouer le test alors que la declaration reelle etait correcte.
  const css = brut.replace(/\/\*[\s\S]*?\*\//g, '')

  /** Corps de la regle `.home-view` seule (pas ses descendants `.home-view__*`). */
  function regleRacine(): string {
    const debut = css.search(/^\.home-view\s*\{/m)
    expect(debut).toBeGreaterThanOrEqual(0)
    const fin = css.indexOf('}', debut)
    expect(fin).toBeGreaterThan(debut)
    return css.slice(debut, fin)
  }

  it('.home-view masque l image de body avec un fond OPAQUE', () => {
    const corps = regleRacine()
    const fond = corps.match(/(?<!-)background(-color)?\s*:\s*([^;]+);/)
    expect(fond, 'la regle doit declarer son fond explicitement, pas le laisser implicite').not.toBeNull()
    const valeur = (fond?.[2] ?? '').trim()
    // Refus explicite de la valeur fautive de conv-1397 et de ses equivalents transparents.
    expect(valeur).not.toBe('transparent')
    expect(valeur).not.toMatch(/rgba\([^)]*,\s*0?\.?0+\s*\)/)
    expect(valeur).not.toMatch(/\bnone\b/)
    // Opaque, et noir : le centre du decor reproduit est noir, la jonction reste invisible.
    expect(valeur).toMatch(/^(#000|#000000|black|rgb\(0,\s*0,\s*0\)|rgba\(0,\s*0,\s*0,\s*1(\.0+)?\))$/)
  })

  it('la lisibilite reste assuree par l assombrissement du centre, pas par un fond plein', () => {
    // Contre-exemple utile : si quelqu un rend le fond transparent MAIS retire l assombrissement,
    // le texte redevient illisible sur les nebuleuses. Les deux vont ensemble.
    expect(css).toMatch(/\.home-view::after\s*\{[^}]*radial-gradient/)
  })
})
