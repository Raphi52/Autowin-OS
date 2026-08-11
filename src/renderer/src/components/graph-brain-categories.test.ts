import { describe, expect, it } from 'vitest'
import { brainSubjectOf } from './graph-brain-categories'
import type { GraphNode } from './graph-view-model'

const RACINE = '//ged2/rig/Projets IA/Amitel Brain/'
const fiche = (chemin: string, themes: string[] = []): GraphNode => ({
  id: chemin,
  label: chemin.split('/').pop() ?? chemin,
  group: 1,
  file: RACINE + chemin,
  themes
})

describe('axe SUJET — celui que la campagne d’architecture a désigné', () => {
  it('range chaque produit sous son nom', () => {
    expect(brainSubjectOf(fiche('projects/autowin-os/obsidian/autowin-os.md'))).toBe('Autowin OS')
    expect(brainSubjectOf(fiche('knowledge/decisions/portail-amitel.md'))).toBe('Portail Amitel')
    expect(brainSubjectOf(fiche('projects/rig-tv/obsidian/areas/a.md'))).toBe('RIG-TV')
    // RIG porte 454 fiches sur 628 : il est le seul sujet subdivisé, d'où les deux niveaux ici.
    expect(brainSubjectOf(fiche('knowledge/domain/rig-edi.md'))).toBe('RIG/savoir général')
  })

  it('L’ORDRE DES RÈGLES COMPTE : RIG-TV n’est pas avalé par RIG', () => {
    // `rig-tv` contient `rig`. Sans la priorité, tout RIG-TV finirait dans RIG et le sujet le plus
    // travaillé de la session disparaîtrait de la vue.
    expect(brainSubjectOf(fiche('projects/rig-tv/obsidian/decisions/cheminb.md'))).toBe('RIG-TV')
    expect(brainSubjectOf(fiche('knowledge/lessons/rigtv-smoke.md'))).toBe('RIG-TV')
  })

  it('sépare le kit du reste, y compris les consignes de la racine', () => {
    expect(brainSubjectOf(fiche('governance/NOTE-SCHEMA-v1.md'))).toBe(
      'Le kit et la façon de travailler'
    )
    expect(brainSubjectOf(fiche('CLAUDE.md'))).toBe('Le kit et la façon de travailler')
    expect(brainSubjectOf(fiche('knowledge/decisions/skill-map.md', ['kit']))).toBe(
      'Le kit et la façon de travailler'
    )
  })

  it('nomme le tampon d’entrée et le vraiment-transverse au lieu de les diluer', () => {
    expect(brainSubjectOf(fiche('inbox/x.md'))).toBe('À trier')
    expect(brainSubjectOf(fiche('divers/note-sans-sujet.md'))).toBe('Transverse')
  })

  it('ne jette pas sur une fiche nue', () => {
    expect(brainSubjectOf({ id: 'nu', file: undefined, themes: undefined })).toBe('Transverse')
  })
})

describe('second niveau de RIG — affiner DANS l’axe, pas croiser deux axes', () => {
  it('reprend les sections que la documentation porte déjà', () => {
    // Ni traduites ni inventées : on retire le préfixe numérique de tri, qui est de la mécanique de
    // dossier, et rien d'autre.
    expect(
      brainSubjectOf(
        fiche('knowledge/domain/rigapplication-documentation/reference/70-edi-integrations/x.md')
      )
    ).toBe('RIG/edi integrations')
    expect(
      brainSubjectOf(fiche('knowledge/domain/rigapplication-documentation/reference/proc/p.md'))
    ).toBe('RIG/proc')
  })

  it('donne aux cartes de code d’un dépôt RIG le nom de leur dépôt', () => {
    expect(brainSubjectOf(fiche('projects/rig-processus/obsidian/areas/a.md'))).toBe(
      'RIG/processus'
    )
  })

  it('sépare les décisions et leçons RIG du savoir général', () => {
    expect(brainSubjectOf(fiche('knowledge/lessons/rig-msdtc.md'))).toBe('RIG/décisions et leçons')
    expect(brainSubjectOf(fiche('knowledge/domain/rig-edi.md'))).toBe('RIG/savoir général')
  })

  it('n’affecte QUE RIG : les autres sujets restent sur un seul niveau', () => {
    // Le second niveau est un affinage local du plus gros paquet, pas une règle générale — la
    // campagne a mesuré qu'ajouter un niveau partout FAIT CHUTER la justesse.
    expect(brainSubjectOf(fiche('projects/autowin-os/obsidian/a.md'))).toBe('Autowin OS')
    expect(brainSubjectOf(fiche('projects/rig-tv/obsidian/a.md'))).toBe('RIG-TV')
    expect(brainSubjectOf(fiche('governance/x.md'))).toBe('Le kit et la façon de travailler')
  })
})
