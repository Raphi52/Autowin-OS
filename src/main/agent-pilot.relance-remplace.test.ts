import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

/*
 * ISOLATION : un echec d'action est inscrit au registre des murs, qui PERSISTE sur disque. Sans
 * racine temporaire, le test « echec tu » ecrirait dans l'APPDATA reel (meme garde que
 * agent-pilot.correction-apres-echec.test.ts).
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'relance-remplace-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

/**
 * UNE RELANCE QUI FAIT REFAIRE LA REPONSE LA REMPLACE — ELLE NE S'Y AJOUTE PAS (D2, conv-267).
 *
 * Mesure du 2026-10-11 sur de vrais tours (copie du chantier « outils directs du chat ») : le texte
 * de chaque appel au modele part en direct dans la bulle. Quand la garde « conclusion absente » ou
 * « chiffre non verifie » relance le modele pour qu'il REFASSE sa reponse, l'ancienne restait
 * affichee et la nouvelle s'y ajoutait : la premiere phrase deux fois (2 tours sur 2), puis deux
 * blocs « ✅ Fait » sur un tour qui demandait un nombre. Le moteur rendait pourtant UNE reponse
 * (`done`) : le doublon naissait dans le fil, qui assemble les flux diffuses.
 *
 * L'oracle est donc le VRAI reducteur du fil (`reduceChatTurn`), nourri des evenements du pilote :
 * c'est lui qui construit ce que l'utilisateur lit, et ce qui est enregistre.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

/** Ce que le fil affiche : les evenements du pilote passes dans le reducteur du fil. */
function texteDuFil(events: PilotEvent[]): string {
  let etat = createChatTurn('tour-test')
  for (const e of events) {
    const ev = e as { kind: string; streamId?: string; text?: string; iteration?: number }
    let tourEvent: ChatTurnEvent | undefined
    if (ev.kind === 'delta' && ev.text && ev.streamId)
      tourEvent = { kind: 'delta', streamId: ev.streamId, text: ev.text }
    else if (ev.kind === 'stream-reset' && ev.streamId)
      tourEvent = { kind: 'stream-reset', streamId: ev.streamId }
    // Meme correspondance que le fil (chat-view-model.ts) pour un texte non diffuse.
    else if (ev.kind === 'think' && ev.text)
      tourEvent = { kind: 'delta', streamId: `fallback:${ev.iteration ?? 0}`, text: ev.text }
    if (tourEvent) etat = reduceChatTurn(etat, tourEvent)
  }
  return etat.parts
    .filter((p): p is Extract<typeof p, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}

const occurrences = (texte: string, motif: string): number => texte.split(motif).length - 1

type Issue = { ok: boolean; data?: unknown; error?: string }
const REUSSITE: Issue = { ok: true, data: { tab: 'chat', stored: true } }

async function jouer(
  demande: string,
  reponses: string[],
  /** Issue de chaque commande, dans l'ordre ; au-delà, réussite. */
  issues: Issue[] = []
): Promise<{ fil: string; appels: number; consignes: string[] }> {
  const consignes: string[] = []
  const send = vi.fn(
    async (
      _provider: string,
      messages: { content: string }[],
      _options: unknown,
      onChunk?: (chunk: { delta: string }) => void
    ) => {
      consignes.push(messages.map((m) => m.content).join('\n'))
      const text = reponses.shift() ?? ''
      // Diffusion EN DIRECT, comme le CLI : c'est elle qui remplit la bulle avant toute garde.
      onChunk?.({ delta: text })
      return { text, provider: 'claude' }
    }
  )
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
  }
  const bus = {
    catalog: () => [
      { name: 'get_state', args: {}, description: 'etat' },
      { name: 'remember', args: {}, description: 'memoire' },
      { name: 'run', args: {}, description: 'commande' }
    ],
    snapshotForPrompt,
    exec: vi.fn(async () => issues.shift() ?? REUSSITE)
  }
  const events: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: demande }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-relance-remplace',
    undefined, // signal
    undefined, // drainDirectives
    undefined, // bindingOverride
    undefined, // turnId
    undefined, // runtimeBinding
    undefined, // recoveredProviderCall
    undefined, // onProviderJournal
    undefined, // sendLimits
    undefined, // routingUserMessageOverride
    undefined, // tourCoupePourCeMessage
    true // exigerExperienceSoignee : la politique que la surface de chat active en vrai
  )
  return { fil: texteDuFil(events), appels: send.mock.calls.length, consignes }
}

const CLOTURE =
  '\n\n✅ Fait\n1. Lu l’état de l’app.\n\n📍 Maintenant : répondu.\n⏳ Reste à faire : aucune étape.\n👉 Recommandé : aucune suite.'

