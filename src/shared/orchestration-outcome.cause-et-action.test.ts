import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * « RÉSULTAT NON VALIDÉ » NE DIT RIEN À PERSONNE.
 *
 * Ce que l'utilisateur lisait, mot pour mot, le 2026-08-27 :
 *   « ⛔ Workflow ARRÊTÉ au contrôle final — résultat non validé · statut échoué · coût 3,22 $ »
 * Sa réponse : « ça m'a encore bloqué au lieu de finir le travail ». Il n'avait ni la cause, ni ce
 * qu'il fallait faire, ni l'information qu'une reprise allait se faire toute seule.
 *
 * Or la cause EXISTE dans l'issue depuis toujours : `gateReasons` porte
 * « blocage d'intégration: ignored-deliverables — fichiers en cause: … ». Le champ le disait
 * lui-même dans son commentaire de type : « Motifs RÉELS du blocage du gate. Présents depuis
 * toujours, jamais affichés jusqu'ici. » Ils n'étaient rendus que dans un panneau détaillé
 * (`WorkflowExecutionGraph`) qu'il faut penser à ouvrir — donc, en pratique, jamais lus.
 *
 * On ne SUPPRIME pas le message : un travail non intégré doit continuer à le dire, sinon on
 * fabrique le faux vert. On le rend UTILISABLE — la cause, puis l'action, puis le fait qu'une
 * reprise automatique est armée quand elle l'est.
 */
describe('formatOrchestrationOutcome — le blocage nomme sa cause et l’action', () => {
  const issue = (reason: string, files: string[] = []): Parameters<typeof formatOrchestrationOutcome>[1] => ({
    gateBlocked: true,
    status: 'failed',
    gateReasons: [
      'intégration locale non terminée',
      `blocage d’intégration: ${reason}${files.length ? ` — fichiers en cause: ${files.join(', ')}` : ''}`
    ]
  })

  it('dit ce que l’utilisateur doit faire sur une base sale, et que la reprise est armée', () => {
    const texte = formatOrchestrationOutcome(true, issue('base-dirty'))
    expect(texte).toContain('base sale')
    expect(texte).toMatch(/committe|range/i)
    // Le point qui répond à sa demande : il n'a pas à relancer lui-même.
    expect(texte).toMatch(/repris|reprise|automatique/i)
  })

  it('sur une opération git en cours, dit d’attendre — pas de geste inutile', () => {
    const texte = formatOrchestrationOutcome(true, issue('base-in-progress'))
    expect(texte).toMatch(/en cours/i)
    expect(texte).toMatch(/repris|reprise|automatique/i)
  })

  it('nomme les fichiers qui bloquent quand ils sont connus', () => {
    const texte = formatOrchestrationOutcome(
      true,
      issue('ignored-deliverables', ['livrable-final.pdf'])
    )
    expect(texte).toContain('livrable-final.pdf')
  })

  it('sur un conflit de contenu, dit clairement que c’est à l’humain d’arbitrer', () => {
    const texte = formatOrchestrationOutcome(true, issue('conflict', ['src/a.ts']))
    expect(texte).toMatch(/arbitr|toi|humain/i)
    // Et surtout : ne promet AUCUNE reprise automatique, parce qu'il n'y en aura pas.
    expect(texte).not.toMatch(/sera repris automatiquement/i)
  })

  it('DISCRIMINANT — ne déclare JAMAIS le travail livré', () => {
    // La tentation exacte à ne pas suivre : faire taire le message. Un travail non intégré doit
    // continuer à le dire, sinon on fabrique le faux vert que tout le kit existe pour empêcher.
    const texte = formatOrchestrationOutcome(true, issue('base-dirty'))
    expect(texte).not.toContain('✅')
    expect(texte).toMatch(/non intégré|pas .*intégré|NON publié/i)
  })

  it('DISCRIMINANT — une cause inconnue garde le message d’origine, sans inventer d’action', () => {
    const texte = formatOrchestrationOutcome(true, issue('cause-jamais-vue'))
    expect(texte).toContain('cause-jamais-vue')
    expect(texte).not.toMatch(/committe/i)
  })

  it('DISCRIMINANT — un run VALIDE n’est pas touché par ce chemin', () => {
    const texte = formatOrchestrationOutcome(true, {
      status: 'green',
      delivered: true,
      integrated: true
    } as Parameters<typeof formatOrchestrationOutcome>[1])
    expect(texte).not.toMatch(/committe|arbitr/i)
  })
})
