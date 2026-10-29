// @vitest-environment happy-dom
/**
 * LIGNE « LECTURE RETENUE » (conv-1123, 2026-10-23 : « affiche la ligne avec un style distinct,
 * texte atténué et petite étiquette « lecture », pour qu'elle se repère d'un coup d'œil avant la
 * réponse »). Le processus principal l'envoie dans son propre flux (`FLUX_LECTURE_RETENUE`) ; le
 * fil la fondait jusqu'ici dans la réponse, au même style qu'elle (capture de conv-1124).
 *
 * Entrées qui feraient échouer une correction fausse :
 *  - la ligne encore fusionnée dans le bloc de la réponse (un seul `.msg-body`) ;
 *  - l'étiquette absente, ou « Lecture retenue : » répété à côté d'elle ;
 *  - la ligne prise pour la RÉPONSE (point bleu) d'un tour qui n'a rien écrit d'autre ;
 *  - deux textes ordinaires qui ne fusionnent plus (le découpage doit viser ce seul flux).
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import { groupAssistantActivity } from './chat-view-model'
import { placeDeLaReponse } from './rail-du-tour'
import { FLUX_LECTURE_RETENUE } from '../../../shared/lecture-retenue'
import type { Msg } from './chat-view-types'
import type { ChatPart } from './chat-view-model'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEBUT = 1_790_000_000_000
// Le texte RÉEL émis dans conv-1124 (turn-journals, 2026-10-23), raccourci.
const ANNONCE =
  'Lecture retenue : « Ajouter à la rivière un sélecteur qui filtre les données » — si tu voulais plutôt « changer l’échelle de temps visible (zoom) », dis-le.\n\n'
const lecture: ChatPart = {
  kind: 'text',
  streamId: FLUX_LECTURE_RETENUE,
  text: ANNONCE,
  at: DEBUT + 6_000
}
const reponse: ChatPart = {
  kind: 'text',
  streamId: '0:0',
  text: 'Je ne modifie aucun fichier, comme demandé.',
  at: DEBUT + 9_000
}

async function rendre(parts: ChatPart[]): Promise<Element> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const message = {
    role: 'assistant',
    content: '',
    turnId: 't1',
    done: true,
    status: 'completed',
    debutDuTour: DEBUT,
    parts
  }
  await act(async () => {
    root.render(
      createElement(ChatMessageRow, {
        message: message as unknown as Msg,
        conversationId: 'conv-test'
      } as never)
    )
  })
  const copie = host.querySelector('.msg.assistant')!.cloneNode(true) as Element
  await act(async () => root.unmount())
  host.remove()
  return copie
}

describe('ligne « Lecture retenue » dans le fil', () => {
  it('s’affiche à part, avant la réponse, sous une étiquette « lecture »', async () => {
    const tour = await rendre([lecture, reponse])
    const ligne = tour.querySelector('[data-testid="lecture-retenue"]')
    expect(ligne, 'la ligne doit avoir son propre bloc').not.toBeNull()
    expect(ligne?.closest('.msg-body'), 'jamais dans le bloc de la réponse').toBeNull()
    expect(ligne?.querySelector('.msg-lecture-etiquette')?.textContent).toBe('lecture')
    const texte = ligne?.querySelector('.msg-lecture-texte')?.textContent ?? ''
    expect(texte.startsWith('« Ajouter à la rivière')).toBe(true)
    expect(texte).toContain('si tu voulais plutôt « changer l’échelle de temps visible (zoom) »')
    expect(texte, 'l’étiquette dit déjà « lecture »').not.toContain('Lecture retenue')
    // La réponse reste un bloc ordinaire, APRÈS la ligne, et c'est elle le dernier point du rail.
    const blocs = [...tour.querySelectorAll('.msg-body, [data-testid="lecture-retenue"]')]
    expect(blocs.map((b) => b.getAttribute('data-testid') ?? 'reponse')).toEqual([
      'lecture-retenue',
      'reponse'
    ])
    expect(tour.querySelector('[data-nature="reponse"]')?.textContent).toContain(
      'Je ne modifie aucun fichier'
    )
    expect(tour.querySelector('[data-nature="reponse"] [data-testid="lecture-retenue"]')).toBeNull()
  })

  it('n’est jamais prise pour la réponse d’un tour qui n’a rien écrit d’autre', async () => {
    const tour = await rendre([
      lecture,
      { kind: 'action', actionId: 'route:0', name: 'orchestrate', ok: true, at: DEBUT + 7_000 }
    ])
    expect(tour.querySelector('[data-testid="lecture-retenue"]')).not.toBeNull()
    expect(tour.querySelector('[data-nature="reponse"]')).toBeNull()
  })
})

describe('découpage des textes du tour', () => {
  it('sépare le seul flux de la lecture, et fusionne toujours les autres textes', () => {
    const blocs = groupAssistantActivity([
      lecture,
      reponse,
      { kind: 'text', streamId: '0:1', text: 'Suite de la réponse.' }
    ])
    expect(blocs).toHaveLength(2)
    expect(blocs[0]).toMatchObject({ kind: 'text', lectureRetenue: true, at: DEBUT + 6_000 })
    expect(blocs[1]).toMatchObject({ kind: 'text' })
    expect(blocs[1]).not.toHaveProperty('lectureRetenue')
    expect((blocs[1] as { text: string }).text).toBe(
      'Je ne modifie aucun fichier, comme demandé.\nSuite de la réponse.'
    )
    expect(placeDeLaReponse([blocs], true)).toEqual([0, 1])
    expect(placeDeLaReponse([[blocs[0]]], true)).toBeUndefined()
  })

  it('arrivée APRÈS le début de la réponse, elle se range en tête sans la couper (conv-1240)', () => {
    // Lue en parallèle du modèle : sur un tour rapide, la ligne arrive entre deux morceaux du texte.
    const blocs = groupAssistantActivity([
      reponse,
      { ...lecture, at: DEBUT + 10_000 },
      { kind: 'text', streamId: '0:0', text: 'Suite de la réponse.' }
    ])
    expect(blocs).toHaveLength(2)
    expect(blocs[0]).toMatchObject({ kind: 'text', lectureRetenue: true })
    expect((blocs[1] as { text: string }).text).toBe(
      'Je ne modifie aucun fichier, comme demandé.\nSuite de la réponse.'
    )
  })
})
