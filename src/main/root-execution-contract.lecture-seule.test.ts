import { describe, expect, it } from 'vitest'
import { isMutationTask } from './task-mutation-classifier'
import {
  ROOT_DOD,
  etatDeCloture,
  rootDodLabels,
  rootRequirementChecks,
  runEnLectureSeule
} from './root-execution-contract'
import { regimePhases } from './task-regime'

/**
 * Defaut vecu le 2026-08-18 : « bloqué par le gate — Statut "red" : la clôture a été refusée en
 * amont » sur un scout qui avait pourtant produit sa shortlist.
 *
 * Chaine mesuree : le prompt de l'utilisateur est classe MUTATION (`isMutationTask` -> true, verifie
 * ci-dessous), et depuis que « scout » nomme deterministe­ment la phase, le run ne joue QUE scout.
 * La cloture exigeait alors une preuve de mutation qu'un run en lecture seule ne peut pas produire :
 * `evidenceOk` faux, statut red, refus. Un run doit etre juge sur ce qu'on lui a demande de JOUER.
 */
describe('un run en LECTURE SEULE ne doit pas prouver une mutation', () => {
  it('le prompt reel de l utilisateur EST classe mutation — la cause du faux rouge', () => {
    const prompt =
      "en te basant sur la derniere conversation qu'on a eu (cite la moi pour etre sur) scout des amelioration de l'experience utilisateur pour oneshot les tasks"
    expect(isMutationTask(prompt)).toBe(true)
  })

  it('reconnait un run qui n a joue que des phases de lecture', () => {
    expect(runEnLectureSeule([{ phase: 'scout' }])).toBe(true)
    expect(runEnLectureSeule([{ phase: 'scout' }, { phase: 'frame' }])).toBe(true)
    expect(runEnLectureSeule([{ phase: 'frame' }, { phase: 'terrain' }])).toBe(true)
  })

  it('ne le reconnait PAS des qu une phase mutante a joue', () => {
    expect(runEnLectureSeule([{ phase: 'scout' }, { phase: 'build' }])).toBe(false)
    expect(runEnLectureSeule([{ phase: 'build' }])).toBe(false)
    expect(runEnLectureSeule([{ phase: 'clean' }])).toBe(false)
  })

  it('un run SANS phase n est pas declare lecture seule (on ne blanchit pas le vide)', () => {
    expect(runEnLectureSeule([])).toBe(false)
  })
})

describe("l'etat de cloture, calcule en un seul endroit", () => {
  const PROMPT_REEL =
    "en te basant sur la derniere conversation qu'on a eu (cite la moi pour etre sur) scout des amelioration de l'experience utilisateur pour oneshot les tasks"

  it('un scout SEUL sur un prompt classe mutation se clot VERT', () => {
    const etat = etatDeCloture(
      PROMPT_REEL,
      [{ phase: 'scout', text: ['| # | Score | Type |', '| 1 | 82 | fix |'].join('\n') }],
      false, // aucune preuve de mutation : c'est justement le point
      true // le prompt EST classe mutation
    )
    expect(etat.status).toBe('green')
    // Aucune case de mutation ni de test ne doit lui etre opposee.
    expect(etat.dod.map((c) => c.label)).toEqual(['Analyse demandee presente dans le livrable'])
    expect(etat.dod[0].checked).toBe(true)
  })

  it('un scout MUET reste rouge sur son analyse — on ne blanchit pas le vide', () => {
    const etat = etatDeCloture(PROMPT_REEL, [{ phase: 'scout', text: '   ' }], false, true)
    expect(etat.dod[0].checked).toBe(false)
  })

  it('des qu une phase MUTANTE a joue, la preuve de mutation redevient exigible', () => {
    const etat = etatDeCloture(
      PROMPT_REEL,
      [{ phase: 'scout', text: 'shortlist' }, { phase: 'build', text: 'fait' }],
      false,
      true
    )
    expect(etat.status).toBe('red')
    expect(etat.dod.some((c) => c.label.startsWith('Mutation demandee'))).toBe(true)
  })

  it('une mutation reellement prouvee se clot verte', () => {
    const etat = etatDeCloture(
      PROMPT_REEL,
      [{ phase: 'scout', text: 'shortlist' }, { phase: 'build', text: 'fait' }],
      true,
      true
    )
    expect(etat.status).toBe('green')
  })
})

