import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import { AVIS_DEUX_LECTURES, CONSIGNE_DEUX_LECTURES } from './deux-lectures'
import type { PilotEvent } from './agent-pilot'
import type { Message, SendResult } from './providers/types'
import { forgetChatSession } from './runs/chat-session-store'
import { oublierCompteRenduNonVu } from './runs/compte-rendu-non-vu-store'

/**
 * REJEU DE conv-767 : DEUX LECTURES PLAUSIBLES → UNE QUESTION, ET AUCUN RUN PAYÉ (conv-1092).
 *
 * Le 2026-09-22, « /scout une task (toujours la meme) qui est pratique pour etre évaluée via
 * /arena » est parti DIRECTEMENT en orchestration, sans qu'aucun modèle ne lise la demande : 2,47 $
 * pour un scout de code (`Metier/RechercheArbre.cs`). Réponse de l'utilisateur : « t'as mal compris
 * je veux une task qui est facile a évaluer pour lancer des arena dessus et vraiment pouvoir
 * comparer les workflows ». Le lendemain, conv-768 a repayé 1,36 $ sur la même lecture.
 *
 * Le petit modèle est simulé : ce test prouve le BRANCHEMENT (la question remplace le run, une
 * seule fois, jamais sans humain, jamais bloquant en panne), pas le jugement du modèle.
 */
const CONV = `conv-deux-lectures-${process.pid}`
const DEMANDE_767 =
  '/scout une task (toujours la meme) qui est pratique pour etre évaluée via /arena'
const LECTURES_767 = JSON.stringify({
  lectures: [
    'une task (toujours la meme) facile à évaluer, pour lancer des /arena dessus et comparer les workflows',
    'une task (toujours la meme) à corriger dans le code, assez petite pour etre évaluée via /arena'
  ]
})

function banc(
  reponseDuLecteur: string | Error | undefined,
  reponsesDuModele: string[] = ['Réponse du modèle.']
) {
  const evenements: PilotEvent[] = []
  const appelsModele: Message[][] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[]): Promise<SendResult> => {
      appelsModele.push(messages)
      return {
        text: reponsesDuModele[Math.min(appelsModele.length - 1, reponsesDuModele.length - 1)],
        provider: 'claude'
      } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => false)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [
      { name: 'orchestrate', args: {}, description: 'lancer un run' },
      { name: 'ask', args: {}, description: 'poser une question' }
    ]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === 'orchestrate'
        ? { ok: true, data: { status: 'succeeded', valid: true, result: 'run payé' } }
        : name === 'ask'
          ? { ok: true, data: args }
          : { ok: true, data: { ok: true } }
    )
  }
  const lecteur = vi.fn(async (systeme: string, charge: string) => {
    void systeme
    void charge
    if (reponseDuLecteur instanceof Error) throw reponseDuLecteur
    return reponseDuLecteur ?? '{"lectures":[]}'
  })
  const pilote = new AgentPilot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bus as any,
    undefined,
    undefined,
    undefined,
    false,
    reponseDuLecteur === undefined ? undefined : lecteur
  )
  const jouer = (historique: Message[], sendLimits?: { tourDeFond?: boolean }) =>
    pilote.chat(
      historique,
      (e) => evenements.push(e),
      undefined,
      12,
      CONV,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      sendLimits
    )
  const executees = () => bus.exec.mock.calls.map((appel) => appel[0])
  const fin = () => evenements.find((e) => e.kind === 'done') as { text?: string } | undefined
  return { jouer, lecteur, registry, bus, executees, fin, appelsModele }
}

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'deux-lectures-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  forgetChatSession(CONV)
  oublierCompteRenduNonVu(CONV)
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

