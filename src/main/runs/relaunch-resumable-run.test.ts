import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { admitAutomaticResumeRuntime, type OrchestrationRunState } from './orchestration-state'
import { creerRelanceDeRunReprenable, type DependancesDeRelance } from './relaunch-resumable-run'
import { loadConvRunTrace, saveConvRunTrace, statutDuRunMd } from './conv-runs'
import { causeDInterruption } from '../classe-terminale-echec'
import { supprimerArbre } from '../fs-supprimer'
import { CoordinateurDesPlans, type DepsPlans } from '../plans-de-lots-app'
import type { IssueDuTour } from '../../shared/plan-de-lots'

/**
 * CE QUE CES TESTS REMPLACENT.
 *
 * `orchestration-state.test.ts` gardait ce cablage en LISANT LE TEXTE de `index.ts` :
 * `indexOf('const relaunchResumableRun =')` puis `toContain('populateConvRunSections(...')`. Une
 * telle assertion prouve qu'une suite de caracteres est presente, jamais qu'un EFFET se produit :
 * elle survit a un cablage mort et tombe sur un simple retour a la ligne (mesure le 2026-08-26).
 *
 * Ici la relance est APPELEE pour de vrai, avec un faux `os` et un faux `runTask`, et chaque
 * assertion porte sur ce que la reprise a FAIT : ce qu'a recu `runTask`, dans quel ORDRE le RUN.md
 * a ete rattache, ce qui a ete sauve sur le succes ET sur l'echec, avec quel statut le run a ete
 * clos. Le second bloc SABOTE chaque effet et exige que le garde correspondant tombe.
 */

const liaison = (provider: string, model: string) => ({ provider, model })
const topologie = (provider: string, model: string) => ({
  roles: {
    orchestrator: liaison(provider, model),
    subagent: liaison(provider, model),
    judge: liaison(provider, model),
    scout: liaison(provider, model)
  },
  phaseFanOut: { scout: [], frame: [], terrain: [] },
  judgeFanOut: []
})

const TOPOLOGIE_PERSISTEE = topologie('codex', 'gpt-5.6-sol')
const TOPOLOGIE_COURANTE = topologie('claude', 'claude-opus-5')

const etat = (patch: Partial<OrchestrationRunState> = {}): OrchestrationRunState => ({
  runId: 'run-repris',
  task: 'ajoute un bouton',
  conversationId: 'conv-1',
  turnId: 'turn-origine',
  phaseOutputs: [{ phase: 'frame' as never, text: 'livrable frame' }],
  runtimeSnapshot: TOPOLOGIE_PERSISTEE as never,
  startedAt: 1000,
  updatedAt: 2000,
  ...patch
})

const RESULTAT_VERT = {
  result: 'livrable',
  valid: true,
  gateBlocked: false,
  gateReasons: [] as string[],
  phaseOutputs: [{ phase: 'build', text: 'livrable build', executionEvidence: [] }],
  judgeText: 'verdict du juge',
  usage: undefined,
  learningAttestations: []
}

/** Ce que le banc a OBSERVE : chaque champ est un effet reel de la reprise, pas un motif de texte. */
type Banc = {
  ordre: string[]
  runTaskArgs: unknown[]
  cartes: {
    options: Record<string, unknown>
    begin: unknown[]
    succeed: unknown[]
    fail: unknown[]
  }[]
  runFiles: { chemin: string; tache: string }[]
  traces: { chemin: string; steps: unknown[] }[]
  sections: { chemin: string; phases: unknown; options: unknown }[]
  clotures: { chemin: string; statut: string; note: string }[]
  oublis: string[]
  diffusions: Record<string, unknown>[]
  evenementsJournal: { turnId: string; event: unknown }[]
}

type Reglages = {
  /** Ce que rend `runTask` ; par defaut un succes vert. */
  resultat?: () => Promise<typeof RESULTAT_VERT>
  /** Cycles de vie emis pendant `runTask`. */
  cyclesDeVie?: unknown[]
  /** Reglement tardif emis apres la fin de `runTask`. */
  reglementTardif?: unknown
  etat?: Partial<OrchestrationRunState>
  /** Retire un effet du cablage : sert aux SABOTAGES. */
  sabotage?: (deps: DependancesDeRelance) => DependancesDeRelance
  /** Identite du tour deja enregistree cote conversation. */
  tourEnregistre?: { provider: string; model: string }
  reconcileLateRunLifecycle?: DependancesDeRelance['reconcileLateRunLifecycle']
  /** Tours possédés par une reprise d'appel chat ; par défaut aucun. */
  appelChatReprisPourTour?: (conversationId: string, turnId: string) => boolean
}

