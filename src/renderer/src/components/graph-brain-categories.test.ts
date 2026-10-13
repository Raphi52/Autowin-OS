import { describe, expect, it } from 'vitest'
import { brainSubjectOf } from './graph-brain-categories'
import type { GraphNode } from './graph-view-model'
import type { MetierGraphe } from '../../../main/viz/fs-brains'

const RACINE = '//nas1/partage/Projets IA/Team Brain/'
// Domaine metier FICTIF (conv-916) : le vrai vient du profil de l'entreprise, absent du depot public.
const METIER: MetierGraphe = {
  cle: 'zorg',
  libelle: 'ZORG',
  documentation: 'zorgapplication-documentation',
  sousProjet: { libelle: 'ZORG-TV', motifs: ['zorg-tv', 'zorgtv', 'testviewer'] }
}
const sujet = (node: Pick<GraphNode, 'id' | 'file' | 'themes'>): string =>
  brainSubjectOf(node, METIER)
const fiche = (chemin: string, themes: string[] = []): GraphNode => ({
  id: chemin,
  label: chemin.split('/').pop() ?? chemin,
  group: 1,
  file: RACINE + chemin,
  themes
})

describe('axe SUJET — celui que la campagne d’architecture a désigné', () => {
  it('range chaque produit sous son nom', () => {
    expect(sujet(fiche('projects/autowin-os/obsidian/autowin-os.md'))).toBe('Autowin OS')
    expect(sujet(fiche('knowledge/decisions/portail-acme.md'))).toBe('Portail')
    expect(sujet(fiche('projects/zorg-tv/obsidian/areas/a.md'))).toBe('ZORG-TV')
    // ZORG porte 454 fiches sur 628 : il est le seul sujet subdivisé, d'où les deux niveaux ici.
    expect(sujet(fiche('knowledge/domain/zorg-edi.md'))).toBe('ZORG/savoir général')
  })

  it('L’ORDRE DES RÈGLES COMPTE : ZORG-TV n’est pas avalé par ZORG', () => {
    // `zorg-tv` contient `zorg`. Sans la priorité, tout ZORG-TV finirait dans ZORG et le sujet le plus
    // travaillé de la session disparaîtrait de la vue.
    expect(sujet(fiche('projects/zorg-tv/obsidian/decisions/cheminb.md'))).toBe('ZORG-TV')
    expect(sujet(fiche('knowledge/lessons/zorgtv-smoke.md'))).toBe('ZORG-TV')
  })

  it('sépare le kit du reste, y compris les consignes de la racine', () => {
    expect(sujet(fiche('governance/NOTE-SCHEMA-v1.md'))).toBe('Le kit et la façon de travailler')
    expect(sujet(fiche('CLAUDE.md'))).toBe('Le kit et la façon de travailler')
    expect(sujet(fiche('knowledge/decisions/skill-map.md', ['kit']))).toBe(
      'Le kit et la façon de travailler'
    )
  })

  it('nomme le tampon d’entrée et le vraiment-transverse au lieu de les diluer', () => {
    expect(sujet(fiche('inbox/x.md'))).toBe('À trier')
    expect(sujet(fiche('divers/note-sans-sujet.md'))).toBe('Transverse')
  })

  it('ne jette pas sur une fiche nue', () => {
    expect(sujet({ id: 'nu', file: undefined, themes: undefined })).toBe('Transverse')
  })
})

describe('second niveau de ZORG — affiner DANS l’axe, pas croiser deux axes', () => {
  it('reprend les sections que la documentation porte déjà', () => {
    // Ni traduites ni inventées : on retire le préfixe numérique de tri, qui est de la mécanique de
    // dossier, et rien d'autre.
    expect(
      sujet(
        fiche('knowledge/domain/zorgapplication-documentation/reference/70-edi-integrations/x.md')
      )
    ).toBe('ZORG/edi integrations')
    expect(sujet(fiche('knowledge/domain/zorgapplication-documentation/reference/proc/p.md'))).toBe(
      'ZORG/proc'
    )
  })

  it('donne aux cartes de code d’un dépôt ZORG le nom de leur dépôt', () => {
    expect(sujet(fiche('projects/zorg-processus/obsidian/areas/a.md'))).toBe('ZORG/processus')
  })

  it('sépare les décisions et leçons ZORG du savoir général', () => {
    expect(sujet(fiche('knowledge/lessons/zorg-msdtc.md'))).toBe('ZORG/décisions et leçons')
    expect(sujet(fiche('knowledge/domain/zorg-edi.md'))).toBe('ZORG/savoir général')
  })

  it('n’affecte QUE ZORG : les autres sujets restent sur un seul niveau', () => {
    // Le second niveau est un affinage local du plus gros paquet, pas une règle générale — la
    // campagne a mesuré qu'ajouter un niveau partout FAIT CHUTER la justesse.
    expect(sujet(fiche('projects/autowin-os/obsidian/a.md'))).toBe('Autowin OS')
    expect(sujet(fiche('projects/zorg-tv/obsidian/a.md'))).toBe('ZORG-TV')
    expect(sujet(fiche('governance/x.md'))).toBe('Le kit et la façon de travailler')
  })
})

describe('sans profil d entreprise (version publique), aucun domaine metier', () => {
  it('les fiches du domaine restent dans les sujets generiques', () => {
    // Jumeau des regles ci-dessus : memes chemins, aucun profil. Le code ne nomme aucun domaine.
    expect(brainSubjectOf(fiche('projects/zorg-tv/obsidian/areas/a.md'))).toBe('Transverse')
    expect(brainSubjectOf(fiche('knowledge/domain/zorg-edi.md', ['theme/zorg']))).toBe('Transverse')
    expect(brainSubjectOf(fiche('knowledge/lessons/zorg-msdtc.md'))).toBe('Transverse')
    expect(brainSubjectOf(fiche('projects/autowin-os/obsidian/a.md'))).toBe('Autowin OS')
  })
})
