// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatArtifact } from '../../../shared/artifacts'
import { ArtifactPile } from './ArtifactPile'
import { partiesDistinctes } from './artifact-outils'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'

/* PILE D'IMAGES (conv-332, 2026-10-18 : « implémente la 2 + 6 quand déployed »). Repliée = la
   proposition 2 (la dernière image devant, « +N », deux bords dessous) ; déployée = la proposition 6
   (une planche de vignettes). Une image seule ne change pas. */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function image(name: string, overrides: Partial<ChatArtifact> = {}): ChatArtifact {
  return {
    id: `id-${name}`,
    name,
    mimeType: 'image/png',
    kind: 'image',
    size: 2048,
    createdAt: 1,
    source: { provider: 'claude', model: 'opus-test', tool: 'Read' },
    path: `C:/fil/${name}`,
    ...overrides
  }
}

const art = (artifact: ChatArtifact): ChatPart => ({ kind: 'artifact', artifact })
const texte = (text: string): ChatPart => ({ kind: 'text', text })

describe('groupAssistantActivity — images qui se suivent', () => {
  it('deux images ou plus à la suite deviennent UNE pile, une image seule reste une capsule', () => {
    const blocs = groupAssistantActivity([
      texte('Je regarde les captures.'),
      art(image('a-11.png')),
      art(image('a-6.png')),
      art(image('a-7.png')),
      texte('Puis une seule.'),
      art(image('b.png'))
    ])
    expect(blocs.map((bloc) => bloc.kind)).toEqual(['text', 'artifact-pile', 'text', 'artifact'])
    const pile = blocs[1]
    expect(pile.kind === 'artifact-pile' && pile.artifacts.map((a) => a.name)).toEqual([
      'a-11.png',
      'a-6.png',
      'a-7.png'
    ])
  })

  it('un autre genre d’artefact ne rejoint pas la pile et la coupe', () => {
    const doc = image('notes.md', { kind: 'markdown', mimeType: 'text/markdown' })
    const blocs = groupAssistantActivity([art(image('a.png')), art(doc), art(image('b.png'))])
    expect(blocs.map((bloc) => bloc.kind)).toEqual(['artifact', 'artifact', 'artifact'])
  })
})

describe('partiesDistinctes', () => {
  it('retire préfixe et suffixe communs, coupés sur un séparateur', () => {
    expect(
      partiesDistinctes(['l560-onglet-11.png', 'l560-onglet-6.png', 'l560-onglet-10.png'])
    ).toEqual(['11', '6', '10'])
    // Ne coupe pas un nombre en deux : « a-10 » / « a-11 » ne donnent pas « 0 » / « 1 ».
    expect(partiesDistinctes(['a-10.png', 'a-11.png'])).toEqual(['10', '11'])
  })

  it('garde les noms entiers quand rien de commun ne se détache proprement', () => {
    expect(partiesDistinctes(['l860-onglet-7.png', 'l560-onglet-9.png'])).toEqual([
      'l860-onglet-7',
      'l560-onglet-9'
    ])
    expect(partiesDistinctes(['plan.png', 'plan-2.png'])).toEqual(['plan', 'plan-2'])
  })
})

describe('ArtifactPile', () => {
  let container: HTMLDivElement
  let root: Root
  const readChatArtifact = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    readChatArtifact.mockReset()
    readChatArtifact.mockImplementation(async () => ({
      ok: true,
      content: 'iVBORw0KGgo=',
      encoding: 'base64'
    }))
    ;(window as unknown as { api: unknown }).api = { readChatArtifact }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (window as unknown as { api?: unknown }).api
  })

  const pile = [image('l560-onglet-11.png'), image('l560-onglet-6.png'), image('l560-onglet-10.png')]

  it('repliée : la DERNIÈRE image devant, « +N », deux bords dessous, aucune image lue', () => {
    act(() => root.render(<ArtifactPile artifacts={pile} conversationId="conv-1" turnId="t-1" />))
    const carte = container.querySelector('details.thinking-block.cadre-anneau.artifact-capsule')
    expect(carte).not.toBeNull()
    expect(carte?.hasAttribute('open')).toBe(false)
    expect(container.querySelector('.artifact-capsule__provenance')?.textContent).toBe(
      'Image · Read'
    )
    expect(container.querySelector('.artifact-capsule__nom')?.textContent).toBe(
      'l560-onglet-10.png · la dernière lue'
    )
    expect(container.querySelector('.artifact-pile__compte')?.textContent).toBe('+2')
    expect(container.querySelectorAll('.artifact-pile__tranches > span')).toHaveLength(2)
    expect(container.querySelector('.artifact-pile__planche')).toBeNull()
    expect(readChatArtifact).not.toHaveBeenCalled()
  })

  it('déployée : une vignette par image, dans l’ordre, légende distinctive, clic = agrandir', async () => {
    const onOpenImage = vi.fn()
    act(() =>
      root.render(
        <ArtifactPile
          artifacts={pile}
          conversationId="conv-1"
          turnId="t-1"
          onOpenImage={onOpenImage}
        />
      )
    )
    await act(async () => {
      container.querySelector<HTMLElement>('summary')?.click()
    })
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
    expect(container.querySelector('.artifact-pile__tranches')).toBeNull()
    const vignettes = [...container.querySelectorAll('.artifact-pile__vignette')]
    expect(vignettes.map((v) => v.querySelector('.artifact-pile__legende b')?.textContent)).toEqual(
      ['11', '6', '10']
    )
    expect(readChatArtifact.mock.calls.map((call) => call[2])).toEqual([
      'id-l560-onglet-11.png',
      'id-l560-onglet-6.png',
      'id-l560-onglet-10.png'
    ])
    expect(container.querySelectorAll('.artifact-pile__apercu img')).toHaveLength(3)
    act(() => (vignettes[1] as HTMLElement).click())
    expect(onOpenImage).toHaveBeenCalledWith({
      src: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'l560-onglet-6.png'
    })
    await act(async () => {
      container.querySelector<HTMLElement>('summary')?.click()
    })
    expect(container.querySelector('.artifact-pile__planche')).toBeNull()
  })

  it('suit l’état du tour comme les autres capsules', () => {
    act(() => root.render(<ArtifactPile artifacts={pile} live />))
    expect(container.querySelector('.artifact-pile')?.classList.contains('is-live')).toBe(true)
    act(() => root.render(<ArtifactPile artifacts={pile} />))
    expect(container.querySelector('.artifact-pile')?.classList.contains('is-done')).toBe(true)
  })
})
