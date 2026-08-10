import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activeWorkflowProfile,
  loadWorkflowProfiles,
  removeWorkflowProfile,
  saveWorkflowProfiles,
  selectWorkflowProfile,
  upsertWorkflowProfile,
  type WorkflowProfile,
  type WorkflowProfilesFile
} from './workflow-profiles'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-workflows-'))
  dirs.push(dir)
  return join(dir, 'workflow-profiles.json')
}

const rapide: WorkflowProfile = {
  id: 'rapide',
  name: 'Rapide',
  roles: { subagent: { model: 'petit', reasoningEffort: 'low' } },
  phases: ['build'],
  allocation: { judgeMembers: 1 }
}

/**
 * Un workflow nommé rend la MANIÈRE de travailler sélectionnable — donc comparable. Sans lui, les
 * modèles vivent dans les rôles, les phases dans le régime et les consignes dans les skills : on ne
 * peut pas rejouer le même objectif sous deux façons de faire pour les mettre en regard.
 */
describe('profils de workflow — écrire, relire, sélectionner', () => {
  it('survit à un redémarrage, avec sa sélection', () => {
    const path = tempFile()
    saveWorkflowProfiles({ profiles: [rapide], activeId: 'rapide' }, path)

    const relu = loadWorkflowProfiles(path)
    expect(relu.profiles).toEqual([rapide])
    expect(activeWorkflowProfile(relu)?.name).toBe('Rapide')
  })

  it('un fichier absent n’est pas une erreur — juste aucun profil', () => {
    expect(loadWorkflowProfiles(tempFile())).toEqual({ profiles: [], activeId: null })
  })

  it('un fichier corrompu ne casse pas l’app', () => {
    const path = tempFile()
    writeFileSync(path, '{ ceci nest pas du json')
    expect(loadWorkflowProfiles(path)).toEqual({ profiles: [], activeId: null })
  })

  it('recrée un backup dès la première sauvegarde après un primaire corrompu', () => {
    const path = tempFile()
    const file = { profiles: [rapide], activeId: 'rapide' }
    writeFileSync(path, '{ ceci nest pas du json', 'utf8')

    saveWorkflowProfiles(file, path)

    expect(existsSync(`${path}.bak`)).toBe(true)
    writeFileSync(path, '{ corrompu de nouveau', 'utf8')
    expect(loadWorkflowProfiles(path)).toEqual(file)
  })

  it('remplace aussi un backup corrompu lors d’une sauvegarde valide', () => {
    const path = tempFile()
    const file = { profiles: [rapide], activeId: 'rapide' }
    writeFileSync(path, '{ primaire corrompu', 'utf8')
    writeFileSync(`${path}.bak`, '{ backup corrompu', 'utf8')

    saveWorkflowProfiles(file, path)
    writeFileSync(path, '{ corrompu de nouveau', 'utf8')

    expect(loadWorkflowProfiles(path)).toEqual(file)
  })

  it('récupère le profil précédent si le JSON parsable perd sa structure', () => {
    const path = tempFile()
    const file = { profiles: [rapide], activeId: 'rapide' }
    saveWorkflowProfiles(file, path)
    saveWorkflowProfiles(file, path)
    writeFileSync(path, JSON.stringify({ profiles: 'broken', activeId: 'rapide' }), 'utf8')

    expect(loadWorkflowProfiles(path)).toEqual(file)
  })

  it('un fichier écrit avec un BOM reste lisible', () => {
    const path = tempFile()
    writeFileSync(path, '﻿' + JSON.stringify({ profiles: [rapide], activeId: null }), 'utf8')
    expect(loadWorkflowProfiles(path).profiles).toHaveLength(1)
  })

  it('signale une sauvegarde impossible au lieu d’annoncer un état non persisté', () => {
    const parentFile = tempFile()
    writeFileSync(parentFile, 'ce chemin est un fichier', 'utf8')

    expect(() =>
      saveWorkflowProfiles(
        { profiles: [{ id: 'non-persiste', name: 'Non persisté' }], activeId: 'non-persiste' },
        join(parentFile, 'workflow-profiles.json')
      )
    ).toThrow()
  })

  it('écarte un profil sans nom ou sans identifiant — une ligne fantôme est pire qu’une absence', () => {
    const path = tempFile()
    writeFileSync(
      path,
      JSON.stringify({
        profiles: [rapide, { id: 'sans-nom' }, { name: 'sans id' }, { id: 'x y', name: 'espace' }],
        activeId: null
      })
    )
    expect(loadWorkflowProfiles(path).profiles.map((p) => p.id)).toEqual(['rapide'])
  })

  it('deux profils de même identifiant : le premier gagne, la sélection reste sans ambiguïté', () => {
    const path = tempFile()
    writeFileSync(
      path,
      JSON.stringify({
        profiles: [rapide, { id: 'rapide', name: 'Doublon' }],
        activeId: 'rapide'
      })
    )
    const relu = loadWorkflowProfiles(path)
    expect(relu.profiles).toHaveLength(1)
    expect(relu.profiles[0].name).toBe('Rapide')
  })

  it('une sélection pointant sur un profil disparu vaut « aucun »', () => {
    const path = tempFile()
    writeFileSync(path, JSON.stringify({ profiles: [rapide], activeId: 'fantome' }))
    expect(loadWorkflowProfiles(path).activeId).toBeNull()
  })
})

