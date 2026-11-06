import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../runs/murs-store', () => ({
  chargerMurs: vi.fn(() => ['mur-connu']),
  enregistrerMur: vi.fn()
}))

import { chargerMurs } from '../runs/murs-store'
import { etatInitialDuTour } from './etat-du-tour'

/**
 * L'ÉTAT MUTABLE DU TOUR — la soixantaine de `let` que la boucle de `AgentPilot.chat()` partageait
 * avec ses closures — vit dans `agent-pilot/etat-du-tour.ts` (lot 3), et le
 * chemin des outils directs dans `agent-pilot/appels-natifs.ts`.
 *
 * Ce que le typage ne voit pas : une valeur initiale changée pendant le déplacement (le tour
 * démarre, mais une relance « une seule fois » ne part plus, ou part deux fois), ou une copie
 * d'un drapeau laissée dans `chat()` à côté du champ `etat.x` — les deux vivent, et l'un des deux
 * n'est jamais lu. Entrées qui font échouer ce test : `reprisesApresEchecRestantes: 3`,
 * `consigneClotureInjectee: 0`, `chargerMurs` appelé sans conversation, ou `let anyActionFailed`
 * encore écrit dans `agent-pilot.ts`.
 */
const lire = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
const pilote = (): string => lire(join(__dirname, 'agent-pilot.ts'))

const snapshot = { runs: [] } as unknown as Parameters<typeof etatInitialDuTour>[0]['snapshot']
const entree = (conversationId: string | undefined): Parameters<typeof etatInitialDuTour>[0] => ({
  resumeSessionId: 'session-1',
  compteAuDepart: 'compte-a',
  blocsDuTour: ['a', 'b', 'c'],
  maxIter: 7,
  conversationId,
  snapshot
})

// Valeurs écrites dans chat() avant le déplacement (agent-pilot.ts, lot 2), dans leur ordre.
const attendu = {
  timingWritten: false,
  orchestrationIssued: false,
  orchestrationOutcome: undefined,
  refusRememberAuxiliaire: undefined,
  depotMemoireCeTour: false,
  consigneClotureApresRemember: false,
  consigneCheminsApresRemember: undefined,
  repriseRememberRefuseDisponible: true,
  consigneRepriseRemember: undefined,
  compteRenduOrchestration: undefined,
  sessionEnCours: 'session-1',
  compteDeSession: 'compte-a',
  comptesEpuisesCeTour: new Set<string>(),
  repliApresRefusTente: false,
  modeleApresRefus: undefined,
  segmentsDejaEnvoyes: 0,
  blocsInitiauxAmputes: true,
  blocsInitiaux: 3,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  iterationLimit: 7,
  invalidQuestionRecoveryAvailable: true,
  anyActionExecuted: false,
  actionNativeCeTour: false,
  cmdEmisCeTour: false,
  anySpokenText: false,
  conclusionRecoveryAvailable: true,
  anyReadExecuted: false,
  sortieDeCommandeObservee: false,
  artefactsDejaEmis: new Set<string>(),
  debutDuTourMs: 1_234_567,
  videosDejaMontrees: new Set<string>(),
  questionPoseeCeTour: false,
  questionDesLecturesPosee: false,
  reponseTardiveAUneQuestion: undefined,
  questionSansLectureRecoveryAvailable: true,
  visibleTextThisTurn: '',
  consigneClotureInjectee: -1,
  chiffreNonVerifieRecoveryAvailable: true,
  conclusionFormatRecoveryAvailable: true,
  relanceDeFormeUtilisee: false,
  anyActionFailed: false,
  echecDeLaDerniereIteration: false,
  commandesEnEchecNonRattrape: new Set<string>(),
  actionIdParEchec: new Map<string, string>(),
  reprisesApresEchecRestantes: 2,
  rallongesDirectiveTardiveRestantes: 3,
  signaturesDEchecVues: ['mur-connu'],
  derniereSignatureDEchec: '',
  dernierEchecEstUnRejeu: false,
  echecTuRecoveryAvailable: true,
  outilAbsentRecoveryAvailable: true,
  annonceSansActionRecoveryAvailable: true,
  preuvePromiseRecoveryAvailable: true,
  gesteRenduRecoveryAvailable: true,
  bureauUtilise: false,
  tracesDuTour: [],
  verificationsDuTour: [],
  orchestrationLanceeCeTour: false,
  verifyRefuseCeTour: false,
  captureRegardeeCeTour: false,
  preuveAbsenteRecoveryAvailable: true,
  executesParCanalNatif: new Set<string>(),
  echecNatifCetteIteration: false,
  echecsNatifsNonRattrapes: new Set<string>(),
  rejeuNatifCetteIteration: false,
  iterationNatif: 0,
  appelNatifIndex: 0,
  gesteDansLAppel: false,
  texteApresLeDernierGeste: false,
  replisNatifsDits: new Set<string>(),
  blocVisuelRecoveryAvailable: true,
  cheminsCompletsRecoveryAvailable: true,
  commandeIllisibleRecoveryAvailable: true,
  commandAttachments: [],
  dernierEtatEnvoye: snapshot
}