/**
 * Defaut trouve par un juge externe le 2026-08-18, APRES le correctif « croisement avec les phases
 * programmees » : `rootRequirementChecks` est un QUATRIEME appelant de `rootExecutionRequirements`
 * qui ne recoit PAS les phases, et sa preuve d'analyse n'accepte que la phase `scout`. Un run
 * programme `['terrain']` (ou `['frame']`) se voit donc semer la case « Analyse demandee » par
 * `rootDodLabels` — legitime, il peut la tenir — mais cette case est STRUCTURELLEMENT incochable :
 * le run ne joue jamais `scout`. Resultat vecu : « DoD 0/1 » sur un livrable complet, c'est-a-dire
 * le meme reproche fantome, reduit de trois portes a une, pas supprime.
 */
describe('la case ANALYSE doit etre tenable par toute phase de LECTURE', () => {
  const TACHE_TERRAIN = '/terrain mets en place le harnais, analyse le repo et modifie le script'

  it('le programme rend bien ["terrain"] et sa seule case de DoD est l analyse', () => {
    expect(regimePhases(TACHE_TERRAIN)).toEqual(['terrain'])
    expect(rootDodLabels(TACHE_TERRAIN, regimePhases(TACHE_TERRAIN))).toEqual([
      ROOT_DOD.analysis
    ])
  })

  it('un terrain qui a produit du texte COCHE sa case d analyse', () => {
    const checks = rootRequirementChecks(TACHE_TERRAIN, {
      phases: [{ phase: 'terrain', text: 'harnais, observabilite, etat de reprise' }]
    })
    // NB : sans phases, `rootRequirementChecks` compile aussi les cases mutation/tests — seule la
    // case ANALYSE nous occupe ici, c'est la seule que `rootDodLabels` a semee dans le RUN.md.
    expect(checks.find((c) => c.label === ROOT_DOD.analysis)?.checked).toBe(true)
  })

  it('un frame qui a produit du texte COCHE sa case d analyse', () => {
    const checks = rootRequirementChecks(TACHE_TERRAIN, {
      phases: [{ phase: 'frame', text: 'besoin cadre' }]
    })
    expect(checks.find((c) => c.label === ROOT_DOD.analysis)?.checked).toBe(true)
  })

  it('SYMETRIE : un programme avec `build` garde ses cases ET n a rien de gratuit', () => {
    const tache = 'analyse le repo, modifie le script, lance les tests puis commit'
    const phases = ['frame', 'build']
    expect(rootDodLabels(tache, phases)).toEqual([
      ROOT_DOD.analysis,
      ROOT_DOD.mutation,
      ROOT_DOD.tests,
      ROOT_DOD.commit
    ])
    // Aucune phase de LECTURE porteuse de texte -> l analyse reste DUE, pas offerte.
    const sansLecture = rootRequirementChecks(tache, {
      phases: [{ phase: 'build', text: 'code ecrit' }]
    })
    expect(sansLecture.find((c) => c.label === ROOT_DOD.analysis)?.checked).toBe(false)
    // Et les autres cases restent exigeantes : aucune preuve -> aucune coche.
    expect(sansLecture.filter((c) => c.checked)).toEqual([])
  })

  it('une phase de lecture MUETTE ne coche rien (pas de blanchiment par la forme)', () => {
    const checks = rootRequirementChecks(TACHE_TERRAIN, {
      phases: [{ phase: 'terrain', text: '   ' }]
    })
    expect(checks.find((c) => c.label === ROOT_DOD.analysis)?.checked).toBe(false)
  })

  it('CAS VIDE : aucune phase -> la case n est jamais cochee par defaut', () => {
    const checks = rootRequirementChecks(TACHE_TERRAIN, { phases: [] })
    expect(checks.find((c) => c.label === ROOT_DOD.analysis)?.checked).toBe(false)
    expect(checks.every((c) => !c.checked)).toBe(true)
  })
})
