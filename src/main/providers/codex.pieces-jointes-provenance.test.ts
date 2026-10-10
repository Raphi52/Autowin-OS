import { describe, expect, it, vi } from 'vitest'
import { CodexAdapter } from './codex'
import type { Attachment, Message } from './types'

/**
 * Meme defaut que conv-150, chemin Codex.
 *
 * Vecu en conv-150, tour 1bf1ae63-adb7-47be-ba4e-5c65c5593851 (2026-10-10) : UNE capture jointe,
 * « Je regarde tes deux captures » en reponse — l'image du premier message etait rejointe d'office
 * dans la meme liste. Le correctif Claude (ba3c5ba0) range les pieces par `provenance` ; mais
 * `agent-pilot.ts` remet la MEME liste a tous les modeles, et `codexContent` emettait chaque image
 * en `input_image` nu — sans nom, sans provenance : une image d'un tour anterieur y etait
 * strictement indiscernable de celle du message courant.
 *
 * fix-ok: conv-150 tour 1bf1ae63-adb7-47be-ba4e-5c65c5593851 — codexContent emettait l'image rejointe en input_image nu ; ce test rouge 2/3 sur l'ancien codex.ts, vert 3/3 sous c59f80c4. Les retouches suivantes de CE fichier alignaient mon attente « TOUR ANTÉRIEUR (1) » (collee) sur le texte reel, ou le compte suit la phrase : l'assertion verifie toujours le compte 1.
 */
const image = (content: string, provenance?: Attachment['provenance']): Attachment => ({
  name: provenance ? 'image.png (jointe a un message precedent)' : 'image.png',
  mimeType: 'image/png',
  size: 3,
  kind: 'image',
  content,
  ...(provenance ? { provenance } : {})
})

const tokens = { accessToken: 'AT', refreshToken: 'RT', obtainedAt: Date.now(), expiresInSec: 3600 }

async function contenuEnvoye(attachments: Attachment[]): Promise<Array<Record<string, string>>> {
  let captured: Record<string, unknown> = {}
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string)
    const encoder = new TextEncoder()
    let envoye = false
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (envoye) return { done: true, value: undefined }
            envoye = true
            return {
              done: false,
              value: encoder.encode('data: {"type":"response.completed","response":{"id":"r"}}\n')
            }
          }
        })
      }
    } as unknown as Response
  })
  const adapter = new CodexAdapter({ fetchFn: fetchFn as unknown as typeof fetch, loadTokensFn: () => tokens })
  const messages: Message[] = [{ role: 'user', content: 'Regarde ma capture', attachments }]
  const gen = adapter.send(messages)
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return (captured.input as Array<{ content: Array<Record<string, string>> }>)[0].content
}

const textes = (contenu: Array<Record<string, string>>): string[] =>
  contenu.filter((c) => c.type === 'input_text').map((c) => c.text)

describe('codexContent — provenance des pieces jointes', () => {
  it('annonce a part, et compte, l image d un tour anterieur', async () => {
    const contenu = await contenuEnvoye([image('Q09VUg=='), image('QU5DSUVOTkU=', 'message-precedent')])
    const iCourante = contenu.findIndex((c) => c.image_url?.endsWith('Q09VUg=='))
    const iAncienne = contenu.findIndex((c) => c.image_url?.endsWith('QU5DSUVOTkU='))
    const iRappel = contenu.findIndex((c) => c.type === 'input_text' && c.text.includes('TOUR ANTÉRIEUR'))
    expect(textes(contenu).some((t) => t.includes('PIÈCES JOINTES DE TON MESSAGE CI-DESSUS (1)'))).toBe(true)
    expect(contenu[iRappel]?.text).toContain('(1)')
    expect(contenu[iRappel]?.text).toContain('ne les compte pas')
    // L'image courante AVANT le rappel, l'ancienne APRES : jamais dans le meme groupe.
    expect(iRappel).toBeGreaterThan(0)
    expect(iCourante).toBeLessThan(iRappel)
    expect(iAncienne).toBeGreaterThan(iRappel)
  })

  it('dit AUCUNE piece jointe quand seule une image ancienne est remise', async () => {
    const contenu = await contenuEnvoye([image('QU5DSUVOTkU=', 'message-precedent')])
    expect(textes(contenu).some((t) => t.includes('AUCUNE pièce jointe'))).toBe(true)
    expect(textes(contenu).some((t) => /TOUR ANTÉRIEUR[^(]*\(1\)/.test(t))).toBe(true)
  })

  it('sans image ancienne, le contenu reste celui d avant (aucun texte ajoute)', async () => {
    const contenu = await contenuEnvoye([image('Q09VUg==')])
    expect(contenu).toEqual([
      { type: 'input_text', text: 'Regarde ma capture' },
      { type: 'input_image', image_url: 'data:image/png;base64,Q09VUg==' }
    ])
  })
})
