/**
 * /git (conv-1250, 2026-10-29) : la cible de publication se DÉDUIT au lieu d'être retapée
 * (« /salvage push main origin », conv-997 et conv-1108). Chaque cas monte un vrai dépôt et un
 * vrai distant nu, puis vérifie la décision rendue.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleDepot,
  deduireCible,
  hebergeurDe,
  lireHabitudes,
  normaliserIdentite,
  retenirHabitude
} from './git-cible.mjs'
import { supprimerArbre } from '../src/main/fs-supprimer'

const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) supprimerArbre(aNettoyer.pop())
})

function dossier(prefixe) {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  aNettoyer.push(d)
  return d
}

function depot({ distant = true, autreAuteur = false, mesCommits = 0 } = {}) {
  const dir = dossier('git-cible-')
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'moi@poste')
  git('config', 'user.name', 'Moi')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  for (let i = 0; i < mesCommits; i += 1) {
    writeFileSync(
      join(dir, `m${i}.txt`),
      `${i}
`
    )
    git('add', '-A')
    git('commit', '-q', '-m', `moi ${i}`)
  }
  if (autreAuteur) {
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    git('add', '-A')
    git(
      '-c',
      'user.email=collegue@equipe',
      '-c',
      'user.name=Collègue',
      'commit',
      '-q',
      '-m',
      'travail collègue'
    )
  }
  let nu = null
  if (distant) {
    nu = dossier('git-cible-nu-')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', nu])
    git('remote', 'add', 'origin', nu)
    git('push', '-q', '-u', 'origin', 'main')
  }
  return { dir, git, nu }
}

describe('cleDepot', () => {
  it('ramène https, identifiant et ssh au même dépôt', () => {
    expect(cleDepot('https://Raphi52@github.com/Raphi52/Autowin-OS.git')).toBe(
      'github.com/raphi52/autowin-os'
    )
    expect(cleDepot('git@github.com:Raphi52/Autowin-OS.git')).toBe('github.com/raphi52/autowin-os')
    expect(cleDepot('https://org@dev.azure.com/org/Projet/_git/Depot')).toBe(
      'dev.azure.com/org/projet/_git/depot'
    )
    expect(cleDepot('git@ssh.dev.azure.com:v3/org/Projet/Depot')).toBe(
      'dev.azure.com/org/projet/_git/depot'
    )
  })

  it('reconnaît la même personne sous ses différentes signatures', () => {
    const attendu = 'jeanne durand'
    expect(normaliserIdentite('Jéanne DURAND')).toBe(attendu)
    expect(normaliserIdentite('jeanne.durand@poste.example')).toBe(attendu)
    expect(normaliserIdentite('jeanne_durand')).toBe(attendu)
  })

  it("nomme l'outil de demande de fusion de l'hébergeur", () => {
    expect(hebergeurDe('git@github.com:a/b.git').outilDemandeDeFusion).toBe('gh pr create')
    expect(hebergeurDe('https://dev.azure.com/o/p/_git/d').outilDemandeDeFusion).toBe(
      'az repos pr create'
    )
  })
})

describe('deduireCible', () => {
  it('seul auteur → push direct sur la branche par défaut du distant', () => {
    const d = depot()
    const c = deduireCible({ cwd: d.dir, habitudes: {} })
    expect(c).toMatchObject({ distant: 'origin', branche: 'main', mode: 'push', source: 'auteurs' })
  })

  it("un autre auteur → dépôt d'équipe, demande de fusion", () => {
    const d = depot({ autreAuteur: true })
    const c = deduireCible({ cwd: d.dir, habitudes: {} })
    expect(c).toMatchObject({ mode: 'pr', source: 'auteurs', autresAuteurs: 1 })
  })

  it("quelques commits de passage n'en font pas un dépôt d'équipe (part ≥ 80 %)", () => {
    // Cas réel du 2026-10-29 : un dépôt perso à 65 commits sur 68 de l'utilisateur sortait « pr ».
    const d = depot({ autreAuteur: true, mesCommits: 4 })
    expect(deduireCible({ cwd: d.dir, habitudes: {} })).toMatchObject({
      mode: 'push',
      source: 'auteurs'
    })
  })

  it("l'habitude retenue l'emporte sur la déduction", () => {
    const d = depot({ autreAuteur: true })
    const habitudes = { [cleDepot(d.nu)]: { mode: 'push', branche: 'main', le: '2026-10-29' } }
    expect(deduireCible({ cwd: d.dir, habitudes })).toMatchObject({
      mode: 'push',
      source: 'habitude'
    })
  })

  it("le garde-fou qui nomme ALLOW_MAIN_PUSH donne le push direct et l'exception à poser", () => {
    const d = depot({ autreAuteur: true })
    mkdirSync(join(d.dir, '.githooks'))
    writeFileSync(
      join(d.dir, '.githooks', 'pre-push'),
      '#!/bin/sh\n[ "$ALLOW_MAIN_PUSH" = 1 ] || exit 1\n'
    )
    d.git('config', 'core.hooksPath', '.githooks')
    expect(deduireCible({ cwd: d.dir, habitudes: {} })).toMatchObject({
      mode: 'push',
      source: 'garde-fou',
      exceptionPush: 'ALLOW_MAIN_PUSH=1'
    })
  })

  it('suit la branche par défaut annoncée par le distant (pas forcément main)', () => {
    const d = depot()
    d.git('switch', '-q', '-c', 'develop')
    d.git('push', '-q', 'origin', 'develop')
    d.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    expect(deduireCible({ cwd: d.dir, habitudes: {} }).branche).toBe('develop')
  })

  it('sans distant → mode local, rien ne peut partir', () => {
    const d = depot({ distant: false })
    expect(deduireCible({ cwd: d.dir, habitudes: {} })).toMatchObject({
      mode: 'local',
      distant: null
    })
  })

  it('hors dépôt → erreur, pas une cible inventée', () => {
    expect(deduireCible({ cwd: dossier('git-cible-vide-'), habitudes: {} }).erreur).toMatch(
      /pas un dépôt git/
    )
  })
})

describe('retenirHabitude', () => {
  it('écrit une habitude relue au tour suivant, et refuse un mode inconnu', () => {
    const d = depot({ autreAuteur: true })
    const fichier = join(dossier('git-cible-hab-'), 'sous', 'git-habitudes.json')
    retenirHabitude({ fichier, url: d.nu, mode: 'push', note: 'mon dépôt perso' })
    expect(deduireCible({ cwd: d.dir, habitudes: lireHabitudes(fichier) })).toMatchObject({
      mode: 'push',
      source: 'habitude'
    })
    expect(() => retenirHabitude({ fichier, url: d.nu, mode: 'force' })).toThrow(/mode inconnu/)
  })
})
