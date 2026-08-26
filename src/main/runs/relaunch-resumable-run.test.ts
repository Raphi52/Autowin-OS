import { describe, expect, it } from 'vitest'
import { admitAutomaticResumeRuntime, type OrchestrationRunState } from './orchestration-state'
import { creerRelanceDeRunReprenable, type DependancesDeRelance } from './relaunch-resumable-run'

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
}

function banc(reglages: Reglages = {}): { observe: Banc; relance: () => Promise<void> } {
  const observe: Banc = {
    ordre: [],
    runTaskArgs: [],
    cartes: [],
    runFiles: [],
    traces: [],
    sections: [],
    clotures: [],
    oublis: [],
    diffusions: []
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
    appendTurnEvent: () => {},
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
    randomUUID: () => 'uuid-migration',
    fenetresVivantes: () => [],
    defaultProcessIdentity: {}
  } as unknown as DependancesDeRelance

  const finales = reglages.sabotage ? reglages.sabotage(deps) : deps
  return {
    observe,
    relance: () => creerRelanceDeRunReprenable(finales)({ runId: 'run-repris' })
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
      resumeExisting: false
    })
    expect(divergent.observe.cartes[0].begin).toEqual(['[Reprise automatique] ajoute un bouton'])
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

    expect(b.observe.traces).toEqual([
      { chemin: 'C:/runs/RUN.md', steps: [expect.objectContaining({ step: 'exec' })] }
    ])
    expect(b.observe.sections).toHaveLength(1)
    expect(b.observe.sections[0].chemin).toBe('C:/runs/RUN.md')
    expect(b.observe.sections[0].phases).toMatchObject({ juge: 'verdict du juge' })
    expect(b.observe.clotures).toEqual([
      { chemin: 'C:/runs/RUN.md', statut: 'green', note: expect.stringContaining('Reprise') }
    ])
    // La trace precede la cloture : un RUN.md clos sans sa trace laisse le panneau Juges vide.
    expect(b.observe.ordre.indexOf('saveConvRunTrace')).toBeLessThan(
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

    expect(b.observe.traces).toEqual([
      { chemin: 'C:/runs/RUN.md', steps: [expect.objectContaining({ step: 'exec' })] }
    ])
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
