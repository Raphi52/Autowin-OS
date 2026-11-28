import { ipcMain, app } from 'electron'
import { join } from 'path'
import {
  readExecutionWorkspacePreference,
  writeExecutionWorkspacePreference,
  clearExecutionWorkspacePreference
} from '../orchestration/execution-workspace-preference'
import { estDansUnDepotGit } from '../git/depot-git'
import { readBrainHealth } from '../brain/brain-index-refresh'
import {
  lireBrainReglage,
  appliquerBrainReglage,
  effacerBrainReglage
} from '../brain/brain-reglage'
import {
  racineBrainPerso,
  envDuBrainPerso,
  origineBrainPerso,
  pingBrainPerso,
  defaultBrainPersoRoot,
  preparerDossierBrainPerso,
  demarrerBrainPerso
} from '../brain/brain-perso'
import { defaultBrainRoot } from '../brain/brain-paths'
import {
  listerAffectations,
  enregistrerAffectationDepuisLeRendu,
  retirerAffectationDepuisLeRendu
} from '../brain/brain-affectation-canaux'
import type {
  ExecutionWorkspaceState,
  BrainReglageState,
  BrainPersoState
} from '../../shared/preload-contracts'
import { aggregateToolUsage } from '../activity/tool-usage'
import { assertTrustedRendererSender, assertTrustedBehaviourSender } from './ipc-senders'
import { ensureAutowinAppData } from '../app/app-data'
import {
  lireReglageCopieParFil,
  ecrireReglageCopieParFil
} from '../conversations/bascule-dossier-conversation'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import { lireOrientationsRattachees } from '../store/journal-saisie'
import {
  inventorierDisque,
  FAMILLES_AUTOWIN_SUR_DISQUE,
  menageDemarrage
} from '../store/inventaire-disque'
import { sharedBrainRoot } from '../brain/brain-context'
import type { ContexteIpcChat } from '../index'

