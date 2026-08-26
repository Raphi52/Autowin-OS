import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * LE DÉFAUT, vécu le 2026-08-26 (run `ef845009a251-1`), signalé par l'utilisateur : « dans le même
 * bloc il me dit qu'il a pas fusionné mais qu'il faut tester, c'est n'importe quoi ».
 *
 * Sous un en-tête `⛔ Workflow ARRÊTÉ`, le message portait :
 *
 *   👉 Recommandé — lancer l'app et regarder l'accueil
 *   ⚠️ Travail NON fusionné : il reste dans la copie isolée …
 *
 * Les deux sont vrais séparément, et se contredisent ensemble : on invite à observer un résultat
 * qui n'est dans l'arbre de personne. Le worker rédige AVANT la gate ET avant la fusion — son
 * `👉 Recommandé` ne peut rien savoir ni du verdict, ni de l'endroit où son code a fini.
 *
 * La correction ne CENSURE pas : le contenu du conseil reste (c'est souvent la seule piste utile),
 * mais il porte désormais sa précondition. Retirer la ligne serait perdre l'information ; la
 * laisser nue, c'est envoyer l'utilisateur chercher un fichier qui n'existe pas chez lui.
 */

const rapportWorker = [
  '⚠️ Non résolu : pas de capture du rendu.',
  '',
  '📍 Maintenant — modifications dans le worktree du run, non fusionnées.',
  '⏳ Reste à faire — validation visuelle réelle sur la page d’accueil.',
  '👉 Recommandé — lancer l’app et regarder l’accueil.'
].join('\n')

describe('un conseil écrit avant la gate ne s’adresse pas à un arbre qui ne l’a pas reçu', () => {
  it('porte sa PRÉCONDITION quand le run est arrêté au contrôle final', () => {
    const texte = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      status: 'failed',
      workRetained: true,
      result: rapportWorker
    })

    // Le conseil survit — c'est la seule piste concrète du worker.
    expect(texte).toContain('lancer l’app et regarder l’accueil')
    // Mais il ne se lit plus comme une action immédiatement faisable.
    expect(texte).not.toContain('👉 Recommandé — lancer l’app et regarder l’accueil.')
    expect(texte).toMatch(/👉 Recommandé[^\n]*non validé/u)
  })

  it('annote AUSSI via `retainedWorkspace`, la lignée qui ne pose pas `workRetained`', () => {
    /*
     * Trois lignées construisent cette issue. Deux font `...result` et portent `retainedWorkspace` ;
     * seule `commands.ts` pose `workRetained`. Lire une seule des deux aurait laissé le correctif
     * mourir en silence sur les deux autres — le défaut classique de la lignée oubliée.
     */
    const texte = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      status: 'failed',
      retainedWorkspace: { runId: 'run-x', path: '/w/run-x', files: ['a.ts'] },
      result: rapportWorker
    })

    expect(texte).toMatch(/👉 Recommandé[^\n]*non validé/u)
  })

  it('laisse le conseil INTACT quand le travail est bien dans l’arbre', () => {
    // Gate bloqué mais rien de retenu : le conseil est suivable, on n'y touche pas.
    const texte = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      status: 'failed',
      result: rapportWorker
    })

    expect(texte).toContain('👉 Recommandé — lancer l’app et regarder l’accueil.')
  })

  it('ne touche PAS le conseil quand le travail a bien été livré', () => {
    // Sur une livraison réelle, ce bloc est déjà retiré par ailleurs : cette garde vérifie qu'on
    // n'a pas introduit d'annotation sur le chemin nominal.
    const texte = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result: rapportWorker
    })

    expect(texte).not.toMatch(/👉 Recommandé[^\n]*non validé/u)
  })
})
