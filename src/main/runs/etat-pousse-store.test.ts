import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attendreFichier } from '../gel/ecriture-hors-fil'
import { deposerEtatPousse, lireEtatPousse } from './etat-pousse-store'

/*
 * Racine PROPRE à chaque test : les données de test sont stables d'un run à l'autre, et une base
 * laissée par un run précédent fausserait la lecture.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'aos-etat-pousse-store-'))
})
afterEach(async () => {
  await attendreFichier()
  rmSync(racine, { recursive: true, force: true })
})

describe('la base de comparaison de l’état est tenue par fil, sur disque', () => {
  it('relit ce qui a été déposé pour le même fil, et rien pour un autre', async () => {
    deposerEtatPousse('conv-1', { tab: 'chat', skillsDisponibles: ['build'] }, racine)
    await attendreFichier()

    expect(lireEtatPousse('conv-1', racine)).toEqual({ tab: 'chat', skillsDisponibles: ['build'] })
    expect(lireEtatPousse('conv-2', racine)).toBeUndefined()
  })

  it('un fichier au JSON invalide vaut « aucune base » : jamais un diff contre une valeur douteuse', () => {
    mkdirSync(join(racine, 'etat-pousse'), { recursive: true })
    writeFileSync(join(racine, 'etat-pousse', 'conv-3.json'), '{pas du json', 'utf8')

    expect(lireEtatPousse('conv-3', racine)).toBeUndefined()
  })

  it('une base qui n’est pas un objet est refusée', () => {
    mkdirSync(join(racine, 'etat-pousse'), { recursive: true })
    writeFileSync(join(racine, 'etat-pousse', 'conv-4.json'), '["une liste"]', 'utf8')

    expect(lireEtatPousse('conv-4', racine)).toBeUndefined()
  })

  it('un identifiant de fil qui n’est pas un nom de fichier sûr ne sort jamais du dossier', async () => {
    deposerEtatPousse('../hors', { tab: 'chat' }, racine)
    await attendreFichier()

    expect(existsSync(join(racine, 'hors.json'))).toBe(false)
    expect(lireEtatPousse('../hors', racine)).toBeUndefined()
  })

  it('un état qui n’est pas un objet ne se dépose pas', async () => {
    deposerEtatPousse('conv-5', null, racine)
    deposerEtatPousse('conv-5', 'texte', racine)
    await attendreFichier()

    expect(lireEtatPousse('conv-5', racine)).toBeUndefined()
  })
})