/**
 * LES RÉGLAGES DU POSTE : dossier de travail, copie par fil, Brain partagé et Brain perso,
 * affectations de canaux, disque, orientations rattachées, usage des outils.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** Ce que `registerReglagesIpc` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface ReglagesDuChat {
  reglageCopieParFil: () => string
}

/** IPC : réglages du poste. */
export function registerReglagesIpc(ctx: ContexteIpcChat): ReglagesDuChat {
  const { appDataRoot, behaviourAccess, os, pickDirectory } = ctx
  // Le DOSSIER DE TRAVAIL : le depot sur lequel les runs s'executent. Distinct du selecteur de
  // BehaviourView juste en dessous, qui ne sert qu'a INSPECTER les fichiers d'instructions d'un
  // dossier sans rien changer a l'execution.
  /** Le réglage « une copie par fil », relu au début de chaque tour (`passerLeFilDansSaCopie`). */
  const reglageCopieParFil = (): string =>
    join(ensureAutowinAppData(appDataRoot), 'copie-par-fil.json')
  const executionWorkspaceState = (): ExecutionWorkspaceState => {
    const chosen = readExecutionWorkspacePreference() ?? null
    return {
      path: os.executionWorkspace,
      chosen,
      isGitRepo: estDansUnDepotGit(os.executionWorkspace),
      // Le workspace est fige au demarrage : un choix different de l'actif exige un redemarrage.
      restartRequired: chosen !== null && chosen !== os.executionWorkspace,
      copieParFil: lireReglageCopieParFil(reglageCopieParFil())
    }
  }

  // LE BRAIN renseigne dans les Reglages (2026-10-13) : un chemin et/ou un depot git.
  // Le dossier du demarrage sert de reference : le serveur Brain et la vue du graphe le gardent
  // jusqu'au redemarrage (`SHARED_BRAIN_ROOT` est lu a l'import de viz/fs-brains.ts).
  const racineBrainAuDemarrage = sharedBrainRoot()
  const brainReglageState = async (erreur?: string): Promise<BrainReglageState> => {
    const reglage = lireBrainReglage()
    const effectif = sharedBrainRoot()
    // Borne courte : l'ecran des Reglages ne doit pas attendre un serveur qui ne repond pas.
    const serveurRacine = (await readBrainHealth(fetch, process.env, 2000))?.root ?? null
    return {
      actif: racineBrainAuDemarrage,
      effectif,
      choisi: reglage.chemin || reglage.depot ? reglage : null,
      estUnDepot: Boolean(reglage.depot),
      redemarrageNecessaire: !memeCheminSurDisque(effectif, racineBrainAuDemarrage),
      serveurRacine,
      serveurSurUnAutreDossier:
        serveurRacine !== null && !memeCheminSurDisque(serveurRacine, effectif),
      // Une adresse de depot peut porter un identifiant (`https://nom:jeton@…`) : jamais affiche.
      ...(erreur ? { erreur: erreur.replace(/\/\/[^@/\s]*@/g, '//***@') } : {})
    }
  }

  /*
   * LES CONSIGNES DONNEES PENDANT UN TOUR, RENDUES AU FIL.
   *
   * Elles etaient ecrites dans `saisies-utilisateur.jsonl` (101 le 2026-09-12) mais ne vivaient a
   * l'ecran que dans un etat React : un changement de conversation les effaçait. Lecture seule,
   * bornee, et jamais bloquante -- une defaillance rend une liste vide.
   */
  /*
   * CE QU'AUTOWIN OCCUPE SUR LE DISQUE. La question a du etre POSEE par l'utilisateur le
   * 2026-09-11 (« est-ce qu'autowin OS accumule des Go en l'utilisant ? ») : aucune vue ne le
   * disait. Familles NOMMEES uniquement -- la racine porte aussi les caches de Chromium, qui ne
   * sont pas de l'accumulation d'Autowin.
   */
  // fix-ok: la liste vit dans inventaire-disque.ts, où la racine unique `copies-de-taches` est comptée ; une seule liste sert à l'écran et au test.
  ipcMain.handle('os:disk-usage', (event) => {
    assertTrustedRendererSender(event, 'Espace disque')
    return inventorierDisque(
      app.getPath('userData'),
      FAMILLES_AUTOWIN_SUR_DISQUE,
      menageDemarrage()
    )
  })

  ipcMain.handle('chat:orientations', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'Consignes du tour')
    if (typeof conversationId !== 'string' || !conversationId.trim()) return []
    return lireOrientationsRattachees(conversationId)
  })

  ipcMain.handle('os:execution-workspace', (event) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    return executionWorkspaceState()
  })

  ipcMain.handle('os:execution-workspace:choose', async (event) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    const selected = await pickDirectory(event.sender)
    if (!selected) return executionWorkspaceState()
    writeExecutionWorkspacePreference(selected)
    return executionWorkspaceState()
  })

  ipcMain.handle('os:execution-workspace:reset', (event) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    clearExecutionWorkspacePreference()
    return executionWorkspaceState()
  })

  // Éteindre « une copie par fil » ramène les tours SUIVANTS au dossier partagé ; un tour en cours
  // garde le sien. Un disque qui refuse l'écriture lève : l'écran le dit au lieu de mentir.
  ipcMain.handle('os:execution-workspace:copie-par-fil', (event, actif: unknown) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    if (!ecrireReglageCopieParFil(actif === true, reglageCopieParFil()))
      throw new Error('Impossible d’enregistrer le réglage « Une copie par fil ».')
    return executionWorkspaceState()
  })

  ipcMain.handle('os:brain-reglage', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainReglageState()
  })

  ipcMain.handle('os:brain-reglage:choisir-dossier', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    return pickDirectory(event.sender)
  })

  ipcMain.handle('os:brain-reglage:enregistrer', async (event, entree: unknown) => {
    assertTrustedRendererSender(event, 'Brain')
    const champs = (entree && typeof entree === 'object' ? entree : {}) as {
      chemin?: unknown
      depot?: unknown
    }
    try {
      await appliquerBrainReglage(
        { chemin: champs.chemin, depot: champs.depot },
        { racineParDefaut: defaultBrainRoot() }
      )
      return brainReglageState()
    } catch (error) {
      return brainReglageState(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle('os:brain-reglage:reset', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    effacerBrainReglage()
    return brainReglageState()
  })

  // BRAIN PERSO (2026-10-28) : même formulaire que celui de l'équipe, son propre fichier
  // (`brain-perso.json`). Pas de redémarrage : le serveur perso démarre dès l'enregistrement.
  const brainPersoState = async (erreur?: string): Promise<BrainPersoState> => {
    const reglage = lireBrainReglage(process.env, 'perso')
    const racine = racineBrainPerso() ?? null
    const envPerso = envDuBrainPerso()
    // Un serveur perso lancé AVANT un changement de dossier sert encore l'ancien (même garde que
    // pour l'équipe : /health porte la racine servie).
    const serveurRacine = envPerso
      ? ((await readBrainHealth(fetch, envPerso, 2000))?.root ?? null)
      : null
    return {
      choisi: reglage.chemin || reglage.depot ? reglage : null,
      racine,
      origine: origineBrainPerso(),
      serveurJoignable: racine ? await pingBrainPerso() : false,
      serveurRacine,
      serveurSurUnAutreDossier:
        racine !== null && serveurRacine !== null && !memeCheminSurDisque(serveurRacine, racine),
      ...(erreur ? { erreur: erreur.replace(/\/\/[^@/\s]*@/g, '//***@') } : {})
    }
  }

  ipcMain.handle('os:brain-perso', (event) => {
    assertTrustedRendererSender(event, 'Brain perso')
    return brainPersoState()
  })

  ipcMain.handle('os:brain-perso:enregistrer', async (event, entree: unknown) => {
    assertTrustedRendererSender(event, 'Brain perso')
    const champs = (entree && typeof entree === 'object' ? entree : {}) as {
      chemin?: unknown
      depot?: unknown
    }
    try {
      const reglage = await appliquerBrainReglage(
        { chemin: champs.chemin, depot: champs.depot },
        { racineParDefaut: defaultBrainPersoRoot(), quel: 'perso' }
      )
      const racine = reglage.chemin ?? (reglage.depot ? defaultBrainPersoRoot() : undefined)
      if (racine) preparerDossierBrainPerso(racine)
      const lancement = await demarrerBrainPerso()
      if (lancement) console.log('[brain-perso] serveur', lancement.status, '—', lancement.detail)
      return brainPersoState()
    } catch (error) {
      return brainPersoState(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle('os:brain-perso:reset', (event) => {
    assertTrustedRendererSender(event, 'Brain perso')
    // Retire le RÉGLAGE seulement : le dossier et ses notes restent sur le disque.
    effacerBrainReglage(process.env, 'perso')
    return brainPersoState()
  })

  // AFFECTATIONS dossier de travail → Brain (plan « Affectation des dossiers de travail aux Brains »,
  // lot 3). La validation, la liste à jour et les refus lisibles vivent dans brain-affectation-canaux.ts.
  ipcMain.handle('os:brain-affectations', (event) => {
    assertTrustedRendererSender(event, 'Affectations des Brains')
    return listerAffectations(process.env)
  })

  ipcMain.handle('os:brain-affectations:enregistrer', (event, entree: unknown) => {
    assertTrustedRendererSender(event, 'Affectations des Brains')
    return enregistrerAffectationDepuisLeRendu(process.env, entree)
  })

  ipcMain.handle('os:brain-affectations:retirer', (event, entree: unknown) => {
    assertTrustedRendererSender(event, 'Affectations des Brains')
    return retirerAffectationDepuisLeRendu(process.env, entree)
  })

  ipcMain.handle('os:behaviour:choose-workspace', async (event) => {
    assertTrustedBehaviourSender(event)
    const selected = await pickDirectory(event.sender)
    return selected ? behaviourAccess.approve(selected) : null
  })

  // Usage RÉEL des outils (actions Codex/Claude observées) — distinct du catalogue natif décoratif.
  ipcMain.handle('os:toolUsage', (event) => {
    assertTrustedRendererSender(event, 'Tool usage')
    return aggregateToolUsage()
  })
  return { reglageCopieParFil }
}
