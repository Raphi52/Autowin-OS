// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * CARTE DU FIL, DE BOUT EN BOUT (conv-1059, 2026-10-22) — à la place du carnet (conv-1038).
 *
 * Demande : « une ligne de métro en haut du fil, une étape par demande, une couleur selon le
 * résultat prouvé (vert, refusé, en cours, à venir), un repère « tu étais là » à la place de la
 * carte « Pendant ton absence », un clic sur une étape qui ramène au message ».
 *
 * Les entrées qui font échouer une version fausse : une étape VÉRIFIÉE et une étape finie SANS
 * vérification (elles ne peuvent pas avoir la même couleur) ; un fil déjà vu (aucun repère) ; un
 * clic qui ne ramènerait pas au BON message (deux demandes, on clique la première).
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const CLOTURE = ['Réponse.', '', '✅ Fait', '1. la carte', '👉 Recommandé', 'Lancer le juge.'].join(
  '\n'
)

const fil = (): Record<string, unknown> => ({
  id: 'A',
  title: 'A',
  provider: 'codex',
  updatedAt: 3_000,
  messages: [
    { role: 'user', content: 'construis la carte', ts: 1_000, messageId: 'm1' },
    {
      role: 'assistant',
      content: 'vérifié',
      ts: 1_100,
      messageId: 'm2',
      turnId: 't1',
      status: 'completed',
      parts: [
        { kind: 'text', text: 'vérifié' },
        {
          kind: 'action',
          name: 'verify',
          ok: true,
          data: { command: 'npm test', exitCode: 0, ok: true }
        }
      ]
    },
    { role: 'user', content: 'explique la couleur', ts: 2_000, messageId: 'm3' },
    {
      role: 'assistant',
      content: CLOTURE,
      ts: 2_100,
      messageId: 'm4',
      turnId: 't2',
      status: 'completed',
      parts: [{ kind: 'text', text: CLOTURE }]
    }
  ]
})

