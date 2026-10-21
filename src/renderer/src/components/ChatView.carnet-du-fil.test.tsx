// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * CARNET VIVANT DU FIL, DE BOUT EN BOUT (conv-1038, 2026-10-21). Le panneau replié en haut du fil
 * relit la dernière demande, la dernière clôture, ce que l'agent a retenu et les fichiers touchés.
 * Barrer ou corriger une ligne pose une correction dans la saisie, SANS envoyer ; barrer un fait
 * retenu le retire aussi de la mémoire de l'agent. Au retour sur un fil non lu, une carte « Pendant
 * ton absence » dit ce qui s'est passé.
 *
 * Les entrées qui font échouer une version fausse : un brouillon DÉJÀ tapé (la correction s'ajoute,
 * elle n'écrase pas) ; un fil déjà vu (aucune carte d'absence) ; un fait barré qui resterait dans la
 * mémoire de l'agent ; un OUBLI QUI ÉCHOUE (canal en erreur, ou absent d'un pont d'avant
 * redémarrage) — la version d'origine l'avalait (`.catch(() => undefined)`) : la ligne paraissait
 * barrée et l'utilisateur croyait l'agent délesté d'un fait qu'il relisait encore.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const CLOTURE = [
  'Réponse.',
  '',
  '✅ Fait',
  '- notification de fin de tour',
  '⏳ Reste à faire',
  '- idée 6',
  '👉 Recommandé : lancer le juge'
].join('\n')

const fil = (updatedAt = 2_000): Record<string, unknown> => ({
  id: 'A',
  title: 'A',
  provider: 'codex',
  updatedAt,
  messages: [
    { role: 'user', content: 'construis les sept idées', ts: 1_000, messageId: 'm1' },
    {
      role: 'assistant',
      content: CLOTURE,
      ts: 1_500,
      messageId: 'm2',
      turnId: 't1',
      status: 'completed',
      parts: [{ kind: 'text', text: CLOTURE }]
    }
  ]
})

