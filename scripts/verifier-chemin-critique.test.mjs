import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'

/*
 * POURQUOI CETTE GARDE : la sonde du chemin critique ne tournait que si quelqu'un pensait a la
 * lancer. Elle est restee rouge des semaines sur quatre defauts distincts sans que personne ne le
 * sache. Elle est desormais branchee sur `build:desktop`. Si ce branchement disparait, on revient
 * exactement a la situation d'avant — silencieusement.
 * Elle est VOLONTAIREMENT absente de `npm test` : cette boucle est rejouee a chaque edition de
 * fichier, et y ajouter un packaging plus un parcours d'interface la ferait passer de quelques
 * secondes a plusieurs minutes. Ce test epingle les DEUX cotes de l'arbitrage.
 */
const racine = racineDepot()
const scripts = JSON.parse(readFileSync(join(racine, 'package.json'), 'utf8')).scripts
const lanceur = readFileSync(join(racine, 'scripts/verifier-chemin-critique.mjs'), 'utf8')

describe('branchement de la sonde du chemin critique', () => {
  it('est jouee automatiquement apres la construction du paquet', () => {
    expect(scripts['test:chemin-critique']).toBe('node scripts/verifier-chemin-critique.mjs')
    expect(scripts['build:desktop']).toContain('npm run test:chemin-critique')
  })

  it('reste HORS de la boucle de verification rapide', () => {
    expect(scripts.test).not.toContain('chemin-critique')
    expect(scripts['test:unit']).not.toContain('chemin-critique')
  })

  it('arrete l instance isolee meme quand la sonde echoue', () => {
    // Deux arrets : un avant le demarrage (port propre) et un APRES la sonde, avant tout `exit`.
    const arrets = lanceur.match(/lanceur\('Stop'\)/g) ?? []
    expect(arrets.length).toBeGreaterThanOrEqual(2)
    expect(lanceur.indexOf("lanceur('Stop')", lanceur.indexOf('const sonde'))).toBeLessThan(
      lanceur.indexOf('process.exit(sonde.status')
    )
  })

  it('echoue clairement quand le paquet n existe pas, au lieu de passer', () => {
    expect(lanceur).toContain('binaire absent')
    expect(lanceur).toContain('process.exit(2)')
  })
})