describe('ChatView — carte du fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null

  async function ouvrir(vues: Record<string, number>): Promise<void> {
    window.localStorage.setItem('autowin.conversations.vues', JSON.stringify(vues))
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue([fil()]),
      conversation: vi.fn(async () => fil()),
      conversationFileTraces: vi
        .fn()
        .mockResolvedValue([
          { timestamp: new Date(2_500).toISOString(), conversationId: 'A', paths: ['src/x.ts'] }
        ])
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
    await attendre()
  }

  async function attendre(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const carte = (): HTMLElement | null =>
    h!.container.querySelector('[data-origine="carte-du-fil"]')
  const stations = (): HTMLElement[] => [
    ...carte()!.querySelectorAll<HTMLElement>('.carte-station')
  ]

  beforeEach(() => window.localStorage.clear())
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  it('une station par demande, colorée par la preuve, puis l’étape à venir', async () => {
    await ouvrir({ A: 3_000 })
    expect(h!.container.querySelector('[data-origine="carnet-du-fil"]')).toBeNull()
    expect(stations().map((station) => station.getAttribute('data-statut'))).toEqual([
      'prouve',
      'sans-preuve',
      'a-venir'
    ])
    expect(stations()[0].textContent).toContain('construis la carte')
    expect(stations()[2].textContent).toContain('Lancer le juge.')
    // Le bilan de l'en-tête (« Tout ensemble », conv-1088) : un compte par couleur présente.
    expect(carte()!.querySelector('[data-testid="carte-compte"]')?.textContent).toBe(
      '1 prouvée · 1 sans preuve'
    )
  })

  // « Tout ensemble » (/draft conv-1088) : le CLIC ouvre la fiche sous la ligne ; un second clic sur
  // le même point, ou Échap, la referme. Le survol ne détaille plus rien.
  it('cliquer une station ouvre sa fiche : sa preuve et ses fichiers ; re-cliquer ou Échap la ferme', async () => {
    await ouvrir({ A: 3_000 })
    const fiche = (): Element | null => carte()!.querySelector('[data-testid="carte-fiche"]')
    const point = (): HTMLButtonElement =>
      stations()[1].querySelector<HTMLButtonElement>('.carte-point')!
    await act(async () => point().click())
    expect(fiche()?.textContent).toContain('sans preuve — fini sans vérification')
    expect(fiche()?.textContent).toContain('x.ts')
    expect(stations()[1].getAttribute('data-choisie')).toBe('oui')
    await act(async () => point().click())
    expect(fiche()).toBeNull()
    await act(async () => point().click())
    await act(async () => {
      point().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(fiche()).toBeNull()
  })

  // « enlève le texte : tu étais là » (conv-1059, 2026-10-22) : le repère reste, réduit à sa flèche ;
  // ni la station ni son détail n'écrivent plus ces mots.
  it('un fil NON LU pose le repère ▼ sur la dernière étape vue, sans le texte « tu étais là »', async () => {
    await ouvrir({ A: 1_500 })
    const repere = carte()!.querySelector('[data-testid="carte-repere"]')
    expect(repere?.textContent).toBe('▼')
    expect(repere?.closest('.carte-station')?.textContent).toContain('construis la carte')
    expect(stations()[1].getAttribute('data-nouvelle')).toBe('oui')
    const point = stations()[0].querySelector<HTMLButtonElement>('.carte-point')!
    expect(point.getAttribute('aria-label')).toContain(
      'depuis ton passage : 1 tour fini · 1 fichier modifié'
    )
    await act(async () => point.click())
    const fiche = carte()!.querySelector('[data-testid="carte-fiche"]')
    expect(fiche?.textContent).toContain('depuis ton passage : 1 tour fini')
    expect(carte()!.textContent).not.toContain('tu étais là')
    expect(h!.container.textContent).not.toContain('Pendant ton absence')
  })

  it('un fil déjà vu n’a aucun repère', async () => {
    await ouvrir({ A: 3_000 })
    expect(carte()!.querySelector('[data-testid="carte-repere"]')).toBeNull()
  })

  it('« aller au message » de la fiche ramène le fil à SON message, qui s’allume', async () => {
    await ouvrir({ A: 3_000 })
    const defilement = vi.fn()
    Element.prototype.scrollIntoView = defilement
    await act(async () => stations()[0].querySelector<HTMLButtonElement>('.carte-point')!.click())
    expect(defilement).not.toHaveBeenCalled()
    await act(async () => carte()!.querySelector<HTMLButtonElement>('.carte-fiche-aller')!.click())
    await attendre()
    expect(defilement).toHaveBeenCalledTimes(1)
    const cible = defilement.mock.instances[0] as unknown as HTMLElement
    expect(cible.getAttribute('data-message-id')).toBe('m1')
    expect(cible.classList.contains('is-cible-carte')).toBe(true)
  })
})

/**
 * LE DÉTAIL D'UNE ÉTAPE EST OPAQUE (conv-1059, 2026-10-22 : « quand je click sur un node faut pas un
 * fond transparent sur le détail sinon on voit rien »). Cause : `background: var(--s3, var(--s2))`.
 * `--s2`/`--s3` sont des ESPACEMENTS (8px, 12px — theme.css), pas des couleurs : la déclaration est
 * rejetée et le détail, posé PAR-DESSUS le fil, devient transparent. Même défaut que la barre de
 * passage (conv-1051, fa9028b7) : le fond opaque de chaque thème est `--bg-0`.
 */
describe('CarteDuFil.css — un fond se peint avec une couleur, pas un espacement', () => {
  // Sans les commentaires : ils CITENT le défaut pour l'expliquer, ils ne le peignent pas.
  const css = readFileSync('src/renderer/src/components/CarteDuFil.css', 'utf8').replace(
    /\/\*[\s\S]*?\*\//gu,
    ''
  )

  it('la fiche d’une étape a le fond opaque du thème', () => {
    const regle = /\.carte-fiche\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(regle).toMatch(/background:\s*var\(--bg-0\)/u)
  })

  it('aucun fond de la carte ne lit une variable d’espacement (--s1, --s2, --s3…)', () => {
    expect(css).not.toMatch(/background(?:-color)?:[^;]*var\(--s\d/u)
  })
})

/**
 * LE MOUVEMENT DE LA CARTE SE VOIT SUR CE POSTE (conv-1088, 2026-10-22, preuve image par image).
 * Deux défauts mesurés sur l'app vivante : (1) les tirets de l'étape en cours étaient posés sur un
 * tronçon au fond rose PLEIN — leurs creux montraient du rose, rail uni, 0 % de pixels changés ;
 * (2) une garde `prefers-reduced-motion` coupait remplissage, tirets et ▼ — or ce poste a le
 * réglage actif (`animation: none` lu partout) : l'utilisateur ne les aurait jamais vus.
 */
describe('CarteDuFil.css — le mouvement de l’étape en cours se voit', () => {
  const css = readFileSync('src/renderer/src/components/CarteDuFil.css', 'utf8').replace(
    /\/\*[\s\S]*?\*\//gu,
    ''
  )

  it('le tronçon qui porte les tirets n’a pas de fond plein dessous', () => {
    const regle =
      /\.carte-station\[data-statut='en-cours'\] \.is-avant\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(regle).toMatch(/background:\s*transparent/u)
  })

  it('aucune garde « mouvement réduit » ne fige la carte', () => {
    expect(css).not.toMatch(/prefers-reduced-motion/u)
  })
})
