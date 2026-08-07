import { describe, expect, it } from 'vitest'
import { BRAIN_CATEGORIES, brainCategoryOf, countByBrainCategory } from './graph-brain-categories'
import type { GraphNode } from './graph-view-model'

const RACINE = '//ged2/rig/Projets IA/Amitel Brain/'
const fiche = (chemin: string, themes: string[] = []): GraphNode => ({
  id: chemin,
  label: chemin.split('/').pop() ?? chemin,
  group: 1,
  file: RACINE + chemin,
  themes
})

describe('catégories cognitives — le rattachement', () => {
  it('range une règle de conduite dans Comportement', () => {
    expect(brainCategoryOf(fiche('knowledge/decisions/run-dod.md', ['kit', 'process']))).toBe(
      'Comportement'
    )
    expect(brainCategoryOf(fiche('governance/NOTE-SCHEMA-v1.md'))).toBe('Comportement')
  })

  it('range une décision produit et une leçon dans Mémoires', () => {
    expect(
      brainCategoryOf(fiche('knowledge/decisions/portail.md', ['produit', 'decision-tracee']))
    ).toBe('Mémoires')
    expect(brainCategoryOf(fiche('knowledge/lessons/smb.md'))).toBe('Mémoires')
  })

  it('range le savoir et les cartes de code dans Savoir', () => {
    expect(brainCategoryOf(fiche('knowledge/domain/rig-edi.md'))).toBe('Savoir')
    expect(brainCategoryOf(fiche('projects/rig-tv/obsidian/areas/import.md', ['area']))).toBe(
      'Savoir'
    )
  })

  it('LE CAS QUI DÉCIDE LA PRÉCÉDENCE : une décision AUSSI taguée kit va au Comportement', () => {
    // 40 fiches réelles sont dans ce cas. Elles sont autant une mémoire qu'une règle de conduite ;
    // on les cherchera pour savoir COMMENT travailler, pas pour dater le choix.
    const conflit = fiche('knowledge/decisions/skill-trigger-map.md', [
      'kit',
      'process',
      'decision-tracee'
    ])
    expect(brainCategoryOf(conflit)).toBe('Comportement')
  })

  it('le tag `environnement` l’emporte sur TOUTE autre règle', () => {
    // Une fiche taguée délibérément doit atterrir là où on l'a marquée, même si son chemin ou ses
    // autres tags la tireraient ailleurs.
    const dansLessons = fiche('knowledge/lessons/msdtc.md', ['rig', 'environnement'])
    expect(brainCategoryOf(dansLessons)).toBe('Environnement')
    const aussiKit = fiche('knowledge/decisions/x.md', ['kit', 'environnement'])
    expect(brainCategoryOf(aussiKit)).toBe('Environnement')
  })

  it('n’attrape RIEN par le contenu : une fiche qui parle de serveurs sans tag reste Savoir', () => {
    // L'heuristique par mots-clés a été mesurée puis réfutée — 281 fiches sur 628 la déclenchaient.
    // Ce test verrouille son absence : seul le tag explicite ouvre la catégorie.
    const parleDeServeurs = fiche('knowledge/domain/rig-acces-donnees.md', ['rig'])
    expect(brainCategoryOf(parleDeServeurs)).toBe('Savoir')
  })

  it('nomme ce qu’il ne sait pas ranger au lieu de le dissoudre', () => {
    expect(brainCategoryOf(fiche('inbox/brouillon.md'))).toBe('Non classé')
  })
})

describe('catégories cognitives — les invariants de la vue', () => {
  const vault = [
    fiche('knowledge/decisions/kit-a.md', ['kit']),
    fiche('knowledge/decisions/produit-b.md', ['produit']),
    fiche('knowledge/lessons/env-c.md', ['environnement']),
    fiche('knowledge/domain/savoir-d.md'),
    fiche('projects/rig-tv/obsidian/areas/e.md', ['area']),
    fiche('governance/f.md'),
    fiche('inbox/g.md')
  ]

  it('PARTITION : chaque fiche compte pour exactement une catégorie', () => {
    const comptes = countByBrainCategory(vault)
    const somme = Object.values(comptes).reduce((a, b) => a + b, 0)
    expect(somme).toBe(vault.length)
  })

  it('affiche TOUTES les catégories, y compris celles à zéro', () => {
    // Un compteur honnête à zéro informe ; une catégorie absente laisse croire qu'elle n'existe pas.
    const comptes = countByBrainCategory([fiche('knowledge/domain/seul.md')])
    expect(Object.keys(comptes).sort()).toEqual([...BRAIN_CATEGORIES].sort())
    expect(comptes['Comportement']).toBe(0)
  })

  it('est stable : deux passages donnent le même rattachement', () => {
    expect(countByBrainCategory(vault)).toEqual(countByBrainCategory(vault))
  })

  it('ne jette pas sur une fiche sans thèmes ni fichier', () => {
    expect(brainCategoryOf({ id: 'nu', file: undefined, themes: undefined })).toBe('Non classé')
  })
})

describe('les catégories sont l’ancrage — elles doivent survivre à l’arbitrage d’étiquettes', () => {
  it('range les 4 catégories réelles du vault, sans en perdre une', () => {
    // Un échantillon représentatif de chaque famille : si une catégorie tombe à zéro ici, c'est la
    // règle qui a cassé, pas les données.
    const echantillon = [
      fiche('knowledge/decisions/kit.md', ['kit']),
      fiche('knowledge/decisions/produit.md', ['decision-tracee']),
      fiche('knowledge/lessons/msdtc.md', ['environnement']),
      fiche('knowledge/domain/rig.md')
    ]
    const comptes = countByBrainCategory(echantillon)
    expect(comptes['Comportement']).toBe(1)
    expect(comptes['Mémoires']).toBe(1)
    expect(comptes['Environnement']).toBe(1)
    expect(comptes['Savoir']).toBe(1)
  })
})
