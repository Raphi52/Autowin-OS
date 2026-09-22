/**
 * Incident du 2026-09-21 : un /salvage (conv-719) a cherry-pické sur main une vieille copie
 * préservée (6b3ab4ae) qui portait encore les onglets retirés par le revert e4413ce3 du 17/09.
 * Ce test rejoue ce scénario : un candidat né AVANT un revert sur main doit être signalé.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detecterResurrection } from './salvage-resurrection.mjs'

const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

function depot() {
  const dir = mkdtempSync(join(tmpdir(), 'salvage-resu-'))
  aNettoyer.push(dir)
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  git('config', 'commit.gpgsign', 'false')
  const ecrire = (f, c) => writeFileSync(join(dir, f), c)
  const commit = (m) => {
    git('add', '-A')
    git('commit', '-q', '-m', m)
    return git('rev-parse', 'HEAD')
  }
  ecrire('App.tsx', 'sans onglets\n')
  ecrire('autre.ts', 'x\n')
  commit('base')
  ecrire('App.tsx', 'avec onglets\n')
  const onglets = commit('feat: onglets')
  return { dir, git, ecrire, commit, onglets }
}

describe('detecterResurrection', () => {
  it('signale un candidat né avant un revert de main qui touche les mêmes fichiers', () => {
    const d = depot()
    // Une copie part de l'état « avec onglets » et y ajoute son propre travail.
    d.git('switch', '-q', '-c', 'recovery')
    d.ecrire('App.tsx', 'avec onglets\nplus un détail\n')
    const candidat = d.commit('autowin: travail préservé')
    // Pendant ce temps, main annule les onglets.
    d.git('switch', '-q', 'main')
    d.git('revert', '--no-edit', d.onglets)
    const r = detecterResurrection({ candidat, base: 'main', cwd: d.dir })
    expect(r.alertes).toHaveLength(1)
    expect(r.alertes[0].fichiers).toEqual(['App.tsx'])
    expect(r.alertes[0].raison).toBe('revert')
  })

  it('signale un fichier supprimé sur main que le candidat modifie encore', () => {
    const d = depot()
    d.git('switch', '-q', '-c', 'recovery')
    d.ecrire('autre.ts', 'x modifié\n')
    const candidat = d.commit('travail')
    d.git('switch', '-q', 'main')
    d.git('rm', '-q', 'autre.ts')
    d.commit('retire autre.ts')
    const r = detecterResurrection({ candidat, base: 'main', cwd: d.dir })
    expect(r.alertes.map((a) => a.raison)).toContain('suppression')
    expect(r.alertes.flatMap((a) => a.fichiers)).toContain('autre.ts')
  })

  it('signale un candidat né APRÈS le revert qui réécrit le contenu annulé (cas réel du 19/09)', () => {
    const d = depot()
    const bloc = Array.from({ length: 12 }, (_, i) => `const ongletNumero${i} = creerOnglet(${i})\n`).join('')
    d.ecrire('App.tsx', bloc)
    const avec = d.commit('feat: onglets complets')
    d.git('revert', '--no-edit', avec)
    // La copie part d'ICI, après l'annulation, et l'agent y remet les onglets.
    d.git('switch', '-q', '-c', 'recovery')
    d.ecrire('App.tsx', bloc + 'autre chose\n')
    const candidat = d.commit('autowin: travail préservé')
    const r = detecterResurrection({ candidat, base: 'main', cwd: d.dir })
    expect(r.alertes.map((a) => a.raison)).toContain('contenu-annule')
    expect(r.alertes.find((a) => a.raison === 'contenu-annule').lignes).toBe(12)
  })

  it('reste muet quand main n’a rien annulé ni supprimé de ce que touche le candidat', () => {
    const d = depot()
    d.git('switch', '-q', '-c', 'recovery')
    d.ecrire('App.tsx', 'avec onglets\nplus un détail\n')
    const candidat = d.commit('travail')
    d.git('switch', '-q', 'main')
    d.ecrire('autre.ts', 'y\n')
    d.commit('autre travail')
    expect(detecterResurrection({ candidat, base: 'main', cwd: d.dir }).alertes).toEqual([])
  })
})

describe('detecterResurrection — relecture', () => {
  it('demande une relecture quand le candidat réécrit autrement un fichier annulé récemment', () => {
    const d = depot()
    d.git('revert', '--no-edit', d.onglets) // main annule les onglets
    d.git('switch', '-q', '-c', 'recovery') // la copie part APRÈS l'annulation…
    d.ecrire('App.tsx', 'sans onglets\nbarre ecrite autrement par un agent\n') // …et les réécrit autrement
    const candidat = d.commit('autowin: travail préservé')
    const r = detecterResurrection({ candidat, base: 'main', cwd: d.dir })
    expect(r.alertes).toEqual([])
    expect(r.relire).toHaveLength(1)
    expect(r.relire[0].fichiers).toEqual(['App.tsx'])
  })
})
