// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BarriereErreur } from './BarriereErreur'
import { ChatMessageRow } from './ChatMessageRow'
import { VueMesuree } from './VueMesuree'
import type { Msg } from './chat-view-types'
import { nomDeZone } from '../textes-ecrans/barriere-erreur'

/**
 * L'ÉCRAN NOIR DU 2026-10-30 (conv-1327). À 14:14:00, `phrases.get is not a function` dans
 * `BandeauSuperConv` a fait démonter TOUTE l'interface : aucune barrière ne l'arrêtait, il ne restait
 * que le fond noir du thème. Entrée qui doit faire échouer ce fichier : une erreur de rendu qui emporte
 * ce qui est à côté d'elle, ou un bloc en panne qu'aucun clic ne peut relancer.
 */
let container: HTMLDivElement
let root: Root
let panne: boolean

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // React écrit chaque erreur attrapée dans la console : c'est voulu, mais ce n'est pas le sujet ici.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  panne = true
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function Fragile({ erreur = new Error('phrases.get is not a function') }: { erreur?: unknown }) {
  if (panne) throw erreur
  return <p data-testid="fragile">relancé</p>
}

const voisin = (): Element | null => container.querySelector('[data-testid="voisin"]')
const blocEnPanne = (): Element | null => container.querySelector('[data-testid="barriere-erreur"]')
const bouton = (): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>('[data-testid="barriere-reessayer"]')!

function monter(element: ReactElement): void {
  act(() => root.render(element))
}

describe('une zone mesurée est protégée', () => {
  it('la panne reste dans sa zone : le message s’affiche et le voisin survit', () => {
    monter(
      <>
        <p data-testid="voisin">voisin</p>
        <VueMesuree id="tickets">
          <Fragile />
        </VueMesuree>
      </>
    )
    expect(voisin()).not.toBeNull()
    expect(blocEnPanne()?.getAttribute('role')).toBe('alert')
    expect(blocEnPanne()?.textContent).toContain('phrases.get is not a function')
  })

  it('un bloc en panne n’emporte pas l’écran qui le contient', () => {
    monter(
      <VueMesuree id="chat">
        <p data-testid="voisin">le fil</p>
        <VueMesuree id="chat-saisie" bloc>
          <Fragile />
        </VueMesuree>
      </VueMesuree>
    )
    expect(voisin()).not.toBeNull()
    expect(blocEnPanne()?.getAttribute('data-zone')).toBe('chat-saisie')
  })
})

describe('Réessayer', () => {
  it('relance le bloc une fois la cause levée', () => {
    monter(
      <VueMesuree id="tickets">
        <Fragile />
      </VueMesuree>
    )
    panne = false
    act(() => bouton().click())
    expect(blocEnPanne()).toBeNull()
    expect(container.querySelector('[data-testid="fragile"]')?.textContent).toBe('relancé')
  })

  it('rend le bloc en panne si la cause est toujours là, sans rien emporter', () => {
    monter(
      <>
        <p data-testid="voisin">voisin</p>
        <VueMesuree id="tickets">
          <Fragile />
        </VueMesuree>
      </>
    )
    act(() => bouton().click())
    expect(blocEnPanne()).not.toBeNull()
    expect(voisin()).not.toBeNull()
  })

  it('la clé qui change relance le bloc : une autre conversation n’hérite pas de la panne', () => {
    const vue = (cle: string): ReactElement => (
      <VueMesuree id="chat-fil" bloc cle={cle}>
        <Fragile />
      </VueMesuree>
    )
    monter(vue('conv-1'))
    expect(blocEnPanne()).not.toBeNull()
    panne = false
    monter(vue('conv-2'))
    expect(blocEnPanne()).toBeNull()
  })

  it('tant que la clé ne change pas, un nouveau rendu ne relance rien', () => {
    const vue = (): ReactElement => (
      <VueMesuree id="chat-fil" bloc cle="conv-1">
        <Fragile />
      </VueMesuree>
    )
    monter(vue())
    panne = false
    monter(vue())
    expect(blocEnPanne()).not.toBeNull()
  })
})

describe('le dernier filet, autour de toute l’interface', () => {
  it('le bouton recharge l’interface : plus rien n’est monté à relancer', () => {
    const recharger = vi.fn()
    monter(
      <BarriereErreur zone="racine" recharger={recharger}>
        <Fragile />
      </BarriereErreur>
    )
    expect(blocEnPanne()?.getAttribute('data-niveau')).toBe('racine')
    act(() => bouton().click())
    expect(recharger).toHaveBeenCalledOnce()
    expect(blocEnPanne()).not.toBeNull()
  })

  it('main.tsx pose la barrière autour de toute l’interface', () => {
    const source = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8')
    expect(source).toMatch(/<BarriereErreur zone="racine">/)
  })
})

describe('les blocs posés à la main', () => {
  it('un message illisible n’emporte pas le message d’à côté', () => {
    const lisible = { role: 'user', content: 'message lisible' } as Msg
    const illisible = {
      role: 'user',
      get content(): string {
        throw new Error('contenu illisible')
      }
    } as Msg
    monter(
      <>
        <ChatMessageRow message={illisible} conversationId="c" />
        <ChatMessageRow message={lisible} conversationId="c" />
      </>
    )
    expect(blocEnPanne()?.getAttribute('data-zone')).toBe('chat-message')
    expect(blocEnPanne()?.textContent).toContain('contenu illisible')
    expect(container.textContent).toContain('message lisible')
  })

  it.each([
    ['ChatView.tsx', 'zone="chat-lots"', 2],
    ['ChatView.tsx', 'zone="chat-navigateur"', 1],
    ['ChatMosaic.tsx', 'zone="chat-lots"', 1],
    ['ChatMosaic.tsx', 'zone="chat-fil"', 1]
  ])('%s garde %s', (fichier, pose, attendu) => {
    const source = readFileSync(join(__dirname, fichier), 'utf8')
    expect(source.split(`<BarriereErreur ${pose}`).length - 1).toBe(attendu)
  })

  it.each(['chat-fil', 'chat-saisie', 'chat-workflows'])(
    'la panne de %s ne suit pas l’utilisateur dans une autre conversation',
    (zone) => {
      const source = readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')
      expect(source).toContain(`<VueMesuree id="${zone}" bloc cle={activeId}>`)
    }
  )
})

describe('ce que dit le bloc en panne', () => {
  it.each([
    ['un texte', 'erreur en texte', 'erreur en texte'],
    ['rien du tout', null, 'Erreur sans message.'],
    ['un objet', { code: 42 }, 'Erreur sans message.']
  ])('une erreur levée comme %s reste affichable', (_nom, erreur, attendu) => {
    monter(
      <VueMesuree id="tickets">
        <Fragile erreur={erreur} />
      </VueMesuree>
    )
    expect(blocEnPanne()?.textContent).toContain(attendu)
  })

  it('chaque zone mesurée de l’application porte un nom lisible, pas son identifiant', () => {
    const composants = join(__dirname)
    const sources = [
      readFileSync(join(composants, '..', 'App.tsx'), 'utf8'),
      readFileSync(join(composants, 'ChatView.tsx'), 'utf8')
    ].join('\n')
    const zones = [...sources.matchAll(/<VueMesuree id="([^"]+)"/g)].map((m) => m[1])
    expect(zones.length).toBeGreaterThanOrEqual(15)
    for (const zone of zones) {
      expect(nomDeZone(zone, 'fr'), zone).not.toBe(zone)
      expect(nomDeZone(zone, 'en'), zone).not.toBe(zone)
    }
  })
})