function banc(reglages: Reglages = {}): {
  observe: Banc
  relance: (candidat?: Pick<OrchestrationRunState, 'runId' | 'conversationId'>) => Promise<void>
} {
  const observe: Banc = {
    ordre: [],
    runTaskArgs: [],
    cartes: [],
    runFiles: [],
    traces: [],
    sections: [],
    clotures: [],
    oublis: [],
    diffusions: [],
    evenementsJournal: []
  }
  const etatRepris = etat(reglages.etat)
  const conversations = new Map<string, { messages: unknown[] }>([
    [
      'conv-1',
      {
        messages: reglages.tourEnregistre
          ? [{ role: 'assistant', turnId: etatRepris.turnId, runtime: reglages.tourEnregistre }]
          : []
      }
    ]
  ])

  const os = {
    reconcileResumableOrchestrationForRelaunch: () => etatRepris,
    waitUntilReady: async () => {},
    conversations,
    captureOrchestrationRuntime: () => TOPOLOGIE_COURANTE,
    forgetResumableOrchestration: (runId: string) => observe.oublis.push(runId),
    rememberAgentOffsets: () => {},
    executionWorkspace: 'C:/ws',
    runTask: async (...args: unknown[]) => {
      observe.ordre.push('runTask')
      observe.runTaskArgs = args
      const onStep = args[1] as (s: unknown) => void
      const onLifecycle = args[11] as (e: unknown) => void
      const onLate = args[13] as (u: unknown) => void
      onStep({ step: 'exec', text: 'un pas', evidence: [], artifacts: [] })
      const cycles = reglages.cyclesDeVie ?? [
        { stage: 'closure', runId: etatRepris.runId, closure: { status: 'green' } }
      ]
      for (const cycle of cycles) onLifecycle(cycle)
      const rendu = await (reglages.resultat ?? (async () => RESULTAT_VERT))()
      if (reglages.reglementTardif !== undefined) onLate(reglages.reglementTardif)
      return rendu
    }
  }

  const carte = (options: Record<string, unknown>) => {
    const trace: Banc['cartes'][number] = { options, begin: [], succeed: [], fail: [] }
    observe.cartes.push(trace)
    return {
      begin: (...a: unknown[]) => trace.begin.push(...a),
      step: () => {},
      artifact: () => {},
      succeed: (...a: unknown[]) => trace.succeed.push(...a),
      fail: (...a: unknown[]) => trace.fail.push(...a)
    }
  }

  const deps = {
    os,
    bus: { observeOutcomeLearning: async () => undefined },
    broadcast: (evenement: Record<string, unknown>) => observe.diffusions.push(evenement),
    causalTrace: {},
    turnJournalRoot: 'C:/journaux',
    appendConvActivity: () => {},
    admitAutomaticResumeRuntime,
    createOrchestrateTurnPersistence: carte,
    appendTurnEvent: (_racine: string, _conv: string, turnId: string, event: unknown) =>
      observe.evenementsJournal.push({ turnId, event }),
    appelChatReprisPourTour: reglages.appelChatReprisPourTour ?? (() => false),
    reuseOrCreateConvRun: async (_conv: string, tache: string) => {
      observe.ordre.push('reuseOrCreateConvRun')
      observe.runFiles.push({ chemin: 'C:/runs/RUN.md', tache })
      return { path: 'C:/runs/RUN.md' }
    },
    regimePhases: () => ['frame', 'build'],
    saveConvRunTrace: (chemin: string, steps: unknown[]) => {
      observe.ordre.push('saveConvRunTrace')
      observe.traces.push({ chemin, steps: [...steps] })
    },
    // Aucune trace sur disque par défaut : le run d'origine n'avait encore rien écrit.
    loadConvRunTrace: () => null,
    populateConvRunSections: (chemin: string, phases: unknown, options: unknown) => {
      observe.ordre.push('populateConvRunSections')
      observe.sections.push({ chemin, phases, options })
    },
    closeConvRun: (chemin: string, statut: string, note: string) => {
      observe.ordre.push('closeConvRun')
      observe.clotures.push({ chemin, statut, note })
    },
    phasesAvecJuge: (phases: unknown, juge: unknown) => ({ phases, juge }),
    persistOrchestrationStep: () => {},
    persistOrchestrationPhaseStart: () => {},
    persistRunLifecycle: () => {},
    materializeChatArtifact: (a: unknown) => a,
    artifactsFromExecutionEvidence: () => [],
    emitToLiveWindows: () => {},
    appendBrainTrace: () => {},
    appendExecutionEvidenceFileTrace: () => {},
    appendObservedOrchestrationOutcome: () => {},
    executionCostCoverageFields: () => ({}),
    reconcileLateRunLifecycle:
      reglages.reconcileLateRunLifecycle ?? ((precedent: unknown) => precedent),
    classifierRefusDeReprise: () => undefined,
    statutDuRunMd,
    causeDInterruption,
    randomUUID: () => 'uuid-migration',
    fenetresVivantes: () => [],
    defaultProcessIdentity: {}
  } as unknown as DependancesDeRelance

  const finales = reglages.sabotage ? reglages.sabotage(deps) : deps
  return {
    observe,
    relance: (candidat = { runId: 'run-repris' }) => creerRelanceDeRunReprenable(finales)(candidat)
  }
}

