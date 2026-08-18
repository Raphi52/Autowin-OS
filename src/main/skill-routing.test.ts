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
    //
    // RETRECI le 2026-08-18, sur arbitrage utilisateur (« ca aurait du declencher scout ») : un
    // message qui COMMENCE par « scout » nomme desormais la phase, comme `/scout`. La difference qui
    // rend ce retour acceptable : l'ancien routage produisait une orchestration MUTANTE
    // (`workspace-action`), celui-ci nomme une phase READ-ONLY. Les verbes d'analyse GENERIQUES —
    // « scoute », « analyse », « audite » — restent hors court-circuit, eux n'ont jamais nomme de
    // phase. Le cas « Scout LECTURE SEULE… » a donc change de camp : il est teste juste en dessous.
    for (const analysis of [
      'scoute le repo et dis-moi quoi ameliorer',
      'analyse le module de chat',
      'audite la securite du provider'
    ]) {
      expect(routeSkillRequest(analysis)).toBeUndefined()
    }
  })

  it('un message qui COMMENCE par « scout » nomme la phase, meme avec des precisions', () => {
    // Le cas exact retire de la liste ci-dessus : il porte le mot en tete, donc il nomme la phase.
    const route = routeSkillRequest('Scout LECTURE SEULE : dans src/main/, trouve 2 ameliorations')
    expect(route?.explicitPhase).toBe('scout')
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

describe('« scout » en tete de message declenche la phase SCOUT', () => {
  /**
   * Defaut vecu le 2026-08-18 (conv-1297) : « scout des ameliorations de l'experience utilisateur »
   * a produit un rapport de BUILD — trois lignes marquees « Implemente » au lieu d'une shortlist. La
   * phase scout n'a jamais tourne : seule la forme `/scout` etait routee, le mot nu partait au
   * modele, qui a choisi build.
   *
   * Le mot avait ete retire du court-circuit le 2026-07-28, mais pour une AUTRE raison : il
   * declenchait alors une ORCHESTRATION MUTANTE sans consulter le modele. Ici il nomme une phase
   * READ-ONLY, ce que l'utilisateur demande explicitement. Un faux positif coute une shortlist, pas
   * une ecriture.
   */
  it('route vers la phase scout sur le mot nu en tete', () => {
    const route = routeSkillRequest("scout des ameliorations de l'experience utilisateur")
    expect(route?.explicitPhase).toBe('scout')
    expect(route?.reason).toBe('explicit-skill')
  })

  it('conserve le message tel quel comme tache', () => {
    const message = 'scout des fix de autowin os'
    expect(routeSkillRequest(message)?.task).toBe(message)
  })

  it('ne se declenche que EN TETE, jamais au milieu d une phrase', () => {
    expect(routeSkillRequest('le scout est toujours pas score')).toBeUndefined()
    expect(routeSkillRequest('regarde le dernier scout')).toBeUndefined()
  })

  it('ne transforme pas une QUESTION en scout', () => {
    expect(routeSkillRequest('scout ou build ?')).toBeUndefined()
  })

  it('ne prend pas un mot qui commence par scout', () => {
    expect(routeSkillRequest('scouting des idees')).toBeUndefined()
  })

  it('la forme avec slash continue de marcher', () => {
    expect(routeSkillRequest('/scout autowin')?.explicitPhase).toBe('scout')
  })
})

describe('« scout » apres un preambule declenche aussi la phase', () => {
  /**
   * Defaut vecu le 2026-08-18 (conv-1298) : la regle ancree en tete ne tirait PAS sur le prompt reel
   * de l'utilisateur, « en te basant sur la derniere conversation qu'on a eu (cite la moi pour etre
   * sur) scout des ameliorations de l'experience utilisateur ». Le mot y est, mais precede d'un
   * preambule. Resultat mesure : phase build, tableau imite au format scout, colonne Score remplie
   * d'une pastille — le brief scout n'ayant jamais ete injecte.
   *
   * On elargit au mot suivi d'un DETERMINANT (« scout des », « scout le », « scout sur »…) : c'est ce
   * qui distingue l'ORDRE (« scout des ameliorations ») du simple mot dans une phrase (« le scout est
   * pas score », « regarde le dernier scout »).
   */
  it('tire sur le prompt REEL de l utilisateur', () => {
    const message =
      "en te basant sur la derniere conversation qu'on a eu (cite la moi pour etre sur) scout des ameliorations de l'experience utilisateur pour oneshot les tasks"
    expect(routeSkillRequest(message)?.explicitPhase).toBe('scout')
  })

  it('accepte les tournures usuelles', () => {
    for (const message of [
      'scout les fix de autowin',
      'apres avoir lu le code, scout sur la barre laterale',
      'scout dans src/main les ameliorations',
      'scout moi des idees'
    ]) {
      expect(routeSkillRequest(message)?.explicitPhase, message).toBe('scout')
    }
  })

  it('ne tire PAS quand « scout » est un simple nom dans la phrase', () => {
    for (const message of [
      'le scout est toujours pas score',
      'regarde le dernier scout',
      'le scout precedent etait meilleur'
    ]) {
      expect(routeSkillRequest(message), message).toBeUndefined()
    }
  })
})
