// @vitest-environment happy-dom
/**
 * LE MÊME TEXTE NE SE RE-PARSE PAS.
 *
 * Pendant le streaming, le fil se re-rend à chaque lot de deltas : TOUTES les bulles déjà figées
 * repassaient par `fromMarkdown` (parse CommonMark complet) et par `prepareChatHtml` (assainissement
 * + confinement CSS) à chaque fois. Coût O(taille du fil) par frame, pour un résultat identique.
 *
 * Entrées qui doivent faire échouer ces tests si la correction est fausse :
 *  (a) rendre DEUX fois le même texte → `fromMarkdown` ne doit être appelé qu'une fois ; une
 *      « mémoïsation » par référence d'objet (et non par contenu) échouerait ici ;
 *  (b) rendre un texte DIFFÉRENT → un nouvel appel DOIT avoir lieu (un cache qui rendrait le
 *      résultat précédent afficherait un message pour un autre, c'est pire que le lag) ;
 *  (c) `prepareChatHtml` appelé deux fois sur la même source → même objet, et un `scopeId` STABLE ;
 *  (d) `Markdown` doit être un composant MÉMOÏSÉ (React.memo), sinon le fil entier se re-rend.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appels = { fromMarkdown: 0 }
vi.mock('mdast-util-from-markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('mdast-util-from-markdown')>()
  return {
    ...real,
    fromMarkdown: (...args: Parameters<typeof real.fromMarkdown>) => {
      appels.fromMarkdown += 1
      return real.fromMarkdown(...args)
    }
  }
})

const { Markdown } = await import('./Markdown')
const { prepareChatHtml } = await import('./chat-html-inline')

beforeEach(() => {
  appels.fromMarkdown = 0
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

async function rendre(texte: string): Promise<void> {
  const hote = document.createElement('div')
  document.body.append(hote)
  const root = createRoot(hote)
  await act(async () => root.render(createElement(Markdown, { text: texte })))
  await act(async () => root.unmount())
  hote.remove()
}

describe('Markdown — travail de parsing mémoïsé', () => {
  it('le même texte rendu deux fois ne parse qu’UNE fois', async () => {
    const texte = 'Bonjour **monde**\n\n```ts\nconst a = 1\n```\n'
    await rendre(texte)
    const apresPremier = appels.fromMarkdown
    expect(apresPremier).toBeGreaterThan(0)
    await rendre(texte)
    expect(appels.fromMarkdown, 'le second rendu doit taper le cache').toBe(apresPremier)
  })

  it('un texte DIFFÉRENT reparse (le cache ne rend jamais le mauvais contenu)', async () => {
    await rendre('un texte A')
    const apres = appels.fromMarkdown
    await rendre('un texte B, tout autre')
    expect(appels.fromMarkdown).toBeGreaterThan(apres)
    const hote = document.createElement('div')
    document.body.append(hote)
    const root = createRoot(hote)
    await act(async () => root.render(createElement(Markdown, { text: 'un texte B, tout autre' })))
    expect(hote.textContent).toContain('un texte B, tout autre')
    await act(async () => root.unmount())
    hote.remove()
  })

  it('prepareChatHtml est mis en cache par source, scopeId stable', () => {
    const source = '<div style="color:red">salut</div>'
    const premier = prepareChatHtml(source)
    const second = prepareChatHtml(source)
    expect(second).toBe(premier)
    expect(second.scopeId).toBe(premier.scopeId)
    const autre = prepareChatHtml('<p>autre</p>')
    expect(autre.html).toContain('autre')
    expect(autre).not.toBe(premier)
  })

  it('Markdown est un composant mémoïsé', () => {
    const type = (Markdown as unknown as { $$typeof?: symbol }).$$typeof
    expect(String(type)).toBe('Symbol(react.memo)')
  })
})