describe('rejeu de conv-767 : le /scout ambigu ne part pas, une question le remplace', () => {
  it('pose UNE question aux deux lectures, sans payer de run ni appeler le modèle du chat', async () => {
    const b = banc(LECTURES_767)
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])

    expect(b.executees()).not.toContain('orchestrate')
    expect(b.executees().filter((nom) => nom === 'ask')).toHaveLength(1)
    expect(b.registry.send).not.toHaveBeenCalled()
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.lecteur.mock.calls[0][0]).toBe(CONSIGNE_DEUX_LECTURES)
    expect(b.lecteur.mock.calls[0][1]).toContain(DEMANDE_767)
    // Sans ce que font /scout et /arena, le vrai modèle lisait conv-767 comme nette (rejeu du 22/10).
    expect(b.lecteur.mock.calls[0][1]).toMatch(/- \/scout : .+\n- \/arena : .+/u)

    const args = b.bus.exec.mock.calls.find((appel) => appel[0] === 'ask')?.[1] as {
      options: { libelle: string; envoi: string; recommande?: true }[]
    }
    // Chaque réponse renvoie SA lecture, sous la même commande : le clic relance le bon /scout.
    expect(args.options.map((o) => o.envoi)).toEqual([
      '/scout une task (toujours la meme) facile à évaluer, pour lancer des /arena dessus et comparer les workflows',
      '/scout une task (toujours la meme) à corriger dans le code, assez petite pour etre évaluée via /arena'
    ])
    expect(args.options[0].recommande).toBe(true)
    expect(b.fin()?.text).toBe(AVIS_DEUX_LECTURES)
  })

  it('la lecture choisie part en run, sans seconde question', async () => {
    const b = banc(LECTURES_767)
    await b.jouer([
      { role: 'user', content: DEMANDE_767 },
      { role: 'assistant', content: AVIS_DEUX_LECTURES },
      {
        role: 'user',
        content:
          '/scout une task (toujours la meme) facile à évaluer, pour lancer des /arena dessus et comparer les workflows'
      }
    ])
    expect(b.lecteur).not.toHaveBeenCalled()
    expect(b.executees()).toEqual(['orchestrate'])
  })
})

describe('le jumeau : sans double lecture, rien ne change', () => {
  it('une seule lecture → le run part comme avant', async () => {
    const b = banc('{"lectures":[]}')
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.executees()).toEqual(['orchestrate'])
  })

  it('un lecteur en panne ne bloque jamais le run', async () => {
    const b = banc(new Error('quota atteint'))
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])
    expect(b.executees()).toEqual(['orchestrate'])
  })

  it('un tour de fond (tâche planifiée) ne pose aucune question : personne n’y répondrait', async () => {
    const b = banc(LECTURES_767)
    await b.jouer([{ role: 'user', content: DEMANDE_767 }], { tourDeFond: true })
    expect(b.lecteur).not.toHaveBeenCalled()
    expect(b.executees()).toEqual(['orchestrate'])
  })

  it('sans lecteur branché (fixtures, tests existants), le comportement d’avant', async () => {
    const b = banc(undefined)
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])
    expect(b.executees()).toEqual(['orchestrate'])
  })
})

describe('les deux autres points de passage', () => {
  it('l’orchestrate émis par le modèle est remplacé par la question, et le tour s’arrête', async () => {
    const demande =
      'trouve une task toujours la meme, pratique pour etre évaluée via arena, et lance le travail'
    const lectures = JSON.stringify({
      lectures: [
        'une task toujours la meme, facile à évaluer via arena pour comparer les workflows',
        'une task toujours la meme à corriger dans le code, pratique pour etre évaluée via arena'
      ]
    })
    const b = banc(lectures, [
      `Je lance le travail.\n<cmd>{"name":"orchestrate","args":{"task":"${demande}"}}</cmd>`
    ])
    await b.jouer([{ role: 'user', content: demande }])
    expect(b.executees()).toEqual(['ask'])
    // Une seule génération : aucune relance « question sans lecture » derrière.
    expect(b.appelsModele).toHaveLength(1)
    expect(b.fin()?.text).toContain(AVIS_DEUX_LECTURES)
  })

  it('une demande de changement d’affichage est lue AVANT de passer la main au modèle (conv-542)', async () => {
    const demande = 'la barre de scroll dans les widgets elle masque un peu le contenu'
    const lectures = JSON.stringify({
      lectures: [
        'écarter le contenu de la barre de scroll dans les widgets, sans la retirer',
        'retirer la barre de scroll des widgets, qui masque le contenu'
      ]
    })
    const b = banc(lectures)
    await b.jouer([{ role: 'user', content: demande }])
    expect(b.registry.send).not.toHaveBeenCalled()
    expect(b.executees()).toEqual(['ask'])
  })

  it('une question de l’utilisateur n’est pas une demande de changement : aucun appel au lecteur', async () => {
    const b = banc(LECTURES_767)
    await b.jouer([{ role: 'user', content: 'comment rendre mon graph beaucoup plus clair ?' }])
    expect(b.lecteur).not.toHaveBeenCalled()
    expect(b.registry.send).toHaveBeenCalledTimes(1)
  })
})
