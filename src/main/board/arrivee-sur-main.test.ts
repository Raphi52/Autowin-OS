import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  demandesDuFil,
  type ConversationPourLaCarte,
  type MessageStockePourLaCarte
} from './carte-des-besoins'
import {
  arriveesDepuisLesRuns,
  creerLectureDesArrivees,
  filApresDesCommits,
  lireLesRunsPublies,
  type ArriveeDuTour
} from './arrivee-sur-main'

/**
 * ARRIVÉ SUR MAIN — « l'état suit le travail réel ».
 *
 * Les entrées qui font échouer une version fausse : une attente dont le travail n'est pas arrivé (trace
 * de run « rien publié », ou aucun commit du fil sur main après la demande) ; la même, arrivée (trace de
 * run publiée) ; un tour sans trace de run mais avec un commit du fil arrivé après la demande : ni prouvé,
 * ni refusé ; une trace qui dit « rien n'est arrivé », que le fil ne rachète pas ; une coupure ; et une
 * vérification verte qui suit une attente non arrivée.
 */

// fix-ok: cause mesurée — une attente sans trace de run était rangée « refusé » alors que le fil avait un
// commit arrivé sur main après la demande (commit 14:56 +01:00, demande 14:38 +01:00, runs élagués) : un
// refus n'était pas établi. Mesuré sur le rejeu des données réelles avant ce correctif.
/** turnId réel d'un run dont le travail est arrivé sur main. */
const TOUR_ARRIVE = '3dedc0e7-1ae9-4295-ab78-8347bd8bc721'
/** Un tour dont aucun run n'est connu. */
const TOUR_SANS_TRACE = 'tour-sans-trace'
/** Un tour dont le run est connu mais n'a rien publié (SHA d'agent = base). */
const TOUR_NON_ARRIVE = 'tour-run-sans-publication'
/** Heure de la demande d'un message arrêté au contrôle final, sans trace de run (ms, comme `etape.debut`). */
const DEMANDE_1672 = Date.parse('2026-11-06T14:38:22+01:00')
/** Le journal de `main` au format `git log --format=%aI%x09%s` : date ISO de l'auteur, tabulation, sujet. */
const JOURNAL_DE_MAIN = [
  '2026-11-06T14:56:25+01:00\tfeat(coffre): les agents reçoivent les clés du coffre (conv-1672)',
  '2026-10-02T09:00:00+02:00\tfix(board): correctif ancien (conv-1585)'
].join('\n')

const user = (content: string, ts: number): MessageStockePourLaCarte =>
  ({ role: 'user', content, ts, messageId: `message-${ts}` }) as MessageStockePourLaCarte

const reponse = (ts: number, turnId: string, parts: unknown[]): MessageStockePourLaCarte =>
  ({
    role: 'assistant',
    content: '',
    status: 'completed',
    ts,
    turnId,
    parts
  }) as unknown as MessageStockePourLaCarte

/**
 * Un vert qui attend seulement que la base se libère : le contrôle final écrit la raison d'état ET le
 * diagnostic « blocage d’intégration: base-dirty » (`attendSeulementSaPublication`, shared).
 */
// fix-ok: cause mesurée — la première fixture n'avait pas le diagnostic « blocage d’intégration » : vitest
// donnait « refuse » au lieu de « prouve » sans arrivée (3 échecs, mesurés). Le diagnostic est celui que
// `attendSeulementSaPublication` exige (shared/orchestration-outcome.ts).
const enAttenteDePublication = {
  kind: 'action',
  name: 'orchestrate',
  ok: true,
  data: {
    gateBlocked: true,
    gateReasons: [
      'intégration locale non terminée',
      'blocage d’intégration: base-dirty — fichiers en cause: AGENTS.md'
    ]
  }
}

const QUOTA = `Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your 5-hour limit · resets 12:50pm (Europe/Paris)`
const coupee = {
  kind: 'action',
  name: 'orchestrate',
  ok: true,
  data: { error: QUOTA }
}

const verifieVert = {
  kind: 'action',
  name: 'verify',
  ok: true,
  data: { command: 'npm run typecheck', exitCode: 0, ok: true }
}

const conversation = (
  id: string,
  reponses: MessageStockePourLaCarte[]
): ConversationPourLaCarte => ({
  id,
  title: 'fil de test',
  messages: [user('construis', 1), ...reponses]
})

