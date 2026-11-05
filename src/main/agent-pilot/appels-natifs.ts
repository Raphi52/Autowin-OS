// Outils directs du modèle (`chat-mcp.ts`) pendant un tour de chat, et la comptabilité commune à
// toute commande exécutée — texte `<cmd>` comme appel direct. Sortis tels quels de
// AgentPilot.chat() (conv-1580, lot 3) : ils lisent et écrivent l'état du tour qu'on leur passe
// (`etat-du-tour.ts`) au lieu de capturer ses `let`.
import { cleAppelNatif } from '../chat-mcp'
import {
  COMMANDES_DE_CAPTURE,
  cleDEchec,
  commandeAObserveLeReel,
  issueDuVerify,
  signatureDEchec
} from '../chat-turn-messages'
import type { CommandResult } from '../commands'
import { fluxDuBloc, texteDuBlocDansLeFil } from '../montrer-bloc-command'
import { enregistrerMur } from '../runs/murs-store'
import type { ExecutionDeCommande } from './commandes-du-tour'
import type { EtatDuTour } from './etat-du-tour'
import type { PilotEventVariant } from './evenements'
import { commandResultSucceeded, motifDepotMemoireNonAbouti } from './issue-des-commandes'

export interface AppelsNatifsDuTour {
  comptabiliserCommande: (
    nom: string,
    args: Record<string, unknown>,
    r: CommandResult,
    actionId: string
  ) => { reussie: boolean; rejeu: boolean }
  noterUnGeste: () => void
  executerAppelNatif: (nom: string, args: Record<string, unknown>) => Promise<CommandResult>
}

