// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, createElement } from 'react'
import { Markdown } from './Markdown'
import { ClaudeCliAdapter } from '../../../main/providers/claude'
import { buildChatPilotagePrompt } from '../../../main/chat-pilotage-prompt'
import type { SendResult } from '../../../main/providers/types'

/**
 * PREUVE DE BOUT EN BOUT du rendu HTML/CSS — toutes les briques ENSEMBLE, avec un VRAI appel modèle.
 *
 * Ce test n'est PAS un test unitaire : il consomme un vrai provider, donc il n'a pas sa place dans la
 * suite par défaut (il coûte, il dépend du réseau et de l'authentification). Il existe pour répondre à
 * une question qu'aucun mock ne peut trancher : « est-ce que le modèle, avec le prompt RÉEL de l'app,
 * produit un bloc que le renderer RÉEL transforme en page rendue ? »
 *
 * Chaîne exercée, sans raccourci :
 *   prompt de pilotage réel  →  ClaudeCliAdapter (vrai CLI)  →  texte du modèle
 *   →  tokenizeur Markdown du renderer  →  SandboxedHtmlPreview  →  iframe data:text/html
 *
 * Lancer explicitement :  npx vitest run src/renderer/src/components/html-render-e2e.live.test.tsx
 */
describe('rendu HTML/CSS de bout en bout (appel modèle RÉEL)', () => {
  it('le modèle émet un bloc html-render que le renderer transforme en page rendue', async () => {
    const adapter = new ClaudeCliAdapter()
    const system = buildChatPilotagePrompt([])
    const demande =
      'Réponds SANS aucune commande : émets un bloc fermé html-render contenant une mini-page ' +
      'autonome — une carte de profil centrée, coins arrondis, ombre douce, un bouton, le CSS dans ' +
      'une balise style. Aucun script, aucune URL externe.'

    const generator = adapter.send([{ role: 'user', content: demande }], {
      system,
      model: 'sonnet'
    })
    let step = await generator.next()
    while (!step.done) step = await generator.next()
    const result = step.value as SendResult
    const texte = result.text ?? ''

    // 1. Le modèle a bien employé la convention que le prompt lui enseigne.
    expect(texte).toMatch(/```html-render/)

    // 2. Le renderer RÉEL en fait une surface rendue, pas un bloc de code.
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(Markdown, { text: texte }))
    })

    const preview = host.querySelector('[data-testid="html-render-preview"]')
    expect(preview).not.toBeNull()
    const iframe = preview!.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toMatch(/^data:text\/html/)

    // 3. Ce qui est rendu porte VRAIMENT du CSS — sinon « rendu » ne veut rien dire.
    const html = decodeURIComponent(
      (iframe!.getAttribute('src') ?? '').replace(/^data:text\/html[^,]*,/, '')
    )
    expect(html).toMatch(/<style|style=/)

    console.log('--- extrait du HTML RENDU dans l iframe ---')
    console.log(html.slice(0, 700))

    await act(async () => root.unmount())
    host.remove()
  }, 240_000)
})
