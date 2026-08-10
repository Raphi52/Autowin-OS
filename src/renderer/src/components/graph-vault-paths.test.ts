import { describe, expect, it } from 'vitest'
import { pathSegments, relativePathOf } from './graph-vault-paths'

describe('chemins du vault — la forme RÉELLE que l’app fournit', () => {
  it('gère les DEUX séparateurs : le brain vit sur un partage Windows', () => {
    expect(pathSegments('knowledge\\domain\\x.md')).toEqual(['knowledge', 'domain', 'x.md'])
    expect(pathSegments('knowledge/domain\\x.md')).toEqual(['knowledge', 'domain', 'x.md'])
  })

  it('résiste au chemin UNC ABSOLU — la cause d’une vue entièrement VIDE', () => {
    // Relevé dans l'app : `file` est absolu, donc son 1ᵉʳ segment vaut `ged2` (le SERVEUR) pour TOUS
    // les nœuds. Sans ce correctif, toutes les fiches partageaient la même « famille » et
    // s'empilaient au même endroit. `id` porte le chemin relatif propre.
    const reel = {
      id: 'knowledge/_maps/rig-architecture-applicative',
      file: '\\\\ged2\\rig\\Projets IA\\Amitel Brain\\knowledge\\_maps\\rig-architecture-applicative.md'
    }
    expect(relativePathOf(reel)).toBe('knowledge/_maps/rig-architecture-applicative')
    expect(pathSegments(relativePathOf(reel))[0]).toBe('knowledge')
    expect(pathSegments(relativePathOf(reel))[0]).not.toBe('ged2')
  })

  it('retrouve l’ancre dans le chemin absolu quand l’id n’est PAS un chemin', () => {
    // Cas des nœuds issus de graphify : leur id est un nom de symbole, pas un chemin.
    const symbole = { id: 'SymbolName', file: 'C:\\x\\Brain\\projects\\a\\g.md' }
    expect(pathSegments(relativePathOf(symbole))[0]).toBe('projects')
  })

  it('place bien à la RACINE une fiche sans dossier d’ancrage', () => {
    // Une fiche à la racine du brain a un id sans séparateur ET un chemin absolu sans dossier connu :
    // son premier segment devenait le nom du serveur. On ne garde que le nom du fichier.
    const racine = { id: 'HOME', file: '\\\\ged2\\rig\\Projets IA\\Amitel Brain\\HOME.md' }
    expect(relativePathOf(racine)).toBe('HOME.md')
    expect(relativePathOf(racine)).not.toContain('ged2')
  })

  it('ne jette pas sur une entrée vide', () => {
    expect(pathSegments(undefined)).toEqual([])
    expect(relativePathOf({ id: '', file: undefined })).toBe('')
  })
})
