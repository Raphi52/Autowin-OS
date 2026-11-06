import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from './app/source-process-principal.test-helpers'

/**
 * LE BRANCHEMENT DE LA REPRISE D'UN FIL (conv-1423). `index.ts` ne se charge pas dans un test : il
 * démarre l'application. Ce qui compte ici tient à sa composition, lue dans le source, comme le font
 * déjà `index.reprise-du-fil-unique.test.ts` et `run-reattach.test.ts`.
 *
 * fix-ok: une composition fausse ne se voit dans aucun test unitaire : la lecture de la relecture à la
 * réactivation était rouge tant qu'`index.ts` ne la branchait pas (02/11).
 */
const source = sourceProcessPrincipal()

describe('index.ts — la reprise des fils coupés par le quota', () => {
  it('le tour part sans modèle imposé : il garde celui du fil', () => {
    // `tourCompteDesReception` ne remplit le modèle du fil que si le 4e argument est vide.
    expect(source).toContain('runPilotChat(undefined, messages, id)')
  })

  it('seuls les deux canaux de la fenêtre ouvrent un tour au nom d’une personne', () => {
    // `run-pilot-chat.ts` marque le tour d'après sa fenêtre. Un lanceur de fond qui en passerait une,
    // tâche, règle ou scout, redeviendrait reprenable seul, sans ses bornes.
    const appels = source.match(/runPilotChat\(\s*[^,\s]+/gu) ?? []
    expect(appels.map((appel) => appel.replace(/runPilotChat\(\s*/u, ''))).toEqual([
      'event.sender',
      'event.sender',
      'undefined',
      'undefined'
    ])
  })

  it('réactiver un fil relit les fils coupés, sauf dans une instance de test', () => {
    expect(source).toMatch(
      /relireLesFilsCoupes: \(\) => \{\s+if \(repriseDesFilsActive\) suiviDesFilsCoupes\.reprise\?\.replanifier\(\)/u
    )
  })

  it('il sort du devis du tour qui vient de finir, comme les autres tours de reprise', () => {
    expect(source).toMatch(
      /lancerTour: \(id, messages\) =>\s+os\.executionSupervisor\.runOutsideCurrent\(/u
    )
  })

  it('il replanifie par la fin de tour, et n’écrase pas l’écouteur unique du réveil des runs', () => {
    expect(source).toMatch(/const observateurDesPlans[\s\S]{0,700}reprise\?\.replanifier\(\)/u)
    expect(source.match(/os\.onMurDeQuota\(/gu)).toHaveLength(1)
    expect(source).toContain('os.onMurDeQuota(() => reveilApresQuota.replanifier())')
  })

  it('une file à part : un long tour ne retient pas le réveil d’un run', () => {
    expect(source).toContain('const fileDesFilsCoupes = new StartupResumeQueue()')
    expect(source).toContain('mettreEnFile: (tache) => fileDesFilsCoupes.enqueue(tache)')
  })

  it('une instance de test ne dépense pas de quota toute seule', () => {
    expect(source).toContain(
      'const repriseDesFilsActive = !isolatedTestInstance && !headlessTestInstance'
    )
    expect(source).toContain('if (repriseDesFilsActive) suiviDesFilsCoupes.reprise.replanifier()')
    expect(source).toContain('if (!issue.ok && repriseDesFilsActive)')
  })

  it('le suivi existe avant que le canal de la liste ne puisse le lire', () => {
    expect(source.indexOf('const suiviDesFilsCoupes')).toBeLessThan(
      source.indexOf('registerConversationsIpc({')
    )
  })
})
