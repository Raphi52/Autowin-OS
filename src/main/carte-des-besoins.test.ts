import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  assemblerLaCarte,
  creerCalculateurDeCarte,
  demandesDuFil,
  type ConversationPourLaCarte,
  type MessageStockePourLaCarte,
  type RunPourLaCarte
} from './carte-des-besoins'
import { COMPACT_REQUEST } from '../shared/context-gauge'
import type { DemandeDeLaCarte } from '../shared/carte-des-besoins'
import { cleDuJournal, type EntreeDuJournal } from './journal-des-besoins'

/**
 * CARTE DES BESOINS — lot 1 (conv-1089, 2026-10-22).
 *
 * Les entrées qui font échouer une version fausse : des messages au format STOCKÉ (`ts`, sans
 * `done`), pas au format de l'affichage — la carte lit le store, pas la vue ; un tour fini sans
 * vérification (jamais « prouvé ») ; une vérification rouge (« refusé ») ; un tour qui tourne encore ;
 * une orientation, un compactage et une suite proposée (jamais des demandes) ; un fil sans dossier
 * rangé sous le dépôt par défaut, comme dans la barre latérale ; un run bloqué rattaché par trois
 * chemins différents, et un run vert qu'il ne faut PAS montrer.
 */

const user = (content: string, ts: number, extra: Record<string, unknown> = {}) =>
  ({ role: 'user', content, ts, messageId: `u${ts}`, ...extra }) as MessageStockePourLaCarte

const asst = (ts: number, parts: unknown[], extra: Record<string, unknown> = {}) =>
  ({
    role: 'assistant',
    content: '',
    status: 'completed',
    ts,
    parts,
    ...extra
  }) as unknown as MessageStockePourLaCarte

const texte = (text: string): unknown => ({ kind: 'text', text })
const verify = (command: string, exitCode: number): unknown => ({
  kind: 'action',
  name: 'verify',
  ok: true,
  data: { command, exitCode, ok: exitCode === 0 }
})

const conv = (
  id: string,
  messages: MessageStockePourLaCarte[],
  extra: Partial<ConversationPourLaCarte> = {}
): ConversationPourLaCarte => ({ id, title: `Titre ${id}`, messages, ...extra })

const run = (subject: string, extra: Partial<RunPourLaCarte> = {}): RunPourLaCarte => ({
  subject,
  session: 'session-cli',
  path: `C:/runs/${subject}/RUN.md`,
  mtime: 5_000,
  summary: { status: 'red' },
  blocked: true,
  ...extra
})

function carte(
  conversations: ConversationPourLaCarte[],
  runs: RunPourLaCarte[] = [],
  dossierParDefaut?: string
) {
  const demandesParConversation = new Map<string, DemandeDeLaCarte[]>(
    conversations.map((c) => [c.id, demandesDuFil(c)])
  )
  return assemblerLaCarte({
    conversations,
    demandesParConversation,
    runs,
    ...(dossierParDefaut ? { dossierParDefaut } : {}),
    calculeeA: 9_999,
    dureeMs: 1
  })
}