export function appelsNatifsDuTour(entree: {
  etat: EtatDuTour
  conversationId: string | undefined
  provider: string
  signal: AbortSignal | undefined
  emit: (e: PilotEventVariant) => void
  execCommandTolerante: ExecutionDeCommande
}): AppelsNatifsDuTour {
  const { etat, conversationId, provider, signal, emit, execCommandTolerante } = entree
  /**
   * LA COMPTABILITE D'UNE COMMANDE EXECUTEE — commune au texte `<cmd>` et aux outils directs.
   *
   * Extraite telle quelle du chemin `<cmd>` pour que l'appel direct (`chat-mcp.ts`) soit COMPTE
   * exactement pareil : depot de memoire refuse (`refusRememberAuxiliaire`, dit a la cloture),
   * echec non rattrape (bilan `echecs-abandonnes`, reprise apres echec), mur deja rencontre. Une
   * seconde copie de ce bloc divergerait au premier correctif — d'ou une seule fonction.
   * Rend l'issue pour que l'appel direct la reporte sur son iteration (voir plus bas).
   */
  const comptabiliserCommande = (
    nom: string,
    args: Record<string, unknown>,
    r: CommandResult,
    actionId: string
  ): { reussie: boolean; rejeu: boolean } => {
    const commandSucceeded = commandResultSucceeded(r)
    // Ici et pas dans un seul des deux chemins : `<cmd>` et outil direct passent tous deux par
    // cette comptabilite, et une commande en echec (code de sortie non nul) a pu observer.
    if (commandeAObserveLeReel(nom, r)) etat.sortieDeCommandeObservee = true
    if (nom === 'orchestrate') etat.orchestrationLanceeCeTour = true
    if (COMMANDES_DE_CAPTURE.has(nom)) etat.captureRegardeeCeTour = true
    if (nom === 'verify') {
      const issue = issueDuVerify(r.data)
      if (issue) etat.verificationsDuTour.push({ ...issue, at: Date.now() })
      else etat.verifyRefuseCeTour = true
    }
    if (nom === 'remember') {
      // Sur `stored`, PAS sur la reussite du transport : voir motifDepotMemoireNonAbouti.
      // Assignation INCONDITIONNELLE : un depot REJOUE avec succes doit EFFACER le refus
      // precedent, sinon la cloture porterait un « NON deposee » dementi par la reprise.
      etat.refusRememberAuxiliaire = motifDepotMemoireNonAbouti(r)
      if (!etat.refusRememberAuxiliaire) etat.depotMemoireCeTour = true
    }
    /*
     * La clef porte le nom ET LA CIBLE. Avec le nom seul, un `edit_file` reussi sur `b.ts`
     * purgeait l'echec jamais rejoue sur `a.ts` — defaut mesure le 2026-08-22 par deux juges
     * externes independants, et mon commentaire revendiquait alors une garantie que la clef ne
     * pouvait pas donner. `cleDEchec` ne retient que les arguments IDENTIFIANTS, pour qu'une
     * reprise du meme fichier avec un contenu corrige rende la MEME clef.
     */
    const cleCible = cleDEchec(nom, args)
    // Rejouee avec succes sur la MEME cible : l'echec est repare, il ne pese plus sur la cloture.
    if (commandSucceeded) {
      etat.commandesEnEchecNonRattrape.delete(cleCible)
      etat.actionIdParEchec.delete(cleCible)
      return { reussie: true, rejeu: false }
    }
    etat.anyActionFailed = true
    etat.echecDeLaDerniereIteration = true
    etat.commandesEnEchecNonRattrape.add(cleCible)
    etat.actionIdParEchec.set(cleCible, actionId)
    const signature = signatureDEchec(nom, String(r.ok ? JSON.stringify(r.data) : (r.error ?? '')))
    // Le test d'appartenance passe AVANT l'enregistrement, sinon le mur courant serait
    // toujours « deja vu » et la premiere rencontre declencherait l'escalade a tort.
    // AGREGE sur l'iteration : si AU MOINS UN echec de cette iteration est un rejeu connu,
    // l'escalade est due. Ne garder que le dernier perdait silencieusement l'escalade quand
    // une iteration enchainait un mur deja connu PUIS un mur neuf (audit du 2026-08-21).
    const rejeu = etat.signaturesDEchecVues.includes(signature)
    etat.dernierEchecEstUnRejeu = etat.dernierEchecEstUnRejeu || rejeu
    etat.derniereSignatureDEchec = signature
    etat.signaturesDEchecVues.push(signature)
    if (conversationId) {
      try {
        enregistrerMur(conversationId, signature)
      } catch {
        /* best-effort : c'est un cache d'indice, il ne doit jamais casser le tour */
      }
    }
    return { reussie: false, rejeu }
  }
  const noterUnGeste = (): void => {
    etat.gesteDansLAppel = true
    etat.texteApresLeDernierGeste = false
  }
  /**
   * UN APPEL DIRECT S'AFFICHE ET COMPTE EXACTEMENT COMME UN `<cmd>` : carte, progression, resultat,
   * capture publiee dans le fil, drapeaux du tour (action, lecture, bureau) et comptabilite commune.
   * Sans eux, les gardes de cloture (« rien execute », « echec tu », « fais le geste ») mordaient a
   * tort ou se taisaient. Seule difference : la capture n'est pas rejointe au message suivant, le
   * modele l'a deja recue en bloc `image` dans le resultat de l'outil.
   */
  const executerAppelNatif = async (
    nom: string,
    args: Record<string, unknown>
  ): Promise<CommandResult> => {
    signal?.throwIfAborted()
    // Marquee AVANT l'execution : un `<cmd>` identique ne doit pas la rejouer, meme en echec.
    etat.executesParCanalNatif.add(cleAppelNatif(nom, args))
    const actionId = `natif:${etat.iterationNatif}:${etat.appelNatifIndex++}`
    etat.anyActionExecuted = true
    if (nom === 'desktop_act' || nom === 'desktop_observe') etat.bureauUtilise = true
    if (nom === 'list_files' || nom === 'read_file' || nom === 'find_in_files') {
      etat.anyReadExecuted = true
    }
    emit({ kind: 'command', actionId, name: nom, args })
    noterUnGeste()
    const r = await execCommandTolerante(nom, args, (text) =>
      emit({ kind: 'action-progress', actionId, text })
    )
    let indexCapture = 0
    for (const piece of r.attachments ?? []) {
      if (piece.kind !== 'image' || !piece.content) continue
      emit({
        kind: 'artifact',
        iteration: etat.iterationNatif,
        artifact: {
          id: `tool-capture-${actionId}-${indexCapture++}-${piece.name}`,
          name: piece.name,
          mimeType: piece.mimeType,
          kind: 'image',
          size: piece.size,
          createdAt: Date.now(),
          encoding: 'base64',
          content: piece.content,
          source: { provider, tool: nom }
        }
      })
    }
    const echecRattrape = commandResultSucceeded(r)
      ? etat.actionIdParEchec.get(cleDEchec(nom, args))
      : undefined
    emit({
      kind: 'result',
      actionId,
      name: nom,
      ok: commandResultSucceeded(r),
      data: r.ok ? r.data : r.error,
      ...(echecRattrape ? { retryOf: echecRattrape } : {}),
      ...(r.attachments?.length ? { attachments: r.attachments } : {})
    })
    // `montrer_bloc` (conv-1306) : le bloc lu dans un fichier entre dans la réponse du fil, sur
    // son propre flux, sans repasser par le modèle IA.
    for (const [index, bloc] of (r.blocs ?? []).entries())
      emit({
        kind: 'delta',
        streamId: fluxDuBloc(`${actionId}:${index}`),
        text: texteDuBlocDansLeFil(bloc),
        iteration: etat.iterationNatif
      })
    const compte = comptabiliserCommande(nom, args, r, actionId)
    if (compte.reussie) etat.echecsNatifsNonRattrapes.delete(cleDEchec(nom, args))
    else {
      etat.echecsNatifsNonRattrapes.add(cleDEchec(nom, args))
      if (compte.rejeu) etat.rejeuNatifCetteIteration = true
    }
    etat.echecNatifCetteIteration = etat.echecsNatifsNonRattrapes.size > 0
    // `comptabiliserCommande` leve aussi le drapeau de l'iteration au premier rouge. Pendant
    // l'envoi, il ne porte que les appels directs (remis a plat au debut de l'iteration) : il suit
    // donc le meme registre, sinon le vert d'une reprise sur place ne le baisserait jamais.
    etat.echecDeLaDerniereIteration = etat.echecNatifCetteIteration
    return r
  }
  return { comptabiliserCommande, noterUnGeste, executerAppelNatif }
}
