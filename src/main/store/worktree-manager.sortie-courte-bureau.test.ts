import { afterEach, describe, expect, it } from 'vitest'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE PRIX D'UNE QUESTION POSEE A UN SEUL BUREAU.
 *
 * MESURE le 2026-09-04 (conv-233). `edit_file` demande la liste COMPLETE des travaux non publies
 * uniquement pour savoir si LE bureau qu'il s'apprete a prendre porte deja du travail. Sur ce
 * depot, avec 40 copies accumulees, ce recensement coute 18 699 ms — payes AVANT la moindre
 * ligne editee, et dans le meme budget que l'operation worktree. Au-dela du delai, l'edition
 * echoue sur « Operation worktree interrompue apres 182000 ms » sans avoir rien ecrit. Deux
 * editions perdues dans la session, puis un delai allonge de 30 s a 180 s qui n'a rien regle :
 * le cout croit avec le nombre de copies, allonger deplace le mur.
 *
 * `bureauPeutPorterDuTravail` repond a la question POSEE, au prix d'un seul bureau (145 ms mesures
 * sur le meme depot). La sortie est NEGATIVE, donc sure : sans dossier de bureau, sans branche de
 * secours et sans sauvetage pour cet identifiant, le recensement complet n'aurait rien trouve.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : repondre `false` alors qu'une des trois traces existe —
 * ce serait sauter le recensement sur un bureau qui porte du travail, donc l'ecraser.
 */
describe('WorktreeManager — la question a UN bureau se paie au prix d’UN bureau', () => {
  afterEach(() => nettoyerRacines())

  it('répond NON pour un identifiant sans aucune trace — rien à recenser', () => {
    const repo = tempRepo()
    const m = manager(repo)
    expect(m.bureauPeutPorterDuTravail('command-edit-jamais-vu')).toBe(false)
  })

  it('répond OUI dès qu’un bureau existe sur le disque', () => {
    const repo = tempRepo()
    const m = manager(repo)
    m.acquire('command-edit-avec-bureau')
    expect(m.bureauPeutPorterDuTravail('command-edit-avec-bureau')).toBe(true)
  })

  it('répond OUI pour une branche de secours, même sans bureau', () => {
    const repo = tempRepo()
    const m = manager(repo)
    git(repo, 'branch', 'autowin/recovery/command-edit-secouru', 'HEAD')
    expect(m.bureauPeutPorterDuTravail('command-edit-secouru')).toBe(true)
  })

  it('répond OUI pour un sauvetage dont la copie a disparu', () => {
    const repo = tempRepo()
    const m = manager(repo)
    const sha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'update-ref', 'refs/autowin/rescue/command-edit-sauve', sha)
    expect(m.bureauPeutPorterDuTravail('command-edit-sauve')).toBe(true)
  })

  it('refuse un identifiant hors format, sans interroger git', () => {
    const repo = tempRepo()
    const m = manager(repo)
    expect(m.bureauPeutPorterDuTravail('../evasion')).toBe(false)
  })
})