describe('relance d un run reprenable — les effets, pas le texte', () => {
  /**
   * REMPLACE : `toContain('admitAutomaticResumeRuntime(')`, `toContain('runtime: {')`,
   * `toMatch(/resumedRuntime\.run\(\(runtimeSnapshot\) =>/)`, `runTaskSource.toContain('runtimeSnapshot')`
   * et `runTaskSource.not.toContain('os.captureOrchestrationRuntime()')`.
   * PLUS FORT : le texte ne pouvait pas distinguer les DEUX topologies ; ce test l exige.
   */
  it('passe a runTask la topologie PERSISTEE du run, jamais celle capturee au demarrage', async () => {
    const b = banc()
    await b.relance()

    expect(b.observe.runTaskArgs[14]).toEqual(TOPOLOGIE_PERSISTEE)
    expect(b.observe.runTaskArgs[14]).not.toEqual(TOPOLOGIE_COURANTE)
    // La carte du tour porte la meme identite que la topologie admise.
    expect(b.observe.cartes[0].options.runtime).toMatchObject(
      TOPOLOGIE_PERSISTEE.roles.orchestrator
    )
  })

  /**
   * REMPLACE : `toContain('durableResumeTurn.begin(')` et l isolation de la migration des anciens
   * tours. Le texte ne voyait pas QUEL tour etait ouvert ; ici les deux branches sont exercees.
   */
  it('reprend le tour d origine quand son identite concorde, en ouvre un neuf sinon', async () => {
    const concordant = banc({ tourEnregistre: liaison('codex', 'gpt-5.6-sol') })
    await concordant.relance()
    expect(concordant.observe.cartes[0].options).toMatchObject({
      turnId: 'turn-origine',
      resumeExisting: true
    })
    expect(concordant.observe.cartes[0].begin).toEqual(['ajoute un bouton'])

    const divergent = banc({ tourEnregistre: liaison('claude', 'claude-opus-5') })
    await divergent.relance()
    expect(divergent.observe.cartes[0].options).toMatchObject({
      turnId: 'uuid-migration',
      resumeExisting: false,
      // Le tour d'origine, gardé `streaming` par hydrate, doit être fermé par le nouveau tour,
      // sinon il garde le spinner de la liste allumé (conv-914, 2026-10-13).
      supersededTurnId: 'turn-origine'
    })
    expect(divergent.observe.cartes[0].begin).toEqual(['[Reprise automatique] ajoute un bouton'])
  })

  // Une orchestration lancée depuis le chat partage le `turnId` du tour de chat. Si ce tour est
  // repris au démarrage par la reprise d'APPEL CHAT, c'est elle qui le possède : la relance du run
  // ne doit pas le fermer, sinon le spinner s'éteint pendant que le chat travaille encore.
  it('ne ferme pas un tour d origine possede par une reprise d appel chat', async () => {
    const divergent = banc({
      tourEnregistre: liaison('claude', 'claude-opus-5'),
      appelChatReprisPourTour: (_conversationId, turnId) => turnId === 'turn-origine'
    })
    await divergent.relance()
    expect(divergent.observe.cartes[0].options.supersededTurnId).toBeUndefined()
  })

  it('journalise la fermeture du tour d origine sous SON identifiant', async () => {
    const divergent = banc({ tourEnregistre: liaison('claude', 'claude-opus-5') })
    await divergent.relance()
    const journal = divergent.observe.cartes[0].options.journalSuperseded as (e: unknown) => void
    journal({ kind: 'interrupted' })
    expect(divergent.observe.evenementsJournal).toContainEqual({
      turnId: 'turn-origine',
      event: { kind: 'interrupted' }
    })
  })

  // conv-914 (2026-10-13) : le tour repris allume le spinner de la liste tant qu'il tourne. Sa
  // fermeture doit recharger la liste, sinon le spinner reste allumé après la fin du run.
  it('recharge la liste des conversations quand le tour repris se ferme', async () => {
    const b = banc()
    await b.relance()
    const onClosed = b.observe.cartes[0].options.onClosed as (() => void) | undefined
    expect(typeof onClosed).toBe('function')
    const avant = b.observe.diffusions.length
    onClosed!()
    expect(b.observe.diffusions.slice(avant)).toEqual([{ type: 'refresh', scope: 'conversations' }])
  })

  /** REMPLACE : `expect(indexSource).toContain('resumableRun.bindingOverride')`. */
  it('transmet a runTask le modele fige persiste avec le checkpoint', async () => {
    const b = banc({ etat: { bindingOverride: liaison('codex', 'gpt-5.6-sol') as never } })
    await b.relance()
    expect(b.observe.runTaskArgs[8]).toEqual(liaison('codex', 'gpt-5.6-sol'))
  })

  /**
   * REMPLACE : `reuseAt >= 0`, `reuseAt < runTaskAt`.
   * PLUS FORT : l ordre est celui des APPELS, pas celui des caracteres dans le fichier.
   */
  it('rattache le RUN.md AVANT de lancer runTask', async () => {
    const b = banc()
    await b.relance()
    expect(b.observe.runFiles).toEqual([{ chemin: 'C:/runs/RUN.md', tache: 'ajoute un bouton' }])
    expect(b.observe.ordre.indexOf('reuseOrCreateConvRun')).toBeGreaterThanOrEqual(0)
    expect(b.observe.ordre.indexOf('reuseOrCreateConvRun')).toBeLessThan(
      b.observe.ordre.indexOf('runTask')
    )
  })

  /**
   * REMPLACE : `toContain('resumedSteps.push(step)')`,
   * la moitie « succes » de `split('saveConvRunTrace(resumedRunFile.path, resumedSteps)')`,
   * `toContain('closeConvRun(')` et `toContain('populateConvRunSections(resumedRunFile.path')`.
   */
  it('sur le succes : sauve la trace des steps, peuple les sections, clot le run en vert', async () => {
    const b = banc()
    await b.relance()

    // Deux écritures : à l'étape (conv-1021, trace suivie en direct), puis à la clôture.
    expect(b.observe.traces.map((t) => t.chemin)).toEqual(['C:/runs/RUN.md', 'C:/runs/RUN.md'])
    expect(b.observe.traces.at(-1)?.steps).toEqual([expect.objectContaining({ step: 'exec' })])
    expect(b.observe.sections).toHaveLength(1)
    expect(b.observe.sections[0].chemin).toBe('C:/runs/RUN.md')
    expect(b.observe.sections[0].phases).toMatchObject({ juge: 'verdict du juge' })
    expect(b.observe.clotures).toEqual([
      { chemin: 'C:/runs/RUN.md', statut: 'green', note: expect.stringContaining('Reprise') }
    ])
    // La trace precede la cloture : un RUN.md clos sans sa trace laisse le panneau Juges vide.
    expect(b.observe.ordre.lastIndexOf('saveConvRunTrace')).toBeLessThan(
      b.observe.ordre.indexOf('closeConvRun')
    )
  })

  /** L autre moitie du `toHaveLength(3)` : la trace est sauvee sur l ECHEC aussi. */
  it('sur l echec : sauve quand meme la trace et clot le run en rouge', async () => {
    const b = banc({
      resultat: async () => {
        throw new Error('provider indisponible')
      }
    })
    await b.relance()

    expect(b.observe.traces.map((t) => t.chemin)).toEqual(['C:/runs/RUN.md', 'C:/runs/RUN.md'])
    expect(b.observe.traces.at(-1)?.steps).toEqual([expect.objectContaining({ step: 'exec' })])
    expect(b.observe.clotures).toEqual([
      {
        chemin: 'C:/runs/RUN.md',
        statut: 'red',
        note: expect.stringContaining('provider indisponible')
      }
    ])
    expect(String(b.observe.cartes[0].fail[0])).toContain('provider indisponible')
  })

  /**
   * conv-1021 : le run d'origine réécrit `trace.json` à chaque étape, et la reprise rattache son
   * MÊME RUN.md. Repartir d'une liste vide effaçait les verdicts joués avant le redémarrage. Vrai
   * fichier sur disque, vraies fonctions de lecture et d'écriture.
   */
  it('repart de la trace deja sur disque et la reecrit a CHAQUE etape, avant de la diffuser', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'aos-reprise-trace-'))
    const runMd = join(dossier, 'RUN.md')
    writeFileSync(runMd, 'status: open\n')
    const verdictAvant = 'DEFAUT\nOBJECTIONS:\n- MAJEUR: test absent'
    saveConvRunTrace(runMd, [
      { step: 'exec', text: 'build avant le redemarrage' },
      { step: 'judge', role: 'judge', text: verdictAvant }
    ])
    const lire = (): string[] => (loadConvRunTrace(runMd) ?? []).map((s) => s.text ?? '')
    const surDisqueALaDiffusion: string[][] = []
    const b = banc({
      sabotage: (d) => ({
        ...d,
        reuseOrCreateConvRun: (async () => ({ path: runMd })) as never,
        loadConvRunTrace,
        saveConvRunTrace,
        broadcast: (evenement) => {
          if (evenement.type === 'orchestrate-step') surDisqueALaDiffusion.push(lire())
          d.broadcast(evenement)
        }
      })
    })
    try {
      await b.relance()
      const attendu = ['build avant le redemarrage', verdictAvant, 'un pas']
      // L'étape reprise est sur disque, À LA SUITE des anciennes, quand elle est diffusée…
      expect(surDisqueALaDiffusion).toEqual([attendu])
      // … et la clôture ne les efface pas.
      expect(lire()).toEqual(attendu)
    } finally {
      supprimerArbre(dossier)
    }
  })

  /**
   * Un gate bloque n est pas une exception : il clot en rouge en citant ses raisons. Sans cycle de
   * vie terminal, c est le statut de livraison qui tranche.
   */
  it('clot en rouge un run dont le gate a bloque, en citant ses raisons', async () => {
    const b = banc({
      cyclesDeVie: [],
      resultat: async () => ({
        ...RESULTAT_VERT,
        valid: false,
        gateBlocked: true,
        gateReasons: ['preuve absente']
      })
    })
    await b.relance()
    expect(b.observe.clotures[0].statut).toBe('red')
    expect(b.observe.clotures[0].note).toContain('preuve absente')
  })

  /**
   * L inverse : un cycle de vie terminal NON ouvert fait autorite sur le statut de livraison — le
   * run sait comment il s est reellement termine mieux que la projection du resultat.
   */
  it('laisse un cycle de vie terminal non ouvert primer sur le statut de livraison', async () => {
    const b = banc({
      cyclesDeVie: [{ stage: 'closure', runId: 'run-repris', closure: { status: 'red' } }]
    })
    await b.relance()
    expect(b.observe.clotures[0].statut).toBe('red')
  })

  /**
   * PISTE 4 (conv-1070) : une reprise coupée de l'extérieur s'écrit `interrupted`. L'entrée qui
   * ferait échouer ces tests si le correctif était faux : la clôture `red` sans cause juste
   * au-dessus, et l'erreur ordinaire de « sur l echec », qui restent `red`.
   */
  it('une clôture rouge qui nomme une interruption écrit interrupted', async () => {
    const b = banc({
      cyclesDeVie: [
        { stage: 'closure', runId: 'run-repris', closure: { status: 'red', interruption: 'quota' } }
      ]
    })
    await b.relance()
    expect(b.observe.clotures[0].statut).toBe('interrupted')
  })

  it('une reprise arrêtée par la limite de session écrit interrupted, pas red', async () => {
    const b = banc({
      resultat: async () => {
        throw new Error(
          "Claude a interrompu l'appel : You've hit your session limit · resets 1pm (Europe/Paris)"
        )
      }
    })
    await b.relance()
    expect(b.observe.clotures).toEqual([
      expect.objectContaining({
        statut: 'interrupted',
        note: expect.stringContaining('interrompue')
      })
    ])
  })

  /**
   * REMPLACE : l ordre `runTaskAt < lifecycleAt < forgetAt` et
   * `toContain('resumedCurrentRunId !== resumableRun.runId')`.
   * PLUS FORT : le texte ne verifiait pas que la comparaison DECIDE quoi que ce soit.
   */
  it('ne retire le checkpoint historique que si la relance a change d identite de run', async () => {
    const memeIdentite = banc({
      cyclesDeVie: [{ stage: 'closure', runId: 'run-repris', closure: { status: 'green' } }]
    })
    await memeIdentite.relance()
    expect(memeIdentite.observe.oublis).toEqual([])

    const autreIdentite = banc({
      cyclesDeVie: [{ stage: 'closure', runId: 'run-neuf', closure: { status: 'green' } }]
    })
    await autreIdentite.relance()
    expect(autreIdentite.observe.oublis).toEqual(['run-repris'])
  })

  /**
   * REMPLACE (run-reattach) : `toContain('os.reconcileResumableOrchestrationForRelaunch(')`.
   * PLUS FORT : le texte prouvait l appel ; ceci prouve que son REFUS arrete la relance — aucun
   * appel provider, aucun RUN.md ouvert pour un checkpoint que la reconciliation a ecarte.
   */
  /**
   * Le reglement d un agent DETACHE ecrivait sa depense sans le modele : mesure du 2026-09-16 sur
   * `.autowin-data/autowin-os/activity`, 78 lignes payantes (131,69 $) sans champ `model`, donc
   * hors de tout arbitrage par modele. La ligne doit porter le modele que le checkpoint connait.
   */
  it('ecrit le MODELE de l agent detache sur la depense recuperee', async () => {
    const lignes: Array<[string, Record<string, unknown>]> = []
    const b = banc({
      sabotage: (d) => ({
        ...d,
        appendConvActivity: ((conv: string, entree: Record<string, unknown>) => {
          lignes.push([conv, entree])
        }) as never,
        os: {
          ...d.os,
          reconcileResumableOrchestrationForRelaunch: (
            _runId: string,
            _identite: unknown,
            onReglement: (s: Record<string, unknown>) => void
          ) => {
            onReglement({
              conversationId: 'conv-1',
              callId: 'detached:run-repris:agent-build',
              phase: 'build',
              provider: 'claude',
              model: 'claude-opus-5',
              costUsd: 2.5,
              inputTokens: 140,
              outputTokens: 20,
              cacheReadTokens: 90
            })
            return undefined
          }
        } as never
      })
    })
    await b.relance()
    expect(lignes).toHaveLength(1)
    expect(lignes[0][1]).toMatchObject({ kind: 'exec', provider: 'claude', model: 'claude-opus-5' })
  })

  it('n engage rien quand la reconciliation refuse le checkpoint', async () => {
    const b = banc({
      sabotage: (d) => ({
        ...d,
        os: { ...d.os, reconcileResumableOrchestrationForRelaunch: () => undefined } as never
      })
    })
    await b.relance()
    expect(b.observe.ordre).toEqual([])
    expect(b.observe.cartes).toEqual([])
  })

  /**
   * REMPLACE (run-reattach) : `toContain('await resumedRuntime')`. La file de demarrage serialise
   * les reprises — elle ne le peut que si la relance ATTEND reellement la fin de son run.
   */
  it('ne rend la main qu une fois le run termine — ce qui rend la file serialisable', async () => {
    let termine = false
    const b = banc({
      resultat: async () => {
        await new Promise((r) => setImmediate(r))
        termine = true
        return RESULTAT_VERT
      }
    })
    const enCours = b.relance()
    expect(termine).toBe(false)
    await enCours
    expect(termine).toBe(true)
    // Et la cloture du RUN.md est acquise a ce moment-la, pas apres.
    expect(b.observe.clotures).toHaveLength(1)
  })

  /**
   * REMPLACE : `toContain('reconcileLateRunLifecycle(')` et
   * `toContain("broadcast({ type: 'orchestrate-usage', convId: conversationId })")`.
   */
  it('repersiste un reglement tardif et rafraichit les vues', async () => {
    const b = banc({
      reglementTardif: { totalTokens: 42 },
      reconcileLateRunLifecycle: ((_precedent: unknown, usage: unknown) => ({
        stage: 'closure',
        runId: 'run-repris',
        closure: { status: 'green' },
        usage
      })) as never
    })
    await b.relance()

    expect(b.observe.diffusions.filter((e) => e.type === 'orchestrate-usage')).toEqual([
      { type: 'orchestrate-usage', convId: 'conv-1' }
    ])
    expect(b.observe.diffusions.filter((e) => e.scope === 'workflows').length).toBeGreaterThan(0)
  })
})

