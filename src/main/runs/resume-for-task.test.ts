import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeTaskKey,
  pickResumeForTask,
  type OrchestrationRunState
} from './orchestration-state'
import { MARQUEUR_CIBLE_CONTEXTUALISEE } from '../../shared/relance-sans-objet'

/**
 * REPRENDRE SANS REPAYER.
 *
 * Constaté le 2026-07-29 : le chemin de reprise n'existait qu'au REDÉMARRAGE de l'app. Quand
 * l'utilisateur écrit « reprend » dans une conversation, la commande `orchestrate` relançait de zéro et
 * REPAYAIT les phases déjà produites — à ~1 $ la phase, ce n'est pas un défaut de lisibilité.
 *
 * Les conditions sont volontairement STRICTES : réinjecter un acquis fait SAUTER des phases, donc un
 * faux positif produit un livrable bâti sur du travail étranger. Ces tests verrouillent chaque refus.
 */
const state = (over: Partial<OrchestrationRunState>): OrchestrationRunState => ({
  runId: 'run-1',
  task: 'ajouter un module de durée',
  conversationId: 'conv-1',
  phaseOutputs: [{ phase: 'build', text: 'module écrit' }],
  startedAt: 1_000,
  updatedAt: 2_000,
  ...over
})

const NOW = 10_000

describe('normalizeTaskKey — « la même tâche » à l’espace près', () => {
  it('ignore casse, espaces multiples et bords', () => {
    expect(normalizeTaskKey('  Ajouter   un  MODULE ')).toBe('ajouter un module')
  })
})

