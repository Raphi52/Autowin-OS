import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchIntentPhase, normalizeIntent } from './intent-phase-routing'
import { regimePhases } from './task-regime'

/**
 * ROUTER L'INTENTION VERS UNE PHASE.
 *
 * Demande : « je veux = frame auto, cherches = scout auto, audi[te] = judge auto ». Aujourd'hui il faut
 * NOMMER la phase. MESURÉ sur 248 messages réels : « je veux / j'aimerais / il faut » a lancé une
 * orchestration 3 fois sur 3 — donc `frame, build` au minimum, jamais un cadrage seul.
 *
 * CONTRAINTE EXPLICITE de l'utilisateur : « ça doit servir à tout le monde, faut pas te fixer sur moi ».
 * La table est donc GÉNÉRIQUE (FR + EN, conjugaisons, troncatures) et son corpus ne sert qu'à VALIDER
 * la couverture. Les cas ci-dessous incluent volontairement des formulations que cet utilisateur
 * n'emploie PAS.
 */
describe('normalizeIntent — comparer des intentions, pas des chaînes', () => {
  it('accents, casse, apostrophe typographique et espaces multiples sont neutralisés', () => {
    expect(normalizeIntent("  J’AIMERAIS   ça  ")).toBe("j'aimerais ca")
  })

  it('une chaîne vide reste vide', () => {
    expect(normalizeIntent('   ')).toBe('')
  })
})

describe('famille FRAME — une volonté exprimée, pas un ordre d’exécution', () => {
  const cases = [
    'je veux un bouton réparer dans la popup',
    'je voudrais que ça reprenne sans popup',
    "j'aimerais bien que les changements s'affichent sans redémarrer",
    'J’aimerais un tableau lisible', // apostrophe typographique
    'il faut que ce soit ce qui concerne la conversation seulement',
    'faudrait revoir la barre latérale',
    'ça doit reprendre par défaut',
    'on devrait pouvoir annuler',
    "j'ai besoin d'un indicateur de coût",
    'besoin de voir la durée par phase',
    // Formulations que CET utilisateur n'emploie pas — la table doit servir tout le monde.
    'I want a repair button in the dialog',
    'we need a way to cancel a run',
    'it should remember my last tab',
    'je souhaite pouvoir filtrer les tickets'
  ]
  it.each(cases)('« %s » → frame', (message) => {
    expect(matchIntentPhase(message)?.phase).toBe('frame')
  })
})

describe('famille SCOUT — aucune tâche n’est encore choisie', () => {
  const cases = [
    'cherche ce qui cloche dans le routage',
    'cherches des améliorations au chat',
    'trouve moi une tâche sur les providers',
    'explore les pistes de perf',
    'repère les doublons',
    "qu'est-ce qu'on peut améliorer ici",
    'que faire sur les worktrees',
    'par où on commence',
    'où commencer sur le RAG',
    'what could we improve in the pipeline',
    'find opportunities in the renderer',
    'where do i start with the tickets view',
    'any ideas for the observatory'
  ]
  it.each(cases)('« %s » → scout', (message) => {
    expect(matchIntentPhase(message)?.phase).toBe('scout')
  })
})

describe('famille JUDGE — examiner un livrable qui existe déjà', () => {
  const cases = [
    'audite ce livrable',
    'audi le module de coût', // TRONCATURE réelle de l'utilisateur
    'auditer la portée du Brain',
    'juge la qualité du filtre',
    'évalue ce que ça vaut',
    'relis mon commit',
    "est-ce que c'est bon ?",
    'review this change',
    'assess the retrieval design',
    'vérifie la qualité du rendu'
  ]
  it.each(cases)('« %s » → judge', (message) => {
    expect(matchIntentPhase(message)?.phase).toBe('judge')
  })
})

describe('familles TERRAIN et CLEAN', () => {
  it('préparer une boucle autonome → terrain', () => {
    expect(matchIntentPhase('prépare le terrain pour la boucle')?.phase).toBe('terrain')
    expect(matchIntentPhase('set up the harness')?.phase).toBe('terrain')
  })

  it('nettoyer avant validation → clean', () => {
    expect(matchIntentPhase('nettoie avant de finir')?.phase).toBe('clean')
    expect(matchIntentPhase('fais le ménage')?.phase).toBe('clean')
  })
})