describe('demandesDuFil — l’état suit la PREUVE, lu depuis le fil stocké', () => {
  it('prouvé, refusé, sans preuve, en cours : un état par demande', () => {
    const demandes = demandesDuFil(
      conv('c1', [
        user('corrige le bouton', 1_000),
        asst(1_100, [verify('npm test', 0)]),
        user('ajoute un filtre', 2_000),
        asst(2_100, [verify('npm run typecheck', 1)]),
        user('explique le cache', 3_000),
        asst(3_100, [texte('Voilà comment il marche.')]),
        user('refais la vue', 4_000),
        asst(4_100, [texte('je lis')], { status: 'streaming' })
      ])
    )
    expect(demandes.map((d) => [d.titre, d.statut])).toEqual([
      ['corrige le bouton', 'prouve'],
      ['ajoute un filtre', 'refuse'],
      ['explique le cache', 'sans-preuve'],
      ['refais la vue', 'en-cours']
    ])
    expect(demandes[0]).toMatchObject({
      conversationId: 'c1',
      conversationTitre: 'Titre c1',
      rang: 0,
      messageId: 'u1000',
      constat: 'npm test → exit 0',
      debut: 1_000
    })
  })

  it('ni orientation, ni compactage, ni suite proposée ne sont des demandes', () => {
    const demandes = demandesDuFil(
      conv('c1', [
        user('construis la carte', 1_000),
        user('ajoute aussi un repère', 1_050, { orientation: true }),
        asst(1_100, [
          texte(
            ['Fini.', '', '✅ Fait', '1. une chose', '👉 Recommandé', 'Lancer le juge.'].join('\n')
          )
        ]),
        user(COMPACT_REQUEST, 2_000),
        asst(2_100, [texte('Résumé du fil.')])
      ])
    )
    expect(demandes.map((d) => d.titre)).toEqual(['construis la carte'])
  })
})

