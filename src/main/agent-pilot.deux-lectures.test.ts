import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import {
  AVIS_DEUX_LECTURES,
  CONSIGNE_DEUX_LECTURES,
  annonceDeLaLectureRetenue,
  consigneDeLectureRetenue
} from './deux-lectures'
import { composerPromptDeReprise } from './chat/relance-taches-de-fond'
import { promptDOrdre } from './messages-entre-fils-app'
import { promptDeReveil, promptDuLot, type PlanDeLots } from '../shared/plan-de-lots'
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
/** La réponse du petit modèle : chaque lecture et sa probabilité, en % (conv-1123). */
function reponse(...lectures: Array<[string, number]>): string {
  return JSON.stringify({ lectures: lectures.map(([texte, proba]) => ({ texte, proba })) })
}
const LECTURE_ARENA_767 =
  'une task (toujours la meme) facile à évaluer, pour lancer des /arena dessus et comparer les workflows'
const LECTURE_CODE_767 =
  'une task (toujours la meme) à corriger dans le code, assez petite pour etre évaluée via /arena'
const LECTURES_767 = reponse([LECTURE_ARENA_767, 52], [LECTURE_CODE_767, 48])

function banc(
  reponseDuLecteur: string | Error | (() => Promise<string>) | undefined,
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
    if (typeof reponseDuLecteur === 'function') return reponseDuLecteur()
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
  /** La ligne « Lecture retenue » affichée dans le fil, et son rang parmi les événements. */
  const annonce = () => {
    const rang = evenements.findIndex(
      (e) => e.kind === 'delta' && e.streamId === 'lectures:retenue'
    )
    const evenement = evenements[rang] as { text?: string } | undefined
    return { rang, texte: evenement?.text }
  }
  const rangDeCommande = (nom: string) =>
    evenements.findIndex((e) => e.kind === 'command' && e.name === nom)
  const argsDe = (nom: string): Record<string, unknown> | undefined =>
    bus.exec.mock.calls.find((appel) => appel[0] === nom)?.[1]
  return {
    jouer,
    evenements,
    lecteur,
    registry,
    bus,
    executees,
    fin,
    appelsModele,
    annonce,
    rangDeCommande,
    argsDe
  }
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
    // Relue pour la ligne (conv-1240), jamais réinterrogée : la quasi-égalité ne repose rien.
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.executees()).toEqual(['orchestrate'])
  })
})

