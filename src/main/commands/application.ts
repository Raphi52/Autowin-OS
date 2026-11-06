// Groupe de commandes « état, run, redémarrage, bureau caché, environnement », sorti de AppCommandBus.run (conv-1508, lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { argumentAbsent } from './arguments'
import { etatPourOutil, type ArgsEtat } from '../chat/etat-outil'
import { ensureAutowinAppData } from '../app/app-data'
import { memoriserAutorisations } from '../store/autorisations-permanentes'
import { autorisationsLuesDans, decisionDeCommande, decouperArguments } from '../gardes/autorisation-commande'
import { sansHeredocsDeDonnees } from '../../shared/heredocs'
import { refusGitDestructeur } from '../../shared/garde-git-destructeur'
import { refusTacheWindows } from '../../shared/garde-tache-windows'
import { refusEcriturePythonCrlf } from '../../shared/garde-python-crlf'
import { refusReglageProd, cibleSqlDeCommande } from '../prod/prod-run-guard'
import { refusCommitDeFichierReserve } from '../fichiers/reservation-fichiers-app'
import { poserReprise } from '../app/redemarrage-reprise'
import { annoncerFermeture } from '../app/journal-arrets'
import { identifiantBureauCacheChat } from '../consignes/consigne-bureau-cache'
import { rechargerEnv } from '../app/env-reload'