/** Une lecture qui ne connaît que le tour arrivé, et aucun commit de fil. */
const arriveeConnue: ArriveeDuTour = (conversationId, turnId) =>
  conversationId === 'conv-1659' && turnId === TOUR_ARRIVE ? true : undefined

/** Une lecture sans trace de run, dont le fil dit ce qu'il dit (`filApres`). */
const sansTraceDeRun = (
  filApres: (conversationId: string, depuis: number) => boolean | undefined
): ArriveeDuTour => Object.assign(() => undefined, { filApres })

describe('arriveesDepuisLesRuns — quel tour a vraiment publié', () => {
  it('un run publié dont le SHA d’agent diffère de la base : le travail est arrivé', () => {
    const arrivee = arriveesDepuisLesRuns([
      {
        conversationId: 'conv-1659',
        turnId: TOUR_ARRIVE,
        publication: 'complete',
        publicationAgentSha: '6ef6db484',
        baseSha: 'acda0f9b9'
      }
    ])
    expect(arrivee('conv-1659', TOUR_ARRIVE)).toBe(true)
  })

  it('un run « complete » sans rien de nouveau (SHA d’agent = base) : rien n’est arrivé', () => {
    const arrivee = arriveesDepuisLesRuns([
      {
        conversationId: 'conv-1461',
        turnId: 'tour-1461',
        publication: 'complete',
        publicationAgentSha: '6dbb84bab',
        baseSha: '6dbb84bab'
      }
    ])
    expect(arrivee('conv-1461', 'tour-1461')).toBe(false)
  })

  it('un run bloqué : rien n’est arrivé', () => {
    const arrivee = arriveesDepuisLesRuns([
      {
        conversationId: 'conv-1730',
        turnId: 'tour-1730',
        publication: 'blocked',
        publicationAgentSha: '2de40c85f',
        baseSha: 'acda0f9b9'
      }
    ])
    expect(arrivee('conv-1730', 'tour-1730')).toBe(false)
  })

  it('aucun run connu pour ce tour : inconnu, et ce n’est pas une arrivée', () => {
    const arrivee = arriveesDepuisLesRuns([])
    expect(arrivee('conv-1585', TOUR_SANS_TRACE)).toBeUndefined()
  })

  it('un tour à plusieurs runs : un seul publié suffit', () => {
    const arrivee = arriveesDepuisLesRuns([
      { conversationId: 'c', turnId: 't', publication: 'blocked', baseSha: 'b' },
      {
        conversationId: 'c',
        turnId: 't',
        publication: 'complete',
        publicationAgentSha: 'x1',
        baseSha: 'b'
      }
    ])
    expect(arrivee('c', 't')).toBe(true)
  })
})

describe('lireLesRunsPublies et sa lecture mise en cache', () => {
  let racine: string | undefined
  afterEach(() => {
    if (racine) rmSync(racine, { recursive: true, force: true })
    racine = undefined
  })

  const ecrireRun = (depot: string, nom: string, contenu: unknown): void => {
    const dossier = join(racine as string, 'worktrees', depot, '.runs')
    mkdirSync(dossier, { recursive: true })
    writeFileSync(
      join(dossier, nom),
      typeof contenu === 'string' ? contenu : JSON.stringify(contenu)
    )
  }

  it('lit les runs de chaque dépôt, ignore le fichier corrompu et le dépôt sans .runs', () => {
    racine = mkdtempSync(join(tmpdir(), 'arrivee-'))
    ecrireRun('depot-a', 'run-1.json', {
      conversationId: 'conv-1659',
      turnId: TOUR_ARRIVE,
      publication: 'complete',
      publicationAgentSha: '6ef6db484',
      baseSha: 'acda0f9b9'
    })
    ecrireRun('depot-a', 'run-2.json', '{ pas du json')
    ecrireRun('depot-a', 'note.txt', 'ignoré')
    mkdirSync(join(racine, 'worktrees', 'depot-b'), { recursive: true })

    const runs = lireLesRunsPublies(join(racine, 'worktrees'))
    expect(runs).toHaveLength(1)
    expect(arriveesDepuisLesRuns(runs)('conv-1659', TOUR_ARRIVE)).toBe(true)
  })

  it('un dossier de runs illisible ne casse pas la carte : aucune arrivée n’est prouvée', () => {
    racine = mkdtempSync(join(tmpdir(), 'arrivee-'))
    const pasUnDossier = join(racine, 'worktrees')
    writeFileSync(pasUnDossier, 'un fichier, pas un dossier')
    const lire = creerLectureDesArrivees(pasUnDossier)
    expect(lire()('conv-1659', TOUR_ARRIVE)).toBeUndefined()
  })

  it('une lecture sert son délai : un run publié après ne se voit qu’à l’échéance', () => {
    racine = mkdtempSync(join(tmpdir(), 'arrivee-'))
    let maintenant = 0
    const lire = creerLectureDesArrivees(join(racine, 'worktrees'), {
      maintenant: () => maintenant,
      ttlMs: 30_000
    })
    expect(lire()('conv-1659', TOUR_ARRIVE)).toBeUndefined()

    ecrireRun('depot-a', 'run-1.json', {
      conversationId: 'conv-1659',
      turnId: TOUR_ARRIVE,
      publication: 'complete',
      publicationAgentSha: '6ef6db484',
      baseSha: 'acda0f9b9'
    })
    maintenant = 29_999
    expect(lire()('conv-1659', TOUR_ARRIVE)).toBeUndefined()
    maintenant = 30_000
    expect(lire()('conv-1659', TOUR_ARRIVE)).toBe(true)
  })
})