describe('le jumeau : sans double lecture, rien ne change', () => {
  it('une réponse SANS lecture (ancien format `[]`) → le run part comme avant, sans annonce ni précision', async () => {
    const b = banc('{"lectures":[]}')
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.executees()).toEqual(['orchestrate'])
    expect(b.annonce().rang).toBe(-1)
    expect(b.argsDe('orchestrate')?.task).not.toContain('Lecture retenue')
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

  it('une reprise automatique (tâche de fond relancée) ne pose aucune question : ce n’est pas une demande de l’utilisateur (conv-1118)', async () => {
    // Le message écrit par Autowin lui-même, tel que `composerPromptDeReprise` le compose. Le
    // 2026-10-23, « tâche de fond » l'a fait passer pour un changement d'affichage (« fond »), et
    // l'utilisateur a dû choisir entre deux lectures d'un texte qu'il n'avait pas écrit.
    const reprise = composerPromptDeReprise([
      {
        commande: 'git status --short -- src/main/index.ts',
        cwd: 'D:\\AutoWinOS',
        issue: { type: 'sortie', code: 0 },
        sortie: 'M src/main/index.ts'
      }
    ])
    const lectures = JSON.stringify({
      lectures: [
        'Finir la modification de la tâche de fond relancée, reprendre là où tu t’étais arrêté',
        'Écarter la tâche de fond relancée, rien à reprendre là où tu t’étais arrêté'
      ]
    })
    const b = banc(lectures)
    await b.jouer([{ role: 'user', content: reprise }])
    expect(b.lecteur).not.toHaveBeenCalled()
    expect(b.executees()).not.toContain('ask')
    expect(b.registry.send).toHaveBeenCalledTimes(1)
  })

  /*
   * Un message COMPOSÉ PAR L'APP pour un autre fil (lot d'un plan, ordre d'un fil, réveil du chef)
   * n'a pas d'auteur humain à qui demander. Le 2026-10-27 (conv-1192), le lot 19 d'un plan s'est
   * arrêté sur « Ta demande peut se lire de deux façons » : personne pour cliquer, le plan l'a
   * compté « fait » sans une ligne écrite, et sa relance a été refusée.
   */
  const PLAN: PlanDeLots = {
    id: 'plan-test',
    chef: 'conv-chef',
    cle: 'cle',
    titre: 'Traduction',
    parallele: 1,
    plafondTours: 2,
    toursLances: 1,
    statut: 'en-cours',
    avertissements: [],
    creeLe: 0,
    lots: [
      { rang: 1, titre: 'Bilan', demande: DEMANDE_767, fichiers: [], etat: 'fait', fil: 'conv-lot' }
    ]
  }
  it.each([
    ['le message d’un lot de plan (conv-1192)', promptDuLot(PLAN, PLAN.lots[0])],
    ['un ordre d’un autre fil', promptDOrdre({ id: 'msg-1', de: 'conv-chef', texte: DEMANDE_767 })],
    ['le réveil du fil chef', promptDeReveil(PLAN, [1])]
  ])('%s ne pose aucune question : aucun humain ne l’a écrit', async (_nom, message) => {
    // Le modèle orchestre lui aussi : les trois points de passage sont armés, pas seulement `/scout`.
    const b = banc(LECTURES_767, [
      'Je lance le travail.\n<cmd>{"name":"orchestrate","args":{"task":"le travail du lot"}}</cmd>',
      'Fait.'
    ])
    await b.jouer([{ role: 'user', content: message }])
    expect(b.lecteur).not.toHaveBeenCalled()
    expect(b.executees()).toContain('orchestrate')
    expect(b.executees()).not.toContain('ask')
  })

  it('une lecture qui DOMINE (70/30) ne pose aucune question : le run part, annoncé et sur ELLE (conv-1123)', async () => {
    const b = banc(reponse([LECTURE_ARENA_767, 70], [LECTURE_CODE_767, 30]))
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.executees()).toEqual(['orchestrate'])
    // La ligne est dans le fil AVANT le run : l'utilisateur peut corriger sans attendre la fin.
    const { rang, texte } = b.annonce()
    expect(texte?.trim()).toBe(annonceDeLaLectureRetenue(LECTURE_ARENA_767, LECTURE_CODE_767))
    expect(rang).toBeGreaterThanOrEqual(0)
    expect(rang).toBeLessThan(b.rangDeCommande('orchestrate'))
    // Le run reçoit la demande ENTIÈRE, plus la lecture annoncée : il ne peut pas faire l'autre.
    const tache = String(b.argsDe('orchestrate')?.task)
    expect(tache.startsWith(DEMANDE_767)).toBe(true)
    expect(tache).toContain(
      `Lecture retenue de la demande, annoncée à l'utilisateur : « ${LECTURE_ARENA_767} »`
    )
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
    const lectures = reponse(
      ['une task toujours la meme, facile à évaluer via arena pour comparer les workflows', 50],
      [
        'une task toujours la meme à corriger dans le code, pratique pour etre évaluée via arena',
        50
      ]
    )
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
    const lectures = reponse(
      ['écarter le contenu de la barre de scroll dans les widgets, sans la retirer', 50],
      ['retirer la barre de scroll des widgets, qui masque le contenu', 50]
    )
    const b = banc(lectures)
    await b.jouer([{ role: 'user', content: demande }])
    expect(b.registry.send).not.toHaveBeenCalled()
    expect(b.executees()).toEqual(['ask'])
  })

  it('l’orchestrate du modèle sur une lecture dominante part, annoncé, avec la lecture dans sa tâche racine (conv-1123)', async () => {
    const demande =
      'trouve une task toujours la meme, pratique pour etre évaluée via arena, et lance le travail'
    const retenue =
      'une task toujours la meme, facile à évaluer via arena pour comparer les workflows'
    const ecartee =
      'une task toujours la meme à corriger dans le code, pratique pour etre évaluée via arena'
    const b = banc(reponse([retenue, 80], [ecartee, 20]), [
      `Je lance le travail.\n<cmd>{"name":"orchestrate","args":{"task":"${demande}"}}</cmd>`,
      'Run terminé.'
    ])
    await b.jouer([{ role: 'user', content: demande }])
    expect(b.executees()).toEqual(['orchestrate'])
    expect(b.annonce().texte?.trim()).toBe(annonceDeLaLectureRetenue(retenue, ecartee))
    expect(b.annonce().rang).toBeLessThan(b.rangDeCommande('orchestrate'))
    // `rootTask` est l'autorité du run (commands.ts) : c'est là que la lecture doit arriver.
    const racine = String(b.argsDe('orchestrate')?.rootTask)
    expect(racine.startsWith(demande)).toBe(true)
    expect(racine).toContain(`« ${retenue} »`)
  })

  it('un changement d’affichage sur une lecture dominante : annoncé AVANT le modèle, qui la reçoit (conv-1123)', async () => {
    const demande = 'la barre de scroll dans les widgets elle masque un peu le contenu'
    const retenue = 'écarter le contenu de la barre de scroll dans les widgets, sans la retirer'
    const ecartee = 'retirer la barre de scroll des widgets, qui masque le contenu'
    const b = banc(reponse([retenue, 85], [ecartee, 15]))
    await b.jouer([{ role: 'user', content: demande }])
    expect(b.executees()).not.toContain('ask')
    expect(b.registry.send).toHaveBeenCalledTimes(1)
    expect(b.annonce().texte?.trim()).toBe(annonceDeLaLectureRetenue(retenue, ecartee))
    const envoye = b.appelsModele[0].map((m) => String(m.content)).join('\n')
    for (const ligne of consigneDeLectureRetenue(retenue, ecartee).split('\n'))
      expect(envoye).toContain(ligne)
  })

  it('une question de l’utilisateur n’est pas une demande de changement : la ligne, jamais la question', async () => {
    const demande = 'comment rendre mon graph beaucoup plus clair ?'
    const b = banc(
      reponse(
        ['comment rendre mon graph beaucoup plus clair à lire', 52],
        ['comment rendre mon graph beaucoup plus clair de couleurs', 48]
      )
    )
    await b.jouer([{ role: 'user', content: demande }])
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.executees()).not.toContain('ask')
    expect(b.registry.send).toHaveBeenCalledTimes(1)
    expect(b.annonce().texte?.trim()).toBe(
      annonceDeLaLectureRetenue(
        'comment rendre mon graph beaucoup plus clair à lire',
        'comment rendre mon graph beaucoup plus clair de couleurs'
      )
    )
  })
})