/** Cas de `AppCommandBus.run` : état, run, redémarrage, bureau caché, environnement. Corps déplacé tel quel depuis commands.ts (conv-1508, lot 2). */
export async function executerApplication(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string,
  onProgress?: (text: string) => void
): Promise<unknown> {
  const s = (k: string): string => String(a[k] ?? '')
  switch (name) {
    case 'get_state':
      // Une section ou une limite invalide lève : le refus part au modèle, jamais ignoré (conv-1370).
      return etatPourOutil(await bus.snapshot(), {
        sections: a.sections as ArgsEtat['sections'],
        ...(argumentAbsent(a.conversation) ? {} : { conversation: String(a.conversation) }),
        limite: a.limite as ArgsEtat['limite']
      })
    case 'run': {
      /**
       * LA COMMANDE QUE L'UTILISATEUR AUTORISE — et personne d'autre.
       *
       * Defaut vecu, rapporte le 2026-08-26 apres des semaines : « Autorise les commandes git »
       * ecrit dans le chat, et l'agent repond que cette autorisation « ne leve pas le garde
       * d'execution ». Il n'y avait AUCUN garde : il n'y avait aucune capacite. L'agent a invente
       * une permission manquante pour expliquer une commande absente, et a envoye l'utilisateur
       * chercher pendant des semaines un reglage qui n'existait pas.
       *
       * Le droit vient d'ICI : les messages de role `user` de cette conversation, lus cote
       * principal. Le modele ne peut pas se l'accorder — ses propres messages ne sont jamais
       * passes a la decision. C'est la seule propriete qui rend cette ouverture sure, et elle est
       * verrouillee par un test de cablage.
       */
      const ligne = typeof a.commande === 'string' ? a.commande.trim() : ''
      const messagesUtilisateur = (
        conversationId ? (bus.os.conversations.get(conversationId)?.messages ?? []) : []
      )
        .filter((message) => message.role === 'user')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
      // « Dans toutes les conversations, forever » (demandé le 2026-08-28) : ce que l'utilisateur
      // autorise ICI est mémorisé dans la racine de données, et vaut ensuite partout. La source du
      // droit ne change pas — seuls des messages `user` alimentent ce registre.
      const racineDonnees = ensureAutowinAppData()
      const permanentes = memoriserAutorisations(
        racineDonnees,
        autorisationsLuesDans(messagesUtilisateur)
      )
      const decision = decisionDeCommande(ligne, messagesUtilisateur, permanentes)
      if (!decision.autorise) {
        // Le refus NOMME la cause et le geste qui l'ouvre. Un refus muet renvoie a la devinette —
        // c'est exactement ce qui a coute des semaines ici.
        return { lance: false, detail: `Commande refusée : ${decision.motif ?? 'non autorisée'}` }
      }
      // Le refus des lancements graphiques au premier plan a ete RETIRE (conv-631, 2026-09-17,
      // demande explicite de l'utilisateur) : il bloquait l'ouverture d'un fichier sur son propre
      // ecran, qu'il demandait nommement. Le bureau cache (scripts/hdesk-lancer.ps1) reste la voie
      // par defaut, portee par la CONSIGNE du prompt de pilotage — plus par un blocage.
      // Garde conv-587 : pas d'effacement de l'arbre de travail entier (reset --hard & co).
      // Même lecture que le hook du CLI : le corps d'un heredoc de simple texte n'est pas du shell
      // (rejeu du 2026-10-01 sur 29 371 commandes, `src/shared/heredocs.ts`).
      const shell = sansHeredocsDeDonnees(ligne)
      const refusGit = refusGitDestructeur(shell)
      if (refusGit) return { lance: false, detail: `Commande refusée : ${refusGit}` }
      // Même garde que le hook du CLI : pas de tâche Windows invisible dans le Task Manager.
      const refusTache = refusTacheWindows(shell)
      if (refusTache) return { lance: false, detail: `Commande refusée : ${refusTache}` }
      // Même garde que le hook du CLI (2026-10-01) : Python en mode texte passe un fichier en CRLF.
      const refusPython = refusEcriturePythonCrlf(ligne)
      if (refusPython) return { lance: false, detail: `Commande refusée : ${refusPython}` }
      // Porte de production (conv-738) : `run` ne coupe pas la protection et ne contourne pas
      // `sql_query` en lançant lui-même un client SQL. Même verdict, même fenêtre, une reprise.
      const refusReglage = refusReglageProd(shell)
      if (refusReglage) return { lance: false, detail: `Commande refusée : ${refusReglage}` }
      const cibleSql = cibleSqlDeCommande(shell)
      // Sans porte branchée, un client SQL ne part PAS sans contrôle : refus par défaut (conv-738).
      if (cibleSql && !bus.porteProd)
        return { lance: false, detail: 'Commande refusée : la protection de production n’est pas disponible, aucun client SQL ne part sans elle.' }
      if (cibleSql && bus.porteProd) {
        const geste = { nature: 'base' as const, nom: cibleSql.base, operation: `run-${cibleSql.client}` }
        const verdict = bus.porteProd.verifier(geste)
        if (!verdict.autorise) {
          const reponse = bus.guichetProd
            ? await bus.guichetProd.demander({
                ...verdict.demande,
                niveau: verdict.niveau,
                ...(conversationId ? { conversationId } : {})
              })
            : undefined
          if (!reponse) return { lance: false, detail: `Commande refusée : ${verdict.motif}` }
          const reprise = bus.porteProd.verifier({
            ...geste,
            ...(reponse.type === 'jeton' ? { jeton: reponse.valeur } : { confirme: true })
          })
          if (!reprise.autorise) return { lance: false, detail: `Commande refusée : ${reprise.motif}` }
        }
      }
      const cwd = bus.workspaceDuTour
      if (!cwd) return { lance: false, detail: 'Commande refusée : aucun workspace résolu' }
      // Même garde que le hook du CLI (conv-1083, objection du contrôle final) : un `git commit`
      // qui emporterait le fichier non commité qu'un AUTRE fil tient est refusé, en le nommant.
      // Sans fil (appel IPC direct), personne n'est au nom de qui réserver : rien n'est vérifié.
      if (conversationId) {
        const refusCommit = refusCommitDeFichierReserve(conversationId, shell, cwd)
        if (refusCommit) return { lance: false, detail: `Commande refusée : ${refusCommit}` }
      }
      // Les guillemets GROUPENT : `decouperArguments` respecte `-m "trois mots"` là où un
      // `split(/\s+/)` en faisait trois arguments et laissait les guillemets dans le texte.
      // Le Stop de l'utilisateur doit atteindre CE process : une commande qui ne rend jamais la
      // main (application a fenetre, serveur) bloquait sinon le tour jusqu'au plafond, bouton
      // d'arret compris (conv-384, 2026-09-09).
      const issue = await bus.spawnVerify(
        decouperArguments(ligne),
        cwd,
        ligne,
        onProgress,
        conversationId ? bus.signalDuTour?.(conversationId) : undefined
      )
      return {
        lance: true,
        commande: ligne,
        exitCode: issue.exitCode,
        detail: issue.output ?? `${ligne} — code ${issue.exitCode ?? '?'}`
      }
    }
    case 'restart_app': {
      // La cible de reprise est la conversation COURANTE, jamais un argument du modele : une
      // consigne rejouee dans un autre fil serait un message fabrique dans le dos de l'utilisateur.
      const cible = conversationId ?? bus.activeConversationId ?? ''
      if (!cible) {
        return { redemarre: false, detail: 'Redémarrage refusé : aucune conversation courante.' }
      }
      if (!bus.redemarrerApp) {
        return {
          redemarre: false,
          detail: 'Redémarrage indisponible : aucun lanceur câblé dans ce processus.'
        }
      }
      const consigne = typeof a.consigne === 'string' ? a.consigne.trim() : ''
      if (!consigne) {
        return {
          redemarre: false,
          detail:
            'Redémarrage refusé : `consigne` est obligatoire — sans elle la tâche mourrait avec le process.'
        }
      }
      const contenuReprise = {
        conversationId: cible,
        consigne,
        ...(typeof a.raison === 'string' && a.raison.trim() ? { raison: a.raison.trim() } : {})
      }
      const cause = `restart_app (${cible})${a.raison ? ` — ${String(a.raison).trim()}` : ''}`
      // D'AUTRES agents tournent : les couper n'est pas un geste de CE tour. Le redemarrage entre
      // dans la file au repos (conv-304, tour 48eb0f5b-a0df-4028-876a-557d9c7e88eb : faute de
      // file, l'agent a pose un `ask` au lieu de redemarrer). Le tour courant, lui, se termine.
      const autresConversations = (bus.conversationsEnVol?.() ?? []).filter((c) => c !== cible)
      const orchestrations = bus.orchestrationsEnVol()
      if (autresConversations.length > 0 || orchestrations > 0) {
        const attend = [
          ...autresConversations,
          ...(orchestrations > 0 ? [`${orchestrations} orchestration(s)`] : [])
        ]
        // Horodatage frais a la relance : l'attente peut depasser la peremption de la reprise.
        const enFile =
          bus.redemarrerAuRepos?.({
            cause,
            avantRelance: () => poserReprise(ensureAutowinAppData(), contenuReprise)
          }) ?? false
        if (enFile) {
          // Posee TOUT DE SUITE aussi : une relance par un autre chemin (relance du moteur, ou
          // l'utilisateur dans les 15 min) rejoue quand meme la consigne.
          const reprise = poserReprise(ensureAutowinAppData(), contenuReprise)
          return {
            enFile: true,
            attend,
            conversationId: cible,
            consigne: reprise.consigne,
            detail:
              `Redémarrage mis en file : ${attend.join(', ')} tourne encore. Autowin redémarrera ` +
              'tout seul quand plus aucun agent ne tournera, après un préavis de 30 s, puis ' +
              'rejouera la consigne dans cette conversation. Termine ton tour normalement : ' +
              'ne demande rien à l’utilisateur.'
          }
        }
        return {
          redemarre: false,
          attend,
          detail:
            `Redémarrage non lancé : ${attend.join(', ')} tourne encore et cette instance n’a ` +
            'pas de file de redémarrage (version installée ou relance automatique désactivée). ' +
            'Redémarrer maintenant couperait ce travail : c’est à l’utilisateur de choisir.'
        }
      }
      const reprise = poserReprise(ensureAutowinAppData(), contenuReprise)
      // Le quit part APRES la reponse : sans ce delai, le tour se termine dans un process deja
      // mort et l'utilisateur ne voit jamais l'accuse de redemarrage.
      const relancer = bus.redemarrerApp
      // La cause de l'arret, ecrite dans le journal des arrets : sans elle, ce redemarrage
      // ressemble a n'importe quelle autre fermeture propre.
      annoncerFermeture(cause)
      setTimeout(() => relancer(), 1200)
      return {
        redemarre: true,
        conversationId: cible,
        consigne: reprise.consigne,
        detail: 'Redémarrage en cours — la consigne sera rejouée dans cette conversation.'
      }
    }
    case 'bureau_cache_fermer': {
      // Le fil est celui de l'appel, jamais un argument : un `conversationId` glissé dans `a`
      // est ignoré, sinon le modèle pourrait se dire d'un autre fil pour fermer son bureau.
      const fil = conversationId ?? bus.activeConversationId ?? ''
      if (!fil) {
        return {
          ferme: false,
          detail:
            'Fermeture refusée : aucune conversation courante — impossible de savoir quels bureaux sont les tiens.'
        }
      }
      if (!bus.fermerBureauCache) {
        return {
          ferme: false,
          detail: 'Fermeture indisponible : aucun lanceur de scripts câblé dans ce processus.'
        }
      }
      const id = s('id').trim() || identifiantBureauCacheChat(fil)
      const delai =
        a.delaiDouxSecondes === undefined || a.delaiDouxSecondes === ''
          ? undefined
          : Number(a.delaiDouxSecondes)
      const r = await bus.fermerBureauCache({
        id,
        conversationId: fil,
        ...(delai !== undefined ? { delaiDouxSecondes: delai } : {})
      })
      const detail = r.ok
        ? r.dejaFerme
          ? `Bureau ${id} : rien ne tournait, la fiche est retirée.`
          : `Bureau ${id} fermé (${r.fermesDoucement?.length ?? 0} en douceur, ${r.forces?.length ?? 0} forcé(s)).`
        : `Bureau ${id} non fermé (code ${r.code ?? '?'}) : ${r.erreur ?? 'raison inconnue'}`
      return { ...r, id, detail }
    }
    case 'reload_env':
      // La valeur lue chez l'OS atterrit dans le `process.env` DU processus principal : le
      // reglage prend effet au prochain appel qui le lit, sans redemarrage.
      return rechargerEnv(a.nom)
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