describe('modifier la liste', () => {
  const base: WorkflowProfilesFile = { profiles: [rapide], activeId: 'rapide' }

  it('ajoute un profil sans toucher à la sélection', () => {
    const next = upsertWorkflowProfile(base, { id: 'rigoureux', name: 'Rigoureux' })
    expect(next.profiles.map((p) => p.id)).toEqual(['rapide', 'rigoureux'])
    expect(next.activeId).toBe('rapide')
  })

  it('remplace un profil existant au lieu de le dupliquer', () => {
    const next = upsertWorkflowProfile(base, { id: 'rapide', name: 'Rapide v2' })
    expect(next.profiles).toHaveLength(1)
    expect(next.profiles[0].name).toBe('Rapide v2')
  })

  it('supprimer le profil SÉLECTIONNÉ remet la sélection à « aucun »', () => {
    expect(removeWorkflowProfile(base, 'rapide')).toEqual({ profiles: [], activeId: null })
  })

  it('sélectionner un identifiant inconnu ne crée pas une sélection invalide', () => {
    expect(selectWorkflowProfile(base, 'inexistant').activeId).toBeNull()
  })

  it('on peut revenir à « aucun profil » — la configuration courante reprend la main', () => {
    expect(selectWorkflowProfile(base, null).activeId).toBeNull()
    expect(activeWorkflowProfile(selectWorkflowProfile(base, null))).toBeUndefined()
  })
})

describe('instructions — les deux lectures cohabitent', () => {
  it('le défaut est « ajouter » : les skills du kit gardent l’autorité', () => {
    const path = tempFile()
    writeFileSync(
      path,
      JSON.stringify({
        profiles: [{ id: 'p', name: 'P', instructions: { text: 'va au plus court' } }],
        activeId: null
      })
    )
    expect(loadWorkflowProfiles(path).profiles[0].instructions).toEqual({
      mode: 'append',
      text: 'va au plus court'
    })
  })

  it('« remplacer » est possible, mais doit être demandé explicitement', () => {
    const path = tempFile()
    writeFileSync(
      path,
      JSON.stringify({
        profiles: [
          { id: 'p', name: 'P', instructions: { mode: 'replace', perPhase: { build: 'ta méthode' } } }
        ],
        activeId: null
      })
    )
    expect(loadWorkflowProfiles(path).profiles[0].instructions).toEqual({
      mode: 'replace',
      perPhase: { build: 'ta méthode' }
    })
  })

  it('une consigne vide n’est pas une consigne', () => {
    const path = tempFile()
    writeFileSync(
      path,
      JSON.stringify({ profiles: [{ id: 'p', name: 'P', instructions: { text: '   ' } }], activeId: null })
    )
    expect(loadWorkflowProfiles(path).profiles[0].instructions).toBeUndefined()
  })
})
