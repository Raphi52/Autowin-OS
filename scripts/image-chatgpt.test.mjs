import { describe, expect, it } from 'vitest'
import {
  argumentsCodex,
  connexionChatgpt,
  envSansCleApi,
  lireJournal,
  nomsDeSortie,
  promptPourCodex
} from './image-chatgpt.mjs'

// Images 2D par le compte ChatGPT, via l'outil en ligne de commande Codex (conv-1603).
describe('image-chatgpt : la voie ChatGPT, jamais la facturation API', () => {
  it("retire les clés d'API de l'environnement de Codex", () => {
    const env = envSansCleApi({ PATH: 'x', OPENAI_API_KEY: 'sk-a', CODEX_API_KEY: 'b', AUTRE: '1' })
    expect(env).toEqual({ PATH: 'x', AUTRE: '1' })
  })

  it("refuse un Codex connecté par clé d'API : l'image serait facturée", () => {
    expect(connexionChatgpt({ auth_mode: 'chatgpt', OPENAI_API_KEY: null }).ok).toBe(true)
    expect(connexionChatgpt({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk' }).ok).toBe(false)
    expect(connexionChatgpt({ auth_mode: 'chatgpt', OPENAI_API_KEY: 'sk' }).ok).toBe(false)
    expect(connexionChatgpt(null).ok).toBe(false)
  })

  it('lance Codex en lecture JSON, références jointes, outils de contrôle d’écran coupés', () => {
    const a = argumentsCodex({ dossier: 'D:/tmp/x', references: ['a.png', 'b.webp'] })
    expect(a.slice(0, 1)).toEqual(['exec'])
    expect(a).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '-C', 'D:/tmp/x']))
    expect(a.join(' ')).toContain('--enable image_generation')
    expect(a.join(' ')).toContain('--disable computer_use')
    expect(a.join(' ')).toContain('--disable browser_use')
    expect(a.join(' ')).toContain('-i a.png -i b.webp')
    // Le prompt part par l'entrée standard (« - ») : une longue description ne casse pas la ligne de commande.
    expect(a[a.length - 1]).toBe('-')
  })

  it("demande l'outil d'images, pas un dessin par code, et nomme les fichiers attendus", () => {
    const p = promptPourCodex({ prompt: 'un gong', n: 2, fond: 'transparent', ratio: '2:3' })
    expect(p).toContain('un gong')
    expect(p).toMatch(/image generation tool/i)
    expect(p).toMatch(/do not draw/i)
    expect(p).toContain('image-1.png')
    expect(p).toContain('image-2.png')
    expect(p).toMatch(/transparent/i)
    expect(p).toContain('2:3')
  })

  it("lit la limite d'usage du compte et sa date de reprise", () => {
    const j = lireJournal([
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"error","message":"You’ve hit your usage limit. To continue using Codex and get access to GPT-5.3-Codex, start a free trial of Plus today (https://chatgpt.com/explore/plus), or try again at Nov 30th, 2026 10:16 PM."}',
      '{"type":"turn.failed","error":{"message":"You’ve hit your usage limit."}}',
      'pas du json'
    ])
    expect(j.fil).toBe('t1')
    expect(j.limite).toEqual({ reprise: 'Nov 30th, 2026 10:16 PM' })
    expect(j.echec).toBe(true)
  })

  it('compte les commandes lancées : une image dessinée par script se voit', () => {
    const j = lireJournal([
      '{"type":"item.completed","item":{"type":"command_execution","command":"python draw.py"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"fini"}}',
      '{"type":"turn.completed"}'
    ])
    expect(j.commandes).toEqual(['python draw.py'])
    expect(j.messages).toEqual(['fini'])
    expect(j.limite).toBeNull()
    expect(j.echec).toBe(false)
  })

  it('nomme les sorties comme generer-image.mjs : -1, -2… au-delà d’une image', () => {
    expect(nomsDeSortie('d/gong.png', 1)).toEqual(['d/gong.png'])
    expect(nomsDeSortie('d/gong.png', 3)).toEqual(['d/gong-1.png', 'd/gong-2.png', 'd/gong-3.png'])
    expect(nomsDeSortie('d/gong', 2)).toEqual(['d/gong-1.png', 'd/gong-2.png'])
  })
})
