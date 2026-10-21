// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CarnetDuFil } from './CarnetDuFil'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import type { Msg } from './chat-view-types'

/**
 * « COMPACTER MONTRE CE QUI EST GARDÉ », DANS LE PANNEAU (conv-1038, 2026-10-21 — idée 5).
 *
 * Après « Compacter », le carnet montre le résumé dont l'agent repart et dit combien de messages il
 * ne relit plus. Il s'OUVRE de lui-même quand un compactage se termine sous les yeux de
 * l'utilisateur — c'est le moment où il veut voir ce qui a été gardé.
 *
 * Les entrées qui font échouer une version fausse :
 *  - un fil DÉJÀ compacté à l'ouverture : le carnet garde le choix replié de l'utilisateur (une
 *    version qui s'ouvre sur « compactage présent » au lieu de « compactage qui se TERMINE » rougit) ;
 *  - un résumé encore en cours : aucune ligne gardée, un état « en cours » ;
 *  - une réponse ratée : le carnet dit qu'aucun résumé n'est gardé, au lieu de se taire.
 */

const user = (content: string, ts: number): Msg => ({ role: 'user', content, ts }) as Msg
const asst = (text: string, extra: Record<string, unknown> = {}): Msg =>
  ({
    role: 'assistant',
    status: 'completed',
    done: true,
    parts: text ? [{ kind: 'text', text }] : [],
    ...extra
  }) as unknown as Msg

const AVANT = [user('construis les 7 idées', 1), asst('Fait : idée 1.'), user(COMPACT_REQUEST, 2)]
const RESUME = '## Objectif\nConstruire les 7 idées.\n- idée 3 : ta décision'

let conteneur: HTMLElement
let racine: Root

async function rendre(fil: readonly Msg[]): Promise<void> {
  await act(async () => {
    racine.render(
      createElement(CarnetDuFil, { conversationId: 'A', fil, onCorrection: () => undefined })
    )
    await Promise.resolve()
  })
}

const ouvert = (): boolean =>
  conteneur.querySelector('.carnet-bascule')?.getAttribute('aria-expanded') === 'true'

describe('CarnetDuFil — ce que « Compacter » a gardé', () => {
  beforeEach(() => {
    conteneur = document.createElement('div')
    document.body.append(conteneur)
    racine = createRoot(conteneur)
  })
  afterEach(() => {
    act(() => racine.unmount())
    conteneur.remove()
    window.localStorage.clear()
  })

  it('montre le résumé gardé et le nombre de messages que l’agent ne relit plus', async () => {
    window.localStorage.setItem('autowin.chat.carnet.ouvert', '1')
    await rendre([...AVANT, asst(RESUME)])
    const garde = conteneur.querySelector('[data-rubrique="garde"]')
    expect(garde?.textContent).toContain('Construire les 7 idées.')
    expect(garde?.textContent).toContain('idée 3 : ta décision')
    expect(garde?.textContent).toContain('ne relit plus les 2 messages d’avant')
  })

  it('un compactage qui se TERMINE ouvre le carnet replié sur ce qui est gardé', async () => {
    window.localStorage.setItem('autowin.chat.carnet.ouvert', '0')
    await rendre([...AVANT, asst('## Obj', { status: 'streaming', done: false })])
    expect(ouvert()).toBe(false)
    await rendre([...AVANT, asst(RESUME)])
    expect(ouvert()).toBe(true)
    expect(conteneur.querySelector('[data-rubrique="garde"]')).not.toBeNull()
    // Le choix enregistré de l'utilisateur n'est pas réécrit par cette ouverture.
    expect(window.localStorage.getItem('autowin.chat.carnet.ouvert')).toBe('0')
  })

  it('un fil déjà compacté à l’ouverture garde le carnet replié', async () => {
    window.localStorage.setItem('autowin.chat.carnet.ouvert', '0')
    await rendre([...AVANT, asst(RESUME)])
    expect(ouvert()).toBe(false)
    expect(conteneur.querySelector('.carnet-resume')?.textContent).toContain('résumé gardé')
  })

  it('résumé en cours : le carnet le dit, sans aucune ligne gardée', async () => {
    window.localStorage.setItem('autowin.chat.carnet.ouvert', '1')
    await rendre([...AVANT, asst('## Obj', { status: 'streaming', done: false })])
    expect(conteneur.querySelector('[data-testid="carnet-compactage"]')?.textContent).toContain(
      'Compactage en cours'
    )
    expect(conteneur.querySelector('[data-rubrique="garde"]')).toBeNull()
  })

  it('réponse ratée : le carnet dit qu’aucun résumé n’est gardé', async () => {
    window.localStorage.setItem('autowin.chat.carnet.ouvert', '1')
    await rendre([...AVANT, asst('', { status: 'failed' })])
    expect(conteneur.querySelector('[data-testid="carnet-compactage"]')?.textContent).toContain(
      'aucun résumé'
    )
  })
})
