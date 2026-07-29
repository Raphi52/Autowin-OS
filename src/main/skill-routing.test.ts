import { describe, expect, it } from 'vitest'
import { routeSkillRequest } from './skill-routing'

describe('routeSkillRequest', () => {
  it('route les commandes de skill explicites en conservant la directive', () => {
    expect(routeSkillRequest('/scout trouve les failles')).toEqual({
      task: '/scout trouve les failles',
      explicitPhase: 'scout',
      reason: 'explicit-skill'
    })
    expect(routeSkillRequest('/kaizen analyse ce tour')).toEqual({
      task: '/kaizen analyse ce tour',
      explicitPhase: 'kaizen',
      reason: 'explicit-skill'
    })
  })

  it('route une action workspace claire', () => {
    expect(routeSkillRequest('corrige le bouton workflows dans la page chat')?.reason).toBe(
      'workspace-action'
    )
    expect(routeSkillRequest('corriger')?.reason).toBe('workspace-action')
    expect(
      routeSkillRequest('quand je scroll le message reste sticky, enlève cette feature')?.reason
    ).toBe('workspace-action')
    expect(routeSkillRequest('change juste la gueule du bouton workflows')?.reason).toBe(
      'workspace-action'
    )
    expect(routeSkillRequest('Mets à jour package.json')?.reason).toBe('workspace-action')
    expect(routeSkillRequest('Lance les tests')?.reason).toBe('workspace-action')
    expect(routeSkillRequest("Documente l'API dans README.md")?.reason).toBe('workspace-action')
    expect(routeSkillRequest('Peux-tu corriger le module')?.reason).toBe('workspace-action')
    expect(routeSkillRequest('Tu peux corriger le module')?.reason).toBe('workspace-action')
    expect(routeSkillRequest('Est-ce que tu peux corriger le module')?.reason).toBe(
      'workspace-action'
    )
    expect(routeSkillRequest('Modifie écran')?.reason).toBe('workspace-action')
    expect(routeSkillRequest("Modifie l'écran")?.reason).toBe('workspace-action')
    expect(routeSkillRequest('Modifie l’écran')?.reason).toBe('workspace-action')
    expect(routeSkillRequest('Corrige état')?.reason).toBe('workspace-action')
    expect(routeSkillRequest("Corrige l'état")?.reason).toBe('workspace-action')
  })

  it('laisse les questions et commandes ambiguës au modèle conversationnel', () => {
    expect(routeSkillRequest('pourquoi opus 5 ne figure pas dans la liste ?')).toBeUndefined()
    expect(routeSkillRequest('supprime')).toBeUndefined()
    expect(routeSkillRequest('Explique comment corriger le bug dans le module')).toBeUndefined()
    expect(
      routeSkillRequest('Je voudrais comprendre comment modifier cette fonction')
    ).toBeUndefined()
    expect(routeSkillRequest('Est-ce que le module ne fonctionne pas ?')).toBeUndefined()
    expect(routeSkillRequest('Quel test manque dans ce fichier ?')).toBeUndefined()
    expect(routeSkillRequest('Où manque le test ?')).toBeUndefined()
    expect(routeSkillRequest('Quel module il faut corriger ?')).toBeUndefined()
    expect(routeSkillRequest("Où est-ce qu'il faut corriger le module ?")).toBeUndefined()
    expect(
      routeSkillRequest('Quel message affiche "il faut supprimer le fichier" ?')
    ).toBeUndefined()
    expect(routeSkillRequest('Quand il faut corriger le module, explique pourquoi')).toBeUndefined()
    expect(routeSkillRequest('Le module ne fonctionne pas ?')).toBeUndefined()
    expect(
      routeSkillRequest('Pourquoi le bouton casse ? Explique pourquoi il faut corriger le module.')
    ).toBeUndefined()
    expect(
      routeSkillRequest("Quel message est affiché ? Le texte dit qu'il faut corriger le fichier.")
    ).toBeUndefined()
    expect(
      routeSkillRequest('Quand je vois le bug, explique pourquoi il faut corriger le module')
    ).toBeUndefined()
  })

  it('route une action distincte après une question', () => {
    expect(
      routeSkillRequest('Est-ce que le bouton est cassé ? Il faut corriger le module.')?.reason
    ).toBe('workspace-action')
    expect(
      routeSkillRequest('Est-ce que le bouton est cassé ? Peux-tu corriger le module ?')?.reason
    ).toBe('workspace-action')
    expect(routeSkillRequest('Pourquoi le bouton est cassé ? Corrige le module.')?.reason).toBe(
      'workspace-action'
    )
  })

  it('n’orchestre PLUS une demande d’ANALYSE (le chat sait lire depuis 2026-07-28)', () => {
    // Constate en essai reel : « Scout LECTURE SEULE dans src/main/ » lançait un pipeline SANS que le
    // modele soit consulte — ce routage court-circuite chat() en amont, donc aucune regle de prompt ne
    // pouvait le corriger. Analyser se fait maintenant avec Read/Grep/Glob.
    for (const analysis of [
      'Scout LECTURE SEULE : dans src/main/, trouve 2 ameliorations',
      'scoute le repo et dis-moi quoi ameliorer',
      'analyse le module de chat',
      'audite la securite du provider'
    ]) {
      expect(routeSkillRequest(analysis)).toBeUndefined()
    }
  })

  it('continue d’orchestrer ce qui MODIFIE vraiment', () => {
    // Garde-fou du garde-fou : la correction ne doit pas avoir desarme le routage utile.
    for (const modification of [
      'corrige le bouton workflows dans la page chat',
      "Documente l'API dans README.md",
      'Lance les tests',
      'refactore le module de chat'
    ]) {
      expect(routeSkillRequest(modification)?.reason).toBe('workspace-action')
    }
  })
})
