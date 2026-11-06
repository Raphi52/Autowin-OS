import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import { ENTETE_GROW_AU_DEBUT, RAPPEL_GROW_AU_DEBUT } from '../chat/grow-au-debut'
import { setNativeEnablement } from '../app/native-registry'
import type { Message, SendResult } from '../providers/types'
import { forgetChatSession } from '../runs/chat-session-store'
import { oublierCompteRenduNonVu } from '../runs/compte-rendu-non-vu-store'

/**
 * GROW CHARGÉE PAR LE CODE AU DÉBUT DE CHAQUE DEMANDE D'ACTION (conv-1445, 2026-11-03).
 *
 * Le VRAI tour de chat tourne (`AgentPilot.chat`, vrai assemblage du message, vrai SKILL.md lu sur
 * le disque du dépôt) ; seul le modèle est faux, et on lit ce qui lui est ENVOYÉ. Avant ce
 * branchement, une demande d'action ne recevait la procédure grow que si le modèle pensait à
 * `skill_charger` : aucun de ces envois ne la portait.
 */
const CONV = `conv-grow-au-debut-${process.pid}`
const BLOC = '=== SKILL GROW (kit) ==='

function banc(options: { reprise?: boolean } = {}) {
  const appelsModele: Message[][] = []
  let rang = 0
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[]): Promise<SendResult> => {
      appelsModele.push(messages)
      rang += 1
      return {
        text: 'Réponse du modèle.',
        provider: 'claude',
        ...(options.reprise ? { sessionId: `sess-${rang}` } : {})
      } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => options.reprise === true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'etat' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  const pilote = new AgentPilot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bus as any
  )
  const jouer = (fil: Message[]) => pilote.chat(fil, () => {}, undefined, 4, CONV)
  /** Ce que le modèle a reçu à son N-ième appel (0 = premier). */
  const servi = (n: number) =>
    (appelsModele[n] ?? [])
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')
  return { jouer, servi, appelsModele }
}

const utilisateur = (content: string): Message => ({ role: 'user', content }) as Message
const agent = (content: string): Message => ({ role: 'assistant', content }) as Message
const occurrences = (texte: string, motif: string) => texte.split(motif).length - 1

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'grow-au-debut-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  forgetChatSession(CONV)
  oublierCompteRenduNonVu(CONV)
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

describe('début du tour : grow part avec chaque demande d’action', () => {
  it('demande d’action → la procédure grow entière part au modèle', async () => {
    const b = banc()
    await b.jouer([utilisateur('corrige le bouton Envoyer du chat, il reste gris')])

    expect(b.servi(0)).toContain(ENTETE_GROW_AU_DEBUT)
    expect(b.servi(0)).toContain(BLOC)
    // Le corps vient du vrai fichier du kit, pas d'une copie.
    expect(b.servi(0)).toContain('Ce que grow peut créer')
  })

  it('symptôme nu → grow part aussi (c’est une correction à mener)', async () => {
    const b = banc()
    await b.jouer([utilisateur("dans l'écran d'accueil c'est tout flou au loin")])

    expect(b.servi(0)).toContain(BLOC)
  })

  it('question → aucune procédure grow', async () => {
    const b = banc()
    await b.jouer([utilisateur('pourquoi le bouton Envoyer reste gris ?')])

    expect(b.appelsModele).toHaveLength(1)
    expect(b.servi(0)).not.toContain(BLOC)
    expect(b.servi(0)).not.toContain('GROW —')
  })

  it('/grow tapé → la procédure part UNE fois, sans l’en-tête automatique', async () => {
    const b = banc()
    await b.jouer([utilisateur('/grow sur la demande que tu viens de terminer')])

    expect(occurrences(b.servi(0), BLOC)).toBe(1)
    expect(b.servi(0)).not.toContain(ENTETE_GROW_AU_DEBUT)
  })

  it('session reprise → un rappel d’une ligne, pas la procédure entière une seconde fois', async () => {
    const b = banc({ reprise: true })
    await b.jouer([utilisateur('ajoute un bouton Copier sous chaque réponse')])
    await b.jouer([
      utilisateur('ajoute un bouton Copier sous chaque réponse'),
      agent('Fait.'),
      utilisateur('renomme-le en Copier le texte')
    ])

    expect(b.servi(0)).toContain(BLOC)
    expect(b.servi(1)).toContain('Suite de NOTRE conversation')
    expect(b.servi(1)).toContain(RAPPEL_GROW_AU_DEBUT)
    expect(b.servi(1)).not.toContain(ENTETE_GROW_AU_DEBUT)
  })

  it('grow désactivée dans les réglages → ni procédure ni rappel', async () => {
    setNativeEnablement('skills', 'grow', false)
    const b = banc()
    await b.jouer([utilisateur('corrige le bouton Envoyer du chat')])

    expect(b.servi(0)).not.toContain(BLOC)
    expect(b.servi(0)).not.toContain('GROW —')
  })
})
