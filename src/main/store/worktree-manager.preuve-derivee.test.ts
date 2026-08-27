import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

/** Vrais dépôts git en tmp : sous charge parallèle, le budget vitest par défaut est trop court. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * LA RÉCIDIVE — corriger un DOSSIER au lieu d'une CLASSE.
 *
 * Le 2026-08-21 (conv-1362), un run vert a bloqué sa propre publication : sa preuve vivait dans
 * `Audit/accueil-3d-anime.png`, un fichier ignoré, et la garde des « ignorés non régénérables » l'a
 * compté comme un livrable. Le correctif a ajouté `Audit/` à une liste d'exclusions écrite dossier
 * par dossier.
 *
 * Six jours plus tard, le 2026-08-27, conv-1425 a écrit sa preuve dans
 * `artifacts/nuage-conv1425-v2.png` et s'est fait refuser TROIS fois (07:57:25, 07:57:40, 08:07:40),
 * pour 3,22 $ et zéro livraison. `.gitignore` liste `Audit/` en ligne 9 et `artifacts/` en ligne 10 :
 * deux dossiers de preuves, même rôle, lignes voisines — un seul était dans la liste.
 *
 * On arrête d'énumérer. La règle se DÉRIVE de ce que le dépôt DÉCLARE lui-même : un fichier qui vit
 * dans un dossier entièrement ignoré est dans une zone que l'auteur du projet a désignée comme
 * jetable ; il ne bloque pas la publication. Un fichier ignoré INDIVIDUELLEMENT, lui, a été nommé un
 * par un — c'est peut-être un vrai livrable, et il continue de bloquer.
 *
 * Le discriminant compte autant que le correctif : desserrer cette garde sans le vérifier
 * publierait des fichiers que personne n'a voulu committer.
 */
describe('WorktreeManager — la preuve se DÉRIVE, elle ne s’énumère plus', () => {
  afterEach(() => nettoyerRacines())

  function depotIgnorant(regles: string): string {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), regles)
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'regles ignore')
    return repo
  }

  it('publie un run dont la preuve vit dans `artifacts/` — le cas exact de conv-1425', () => {
    // `artifacts/` n'a JAMAIS été dans la liste d'exclusions : c'est tout le défaut.
    const repo = depotIgnorant('node_modules\nout\nAudit/\nartifacts/\n')
    const wm = manager(repo)
    const path = wm.acquire('run-preuve-artifacts')
    writeFileSync(join(path, 'a.txt'), 'travail agent\n')
    mkdirSync(join(path, 'artifacts'), { recursive: true })
    writeFileSync(join(path, 'artifacts', 'nuage-conv1425-v2.png'), 'capture\n')

    expect(wm.finalize('run-preuve-artifacts')).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail agent')
  })

  it('publie aussi depuis un dossier ignoré que PERSONNE n’a prévu — la classe, pas le dossier', () => {
    // Le vrai test de la dérivation : un dossier ignoré dont aucun code d'Autowin n'a jamais entendu
    // parler. Une liste d'exclusions échouerait ici, par construction.
    const repo = depotIgnorant('node_modules\nout\npreuves-du-jour/\n')
    const wm = manager(repo)
    const path = wm.acquire('run-dossier-inedit')
    writeFileSync(join(path, 'a.txt'), 'travail agent\n')
    mkdirSync(join(path, 'preuves-du-jour'), { recursive: true })
    writeFileSync(join(path, 'preuves-du-jour', 'capture.png'), 'capture\n')

    expect(wm.finalize('run-dossier-inedit')).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail agent')
  })

  it('DISCRIMINANT — un fichier ignoré INDIVIDUELLEMENT bloque toujours', () => {
    // La garde reste une garde. Sans cette assertion, le correctif ci-dessus serait un recul
    // déguisé en progrès : on publierait des fichiers que personne n'a voulu committer.
    const repo = depotIgnorant('*.tmp\n')
    const wm = manager(repo)
    const path = wm.acquire('run-livrable-nomme')
    writeFileSync(join(path, 'result.tmp'), 'livrable ignoré\n')

    expect(wm.finalize('run-livrable-nomme')).toMatchObject({
      outcome: 'blocked',
      reason: 'ignored-deliverables',
      files: ['result.tmp']
    })
  })

  it('DISCRIMINANT — un fichier nommé à la racine bloque, même à côté d’un dossier jetable', () => {
    // Le cas mixte : la copie porte À LA FOIS une preuve jetable et un fichier nommé un par un.
    // Le refus doit tenir, et ne citer QUE le fichier qui le motive.
    const repo = depotIgnorant('artifacts/\nlivrable-*.pdf\n')
    const wm = manager(repo)
    const path = wm.acquire('run-mixte')
    mkdirSync(join(path, 'artifacts'), { recursive: true })
    writeFileSync(join(path, 'artifacts', 'preuve.png'), 'capture\n')
    writeFileSync(join(path, 'livrable-final.pdf'), 'le vrai livrable\n')

    expect(wm.finalize('run-mixte')).toMatchObject({
      outcome: 'blocked',
      reason: 'ignored-deliverables',
      files: ['livrable-final.pdf']
    })
  })
})
