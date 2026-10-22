import { describe, expect, it } from 'vitest'
import { canonicalProjectPath as c } from './project-path'

// Migré de scripts/arena-panel/p4-chemin-canonique.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062) : ce script sans appelant était la SEULE garde de ce correctif.
// Défaut d'origine : canonicalProjectPath rendait DEUX clés pour le MÊME dossier, donc deux
// groupes dans la barre latérale.
describe('canonicalProjectPath — une seule clé par dossier', () => {
  const attendu = String.raw`D:\GIT\Contoso`
  it.each([
    ['séparateurs doublés', 'D:/GIT//Contoso'],
    ['« . » final', 'D:/GIT/Contoso/.'],
    ['« . » intermédiaire', 'D:/GIT/./Contoso'],
    ['« .. » résolu', 'D:/GIT/x/../Contoso'],
    ['lecteur en minuscule', 'd:/GIT/Contoso']
  ])('%s : %s', (_cas, chemin) => {
    expect(c(chemin)).toBe(attendu)
  })
  it('un chemin UNC garde son double antislash de tête', () => {
    expect(c(String.raw`\\srv\share\x` + '\\')).toBe(String.raw`\\srv\share\x`)
  })
  it('un libellé libre reste intact', () => {
    expect(c('Perso')).toBe('Perso')
  })
})