describe('assemblerLaCarte — rangée par projet comme la barre latérale', () => {
  it('dossier, catégorie, repli sur le dépôt par défaut ; le projet le plus récent d’abord', () => {
    const resultat = carte(
      [
        conv('ancien', [user('vieille demande', 1_000), asst(1_100, [verify('npm test', 0)])], {
          projectPath: 'D:\\GIT\\Contoso\\'
        }),
        conv('perso', [user('range mes notes', 3_000), asst(3_100, [texte('ok')])], {
          categorie: 'Perso',
          projectPath: 'D:\\GIT\\Contoso'
        }),
        conv('sans-dossier', [user('corrige le chat', 2_000), asst(2_100, [texte('ok')])]),
        conv('vide', [])
      ],
      [],
      'D:\\AutoWinOS'
    )
    expect(resultat.projets.map((p) => [p.libelle, p.nature, p.conversations])).toEqual([
      ['Perso', 'categorie', 1],
      ['AutoWinOS', 'dossier', 1],
      ['Contoso', 'dossier', 1]
    ])
    expect(resultat.demandes).toBe(3)
    expect(resultat.comptes).toEqual({ prouve: 1, refuse: 0, 'en-cours': 0, 'sans-preuve': 2 })
    expect(resultat.conversationsLues).toBe(4)
  })

  it('les demandes d’un projet : la plus récente d’abord, tous fils confondus', () => {
    const { projets } = carte([
      conv('a', [user('une', 1_000), asst(1_100, []), user('trois', 3_000), asst(3_100, [])], {
        projectPath: 'D:/P'
      }),
      conv('b', [user('deux', 2_000), asst(2_100, [])], { projectPath: 'D:/P' })
    ])
    expect(projets).toHaveLength(1)
    expect(projets[0].demandes.map((d) => d.titre)).toEqual(['trois', 'deux', 'une'])
    expect(projets[0].conversations).toBe(2)
  })

  it('un run bloqué rejoint le projet de son fil, par son id, sa session ou son attache', () => {
    const { projets, runsBloques } = carte(
      [
        conv('c1', [user('construis', 1_000), asst(1_100, [])], {
          projectPath: 'D:/P1',
          runPaths: ['C:/runs/attache/RUN.md']
        }),
        conv('c2', [user('corrige', 1_000), asst(1_100, [])], { projectPath: 'D:/P2' })
      ],
      [
        run('par-id', { conversationId: 'c2' }),
        run('par-session', { session: 'c1', mtime: 9_000 }),
        run('attache', { path: 'C:/runs/attache/RUN.md' }),
        run('vert', { session: 'c1', blocked: false, summary: { status: 'green' } }),
        run('orphelin', { mtime: 100 })
      ]
    )
    const parLibelle = new Map(projets.map((p) => [p.libelle, p]))
    expect(parLibelle.get('P1')?.runsBloques.map((r) => r.sujet)).toEqual([
      'par-session',
      'attache'
    ])
    expect(parLibelle.get('P2')?.runsBloques.map((r) => r.sujet)).toEqual(['par-id'])
    expect(parLibelle.get('Divers')?.runsBloques.map((r) => r.sujet)).toEqual(['orphelin'])
    expect(parLibelle.get('P1')?.runsBloques[0]).toMatchObject({
      conversationId: 'c1',
      conversationTitre: 'Titre c1',
      statut: 'red'
    })
    expect(runsBloques).toBe(4)
    // Le run le plus récent fait remonter son projet.
    expect(projets[0].libelle).toBe('P1')
  })

  it('le calculateur ne recalcule que les fils qui ont bougé, et oublie les fils supprimés', async () => {
    let fils: (ConversationPourLaCarte & { updatedAt: number })[] = [
      { ...conv('a', [user('une', 1_000), asst(1_100, [])]), updatedAt: 1 },
      { ...conv('b', [user('deux', 2_000), asst(2_100, [])]), updatedAt: 1 }
    ]
    const calcules: string[] = []
    const { calculer } = creerCalculateurDeCarte({
      lireConversations: () => fils,
      lireRuns: async () => Object.assign([], { horsFenetre: 3 }),
      calculerDemandes: (c) => {
        calcules.push(c.id)
        return demandesDuFil(c)
      },
      ceder: async () => {},
      maintenant: () => 42
    })
    const premiere = await calculer()
    expect(calcules).toEqual(['a', 'b'])
    expect(premiere.demandes).toBe(2)
    expect(premiere.runsNonExamines).toBe(3)

    fils = [
      { ...conv('a', [user('une', 1_000), asst(1_100, []), user('encore', 3_000)]), updatedAt: 2 },
      fils[1]
    ]
    const seconde = await calculer()
    expect(calcules).toEqual(['a', 'b', 'a'])
    expect(seconde.demandes).toBe(3)

    fils = [fils[0]]
    await calculer()
    fils = [fils[0], { ...conv('b', [user('deux', 2_000), asst(2_100, [])]), updatedAt: 1 }]
    await calculer()
    // `b` a disparu puis est revenu avec la même empreinte : il a été oublié, donc recalculé.
    expect(calcules).toEqual(['a', 'b', 'a', 'b'])
  })

  it('deux ouvertures simultanées partagent le même calcul', async () => {
    let appels = 0
    const { calculer } = creerCalculateurDeCarte({
      lireConversations: () => [],
      lireRuns: async () => {
        appels += 1
        return []
      },
      ceder: async () => {}
    })
    const [x, y] = await Promise.all([calculer(), calculer()])
    expect(x).toBe(y)
    expect(appels).toBe(1)
    await calculer()
    expect(appels).toBe(2)
  })

  it('dit quand la liste des runs est partielle', () => {
    const resultat = assemblerLaCarte({
      conversations: [],
      demandesParConversation: new Map(),
      runs: [],
      runsNonExamines: 1122,
      calculeeA: 1,
      dureeMs: 1
    })
    expect(resultat.runsNonExamines).toBe(1122)
    expect(resultat.projets).toEqual([])
  })
})

