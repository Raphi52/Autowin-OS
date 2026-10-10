// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { prepareChatHtml } from './chat-html-inline'

/**
 * Un bloc du fil vit dans la COLONNE de reponse ; ses requetes de largeur doivent la mesurer, elle,
 * et pas la fenetre. Defaut mesure conv-139, tour 1d9c0c1d-e6c2-4794-a927-191c11f2aaf8 : fenetre
 * 1600 px, colonne 860 px, `@media (min-width:1251px) and (max-width:1640px){.stage{zoom:.9}}` s'est
 * declenche et la maquette a pris 1440 px, coupee a droite.
 */
function feuille(css: string): string {
  const { html } = prepareChatHtml(`<style>${css}</style><div class="a">x</div>`)
  return /<style>([\s\S]*)<\/style>/.exec(html)?.[1] ?? ''
}

describe('requetes de largeur d un bloc html-render', () => {
  it('convertit un @media de largeur en requete de conteneur, et fait du bloc ce conteneur', () => {
    const sortie = feuille('@media (max-width:820px){.a{color:red}}')
    expect(sortie).toContain('@container (max-width:820px)')
    expect(sortie).not.toMatch(/@media/)
    expect(sortie).toMatch(/^\[data-html-scope="[^"]+"\]\{container-type:inline-size\}/)
  })

  it('garde les paliers combines, le type screen retire, et la syntaxe d intervalle', () => {
    expect(feuille('@media screen and (min-width:821px) and (max-width:1250px){.a{color:red}}')).toContain(
      '@container (min-width:821px) and (max-width:1250px)'
    )
    expect(feuille('@media (400px <= width <= 700px){.a{color:red}}')).toContain(
      '@container (400px <= width <= 700px)'
    )
  })

  it('laisse a la PAGE ce qui ne parle pas de largeur de colonne', () => {
    for (const media of [
      '@media print',
      '@media (prefers-color-scheme: light)',
      '@media (min-height: 500px)',
      '@media (max-device-width: 600px)',
      '@media (max-width: 600px), print',
      '@media not all and (max-width: 600px)'
    ]) {
      const sortie = feuille(`${media}{.a{color:red}}`)
      expect(sortie, media).toContain(media)
      expect(sortie, media).not.toContain('container-type')
    }
  })

  it('ne touche pas la mise en page d un bloc sans requete de largeur', () => {
    expect(feuille('.a{color:red}')).not.toContain('container-type')
  })

  it('donne aussi un conteneur a un @container ecrit directement par le modele', () => {
    const sortie = feuille('@container (max-width:500px){.a{color:red}}')
    expect(sortie).toContain('{container-type:inline-size}')
    expect(sortie).toContain('@container (max-width:500px)')
  })
})
