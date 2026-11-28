import { spawn } from 'node:child_process'
import { ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'node:fs'
import { plansPourLaListe, anciensPlansDuChef } from '../../shared/plan-de-lots'
import { phrasesDesLots } from '../../shared/phrase-du-fil'
import { parseFileRef, resolveFileRef } from '../../shared/file-ref'
import { ligneDemandee, racinesRevelation, commandeEditeur } from '../fichiers/reveal-file'
import { racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import { deleteListedRun } from '../dashboards/runs-scan'
import { assertTrustedRendererSender } from './ipc-senders'
import { ensureAutowinAppData } from '../app/app-data'
import { guardString } from './ipc-guards'
import { messagesAAfficher } from '../conversations/messages-entre-fils-app'
import type { SuiviDesPlans } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LES RUNS, LES FICHIERS ET LES PLANS DE LOTS : liste et suppression des runs, ouverture d’un
 * dossier ou d’un fichier, état et commandes de l’app, messages entre fils, plans de lots.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `registerRunsEtPlansIpc` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesRunsEtPlans {
  suiviDesPlans: SuiviDesPlans
}

/** IPC : runs, fichiers, état de l’app et plans de lots. */
export function registerRunsEtPlansIpc(ctx: ContexteIpcChat, deps: DependancesRunsEtPlans): void {
  const { appDataRoot, bus, os } = ctx
  const { suiviDesPlans } = deps
  ipcMain.handle('os:listRuns', (event) => {
    assertTrustedRendererSender(event, 'Runs')
    return os.listRuns()
  })
  ipcMain.handle('os:runs:delete', async (event, rawPath: string) => {
    assertTrustedRendererSender(event, 'DeleteRun')
    await deleteListedRun(guardString(rawPath, 'path'))
    return { ok: true }
  })

  // Ouvre le dossier contenant un fichier dans l'explorateur (vue Workflow).
  // Un chemin mort (run supprime, disque demonte, lecteur reseau absent) passe tel quel a
  // l'explorateur produit une boite Windows opaque (« Le lecteur specifie est introuvable »).
  // On verifie donc l'existence AVANT d'appeler le shell, et on rend un refus nomme.
  ipcMain.handle('os:openFolder', (event, path: string) => {
    assertTrustedRendererSender(event, 'Open folder')
    const cible = guardString(path, 'path')
    if (!existsSync(cible)) return { ok: false, reason: 'introuvable', path: cible }
    shell.showItemInFolder(cible)
    return { ok: true }
  })

  // Liens de fichiers du markdown : le renderer envoie la cible BRUTE citee par l'agent, le main
  // decide. Il re-parse (le renderer n'est pas cru), resout contre la racine du workspace et
  // REFUSE tout ce qui sort de cette racine ou n'existe pas. Ouvre le fichier ; a defaut le
  // revele dans l'explorateur.
  ipcMain.handle('os:revealFile', async (event, rawPath: unknown, rawLine?: unknown) => {
    assertTrustedRendererSender(event, 'Reveal file')
    const cible = parseFileRef(guardString(rawPath, 'path'))
    if (!cible) return { ok: false, reason: 'cible-non-fichier' }
    // Le renderer envoie `revealFile(path, line)` : le chemin n'a plus son suffixe `:80`. On prend
    // donc l'argument separe, APRES validation, et la cible ne sert que de repli.
    const ligne = ligneDemandee(rawLine, cible.line)

    // Un agent cite ce qu'il voit depuis SA copie. Chercher dans le seul workspace rendait
    // `introuvable` sur tout fichier cree pendant le run — la plainte d'origine.
    const worktreesRoot = join(ensureAutowinAppData(appDataRoot), 'worktrees')
    const racines = racinesRevelation({
      workspace: process.env.AUTOWIN_OS_WORKSPACE ?? process.cwd(),
      worktreesRoot: existsSync(worktreesRoot) ? worktreesRoot : undefined,
      racineCopiesDeTaches: racineDesCopiesDeTaches(ensureAutowinAppData(appDataRoot)),
      lister: (dir) => {
        try {
          return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        } catch {
          return []
        }
      }
    })

    let absolu: string | null = null
    let horsRacine = true
    for (const racine of racines) {
      const candidat = resolveFileRef(racine, cible.path)
      if (!candidat) continue
      horsRacine = false
      if (existsSync(candidat)) {
        absolu = candidat
        break
      }
    }
    if (horsRacine) return { ok: false, reason: 'hors-racine' }
    if (!absolu) return { ok: false, reason: 'introuvable' }

    // Ouvrir A LA LIGNE demande de savoir quel editeur : `shell.openPath` ne le peut pas. Quand on
    // ne sait pas, on ouvre quand meme ET on le DIT — taire l'ecart etait le defaut d'origine.
    const editeur = commandeEditeur({
      editeur: process.env.AUTOWIN_OS_EDITOR,
      chemin: absolu,
      ligne
    })
    if (editeur) {
      try {
        spawn(editeur.commande, editeur.args, { detached: true, stdio: 'ignore' }).unref()
        return { ok: true, reason: 'ouvert-a-la-ligne' }
      } catch {
        // Editeur mal configure : on retombe sur l'ouverture simple plutot que de ne rien faire.
      }
    }
    const erreur = await shell.openPath(absolu)
    if (erreur) {
      shell.showItemInFolder(absolu)
      return { ok: true, reason: 'revele-dans-explorateur' }
    }
    return ligne === undefined ? { ok: true } : { ok: true, reason: 'ligne-non-honoree' }
  })

  // --- Plan de contrôle : l'app pilotable par les agents ---
  ipcMain.handle('os:appState', (event) => {
    assertTrustedRendererSender(event, 'App state')
    return bus.snapshot()
  })
  ipcMain.handle('os:appCommand', (event, name: string, args?: Record<string, unknown>) => {
    assertTrustedRendererSender(event, 'App command')
    return bus.exec(guardString(name, 'name'), args)
  })
  // Messages entre fils : ce que le fil affiche, envoyés et reçus. Lecture SEULE —
  // afficher ne marque rien comme livré à l'agent.
  ipcMain.handle('os:messagesEntreFils', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'Messages entre fils')
    return messagesAAfficher(guardString(conversationId, 'conversationId'))
  })
  // Plans de lots d'un fil chef : le tableau, et les SEULS gestes qui lancent ou
  // reprennent un plan — le clic de l'utilisateur. L'agent n'a que dépôt, état et relance d'un lot ;
  // la relance a aussi son bouton (lot 3), qui porte le numéro du lot.
  ipcMain.handle(
    'os:plansDeLots',
    async (
      event,
      action: unknown,
      conversationId: unknown,
      planId?: unknown,
      lot?: unknown,
      selection?: unknown
    ) => {
      assertTrustedRendererSender(event, 'Plans de lots')
      const geste = guardString(action, 'action')
      const coordinateur = suiviDesPlans.coordinateur
      if (!coordinateur) return { ok: false, erreur: 'coordinateur des plans pas encore démarré.' }
      // Lecture groupée, sans fil : la liste des conversations range tous les fils de
      // lots sous leur chef en UN appel, au lieu de deviner les lots à leur titre « Lot N/M — ».
      if (geste === 'tous') return { ok: true, plans: plansPourLaListe(coordinateur.plans()) }
      const fil = guardString(conversationId, 'conversationId')
      if (geste === 'voir') return { ok: true, vue: coordinateur.planDuFil(fil) ?? null }
      // Les plans que le chef ne montre plus : leurs lots n'ont plus de ligne dans la
      // liste, le bloc du chef les liste à leur place.
      if (geste === 'anciens')
        return { ok: true, anciens: anciensPlansDuChef(coordinateur.plans(), fil) }
      // Ce que dit chaque lot : lu ici, où TOUS les fils sont en mémoire, tour en cours
      // compris ; l'écran n'a que ceux qu'il a déjà peints, et une piste de lot jamais ouvert restait
      // vide. Seules les phrases traversent le canal, pas les messages.
      if (geste === 'phrases') {
        const vue = coordinateur.planDuFil(fil)
        const phrases = vue
          ? phrasesDesLots(vue.plan, (lotFil) => os.conversations.get(lotFil)?.messages)
          : {}
        return { ok: true, phrases }
      }
      // Le bouton du workflow intelligent : le plan n'existe pas encore, il n'a pas d'id.
      if (geste === 'lancer-selection') return coordinateur.lancerSelection(fil, selection)
      const id = guardString(planId, 'planId')
      if (geste === 'accepter') return coordinateur.accepter(fil, id)
      if (geste === 'refuser') return coordinateur.refuser(fil, id)
      if (geste === 'arreter') return coordinateur.arreter(fil, id)
      if (geste === 'reprendre') return coordinateur.reprendre(fil, id)
      if (geste === 'relancer') {
        const rang = Number(lot)
        if (!Number.isInteger(rang) || rang < 1)
          return { ok: false, erreur: '« lot » : numéro du lot à relancer attendu (1, 2…).' }
        return coordinateur.relancer(fil, rang, id)
      }
      return { ok: false, erreur: `geste « ${geste} » inconnu.` }
    }
  )
}
