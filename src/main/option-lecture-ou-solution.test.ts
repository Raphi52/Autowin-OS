import { describe, expect, it } from 'vitest'
import {
  demandeEstUnSymptome,
  filEstUnSymptome,
  optionsQuiPresupposentUneSolution
} from './option-lecture-ou-solution'

/**
 * Cas d'ancrage RÉEL — conv-1376, le 2026-08-23. C'est la séquence exacte qui a motivé ce module,
 * pas un exemple inventé : l'utilisateur décrit ce qu'il constate, l'assistant lui propose une
 * solution technique déjà choisie, il clique, et ce texte devient l'objectif du run.
 */
const DEMANDE_REELLE = 'quand je suis retourné dans ma conversation je vois plu l’historique'
const OPTION_REELLE =
  'Corrige ChatView.tsx piste A : amorce le cache depuis le store avant d’y écrire l’amorce'

describe('une option cliquable est-elle une lecture du besoin, ou une solution déjà choisie', () => {
  it('reconnaît un symptôme : l’utilisateur décrit ce qu’il constate, sans nommer de cible', () => {
    expect(demandeEstUnSymptome(DEMANDE_REELLE)).toBe(true)
    expect(demandeEstUnSymptome('ça marche plus depuis ce matin')).toBe(true)
    expect(demandeEstUnSymptome('la liste est vide')).toBe(true)
  })

  it('ne voit PAS un symptôme quand l’utilisateur a lui-même nommé la cible', () => {
    // Sa décision lui appartient : s'il nomme le fichier, on ne lui repropose pas de le chercher.
    expect(demandeEstUnSymptome('je vois plus l’historique, corrige src/main/os.ts')).toBe(false)
    expect(demandeEstUnSymptome('renomme la fonction dansChatView.tsx')).toBe(false)
  })

  it('signale l’option qui présuppose une solution sur une demande-symptôme', () => {
    const signaux = optionsQuiPresupposentUneSolution(DEMANDE_REELLE, [
      { libelle: 'Diagnostiquer d’abord', envoi: 'Lis le code et dis-moi la cause exacte' },
      { libelle: 'Corriger piste A', envoi: OPTION_REELLE }
    ])
    expect(signaux).toHaveLength(1)
    expect(signaux[0].index).toBe(1)
    expect(signaux[0].extrait).toContain('ChatView.tsx')
  })

  it('juge le texte ENVOYÉ, pas le libellé affiché — c’est lui qui devient l’objectif du run', () => {
    // Le piège exact de conv-1376 : un libellé anodin, un envoi qui fige une piste technique.
    const signaux = optionsQuiPresupposentUneSolution(DEMANDE_REELLE, [
      { libelle: 'On y va', envoi: 'Corrige src/renderer/ChatView.tsx' }
    ])
    expect(signaux).toHaveLength(1)
  })

  it('ne signale rien quand les options sont des LECTURES du besoin', () => {
    expect(
      optionsQuiPresupposentUneSolution(DEMANDE_REELLE, [
        { libelle: 'C’est une perte de données', envoi: 'Les messages ont disparu du stockage' },
        { libelle: 'C’est un bug d’affichage', envoi: 'Les messages sont là mais ne s’affichent pas' }
      ])
    ).toEqual([])
  })

  it('ne signale rien quand l’utilisateur a déjà nommé sa cible — aucun faux positif là-dessus', () => {
    // Précédent du 2026-08-18 : une heuristique trop zélée a produit onze faux blocages.
    expect(
      optionsQuiPresupposentUneSolution('corrige src/main/os.ts, le cache est cassé', [
        { libelle: 'Corriger', envoi: 'Corrige src/main/os.ts' }
      ])
    ).toEqual([])
  })

  /**
   * LE cas que le critère « dernier message » ratait. Au moment où l'option fautive a été proposée
   * dans conv-1376, le dernier message de l'utilisateur était « Diagnostiquer d'abord… » — pas un
   * symptôme. Une garde branchée là-dessus serait passée à côté du seul cas qu'elle devait attraper.
   */
  it('juge le FIL, pas le dernier message — sinon elle rate son propre cas d’ancrage', () => {
    const fil = [DEMANDE_REELLE, 'Diagnostiquer d’abord (je lis le code et te dis la cause exacte)']
    expect(filEstUnSymptome(fil)).toBe(true)
    const signaux = optionsQuiPresupposentUneSolution(fil, [{ libelle: 'Go', envoi: OPTION_REELLE }])
    expect(signaux).toHaveLength(1)
  })

  it('se tait dès que l’utilisateur a nommé sa cible quelque part dans le fil', () => {
    expect(filEstUnSymptome(['je vois plus rien', 'regarde src/main/os.ts stp'])).toBe(false)
  })

  it('ne jette jamais et tolère l’absence d’envoi', () => {
    expect(() => optionsQuiPresupposentUneSolution('', [])).not.toThrow()
    expect(optionsQuiPresupposentUneSolution(DEMANDE_REELLE, [{ libelle: 'Continuer' }])).toEqual([])
  })
})
