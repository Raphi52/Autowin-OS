import { describe, expect, it, vi } from 'vitest'
import { executerActionGit, planifierActionGit } from './git-action-main'

/**
 * LA PORTE QUE LE GLISSER-DÉPOSER OUVRE, et les verrous qui la tiennent.
 *
 * Demande de l'utilisateur (2026-09-15) : « j'aimerais pouvoir drag and drop les points et que la
 * bonne commande soit appelée en fond ». Jusqu'ici `src/main/ipc/git.ts` portait un contrat écrit —
 * « aucune ACTION git ici » — avec une seule exception, `git:checkout`. Ce module est l'exception
 * suivante, et elle est BORNÉE par une liste blanche :
 *
 *  - DEUX gestes seulement, tous deux en AVANT : fusionner une branche, rapporter un commit. Aucune
 *    réécriture d'histoire (`rebase`, `reset`, `branch -f`, `push --force`) ne peut sortir d'ici :
 *    un geste de souris ne doit jamais pouvoir détruire un commit.
 *  - la commande est CONSTRUITE ici, jamais reçue de l'interface : le renderer envoie un type et des
 *    noms, pas une ligne de commande. Sans cela, `--exec=rm -rf` passé comme « nom de branche »
 *    serait exécuté par git.
 */
describe('planifierActionGit — la liste blanche', () => {
  it('traduit « fusionner » en checkout puis merge, sans forçage', () => {
    expect(planifierActionGit({ type: 'merge', source: 'feat/x', cible: 'main' })).toEqual({
      argv: [
        ['checkout', 'main'],
        ['merge', '--no-ff', 'feat/x']
      ],
      libelle: 'git checkout main && git merge --no-ff feat/x'
    })
  })

  it('traduit « rapporter ce commit » en checkout puis cherry-pick', () => {
    expect(
      planifierActionGit({ type: 'cherry-pick', commit: 'abc1234def', cible: 'main' })
    ).toEqual({
      argv: [
        ['checkout', 'main'],
        ['cherry-pick', 'abc1234def']
      ],
      libelle: 'git checkout main && git cherry-pick abc1234def'
    })
  })

  it.each(['rebase', 'reset', 'push', 'branch-force', 'clean'])(
    'REFUSE « %s » : un geste de souris ne réécrit pas l’histoire',
    (type) => {
      const plan = planifierActionGit({
        type,
        source: 'feat/x',
        cible: 'main'
      } as unknown as Parameters<typeof planifierActionGit>[0])
      expect(plan).toEqual({ refus: `Geste « ${type} » hors de la liste blanche.` })
    }
  )

  /** CAS LIMITE — un nom qui commence par `-` est une OPTION pour git, pas une branche. */
  it('refuse un nom de branche qui se ferait passer pour une option', () => {
    expect(planifierActionGit({ type: 'merge', source: '--exec=calc', cible: 'main' })).toEqual({
      refus: 'Nom de branche invalide : « --exec=calc ».'
    })
  })

  /** CAS LIMITE — noms vides, espaces, `..`, `.lock` : git les refuse, on ne les lui envoie même pas. */
  it.each(['', '   ', 'feat/..x', 'ma branche', 'feat/x.lock', 'feat/x;rm'])(
    'refuse le nom de branche « %s »',
    (nom) => {
      const plan = planifierActionGit({ type: 'merge', source: nom, cible: 'main' })
      expect(plan).toHaveProperty('refus')
    }
  )

  /** CAS LIMITE — le commit doit être une empreinte, sinon `--force` passerait pour un commit. */
  it.each(['--force', 'HEAD~1', 'main', '', 'zzzz'])('refuse le commit « %s »', (commit) => {
    expect(planifierActionGit({ type: 'cherry-pick', commit, cible: 'main' })).toHaveProperty(
      'refus'
    )
  })
})

describe('executerActionGit — un échec ARRÊTE la suite', () => {
  it('n’enchaîne pas la fusion quand le changement de branche a échoué', async () => {
    const lancer = vi.fn().mockResolvedValueOnce({
      ok: false,
      sortie: 'error: Your local changes would be overwritten'
    })
    const resultat = await executerActionGit(
      'C:/depot',
      { type: 'merge', source: 'feat/x', cible: 'main' },
      lancer
    )
    expect(lancer).toHaveBeenCalledTimes(1)
    expect(resultat).toEqual({
      ok: false,
      raison: 'git checkout main a échoué : error: Your local changes would be overwritten'
    })
  })

  it('rend la sortie de git quand tout passe', async () => {
    const lancer = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, sortie: "Switched to branch 'main'" })
      .mockResolvedValueOnce({ ok: true, sortie: 'Merge made by the ort strategy.' })
    const resultat = await executerActionGit(
      'C:/depot',
      { type: 'merge', source: 'feat/x', cible: 'main' },
      lancer
    )
    expect(lancer).toHaveBeenNthCalledWith(1, 'C:/depot', ['checkout', 'main'])
    expect(lancer).toHaveBeenNthCalledWith(2, 'C:/depot', ['merge', '--no-ff', 'feat/x'])
    expect(resultat).toEqual({
      ok: true,
      commande: 'git checkout main && git merge --no-ff feat/x',
      sortie: "Switched to branch 'main'\nMerge made by the ort strategy."
    })
  })

  it('ne lance RIEN quand le geste est refusé par la liste blanche', async () => {
    const lancer = vi.fn()
    const resultat = await executerActionGit(
      'C:/depot',
      { type: 'merge', source: '--exec=calc', cible: 'main' },
      lancer
    )
    expect(lancer).not.toHaveBeenCalled()
    expect(resultat).toEqual({ ok: false, raison: 'Nom de branche invalide : « --exec=calc ».' })
  })

  /** CAS LIMITE — dossier de travail vide : on ne lance pas git « quelque part ». */
  it('refuse un dépôt non nommé', async () => {
    const lancer = vi.fn()
    expect(
      await executerActionGit('  ', { type: 'merge', source: 'feat/x', cible: 'main' }, lancer)
    ).toEqual({ ok: false, raison: 'Dépôt non précisé.' })
    expect(lancer).not.toHaveBeenCalled()
  })
})
