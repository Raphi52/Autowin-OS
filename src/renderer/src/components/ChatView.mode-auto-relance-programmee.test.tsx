// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DELAI_SONDAGE_FIL } from './chat-auto-mode'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * conv-826 (2026-09-24) : « faudrait que le mode auto gère ce cas au lieu de s'arrêter ». Une suite
 * qui ne peut partir qu'à un moment précis (« dans 20 min ») est PROGRAMMÉE, puis envoyée seule.
 * Le délai réel (20 min) est raccourci ici : seuls les minuteurs longs (≥ 60 s) sont accélérés.
 */
const cloture = (suite: string): string =>
  ['✅ Fait', '1. Le tournoi tourne.', `👉 Recommandé : ${suite}`].join('\n')
const SUITE = 'relever les résultats du tournoi dans 20 min.'

function accelererLesLongsMinuteurs(seuil = 60_000): void {
  const vrai = window.setTimeout.bind(window)
  vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
    vrai(fn, (ms ?? 0) >= seuil ? 150 : ms)) as typeof window.setTimeout)
}
/**
 * conv-1069 : rejoue le PIRE cas d'une machine chargée, à chaque passage. La sonde d'un fil se
 * reprogramme à `Date.now() + DELAI_SONDAGE_FIL`, puis le minuteur s'arme sur
 * `echeance - Date.now()` : une milliseconde écoulée entre les deux donne 59 999 ms. Mesuré :
 * rouge 1 fois sur 3 sous charge (`expected +0 to be 1`), la sonde suivante attendant alors une
 * VRAIE minute.
 */
function faireAvancerLHorlogeAChaqueLecture(): void {
  const reel = Date.now.bind(Date)
  let derive = 0
  vi.spyOn(Date, 'now').mockImplementation(() => reel() + ++derive)
}
const attendre = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
/** Attend un ÉVÉNEMENT (sonde répondue, envoi reçu), borné : une durée fixe rougit sous charge. */
async function attendreQue(condition: () => boolean, limiteMs = 5_000): Promise<void> {
  // `performance.now` et non `Date.now`, que `faireAvancerLHorlogeAChaqueLecture` fait dériver.
  const fin = performance.now() + limiteMs
  while (!condition()) {
    if (performance.now() > fin) throw new Error(`condition non atteinte en ${limiteMs} ms`)
    await attendre(25)
  }
}
const envoisDe = (pilotChat: ReturnType<typeof vi.fn>, depuis: number): number =>
  pilotChat.mock.calls.slice(depuis).filter((c) => JSON.stringify(c).includes(SUITE)).length

describe('ChatView — une suite différée est programmée, pas abandonnée', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function monter(): Promise<{
    pilotChat: ReturnType<typeof vi.fn>
    pilote: (e: Record<string, unknown>) => void
  }> {
    const base = [{ role: 'user', content: 'salut' }, { role: 'assistant', content: cloture('lancer terrain.') }]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', base), conversation('B', base)]),
        conversation: vi.fn(async (id: string) => conversation(id, base)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { pilotChat, pilote: (e) => pilote(e) }
  }
  const terminer = async (
    pilote: (e: Record<string, unknown>) => void,
    id: string
  ): Promise<void> => {
    await act(async () =>
      pilote({ conversationId: id, kind: 'delta', text: cloture(SUITE), streamId: 's1' })
    )
    await act(async () => pilote({ conversationId: id, kind: 'done' }))
  }

  it('fil affiché : annonce l’attente, puis envoie la suite UNE seule fois à l’échéance', async () => {
    const { pilotChat, pilote } = await monter()
    await h!.click('.conv-item .conv-pick')
    await h!.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await terminer(pilote, 'A')
    await attendre(5)
    expect(envoisDe(pilotChat, avant)).toBe(0)
    expect(h!.container.textContent).toContain('Je la relance seul')
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(1)
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(1)
  })

  it('la relance programmée survit à un changement de conversation', async () => {
    const { pilotChat, pilote } = await monter()
    const items = () => document.querySelectorAll<HTMLElement>('.conv-item .conv-pick')
    await act(async () => items()[1].click())
    await h!.click('[data-testid="composer-auto-toggle"]')
    await act(async () => items()[0].click())
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await terminer(pilote, 'B')
    await attendre(5)
    expect(envoisDe(pilotChat, avant)).toBe(0)
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(1)
    expect(JSON.stringify(pilotChat.mock.calls.at(-1))).toContain('"B"')
  })

  it('éteindre ∞ pendant l’attente annule la relance', async () => {
    const { pilotChat, pilote } = await monter()
    await h!.click('.conv-item .conv-pick')
    await h!.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await terminer(pilote, 'A')
    await attendre(5)
    await h!.click('[data-testid="composer-auto-toggle"]')
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(0)
  })
})

/**
 * conv-826 (2026-09-24) : « quand fin.txt existe » — le mode auto sonde le fichier (lecture seule,
 * processus principal) AVANT de payer un tour : absent → aucun envoi, présent → un envoi.
 */