/**
 * REFUS DEFINITIFS. Ces gardes vivaient dans `resume-refusal.wiring.test.ts`, qui decoupait le
 * `catch` de `index.ts` par `indexOf` et cherchait `os.forgetResumableOrchestration(...)` dans
 * chaque branche. Son propre commentaire declarait la limite : « il prouve le CABLAGE, pas
 * l execution », et justifiait ce choix par l impossibilite d importer `index.ts`. Le module
 * extrait leve cette contrainte : chaque classe de refus est ici REELLEMENT jouee.
 */
describe('relance — un refus definitif tarit le checkpoint au lieu de le rejouer', () => {
  const refusJoue = (classe: string, echec: string) =>
    banc({
      sabotage: (d) => ({ ...d, classifierRefusDeReprise: () => classe as never }),
      resultat: async () => {
        throw new Error(echec)
      }
    })

  it('publication-acquise : conclut en VERT, sans nouvel appel provider, checkpoint oublie', async () => {
    const b = refusJoue('publication-acquise', 'publication complete deja engagee')
    await b.relance()

    expect(b.observe.oublis).toContain('run-repris')
    expect(b.observe.cartes[0].succeed).toHaveLength(1)
    expect(b.observe.cartes[0].fail).toEqual([])
    expect(b.observe.diffusions).toContainEqual(
      expect.objectContaining({ type: 'orchestrate-end', status: 'green' })
    )
  })

  it.each(['copie-durable-absente', 'contexte-de-reprise-invalide'])(
    '%s : conclut l echec UNE fois et retire le checkpoint',
    async (classe) => {
      const b = refusJoue(classe, 'copie durable absente')
      await b.relance()

      expect(b.observe.oublis).toContain('run-repris')
      expect(String(b.observe.cartes[0].fail[0])).toContain('ne sera plus rejoué')
      expect(b.observe.cartes[0].succeed).toEqual([])
      expect(b.observe.diffusions).toContainEqual(
        expect.objectContaining({ type: 'orchestrate-end', status: 'red' })
      )
    }
  )

  it('un echec NON classe garde le checkpoint : la reprise reste possible au prochain boot', async () => {
    const b = refusJoue('', 'provider injoignable')
    await b.relance()
    expect(b.observe.oublis).toEqual([])
  })
})

