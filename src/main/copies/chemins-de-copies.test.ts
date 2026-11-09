import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  agentIdDeCopieHeritee,
  agentIdDeCopieNeuve,
  cheminNeufDeCopieAgent,
  dossierDeCopieDeTache,
  nomCopieAgentHeritee,
  racineDesCopiesDeTaches,
  runDUneCopieDeRun
} from './chemins-de-copies'

describe('racine unique des copies de tâche', () => {
  it('range toutes les copies sous un seul dossier du dossier de données', () => {
    expect(racineDesCopiesDeTaches(join('D:', 'donnees'))).toBe(
      join('D:', 'donnees', 'copies-de-taches')
    )
  })

  it('nomme la copie d’une tâche par son identifiant, fil ou run', () => {
    const racine = racineDesCopiesDeTaches('donnees')
    expect(dossierDeCopieDeTache(racine, 'conv-1751')).toBe(join(racine, 'conv-1751'))
    expect(dossierDeCopieDeTache(racine, 'run-815dbdcf8bfe-1')).toBe(
      join(racine, 'run-815dbdcf8bfe-1')
    )
  })

  it('accepte un identifiant de 128 caractères, et refuse 129', () => {
    const racine = racineDesCopiesDeTaches('donnees')
    expect(dossierDeCopieDeTache(racine, 'a'.repeat(128))).not.toBeNull()
    expect(dossierDeCopieDeTache(racine, 'a'.repeat(129))).toBeNull()
  })

  it('refuse un identifiant qui ne peut pas nommer un dossier sans sortir de la racine', () => {
    const racine = racineDesCopiesDeTaches('donnees')
    for (const mauvais of ['', '.', '..', '../conv-1', 'conv/1', 'conv\\1', 'conv.1', 'conv 1']) {
      expect(dossierDeCopieDeTache(racine, mauvais), `« ${mauvais} »`).toBeNull()
    }
  })

  it('garde le nom hérité de la copie d’agent, tel que l’état de version 1 le nomme', () => {
    expect(nomCopieAgentHeritee('run-815dbdcf8bfe-1')).toBe('agent__run-815dbdcf8bfe-1')
  })
})

describe('création d’une copie d’agent', () => {
  it('sans racine unique, aucun chemin neuf : jamais un dossier agent__', () => {
    // fix-ok: une copie d'agent neuve n'a de chemin que sous la racine unique : `cheminNeufDeCopieAgent` rend `null` quand elle manque, et jamais un chemin `agent__`.
    expect(cheminNeufDeCopieAgent(undefined, 'run-a-1')).toBeNull()
    expect(cheminNeufDeCopieAgent(join('D:', 'racine'), 'run-a-1')).toBe(
      join('D:', 'racine', 'run-a-1')
    )
  })
})

describe('copies d’agent, sous l’une ou l’autre racine', () => {
  const donnees = join('D:', 'donnees')
  const racine = racineDesCopiesDeTaches(donnees)

  it('rend le run d’une copie de run, rangée sous l’ancienne racine ou sous la racine unique', () => {
    expect(runDUneCopieDeRun(join(donnees, 'worktrees', 'h', 'agent__run-a-1'))).toBe('run-a-1')
    expect(runDUneCopieDeRun(join(racine, 'run-b-1'))).toBe('run-b-1')
  })

  it('ne prend ni un fil, ni une copie de vérification, ni un dossier hors de la racine unique', () => {
    expect(runDUneCopieDeRun(join(racine, 'conv-c-1'))).toBeUndefined()
    expect(
      runDUneCopieDeRun(join(donnees, 'worktrees', 'h', 'agent__command-verify-conv-9'))
    ).toBeUndefined()
    expect(runDUneCopieDeRun(join('D:', 'autre', 'run-d-1'))).toBeUndefined()
  })

  it('donne l’identifiant d’une copie d’agent sous chaque racine, et rien d’autre', () => {
    expect(agentIdDeCopieHeritee('agent__run-a-1')).toBe('run-a-1')
    expect(agentIdDeCopieHeritee('run-a-1')).toBeUndefined()
    expect(agentIdDeCopieNeuve('run-a-1')).toBe('run-a-1')
    expect(agentIdDeCopieNeuve('conv-c-1')).toBeUndefined()
    expect(agentIdDeCopieNeuve('en-creation__run-a-1')).toBeUndefined()
  })
})