describe('filApresDesCommits — le fil seul dit si son travail est arrivé sur main', () => {
  it('un commit du fil daté après la demande : arrivé (vrai)', () => {
    expect(filApresDesCommits(JOURNAL_DE_MAIN)('conv-1672', DEMANDE_1672)).toBe(true)
  })

  it('des commits du fil tous antérieurs à la demande : rien n’est arrivé après (faux)', () => {
    expect(filApresDesCommits(JOURNAL_DE_MAIN)('conv-1585', DEMANDE_1672)).toBe(false)
  })

  it('un fil sans aucun commit sur main : faux, pas inconnu (le journal a bien été lu)', () => {
    expect(filApresDesCommits(JOURNAL_DE_MAIN)('conv-1507', DEMANDE_1672)).toBe(false)
  })

  it('l’étiquette se lit en entier : (conv-167) ne couvre pas conv-1672', () => {
    const journal = '2026-11-06T15:00:00+01:00\tfeat(x): autre travail (conv-167)'
    expect(filApresDesCommits(journal)('conv-1672', DEMANDE_1672)).toBe(false)
  })

  it('un journal illisible : inconnu, jamais faux', () => {
    expect(filApresDesCommits(undefined)('conv-1672', DEMANDE_1672)).toBeUndefined()
  })
})

describe('creerLectureDesArrivees — le journal de main rejoint les runs', () => {
  let racine: string | undefined
  afterEach(() => {
    if (racine) rmSync(racine, { recursive: true, force: true })
    racine = undefined
  })

  it('le journal lu sert le fil ; un journal qui échoue reste inconnu sans casser la lecture', async () => {
    racine = mkdtempSync(join(tmpdir(), 'arrivee-'))
    const bon = creerLectureDesArrivees(join(racine, 'worktrees'), {
      lireLog: async () => JOURNAL_DE_MAIN
    })()
    await Promise.resolve()
    expect(bon.filApres?.('conv-1672', DEMANDE_1672)).toBe(true)

    const rejete = creerLectureDesArrivees(join(racine, 'worktrees'), {
      lireLog: async () => {
        throw new Error('git indisponible')
      }
    })()
    await Promise.resolve()
    expect(rejete.filApres?.('conv-1672', DEMANDE_1672)).toBeUndefined()

    const casse = creerLectureDesArrivees(join(racine, 'worktrees'), {
      lireLog: () => {
        throw new Error('git introuvable')
      }
    })()
    await Promise.resolve()
    expect(casse.filApres?.('conv-1672', DEMANDE_1672)).toBeUndefined()
  })

  it('un journal qui échoue après un journal lu redevient inconnu, jamais l’ancien qui dirait « rien »', async () => {
    racine = mkdtempSync(join(tmpdir(), 'arrivee-'))
    let maintenant = 0
    let echouer = false
    const lire = creerLectureDesArrivees(join(racine, 'worktrees'), {
      maintenant: () => maintenant,
      ttlMs: 30_000,
      lireLog: async () => {
        if (echouer) throw new Error('délai dépassé')
        return JOURNAL_DE_MAIN
      }
    })
    lire()
    await Promise.resolve()
    expect(lire().filApres?.('conv-1507', DEMANDE_1672)).toBe(false)

    echouer = true
    maintenant = 30_000
    lire()
    await Promise.resolve()
    expect(lire().filApres?.('conv-1507', DEMANDE_1672)).toBeUndefined()
  })
})

