/**
 * Les cinq trous de rendu qui rendaient une sortie de skill « moche et incomplete » dans le chat,
 * plus la frontiere du HTML inline. Chaque test nomme la cause qu'il verrouille, et chacun ECHOUE
 * sur le code d'avant : ce sont des tests discriminants, pas des tests de presence.
 */
// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'
import { prepareChatHtml, scopeChatStyleSheet } from './chat-html-inline'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Rend un texte markdown et retourne le conteneur, a la convention des tests de ce dossier. */
function render(text: string): HTMLDivElement {
  act(() => root.render(<Markdown text={text} />))
  return container
}

/** Equivalent local du `getByText` de testing-library : le premier element au texte exact. */
function byText(text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (element) => element.children.length === 0 && element.textContent?.trim() === text
  )
  if (!match) throw new Error(`aucun element au texte exact « ${text} »`)
  return match
}

describe('Markdown — les trous qui rendaient les tableaux de skill illisibles', () => {
  it('(a) allume la pastille sur un score EMPHASE, la forme que les skills produisent vraiment', () => {
    // `**88**` est la forme reelle : la colonne Score est graissee par convention. Avant, le motif
    // numerique butait sur les etoiles et la pastille ne s'allumait jamais.
    render('| Score | Quoi |\n|---|---|\n| **88** | cout |')

    const badge = byText('88')
    expect(badge.className).toContain('md-badge-good')
    // Les etoiles ne doivent pas se retrouver DANS la pastille.
    expect(badge.textContent).toBe('88')
  })

  it('(a-bis) garde les seuils : 88 bon, 52 moyen, 12 mauvais', () => {
    render('| S |\n|---|\n| **88** |\n| **52** |\n| **12** |')

    expect(byText('88').className).toContain('md-badge-good')
    expect(byText('52').className).toContain('md-badge-warn')
    expect(byText('12').className).toContain('md-badge-bad')
  })

  it("(b) ne laisse plus fuiter la syntaxe brute d'un lien de preuve fichier:ligne", () => {
    const container = render('voir [orchestrator.ts:80](src/main/orchestrator.ts:80)')

    // Le symptome exact rapporte : les crochets et la cible s'affichaient litteralement.
    expect(container.textContent).not.toContain('](')
    expect(container.textContent).not.toContain('[orchestrator.ts:80]')
    expect(byText('orchestrator.ts:80').tagName).toBe('CODE')
    // Une cible relative ne devient pas un lien : elle se resoudrait contre l'origine de l'app.
    expect(container.querySelector('a')).toBeNull()
  })

  it('(b-bis) laisse un vrai lien http cliquable et externe', () => {
    const container = render('[doc](https://example.com/x)')

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/x')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('(c) rend une enumeration ordonnee en <ol> numerote, pas en lignes nues', () => {
    const container = render('1. premier\n2. second\n3. troisieme')

    const ol = container.querySelector('ol.md-list')
    expect(ol).not.toBeNull()
    expect(ol?.querySelectorAll('li')).toHaveLength(3)
  })

  it('(c-bis) ne fusionne pas une liste a puces et une liste numerotee', () => {
    const container = render('- puce\n\n1. un\n2. deux')

    expect(container.querySelectorAll('ul.md-list')).toHaveLength(1)
    expect(container.querySelectorAll('ol.md-list')).toHaveLength(1)
  })

  it('(d) rend le separateur --- en filet, au lieu de trois tirets nus', () => {
    const container = render('avant\n\n---\n\napres')

    expect(container.querySelector('hr.md-hr')).not.toBeNull()
    expect(container.textContent).not.toContain('---')
  })

  it('(d-bis) rend citations, italique et texte barre', () => {
    const container = render('> cite\n\nun *mot* et ~~vieux~~')

    expect(container.querySelector('blockquote.md-quote')?.textContent).toBe('cite')
    expect(container.querySelector('em')?.textContent).toBe('mot')
    expect(container.querySelector('del')?.textContent).toBe('vieux')
    expect(container.textContent).not.toContain('~~')
  })

  it("(d-ter) n'italise pas un identifiant contenant des etoiles collees a des mots", () => {
    // Garde-fou : `2 * 3 * 4` ne doit pas devenir de l'italique.
    const container = render('calcul 2 * 3 * 4 fini')
    expect(container.querySelector('em')).toBeNull()
  })

  it('(e) ne jette plus en silence une cellule au-dela de la largeur de l entete', () => {
    // Deux colonnes d'entete, trois cellules dans la ligne : la troisieme disparaissait sans bruit.
    const container = render('| A | B |\n|---|---|\n| 1 | 2 | orpheline |')

    expect(container.textContent).toContain('orpheline')
    expect(container.querySelectorAll('tbody td')).toHaveLength(3)
  })
})