describe('lot 2 — qui a prompté, lu dans git', () => {
  // Deux dossiers qui EXISTENT : `dossierDeTravailDuTour` ignore un rangement vers un dossier absent.
  const depotA = tmpdir()
  const depotParDefaut = process.cwd()
  const fil = conv('conv-1', [user('Ajoute le filtre', 1_000), asst(1_001, [texte('Fait.')])], {
    projectPath: depotA
  })
  const ancien = conv('conv-2', [user('Vieille demande', 500), asst(501, [texte('Fait.')])])

  function carteLot2(journal: Map<string, EntreeDuJournal>) {
    const conversations = [fil, ancien]
    return assemblerLaCarte({
      conversations,
      demandesParConversation: new Map(conversations.map((c) => [c.id, demandesDuFil(c)])),
      runs: [],
      dossierParDefaut: depotParDefaut,
      journal,
      identitesParDossier: new Map([
        [depotA, { nom: 'Personne Actuelle', email: 'Actuelle@Exemple.test' }],
        [depotParDefaut, { nom: 'Personne Du Poste', email: 'poste@exemple.test' }]
      ]),
      calculeeA: 1,
      dureeMs: 1
    })
  }
  const toutes = (c: ReturnType<typeof carteLot2>) => c.projets.flatMap((p) => p.demandes)

  it('le demandeur RELEVÉ au tour prime sur la config git actuelle, avec la ligne de besoin', () => {
    const journal = new Map([
      [
        cleDuJournal('conv-1', 'u1000'),
        {
          demandeur: { nom: 'Collegue', email: 'collegue@exemple.test', dossier: depotA },
          besoin: { nature: 'suite' as const, de: 'conv-9' }
        }
      ]
    ])
    const demande = toutes(carteLot2(journal)).find((d) => d.conversationId === 'conv-1')
    expect(demande?.demandeur).toEqual({
      cle: 'collegue@exemple.test',
      nom: 'Collegue',
      email: 'collegue@exemple.test',
      origine: 'journal'
    })
    expect(demande?.besoin).toEqual({ nature: 'suite', de: 'conv-9' })
  })

  it('une demande antérieure au journal reçoit l’identité git du dossier de SON fil, marquée déduite', () => {
    const c = carteLot2(new Map())
    const parFil = new Map(toutes(c).map((d) => [d.conversationId, d]))
    expect(parFil.get('conv-1')?.demandeur).toMatchObject({
      nom: 'Personne Actuelle',
      cle: 'actuelle@exemple.test',
      origine: 'git-du-dossier'
    })
    // Fil sans dossier : le dépôt par défaut, comme le dossier où ses tours ont travaillé.
    expect(parFil.get('conv-2')?.demandeur).toMatchObject({
      nom: 'Personne Du Poste',
      origine: 'git-du-dossier'
    })
    expect(parFil.get('conv-1')?.besoin).toBeUndefined()
    expect(c.demandesJournalisees).toBe(0)
  })

  it('compte les demandes par personne, la plus active d’abord', () => {
    const journal = new Map([
      [
        cleDuJournal('conv-2', 'u500'),
        {
          demandeur: { nom: 'Personne Actuelle', email: 'actuelle@exemple.test', dossier: depotA },
          besoin: null
        }
      ]
    ])
    const c = carteLot2(journal)
    expect(c.demandeurs).toEqual([
      {
        cle: 'actuelle@exemple.test',
        nom: 'Personne Actuelle',
        email: 'Actuelle@Exemple.test',
        demandes: 2
      }
    ])
    expect(c.demandesJournalisees).toBe(1)
  })

  it('le calculateur ne lance qu’un git par dossier distinct, et survit à un git en échec', async () => {
    const appels: string[] = []
    const calculateur = creerCalculateurDeCarte({
      lireConversations: () => [
        fil,
        ancien,
        conv('conv-3', [user('Encore', 700)], { projectPath: depotA })
      ],
      lireRuns: async () => [],
      dossierParDefaut: () => depotParDefaut,
      lireJournal: () => new Map(),
      identiteDuDossier: async (dossier) => {
        appels.push(dossier)
        if (dossier === depotParDefaut) throw new Error('git absent')
        return { nom: 'Personne Actuelle' }
      },
      ceder: async () => undefined
    })
    const c = await calculateur.calculer()
    expect(appels.sort()).toEqual([depotA, depotParDefaut].sort())
    const parFil = new Map(c.projets.flatMap((p) => p.demandes).map((d) => [d.conversationId, d]))
    expect(parFil.get('conv-3')?.demandeur?.nom).toBe('Personne Actuelle')
    expect(parFil.get('conv-2')?.demandeur).toBeUndefined()
  })
})
