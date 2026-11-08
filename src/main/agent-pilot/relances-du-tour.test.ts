import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ContexteDuTour } from './contexte-du-tour'
import { etatInitialDuTour, type EtatDuTour } from './etat-du-tour'
import {
  consignesDifferees,
  consignesDuBudget,
  relanceConclusionAbsente,
  relanceQuestionSansLecture,
  relanceTourMuet
} from './relances-du-tour'
import { RELANCE_CONCLUSION_ABSENTE } from './issue-des-commandes'

/**
 * La boucle d'itérations de AgentPilot.chat() vit dans `agent-pilot/*.ts` (lot 4) :
 * envoi au modèle, reprise après erreur, lecture de la réponse, exécution des `<cmd>` et relances.
 * chat() ne garde que l'ORDRE des contrôles de fin d'itération et l'envoi de la relance.
 *
 * Ce que le typage ne voit pas, et que ce fichier refuse :
 * - deux contrôles échangés dans la chaîne de chat() : l'ordre décide quelle relance part quand
 *   plusieurs s'appliquent (« corrige, puis poursuis » AVANT l'aveu d'échec, la conclusion AVANT
 *   les chemins complets…). Entrée qui fait échouer le premier test : `relanceEchecTaise(tour) ??`
 *   remonté au-dessus de `relanceCorrectionApresEchec(tour) ??` dans agent-pilot.ts.
 * - une copie laissée dans agent-pilot.ts au lieu de l'appel au module. Entrée qui fait échouer le
 *   deuxième : `const repartirSansSession = (): void => {` encore écrit dans agent-pilot.ts.
 */
const lire = (chemin: string): string => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
const pilote = (): string => lire(join(__dirname, 'agent-pilot.ts'))
const relances = (): string => lire(join(__dirname, 'relances-du-tour.ts'))

/** Motif rendu par chaque contrôle, lu dans son corps (`motif: '…'` ou `return '…'`). */
function motifDe(nom: string): string {
  const texte = relances()
  const debut = texte.indexOf(`export function ${nom}(`)
  expect(debut, `${nom} absent de relances-du-tour.ts`).toBeGreaterThan(-1)
  const corps = texte.slice(debut, texte.indexOf('\n}\n', debut))
  const motif = corps.match(/motif: '([a-z-]+)'/u) ?? corps.match(/return '([a-z-]+)'/u)
  expect(motif, `${nom} : aucun motif`).not.toBeNull()
  return motif?.[1] ?? ''
}