describe('ce qu’il ne faut SURTOUT pas router (le défaut de 2026-07-28)', () => {
  const ignored = [
    'corrige le doublon dans cette box', // action directe : le routage d'action existant s'en charge
    'ajoute un test sur la portée',
    'comment marche le cache de prompt', // question : reste conversationnelle
    'pourquoi ça coûte si cher',
    'dis-moi ce que tu en penses',
    'go',
    'vazy',
    'reprend',
    'merci', // conversation pure
    'framework react ou pas', // « framework » ne doit PAS matcher « frame »
    'le cleanup a échoué', // « cleanup » au milieu, pas une demande de clean
    'je me demande si scout aiderait' // intention CITÉE, pas demandée
  ]
  it.each(ignored)('« %s » → aucune route', (message) => {
    expect(matchIntentPhase(message)).toBeNull()
  })

  it('une intention en MILIEU de phrase n’est pas une demande', () => {
    // Mon premier test se contredisait : il attendait `frame` sur une phrase ou l'intention n'est PAS
    // en tete. Les motifs sont ancres sur `^` — c'est la regle, et elle vaut aussi contre moi.
    expect(matchIntentPhase('avant de coder, je veux dire que audite serait utile')).toBeNull()
    expect(matchIntentPhase('le module que audite regarde')).toBeNull()
  })

  it('un mot qui ENGLOBE l’intention n’est pas l’intention', () => {
    // Bug attrape par ces tests : `frame\w*` matchait « framework », `audi\w*` aurait matche « audio ».
    expect(matchIntentPhase('framework react ou pas')).toBeNull()
    expect(matchIntentPhase('audio du micro cassé')).toBeNull()
    expect(matchIntentPhase('cadrage général du projet')?.phase).toBe('frame')
  })
})

/**
 * L'EFFET RÉEL : ce module ne sert à rien s'il ne change pas les phases jouées. Ces cas passent par
 * `regimePhases`, la fonction que l'orchestrateur consulte vraiment.
 */
describe('effet sur les phases jouées — le gain concret', () => {
  it('AVANT/APRÈS : « je veux X » ne joue plus que le cadrage', () => {
    // Sans intention reconnue, une demande equivalente joue frame+build (regime standard).
    expect(regimePhases('modifie la popup pour ajouter un bouton')).toEqual(['frame', 'build'])
    // Avec l'intention : le cadrage SEUL.
    expect(regimePhases('je veux un bouton réparer dans la popup')).toEqual(['frame'])
  })

  it('« cherche … » ne joue que le scout, pas les cinq phases', () => {
    expect(regimePhases('cherche des améliorations au chat')).toEqual(['scout'])
  })

  it('« audite … » saute les phases d’exécution (le juge est la clôture externe)', () => {
    expect(regimePhases('audite le module de portée')).toEqual([])
  })

  it('une phase NOMMÉE garde la priorité sur l’intention', () => {
    expect(regimePhases('scout je veux des idées')).toEqual(['scout'])
  })

  it('une tâche de complexité CRITIQUE sans intention garde ses cinq phases', () => {
    // Garde anti-regression : le routage d'intention ne doit pas amputer une tache critique.
    expect(regimePhases('refactor la sécurité de l’authentification')).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'clean'
    ])
  })
})

describe('câblage — le routage est branché là où les phases se décident', () => {
  const source = readFileSync(join(__dirname, 'task-regime.ts'), 'utf8')

  it('`regimePhases` consulte l’intention', () => {
    expect(source).toContain('matchIntentPhase(task)?.phase')
  })

  it('APRÈS la phase nommée : une demande explicite reste autoritaire', () => {
    const named = source.indexOf('matchExplicitPhase(task)')
    const intent = source.indexOf('matchIntentPhase(task)')
    expect(named).toBeGreaterThan(0)
    expect(intent).toBeGreaterThan(named)
  })
})