describe('demandesDuFil — l’état suit le travail réel', () => {
  it('sans lecture des arrivées, l’état du fil ne bouge pas (« en attente » reste prouvé)', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1659', [reponse(2, TOUR_ARRIVE, [enAttenteDePublication])])
    )
    expect(demande.statut).toBe('prouve')
    expect(demande.constat).toContain('en attente de publication')
  })

  it('en attente, et le travail est arrivé sur main : prouvé, « arrivé sur main » (conv-1659)', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1659', [reponse(2, TOUR_ARRIVE, [enAttenteDePublication])]),
      arriveeConnue
    )
    expect(demande).toMatchObject({ statut: 'prouve', constat: 'arrivé sur main' })
  })

  it('en attente, et rien n’est arrivé : refusé, avec le motif (aucun commit du fil après la demande)', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1585', [reponse(2, TOUR_SANS_TRACE, [enAttenteDePublication])]),
      sansTraceDeRun(() => false)
    )
    expect(demande).toMatchObject({
      statut: 'refuse',
      constat: 'en attente de publication — pas encore arrivé sur main'
    })
  })

  it('en attente non arrivée, puis une vérification verte : refusé quand même', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1585', [
        reponse(2, TOUR_SANS_TRACE, [enAttenteDePublication, verifieVert])
      ]),
      sansTraceDeRun(() => false)
    )
    expect(demande.statut).toBe('refuse')
  })

  it('en attente, pas de trace de run, un commit du fil arrivé après la demande : prouvé, le constat dit que le lien passe par le fil', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1672', [reponse(2, TOUR_SANS_TRACE, [enAttenteDePublication])]),
      sansTraceDeRun(() => true)
    )
    expect(demande.statut).toBe('prouve')
    expect(demande.constat).toContain('lien par le fil')
  })

  it('en attente, pas de trace de run : le fil reçoit l’heure de la demande, pas une valeur absente', () => {
    // La demande de test a l’heure 1 (son message de l’utilisateur) : le fil ne répond vrai qu’à celle-là.
    const [demande] = demandesDuFil(
      conversation('conv-1672', [reponse(2, TOUR_SANS_TRACE, [enAttenteDePublication])]),
      sansTraceDeRun((_conversationId, depuis) => depuis === 1)
    )
    expect(demande.statut).toBe('prouve')
    expect(demande.constat).toContain('lien par le fil')
  })

  it('en attente, pas de trace de run, arrivée du fil inconnue : sans preuve, pas refusé', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1672', [reponse(2, TOUR_SANS_TRACE, [enAttenteDePublication])]),
      sansTraceDeRun(() => undefined)
    )
    expect(demande).toMatchObject({
      statut: 'sans-preuve',
      constat: 'en attente de publication — arrivée sur main inconnue'
    })
  })

  it('une trace de run dit « rien n’est arrivé » : refusé, même si un commit du fil est arrivé', () => {
    const arrivee: ArriveeDuTour = Object.assign(
      (_conversationId: string, turnId: string) => (turnId === TOUR_NON_ARRIVE ? false : undefined),
      { filApres: () => true }
    )
    const [demande] = demandesDuFil(
      conversation('conv-1672', [reponse(2, TOUR_NON_ARRIVE, [enAttenteDePublication])]),
      arrivee
    )
    expect(demande.statut).toBe('refuse')
  })

  it('coupée par la limite d’usage, et le travail est arrivé : prouvé', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1659', [reponse(2, TOUR_ARRIVE, [coupee])]),
      arriveeConnue
    )
    expect(demande).toMatchObject({ statut: 'prouve', constat: 'arrivé sur main' })
  })

  it('coupée par la limite d’usage, rien n’est arrivé : sans preuve, comme avant (pas un refus)', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1668', [reponse(2, TOUR_SANS_TRACE, [coupee])]),
      arriveeConnue
    )
    expect(demande).toMatchObject({
      statut: 'sans-preuve',
      constat: 'interrompu par la limite d’usage du modèle — pas un refus'
    })
  })

  it('une vérification verte ordinaire, sans attente ni coupure : la règle ne s’en mêle pas', () => {
    const [demande] = demandesDuFil(
      conversation('conv-1585', [reponse(2, TOUR_SANS_TRACE, [verifieVert])]),
      arriveeConnue
    )
    expect(demande.statut).toBe('prouve')
  })
})
