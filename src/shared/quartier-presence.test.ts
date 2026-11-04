// Les animaux que l'on choisit pour ses agents (conv-1546 : panda et panda roux s'ajoutent).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANIMAUX_AGENTS, animalLisible } from './quartier-presence'

describe('animalLisible', () => {
  it.each(['tanuki', 'renard', 'panda', 'panda-roux'])('lit %s', (animal) => {
    expect(animalLisible(animal)).toBe(animal)
  })

  it('refuse un animal inconnu ou une valeur qui n’est pas du texte', () => {
    for (const v of ['panda_roux', 'Panda', 'loup', '', null, undefined, 3, {}]) {
      expect(animalLisible(v)).toBeNull()
    }
  })

  it('propose les quatre animaux, dans cet ordre', () => {
    expect([...ANIMAUX_AGENTS]).toEqual(['tanuki', 'renard', 'panda', 'panda-roux'])
  })
})

describe('un atlas par animal choisi', () => {
  const dossier = join(__dirname, '../renderer/src/assets/quartier')
  const scene = readFileSync(join(__dirname, '../renderer/src/quartier/quartier-scene.ts'), 'utf8')

  it.each([...ANIMAUX_AGENTS])(
    '%s a son atlas sur le disque, importé et peint par la scène',
    (a) => {
      const fichier = a === 'tanuki' ? 'atlas.avif' : `atlas-${a}.avif`
      expect(existsSync(join(dossier, fichier))).toBe(true)
      expect(scene).toContain(`../assets/quartier/${fichier}`)
      expect(scene).toMatch(new RegExp(`['"]?${a}['"]?: peindreAtlas[(]`))
    }
  )
})
