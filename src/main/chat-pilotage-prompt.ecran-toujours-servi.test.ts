import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { blocsSystemeEcran, tourTouchantAuVisuel } from './chat-pilotage-prompt'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * DEFAUT VECU (kaizen conv-835, tour ac1d0434-51c7-4dee-adf9-a8cb0a8e41f8, 2026-09-26).
 *
 * Saisie ts 1790393862643 : « envoi un message teams a leslie pour lui dire ou cest rangé ». Aucun
 * mot visuel : le bloc qui portait « ECRAN DE L'UTILISATEUR = SON ESPACE » et « ORDRE : d'abord le
 * bureau cache » n'a pas ete servi (blocs systeme [constitution, pilotage, style, projectContext],
 * prompt-observability/conv-835.jsonl). Le chat a lance `Start-Process "msteams:/l/chat/..."` sur
 * l'ecran reel ; saisie ts 1790394004769 : « t'aurais du le faire en hdesk ».
 *
 * fix-ok: REGLES_ECRAN_UTILISATEUR n'etait servi que si tourTouchantAuVisuel(message) (chat-pilotage-prompt.ts, blocsSystemeEcran) ; defaut reinjecte le 2026-09-26 = 3 tests rouges (« expected '' to contain 'ECRAN DE L'UTILISATEUR = SON ESPACE' »), retire = 7/7 verts
 */
const MESSAGE_DU_TOUR = 'envoi un message teams a leslie pour lui dire ou cest rangé'

describe("regles de l'ecran de l'utilisateur servies a chaque tour (conv-835)", () => {
  it('le message du tour ne porte aucun mot visuel : la regle ne pouvait pas dependre de lui', () => {
    expect(tourTouchantAuVisuel(MESSAGE_DU_TOUR)).toBe(false)
  })

  it('sert quand meme le bloc ecran, et dit comment nommer le bureau cache du fil', () => {
    const [ecran, visuel] = blocsSystemeEcran(MESSAGE_DU_TOUR, false, 'conv-835')
    expect(ecran.name).toBe('ecranUtilisateur')
    expect(ecran.text).toContain("ECRAN DE L'UTILISATEUR = SON ESPACE")
    expect(ecran.text).toContain("ORDRE : d'abord le bureau cache")
    expect(ecran.text).toContain('chat-<id du fil>')
    expect(ecran.text).toContain('activeConversationId')
    expect(visuel).toEqual({ name: 'visuel', text: '' })
  })

  it('reste identique pour tous les fils : le prefixe systeme reste cachable', () => {
    const [a] = blocsSystemeEcran(MESSAGE_DU_TOUR, false, 'conv-835')
    const [b] = blocsSystemeEcran(MESSAGE_DU_TOUR, false, 'conv-1')
    expect(a.text).toBe(b.text)
    const [, visuel] = blocsSystemeEcran('regarde la fenêtre', false, 'conv-835')
    expect(visuel.text).toContain('-Id chat-conv-835')
  })

  it("dit qu'un lien de protocole ou une app deja ouverte agit sur SON ecran, et qu'il faut demander", () => {
    const [ecran] = blocsSystemeEcran(MESSAGE_DU_TOUR, false, 'conv-835')
    expect(ecran.text).toContain('msteams:')
    expect(ecran.text).toContain('Start-Process')
    expect(ecran.text).toContain('--user-data-dir')
    expect(ecran.text).toContain("DEMANDE-lui avant d'ouvrir")
    // « t'en servir » : la regle couvre aussi le fait d'UTILISER une app a sa place, pas seulement l'observer.
    expect(ecran.text).toContain("t'en servir a sa place")
  })

  it('garde les regles de travail visuel conditionnelles', () => {
    const [, visuel] = blocsSystemeEcran(
      'le bouton de la sidebar est mal aligné',
      false,
      'conv-835'
    )
    expect(visuel.text).toContain('PREUVE VISUELLE FRONT')
    const [, avecImage] = blocsSystemeEcran('et ça ?', true, 'conv-835')
    expect(avecImage.text).toContain('skills/look/SKILL.md')
  })

  /**
   * Preuve sur le CHEMIN REEL : le texte systeme que `AgentPilot.chat()` remet au modele pour le
   * message du tour ac1d0434 contient la regle. Meme banc que agent-pilot.stable-prefix.test.ts.
   */
  it('le prompt systeme reellement remis au modele porte la regle pour ce message', async () => {
    const systems: string[] = []
    const registry = {
      send: vi.fn(async (_p: string, _m: Message[], o: SendOptions): Promise<SendResult> => {
        systems.push(o.system ?? '')
        return { text: 'ok', sessionId: 'sess' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({})),
      exec: vi.fn()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pilot = new AgentPilot(registry as any, roles as any, bus as any)
    await pilot.chat(
      [{ role: 'user', content: MESSAGE_DU_TOUR }],
      () => {},
      undefined,
      1,
      'conv-835'
    )
    expect(systems).toHaveLength(1)
    expect(systems[0]).toContain("ECRAN DE L'UTILISATEUR = SON ESPACE")
    expect(systems[0]).toContain("ORDRE : d'abord le bureau cache")
    expect(systems[0]).toContain('msteams:')
    // Et toujours pas le bloc de travail visuel : le message n'y touche pas.
    expect(systems[0]).not.toContain('PREUVE VISUELLE FRONT')
  })

  it("est bien la fonction qu'agent-pilot.ts appelle pour construire le prompt systeme", () => {
    const source = readFileSync('src/main/agent-pilot.ts', 'utf8')
    expect(source).toContain('...blocsSystemeEcran(')
    // Plus aucun chemin parallele qui re-servirait les regles visuelles sous condition a part.
    expect(source).not.toContain('REGLES_VISUELLES')
  })
})
