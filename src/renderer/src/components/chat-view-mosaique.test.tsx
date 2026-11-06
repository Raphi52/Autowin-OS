// @vitest-environment happy-dom
/**
 * LE HOOK DE LA MOSAÏQUE SANS DÉROGATION AUX RÈGLES REACT.
 *
 * Le fichier coupait quatre règles du linter React pour lui tout entier (héritage de son extraction
 * de ChatView.tsx). Les corriger touche quatre mécanismes que rien ne testait directement ; chaque
 * cas ci-dessous nomme l'ENTRÉE qui ferait échouer une correction fausse :
 *  1. la recherche dans le CONTENU des fils : vider la recherche efface les correspondances, et
 *     aucun affichage ne montre plus les anciennes. Entrée : « abc » → « » → « x » (un calcul qui
 *     masquerait seulement les correspondances quand la recherche est vide ressortirait celles de
 *     « abc » sous « x », avant la réponse de la nouvelle recherche) ;
 *  2. la signature des saisies de la mosaïque suit l'IDENTITÉ des sources `@` : un rendu de plus
 *     avec les mêmes sources ne la change pas, de nouvelles sources la changent. Entrées : un rendu
 *     répété (compteur par rendu = faux) et un objet neuf de même contenu (mémo figé = faux) ;
 *  3. « remplir la saisie » depuis une fenêtre garde une identité STABLE et appelle la DERNIÈRE
 *     version du remplissage. Entrée : un second rendu avec un autre `setDraftInput` ;
 *  4. le rendu de la saisie d'une fenêtre garde une identité STABLE (sinon toutes les fenêtres se
 *     redessinent à chaque morceau de réponse) ET sert la saisie du rendu EN COURS à une fenêtre
 *     mémorisée qui se redessine. Entrée : un second rendu où le fil de la fenêtre devient occupé —
 *     le bouton Stop doit paraître dans CE même affichage (une version posée dans un effet
 *     arriverait après le rendu de la fenêtre, et le bouton manquerait).
 */
import { act, memo, useLayoutEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRenduMosaique, type RenduMosaiqueCtx } from './chat-view-mosaique'
import type { MentionSources } from './chat-mentions'

type Rendu = ReturnType<typeof useRenduMosaique>
type Vu = { requete: string; contenu: ReadonlyMap<string, string>; signature: string }

let vus: Vu[] = []
let dernier: Rendu | null = null

/** Note ce que CHAQUE affichage validé a montré : un rendu jeté avant l'écran ne compte pas. */
function Sonde({ ctx }: { ctx: RenduMosaiqueCtx }): null {
  const rendu = useRenduMosaique(ctx)
  useLayoutEffect(() => {
    dernier = rendu
    vus.push({
      requete: ctx.convQuery,
      contenu: rendu.correspondancesContenu,
      signature: rendu.signatureComposerMosaique
    })
  })
  return null
}

const sourcesVides = (): MentionSources => ({}) as MentionSources

/** Les refs de ChatView viennent de `useRef` : les MÊMES objets d'un rendu à l'autre. */
let refs: Pick<
  RenduMosaiqueCtx,
  'busyConversationsRef' | 'composerDraftKeyRef' | 'composerRef' | 'sendRef' | 'submitBtwRef'
>

function ctxDeBase(sur: Partial<RenduMosaiqueCtx> = {}): RenduMosaiqueCtx {
  return {
    ...refs,
    activeId: null,
    addFiles: vi.fn(async () => {}),
    autoConvs: new Set(),
    basculerModeAutoPour: vi.fn(),
    busy: false,
    busyConversations: new Set(),
    conversationDateOrder: 'desc',
    convQuery: '',
    convs: [],
    depotPresent: true,
    draftsVersion: 0,
    fermerFenetreMosaique: vi.fn(),
    getComposerDraft: () => ({ input: '', attachments: [], error: null }),
    interruptingConversations: new Set(),
    mentionSources: sourcesVides(),
    messages: [],
    mosaicFils: {},
    mosaicIds: [],
    nouvelleFenetreMosaique: vi.fn(async () => {}),
    ouvrirDansMosaique: vi.fn(async () => {}),
    ouvrirSeuleDepuisMosaique: vi.fn(async () => {}),
    refreshConvs: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    setDraftAttachments: vi.fn(),
    setDraftInput: vi.fn(),
    setOpenImage: vi.fn(),
    skillCommands: [],
    stopPilotTurn: vi.fn(),
    submitBtw: vi.fn(async () => {}),
    ...sur
  }
}

let hote: HTMLDivElement
let racine: Root

function afficher(ctx: RenduMosaiqueCtx): void {
  act(() => racine.render(<Sonde ctx={ctx} />))
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vus = []
  dernier = null
  refs = {
    busyConversationsRef: { current: new Set() },
    composerDraftKeyRef: { current: 'brouillon-neuf' },
    composerRef: { current: null },
    sendRef: { current: vi.fn(async () => {}) },
    submitBtwRef: { current: vi.fn() }
  }
  // Pont minimal : la copie des dossiers vers le Board (dossiers-du-chat.ts) n'a rien à faire ici.
  Object.assign(window, { api: {} })
  window.localStorage.clear()
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'api')
})