describe('état mutable du tour sorti de chat() (conv-1580, lot 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(chargerMurs).mockClear()
  })

  it('part des valeurs initiales que chat() écrivait, ni plus ni moins', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234_567)
    const etat = etatInitialDuTour(entree('conv-1'))
    expect(etat).toStrictEqual(attendu)
    expect(Object.keys(etat)).toEqual(Object.keys(attendu))
    expect(etat.dernierEtatEnvoye).toBe(snapshot)
    expect(chargerMurs).toHaveBeenCalledWith('conv-1')
  })

  it('sans conversation ni session : aucun mur lu, aucune reprise', () => {
    const etat = etatInitialDuTour({
      ...entree(undefined),
      resumeSessionId: undefined,
      compteAuDepart: undefined,
      blocsDuTour: []
    })
    expect(chargerMurs).not.toHaveBeenCalled()
    expect(etat.signaturesDEchecVues).toEqual([])
    expect(etat.sessionEnCours).toBeUndefined()
    expect(etat.blocsInitiauxAmputes).toBe(false)
    expect(etat.blocsInitiaux).toBe(0)
  })

  it('chaque tour a ses propres registres', () => {
    const a = etatInitialDuTour(entree('conv-1'))
    const b = etatInitialDuTour(entree('conv-1'))
    a.commandesEnEchecNonRattrape.add('x')
    a.usage.costUsd = 1
    expect(b.commandesEnEchecNonRattrape.size).toBe(0)
    expect(b.usage.costUsd).toBe(0)
    expect(a.signaturesDEchecVues).not.toBe(b.signaturesDEchecVues)
  })

  it('chat() ne redéclare aucun champ de l’état', () => {
    const source = pilote()
    for (const nom of Object.keys(attendu))
      expect(source, `copie de ${nom} laissée dans agent-pilot.ts`).not.toMatch(
        new RegExp(`\\b(let|const) ${nom}\\b`)
      )
    expect(source).toContain('const etat = etatInitialDuTour({')
  })
})

describe('outils directs et texte de clôture sortis de chat() (conv-1580, lot 3)', () => {
  const DEPLACES: Array<[string, string, string]> = [
    ['appels-natifs.ts', 'appelsNatifsDuTour', 'const executerAppelNatif = async ('],
    ['appels-natifs.ts', 'appelsNatifsDuTour', 'const comptabiliserCommande = ('],
    ['appels-natifs.ts', 'appelsNatifsDuTour', 'const noterUnGeste = (): void => {'],
    ['texte-de-cloture.ts', 'texteDeClotureDuTour', "'Aucune reponse produite pour ce tour.'"]
  ]

  it.each(DEPLACES)(
    '%s porte %s, et chat() n’en garde aucune copie',
    async (fichier, nom, repere) => {
      const module = (await import(`./${fichier.replace(/\.ts$/, '')}`)) as Record<string, unknown>
      expect(typeof module[nom], `${nom} absent de ${fichier}`).toBe('function')
      expect(lire(join(__dirname, fichier)), `repère absent de ${fichier}`).toContain(repere)
      expect(pilote(), `copie laissée dans agent-pilot.ts : ${repere}`).not.toContain(repere)
    }
  )
})