describe('la ligne à CHAQUE message (conv-1240, « met le tout le temps »)', () => {
  const COMPRISE =
    'Afficher la ligne « Lecture retenue » à chaque message, et plus seulement de temps en temps'

  it('un message sans ambiguïté affiche sa lecture, avant la fin du tour, sans question', async () => {
    const b = banc(reponse([COMPRISE, 100]))
    await b.jouer([{ role: 'user', content: 'met le tout le temps' }])
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.executees()).not.toContain('ask')
    expect(b.registry.send).toHaveBeenCalledTimes(1)
    const { rang, texte } = b.annonce()
    expect(texte?.trim()).toBe(annonceDeLaLectureRetenue(COMPRISE))
    expect(rang).toBeLessThan(b.evenements.findIndex((e) => e.kind === 'done'))
  })

  it('une relance (« go ») est lue avec la FIN du dernier message, et ne pose jamais la question', async () => {
    const proposition = '👉 Recommandé : lancer le build sur la rivière de la Carte du projet.'
    const b = banc(
      reponse(
        ['go : lancer le build sur la rivière de la Carte du projet', 50],
        ['go : relancer le scout de la Carte du projet', 50]
      )
    )
    await b.jouer([
      { role: 'user', content: 'regarde la carte du projet et dis-moi ce qui cloche' },
      { role: 'assistant', content: `Voici ce que j'ai vu. ${'x'.repeat(3000)} ${proposition}` },
      { role: 'user', content: 'go' }
    ])
    expect(b.lecteur).toHaveBeenCalledTimes(1)
    expect(b.lecteur.mock.calls[0][1]).toContain(proposition)
    expect(b.executees()).not.toContain('ask')
    expect(b.annonce().texte).toContain('lancer le build sur la rivière')
  })

  it('le /scout sans ambiguïté part annoncé, sa lecture jointe à la tâche', async () => {
    const comprise = 'une task (toujours la meme) pratique pour etre évaluée via /arena'
    const b = banc(reponse([comprise, 100]))
    await b.jouer([{ role: 'user', content: DEMANDE_767 }])
    expect(b.executees()).toEqual(['orchestrate'])
    expect(b.annonce().texte?.trim()).toBe(annonceDeLaLectureRetenue(comprise))
    expect(b.annonce().rang).toBeLessThan(b.rangDeCommande('orchestrate'))
    expect(String(b.argsDe('orchestrate')?.task)).toContain(`« ${comprise} ».`)
  })

  it('une lecture arrivée APRÈS la fin du tour n’est plus écrite sous un message clos', async () => {
    let repondre: (texte: string) => void = () => undefined
    const b = banc(() => new Promise<string>((resolve) => (repondre = resolve)))
    await b.jouer([{ role: 'user', content: 'met le tout le temps' }])
    expect(b.evenements.some((e) => e.kind === 'done')).toBe(true)
    repondre(reponse([COMPRISE, 100]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(b.annonce().rang).toBe(-1)
  })
})
