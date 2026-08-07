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

  it('SÉPARE les trois natures que « Savoir » confondait', () => {
    // Mesuré : « Savoir » pesait 484 fiches sur 628 (77 %), dont 345 d'un arbre de doc IMPORTÉ et
    // 100 cartes de code GÉNÉRÉES — seulement 38 étaient du savoir rédigé. C'était une étiquette
    // mensongère, un repli déguisé en catégorie. Chaque nature a maintenant son nom.
    expect(brainCategoryOf(fiche('knowledge/domain/rig-edi.md'))).toBe('Savoir')
    expect(brainCategoryOf(fiche('projects/rig-tv/obsidian/areas/import.md', ['area']))).toBe(
      'Code'
    )
    expect(
      brainCategoryOf(fiche('knowledge/domain/rigapplication-documentation/reference/x.md'))
    ).toBe('Documentation')
  })

  it('range les consignes de la racine du vault dans Comportement', () => {
    // `CLAUDE.md` et `AGENTS.md` sont littéralement des règles de conduite. Elles tombaient dans
    // « Non classé », ce qui était faux deux fois : ni inclassables, ni sans catégorie évidente.
    expect(brainCategoryOf(fiche('CLAUDE.md'))).toBe('Comportement')
    expect(brainCategoryOf(fiche('AGENTS.md'))).toBe('Comportement')
  })

  it('les fiches de projet vont dans Code par leur CHEMIN, sans dépendre de leurs tags', () => {
    // Mesuré dans l'app : `Savoir · 137` valait `knowledge · 38` + `projects · 99` — les 99 fiches de
    // projets n'atteignaient pas `Code`, leurs tags n'arrivant pas sous la forme attendue. Le chemin
    // est le signal fiable ; ces cas passent SANS aucun tag.
    expect(brainCategoryOf(fiche('projects/rig-tv/obsidian/areas/import.md'))).toBe('Code')
    expect(brainCategoryOf(fiche('projects/rig-tv/obsidian/relations/calls.md'))).toBe('Code')
    expect(brainCategoryOf(fiche('projects/autowin-os/obsidian/autowin-os.md'))).toBe('Code')
  })

  it('MAIS une décision rangée sous un projet reste une Mémoire', () => {
    // Les 30 décisions moissonnées vivent sous `projects/<dépôt>/obsidian/decisions/` : les verser
    // dans `Code` parce qu'elles partagent le préfixe serait exactement la mauvaise attribution que
    // tout ce rangement cherche à éviter.
    expect(brainCategoryOf(fiche('projects/rig-tv/obsidian/decisions/cheminb.md'))).toBe('Mémoires')
  })

  it('range le tampon d’entrée dans À trier, et les connecteurs dans Environnement', () => {
    expect(brainCategoryOf(fiche('inbox/brouillon.md'))).toBe('À trier')
    expect(brainCategoryOf(fiche('integrations/ged.md'))).toBe('Environnement et contraintes')
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
    expect(brainCategoryOf(dansLessons)).toBe('Environnement et contraintes')
    const aussiKit = fiche('knowledge/decisions/x.md', ['kit', 'environnement'])
    expect(brainCategoryOf(aussiKit)).toBe('Environnement et contraintes')
  })

  it('n’attrape RIEN par le contenu : une fiche qui parle de serveurs sans tag reste Savoir', () => {
    // L'heuristique par mots-clés a été mesurée puis réfutée — 281 fiches sur 628 la déclenchaient.
    // Ce test verrouille son absence : seul le tag explicite ouvre la catégorie.
    const parleDeServeurs = fiche('knowledge/domain/rig-acces-donnees.md', ['rig'])
    expect(brainCategoryOf(parleDeServeurs)).toBe('Savoir')
  })

  it('nomme ce qu’il ne sait pas ranger au lieu de le dissoudre', () => {
    expect(brainCategoryOf(fiche('.trash/vieux.md'))).toBe('Non classé')
  })

  it('aucune catégorie ne dépasse la moitié du vault par simple REPLI', () => {
    // Le garde-fou de l'étiquette mensongère : une catégorie majoritaire doit l'être parce que le
    // vault est ainsi fait, jamais parce qu'une règle attrape tout ce qui reste. Ici `Documentation`
    // domine, et c'est un FAIT — un seul arbre de doc importé — pas un fourre-tout.
    const melange = [
      fiche('knowledge/domain/a.md'),
      fiche('projects/x/obsidian/areas/b.md', ['area']),
      fiche('knowledge/decisions/c.md', ['kit']),
      fiche('knowledge/lessons/d.md'),
      fiche('inbox/e.md'),
      fiche('integrations/f.md')
    ]
    const comptes = countByBrainCategory(melange)
    const max = Math.max(...Object.values(comptes))
    expect(max).toBeLessThanOrEqual(melange.length / 2)
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
    fiche('inbox/g.md'),
    fiche('.trash/h.md')
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
      fiche('knowledge/domain/rig.md'),
      fiche('knowledge/domain/rigapplication-documentation/r.md'),
      fiche('projects/x/obsidian/relations/calls.md', ['relation']),
      fiche('inbox/z.md')
    ]
    const comptes = countByBrainCategory(echantillon)
    expect(comptes['Comportement']).toBe(1)
    expect(comptes['Mémoires']).toBe(1)
    expect(comptes['Environnement et contraintes']).toBe(1)
    expect(comptes['Savoir']).toBe(1)
    expect(comptes['Documentation']).toBe(1)
    expect(comptes['Code']).toBe(1)
    expect(comptes['À trier']).toBe(1)
  })
})
