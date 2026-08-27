import { describe, expect, it } from 'vitest'
import { piecesJointesDuDernierTour } from './pieces-jointes-orchestration'
import type { Msg } from './conversations'

/**
 * « Je n'ai pas l'image dans ce tour (elle n'est pas remontée jusqu'à moi). »
 *
 * Réponse d'un run le 2026-08-27 à « fais un truc comme l'image que je t'ai envoyé ». Elle était
 * exacte : l'orchestrateur ne transporte que `task: string`, quatorze sites construisent
 * `[{ role: 'user', content }]` et pas un ne porte `attachments`. Le fichier, lui, est bien sur le
 * disque — `chat-artifacts/<conversation>/<tour>/user-image-*.png`.
 */
describe('pièces jointes — l’orchestration reçoit enfin l’image', () => {
  const message = (attachments: Msg['attachments']): Msg => ({
    role: 'user',
    content: 'fais un truc comme l’image que je t’ai envoyé',
    ts: 1,
    ...(attachments ? { attachments } : {})
  })

  const jointe = (name: string, path?: string, originalUnavailable?: boolean): NonNullable<Msg['attachments']>[number] =>
    ({
      name,
      mimeType: 'image/png',
      size: 1024,
      ...(originalUnavailable ? { originalUnavailable } : {}),
      ...(path
        ? {
            artifact: {
              id: 'a1',
              name,
              mimeType: 'image/png',
              kind: 'image',
              size: 1024,
              createdAt: 1,
              path,
              source: 'user'
            }
          }
        : {})
    }) as NonNullable<Msg['attachments']>[number]

  it('cite le chemin de l’image jointe au dernier tour', () => {
    const chemin = 'C:/data/chat-artifacts/conv-1425/t1/user-image-779deaaf.png'
    const vu = piecesJointesDuDernierTour([message([jointe('capture.png', chemin)])], () => true)
    expect(vu.chemins).toEqual([chemin])
    expect(vu.suffixe).toContain(chemin)
    // Sans consigne de lecture, le chemin reste du décor : l'agent doit savoir qu'il DOIT l'ouvrir.
    expect(vu.suffixe).toMatch(/Read/)
  })

  it('ne cite QUE le dernier tour — une image de la semaine dernière n’est pas la demande', () => {
    const vieux = 'C:/data/vieille.png'
    const recent = 'C:/data/recente.png'
    const vu = piecesJointesDuDernierTour(
      [
        message([jointe('vieille.png', vieux)]),
        { role: 'assistant', content: 'ok', ts: 2 },
        message([jointe('recente.png', recent)])
      ],
      () => true
    )
    expect(vu.chemins).toEqual([recent])
    expect(vu.suffixe).not.toContain(vieux)
  })

  it('porte PLUSIEURS images du même tour', () => {
    const vu = piecesJointesDuDernierTour(
      [message([jointe('a.png', 'C:/a.png'), jointe('b.png', 'C:/b.png')])],
      () => true
    )
    expect(vu.chemins).toEqual(['C:/a.png', 'C:/b.png'])
  })

  it('DIT qu’une pièce jointe est introuvable au lieu de se taire', () => {
    // Se taire produit un agent qui invente ce qu'il n'a pas vu — exactement ce qu'on veut éviter.
    const vu = piecesJointesDuDernierTour([message([jointe('perdue.png', undefined)])], () => true)
    expect(vu.chemins).toEqual([])
    expect(vu.introuvables).toEqual(['perdue.png'])
    expect(vu.suffixe).toContain('INTROUVABLE')
    expect(vu.suffixe).toContain('perdue.png')
  })

  it('croit `originalUnavailable` sur parole — la miniature n’est pas la source', () => {
    const vu = piecesJointesDuDernierTour(
      [message([jointe('miniature.png', 'C:/existe.png', true)])],
      () => true
    )
    expect(vu.chemins).toEqual([])
    expect(vu.introuvables).toEqual(['miniature.png'])
  })

  it('un chemin annoncé mais absent du disque compte comme introuvable', () => {
    const vu = piecesJointesDuDernierTour(
      [message([jointe('efface.png', 'C:/efface.png')])],
      () => false
    )
    expect(vu.chemins).toEqual([])
    expect(vu.introuvables).toEqual(['efface.png'])
  })

  it('DISCRIMINANT — sans pièce jointe, aucun suffixe : la tâche reste intacte', () => {
    expect(piecesJointesDuDernierTour([message(undefined)], () => true).suffixe).toBeUndefined()
    expect(piecesJointesDuDernierTour([], () => true).suffixe).toBeUndefined()
  })
})
