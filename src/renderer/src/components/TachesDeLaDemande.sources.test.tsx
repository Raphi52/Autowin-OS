// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemandeDeLaCarte, ResultatDuRattachement } from '../../../shared/carte-des-besoins'
import { TachesDeLaDemande } from './TachesDeLaDemande'

/**
 * LE CHOIX DE LA SOURCE DANS « + task » (conv-1127, 2026-10-23). Demande : « ajoute au champ
 * « + task » de la fiche du Board le choix de la source quand plusieurs sources de tickets sont
 * configurées ». ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : deux sources sans aucun choix affiché ; la
 * source choisie qui ne part pas avec le numéro ; un choix affiché pour une seule source (inutile).
 * (La puce au titre long qui dépassait la fiche se prouve par une capture : happy-dom ne mesure rien.)
 */

const DEMANDE: DemandeDeLaCarte = {
  conversationId: 'conv-1',
  conversationTitre: 'Fil',
  rang: 0,
  messageId: 'm0',
  titre: 'demande',
  statut: 'prouve',
  constat: 'npm test → exit 0'
}

const AZURE = { id: 'azure:contoso:projet', label: 'contoso / projet' }
const GITHUB = { id: 'github:contoso:depot', label: 'contoso/depot' }

describe('TachesDeLaDemande — choix de la source', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  async function ouvrirLeChamp(
    sources: readonly { id: string; label: string }[] | undefined,
    demande: DemandeDeLaCarte = DEMANDE
  ) {
    const lier = vi.fn(async (): Promise<ResultatDuRattachement> => ({
      ok: true,
      workItem: { sourceId: GITHUB.id, id: '77', origine: 'manuel' }
    }))
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(
        createElement(TachesDeLaDemande, { demande, lier, ...(sources ? { sources } : {}) })
      )
    )
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-lier"]')!.click())
    return { el, lier }
  }

  const taper = async (champ: HTMLInputElement, valeur: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(champ, valeur)
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const choisir = async (liste: HTMLSelectElement, valeur: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(liste, valeur)
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('deux sources : la liste les nomme, et la source choisie part avec le numéro', async () => {
    const { el, lier } = await ouvrirLeChamp([AZURE, GITHUB])
    const liste = el.querySelector<HTMLSelectElement>('[data-testid="tache-source"]')
    expect(liste).not.toBeNull()
    expect([...liste!.options].map((o) => o.textContent)).toEqual([AZURE.label, GITHUB.label])
    // Par défaut la première, visible : rien n'est choisi en silence.
    expect(liste!.value).toBe(AZURE.id)
    await choisir(liste!, GITHUB.id)
    await taper(el.querySelector<HTMLInputElement>('[data-testid="tache-saisie"]')!, '77')
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-valider"]')!.click())
    expect(lier).toHaveBeenCalledWith(DEMANDE, '77', GITHUB.id)
  })

  it('deux sources sans rien changer : la première part, nommée', async () => {
    const { el, lier } = await ouvrirLeChamp([AZURE, GITHUB])
    await taper(el.querySelector<HTMLInputElement>('[data-testid="tache-saisie"]')!, '12')
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-valider"]')!.click())
    expect(lier).toHaveBeenCalledWith(DEMANDE, '12', AZURE.id)
  })

  it('une seule source, ou aucune liste : pas de choix, la source reste au processus principal', async () => {
    for (const sources of [[AZURE], undefined]) {
      const { el, lier } = await ouvrirLeChamp(sources)
      expect(el.querySelector('[data-testid="tache-source"]')).toBeNull()
      await taper(el.querySelector<HTMLInputElement>('[data-testid="tache-saisie"]')!, '12')
      await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-valider"]')!.click())
      // Aucune source envoyée : le processus principal prend la seule configurée, ou refuse.
      expect(lier).toHaveBeenCalledWith(DEMANDE, '12')
    }
  })

  it('deux sources : la source déjà liée à la demande est proposée d’abord', async () => {
    const liee: DemandeDeLaCarte = {
      ...DEMANDE,
      workItems: [{ sourceId: GITHUB.id, id: '5', titre: 'X', origine: 'manuel' }]
    }
    const { el } = await ouvrirLeChamp([AZURE, GITHUB], liee)
    expect(el.querySelector<HTMLSelectElement>('[data-testid="tache-source"]')!.value).toBe(
      GITHUB.id
    )
  })
})