/**
 * LE PLAN DE LOTS SUIT LE RUN REPRIS (conv-1308, 2026-10-30). Un lot lancé en `/build` tourne dans
 * un run : au redémarrage, il repart par CE module, pas par `reprendreAppelChat`. Aucune de ses
 * sorties ne prévenait le plan : le lot 1 de plan-b4358910 restait « interrompu » pendant que son
 * agent travaillait, et sa fin n'aurait lancé ni le lot 2 ni le lot 3.
 */
describe('relance — le plan de lots du fil suit le run repris', () => {
  type Suivi = {
    adoptions: Array<[string, string | undefined]>
    fins: Array<[string, IssueDuTour]>
  }
  const suivi = (): Suivi & { dep: NonNullable<DependancesDeRelance['plansDeLots']> } => {
    const adoptions: Suivi['adoptions'] = []
    const fins: Suivi['fins'] = []
    return {
      adoptions,
      fins,
      dep: {
        agentRepris: (fil, tour) => adoptions.push([fil, tour]),
        finDuRun: (fil, issue) => fins.push([fil, issue])
      }
    }
  }

  it('adopte le lot, puis annonce un succès avec le tour d’origine et la réponse du run', async () => {
    const s = suivi()
    const b = banc({ sabotage: (d) => ({ ...d, plansDeLots: s.dep }) })
    await b.relance()
    expect(s.adoptions).toEqual([['conv-1', 'turn-origine']])
    expect(s.fins).toEqual([
      ['conv-1', { ok: true, repris: true, tour: 'turn-origine', texte: 'livrable' }]
    ])
    // Annoncée APRÈS la clôture du RUN.md : le chef réveillé lit un run déjà clos.
    expect(b.observe.clotures).toHaveLength(1)
  })

  it('annonce la fin APRÈS la clôture du run, jamais avant', async () => {
    const ordre: string[] = []
    const s = suivi()
    const b = banc({
      sabotage: (d) => ({
        ...d,
        closeConvRun: (() => ordre.push('run clos')) as never,
        plansDeLots: {
          agentRepris: s.dep.agentRepris,
          finDuRun: () => ordre.push('plan prévenu')
        }
      })
    })
    await b.relance()
    expect(ordre).toEqual(['run clos', 'plan prévenu'])
  })

  it('un contrôle final bloqué est un échec, avec ses raisons', async () => {
    const s = suivi()
    const b = banc({
      cyclesDeVie: [],
      sabotage: (d) => ({ ...d, plansDeLots: s.dep }),
      resultat: async () => ({
        ...RESULTAT_VERT,
        valid: false,
        gateBlocked: true,
        gateReasons: ['preuve absente', 'test rouge']
      })
    })
    await b.relance()
    expect(s.fins[0][1]).toMatchObject({
      ok: false,
      repris: true,
      erreur: 'preuve absente ; test rouge'
    })
  })

  it('une reprise qui lève est un échec, avec son message', async () => {
    const s = suivi()
    const b = banc({
      sabotage: (d) => ({ ...d, plansDeLots: s.dep }),
      resultat: async () => {
        throw new Error('provider indisponible')
      }
    })
    await b.relance()
    expect(s.fins).toEqual([
      ['conv-1', { ok: false, repris: true, tour: 'turn-origine', erreur: 'provider indisponible' }]
    ])
  })

  it('une publication déjà acquise est un succès', async () => {
    const s = suivi()
    const b = banc({
      sabotage: (d) => ({
        ...d,
        plansDeLots: s.dep,
        classifierRefusDeReprise: () => 'publication-acquise' as never
      }),
      resultat: async () => {
        throw new Error('publication complete deja engagee')
      }
    })
    await b.relance()
    expect(s.fins[0][1]).toMatchObject({ ok: true, repris: true })
  })

  it.each(['copie-durable-absente', 'contexte-de-reprise-invalide'])(
    '%s : échec annoncé, le plan n’attend pas un run qui ne reviendra pas',
    async (classe) => {
      const s = suivi()
      const b = banc({
        sabotage: (d) => ({
          ...d,
          plansDeLots: s.dep,
          classifierRefusDeReprise: () => classe as never
        }),
        resultat: async () => {
          throw new Error('copie durable absente')
        }
      })
      await b.relance()
      expect(s.fins[0][1]).toMatchObject({ ok: false, repris: true })
      expect(s.fins[0][1].erreur).toContain('copie durable absente')
    }
  )

  it('checkpoint refusé : rien n’est adopté, et un lot déjà adopté est clos comme perdu', async () => {
    const s = suivi()
    const b = banc({
      sabotage: (d) => ({
        ...d,
        plansDeLots: s.dep,
        os: { ...d.os, reconcileResumableOrchestrationForRelaunch: () => null } as never
      })
    })
    await b.relance({ runId: 'run-repris', conversationId: 'conv-1' })
    expect(s.adoptions).toEqual([])
    expect(s.fins).toEqual([['conv-1', expect.objectContaining({ ok: false, perdu: true })]])
  })

  it('reprise qui a fait planter l’app : abandonnée, le plan le sait', async () => {
    const s = suivi()
    const b = banc({
      sabotage: (d) => ({
        ...d,
        plansDeLots: s.dep,
        gardePlantage: {
          aPlanteAuparavant: () => true,
          retirer: () => {},
          poser: () => {}
        } as never
      })
    })
    await b.relance()
    expect(s.fins).toEqual([['conv-1', expect.objectContaining({ ok: false, perdu: true })]])
  })

  it('topologie indisponible : le run ne repart pas, le plan le sait', async () => {
    const s = suivi()
    const b = banc({
      sabotage: (d) => ({
        ...d,
        plansDeLots: s.dep,
        os: {
          ...d.os,
          waitUntilReady: async () => {
            throw new Error('modèles pas prêts')
          }
        } as never
      })
    })
    await b.relance()
    expect(s.fins).toEqual([['conv-1', expect.objectContaining({ ok: false, perdu: true })]])
  })

  it('un tour possédé par une reprise d’appel chat : c’est elle qui annonce, une seule fin', async () => {
    const s = suivi()
    const b = banc({
      appelChatReprisPourTour: (_conversationId, turnId) => turnId === 'turn-origine',
      sabotage: (d) => ({ ...d, plansDeLots: s.dep })
    })
    await b.relance()
    expect(s.fins).toEqual([])
  })

  it('un run sans conversation ne prévient aucun plan', async () => {
    const s = suivi()
    const b = banc({
      etat: { conversationId: undefined },
      sabotage: (d) => ({ ...d, plansDeLots: s.dep })
    })
    await b.relance()
    expect(s.adoptions).toEqual([])
    expect(s.fins).toEqual([])
  })

  /** La chaîne entière, vrai coordinateur : le scénario de plan-b4358910. */
  it('avec le vrai coordinateur : le lot 1 repris en run finit, le lot 2 part, le chef est réveillé', async () => {
    let stocke = ''
    const lancements: string[] = []
    let prochain = 100
    const fils = new Set(['conv-chef'])
    const deps: DepsPlans = {
      creerFil: () => {
        const fil = `conv-${prochain++}`
        fils.add(fil)
        return fil
      },
      lancer: async (fil) => {
        lancements.push(fil)
        return { ok: true }
      },
      tourActif: () => false,
      existe: (fil) => fils.has(fil),
      ecrire: () => {},
      stockage: {
        lire: () => stocke,
        ecrire: (c) => {
          stocke = c
        }
      },
      journaliser: () => {}
    }
    const avant = new CoordinateurDesPlans(deps)
    const depot = avant.deposer('conv-chef', {
      titre: 'Navigateur',
      parallele: 3,
      lots: [1, 2].map((n) => ({
        titre: `Étape ${n}`,
        demande: `/build étape ${n}`,
        fichiers: [`src/etape-${n}.ts`],
        apres: n > 1 ? [n - 1] : []
      }))
    })
    if (!depot.ok) throw new Error(depot.erreur)
    await avant.accepter('conv-chef', depot.plan.id)
    expect(lancements).toEqual(['conv-100'])

    // L'app redémarre : le plan relu du disque est interrompu, le run du lot repart.
    const apres = new CoordinateurDesPlans(deps)
    expect(apres.plans()[0].statut).toBe('interrompu')
    let fini!: () => void
    const finAnnoncee = new Promise<void>((r) => (fini = r))
    const b = banc({
      etat: { conversationId: 'conv-100', turnId: undefined },
      sabotage: (d) => ({
        ...d,
        plansDeLots: {
          agentRepris: (fil, tour) => apres.agentRepris(fil, tour),
          finDuRun: (fil, issue) => void apres.surFinDeTour(fil, issue).then(fini)
        }
      })
    })
    await b.relance()
    await finAnnoncee
    expect(apres.plans()[0].lots.map((l) => l.etat)).toEqual(['fait', 'en-cours'])
    expect(apres.plans()[0].statut).toBe('en-cours')
    expect(lancements).toEqual(['conv-100', 'conv-101', 'conv-chef'])
  })
})

