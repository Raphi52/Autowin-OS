/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity, react-hooks/set-state-in-effect -- (conv-1508) le code de ce fichier vient de ChatView.tsx, déplacé tel quel. Ces règles du compilateur React ne s'y appliquaient pas : il renonçait à analyser le composant de 10 000 lignes (lint vert sur le même code avant la découpe). Les rendre vraies demande de CHANGER le code, hors de cette découpe sans changement de comportement. */
import type { AsstMsg, ChatAttachment } from './chat-view-types'
import { useRef, useMemo, useCallback, useState, useEffect } from 'react'
import { type ChatComposerHandle, ChatComposer } from './ChatComposer'
import {
  texteFil,
  ghostDuFil,
  propositionsDuFil,
  IconeInfini,
  traceSilentFailure,
  ecrireDossiersRetires
} from './chat-view-outils'
import { formatFileSize } from './chat-attachments'
import { parseBtw } from './chat-view-model'
import { askEnAttente } from './chat-message-keys'
import { faconsDuMemeEssai } from './trois-facons'
import { type ChatMosaicWindow } from './ChatMosaic'
import { trierParRecenceUtilisateur, searchConversations } from './conversation-search'
import { canoniserReplis } from './conversation-groups'
import {
  lireDossiersDuChat,
  lireDossiersRetires,
  CLE_DOSSIERS_CONNUS,
  transmettreDossiersDuChat,
  CLE_DOSSIERS_RETIRES,
  EVT_DOSSIERS_DU_CHAT
} from './dossiers-du-chat'
import { cleDeDossier } from '../../../shared/board-dossiers-du-chat'
import { estCheminDeDossier } from '../../../shared/project-path'
import { sansDossierRetire, avecDossierRetire } from './chat-dossiers-import'

// Extrait de ChatView.tsx tel quel, sans changement de comportement (conv-1508).
export type RenduMosaiqueCtx = {
  activeId: string | null
  addFiles: (
    files: FileList | File[],
    cible?: string | undefined,
    cleDeDoublon?: (fichier: { name: string; size: number }) => string
  ) => Promise<void>
  autoConvs: Set<string>
  basculerModeAutoPour: (cible: string | null) => void
  busy: boolean
  busyConversations: Set<string>
  busyConversationsRef: React.RefObject<Set<string>>
  composerDraftKeyRef: React.RefObject<string>
  composerRef: React.RefObject<import('./ChatComposer').ChatComposerHandle | null>
  conversationDateOrder: 'desc' | 'asc'
  convQuery: string
  convs: import('./chat-view-types').Conv[]
  depotPresent: boolean
  draftsVersion: number
  fermerFenetreMosaique: (id: string) => void
  getComposerDraft: (key: string) => import('./chat-view-types').ComposerDraft
  interruptingConversations: Set<string>
  mentionSources: import('./chat-mentions').MentionSources
  messages: import('./chat-view-types').Msg[]
  mosaicFils: Record<string, import('./chat-view-types').Msg[]>
  mosaicIds: string[]
  nouvelleFenetreMosaique: () => Promise<void>
  ouvrirDansMosaique: (id: string) => Promise<void>
  ouvrirSeuleDepuisMosaique: (id: string) => Promise<void>
  refreshConvs: () => Promise<void>
  send: (
    text?: string | undefined,
    options?: import('./chat-view-types').SendOptions | undefined
  ) => Promise<void>
  sendRef: React.RefObject<
    (
      text?: string | undefined,
      options?: import('./chat-view-types').SendOptions | undefined
    ) => Promise<void>
  >
  setDraftAttachments: (
    key: string,
    update: (
      current: import('./chat-view-types').ChatAttachment[]
    ) => import('./chat-view-types').ChatAttachment[]
  ) => void
  setDraftInput: (key: string, value: string) => void
  setOpenImage: React.Dispatch<React.SetStateAction<{ src: string; name: string } | null>>
  skillCommands: import('./chat-view-model').SlashCommand[]
  stopPilotTurn: (cible?: string | undefined) => void
  submitBtw: (
    body: string,
    repli?: 'btw' | 'normal',
    reponse?: boolean,
    cible?: string | undefined
  ) => Promise<void>
  submitBtwRef: React.RefObject<(prompt: string, cible: string) => void>
}

// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel (conv-1508).
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useRenduMosaique(ctx: RenduMosaiqueCtx) {
  const {
    activeId,
    addFiles,
    autoConvs,
    basculerModeAutoPour,
    busy,
    busyConversations,
    busyConversationsRef,
    composerDraftKeyRef,
    composerRef,
    conversationDateOrder,
    convQuery,
    convs,
    depotPresent,
    draftsVersion,
    fermerFenetreMosaique,
    getComposerDraft,
    interruptingConversations,
    mentionSources,
    messages,
    mosaicFils,
    mosaicIds,
    nouvelleFenetreMosaique,
    ouvrirDansMosaique,
    ouvrirSeuleDepuisMosaique,
    refreshConvs,
    send,
    sendRef,
    setDraftAttachments,
    setDraftInput,
    setOpenImage,
    skillCommands,
    stopPilotTurn,
    submitBtw,
    submitBtwRef
  } = ctx
  /* --- rendu --- */

  const active = convs.find((c) => c.id === activeId)

  const latestAssistant = [...messages]
    .reverse()
    .find((message): message is AsstMsg => message.role === 'assistant')
  // Le composer y ajoute « et rien n'est tapé, aucune pièce jointe » : ces deux-là sont chez lui.
  /**
   * `failed` EST un cas de reprise — mesure du 2026-09-13 : 205 tours en echec contre 119 annules,
   * et « reprend » retape a la main 78 fois, dont 63 juste apres un echec. Le seul geste offert sur
   * un echec (« ↻ Renvoyer ») rejoue le prompt depuis zero et jette le travail partiel ; ce
   * bouton-ci POURSUIT la session (`resumePilotChat`), ce qui est exactement le geste contourne.
   */
  const resumeAvailable =
    !busy &&
    Boolean(activeId) &&
    (latestAssistant?.status === 'cancelled' ||
      latestAssistant?.status === 'interrupted' ||
      latestAssistant?.status === 'failed')
  // « Plus récentes » = là où L'UTILISATEUR a parlé en dernier, pas la dernière touche : ranger une
  // conversation dans un dossier bougeait `updatedAt` et la propulsait en tête (2026-08-18).
  /** Handles des composers de la mosaique — un par fenetre, pour vider le champ apres envoi. */
  const composersMosaiqueRef = useRef(new Map<string, ChatComposerHandle>())

  /**
   * Pieces jointes de CHAQUE brouillon ouvert en mosaique. Recalculees sur `draftsVersion` : la
   * source de verite reste `composerDraftsRef`, on n'en duplique pas une seconde copie.
   */
  const piecesJointesMosaique = useMemo<Record<string, ChatAttachment[]>>(
    () => Object.fromEntries(mosaicIds.map((id) => [id, getComposerDraft(id).attachments])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mosaicIds, draftsVersion]
  )

  /**
   * LE VRAI composer, une instance par fenetre — c'est ce qui garantit zero divergence entre la
   * mosaique et le chat plein : memes palettes `/` et `@`, memes pieces jointes, meme brouillon
   * (`composerDraftsRef` est deja indexe par conversation).
   */
  /** Vide le champ d'UNE fenetre (etat interne du composer + brouillon partage). */
  function viderComposerMosaique(id: string): void {
    composersMosaiqueRef.current.get(id)?.setInput('')
    setDraftInput(id, '')
  }

  /**
   * Pièces jointes EN ATTENTE d'un composer — UN seul rendu pour le chat plein et la mosaïque.
   * Deux copies avaient divergé : la mosaïque montrait l'icône ▤ pour une image collée, là où le
   * chat plein montre sa miniature cliquable (demande du 2026-10-10, conv-167).
   * `retirer` reçoit l'index du fichier à enlever du brouillon de CE composer.
   */
  function rendrePiecesJointesEnAttente(
    fichiers: ChatAttachment[],
    retirer: (index: number) => void
  ): React.ReactNode {
    if (fichiers.length === 0) return null
    return (
      <div className="attachment-list pending">
        {fichiers.map((file, fileIndex) => (
          <span
            className={`attachment-chip${file.kind === 'image' ? ' has-thumb' : ''}`}
            key={`${file.name}-${fileIndex}`}
          >
            {file.kind === 'image' ? (
              <button
                type="button"
                className="attachment-thumb-button"
                aria-label={texteFil('pj.agrandirNom', { nom: file.name })}
                title={texteFil('pj.agrandir')}
                onClick={() =>
                  setOpenImage({
                    src: `data:${file.mimeType};base64,${file.content}`,
                    name: file.name
                  })
                }
              >
                <img
                  className="attachment-thumb"
                  src={`data:${file.mimeType};base64,${file.content}`}
                  alt={file.name}
                />
              </button>
            ) : (
              <span aria-hidden="true">▤</span>
            )}
            <span className="attachment-name">{file.name}</span>
            <small>{formatFileSize(file.size)}</small>
            <button
              type="button"
              onClick={() => retirer(fileIndex)}
              aria-label={texteFil('pj.retirerNom', { nom: file.name })}
              title={texteFil('pj.retirer')}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    )
  }

  function rendreComposerMosaique(id: string): React.ReactNode {
    const occupe = busyConversations.has(id)
    const fichiers = piecesJointesMosaique[id] ?? []
    return (
      <ChatComposer
        ref={(handle) => {
          if (handle) composersMosaiqueRef.current.set(id, handle)
          else composersMosaiqueRef.current.delete(id)
        }}
        busy={occupe}
        hasActiveConversation
        resumeAvailable={false}
        attachmentCount={fichiers.length}
        mentionSources={mentionSources}
        skillCommands={skillCommands}
        ghostRecommendation={ghostDuFil(mosaicFils[id] ?? [], depotPresent)}
        propositionsSuite={propositionsDuFil(mosaicFils[id] ?? [], depotPresent)}
        placeholderPendantTour={occupe}
        onDraftInput={(value) => setDraftInput(id, value)}
        onDraftPresence={() => {}}
        onBtw={() => {
          const parsed = parseBtw(getComposerDraft(id).input)
          if (!parsed.isBtw) return false
          viderComposerMosaique(id)
          void submitBtw(parsed.body, 'btw', false, id)
          return true
        }}
        onSend={() => {
          const texte = getComposerDraft(id).input
          viderComposerMosaique(id)
          void send(texte, { targetConversationId: id })
        }}
        onQueue={() => {
          const texte = getComposerDraft(id).input
          if (!texte.trim() && getComposerDraft(id).attachments.length === 0) return
          viderComposerMosaique(id)
          void submitBtw(texte, 'normal', askEnAttente(mosaicFils[id] ?? []), id)
        }}
        onResume={() => {}}
        onPaste={(files) => void addFiles(files, id)}
        leadingNode={
          <button
            type="button"
            className={`btn composer-auto${autoConvs.has(id) ? ' actif' : ''}`}
            data-testid="mosaic-auto-toggle"
            data-conv={id}
            aria-pressed={autoConvs.has(id)}
            aria-label={texteFil('saisie.auto')}
            onClick={() => basculerModeAutoPour(id)}
            title={texteFil('saisie.auto.mosaique')}
          >
            <IconeInfini />
          </button>
        }
        attachmentsNode={rendrePiecesJointesEnAttente(fichiers, (fileIndex) =>
          setDraftAttachments(id, (current) => current.filter((_, index) => index !== fileIndex))
        )}
        errorNode={
          getComposerDraft(id).error ? (
            <div className="attachment-error">{getComposerDraft(id).error}</div>
          ) : null
        }
        stopNode={
          occupe ? (
            <button
              type="button"
              className="btn composer-stop"
              data-testid="composer-stop"
              onClick={() => stopPilotTurn(id)}
              disabled={interruptingConversations.has(id)}
              title={texteFil('saisie.arreterTour')}
              aria-label={texteFil('saisie.arreterTour')}
            >
              {/* Fenetre etroite : le carre SEUL (demande du 2026-09-04), pas le libelle. */}
              <span className="composer-btn-glyph" aria-hidden="true">
                ■
              </span>
            </button>
          ) : null
        }
      />
    )
  }

  /** Fenetres de la mosaique, dans l'ordre d'ouverture, avec leur fil peint et leur etat occupe. */
  /*
   * « ESSAIE 3 FAÇONS » — LA CARTE DE COMPARAISON (conv-1038, 2026-10-21 — idée 6). Elle s'affiche en
   * haut d'un fil qui est une façon (sa copie s'appelle `essai__…`), et au-dessus de la mosaïque dès
   * qu'une de ses fenêtres en est une. La signature change quand une façon démarre ou finit un tour :
   * la carte relit alors l'écart, les vérifications et le coût.
   * check: ComparaisonDesFacons.test.tsx (7 cas, dont le clic unique qui ne publie rien) et
   * trois-facons.comparaison.test.ts (regroupement par essai) ; typage vérifié par npm run typecheck.
   */
  const faconsDuFilActif = useMemo(
    () => (activeId ? faconsDuMemeEssai(convs, activeId) : []),
    [convs, activeId]
  )
  const faconsDeLaMosaique = useMemo(() => {
    for (const id of mosaicIds) {
      const facons = faconsDuMemeEssai(convs, id)
      if (facons.length > 0) return facons
    }
    return []
  }, [convs, mosaicIds])
  const signatureDesFacons = (facons: readonly { id: string }[]): string =>
    facons
      .map((facon) => {
        const conv = convs.find((candidat) => candidat.id === facon.id)
        return `${facon.id}:${busyConversations.has(facon.id) ? 1 : 0}:${conv?.messageCount ?? ''}:${conv?.lastAssistantStatus ?? ''}`
      })
      .join('|')

  const fenetresMosaique = useMemo<ChatMosaicWindow[]>(
    () =>
      mosaicIds.map((id) => ({
        id,
        title: convs.find((c) => c.id === id)?.title ?? id,
        messages: mosaicFils[id] ?? [],
        busy: busyConversations.has(id)
      })),
    [mosaicIds, mosaicFils, convs, busyConversations]
  )

  /**
   * RAPPELS STABLES POUR LA MOSAIQUE (conv-1581, le gel).
   *
   * `ChatMosaic` memoise chaque fenetre : le memo ne mord QUE si les rappels gardent la meme
   * reference d'un rendu a l'autre. Ces trois-la sont redefinis a chaque rendu de ChatView — d'ou
   * le passage par une ref « derniere version », le meme motif que `forkRef`/`pickRef`.
   */
  const rappelsMosaiqueRef = useRef({
    fermer: fermerFenetreMosaique,
    ouvrirSeule: ouvrirSeuleDepuisMosaique,
    nouvelle: nouvelleFenetreMosaique,
    composer: rendreComposerMosaique,
    ouvrirFil: ouvrirDansMosaique
  })
  rappelsMosaiqueRef.current = {
    fermer: fermerFenetreMosaique,
    ouvrirSeule: ouvrirSeuleDepuisMosaique,
    nouvelle: nouvelleFenetreMosaique,
    composer: rendreComposerMosaique,
    ouvrirFil: ouvrirDansMosaique
  }
  /** Onglet d'un lot pas encore peint dans la case de sa super conv (conv-1305) : on l'ouvre. */
  const ouvrirFilMosaiqueStable = useCallback(
    (id: string) => void rappelsMosaiqueRef.current.ouvrirFil(id),
    []
  )
  const fermerFenetreStable = useCallback((id: string) => rappelsMosaiqueRef.current.fermer(id), [])
  const ouvrirSeuleStable = useCallback(
    (id: string) => void rappelsMosaiqueRef.current.ouvrirSeule(id),
    []
  )
  const nouvelleFenetreStable = useCallback(() => void rappelsMosaiqueRef.current.nouvelle(), [])
  const rendreComposerStable = useCallback(
    (id: string) => rappelsMosaiqueRef.current.composer(id),
    []
  )
  /**
   * REPONDRE A UNE QUESTION DEPUIS UNE FENETRE DE MOSAIQUE (conv-50, 2026-09-01).
   *
   * Meme chemin que la vue plein ecran (`answerAsk`), mais CIBLE sur la conversation de la fenetre :
   * sans ce rappel, la ligne de message etait rendue sans destinataire et le clic ne partait pas.
   */
  const repondreAskMosaiqueStable = useCallback((prompt: string, cible: string) => {
    if (busyConversationsRef.current.has(cible)) void submitBtwRef.current(prompt, cible)
    else void sendRef.current(prompt, { targetConversationId: cible })
  }, [])
  /**
   * Bouton de choix d'une page interactive (conv-1304, voir saisie-du-fil.ts) : il REMPLIT la
   * saisie, comme « Reprendre en précisant… », et ne l'envoie jamais.
   */
  const remplirSaisieRef = useRef<(texte: string, cible?: string) => void>(() => {})
  remplirSaisieRef.current = (texte, cible) => {
    if (cible === undefined) {
      setDraftInput(composerDraftKeyRef.current, texte)
      requestAnimationFrame(() => composerRef.current?.focusAt(-1))
      return
    }
    // Fenêtre de mosaïque : c'est SA saisie qui reçoit le texte (brouillon indexé par fil).
    setDraftInput(cible, texte)
    const composer = composersMosaiqueRef.current.get(cible)
    composer?.setInput(texte)
    requestAnimationFrame(() => composer?.focusAt(-1))
  }
  const remplirSaisie = useCallback((texte: string) => remplirSaisieRef.current(texte), [])
  const remplirSaisieMosaique = useCallback(
    (texte: string, cible: string) => remplirSaisieRef.current(texte, cible),
    []
  )
  /**
   * Ce qui oblige un composer a se redessiner SANS passer par `fenetre` : brouillons et pieces
   * jointes (`draftsVersion`), palettes `@` et `/`. Le fil et l'etat occupe, eux, sont deja dans
   * `fenetre` — donc absents d'ici a dessein.
   */
  const versionMentionsRef = useRef(0)
  const mentionsPrecedentesRef = useRef(mentionSources)
  if (mentionsPrecedentesRef.current !== mentionSources) {
    mentionsPrecedentesRef.current = mentionSources
    versionMentionsRef.current += 1
  }
  const signatureComposerMosaique = `${draftsVersion}|${versionMentionsRef.current}|${skillCommands.length}`

  /**
   * Ce que le RENDERER ne peut pas savoir : quelles conversations CONTIENNENT le terme.
   *
   * La liste laterale est une projection sans `messages` (`ConversationSummary`) -- chercher
   * localement ne voyait donc que le titre, c'est-a-dire le debut du premier prompt. Le processus
   * principal, lui, a tout le corpus en memoire : on lui demande la carte id -> extrait.
   */
  const [correspondancesContenu, setCorrespondancesContenu] = useState<Map<string, string>>(
    () => new Map()
  )
  useEffect(() => {
    const terme = convQuery.trim()
    if (!terme) {
      setCorrespondancesContenu(new Map())
      return
    }
    // Le pont peut ne pas exposer ce canal (preload ancien, harnais de test) : la liste doit alors
    // rester utilisable en recherche locale, pas jeter une exception depuis un timer.
    const chercherContenu = window.api?.conversationsSearchContent
    if (typeof chercherContenu !== 'function') return
    let annule = false
    // Anti-rebond : une frappe ne doit pas declencher un parcours du corpus par caractere.
    const minuterie = setTimeout(() => {
      void Promise.resolve()
        .then(() => chercherContenu(terme))
        .then((resultats) => {
          if (annule) return
          setCorrespondancesContenu(new Map(resultats.map((r) => [r.id, r.extrait])))
        })
        .catch(() => {
          // Une recherche de contenu indisponible ne doit pas casser la liste : on retombe sur la
          // recherche locale (titre / id), qui reste juste, seulement moins large.
          if (!annule) setCorrespondancesContenu(new Map())
        })
    }, 160)
    return () => {
      annule = true
      clearTimeout(minuterie)
    }
  }, [convQuery])

  /**
   * FILTRE PAR STATUT (demande du 2026-09-23) : statut MANUEL posé par le menu « Archiver /
   * Désarchiver » (`Conversation.inactive`, absent = active). Libellés renommés le 2026-10-13
   * (conv-926) ; la valeur interne `inactives` reste pour ne pas perdre le choix déjà mémorisé.
   * Memorise comme la densite : c'est une preference d'affichage locale.
   */
  const [convStatusFilter, setConvStatusFilter] = useState<'toutes' | 'actives' | 'inactives'>(
    () => {
      const v = window.localStorage.getItem('autowin.chat.conversationsStatusFilter')
      return v === 'actives' || v === 'inactives' ? v : 'toutes'
    }
  )
  useEffect(() => {
    window.localStorage.setItem('autowin.chat.conversationsStatusFilter', convStatusFilter)
  }, [convStatusFilter])

  const conversationHits = useMemo(() => {
    const hits = trierParRecenceUtilisateur(
      searchConversations(convs, convQuery, undefined, correspondancesContenu),
      conversationDateOrder
    )
    if (convStatusFilter === 'toutes') return hits
    const veutActives = convStatusFilter === 'actives'
    return hits.filter((h) => (h.conversation.inactive !== true) === veutActives)
  }, [convs, convQuery, conversationDateOrder, correspondancesContenu, convStatusFilter])

  /**
   * Repli des groupes, PERSISTÉ. Le redéplier à chaque ouverture annulerait tout le bénéfice :
   * l'utilisateur replie « Auto-kaizen » pour ne plus le voir, pas pour le refermer chaque matin.
   * `localStorage` et non le store disque : c'est une préférence d'affichage locale, elle n'a rien à
   * faire dans `conversations.json` que d'autres chemins relisent.
   */
  const [groupesReplies, setGroupesReplies] = useState<Record<string, boolean>>(() => {
    try {
      const brut = localStorage.getItem('autowin.conv-groups.collapsed')
      // Canonise a la LECTURE : un etat enregistre avant la canonisation des chemins porte encore
      // `C:/Clients`, alors que le groupe s'appelle desormais `C:\Clients`. Sans cela, tout se deplie.
      return brut ? canoniserReplis(JSON.parse(brut) as Record<string, boolean>) : {}
    } catch {
      // Un JSON corrompu ne doit pas empêcher la liste de s'afficher : on repart des défauts.
      return {}
    }
  })
  const basculerGroupe = useCallback((key: string, replieActuel: boolean): void => {
    setGroupesReplies((courant) => {
      const suivant = { ...courant, [key]: !replieActuel }
      try {
        localStorage.setItem('autowin.conv-groups.collapsed', JSON.stringify(suivant))
      } catch (error) {
        // Quota plein ou stockage indisponible : le repli reste valable pour la session en cours.
        traceSilentFailure('groupes-replies:persist', error)
      }
      return suivant
    })
  }, [])

  /** La cible d'un glisser en cours, pour que l'utilisateur VOIE où il va déposer. */
  const [surviole, setSurvole] = useState<string | null>(null)

  /**
   * Dossiers de classement MEMORISES. Defaut vecu le 2026-09-05 : la liste etait DERIVEE des
   * conversations rangees, donc reclasser la derniere conversation d'un dossier le faisait
   * DISPARAITRE du menu -- il fallait re-parcourir le disque pour le retrouver. On persiste donc
   * les dossiers deja choisis, et on les retire seulement sur un geste EXPLICITE (la croix).
   * `localStorage` et non le store disque : c'est une preference d'affichage locale.
   *
   * SEULS DES CHEMINS Y ENTRENT (conv-81, 2026-09-16). La liste memorisait tout ce qui avait servi
   * a classer, et classer ecrivait dans le meme champ que le dossier de travail : des libelles
   * (« Perso », « Clients/Acme ») se retrouvaient donc proposes comme dossiers de travail, et les
   * choisir renvoyait le tour dans le depot d'Autowin. Le filtre est pose a la LECTURE autant qu'a
   * l'ecriture : a la lecture il vide ce qui s'est deja installe (cette liste vit dans le stockage
   * local, il n'y a pas de migration de fichier possible), a l'ecriture il empeche le retour.
   */
  const [dossiersMemorises, setDossiersMemorises] = useState<string[]>(() => lireDossiersDuChat())
  /*
    Les retraits, aussi en mémoire : la croix du Board retire même le dépôt par défaut
    (conv-1212, 2e demande : « ils n'ont pas la petite croix »), que ce menu propose toujours — il
    doit le cacher à son tour, la liste est commune. « This computer » n'en tient JAMAIS compte
    (conv-1231 : « j'ai perdu le this computer, il doit être impossible à supprimer »).
  */
  const [dossiersRetires, setDossiersRetires] = useState<string[]>(() => lireDossiersRetires())
  const estRetire = useCallback(
    (chemin: string | null | undefined): boolean => {
      const cle = cleDeDossier(chemin)
      return !!cle && dossiersRetires.some((retire) => cleDeDossier(retire) === cle)
    },
    [dossiersRetires]
  )
  const memoriserDossier = useCallback((chemin: string): void => {
    const propre = chemin.trim()
    if (!estCheminDeDossier(propre)) return
    // Un ajout MANUEL efface le retrait : l'utilisateur vient de dire le contraire de la croix,
    // et l'import claude.exe redevient autorisé à maintenir ce dossier.
    const retires = sansDossierRetire(lireDossiersRetires(), propre)
    ecrireDossiersRetires(retires)
    setDossiersRetires(retires)
    setDossiersMemorises((connus) => (connus.includes(propre) ? connus : [...connus, propre]))
  }, [])
  const oublierDossier = useCallback((chemin: string): void => {
    // Retrait EXPLICITE, mémorisé : sans cette trace, l'import claude.exe rejoué à chaque
    // lancement ressusciterait le dossier et la croix serait un bouton mort.
    const retires = avecDossierRetire(lireDossiersRetires(), chemin)
    ecrireDossiersRetires(retires)
    setDossiersRetires(retires)
    setDossiersMemorises((connus) => connus.filter((connu) => connu !== chemin))
  }, [])
  useEffect(() => {
    window.localStorage.setItem(CLE_DOSSIERS_CONNUS, JSON.stringify(dossiersMemorises))
    // Le Board ne montre que ces dossiers (conv-1212) : le processus principal en garde la copie,
    // pour que sa recopie de fin de tour suive aussi un retrait fait ici, Board fermé.
    void transmettreDossiersDuChat(dossiersMemorises).catch((error) =>
      traceSilentFailure('dossiers-du-chat:transmettre', error)
    )
  }, [dossiersMemorises])
  // La croix du Board retire de la MÊME liste (conv-1212) : relue ici, sinon la copie en mémoire du
  // Chat réécrirait le dossier retiré à son prochain changement.
  useEffect(() => {
    const relire = (): void => {
      setDossiersMemorises((connus) => {
        const lus = lireDossiersDuChat()
        return JSON.stringify(lus) === JSON.stringify(connus) ? connus : lus
      })
      setDossiersRetires((avant) => {
        const lus = lireDossiersRetires()
        return JSON.stringify(lus) === JSON.stringify(avant) ? avant : lus
      })
    }
    const autreFenetre = (event: StorageEvent): void => {
      if (event.key === CLE_DOSSIERS_CONNUS || event.key === CLE_DOSSIERS_RETIRES) relire()
    }
    window.addEventListener(EVT_DOSSIERS_DU_CHAT, relire)
    window.addEventListener('storage', autreFenetre)
    return () => {
      window.removeEventListener(EVT_DOSSIERS_DU_CHAT, relire)
      window.removeEventListener('storage', autreFenetre)
    }
  }, [])

  const rangerDans = useCallback(
    async (conversationId: string, chemin?: string | null): Promise<void> => {
      if (chemin) memoriserDossier(chemin)
      await window.api.conversationsSetProject?.(conversationId, chemin)
      await refreshConvs()
    },
    [refreshConvs, memoriserDossier]
  )
  return {
    active,
    resumeAvailable,
    composersMosaiqueRef,
    rendrePiecesJointesEnAttente,
    faconsDuFilActif,
    faconsDeLaMosaique,
    signatureDesFacons,
    fenetresMosaique,
    ouvrirFilMosaiqueStable,
    fermerFenetreStable,
    ouvrirSeuleStable,
    nouvelleFenetreStable,
    rendreComposerStable,
    repondreAskMosaiqueStable,
    remplirSaisie,
    remplirSaisieMosaique,
    signatureComposerMosaique,
    correspondancesContenu,
    convStatusFilter,
    setConvStatusFilter,
    conversationHits,
    groupesReplies,
    basculerGroupe,
    surviole,
    setSurvole,
    dossiersMemorises,
    setDossiersMemorises,
    estRetire,
    memoriserDossier,
    oublierDossier,
    rangerDans
  }
}
