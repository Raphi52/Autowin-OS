import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commitRecopie, remplacerLigne } from './separation-commits-fautifs.mjs'

const SCRIPT = resolve(import.meta.dirname, 'separation-commits-fautifs.mjs')
const dossiers = []

function depot() {
  const dossier = mkdtempSync(join(tmpdir(), 'reecriture-'))
  dossiers.push(dossier)
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dossier,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Essai',
        GIT_AUTHOR_EMAIL: 'essai@exemple.invalid',
        GIT_COMMITTER_NAME: 'Essai',
        GIT_COMMITTER_EMAIL: 'essai@exemple.invalid',
        GIT_AUTHOR_DATE: '2026-01-01T10:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T10:00:00Z'
      }
    }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'core.hooksPath', '/dev/null')
  return { dossier, git }
}

function poser(dossier, git, fichier, texte, message) {
  writeFileSync(join(dossier, fichier), texte)
  git('add', fichier)
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

describe('remplacerLigne', () => {
  it('remplace la seule ligne visée et garde les fins de ligne', () => {
    expect(remplacerLigne('a\r\nb\r\nc\n', 2, 'B')).toBe('a\r\nB\r\nc\n')
  })
  it('refuse une ligne absente', () => {
    expect(() => remplacerLigne('a\n', 5, 'x')).toThrow(/ligne 5 absente/)
  })
})

describe('commitRecopie', () => {
  it('remplace arbre et parents, retire la signature, garde auteur et date', () => {
    const brut =
      'tree aaa\nparent bbb\nauthor A <a@x> 1 +0100\ncommitter C <c@x> 2 +0100\n' +
      'gpgsig -----BEGIN-----\n ligne\n -----END-----\n\nancien message\n'
    expect(commitRecopie(brut, { arbre: 'ttt', parents: ['ppp'], message: 'neuf' })).toBe(
      'tree ttt\nparent ppp\nauthor A <a@x> 1 +0100\ncommitter C <c@x> 2 +0100\n\nneuf\n'
    )
  })
})

describe('--reecrire', () => {
  it('corrige un blob dans chaque commit qui le porte, fusions comprises, sans toucher la source', () => {
    const { dossier, git } = depot()
    poser(dossier, git, 'a.txt', 'propre\n', 'base')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const fautif = poser(dossier, git, 'a.txt', 'un\nINTERDIT\ntrois\n', 'ajoute la faute')
    const blobFautif = git('rev-parse', `${fautif}:a.txt`)
    git('checkout', '-q', '-b', 'cote')
    const messageFautif = poser(dossier, git, 'b.txt', 'b\n', 'message INTERDIT')
    git('checkout', '-q', 'main')
    poser(dossier, git, 'c.txt', 'c\n', 'autre travail')
    git('merge', '-q', '--no-ff', '-m', 'fusion', 'cote')
    poser(dossier, git, 'a.txt', 'un\nneutre\ntrois\n', 'retire la faute')
    const sourceAvant = git('rev-parse', 'main')

    const corrections = join(dossier, '..', `${dossier.split(/[\\/]/).pop()}-corrections.json`)
    dossiers.push(corrections, corrections.replace(/\.json$/, '.carte.tsv'))
    writeFileSync(
      corrections,
      JSON.stringify({
        fichiers: [{ blob: blobFautif, ligne: 2, texte: 'neutre' }],
        messages: [{ commit: messageFautif, message: 'message neutre' }]
      })
    )
    const sortie = execFileSync(
      'node',
      [SCRIPT, '--reecrire', corrections, 'origin', 'main', 'reecrite'],
      { cwd: dossier, encoding: 'utf8', windowsHide: true }
    )

    expect(git('rev-parse', 'main')).toBe(sourceAvant)
    expect(sortie).toContain('Contenu final identique a la source : oui')
    const objets = git('rev-list', '--objects', 'reecrite', '--not', '--remotes=origin')
    expect(objets).not.toContain(blobFautif)
    expect(git('log', '--format=%s', 'reecrite')).not.toContain('INTERDIT')
    expect(git('rev-list', '--count', '--merges', 'reecrite')).toBe('1')
    expect(git('rev-list', '--count', 'reecrite')).toBe(git('rev-list', '--count', 'main'))
    // Le commit de base, que le distant a déjà, garde son identifiant.
    expect(git('rev-list', '--max-parents=0', 'reecrite')).toBe(
      git('rev-list', '--max-parents=0', 'main')
    )

    // Rejouée plus tard sur une main qui a avancé, la réécriture redonne les MÊMES identifiants pour
    // l'historique déjà réécrit : la nouvelle branche prolonge l'ancienne, sans fourche.
    const reecriteAvant = git('rev-parse', 'reecrite')
    poser(dossier, git, 'd.txt', 'd\n', 'travail arrivé pendant la décision')
    execFileSync('node', [SCRIPT, '--reecrire', corrections, 'origin', 'main', 'reecrite-2'], {
      cwd: dossier,
      encoding: 'utf8',
      windowsHide: true
    })
    expect(git('rev-parse', 'reecrite-2^')).toBe(reecriteAvant)
  })

  it("n'écrase jamais une branche qui existe", () => {
    const { dossier, git } = depot()
    poser(dossier, git, 'a.txt', 'a\n', 'base')
    git('branch', 'reecrite')
    const corrections = join(dossier, 'corrections.json')
    writeFileSync(corrections, '{}')
    expect(() =>
      execFileSync('node', [SCRIPT, '--reecrire', corrections, 'origin', 'main', 'reecrite'], {
        cwd: dossier,
        stdio: 'pipe',
        windowsHide: true
      })
    ).toThrow()
  })
})
