import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from '../agent-pilot'
import type { Message, SendOptions, SendResult } from '../providers/types'
import { ConversationStore } from '../store/conversations'
import { metasDurablesDesPieces, piecesJointesPourLeModele } from './pieces-jointes-durables'

/**
 * LES PIÈCES JOINTES SUIVENT LE TRAVAIL, MÊME QUAND IL SE FAIT PLUS TARD (conv-1147, 2026-10-25).
 *
 * « Lancer en N fils » sépare deux temps : le tour qui reçoit le message (et ses pièces jointes)
 * ne fait que proposer le découpage ; le travail part au tour SUIVANT, dans une branche du fil ou
 * à la suite ici. Mesuré à la lecture : une image survivait à ce délai (son original est écrit sur
 * disque à l'envoi et rechargé), mais un fichier texte ou un PDF joint ne gardait que son nom,
 * taille et type (`run-pilot-chat.ts`, `if (kind !== 'image') return metadata`). L'agent de la
 * branche ne pouvait donc pas lire le journal que l'utilisateur avait joint.
 *
 * Ce qui ferait échouer une version fausse :
 * - un fichier texte ou un PDF du message d'origine absent du tour de la branche ;
 * - la miniature d'une image envoyée à la place de son original ;
 * - des pièces d'un message PASSÉ rattachées au message COURANT (qui a les siennes, en entier).
 */
describe('pièces jointes durables — du message d’origine au tour d’une branche', () => {
  const base = (): string => mkdtempSync(join(tmpdir(), 'autowin-pieces-durables-'))
  const IMAGE = Buffer.from('89504e47-image-originale', 'utf8').toString('base64')
  const MINIATURE = Buffer.from('miniature-floue', 'utf8').toString('base64')
  const JOURNAL = 'ERREUR 42 à 10:31 — le tri plante\nligne 2 du journal'
  const PDF = Buffer.from('%PDF-1.7 contenu', 'utf8').toString('base64')
  const envoyees = [
    {
      name: 'maquette.png',
      mimeType: 'image/png',
      size: 25,
      kind: 'image' as const,
      content: IMAGE,
      thumbnail: `data:image/png;base64,${MINIATURE}`
    },
    {
      name: 'journal.log',
      mimeType: 'text/plain',
      size: JOURNAL.length,
      kind: 'text' as const,
      content: JOURNAL
    },
    { name: 'spec.pdf', mimeType: 'application/pdf', size: 16, kind: 'file' as const, content: PDF }
  ]

  /** Le fil d'origine reçoit le message, puis une branche en part (comme `lancerEnFils`). */
  function brancheDuMessage(racine: string): { metas: ReturnType<typeof metasDurablesDesPieces> } {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const origine = store.create({ title: 'Deux tâches', provider: 'claude' })
    const metas = metasDurablesDesPieces(envoyees, origine.id, 'tour-1', racine)
    store.beginTurn(
      origine.id,
      { content: 'corrige A et B, voir le journal', attachments: metas },
      { turnId: 'tour-1' }
    )
    const message = store.messagesOf(origine.id).find((m) => m.role === 'user')!
    const branche = store.fork(origine.id, message.messageId!)
    const copie = store.messagesOf(branche.id).find((m) => m.role === 'user')!
    return { metas: copie.attachments ?? [] }
  }

  it('écrit l’original de CHAQUE pièce à l’envoi, pas seulement des images', () => {
    const racine = base()
    const metas = metasDurablesDesPieces(envoyees, 'conv-src', 'tour-1', racine)
    expect(metas.map((meta) => meta.name)).toEqual(['maquette.png', 'journal.log', 'spec.pdf'])
    for (const meta of metas) {
      expect(meta.artifact?.path, meta.name).toBeTruthy()
      expect(meta.originalUnavailable, meta.name).toBeUndefined()
      // Le fil persisté ne garde jamais le binaire inline.
      expect((meta as { content?: string }).content, meta.name).toBeUndefined()
    }
    expect(readFileSync(metas[1]!.artifact!.path!, 'utf8')).toBe(JOURNAL)
  })

  it('la branche relit l’original de l’image, le journal et le PDF', () => {
    const racine = base()
    const { metas } = brancheDuMessage(racine)
    // Ce que le renderer transmet pour un message PASSÉ : la miniature de l'image, rien d'autre.
    const transmises = [
      {
        name: 'maquette.png (miniature)',
        mimeType: 'image/png',
        size: MINIATURE.length,
        kind: 'image' as const,
        content: MINIATURE
      }
    ]
    const pieces = piecesJointesPourLeModele(transmises, metas, {
      messageCourant: false,
      base: racine
    })
    const parNom = new Map(pieces.map((piece) => [piece.name, piece]))
    expect([...parNom.keys()].sort()).toEqual(['journal.log', 'maquette.png', 'spec.pdf'])
    expect(parNom.get('maquette.png')).toMatchObject({ kind: 'image', content: IMAGE })
    expect(parNom.get('journal.log')).toMatchObject({ kind: 'text', content: JOURNAL })
    expect(parNom.get('spec.pdf')).toMatchObject({
      kind: 'file',
      mimeType: 'application/pdf',
      content: PDF
    })
  })

  it('le message COURANT garde seulement ce que le renderer envoie', () => {
    const racine = base()
    const { metas } = brancheDuMessage(racine)
    const courantes = [{ ...envoyees[0]!, name: 'autre.png' }]
    const pieces = piecesJointesPourLeModele(courantes, metas, {
      messageCourant: true,
      base: racine
    })
    expect(pieces.map((piece) => piece.name)).toEqual(['autre.png'])
  })

  it('un original effacé retombe sur ce qui a été transmis, sans faire échouer le tour', () => {
    const racine = base()
    const { metas } = brancheDuMessage(racine)
    const sansDisque = metas.map((meta) => ({
      ...meta,
      artifact: meta.artifact && { ...meta.artifact, path: join(racine, 'disparu.bin') }
    }))
    const transmises = [
      {
        name: 'maquette.png (miniature)',
        mimeType: 'image/png',
        size: 1,
        kind: 'image' as const,
        content: MINIATURE
      }
    ]
    const pieces = piecesJointesPourLeModele(transmises, sansDisque, {
      messageCourant: false,
      base: racine
    })
    expect(pieces).toEqual(transmises)
  })

  it('l’agent de la branche reçoit les trois pièces, marquées « tour antérieur »', async () => {
    const racine = base()
    const { metas } = brancheDuMessage(racine)
    const pieces = piecesJointesPourLeModele([], metas, { messageCourant: false, base: racine })
    const envois: Message[][] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        envois.push(messages)
        return { text: 'Vu.', provider: 'codex', systemInjected: true } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-test' })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn()
    }
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [
        { role: 'user', content: 'corrige A et B, voir le journal', attachments: pieces },
        { role: 'user', content: 'corrige A' }
      ] as never,
      () => {},
      undefined,
      1,
      'conv-branche'
    )
    const dernier = envois[0]!.at(-1)!
    const recues = dernier.attachments ?? []
    expect(recues).toHaveLength(3)
    expect(recues.every((piece) => piece.provenance === 'message-precedent')).toBe(true)
    expect(recues.find((piece) => piece.kind === 'text')?.content).toBe(JOURNAL)
  })

  it('est branché dans le tour de chat, à l’envoi comme à la relecture', () => {
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    expect(source).toContain('metasDurablesDesPieces(')
    expect(source).toContain('piecesJointesPourLeModele(')
    expect(source).not.toContain("if (kind !== 'image') return metadata")
  })
})
