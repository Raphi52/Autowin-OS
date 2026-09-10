import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = () => readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
/**
 * `is-running` a migre dans l'ATOME 5A de theme.css (SOURCE UNIQUE du « ca bosse »), et sa couleur y
 * est portee par `border-top-color` : c'est l'anneau qui est colore, plus un point plein.
 *
 * Ce test lisait ChatView.css SEUL et cherchait `color:`. Il annoncait donc « running sans couleur
 * propre » alors que la couleur existait — ailleurs. Corrige a sa cause : on lit les DEUX sources et
 * les DEUX proprietes. L'exigence ne bouge pas : chaque etat garde une couleur, les six distinctes.
 */
const theme = () => readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')

/**
 * LA COULEUR PASSE PAR UN JETON, ELLE N'EST PLUS ECRITE EN DUR. ChatView.css appelle desormais
 * `var(--chat-etat-*)` et c'est theme.css qui porte la valeur -- c'est ce qui permet aux themes
 * clairs de reteinter les pastilles. On resout donc l'appel jusqu'a sa valeur finale. L'exigence
 * verifiee est la meme : six etats, six couleurs DISTINCTES. Sans cette resolution, le test
 * conclurait « etat sans couleur propre » alors que la couleur existe, un cran plus loin.
 */
const resoudreJeton = (valeur: string): string => {
  const brut = valeur.trim()
  const appel = /^var\((--[a-z0-9-]+)\)$/.exec(brut)
  if (!appel) return brut.toLowerCase()
  const definition = new RegExp(`^\\s*${appel[1]}:\\s*([^;]+);`, 'm').exec(theme())
  return definition ? resoudreJeton(definition[1]) : brut.toLowerCase()
}

const colorOf = (state: string): string | undefined => {
  const motif = new RegExp(
    String.raw`\.conversation-state\.is-` + state + String.raw`\b[^{]*\{([^}]*)\}`,
    'gs'
  )
  for (const source of [css(), theme()]) {
    for (const bloc of source.matchAll(motif)) {
      const teinte = bloc[1].match(
        /(?:^|[\s;])(?:border-top-)?color:\s*(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))/
      )
      if (teinte) return resoudreJeton(teinte[1])
    }
  }
  /*
    « running » ne se peint plus dans une regle CSS : la pastille rend le composant <Spinner/>
    (classe .spinner), atome unique de l'app. Sa couleur vit donc dans le bloc .spinner::before
    de theme.css. On la lit LA, au lieu de conclure « pas de couleur » — l'exigence (six etats,
    six couleurs distinctes) est inchangee.
  */
  if (state === 'running') {
    for (const bloc of theme().matchAll(/\.spinner::before\s*\{([^}]*)\}/gs)) {
      const teinte = bloc[1].match(/border-top-color:\s*(#[0-9a-fA-F]{3,8})/)
      if (teinte) return teinte[1].toLowerCase()
    }
  }
  return undefined
}

describe('conversation status dot palette', () => {
  it('gives every conversation state its own colour', () => {
    const states = ['running', 'waiting', 'completed', 'failed', 'interrupted', 'cancelled']
    const colors = states.map((state) => [state, colorOf(state)] as const)

    for (const [state, color] of colors) {
      expect(color, `état "${state}" sans couleur propre`).toBeDefined()
    }
    const unique = new Set(colors.map(([, color]) => color))
    expect(unique.size, `couleurs partagées: ${JSON.stringify(colors)}`).toBe(states.length)
  })

  it('keeps the empty state visually muted rather than coloured like a live one', () => {
    const block = css().match(/\.conversation-state\.is-empty\s*{([^}]*)}/s)?.[1]
    expect(block).toBeDefined()
    expect(block).toMatch(/opacity:\s*0\.[0-9]+/)
  })
})