describe('relance de forme — la nouvelle réponse REMPLACE l’ancienne dans le fil', () => {
  it('conclusion absente : la phrase sans clôture n’est plus affichée deux fois', async () => {
    const { fil, appels, consignes } = await jouer('quel onglet est actif ?', [
      'Je regarde.<cmd>{"name":"get_state","args":{}}</cmd>',
      'L’onglet actif est chat.',
      `L’onglet actif est chat.${CLOTURE}`
    ])
    expect(appels).toBe(3)
    expect(consignes.at(-1)).toContain('ta réponse ne CONCLUT pas')
    expect(occurrences(fil, 'L’onglet actif est chat.')).toBe(1)
    expect(occurrences(fil, '✅ Fait')).toBe(1)
    // Le modele sait que sa reponse REMPLACE la precedente : il la redonne en entier.
    expect(consignes.at(-1)).toContain('REMPLACE')
    // Le texte d'un appel NON relance reste : seule la reponse refaite est remplacee.
    expect(fil).toContain('Je regarde.')
  })

  it('chiffre non vérifié : la réponse vérifiée remplace la première, sans second bloc', async () => {
    const { fil, appels, consignes } = await jouer('combien de fichiers dans src ?', [
      `Il y a 12 fichiers dans src.`,
      `Il y a 12 fichiers dans src, nombre relu.`
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('SANS avoir appelé la moindre commande')
    expect(occurrences(fil, 'Il y a 12 fichiers dans src')).toBe(1)
    expect(fil).toContain('nombre relu')
    expect(consignes.at(-1)).toContain('REMPLACE')
  })

  it('conclusion absente après un dépôt mémoire : même remplacement, troisième point de relance', async () => {
    const { fil, appels, consignes } = await jouer('retiens que le port est 9240', [
      'Leçon déposée : le port est 9240.<cmd>{"name":"remember","args":{"type":"domain"}}</cmd>',
      `Leçon déposée : le port est 9240.${CLOTURE}`
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('ta réponse ne CONCLUT pas')
    expect(occurrences(fil, 'Leçon déposée : le port est 9240.')).toBe(1)
    expect(occurrences(fil, '✅ Fait')).toBe(1)
  })

  it('échec tu : l’aveu de l’échec remplace la réponse qui le taisait', async () => {
    const { fil, appels, consignes } = await jouer(
      'quel onglet est actif ?',
      [
        'Je lis l’état.<cmd>{"name":"get_state","args":{}}</cmd>',
        // Meme commande, meme cible : l'echec est rattrape, la reprise apres echec ne mord pas.
        'Je relis l’état.<cmd>{"name":"get_state","args":{}}</cmd>',
        `L’onglet actif est chat.${CLOTURE}`,
        `L’onglet actif est chat. La première lecture de l’état a échoué, la seconde a abouti.${CLOTURE}`
      ],
      [{ ok: false, error: 'bus indisponible' }]
    )
    expect(appels).toBe(4)
    expect(consignes.at(-1)).toContain('ta réponse n’en dit rien')
    expect(occurrences(fil, 'L’onglet actif est chat.')).toBe(1)
    expect(occurrences(fil, '✅ Fait')).toBe(1)
    expect(fil).toContain('a échoué')
    // Le texte des appels non relancés reste, avec leurs cartes d'action.
    expect(fil).toContain('Je lis l’état.')
    expect(fil).toContain('Je relis l’état.')
    expect(consignes.at(-1)).toContain('REMPLACE')
  })

  it('preuve promise : le compte-rendu remplace la promesse « je te tiens au courant »', async () => {
    const { fil, appels, consignes } = await jouer('lance le contrôle de l’app', [
      'Je lance le contrôle.<cmd>{"name":"get_state","args":{}}</cmd>',
      'Contrôle lancé, je te tiens au courant dès qu’il a fini.',
      `Contrôle terminé : l’onglet actif est chat.${CLOTURE}`
    ])
    expect(appels).toBe(3)
    expect(consignes.at(-1)).toContain('PROMET un compte-rendu ultérieur')
    expect(fil).not.toContain('je te tiens au courant')
    expect(fil).toContain('Contrôle terminé')
    expect(fil).toContain('Je lance le contrôle.')
    expect(occurrences(fil, '✅ Fait')).toBe(1)
    expect(consignes.at(-1)).toContain('REMPLACE')
  })

  it('bloc visuel non fermé : le bloc ré-émis remplace le bloc cassé', async () => {
    const { fil, appels, consignes } = await jouer('fais-moi un résumé visuel', [
      '```html-render\n<p>Résumé du jour</p>\n</html-render>',
      '```html-render\n<p>Résumé du jour</p>\n```'
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('sans jamais le REFERMER')
    expect(occurrences(fil, '<p>Résumé du jour</p>')).toBe(1)
    expect(fil).not.toContain('</html-render>')
    expect(consignes.at(-1)).toContain('REMPLACE')
  })

  // conv-267 (2026-10-12) : le tour réel du ping de 90 s était relancé alors que le nombre venait
  // de la sortie de `run`. Une commande qui a VRAIMENT tourné vaut une lecture pour cette garde.
  it('chiffre tiré de la sortie d’un run lancé : aucune relance, un seul appel au modèle', async () => {
    const { fil, appels, consignes } = await jouer(
      'combien de réponses le ping a-t-il reçues ?',
      [
        'Je lance le ping.<cmd>{"name":"run","args":{"commande":"ping -n 3 127.0.0.1"}}</cmd>',
        `Le ping a reçu 3 réponses.${CLOTURE}`
      ],
      [{ ok: true, data: { lance: true, exitCode: 0, detail: 'envoyés = 3, reçus = 3' } }]
    )
    expect(consignes.some((c) => c.includes('SANS avoir appelé la moindre commande'))).toBe(false)
    expect(appels).toBe(2)
    expect(occurrences(fil, 'Le ping a reçu 3 réponses.')).toBe(1)
  })

  it('run REFUSÉ : rien n’a tourné, la garde mord toujours', async () => {
    const { consignes } = await jouer(
      'combien de réponses le ping a-t-il reçues ?',
      [
        'Je lance le ping.<cmd>{"name":"run","args":{"commande":"ping -n 3 127.0.0.1"}}</cmd>',
        `Le ping a reçu 3 réponses.${CLOTURE}`,
        `Je n’ai pas pu lancer le ping : la commande a été refusée.${CLOTURE}`
      ],
      [{ ok: true, data: { lance: false, detail: 'Commande refusée : non autorisée' } }]
    )
    expect(consignes.some((c) => c.includes('SANS avoir appelé la moindre commande'))).toBe(true)
  })
})
