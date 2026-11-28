import { pendantOperation } from '../gel/gel-main'
import { app } from 'electron'
import { ensureAutowinAppData } from '../app/app-data'
import {
  menageDesCopiesDeTaches,
  menageDesCopiesDeFil,
  CALME_AVANT_MENAGE_MS
} from '../conversations/menage-des-copies-de-fil'
import { titreDeLaReprise } from '../chat/chat-turn-publication'
import { depotsDesCopiesDeFil, estDepotAutowin } from '../git/git-apres-fil'
import { jouerPasseDeRetention } from '../store/balayage-retention'
import { chargerShaConsignes } from '../store/registres-consignes'
import type { ContexteIpcChat } from '../index'

/**
 * LE MÉNAGE PÉRIODIQUE : copies d’agent abandonnées, passe de rétention, copies de fil et de
 * tâche dont le travail est fini.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `demarrerLeMenageDuChat` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesMenageDuChat {
  dossierDesRetours: () => string
  dossierDesCopiesDeFil: () => string
}

/** Ce que `demarrerLeMenageDuChat` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface MenageDuChat {
  planifierLeMenageDesCopies: () => void
}

/** Les balayages périodiques du chat. */
export function demarrerLeMenageDuChat(
  ctx: ContexteIpcChat,
  deps: DependancesMenageDuChat
): MenageDuChat {
  const { activeChatTurns, appDataRoot, broadcast, os } = ctx
  const { dossierDesRetours, dossierDesCopiesDeFil } = deps
  /**
   * Le balayage des copies d'agent abandonnées, RÉPÉTÉ pendant la session et non plus au seul démarrage.
   *
   * Mesuré le 2026-08-14 sur l'installation de l'utilisateur : 49 copies pour 1 453 Mo. Une copie
   * abandonnée à 9 h attendait le prochain lancement pour être vue, alors que les sessions durent la
   * journée. L'heure est calibrée sur l'âge minimal du balayage (24 h) : plus court n'avancerait aucun
   * verdict, plus long laisserait le disque grossir sans raison. `unref()` comme le minuteur voisin,
   * sinon un minuteur horaire retient la boucle d'événements et la fermeture ne se fait plus proprement.
   */
  const balayagePeriodiqueTimer = setInterval(
    () => {
      void pendantOperation('timer:balayage:copiesAbandonnees', () =>
        os.worktrees?.balayerLesCopiesAbandonnees()
      )
    },
    60 * 60 * 1_000
  )
  balayagePeriodiqueTimer.unref()

  /**
   * LE BALAYAGE DE RETENTION — il SIGNALE, il ne supprime RIEN. Volontairement.
   *
   * Le stock de sauvegardes n'avait aucune politique : 89 branches `autowin/*` accumulees en 22
   * jours et 208 refs `refs/autowin/*` invisibles de `git branch`, releve du 2026-09-08. Le tri
   * dependait d'une journee entiere passee a la main.
   *
   * POURQUOI AUCUNE SUPPRESSION N'EST BRANCHEE ICI, et c'est un choix, pas un oubli : un balayage
   * automatique a DEJA fait des degats sur ce depot. Le 2026-08-24, la reprise automatique a tourne
   * sans plafond et RECREE 682 Mo en rejouant vingt-et-une copies impubliables. On observe donc un
   * passage reel avant d'autoriser le moindre geste — le plan est journalise, l'humain decide.
   *
   * Meme minuteur horaire que le balayage voisin : le stock bouge a l'echelle du jour, pas de la
   * minute, et un second minuteur n'ajouterait qu'un reveil.
   */
  const passeDeRetention = (): void => {
    void pendantOperation('timer:balayage:retention', async () => {
      const worktrees = os.worktreeManager
      if (!worktrees) return
      // Le rejet d'un recensement trop long est GERE dans `jouerPasseDeRetention` (crash.log du
      // 2026-10-28 : « unhandledRejection », bulletin de maintenance du 30/10).
      await jouerPasseDeRetention({
        recenser: () => {
          const consignes = chargerShaConsignes(app.getAppPath())
          /*
           * ASYNCHRONE, et ce n'est pas un detail de style. La version synchrone lance un `git cherry`
           * par ref de secours -- 97 ce 2026-09-08 -- en `execFileSync` : 11 720 ms de fenetre figee
           * pendant la construction de la fenetre, journalises dans `gels.jsonl`. Meme prix, meme
           * verdict, mais paye sans tenir la boucle d'evenements.
           */
          return worktrees.recenserRetentionAsync((sha) => consignes.has(sha))
        },
        poserRapport: (rapport) => os.poserRapportRetention(rapport)
      })
    })
  }
  /*
   * UNE PASSE AU DEMARRAGE, puis toutes les heures. Un minuteur seul ne dit RIEN avant sa premiere
   * echeance : le cas reel est « l'app demarre et le stock dort deja » -- celui qui a laisse
   * quatorze travaux sur des branches de secours (2026-08-24). Un rapport qu'il faut attendre une
   * heure est un rapport qu'on ne lit pas.
   */
  passeDeRetention()
  const balayageRetentionTimer = setInterval(passeDeRetention, 60 * 60 * 1_000)
  balayageRetentionTimer.unref()

  /*
   * LE MÉNAGE DES COPIES DE FIL (`menage-des-copies-de-fil.ts`) : la copie d'un fil fini, identique à
   * ce que sa porte a déjà publié, quitte le disque, et le fil revient au dossier partagé. Une passe par
   * dépôt git où un fil a sa copie : une copie ne se range que par le dépôt qui l'a ouverte. Première
   * passe 5 min après le démarrage et non au démarrage : les tours repris s'enregistrent d'abord, et un
   * tour en cours ne perd jamais sa copie. Puis toutes les heures, comme les ménages voisins.
   */
  const passeDuMenageDesCopies = (): void => {
    const depotDeLApp = os.executionWorkspace
    const depots = depotsDesCopiesDeFil(os.conversations.listResumes(), depotDeLApp)
    if (!depots.length) return
    void pendantOperation('timer:balayage:copiesDeFil', async () => {
      const menage: Pick<
        Parameters<typeof menageDesCopiesDeTaches>[0],
        'lireFils' | 'tourEnCours' | 'decrocher'
      > = {
        lireFils: () => os.conversations.listResumes(),
        tourEnCours: (id) => activeChatTurns.isInFlight(id),
        decrocher: (id) => {
          os.conversations.revenirDeLaCopie(id)
        }
      }
      // Les copies d'avant, encore là, gardent leur passe : ce sont celles d'Autowin, sur son dépôt seul.
      const copiesAvant = estDepotAutowin(depotDeLApp)
        ? await menageDesCopiesDeFil({
            dossierDesRetours: dossierDesRetours(),
            dossierDesCopiesDeFil: dossierDesCopiesDeFil(),
            depot: depotDeLApp,
            ...menage
          })
        : { supprimees: [], gardees: [], echecs: [] }
      // Les copies de la racine unique passent par la primitive, une passe par dépôt.
      const bilansRacine: Array<Awaited<ReturnType<typeof menageDesCopiesDeTaches>>> = []
      for (const depot of depots)
        bilansRacine.push(
          await menageDesCopiesDeTaches({
            dossierDeDonnees: ensureAutowinAppData(appDataRoot),
            depot,
            titreDuCommit: titreDeLaReprise,
            // Le fil avait dit « Autowin retentera » : il lui dit maintenant que c'est entré.
            annoncerLaReprise: (tache) => {
              os.conversations.append(tache, {
                role: 'assistant',
                content: 'Le travail refusé à la fin du tour est entré dans main.'
              })
              broadcast({ type: 'refresh', scope: 'chat', convId: tache })
            },
            ...menage
          })
        )
      const bilan = {
        supprimees: [...copiesAvant.supprimees, ...bilansRacine.flatMap((b) => b.supprimees)],
        gardees: [...copiesAvant.gardees, ...bilansRacine.flatMap((b) => b.gardees)],
        echecs: [...copiesAvant.echecs, ...bilansRacine.flatMap((b) => b.echecs)]
      }
      if (bilan.supprimees.length) broadcast({ type: 'refresh', scope: 'conversations' })
      if (bilan.supprimees.length || bilan.echecs.length)
        console.log(
          `[copies de fil] ${bilan.supprimees.length} copie(s) de fil fini retirée(s), ${bilan.gardees.length} gardée(s), ${bilan.echecs.length} en échec`
        )
      for (const echec of bilan.echecs)
        console.warn('[copies de fil] copie non retirée', echec.chemin, echec.raison)
    })
  }
  setTimeout(passeDuMenageDesCopies, 5 * 60_000).unref()
  setInterval(passeDuMenageDesCopies, 60 * 60 * 1_000).unref()
  /*
   * LE MÉNAGE APRÈS LA FIN D'UN TOUR : le balayage horaire, décalé du délai de calme
   * (`CALME_AVANT_MENAGE_MS`, 1 h), garderait une copie propre jusqu'à près de 2 h. Chaque fin de tour
   * relance donc une passe après ce délai, une seule à la fois : la passe relit l'état, et un fil repris
   * entre-temps garde sa copie (tour en cours, ou calme pas encore atteint).
   */
  // fix-ok: le balayage horaire (setInterval 1 h, plus haut) laisserait une copie propre jusqu'à près de 2 h après le tour ; cette passe la retire au bout du délai de calme.
  let minuterieDuMenage: ReturnType<typeof setTimeout> | undefined
  const planifierLeMenageDesCopies = (): void => {
    if (minuterieDuMenage) clearTimeout(minuterieDuMenage)
    minuterieDuMenage = setTimeout(() => {
      minuterieDuMenage = undefined
      passeDuMenageDesCopies()
    }, CALME_AVANT_MENAGE_MS)
    minuterieDuMenage.unref?.()
  }
  return { planifierLeMenageDesCopies }
}