describe('HTML du chat — rendu dans le fil, et ce qui ne passe pas la frontiere', () => {
  const renderHtml = (html: string): HTMLElement => {
    const container = render('```html-render\n' + html + '\n```')
    return container.querySelector('[data-testid="chat-inline-html"]') as HTMLElement
  }

  it('rend le contenu INLINE : plus d iframe, plus de barre d outils, plus de vignette', () => {
    const container = render('```html-render\n<p>salut</p>\n```')

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[data-testid="html-render-preview"]')).toBeNull()
    expect(container.textContent).not.toContain('Rendu HTML')
    expect(container.querySelector('[data-testid="chat-inline-html"]')?.innerHTML).toBe(
      '<p>salut</p>'
    )
  })

  it('conserve la mise en forme utile — c est tout l objectif du changement', () => {
    const host = renderHtml('<table><tr><td style="color: #7ee2a8">vert</td></tr></table>')

    expect(host.querySelector('td')?.getAttribute('style')).toBe('color: #7ee2a8')
  })

  it('retire un script avec son contenu, sans le recracher en texte', () => {
    const host = renderHtml('<p>ok</p><script>alert(1)</script>')

    expect(host.querySelector('script')).toBeNull()
    expect(host.textContent).toBe('ok')
  })

  it('CONSERVE la feuille de style du modele — la supprimer rendrait des reponses nues', () => {
    const host = renderHtml('<style>h2{color:#7ee2a8}</style><h2>titre</h2>')

    expect(host.querySelector('style')).not.toBeNull()
    expect(host.querySelector('style')?.textContent).toContain('color:#7ee2a8')
  })

  it('confine chaque selecteur au domaine du bloc, jamais a l application', () => {
    const host = renderHtml('<style>body{background:red} .card{color:blue}</style><p>x</p>')
    const scope = host.getAttribute('data-html-scope')
    const css = host.querySelector('style')?.textContent ?? ''

    expect(scope).toBeTruthy()
    // `body` designe le conteneur du bloc, pas le document.
    expect(css).toContain(`[data-html-scope="${scope}"]{background:red}`)
    expect(css).toContain(`[data-html-scope="${scope}"] .card{color:blue}`)
    // Aucune regle ne doit commencer par un selecteur nu : tout est prefixe par le domaine.
    for (const rule of css.split('\n').filter(Boolean))
      expect(rule.startsWith('[data-html-scope=')).toBe(true)
  })

  it('donne des domaines DIFFERENTS a deux blocs, pour qu ils ne se repeignent pas', () => {
    const first = renderHtml('<style>.t{color:red}</style><p>a</p>').getAttribute('data-html-scope')
    const second = renderHtml('<style>.t{color:blue}</style><p>b</p>').getAttribute(
      'data-html-scope'
    )

    expect(first).not.toBe(second)
  })

  it('garde les media queries, dont prefers-color-scheme que le prompt reclame', () => {
    const host = renderHtml(
      '<style>@media (prefers-color-scheme: dark){.c{color:#fff}}</style><p>x</p>'
    )
    const css = host.querySelector('style')?.textContent ?? ''

    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain('.c{color:#fff}')
  })

  it('retire position et z-index d une feuille, et refuse @import', () => {
    const css = scopeChatStyleSheet(
      '@import url(http://x.example/a.css); .o{position:fixed;z-index:9999;color:red}',
      '.s'
    )

    expect(css).not.toContain('@import')
    expect(css).not.toContain('position')
    expect(css).not.toContain('z-index')
    expect(css).toContain('color:red')
  })

  it('retire les gestionnaires inline on*', () => {
    const host = renderHtml('<p onclick="alert(1)" onmouseover="alert(2)">ok</p>')

    const paragraph = host.querySelector('p')
    expect(paragraph?.getAttribute('onclick')).toBeNull()
    expect(paragraph?.getAttribute('onmouseover')).toBeNull()
  })

  it('refuse le positionnement, qui permettrait de RECOUVRIR l interface', () => {
    const host = renderHtml(
      '<div style="position: fixed; top: 0; z-index: 99999; color: red">x</div>'
    )

    const style = host.querySelector('div')?.getAttribute('style') ?? ''
    expect(style).not.toContain('position')
    expect(style).not.toContain('z-index')
    expect(style).toContain('color')
  })

  it('refuse display:none, qui cacherait du texte tout en le laissant copiable', () => {
    const host = renderHtml('<span style="display: none">cache</span>')

    expect(host.querySelector('span')?.getAttribute('style')).toBeNull()
  })

  it('refuse url() en CSS, qui declencherait une requete sortante', () => {
    const host = renderHtml('<div style="background: url(https://tracker.example/p.png)">x</div>')

    expect(host.querySelector('div')?.getAttribute('style')).toBeNull()
  })

  it('neutralise un href javascript: sans perdre le libelle', () => {
    const host = renderHtml('<a href="javascript:alert(1)">clique</a>')

    expect(host.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(host.textContent).toBe('clique')
  })

  it('retire iframe, form et input — execution et hameconnage', () => {
    const host = renderHtml(
      '<iframe src="https://x.example"></iframe><form><input name="pass"></form>'
    )

    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('input')).toBeNull()
  })

  it('deplie une balise inconnue sans perdre le texte qu elle porte', () => {
    const host = renderHtml('<custom-widget><strong>garde-moi</strong></custom-widget>')

    expect(host.querySelector('custom-widget')).toBeNull()
    expect(host.querySelector('strong')?.textContent).toBe('garde-moi')
  })

  it('laisse passer une image auto-portee et refuse une image distante', () => {
    const inline1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQAB'
    expect(prepareChatHtml(`<img src="${inline1x1}">`).html).toContain('data:image/png')
    expect(prepareChatHtml('<img src="https://tracker.example/p.png">').html).not.toContain(
      'tracker'
    )
  })
})
