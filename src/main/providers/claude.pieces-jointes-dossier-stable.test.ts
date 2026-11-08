import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dossierDesPiecesJointesDuTourDeChat, materializeClaudeAttachments } from './claude'

/**
 * Le CLI recopie chaque `--add-dir` dans la section « Environment » de son prompt système (sonde du
 * 2026-11-08). Le dossier des pièces jointes tiré au hasard à chaque appel changeait donc ce système
 * à chaque tour avec pièce jointe, et faisait relire toute la conversation hors cache (session
 * 5595d443 le 2026-11-08 : deux tours consécutifs, deux noms). Le dossier d'un fil garde son nom.
 */
const image = (nom: string) =>
  [{ kind: 'image', name: nom, mimeType: 'image/png', content: 'aGk=' }] as Parameters<
    typeof materializeClaudeAttachments
  >[0]

describe('dossier des pièces jointes stable par fil', () => {
  it('deux tours du même fil donnent le même dossier, deux fils deux dossiers', async () => {
    const tour1 = materializeClaudeAttachments(image('a.png'), undefined, 'conv-pj-1')
    const tour2 = materializeClaudeAttachments(image('b.png'), undefined, 'conv-pj-1')
    const autreFil = materializeClaudeAttachments(image('c.png'), undefined, 'conv-pj-2')
    try {
      expect(tour2.dir).toBe(tour1.dir)
      expect(autreFil.dir).not.toBe(tour1.dir)
      expect(tour1.dir).toContain('autowin-os-attachments-')
    } finally {
      await Promise.all([tour1.cleanup(), tour2.cleanup(), autreFil.cleanup()])
    }
  })

  it('deux appels simultanés du même fil ne retirent que leurs propres fichiers', async () => {
    const principal = materializeClaudeAttachments(image('a.png'), undefined, 'conv-pj-3')
    const aCote = materializeClaudeAttachments(image('a.png'), undefined, 'conv-pj-3')
    expect(principal.paths[0]).not.toBe(aCote.paths[0])
    await aCote.cleanup()
    expect(existsSync(aCote.paths[0]!)).toBe(false)
    expect(existsSync(principal.paths[0]!)).toBe(true)
    await principal.cleanup()
    expect(existsSync(principal.paths[0]!)).toBe(false)
  })

  it('sans fil connu, garde un dossier à part par appel', async () => {
    const a = materializeClaudeAttachments(image('a.png'))
    const b = materializeClaudeAttachments(image('a.png'))
    try {
      expect(a.dir).not.toBe(b.dir)
    } finally {
      await Promise.all([a.cleanup(), b.cleanup()])
    }
  })
})

describe('le tour de chat déclare le dossier du fil à chaque tour', () => {
  it('le même `--add-dir` avec ou sans pièce jointe : le prompt système ne bouge pas', async () => {
    const sansPiece = dossierDesPiecesJointesDuTourDeChat(undefined, 'conv-pj-4')
    const avec = materializeClaudeAttachments(image('a.png'), undefined, 'conv-pj-4')
    try {
      expect(sansPiece).toEqual(['--add-dir', avec.dir])
      expect(dossierDesPiecesJointesDuTourDeChat(avec, 'conv-pj-4')).toEqual(sansPiece)
      expect(existsSync(avec.dir)).toBe(true)
    } finally {
      await avec.cleanup()
    }
  })

  it('sans fil connu, ne déclare que le dossier de l’appel, et rien sans pièce jointe', async () => {
    expect(dossierDesPiecesJointesDuTourDeChat(undefined, undefined)).toEqual([])
    const a = materializeClaudeAttachments(image('a.png'))
    try {
      expect(dossierDesPiecesJointesDuTourDeChat(a, undefined)).toEqual(['--add-dir', a.dir])
    } finally {
      await a.cleanup()
    }
  })
})
