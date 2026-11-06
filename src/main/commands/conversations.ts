// Groupe de commandes « fils de conversation et tri des travaux », sorti de AppCommandBus.run (lot 2).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { entierEnvoye, listeEnvoyee, booleenEnvoye } from './arguments'
import { TRANCHE_MESSAGE_LU } from './catalogue'
import { titreDeConversationDemandee, conversationRecenteEquivalente } from '../conversations/conversation-demandee'
import { collectAutowinKaizenEvidence, PLAFONDS_AMPLES } from '../kaizen/autowin-kaizen-context'
import { paginerDossier, dedupliquerDossier, resumerAppelsOutils } from '../kaizen/retrospective-compacte'
import { porteDesPiecesJointes, referencesDesPiecesJointes } from '../store/pieces-jointes-orchestration'
import { questionPoseeDuMessage } from '../chat/question-posee'
import { LOT_SUPPRESSION_MAX } from '../store/conversations'

/** Cas de `AppCommandBus.run` : fils de conversation et tri des travaux. Corps déplacé tel quel depuis commands.ts (lot 2). */
export async function executerConversations(
  bus: AppCommandBus,
  name: string,
  a: Record<string, unknown>,
  conversationId?: string
): Promise<unknown> {
  const s = (k: string): string => String(a[k] ?? '')
  switch (name) {
    case 'create_conversation': {
      // L'argument s'appelle encore `category` (contrat d'agent, cf. catalogue) ; il ALIMENTE
      // desormais le seul champ persiste, `provider`.
      const provider = s('category') || 'claude'
      // Le titre n'est plus INVENTE par le modele : a defaut d'un titre explicite, on reprend
      // les mots que l'utilisateur vient d'ecrire (defaut du 2026-09-01).
      const dernierMessageUtilisateur = [
        ...(bus.os.conversations.get?.(conversationId ?? '')?.messages ?? [])
      ]
        .reverse()
        .find((message) => message.role === 'user')?.content
      const title = titreDeConversationDemandee(
        a.title,
        typeof dernierMessageUtilisateur === 'string' ? dernierMessageUtilisateur : ''
      )
      // Un second envoi identique a quelques secondes d'intervalle est le MEME geste : il rend
      // la conversation deja creee au lieu d'en empiler une vide.
      const dejaCreee = conversationRecenteEquivalente(bus.os.conversations.list?.() ?? [], {
        title,
        provider,
        maintenant: Date.now()
      })
      if (dejaCreee) return { ...dejaCreee, reprise: true }
      const c = bus.os.conversations.create({ title, provider })
      bus.broadcast({ type: 'refresh', scope: 'conversations' })
      return c
    }
    case 'classer_conversation': {
      // fix-ok: la commande classer_conversation écrivait le libellé dans le dossier de travail ; elle route désormais sur la forme de la valeur et rend les DEUX champs.
      const dossier = typeof a.dossier === 'string' ? a.dossier.trim() : ''
      const c = bus.os.conversations.rangerDansDossier(s('id'), dossier || null)
      if (!c) throw new Error(`conversation introuvable: ${s('id')}`)
      bus.broadcast({ type: 'refresh', scope: 'conversations' })
      // Les DEUX champs sont rendus : le magasin route sur la forme de la valeur, et un agent qui
      // ne lirait que `dossier` conclurait « rien n'a ete range » apres avoir pose une categorie.
      return {
        id: c.id,
        titre: c.title,
        dossier: c.projectPath ?? null,
        categorie: c.categorie ?? null
      }
    }
    case 'retrospective': {
      const id = s('id')
      const conversation = bus.os.conversations.get(id)
      // Une conversation absente est un ECHEC franc. Rendre un dossier vide ferait conclure
      // « il ne s'est rien passe » sur un identifiant simplement faux -- la conclusion inverse
      // de celle qu'une retrospective doit produire.
      if (!conversation) throw new Error(`Conversation introuvable: ${id}`)
      /*
       * REGIME AMPLE. Ce dossier ne part dans AUCUN prompt de sous-agent : il est rendu a
       * l'agent qui lit. Les plafonds serres de `/kaizen` (80 evenements causaux, 4 RUN.md,
       * 3 tours de journal) sont un budget de prompt, pas une verite sur ce qui s'est passe :
       * appliques ici, ils faisaient repondre « voila ce qui s'est passe » sur un echantillon
       * muet de son propre echantillonnage.
       */
      const dossier = collectAutowinKaizenEvidence(conversation, undefined, PLAFONDS_AMPLES)
      // Renvois « identique au tour N » puis pages de ~20 000 caracteres : un fil passait de
      // 363 064 caracteres a un dossier lisible en quelques pages (retrospective-compacte.ts).
      const decoupe = paginerDossier(
        JSON.stringify(dedupliquerDossier(resumerAppelsOutils(dossier))),
        Number(a.page)
      )
      return {
        page: decoupe.page,
        pages: decoupe.pages,
        dossier: decoupe.contenu,
        suite: decoupe.note,
        resume:
          `${dossier.conversation.messages.length} message(s), ` +
          `${dossier.causalEvents.length} evenement(s) causal(aux), ` +
          `${dossier.activity.length} entree(s) d'activite, ${dossier.runs.length} RUN.md, ` +
          `${dossier.promptCalls?.length ?? 0} appel(s) modele, ` +
          `${dossier.turnEvents?.length ?? 0} evenement(s) de tour. ` +
          `Lecture large (plafonds: ${PLAFONDS_AMPLES.trace} evenements causaux, ` +
          `${PLAFONDS_AMPLES.runs} RUN.md, ${PLAFONDS_AMPLES.promptCalls} appels modele) : ` +
          `si un compte touche exactement son plafond, le reste a ete coupe. ` +
          `Lecture seule : aucun run lance.`
      }
    }
    case 'conversation_search': {
      const terme = s('terme')
      const limite = Math.min(50, entierEnvoye(a.limite, 'limite', 1) ?? 10)
      const decalage = entierEnvoye(a.decalage, 'decalage', 0) ?? 0
      // Le store plafonne à 50 et classe tout avant de couper : lui demander ce plafond ne coûte
      // rien de plus, et c'est ce qui permet de dire ce qui n'est pas rendu.
      const toutes = bus.os.conversations.search(terme, {
        limite: 50,
        extraitsParConversation: entierEnvoye(a.extraits, 'extraits', 1)
      })
      const trouvees = toutes.slice(decalage, decalage + limite)
      const restantes = Math.max(0, toutes.length - decalage - trouvees.length)
      // Le vide est DIT comme un vide, jamais rendu en silence : un agent qui recoit une liste
      // vide sans phrase conclut qu'il a mal appele l'outil, et retente au lieu d'elargir.
      //
      // Les pieces jointes sont ANNONCEES des la recherche : un extrait textuel ne montre pas
      // qu'une conversation porte une image, et l'agent n'a alors aucune raison de l'ouvrir pour
      // ca. Dire « il y a des pieces jointes ici » est ce qui declenche la lecture.
      const avecJointes = trouvees
        .filter((trouvee) =>
          porteDesPiecesJointes(bus.os.conversations.get(trouvee.id)?.messages ?? [])
        )
        .map((trouvee) => trouvee.id)
      return {
        terme,
        conversations: trouvees,
        restantes,
        note:
          toutes.length === 0
            ? `Aucune conversation ne contient « ${terme} ». Essaie un terme plus court ou un synonyme.`
            : trouvees.length === 0
              ? `Rien apres le decalage ${decalage} : ${toutes.length} conversation(s) trouvee(s) en tout.`
              : `${trouvees.length} conversation(s) portent « ${terme} » ; ouvre-les avec conversation_read.` +
                (restantes > 0
                  ? ` ${restantes} autre(s) non rendue(s) : relance avec decalage: ${decalage + trouvees.length}.`
                  : '') +
                (toutes.length >= 50
                  ? ' La recherche s arrete aux 50 meilleures : precise le terme pour aller au-dela.'
                  : '') +
                (avecJointes.length
                  ? ` ${avecJointes.length} d'entre elles portent des pieces jointes (${avecJointes.join(', ')}) : conversation_read en rend les chemins lisibles.`
                  : '')
      }
    }
    case 'conversation_read': {
      const id = s('id')
      const conversation = bus.os.conversations.get(id)
      // Une conversation absente est un ECHEC franc : rendre « 0 message » laisserait l'agent
      // conclure qu'elle est vide alors qu'il s'est trompe d'identifiant.
      if (!conversation) throw new Error(`Conversation introuvable: ${id}`)
      const tous = conversation.messages ?? []
      const CAP_PAR_MESSAGE = 4000
      const demandes = entierEnvoye(a.derniers, 'derniers', 1)
      const avant = entierEnvoye(a.avant, 'avant', 0)
      const positionLue = entierEnvoye(a.message, 'message', 0)
      const depuis = entierEnvoye(a.depuis, 'depuis', 0)
      /*
       * LIRE UN MESSAGE EN ENTIER (2026-10-31) : un message coupé à 4 000 caractères
       * n'avait aucune suite atteignable. Même raison pour `avant` plus bas : au-delà des N
       * derniers, le début d'un fil était hors de portée, et il fallait fouiller le disque.
       */
      if (positionLue !== undefined) {
        if (demandes !== undefined || avant !== undefined)
          throw new Error(
            '`message` lit un seul message : retire `derniers` et `avant`, ou retire `message`.'
          )
        const message = tous[positionLue]
        if (!message)
          throw new Error(
            `\`message\` ${positionLue} hors du fil : ${tous.length} message(s), positions 0 a ${tous.length - 1}.`
          )
        const texte = typeof message.content === 'string' ? message.content : ''
        const debutLu = depuis ?? 0
        if (debutLu > texte.length)
          throw new Error(
            `\`depuis\` ${debutLu} au-dela de la fin : ce message fait ${texte.length} caractere(s).`
          )
        const finLue = debutLu + TRANCHE_MESSAGE_LU
        const resteCaracteres = Math.max(0, texte.length - finLue)
        return {
          id: conversation.id,
          position: positionLue,
          role: message.role,
          ts: message.ts,
          depuis: debutLu,
          longueurReelle: texte.length,
          text: texte.slice(debutLu, finLue),
          resteCaracteres,
          ...(resteCaracteres > 0 ? { suite: finLue } : {}),
          note:
            resteCaracteres > 0
              ? `${resteCaracteres} caractere(s) restent : relance avec message: ${positionLue}, depuis: ${finLue}.`
              : 'Fin du message.'
        }
      }
      if (depuis !== undefined)
        throw new Error('`depuis` ne va qu’avec `message`, la position du message a lire.')
      const combien = Math.min(200, demandes ?? 20)
      const fin = Math.min(tous.length, avant ?? tous.length)
      const debut = Math.max(0, fin - combien)
      const messages = tous.slice(debut, fin).map((message, rang) => {
        const position = debut + rang
        const texte = typeof message.content === 'string' ? message.content : ''
        const coupe = texte.length > CAP_PAR_MESSAGE
        /*
         * LES PIECES JOINTES TRAVERSENT LA LECTURE — elles ne la traversaient pas.
         *
         * Test delibere de l'utilisateur le 2026-08-27 : image jointe dans une conversation,
         * question posee depuis une AUTRE « expres, pour voir si la knowledge traversait ».
         * Cette fonction rendait le seul `text` : l'agent lisait un fil ou l'image etait
         * mentionnee sans etre atteignable, et concluait qu'il ne pouvait rien en dire. Le
         * binaire etait pourtant sur le disque depuis l'envoi. Il suffisait de le DIRE — le
         * meme geste, la meme fonction, que pour le tour courant et l'orchestration.
         */
        const jointes = referencesDesPiecesJointes(message)
        /*
         * L'ECHEC D'UN TOUR TRAVERSE LA LECTURE — il ne la traversait pas.
         *
         * Mesure le 2026-09-03 : trois tours coupes sur `error_during_execution`. Le
         * store portait bien `status: 'failed'` et `error` (ecrits par `terminalDuTour`), mais
         * cette projection ne rendait que `role`/`ts`/`text` : un tour EN ECHEC se relisait comme
         * une reponse VIDE, indiscernable d'un silence du modele. Toute retrospective partait
         * donc chercher la cause ailleurs. Ce que l'app SAIT de l'echec doit etre DIT.
         */
        const statut = (message as { status?: string }).status
        const erreur = (message as { error?: string }).error
        // Un tour fini sur une question ATTEND l'utilisateur — ça doit se lire.
        const questionPosee = questionPoseeDuMessage(message)
        return {
          position,
          role: message.role,
          ts: message.ts,
          ...(statut && statut !== 'done' ? { statut } : {}),
          ...(erreur ? { erreur } : {}),
          ...(questionPosee ? { questionPosee } : {}),
          text: coupe ? texte.slice(0, CAP_PAR_MESSAGE) : texte,
          ...(coupe
            ? {
                tronque: true,
                longueurReelle: texte.length,
                suite: `relance avec message: ${position}, depuis: ${CAP_PAR_MESSAGE}`
              }
            : {}),
          ...(jointes.length ? { piecesJointes: jointes } : {})
        }
      })
      // Ce qui est coupe est DIT : une troncature muette ferait analyser un extrait comme s'il
      // etait le tout — la conclusion fausse qu'une retrospective doit precisement eviter.
      const coupes = messages.filter((message) => message.tronque).length
      const toutesJointes = messages.flatMap((message) => message.piecesJointes ?? [])
      const lisibles = toutesJointes.filter((jointe) => jointe.chemin).length
      const perdues = toutesJointes.length - lisibles
      return {
        id: conversation.id,
        title: conversation.title,
        // `category` a ete retire du contrat le 2026-08-18 (doublon toujours egal a `provider`) :
        // le dossier de classement est `projectPath`.
        provider: conversation.provider,
        ...(conversation.projectPath ? { projectPath: conversation.projectPath } : {}),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: tous.length,
        // Un script qui attend la fin de SON tour n'avait que `get_state` (tous les
        // fils). Même autorité et même forme que là-bas : présent seulement quand ça tourne.
        ...(bus.tourDeChatActif?.(conversation.id) ? { tourEnCours: true } : {}),
        messages,
        restentAvant: debut,
        restentApres: tous.length - fin,
        note:
          `${tous.length} message(s) au total, ${messages.length} rendu(s)` +
          (messages.length > 0 ? ` (positions ${debut} a ${fin - 1})` : '') +
          (coupes > 0
            ? `, ${coupes} tronque(s) a ${CAP_PAR_MESSAGE} caracteres (leur champ \`suite\` dit comment lire le reste)`
            : '') +
          (debut > 0 ? `. ${debut} plus ancien(s) restent : relance avec avant: ${debut}` : '') +
          (fin < tous.length ? `. ${tous.length - fin} plus recent(s) non rendu(s)` : '') +
          (lisibles > 0
            ? `. ${lisibles} piece(s) jointe(s) LISIBLE(S) : ouvre le champ 'chemin' avec Read avant de repondre a leur sujet — ne devine jamais leur contenu.`
            : '') +
          (perdues > 0
            ? `. ${perdues} piece(s) jointe(s) mentionnee(s) mais introuvable(s) sur le disque : dis-le franchement plutot que d'inventer.`
            : '')
      }
    }
    case 'rename_conversation': {
      // Rend le titre RELU, ou echoue franchement : un retour vide poussait a rejouer l'appel.
      const c = bus.os.conversations.rename(s('id'), s('title'))
      if (!c) throw new Error(`rename_conversation : ${s('id')} inconnue, rien n a ete renomme`)
      bus.broadcast({ type: 'refresh', scope: 'conversations' })
      return c
    }
    case 'remove_conversation': {
      const id = s('id')
      // Comme le Stop : le tour et le run du fil s'arrêtent AVANT qu'il disparaisse.
      await bus.arreterAvantSuppression(id, conversationId)
      const removed = bus.os.conversations.remove(id)
      if (removed) {
        bus.onConversationRemoved?.(id)
        bus.broadcast({ type: 'refresh', scope: 'conversations' })
      }
      return { removed }
    }
    case 'remove_conversations': {
      const brut = listeEnvoyee(a.ids, 'remove_conversations : ids doit etre une liste')
      const ids = brut.map((v) => String(v))
      // removeMany REFUSE au-dela du plafond AVANT toute suppression : rien de partiel. Le même
      // refus passe ici AVANT l'arrêt des fils, sinon un lot refusé aurait déjà coupé leur travail.
      if (ids.length > LOT_SUPPRESSION_MAX) {
        throw new Error(`lot de suppression trop grand : ${ids.length} > ${LOT_SUPPRESSION_MAX}`)
      }
      for (const id of ids) await bus.arreterAvantSuppression(id, conversationId)
      const removed = bus.os.conversations.removeMany(ids)
      for (const id of removed) bus.onConversationRemoved?.(id)
      if (removed.length > 0) bus.broadcast({ type: 'refresh', scope: 'conversations' })
      return { removed, count: removed.length }
    }
    case 'attach_run': {
      const convId =
        (a.conversationId
          ? s('conversationId')
          : (conversationId ?? bus.activeConversationId)) ?? ''
      if (!convId) throw new Error('aucune conversation active pour attacher le run')
      const path = s('path')
      const c = bus.os.conversations.attachRun(convId, path)
      return { conversation: c.id, runPaths: c.runPaths }
    }
    case 'load_graph': {
      const brain = bus.os.listBrains().find((b) => b.id === s('brainId'))
      if (!brain) throw new Error(`brain inconnu: ${s('brainId')}`)
      const g = bus.os.loadBrainGraph(brain.path, 300)
      bus.broadcast({ type: 'navigate', tab: 'memory' })
      return { brain: brain.id, nodes: g.nodes.length, links: g.links.length }
    }
    case 'marquer_travail_trie': {
      const agentId = s('agentId').trim()
      if (!agentId) throw new Error('`agentId` est requis.')
      const worktrees = bus.os.worktrees
      if (!worktrees?.marquerTravailTrie) {
        throw new Error('Le recensement des travaux non publiés est indisponible.')
      }
      if (booleenEnvoye(a.oublier, 'oublier')) {
        const oublie = worktrees.oublierTravailTrie?.(agentId) === true
        return { agentId, trie: false, oublie }
      }
      const marque = worktrees.marquerTravailTrie(agentId)
      if (!marque) {
        // Un identifiant qu'aucune branche, aucun sauvetage et aucun bureau ne porte : le dire,
        // plutot que de rendre un acquittement qui ne protege rien.
        throw new Error(
          `Aucun travail trouvable sous « ${agentId} » : rien n’a été marqué. Vérifie l’identifiant dans get_state.travauxNonPublies.`
        )
      }
      return { agentId, trie: true, sha: worktrees.shaTravailTrie?.(agentId) }
    }
    case 'confirmer_verdict_juge': {
      const runId = String(a.runId ?? '').trim()
      if (!runId) throw new Error('confirmer_verdict_juge : runId manquant')
      const verite = String(a.verite ?? '').trim()
      if (verite !== 'green' && verite !== 'red') {
        throw new Error('confirmer_verdict_juge : verite doit valoir "green" ou "red"')
      }
      // Un runId inconnu n'est PAS une erreur : on rend 0 et on le dit, comme le lot de tri.
      const reetiquetes = bus.os.confirmerVerdictJuge(runId, verite)
      return { runId, verite, reetiquetes, connu: reetiquetes > 0 }
    }
    case 'marquer_travaux_tries': {
      const brut = listeEnvoyee(a.ids, 'marquer_travaux_tries : ids doit etre une liste')
      // Plafond aligne sur `remove_conversations` : refuse AVANT d'ecrire quoi que ce soit.
      if (brut.length > 200)
        throw new Error(`marquer_travaux_tries : ${brut.length} ids demandés, 200 au maximum.`)
      const worktrees = bus.os.worktrees
      if (!worktrees?.marquerTravailTrie) {
        throw new Error('Le recensement des travaux non publiés est indisponible.')
      }
      const demandes = [...new Set(brut.map((v) => String(v).trim()).filter(Boolean))]
      const marques: string[] = []
      const introuvables: string[] = []
      const shas: Record<string, string> = {}
      for (const agentId of demandes) {
        // On AGREGE au lieu de lever : un identifiant perime ne doit pas annuler le tri des
        // autres, sinon le lot est plus fragile que les appels un par un qu'il remplace.
        if (worktrees.marquerTravailTrie(agentId)) {
          marques.push(agentId)
          const sha = worktrees.shaTravailTrie?.(agentId)
          if (sha) shas[agentId] = sha
        } else {
          introuvables.push(agentId)
        }
      }
      return { marques, introuvables, shas, count: marques.length }
    }
    default:
      throw new Error(`commande inconnue: ${name}`)
  }
}
