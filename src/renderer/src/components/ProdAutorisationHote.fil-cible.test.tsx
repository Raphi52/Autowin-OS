// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProdAutorisationHote } from './ProdAutorisationHote'

/**
 * UNE DEMANDE D'AUTORISATION N'APPARTIENT QU'A SON FIL.
 *
 * Defaut vecu le 2026-09-16 (conv-626) : l'ecran d'autorisation a ete sorti de sa fenetre flottante
 * pour vivre DANS la conversation. Monte dans `ChatView`, il s'est alors affiche au bas de TOUTES
 * les conversations — l'utilisateur lisait, sous une discussion sans rapport, une question portant
 * sur une base de production, et pouvait l'autoriser sans en avoir le contexte.
 *
 * CE QUI EST GARDE ICI : le fil d'origine voyage avec la demande, et seul ce fil l'affiche. Le repli
 * reste OUVERT a dessein — une demande sans origine connue s'affiche partout, car un geste de
 * production bloque ne doit jamais devenir invisible faute d'etiquette.
 */
interface DemandeTest {
  id: string
  cible: string
  operation: string
  raison: string
  niveau: 'confirmation' | 'phrase'
  conversationId?: string
}

function poserApi(demandes: DemandeTest[]): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    prodAutorisationEnAttente: () => Promise.resolve(demandes),
    onProdAutorisationDemandee: () => () => {},
    onProdAutorisationClose: () => () => {},
    prodAutorisationConfirmer: vi.fn(),
    prodAutorisationAnnuler: vi.fn(),
    prodAutorisationDeposer: vi.fn(),
    /*
     * DOUBLE COMPLET, sinon le test mesure une panne de son propre montage. `ProdAutorisationHote`
     * monte `ProdPassphraseGate`, qui appelle `prodPassphraseEtat()` des son premier effet : un
     * faux `window.api` sans ces trois entrees fait echouer le rendu AVANT que la regle testee
     * (une demande n'apparait que dans SON fil) soit seulement evaluee. Memes valeurs que le double
     * du test frere `ProdAutorisationHote.test.tsx` — aucune assertion n'a ete touchee.
     */
    prodPassphraseEtat: vi.fn(async () => ({ definie: true, definieLe: 1, longueurMinimale: 12 })),
    prodPassphraseAutoriser: vi.fn(async () => ({
      accorde: true,
      jeton: 'jeton-opaque',
      expireLe: 9_999
    })),
    prodPassphraseDefinir: vi.fn(async () => ({ ok: true }))
  }
}

async function rendre(
  demandes: DemandeTest[],
  conversationId: string | null
): Promise<HTMLElement> {
  poserApi(demandes)
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const racine = createRoot(hote)
  await act(async () => {
    racine.render(<ProdAutorisationHote conversationId={conversationId} />)
  })
  return hote
}

const demande = (over: Partial<DemandeTest> = {}): DemandeTest => ({
  id: 'd1',
  cible: 'base:RIG_AMIENS',
  operation: 'sql-read',
  raison: 'Production declaree',
  niveau: 'confirmation',
  ...over
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe("l'ecran d'autorisation n'apparait que dans le fil qui l'a declenche", () => {
  it('affiche la demande dans SON fil', async () => {
    const hote = await rendre([demande({ conversationId: 'conv-626' })], 'conv-626')
    expect(hote.textContent).toContain('RIG_AMIENS')
  })

  it("n'affiche RIEN dans une autre conversation", async () => {
    const hote = await rendre([demande({ conversationId: 'conv-626' })], 'conv-999')
    expect(hote.textContent).not.toContain('RIG_AMIENS')
  })

  it('ne laisse pas une demande etrangere masquer celle du fil courant', async () => {
    const hote = await rendre(
      [
        demande({ id: 'ailleurs', cible: 'base:RIG_ANNECY', conversationId: 'conv-999' }),
        demande({ id: 'ici', cible: 'base:RIG_AMIENS', conversationId: 'conv-626' })
      ],
      'conv-626'
    )
    expect(hote.textContent).toContain('RIG_AMIENS')
    expect(hote.textContent).not.toContain('RIG_ANNECY')
  })

  it('affiche partout une demande SANS origine connue — jamais invisible', async () => {
    const hote = await rendre([demande()], 'conv-999')
    expect(hote.textContent).toContain('RIG_AMIENS')
  })
})