describe('ChatView — suite « quand X existe » : sonde gratuite avant le tour', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })
  const SUITE_FICHIER = 'quand fin.txt existe, relever les résultats du tournoi.'

  it('fichier absent ou réponse inconnue (null) : aucun tour payé ; présent : la suite part une fois', async () => {
    // conv-826, 14:38:57 : tout ce qui n'était pas `false` payait un tour. `null` doit attendre aussi.
    let present: boolean | null = null
    const fichierExiste = vi.fn(async () => present)
    const base = [{ role: 'user', content: 'salut' }, { role: 'assistant', content: cloture('lancer terrain.') }]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        pilotChat,
        fichierExiste,
        conversations: vi.fn().mockResolvedValue([conversation('A', base)]),
        conversation: vi.fn(async (id: string) => conversation(id, base)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    const envois = (depuis: number): number =>
      pilotChat.mock.calls.slice(depuis).filter((c) => JSON.stringify(c).includes('fin.txt')).length
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'delta', text: cloture(SUITE_FICHIER), streamId: 's1' })
    )
    await act(async () => pilote({ conversationId: 'A', kind: 'done' }))
    await attendre(400)
    expect(fichierExiste).toHaveBeenCalledWith('fin.txt', undefined)
    expect(envois(avant)).toBe(0)
    present = false
    await attendre(400)
    expect(envois(avant)).toBe(0)
    present = true
    await attendre(400)
    expect(envois(avant)).toBe(1)
  })
  it('fichier toujours absent après 48 h : arrêt annoncé, aucun tour payé', async () => {
    const fichierExiste = vi.fn(async () => false)
    const base = [{ role: 'user', content: 'salut' }, { role: 'assistant', content: cloture('lancer terrain.') }]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        pilotChat,
        fichierExiste,
        conversations: vi.fn().mockResolvedValue([conversation('A', base)]),
        conversation: vi.fn(async (id: string) => conversation(id, base)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'delta', text: cloture(SUITE_FICHIER), streamId: 's1' })
    )
    await act(async () => pilote({ conversationId: 'A', kind: 'done' }))
    await attendre(250)
    expect(fichierExiste).toHaveBeenCalled()
    // Le temps saute de 49 h : la prochaine sonde dépasse la borne.
    const reel = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => reel() + 49 * 3_600_000)
    await attendre(400)
    const sondes = fichierExiste.mock.calls.length
    await attendre(400)
    expect(fichierExiste.mock.calls.length).toBe(sondes)
    expect(h.container.ownerDocument.body.textContent).toContain(
      "fin.txt n'existe toujours pas après 48 h de vérification"
    )
    expect(
      pilotChat.mock.calls.slice(avant).filter((c) => JSON.stringify(c).includes('fin.txt')).length
    ).toBe(0)
  })

  /*
   * conv-1069, candidat 3 : sur conv-1065, « conv-N a-t-il fini ? » est partie 5 fois (2 tours payés
   * pour lire « pas terminé »), fin vue avec 51 min de retard. La suite attend désormais la fin du
   * fil nommé par une sonde GRATUITE (`pilotChatActive`, l'autorité du processus principal).
   * L'entrée qui ferait échouer ce test si la correction était fausse : l'autre fil encore actif —
   * une suite envoyée tout de suite paierait un tour pour constater qu'il tourne.
   * fix-ok: conv-1069 — rouge sur le code d'origine (ef5762bf : la suite n'attendait pas la fin du
   * fil), vert avec la sonde `pilotChatActive`. Instabilité (1 rouge sur 3, juge) : délai de sonde
   * raboté à 59 999 ms par 1 ms écoulée, sous le seuil d'accélération 60 000 — rouge 3/3 avec
   * l'horloge qui dérive, vert avec le seuil DELAI_SONDAGE_FIL / 2 et des attentes d'événement.
   */
  it('« quand le tour de conv-N est terminé » : aucun tour payé tant qu’il tourne, puis UN envoi', async () => {
    const SUITE_FIL = 'quand le tour de conv-1065 est terminé, relis sa conclusion.'
    let actif: boolean | undefined = true
    const pilotChatActive = vi.fn(async () => (actif === undefined ? undefined : { active: actif }))
    const base = [
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: cloture('lancer terrain.') }
    ]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        pilotChat,
        pilotChatActive,
        conversations: vi.fn().mockResolvedValue([conversation('A', base)]),
        conversation: vi.fn(async (id: string) => conversation(id, base)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    const envois = (depuis: number): number =>
      pilotChat.mock.calls.slice(depuis).filter((c) => JSON.stringify(c).includes('conv-1065'))
        .length
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    // Sous le délai de sonde (DELAI_SONDAGE_FIL = 60 000) : la dérive de l'horloge le rabote.
    accelererLesLongsMinuteurs(DELAI_SONDAGE_FIL / 2)
    faireAvancerLHorlogeAChaqueLecture()
    const avant = pilotChat.mock.calls.length
    // Les sondes du fil ATTENDU seulement : `send` interroge aussi le fil qui envoie
    // (`tourEncoreVivant`, antérieur à ce travail), ce qui n'est pas une attente.
    const sondes = (): number =>
      pilotChatActive.mock.calls.filter((c: unknown[]) => c[0] === 'conv-1065').length
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'delta', text: cloture(SUITE_FIL), streamId: 's1' })
    )
    await act(async () => pilote({ conversationId: 'A', kind: 'done' }))
    // Deux sondes « il tourne » RÉPONDUES (la 2e n'est armée qu'après la 1re) : toujours rien payé.
    await attendreQue(() => sondes() >= 2)
    expect(pilotChatActive).toHaveBeenCalledWith('conv-1065')
    expect(envois(avant)).toBe(0)
    // Réponse inconnue : ne prouve rien, ne paie donc pas de tour.
    actif = undefined
    const avantInconnu = sondes()
    await attendreQue(() => sondes() >= avantInconnu + 2)
    expect(envois(avant)).toBe(0)
    actif = false
    await attendreQue(() => envois(avant) >= 1)
    const sondesALEnvoi = sondes()
    await attendre(400)
    // UNE seule fois : ni second envoi, ni sonde qui continuerait après la fin du fil.
    expect(envois(avant)).toBe(1)
    expect(sondes()).toBe(sondesALEnvoi)
  })
})
