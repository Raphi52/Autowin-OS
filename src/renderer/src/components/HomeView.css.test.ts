import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Le fond d'ecran de l'application doit TRANSPARAITRE sur la page d'accueil.
 *
 * Constat utilisateur (conv-1358) : « sur la vue accueil je vois pas le fond d'ecran ». Cause
 * localisee dans le CSS : toute la chaine au-dessus est transparente (`#root`, `.main`,
 * `.view-slot` — `app-shell.css:235`), le canevas du decor est en `alpha: true` avec un effacement
 * transparent (`home-decor-scene.ts:454-459`), donc la seule couche opaque etait `.home-view`
 * elle-meme. Un `background: #000` y peint un rectangle noir PAR-DESSUS l'image de `body`
 * (`theme.css:62-64`) : le decor 3D se voyait, le fond d'ecran jamais.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST si la correction est fausse : remettre
 * `background: #000` (ou toute couleur opaque) dans la regle `.home-view`. Verifie en le
 * reintroduisant : ce test passe au rouge.
 */
describe('HomeView.css — le fond d ecran transparait', () => {
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

  it('.home-view ne peint aucun fond opaque par-dessus l image de body', () => {
    const corps = regleRacine()
    const fond = corps.match(/(?<!-)background(-color)?\s*:\s*([^;]+);/)
    expect(fond, 'la regle doit declarer son fond explicitement, pas le laisser implicite').not.toBeNull()
    const valeur = (fond?.[2] ?? '').trim()
    // Refuse un noir opaque sous toutes ses ecritures, et toute couleur pleine.
    expect(valeur).not.toMatch(/#0{3,8}\b/)
    expect(valeur).not.toMatch(/rgba?\([^)]*?(?:,\s*1(?:\.0+)?\s*)?\)/)
    expect(valeur).toBe('transparent')
  })

  it('la lisibilite reste assuree par l assombrissement du centre, pas par un fond plein', () => {
    // Contre-exemple utile : si quelqu un rend le fond transparent MAIS retire l assombrissement,
    // le texte redevient illisible sur les nebuleuses. Les deux vont ensemble.
    expect(css).toMatch(/\.home-view::after\s*\{[^}]*radial-gradient/)
  })
})
