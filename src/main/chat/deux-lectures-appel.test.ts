import { describe, expect, it, vi } from 'vitest'
import { lecteurDeDeuxLectures } from './deux-lectures-appel'
import type { SendOptions } from '../providers/types'

/**
 * L'APPEL « DEUX LECTURES » ÉCRIT SA LIGNE DE COÛT SOUS LE FIL DU TOUR (2026-11-02).
 *
 * Mesuré sur `cost.jsonl` depuis le 20/10 : 716 lignes `deuxLectures`, AUCUNE avec un
 * `conversationId` — le rappel branché dans `index.ts` ne recevait que (consigne, charge). Le coût
 * par fil les oubliait. Ici le VRAI rappel tourne sur un faux modèle et un faux journal de coût.
 *
 * Entrées qui feraient échouer une correction fausse : un `conversationId` donné par le pilote mais
 * jamais recopié (la ligne n'aurait pas de fil), et une réponse longue à deux lectures dont l'issue
 * interprétée est « 2 lectures : question » (la réponse brute recopiée ne le dirait pas).
 */
const BINDING = { provider: 'claude', model: 'haiku', reasoningEffort: 'low' } as const
const REPONSE_LONGUE = JSON.stringify({
  lectures: [
    {
      texte: 'une task facile à évaluer pour lancer des arena et comparer les workflows',
      proba: 50
    },
    {
      texte: 'une task à corriger dans le code, assez petite pour être évaluée via arena',
      proba: 50
    }
  ]
})

function banc(envoi: () => Promise<unknown>) {
  const lignes: Array<Record<string, unknown>> = []
  const send = vi.fn(envoi)
  const lecteur = lecteurDeDeuxLectures({
    registry: { send } as never,
    roles: { bindingDesPetitesTaches: () => ({ ...BINDING }) },
    cost: { add: (ligne) => void lignes.push(ligne as unknown as Record<string, unknown>) }
  })
  return { lecteur, lignes, send }
}

describe('lecteurDeDeuxLectures — la ligne de coût du contrôle', () => {
  it('porte le fil du tour et l’issue lue par le pilote, pas la réponse brute', async () => {
    const b = banc(async () => ({
      text: REPONSE_LONGUE,
      provider: 'claude',
      model: 'claude-haiku-5-5',
      usage: { inputTokens: 800, outputTokens: 60, costUsd: 0.001 }
    }))
    const issue = vi.fn(() => '2 lectures : question posée')
    const texte = await b.lecteur('consigne', 'charge', { conversationId: 'conv-77', issue })

    // Le pilote reçoit la réponse ENTIÈRE : c'est lui qui la lit.
    expect(texte).toBe(REPONSE_LONGUE)
    expect(issue).toHaveBeenCalledWith(REPONSE_LONGUE)
    expect(b.lignes).toHaveLength(1)
    expect(b.lignes[0]).toMatchObject({
      role: 'petitesTaches',
      appel: 'deuxLectures',
      model: 'claude-haiku-5-5',
      conversationId: 'conv-77',
      issue: '2 lectures : question posée',
      costUsd: 0.001
    })
    // Le modèle des petites tâches, avec sa consigne.
    const [provider, , options] = b.send.mock.calls[0] as unknown as [
      string,
      unknown,
      { system: string; model: string; reasoningEffort: string }
    ]
    expect(provider).toBe('claude')
    expect(options).toMatchObject({ system: 'consigne', model: 'haiku', reasoningEffort: 'low' })
  })

  it('le jumeau : un tour sans fil (tâche de fond hors conversation) écrit sa ligne, sans fil', async () => {
    const b = banc(async () => ({ text: '{"lectures":[]}', provider: 'claude' }))
    await b.lecteur('consigne', 'charge', { issue: () => 'illisible : {"lectures":[]}' })
    expect(b.lignes).toHaveLength(1)
    expect(b.lignes[0]).not.toHaveProperty('conversationId')
    expect(b.lignes[0]).toMatchObject({ issue: 'illisible : {"lectures":[]}' })
  })

  /*
   * « vire ces blocs aussi alors », avec une capture des panneaux Scouts, Frame et Judges : la ligne
   * compréhension a dit « Retirer le bloc Sous-agents », le seul mot que le texte du fil offrait.
   * L'appel n'envoyait que la charge texte : l'image n'atteignait jamais le petit modèle.
   */
  it('les images de la demande partent avec la charge, sur le message envoyé au modèle', async () => {
    const b = banc(async () => ({ text: '{"lectures":[]}', provider: 'claude' }))
    const capture = {
      name: 'image.png',
      mimeType: 'image/png',
      size: 4,
      kind: 'image' as const,
      content: 'iVBO'
    }
    await b.lecteur('consigne', 'charge', { issue: () => 'x' }, [capture])
    const [, messages] = b.send.mock.calls[0] as unknown as [
      string,
      Array<{ role: string; content: string; attachments?: unknown[] }>
    ]
    expect(messages).toEqual([{ role: 'user', content: 'charge', attachments: [capture] }])
    // Lire la capture, rien d'autre : ni commande, ni écriture (claude.sans-outil.test.ts).
    const [, , options] = b.send.mock.calls[0] as unknown as [string, unknown, SendOptions]
    expect(options.toolProfile).toBe('lecture-seule')
  })

  it('le jumeau : sans image, le message reste la charge seule, et aucun outil n’est chargé', async () => {
    const b = banc(async () => ({ text: '{"lectures":[]}', provider: 'claude' }))
    await b.lecteur('consigne', 'charge', { issue: () => 'x' }, [])
    const [, messages, options] = b.send.mock.calls[0] as unknown as [
      string,
      unknown[],
      SendOptions
    ]
    expect(messages).toEqual([{ role: 'user', content: 'charge' }])
    expect(options.toolProfile).toBe('sans-outil')
  })

  it('une panne du modèle est nommée, rejetée, et n’écrit aucune ligne de coût', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const b = banc(async () => {
      throw new Error('surcharge 529')
    })
    await expect(
      b.lecteur('consigne', 'charge', { conversationId: 'conv-77', issue: () => 'x' })
    ).rejects.toThrow('surcharge 529')
    expect(b.lignes).toHaveLength(0)
    expect(avertissement.mock.calls.flat().join(' ')).toContain(
      'deuxLectures abandonné : surcharge 529'
    )
    avertissement.mockRestore()
  })
})