describe('pickResumeForTask — reprend, ou refuse en le justifiant', () => {
  it('même tâche, même conversation, acquis non vide → REPRIS', () => {
    const found = pickResumeForTask([state({})], {
      task: 'ajouter un module de durée',
      conversationId: 'conv-1',
      nowMs: NOW
    })
    expect(found?.runId).toBe('run-1')
  })

  it('tolère une réécriture d’espaces et de casse de la tâche', () => {
    const found = pickResumeForTask([state({})], {
      task: '  Ajouter un   module de DURÉE  ',
      conversationId: 'conv-1',
      nowMs: NOW
    })
    expect(found).not.toBeNull()
  })

  it('une AUTRE conversation n’est JAMAIS reprise (travail étranger)', () => {
    expect(
      pickResumeForTask([state({ conversationId: 'conv-2' })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('une AUTRE tâche n’est pas reprise', () => {
    expect(
      pickResumeForTask([state({ task: 'supprimer le module' })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('un acquis VIDE n’est pas un acquis — le reprendre sauterait la phase sans son travail', () => {
    expect(
      pickResumeForTask([state({ phaseOutputs: [{ phase: 'build', text: '   ' }] })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('trop VIEUX → refusé (réinjecter la veille surprendrait)', () => {
    const old = state({ updatedAt: 1 })
    expect(
      pickResumeForTask([old], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: 1 + 25 * 60 * 60 * 1000
      })
    ).toBeNull()
  })

  it('un acquis daté du FUTUR (horloge incohérente) est refusé', () => {
    expect(
      pickResumeForTask([state({ updatedAt: NOW + 5_000 })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('sans conversation, aucune reprise ici (cet acquis appartient au démarrage)', () => {
    expect(
      pickResumeForTask([state({ conversationId: undefined })], {
        task: 'ajouter un module de durée',
        conversationId: undefined,
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('tâche vide → rien (jamais un appariement sur du vide)', () => {
    expect(
      pickResumeForTask([state({ task: '   ' })], {
        task: '   ',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('plusieurs candidats → le PLUS RÉCENT', () => {
    const found = pickResumeForTask(
      [state({ runId: 'vieux', updatedAt: 2_000 }), state({ runId: 'recent', updatedAt: 8_000 })],
      { task: 'ajouter un module de durée', conversationId: 'conv-1', nowMs: NOW }
    )
    expect(found?.runId).toBe('recent')
  })

  it('aucun état → null', () => {
    expect(pickResumeForTask([], { task: 'x', conversationId: 'conv-1', nowMs: NOW })).toBeNull()
  })
})

/**
 * « REPREND » RETROUVE LA TÂCHE QU'IL PORTE (conv-1038, 2026-10-21).
 *
 * Une relance sans objet devient l'objectif du run, enveloppée par commands.ts :
 * `<relance>\n\nCIBLE CONTEXTUALISEE : <tâche déléguée>`. Le point de reprise, lui, porte la tâche
 * d'origine. Comparées en entier, les deux ne s'appariaient jamais : le « REPREND » de 14 h 19 a
 * relancé un run complet (2 h, ~36 $) alors que le pilote déléguait la tâche d'origine MOT POUR MOT
 * — 5 249 caractères identiques, relus dans les deux RUN.md de conv-1038.
 *
 * Une reprise réécrit son point de reprise avec la tâche enveloppée ; la relance suivante (« go »,
 * « vazy ») doit donc la retrouver aussi, et la tâche retapée en clair également.
 */
describe('pickResumeForTask — « reprend » compare aussi la tâche déléguée', () => {
  const TACHE = 'Traite ENSEMBLE ces 7 candidats issus du scout interne d’Autowin : …'
  const enveloppe = (relance: string, cible: string): string =>
    `${relance}\n\n${MARQUEUR_CIBLE_CONTEXTUALISEE} ${cible}`
  const cherche = (etatTache: string, demande: string, conversationId = 'conv-1') =>
    pickResumeForTask([state({ runId: 'run-d0fadac9063f-1', task: etatTache })], {
      task: demande,
      conversationId,
      nowMs: NOW
    })

  it('point de reprise de la tâche d’origine, « REPREND » qui la délègue → REPRIS', () => {
    expect(cherche(TACHE, enveloppe('REPREND', TACHE))?.runId).toBe('run-d0fadac9063f-1')
  })

  it('point de reprise déjà réécrit par un « REPREND », relance « vazy » → REPRIS', () => {
    expect(cherche(enveloppe('REPREND', TACHE), enveloppe('vazy', TACHE))?.runId).toBe(
      'run-d0fadac9063f-1'
    )
  })

  it('point de reprise réécrit par un « reprend », tâche retapée en clair → REPRIS', () => {
    expect(cherche(enveloppe('reprend', TACHE), TACHE)?.runId).toBe('run-d0fadac9063f-1')
  })

  it('« reprend » qui délègue une AUTRE tâche n’est pas repris', () => {
    expect(cherche(TACHE, enveloppe('reprend', 'supprimer le module'))).toBeNull()
  })

  it('un message qui NOMME son objet n’ouvre pas la tâche citée après le marqueur', () => {
    // Seule une relance sans objet est enveloppée par commands.ts : le texte avant le marqueur doit
    // en être une, sinon le message de l'utilisateur reste seul maître du run.
    expect(cherche(TACHE, enveloppe('corrige le bouton Revenir', TACHE))).toBeNull()
  })

  it('« reprend » dans une AUTRE conversation ne reprend jamais le travail de celle-ci', () => {
    expect(cherche(TACHE, enveloppe('reprend', TACHE), 'conv-2')).toBeNull()
  })
})

/**
 * CÂBLAGE — le défaut n'était pas l'absence de mécanisme, c'était que la commande du chat appelait
 * `runTask` en s'arrêtant à 6 arguments : `resumeOutputs` ET `conversationId` étaient omis.
 */
describe('câblage — la commande du chat reprend et rattache la conversation', () => {
  const source = readFileSync(join(__dirname, '..', 'commands.ts'), 'utf8')
  const osSource = readFileSync(join(__dirname, '..', 'os.ts'), 'utf8')

  it('elle cherche un acquis pour CETTE tâche et CETTE conversation', () => {
    expect(source).toMatch(
      /resumableOrchestrationForTask\?\.\(\s*task,\s*convId,\s*Date\.now\(\),\s*bindingOverride,\s*runtimeSnapshot\s*\)/
    )
  })

  it('elle passe l’acquis À runTask (sinon la recherche ne sert à rien)', () => {
    expect(source).toContain('resumeOutputs,')
  })

  it('elle transmet aussi le runId acquis pour rouvrir le même worktree', () => {
    expect(osSource).toContain('resumeRunId: resumeControl?.runId')
  })

  it('elle passe enfin `conversationId` — il manquait aussi', () => {
    // Délimite l'appel par sa PARENTHÈSE fermante, pas par un budget de caractères : un budget cassait
    // dès qu'une ligne était ajoutée dans le corps de l'appel (arrivé en ajoutant `durationMs`).
    const start = source.indexOf('const r = await this.os.runTask(')
    expect(start).toBeGreaterThan(0)
    const call = source.slice(start, source.indexOf('\n          )', start))
    expect(call).toContain('convId')
    expect(call).toContain('resumeOutputs')
    expect(call).toContain('runtimeSnapshot')
  })

  it('elle OUBLIE l’acquis repris (sinon il serait rejoué à chaque relance)', () => {
    expect(source).toContain('this.os.forgetResumableOrchestration(resumable.runId)')
  })

  it('elle ne supprime pas le checkpoint réécrit sous la même identité de run', () => {
    expect(source).toContain('currentRunId !== resumable.runId')
  })

  it('la réutilisation est VISIBLE : sauter des phases payées n’est jamais silencieux', () => {
    expect(source).toContain('reprise : phases deja acquises reutilisees')
  })
})

/**
 * Le bouton « Reprendre » n'emprunte PAS le chat : il appelle l'orchestration directe, pour ne pas
 * fabriquer dans le fil un message que l'utilisateur n'a jamais tapé. Ce chemin-là repartait de zéro
 * — la recherche d'acquis n'existait que côté chat, donc reprendre repayait tout.
 */
describe('câblage — le chemin DIRECT reprend lui aussi', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
  const handler = source.slice(source.indexOf("ipcMain.handle('os:orchestrate',"))

  it('il cherche un acquis pour cette tâche et cette conversation', () => {
    expect(handler).toContain('os.resumableOrchestrationForTask?.(')
    expect(handler).toContain('runtimeSnapshot')
  })

  it('il passe l’acquis ET la conversation à runTask', () => {
    const call = handler.slice(
      handler.indexOf('const result = await os.runTask('),
      handler.indexOf('\n      )')
    )
    expect(call).toContain('resumedAcquis?.phaseOutputs')
    expect(call).toContain('conversationId')
    expect(call).toMatch(/,\s*runtimeSnapshot\s*$/)
    expect(call).not.toContain('captureOrchestrationRuntime')
  })

  it('il OUBLIE l’acquis repris (sinon rejoué à chaque relance)', () => {
    expect(handler).toContain('os.forgetResumableOrchestration(resumedAcquis.runId)')
  })

  it('il conserve le checkpoint courant quand la reprise garde le même runId', () => {
    expect(handler).toContain('currentRunId !== resumedAcquis.runId')
  })
})