/**
 * SABOTAGES. Un test qui ne tombe pas quand l effet disparait ne garde rien. Chaque cas retire UN
 * effet du cablage et exige que l observation correspondante s effondre.
 */
describe('relance — sabotages : les gardes tombent quand l effet disparait', () => {
  it('sans populateConvRunSections, la section n est plus peuplee', async () => {
    const b = banc({ sabotage: (d) => ({ ...d, populateConvRunSections: () => {} }) })
    await b.relance()
    expect(b.observe.sections).toEqual([])
  })

  it('sans saveConvRunTrace, plus aucune trace n est sauvee — ni au succes ni a l echec', async () => {
    const vert = banc({ sabotage: (d) => ({ ...d, saveConvRunTrace: () => {} }) })
    await vert.relance()
    expect(vert.observe.traces).toEqual([])

    const rouge = banc({
      sabotage: (d) => ({ ...d, saveConvRunTrace: () => {} }),
      resultat: async () => {
        throw new Error('boum')
      }
    })
    await rouge.relance()
    expect(rouge.observe.traces).toEqual([])
  })

  it('sans RUN.md rattache, rien n est ni trace ni clos', async () => {
    const b = banc({
      sabotage: (d) => ({ ...d, reuseOrCreateConvRun: (async () => undefined) as never })
    })
    await b.relance()
    expect(b.observe.traces).toEqual([])
    expect(b.observe.clotures).toEqual([])
    expect(b.observe.sections).toEqual([])
  })

  it('sans topologie persistee, runTask recoit la capture du demarrage — ce que le garde refuse', async () => {
    const b = banc({ etat: { runtimeSnapshot: undefined } })
    await b.relance()
    expect(b.observe.runTaskArgs[14]).toEqual(TOPOLOGIE_COURANTE)
  })

  it('sans reglement tardif reconcilie, aucune diffusion d usage n est emise', async () => {
    const b = banc({
      reglementTardif: { totalTokens: 42 },
      reconcileLateRunLifecycle: (() => undefined) as never
    })
    await b.relance()
    expect(b.observe.diffusions.filter((e) => e.type === 'orchestrate-usage')).toEqual([])
  })
})
