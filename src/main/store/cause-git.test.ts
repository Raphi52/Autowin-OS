import { describe, expect, it } from 'vitest'
import { causeGit, sortieGit } from './cause-git'

/**
 * LE DIAGNOSTIC QUI MONTRAIT DU BRUIT À LA PLACE DE LA CAUSE.
 *
 * Vécu le 2026-08-26 : « Publication non aboutie (outcome blocked) : le travail n'est pas arrivé sur
 * la base : merge-failed — Preparing worktree (detached HEAD a5c46b36) ». Or « Preparing worktree »
 * n'est PAS une erreur : c'est la ligne de PROGRESSION de `git worktree add`.
 *
 * MESURÉ le même jour sur un dépôt temporaire — un `git worktree add` qui échoue (exit 128) écrit
 * sur stderr, dans cet ordre :
 *
 *     Preparing worktree (detached HEAD a5c46b36)
 *     fatal: '<chemin>' already exists
 *
 * Le code gardait le tout (`(stderr || stdout).trim()`) et l'affichage, borné, ne montrait que la
 * première ligne. La seule information exploitable était juste en dessous, coupée.
 *
 * On ne jette rien : le texte intégral reste disponible. On choisit seulement QUELLE ligne remonte
 * en tête, et une ligne qui se déclare `fatal:` ou `error:` passe devant une ligne de progression.
 */

describe('causeGit remonte la ligne qui porte la cause', () => {
  it('préfère le `fatal:` à la ligne de progression qui le précède', () => {
    const stderr = [
      'Preparing worktree (detached HEAD a5c46b36)',
      "fatal: 'C:/tmp/wt1' already exists"
    ].join('\n')

    expect(causeGit({ stdout: '', stderr })).toBe("fatal: 'C:/tmp/wt1' already exists")
  })

  it('reconnaît aussi `error:`', () => {
    const stderr = ['Preparing worktree (detached HEAD abc1234)', 'error: index is locked'].join(
      '\n'
    )
    expect(causeGit({ stdout: '', stderr })).toBe('error: index is locked')
  })

  it('rend la DERNIÈRE cause quand git en empile plusieurs', () => {
    // git termine par la raison décisive ; les précédentes sont souvent du contexte.
    const stderr = ['error: contexte', 'fatal: la vraie raison'].join('\n')
    expect(causeGit({ stdout: '', stderr })).toBe('fatal: la vraie raison')
  })

  it('garde le texte tel quel quand AUCUNE ligne ne se déclare cause', () => {
    // Le bord qui compte le plus : ne jamais avaler un message utile sous prétexte qu'il n'a pas
    // le bon préfixe. Sans cette branche, un échec sans `fatal:` deviendrait muet.
    expect(causeGit({ stdout: '', stderr: 'quelque chose a mal tourné' })).toBe(
      'quelque chose a mal tourné'
    )
  })

  it('retombe sur stdout quand stderr est vide', () => {
    expect(causeGit({ stdout: 'dit sur stdout', stderr: '' })).toBe('dit sur stdout')
  })

  it('rend une chaîne vide quand git n’a rien dit', () => {
    expect(causeGit({ stdout: '   ', stderr: '' })).toBe('')
  })
})

/**
 * POURQUOI UN MARQUEUR DE CONTRÔLE NE SE LIT PAS DANS LA CAUSE.
 *
 * Régression vécue le 2026-08-26, quelques heures après avoir introduit `causeGit` : elle avait été
 * branchée sur les deux sites de `worktree-manager` qui testent `AUTOWIN_GUARD:` pour décider si un
 * refus est TEMPORAIRE (`base-in-progress`, réessayable) ou DÉFINITIF (`merge-failed`). Or `causeGit`
 * JETTE des lignes. Dès que git émettait aussi un `fatal:`, la sentinelle du hook disparaissait et un
 * refus réessayable se rapportait comme perdu — 4 tests rouges, verts à nouveau une fois la décision
 * rebranchée sur la sortie intacte. Le défaut n'était pas dans `causeGit` mais dans son EMPLOI : un
 * réducteur d'affichage placé sur un chemin de décision.
 */
describe('sortieGit — la sortie intacte, pour DÉCIDER', () => {
  const avecSentinelle = ['AUTOWIN_GUARD:index-changed', 'fatal: refus du hook'].join('\n')

  it('garde la sentinelle que causeGit jette', () => {
    expect(sortieGit({ stdout: '', stderr: avecSentinelle })).toContain('AUTOWIN_GUARD:')
  })

  it('et causeGit la jette bien — c’est pour cela qu’elle ne décide de rien', () => {
    expect(causeGit({ stdout: '', stderr: avecSentinelle })).not.toContain('AUTOWIN_GUARD:')
  })

  it('rend le texte entier, pas seulement la ligne décisive', () => {
    expect(sortieGit({ stdout: '', stderr: avecSentinelle })).toBe(avecSentinelle)
  })

  it('retombe sur stdout, et rend vide quand git n’a rien dit', () => {
    expect(sortieGit({ stdout: 'dit sur stdout', stderr: '' })).toBe('dit sur stdout')
    expect(sortieGit({ stdout: '  ', stderr: '' })).toBe('')
  })
})
