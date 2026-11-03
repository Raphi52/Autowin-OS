import { describe, expect, it, vi } from 'vitest'
import {
  blocGrowDuTour,
  ENTETE_GROW_AU_DEBUT,
  estUneDemandeDAction,
  RAPPEL_GROW_AU_DEBUT
} from './grow-au-debut'

/**
 * Le classement « demande d'action ? » qui décide si grow part au début du tour (conv-1445).
 * Les phrases marquées conv-1445 sont les vrais messages de l'utilisateur dans ce fil.
 */
describe('estUneDemandeDAction', () => {
  const actions: Array<[string, string?]> = [
    ['Fais charger la skill grow par le code au début de chaque demande d’action (conv-1445)'],
    [
      "je veux que les améliorations qu'il implémente servent pendant le tour et je veux pas spécialement reutiliser graft et forge (conv-1445)"
    ],
    ['corrige le bouton Envoyer'],
    ['peux-tu corriger le test du Board ?'],
    ['est-ce que tu peux ajouter un bouton Copier ?'],
    ['stp, ajoute un tri par date'],
    ['il faut corriger le test X'],
    ['remets le tuyau noir sur la machine du bain'],
    ['go'],
    ['vas-y'],
    ['ok'],
    ['pourquoi ça plante ? corrige-le'],
    ['le bouton Copier ne marche plus'],
    ["dans l'écran d'accueil c tout flou au loin et les animations de décor sont éclatées"],
    ['je vois plus le bouton Réparer'],
    ['Add a copy button under each answer'],
    ['/build corrige le défaut du Board', 'build'],
    ['/draft une page d’accueil plus claire', 'draft'],
    ['heal le chat', 'heal'],
    ['/scout le module veille puis corrige ce que tu trouves', 'scout'],
    // Messages réels manqués à la première mesure (conv-1445) :
    ['rajoute /heal dans la vue maintenance'],
    ['je veux pouvoir cocher plusieurs propositions'],
    ['et il faut une map par repo/cwd'],
    ['dans les settings je veux que les noms des sections soient une liste a gauche'],
    ['je valide'],
    ["L'agent a produit deux fois le même bloc : corriger la génération, pas l'affichage"]
  ]
  it.each(actions)('action : %s', (demande, skill) => {
    expect(estUneDemandeDAction(demande, skill)).toBe(true)
  })

  const pasDAction: Array<[string, string?]> = [
    [
      "parle moi de la skill /Grow qui vient d'apparaitre, elle s'éxécute dans chaque demande? elle contient le fait qu'elle peut graft et forge? (conv-1445)"
    ],
    [
      "mon reve c'est que quand je fais une demande ca améliore autowin ses tools et ses skills pendant que ca traite la demande (conv-1445)"
    ],
    ['pourquoi le bouton Envoyer reste gris ?'],
    ['comment marche le Board ?'],
    ["c'est quoi ce bug ?"],
    ['je veux savoir pourquoi le test est rouge'],
    ['merci'],
    ['ok merci'],
    ['rendement des skills cette semaine ?'],
    ['what does grow do?'],
    ['/scout le module veille', 'scout'],
    ['/look', 'look'],
    [
      'RÉVEIL DU PLAN DE LOTS « Refonte » (plan-1) — message de l’app, pas de l’utilisateur. Corrige le lot 2'
    ],
    ['pk tu recommences alors que tout est déjà fait ?'],
    [''],
    ['   ']
  ]
  it.each(pasDAction)('pas une action : %s', (demande, skill) => {
    expect(estUneDemandeDAction(demande, skill)).toBe(false)
  })
})

describe('blocGrowDuTour', () => {
  const procedure = '\n=== SKILL GROW (kit) ===\ncorps\n'

  it('action, session neuve → en-tête + procédure entière, marquée complète', () => {
    const bloc = blocGrowDuTour({
      demande: 'corrige le bouton',
      skillInvoquee: undefined,
      dejaDansLaSession: false,
      procedure: () => procedure,
      active: () => true
    })
    expect(bloc.complet).toBe(true)
    expect(bloc.texte.startsWith(ENTETE_GROW_AU_DEBUT)).toBe(true)
    expect(bloc.texte).toContain('=== SKILL GROW (kit) ===')
  })

  it('action, session qui porte déjà la procédure → rappel d’une ligne', () => {
    const bloc = blocGrowDuTour({
      demande: 'corrige le bouton',
      skillInvoquee: undefined,
      dejaDansLaSession: true,
      procedure: () => procedure,
      active: () => true
    })
    expect(bloc).toEqual({ texte: RAPPEL_GROW_AU_DEBUT, complet: false })
  })

  it('question → rien, et le SKILL.md n’est même pas lu', () => {
    const lire = vi.fn(() => procedure)
    const bloc = blocGrowDuTour({
      demande: 'pourquoi ça plante ?',
      skillInvoquee: undefined,
      dejaDansLaSession: false,
      procedure: lire,
      active: () => true
    })
    expect(bloc).toEqual({ texte: '', complet: false })
    expect(lire).not.toHaveBeenCalled()
  })

  it('/grow invoquée → rien (son corps part déjà par la skill invoquée)', () => {
    expect(
      blocGrowDuTour({
        demande: '/grow corrige le bouton',
        skillInvoquee: 'grow',
        dejaDansLaSession: false,
        procedure: () => procedure,
        active: () => true
      }).texte
    ).toBe('')
  })

  it('grow désactivée → rien', () => {
    expect(
      blocGrowDuTour({
        demande: 'corrige le bouton',
        skillInvoquee: undefined,
        dejaDansLaSession: false,
        procedure: () => procedure,
        active: () => false
      }).texte
    ).toBe('')
  })

  it('SKILL.md introuvable → rien, jamais un en-tête sans procédure', () => {
    expect(
      blocGrowDuTour({
        demande: 'corrige le bouton',
        skillInvoquee: undefined,
        dejaDansLaSession: false,
        procedure: () => '',
        active: () => true
      })
    ).toEqual({ texte: '', complet: false })
  })
})
