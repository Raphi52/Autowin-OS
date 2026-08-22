import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot } from './agent-pilot'
import { exigeDireLEchec } from './chat-turn-messages'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * UNE ACTION EN ERREUR EST CAPTEE EN COURS DE TOUR, ET CORRIGEE AVANT LA FIN.
 *
 * Demande de l'utilisateur le 2026-08-22. La machinerie existait deja et etait armee pour le chat
 * (`index.ts`, litteral `true`) : ce qui manquait, ce sont deux trous mesures par sonde.
 *
 * T1 — la reprise qui REND la main aux commandes ne regardait que l'echec de la DERNIERE iteration,
 * remis a plat a chaque tour de boucle. Un echec enjambe a l'iteration 2 ne pouvait plus etre
 * corrige a l'iteration 7 : il tombait dans l'aveu d'echec, qui reformule « SANS aucune commande ».
 * Capte, donc — mais explicitement NON corrige, l'ecart exact que cette demande vise.
 *
 * T2 — l'aveu d'echec testait la simple PRESENCE d'un mot. « tous les tests passent sans erreur »
 * contient « erreur » : la garde se desarmait sur une NEGATION, et une action reellement plantee
 * cloturait le tour sans etre ni corrigee ni avouee.
 */
describe('une negation ne desarme plus l aveu d echec', () => {
  it('« sans erreur » pose sur un echec reel declenche la garde', () => {
    expect(exigeDireLEchec(true, '✅ Fait — la suite est verte, tous les tests passent sans erreur.')).toBe(
      true
    )
  })

  it('« aucune erreur » non plus', () => {
    expect(exigeDireLEchec(true, 'Termine, aucune erreur rencontree.')).toBe(true)
  })

  it('« 0 erreur » non plus', () => {
    expect(exigeDireLEchec(true, 'Build termine : 0 erreur, 0 warning.')).toBe(true)
  })

  it('une phrase qui NOMME vraiment l echec desarme toujours la garde', () => {
    // La contrepartie : on ne doit pas harceler un agent qui a fait son travail d honnetete.
    expect(exigeDireLEchec(true, "L edition a echoue : le chemin est introuvable.")).toBe(false)
  })

  it('nommer l echec ET nier ailleurs desarme quand meme : le retrait est chirurgical', () => {
    expect(
      exigeDireLEchec(true, "L edition a echoue. En revanche la suite passe sans erreur.")
    ).toBe(false)
  })

  it('sans echec reel, la garde reste muette quoi qu il soit ecrit', () => {
    expect(exigeDireLEchec(false, '✅ Fait — sans erreur.')).toBe(false)
  })
})

/**
 * LE COMPORTEMENT, pas le predicat. `exigeCorrigerEtPoursuivre` est une fonction pure d'un booleen :
 * le defaut T1 vivait au SITE D'APPEL, dans ce qu'on lui passait. Un test sur le predicat seul serait
 * tautologique — il l'etait dans ma premiere version, et n'aurait rien garde.
 */
function pilot(reponses: string[], echoue: (nom: string, appel: number) => boolean) {
  const sent: string[] = []
  let appels = 0
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: reponses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [
      { name: 'edit_file', args: {}, description: 'edite' },
      { name: 'get_state', args: {}, description: 'etat' }
    ]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async (nom: string) => {
      appels += 1
      return echoue(nom, appels)
        ? { ok: false, error: 'ENOENT: le chemin cible n existe pas' }
        : { ok: true, data: { ok: true } }
    })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent, bus }
}

const MARQUEUR = 'ta dernière action a ÉCHOUÉ et tu t’arrêtes sur ce constat'
const history: Message[] = [{ role: 'user', content: 'corrige le fichier de config' }]
const SOIGNEE = true

let racine = ''
beforeEach(() => {
  // Le registre des murs PERSISTE sur disque : sans racine temporaire ces tours ecriraient dans
  // l'APPDATA reel et se liraient les uns les autres.
  racine = mkdtempSync(join(tmpdir(), 'erreur-captee-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

const lancer = (p: AgentPilot): Promise<void> =>
  p.chat(history, () => {}, undefined, 8, 'conv-T1', undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)

describe('un echec ANCIEN et jamais repare est corrige avant la fin du tour', () => {
  it('un echec enjambe a l iteration 1 declenche encore la reprise qui rend la main aux commandes', async () => {
    // `edit_file` plante, l'agent l'ENJAMBE et fait autre chose qui reussit, puis conclut « Fait ».
    // L'echec n'a jamais ete repare : le tour ne doit pas se clore dessus.
    const { pilot: p, sent, bus } = pilot(
      [
        'Je corrige.<cmd>{"name":"edit_file","args":{}}</cmd>',
        'Je regarde autre chose.<cmd>{"name":"get_state","args":{}}</cmd>',
        '✅ Fait — config corrigee.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : commit.',
        'Chemin corrige.<cmd>{"name":"edit_file","args":{}}</cmd>',
        '✅ Fait — config reellement corrigee.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : commit.'
      ],
      (nom, appel) => nom === 'edit_file' && appel === 1
    )
    await lancer(p)
    const relance = sent.find((c) => c.includes(MARQUEUR))
    expect(relance, 'un echec non repare doit relancer, meme ancien').toBeDefined()
    // LE point : la reprise REND la main aux commandes, au lieu du seul aveu.
    expect(relance).toContain('ÉMETTRE DES COMMANDES')
    // Et le travail a REELLEMENT reprise : `edit_file` a ete rejoue.
    expect(bus.exec.mock.calls.filter((c) => c[0] === 'edit_file').length).toBe(2)
  })

  it('un echec RATTRAPE par un succes de la meme commande ne relance RIEN', async () => {
    // Le discriminant a preserver : generaliser ne doit pas noyer le cas deja correct.
    const { pilot: p, sent } = pilot(
      [
        'Je corrige.<cmd>{"name":"edit_file","args":{}}</cmd>',
        'Echec vu, je reprends.<cmd>{"name":"edit_file","args":{}}</cmd>',
        '✅ Fait — reprise aboutie.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
      ],
      (nom, appel) => nom === 'edit_file' && appel === 1
    )
    await lancer(p)
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(false)
  })
})
