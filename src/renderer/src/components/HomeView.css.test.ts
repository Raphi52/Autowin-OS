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
describe('HomeView.css — l accueil laisse passer le decor 3D global', () => {
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

  it('.home-view ne peint AUCUNE couche opaque par-dessus le decor global', () => {
    const corps = regleRacine()
    const fond = corps.match(/(?<!-)background(-color)?\s*:\s*([^;]+);/)
    expect(fond, 'la regle doit declarer son fond explicitement, pas le laisser implicite').not.toBeNull()
    const valeur = (fond?.[2] ?? '').trim()
    // La valeur DEVENUE fautive : toute couleur pleine, qui masquerait le decor monte derriere.
    expect(valeur).not.toMatch(/^(#[0-9a-f]{3,8}|black|rgb\()/i)
    expect(valeur).toMatch(/^(transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.?0+\s*\)|none)$/)
  })

  it('le decor n est plus possede par l Accueil : plus d hote local', () => {
    // Le doublon supprime : une seconde scene WebGL montee par la vue elle-meme.
    expect(brut).not.toMatch(/\.home-view__decor/)
  })

  it('la lisibilite reste assuree par l assombrissement du centre, pas par un fond plein', () => {
    // Contre-exemple utile : si quelqu un rend le fond transparent MAIS retire l assombrissement,
    // le texte redevient illisible sur les nebuleuses. Les deux vont ensemble.
    expect(css).toMatch(/\.home-view::after\s*\{[^}]*radial-gradient/)
  })
})