/** Les contrôles d'une chaîne `a(…) ?? b(…) ?? …` de chat(), dans l'ordre, à partir d'un repère. */
function chaine(repere: string): string[] {
  const texte = pilote()
  const debut = texte.indexOf(repere)
  expect(debut, `repère absent de agent-pilot.ts : ${repere}`).toBeGreaterThan(-1)
  // La chaîne s'arrête à sa première ligne qui ne finit pas par `??` : le contrôle de dernier recours.
  const lignes = texte.slice(debut).split('\n').slice(1)
  const derniere = lignes.findIndex((ligne) => !ligne.trimEnd().endsWith('??'))
  return lignes
    .slice(0, derniere + 1)
    .map((ligne) => ligne.match(/^\s*(relance[A-Z]\w*)\(/u)?.[1] ?? `ligne hors chaîne : ${ligne}`)
}

describe('relances de fin d’itération sorties de chat() (conv-1580, lot 4)', () => {
  it('chat() garde l’ordre d’origine des contrôles d’une réponse sans commande', () => {
    // Ordre de la branche `if (!hasCommand)` avant le déplacement (agent-pilot.ts, lot 3).
    expect(chaine('const relance =\n').map(motifDe)).toEqual([
      'commande-illisible',
      'muted-turn',
      'outil-pretendu-absent',
      'annonce-sans-action',
      'correction-apres-echec',
      'echec-taise',
      'geste-rendu',
      'preuve-absente',
      'preuve-promise',
      'bloc-visuel-non-ferme',
      'conclusion-absente',
      'chemin-incomplet',
      'question-sans-lecture',
      'chiffre-non-verifie'
    ])
    // Raccourci `remember` : clôture, puis dépôt refusé, puis chemins.
    expect(chaine('const rallongeDuRaccourci =').map(motifDe)).toEqual([
      'conclusion-absente',
      'correction-apres-echec',
      'chemin-incomplet'
    ])
  })

  const DEPLACES: Array<[string, string, string]> = [
    ['envoi-du-tour.ts', 'appelDuModele', 'const repartirSansSession = (): void => {'],
    ['iteration-du-tour.ts', 'iterationDuTour', 'effacerReponseRelancee: (): void => {'],
    [
      'reprise-apres-erreur.ts',
      'reprendreApresErreur',
      'const promptTropLong = /prompt is too long|prompt too long/i.test(message)'
    ],
    [
      'reponse-du-tour.ts',
      'reinjecterLesDirectivesTardives',
      'const lateDirectives = drainDirectives'
    ],
    ['execution-des-commandes.ts', 'executerLesCommandes', 'const closureNotice = deliveryClosed'],
    ['relances-du-tour.ts', 'relanceTourMuet', "'SYSTÈME: tu as agi mais tu n’as rien dit"]
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

describe('un contrôle ne mord qu’une fois, et ne touche à rien quand il ne mord pas', () => {
  const etat = (): EtatDuTour =>
    etatInitialDuTour({
      resumeSessionId: undefined,
      compteAuDepart: undefined,
      blocsDuTour: [],
      maxIter: 12,
      conversationId: undefined,
      snapshot: { runs: [] } as unknown as Parameters<typeof etatInitialDuTour>[0]['snapshot']
    })

  it('tour muet : relance, crédit consommé, puis plus rien', () => {
    const e = etat()
    expect(relanceTourMuet(e)).toBeUndefined()
    expect(e.conclusionRecoveryAvailable).toBe(true)
    e.anyActionExecuted = true
    const relance = relanceTourMuet(e)
    expect(relance?.motif).toBe('muted-turn')
    expect(relance?.consignes[0]).toContain('exit codes')
    expect(e.conclusionRecoveryAvailable).toBe(false)
    expect(e.relanceDeFormeUtilisee).toBe(true)
    expect(relanceTourMuet(e)).toBeUndefined()
  })

  /*
   * Un tour qui a modifié des fichiers par les outils natifs du modèle (Edit, Write, Bash qui
   * écrit) a AGI autant qu'un `<cmd>` : l'utilisateur attend le bloc de fin. Vécu : trois tours de
   * suite livrés en code sans « ✅ Fait », parce que la garde ne regardait que les commandes de l'app.
   */
  it('conclusion absente : un tour qui n’a modifié que des fichiers doit finir par le bloc de fin', () => {
    const tour = (e: EtatDuTour): ContexteDuTour =>
      ({ etat: e, exigerExperienceSoignee: true }) as unknown as ContexteDuTour
    const prose = 'J’ai retiré les trois panneaux, les tests passent.'

    const lectureSeule = etat()
    lectureSeule.anyReadExecuted = true
    lectureSeule.visibleTextThisTurn = prose
    expect(relanceConclusionAbsente(tour(lectureSeule))).toBeUndefined()

    const fichiersModifies = etat()
    fichiersModifies.actionNativeCeTour = true
    fichiersModifies.visibleTextThisTurn = prose
    expect(relanceConclusionAbsente(tour(fichiersModifies))?.motif).toBe('conclusion-absente')

    const dejaClos = etat()
    dejaClos.actionNativeCeTour = true
    dejaClos.visibleTextThisTurn = `${prose}\n\n✅ Fait\n1. Panneaux retirés.\n\n👉 Recommandé\nRelis l’écran.`
    expect(relanceConclusionAbsente(tour(dejaClos))).toBeUndefined()
  })

  it('question sans lecture : une seule relance', () => {
    const e = etat()
    e.questionPoseeCeTour = true
    expect(relanceQuestionSansLecture(e)?.motif).toBe('question-sans-lecture')
    expect(relanceQuestionSansLecture(e)).toBeUndefined()
  })

  it('budget : annonce à mi-parcours, clôture forcée une fois au dernier appel', () => {
    const e = etat()
    e.iterationLimit = 6
    expect(consignesDuBudget(e, 1)).toEqual([])
    expect(consignesDuBudget(e, 3)[0]).toContain('SYSTÈME — BUDGET DU TOUR : appel 4 sur 6')
    expect(consignesDuBudget(e, 5)[0]).toContain('DERNIÈRE ITÉRATION DE CE TOUR (6/6)')
    expect(consignesDuBudget(e, 5)).toEqual([])
  })

  it('consignes différées : clôture, chemins, reprise du dépôt — dans cet ordre, une fois', () => {
    const e = etat()
    e.consigneClotureApresRemember = true
    e.consigneCheminsApresRemember = 'chemins'
    e.consigneRepriseRemember = 'reprise'
    expect(consignesDifferees(e)).toEqual([
      { consigne: RELANCE_CONCLUSION_ABSENTE, remplace: true },
      { consigne: 'chemins', remplace: true },
      { consigne: 'reprise', remplace: false }
    ])
    expect(consignesDifferees(e)).toEqual([])
  })
})