describe('ChatView — carnet vivant du fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>

  // `options.oublier` PRÉSENT mais `undefined` = canal absent (un paramètre par défaut l'aurait remplacé).
  async function ouvrir(
    vues: Record<string, number> = { A: 2_000 },
    options: { oublier?: unknown; memoire?: unknown } = {}
  ): Promise<void> {
    window.localStorage.setItem('autowin.conversations.vues', JSON.stringify(vues))
    api = chatApi({
      conversations: vi.fn().mockResolvedValue([fil()]),
      conversation: vi.fn(async () => fil()),
      conversationMemoire:
        options.memoire ??
        vi.fn().mockResolvedValue([{ title: 'Décision A', body: 'on part sur A' }]),
      conversationOublierFait:
        'oublier' in options ? options.oublier : vi.fn().mockResolvedValue(true),
      conversationFileTraces: vi
        .fn()
        .mockResolvedValue([
          { timestamp: new Date(1_600).toISOString(), conversationId: 'A', paths: ['src/x.ts'] }
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

  function carnet(): HTMLElement | null {
    return h!.container.querySelector('[data-origine="carnet-du-fil"]')
  }

  function ligne(texte: string): HTMLElement {
    const trouvee = [...carnet()!.querySelectorAll<HTMLElement>('.carnet-ligne')].find((li) =>
      li.textContent?.includes(texte)
    )
    if (!trouvee) throw new Error(`ligne absente : ${texte}`)
    return trouvee
  }

  async function deplier(): Promise<void> {
    const bascule = carnet()!.querySelector<HTMLButtonElement>('.carnet-bascule')!
    if (bascule.getAttribute('aria-expanded') !== 'true') {
      await act(async () => bascule.click())
      await attendre()
    }
  }

  beforeEach(() => window.localStorage.clear())
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  it('replié par défaut, il relit la clôture, la mémoire et les fichiers une fois déplié', async () => {
    await ouvrir()
    expect(carnet()).not.toBeNull()
    expect(carnet()!.querySelector('.carnet-bascule')?.getAttribute('aria-expanded')).toBe('false')
    await deplier()
    expect(ligne('idée 6').getAttribute('data-rubrique')).toBe('reste')
    expect(ligne('lancer le juge').getAttribute('data-rubrique')).toBe('recommande')
    expect(ligne('Décision A').getAttribute('data-rubrique')).toBe('retenu')
    expect(ligne('src/x.ts').getAttribute('data-rubrique')).toBe('fichier')
    expect(api.conversationMemoire).toHaveBeenCalledWith('A')
  })

  it('barrer une ligne pose la correction APRÈS le brouillon déjà tapé, sans rien envoyer', async () => {
    await ouvrir()
    await deplier()
    await h!.type('mon brouillon')
    await act(async () =>
      ligne('idée 6').querySelector<HTMLButtonElement>('[aria-label="Barrer cette ligne"]')!.click()
    )
    await attendre()
    expect(h!.textarea().value).toBe(
      'mon brouillon\n\nCarnet du fil — à oublier (Reste à faire) : « idée 6 ». Ce n’est plus vrai : ne t’appuie plus dessus.'
    )
    expect(ligne('idée 6').classList.contains('is-barree')).toBe(true)
    expect(api.pilotChat).not.toHaveBeenCalled()
    expect(api.conversationOublierFait).not.toHaveBeenCalled()
  })

  it('barrer un fait retenu le retire AUSSI de la mémoire de l’agent', async () => {
    await ouvrir()
    await deplier()
    await act(async () =>
      ligne('Décision A')
        .querySelector<HTMLButtonElement>('[aria-label="Barrer cette ligne"]')!
        .click()
    )
    await attendre()
    expect(api.conversationOublierFait).toHaveBeenCalledWith('A', 'Décision A')
    expect(ligne('Décision A').getAttribute('data-oubli')).toBe('fait')
    expect(ligne('Décision A').textContent).not.toMatch(/encore dans la mémoire/)
  })

  it.each([
    ['le canal échoue', vi.fn().mockRejectedValue(new Error('disque plein'))],
    ['le canal manque (pont d’avant redémarrage)', undefined]
  ])(
    'barrer un fait retenu quand %s : la ligne DIT qu’il reste en mémoire',
    async (_cas, oublier) => {
      await ouvrir(undefined, { oublier })
      await deplier()
      await act(async () =>
        ligne('Décision A')
          .querySelector<HTMLButtonElement>('[aria-label="Barrer cette ligne"]')!
          .click()
      )
      await attendre()
      expect(ligne('Décision A').getAttribute('data-oubli')).toBe('rate')
      expect(ligne('Décision A').textContent).toMatch(/encore dans la mémoire de l’agent/)
      // La correction écrite part quand même avec le message suivant : c'est le filet qui reste.
      expect(h!.textarea().value).toContain('à oublier (Retenu')
      expect(h!.textarea().value).toContain('« Décision A')
    }
  )

  // Une lecture ratée ne doit pas se lire « rien de retenu » : le carnet dit qu'il n'a pas pu lire.
  it('mémoire illisible : le carnet le DIT au lieu de montrer une mémoire vide', async () => {
    await ouvrir(undefined, { memoire: vi.fn().mockRejectedValue(new Error('fichier verrouillé')) })
    await deplier()
    const corps = carnet()!.textContent ?? ''
    expect(corps).toContain('mémoire de l’agent illisible (fichier verrouillé)')
    // Le reste du carnet se lit quand même.
    expect(ligne('idée 6').getAttribute('data-rubrique')).toBe('reste')
  })

  it('corriger une ligne pose l’ancien et le nouveau texte dans la saisie', async () => {
    await ouvrir()
    await deplier()
    await act(async () =>
      ligne('idée 6')
        .querySelector<HTMLButtonElement>('[aria-label="Corriger cette ligne"]')!
        .click()
    )
    const champ = carnet()!.querySelector<HTMLInputElement>('.carnet-correction')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(champ, 'idée 6, en mosaïque')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await attendre()
    expect(h!.textarea().value).toBe(
      'Carnet du fil — correction (Reste à faire) : « idée 6 » devient « idée 6, en mosaïque ».'
    )
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('un fil NON LU ouvre le carnet sur la carte « Pendant ton absence »', async () => {
    await ouvrir({ A: 1_200 })
    const absence = carnet()!.querySelector('[data-testid="carnet-absence"]')
    expect(absence?.textContent).toContain('Pendant ton absence')
    expect(absence?.textContent).toContain('1 tour fini')
    expect(absence?.textContent).toContain('1 fichier modifié')
    expect(carnet()!.querySelector('.carnet-bascule')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('un fil déjà vu n’affiche aucune carte d’absence', async () => {
    await ouvrir({ A: 2_000 })
    await deplier()
    expect(carnet()!.querySelector('[data-testid="carnet-absence"]')).toBeNull()
  })
})
