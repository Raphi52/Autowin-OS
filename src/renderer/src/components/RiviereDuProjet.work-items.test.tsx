// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  ResultatDuRattachement
} from '../../../shared/carte-des-besoins'
import { RiviereDuProjet } from './RiviereDuProjet'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'

/**
 * LA FICHE D'UN POST-IT MONTRE LA TASK DE CHAQUE DEMANDE (option E du cadrage conv-1127).
 *
 * Les entrées qui font échouer une version fausse : une demande liée dont la fiche ne montre ni le
 * numéro ni le titre ; une demande sans lien qui ne dit pas « sans task » ; un rattachement qui
 * n'envoie pas la bonne demande ou le numéro tapé ; un refus de la source avalé en silence ; un
 * lien hérité qu'on pourrait « détacher » alors qu'il n'est pas posé sur cette demande.
 */

const MAINTENANT = new Date(2026, 9, 23, 15, 0).getTime()
const HEURE = 3_600_000

const demande = (rang: number, extra: Partial<DemandeDeLaCarte> = {}): DemandeDeLaCarte => ({
  conversationId: 'conv-1',
  conversationTitre: 'Fil conv-1',
  rang,
  messageId: `m${rang}`,
  titre: `demande ${rang}`,
  statut: 'prouve',
  constat: 'npm test → exit 0',
  debut: MAINTENANT - (5 - rang) * HEURE,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' },
  ...extra
})

function carte(demandes: DemandeDeLaCarte[]): CarteDesBesoins {
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 1,
    demandes,
    runsBloques: [],
    comptes: { prouve: demandes.length, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 1,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: demandes.length }],
    demandesJournalisees: demandes.length,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

const DONNEES = carte([
  demande(0, {
    workItems: [
      { sourceId: 'azure:s', id: '1234', titre: 'Corriger X', type: 'Task', origine: 'tickets' }
    ]
  }),
  demande(2, {
    besoin: { nature: 'suite' },
    workItems: [
      { sourceId: 'azure:s', id: '1234', titre: 'Corriger X', origine: 'tickets', herite: true }
    ]
  }),
  demande(4)
])

describe('RiviereDuProjet — task de chaque demande', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  beforeEach(() => {
    window.localStorage.removeItem(CLE_ETATS_MANUELS_CARTE)
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  async function ouvrirLaFiche(
    lierWorkItem = vi.fn(async (): Promise<ResultatDuRattachement> => ({
      ok: true,
      workItem: { sourceId: 'azure:s', id: '5678', titre: 'Y', origine: 'manuel' }
    })),
    delierWorkItem = vi.fn(async () => undefined)
  ) {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(
        createElement(RiviereDuProjet, {
          carte: DONNEES,
          ouvrir: vi.fn(),
          lierWorkItem,
          delierWorkItem
        })
      )
    )
    const postit = el.querySelector('[data-conversation="conv-1"]') as HTMLElement
    await act(async () => postit.click())
    const lignes = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-fiche-demande"]')]
    return { el, lignes, lierWorkItem, delierWorkItem }
  }

  const taper = async (champ: HTMLInputElement, valeur: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(champ, valeur)
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('montre le numéro et le titre de la task liée, « hérité » pour une suite, « sans task » sinon', async () => {
    const { lignes } = await ouvrirLaFiche()
    expect(lignes).toHaveLength(3)
    const [liee, suite, seule] = lignes
    const puce = liee.querySelector('[data-testid="tache"]') as HTMLElement
    expect(puce.textContent).toContain('#1234')
    expect(puce.textContent).toContain('Corriger X')
    expect(puce.dataset.origine).toBe('tickets')
    expect(suite.querySelector('[data-testid="tache"]')?.getAttribute('data-herite')).toBe('1')
    // Un lien hérité n'est pas posé sur cette demande : rien à détacher ici.
    expect(suite.querySelector('[data-testid="tache-detacher"]')).toBeNull()
    expect(seule.querySelector('[data-testid="tache"]')).toBeNull()
    expect(seule.querySelector('[data-testid="tache-sans"]')?.textContent).toBe('sans task')
  })

  it('rattacher : la demande visée et le numéro tapé partent, le champ se referme au succès', async () => {
    const { lignes, lierWorkItem } = await ouvrirLaFiche()
    const seule = lignes[2]
    await act(async () =>
      (seule.querySelector('[data-testid="tache-lier"]') as HTMLElement).click()
    )
    const champ = seule.querySelector('[data-testid="tache-saisie"]') as HTMLInputElement
    await taper(champ, '#5678')
    await act(async () =>
      (seule.querySelector('[data-testid="tache-valider"]') as HTMLElement).click()
    )
    expect(lierWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm4', rang: 4 }),
      '#5678'
    )
    expect(seule.querySelector('[data-testid="tache-saisie"]')).toBeNull()
  })

  it('un refus de la source est affiché en clair, le champ reste ouvert', async () => {
    const refus = vi.fn(async (): Promise<ResultatDuRattachement> => ({
      ok: false,
      raison: 'La fiche 999 n’existe pas dans contoso / projet.'
    }))
    const { lignes } = await ouvrirLaFiche(refus)
    const seule = lignes[2]
    await act(async () =>
      (seule.querySelector('[data-testid="tache-lier"]') as HTMLElement).click()
    )
    await taper(seule.querySelector('[data-testid="tache-saisie"]') as HTMLInputElement, '999')
    await act(async () =>
      (seule.querySelector('[data-testid="tache-valider"]') as HTMLElement).click()
    )
    expect(seule.querySelector('[data-testid="tache-erreur"]')?.textContent).toContain(
      'n’existe pas'
    )
    expect(seule.querySelector('[data-testid="tache-saisie"]')).not.toBeNull()
  })

  it('détacher une task posée sur la demande envoie la demande et la fiche', async () => {
    const { lignes, delierWorkItem } = await ouvrirLaFiche()
    await act(async () =>
      (lignes[0].querySelector('[data-testid="tache-detacher"]') as HTMLElement).click()
    )
    expect(delierWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm0' }),
      expect.objectContaining({ id: '1234', sourceId: 'azure:s' })
    )
  })
})