describe('useRenduMosaique — recherche dans le contenu des fils', () => {
  it('vider la recherche efface les correspondances, et aucun affichage ne ressort les anciennes', async () => {
    vi.useFakeTimers()
    const chercher = vi.fn((terme: string) =>
      terme === 'abc'
        ? Promise.resolve([{ id: 'conv-1', extrait: '… abc …' }])
        : new Promise<{ id: string; extrait: string }[]>(() => {})
    )
    Object.assign(window, { api: { conversationsSearchContent: chercher } })

    afficher(ctxDeBase({ convQuery: 'abc' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(chercher).toHaveBeenCalledWith('abc')
    expect(dernier?.correspondancesContenu.get('conv-1')).toBe('… abc …')

    vus = []
    afficher(ctxDeBase({ convQuery: '' }))
    expect(vus.length).toBeGreaterThan(0)
    for (const vu of vus) expect([...vu.contenu.keys()], `requête « ${vu.requete} »`).toEqual([])

    // La nouvelle recherche n'a pas encore répondu (anti-rebond de 160 ms, réponse jamais rendue) :
    // rien de « abc » ne doit réapparaître sous « x ».
    vus = []
    afficher(ctxDeBase({ convQuery: 'x' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(chercher).toHaveBeenCalledWith('x')
    for (const vu of vus) expect([...vu.contenu.keys()], `requête « ${vu.requete} »`).toEqual([])
  })
})

describe('useRenduMosaique — signature des saisies de la mosaïque', () => {
  it('suit l’identité des sources @ : stable sur un rendu de plus, neuve pour de nouvelles sources', () => {
    const a = sourcesVides()
    afficher(ctxDeBase({ mentionSources: a }))
    const premiere = dernier?.signatureComposerMosaique
    afficher(ctxDeBase({ mentionSources: a }))
    expect(dernier?.signatureComposerMosaique).toBe(premiere)

    const b = sourcesVides()
    afficher(ctxDeBase({ mentionSources: b }))
    const apresB = dernier?.signatureComposerMosaique
    expect(apresB).not.toBe(premiere)
    afficher(ctxDeBase({ mentionSources: b }))
    expect(dernier?.signatureComposerMosaique).toBe(apresB)

    // Le compteur des brouillons et le nombre de commandes `/` restent dans la signature.
    afficher(ctxDeBase({ mentionSources: b, draftsVersion: 3 }))
    expect(dernier?.signatureComposerMosaique).not.toBe(apresB)
  })
})

describe('useRenduMosaique — remplir la saisie d’une fenêtre', () => {
  it('garde une identité stable et appelle la dernière version du remplissage', () => {
    const premier = vi.fn()
    afficher(ctxDeBase({ setDraftInput: premier }))
    const remplirAvant = dernier?.remplirSaisieMosaique
    const repondreAvant = dernier?.repondreAskMosaiqueStable

    const second = vi.fn()
    afficher(ctxDeBase({ setDraftInput: second }))
    expect(dernier?.remplirSaisieMosaique).toBe(remplirAvant)
    expect(dernier?.repondreAskMosaiqueStable).toBe(repondreAvant)

    act(() => dernier?.remplirSaisieMosaique('Affiner la 2', 'conv-9'))
    expect(second).toHaveBeenCalledWith('conv-9', 'Affiner la 2')
    expect(premier).not.toHaveBeenCalled()
  })
})

/** Une fenêtre mémorisée comme celles de ChatMosaic : elle ne se redessine que si SES props changent. */
const FenetreSonde = memo(function FenetreSonde({
  id,
  occupe,
  rendre
}: {
  id: string
  occupe: boolean
  rendre: (id: string) => ReactNode
}): ReactNode {
  return (
    <div data-testid="fenetre" data-occupe={occupe}>
      {rendre(id)}
    </div>
  )
})

function SondeAvecFenetre({ ctx }: { ctx: RenduMosaiqueCtx }): ReactNode {
  const rendu = useRenduMosaique(ctx)
  useLayoutEffect(() => {
    dernier = rendu
  })
  return (
    <FenetreSonde
      id="conv-9"
      occupe={ctx.busyConversations.has('conv-9')}
      rendre={rendu.rendreComposerStable}
    />
  )
}

describe('useRenduMosaique — saisie d’une fenêtre de la mosaïque', () => {
  it('garde une identité stable et sert la saisie du rendu en cours', () => {
    act(() => racine.render(<SondeAvecFenetre ctx={ctxDeBase({ mosaicIds: ['conv-9'] })} />))
    const rendreAvant = dernier?.rendreComposerStable
    expect(hote.querySelector('[data-testid="composer-send"]')).not.toBeNull()
    expect(hote.querySelector('[data-testid="composer-stop"]')).toBeNull()

    const occupe = ctxDeBase({ mosaicIds: ['conv-9'], busyConversations: new Set(['conv-9']) })
    act(() => racine.render(<SondeAvecFenetre ctx={occupe} />))
    expect(dernier?.rendreComposerStable).toBe(rendreAvant)
    expect(hote.querySelector('[data-testid="composer-stop"]')).not.toBeNull()
  })
})
