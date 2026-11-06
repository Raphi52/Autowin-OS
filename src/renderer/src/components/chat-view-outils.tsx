/* eslint-disable react-refresh/only-export-components -- aides déplacées telles quelles depuis ChatView.tsx, où elles côtoyaient déjà le composant. */
import {
  resolveChatRuntimeIdentity,
  deriveConversationState,
  type ChatPart,
  type StoredAssistantMessage,
  hydrateStoredAssistant
} from './chat-view-model'
import { traduireChatFil, useTextesChatFil } from '../textes-ecrans/chat-fil'
import type { ValeursDeTexte } from '../textes'
import { langueCourante, formaterDate } from '../langue'
import {
  type RaisonDeRepriseManuelle,
  type SituationDeReprise
} from '../../../shared/reprise-quota'
import { ecrireDossiersRetires as ecrireRetiresPartages } from './dossiers-du-chat'
import { type ConversationGroupKind } from './conversation-groups'
import { type ContextGauge } from '../../../shared/context-gauge'
import { type ContexteStatique } from '../../../shared/contexte-detaille'
import { segmentsSurlignes } from './conversation-search'
import { memo, type Dispatch, type SetStateAction } from 'react'
import type { Conv, Msg, AsstMsg, UserMsg } from './chat-view-types'
import { Spinner } from './Spinner'
import type { PlanDansLaListe } from '../../../shared/plan-de-lots'
import type { Langue } from '../../../shared/langue'
import { noterLigneListe } from './rendu-long'
import { etatDuFil } from './lots-dans-la-liste'
import { lireSigneSuperConv } from './signe-super-conv'
import { JaugeSuperConv } from './SigneSuperConv'
import {
  type PropositionSuite,
  extrairePropositionsSuite,
  extrairePromptSuivant,
  publicationJamaisDemandee,
  estPromptDePublication,
  PROMPT_SALVAGE
} from '../../../shared/prompt-suivant'
import { extractRecommendation } from './markdown-recommandation'
import { flattenChatParts } from '../../../shared/chat-turn'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type RuntimeModel = Parameters<typeof resolveChatRuntimeIdentity>[1][number]
/** Le modèle retenu pour un fil (voir `Conversation.modeleChoisi` côté main). */
export type ModeleDuFil = { provider: string; model?: string; reasoningEffort?: string }

/* ---------- Constantes ---------- */

/**
 * LA JAUGE SURVIT A LA FERMETURE DU FIL.
 *
 * L'occupation n'est calculee qu'a la fin d'un tour, et l'usage n'est PAS persiste avec les
 * messages (verifie : aucun champ `usage` dans conversations.json). Rouvrir une conversation
 * rendait donc la barre vide alors que le fil etait plein. On garde ici la DERNIERE occupation
 * connue par conversation, cote interface — une mesure datee, pas un recalcul invente.
 */
const CLE_JAUGES = 'autowin.context-gauges.v1'
/**
 * Detail du contexte PAR CATEGORIE, par conversation : memorise comme la jauge, pour
 * que le panneau survive au rechargement. Borne aux plus recents : la liste des outils MCP pese
 * ~2 ko par fil, et le stockage du navigateur est partage par toute l'app.
 */
const CLE_CONTEXTES = 'autowin.contextes-detailles.v1'
const CONTEXTES_MEMORISES_MAX = 40
/**
 * Texte de CETTE vue dans la langue courante (traduction anglaise), pour le rendu comme pour
 * un gestionnaire ou un effet : lu à l'appel, il n'ajoute aucune dépendance de hook. La vue se
 * redessine quand la langue change, parce qu'elle lit `useTextesChatFil()`.
 */
export function texteFil(
  cle: Parameters<typeof traduireChatFil>[0],
  valeurs?: ValeursDeTexte
): string {
  return traduireChatFil(cle, langueCourante(), valeurs)
}

/**
 * fix-ok: sans ligne d'état, « en attente » et « bloqué » étaient identiques à l'écran ; puis
 * « repart seule à 02:02 » taisait le jour d'une attente de 44 h, et le fil « Assistant mails » et les
 * branches sortaient de la reprise sans raison lisible : `ChatView.reprise-quota.test.tsx`.
 */
const TEXTE_DE_LA_RAISON = {
  'aucune-heure': 'quota.raison.aucuneHeure',
  'coupure-ancienne': 'quota.raison.coupureAncienne',
  run: 'quota.raison.run',
  'plan-de-lots': 'quota.raison.planDeLots',
  inactive: 'quota.raison.inactive',
  'hors-du-chat': 'quota.raison.horsDuChat',
  branche: 'quota.raison.branche'
} as const satisfies Record<RaisonDeRepriseManuelle, Parameters<typeof traduireChatFil>[0]>

/**
 * Sous 24 h, une heure ne désigne qu'un seul instant. Au-delà, elle en désigne plusieurs : une coupure
 * annoncée pour le surlendemain affichait « 02:02 », 44 h à l'avance (1 coupure sur 21).
 */
const ATTENTE_LISIBLE_SANS_JOUR_MS = 24 * 60 * 60 * 1000

export function texteDeLaSituation(situation: SituationDeReprise): string {
  const { n } = situation
  if (situation.etat === 'essai-rate') return texteFil('quota.etat.essaiRate', { n })
  if (situation.etat === 'manuelle')
    return texteFil('quota.etat.manuelle', {
      n,
      raison: texteFil(TEXTE_DE_LA_RAISON[situation.raison])
    })
  const { reprendA } = situation
  // L'heure est passée : le départ attend sa place, ou a été écarté et part au prochain passage.
  if (reprendA <= Date.now())
    return texteFil(n > 1 ? 'quota.etat.imminentePlusieurs' : 'quota.etat.imminenteUne', { n })
  const heure = formaterDate(reprendA, { hour: '2-digit', minute: '2-digit' })
  if (reprendA - Date.now() < ATTENTE_LISIBLE_SANS_JOUR_MS)
    return texteFil(n > 1 ? 'quota.etat.attentePlusieurs' : 'quota.etat.attenteUne', { n, heure })
  const jour = formaterDate(reprendA, { weekday: 'long', day: 'numeric', month: 'long' })
  return texteFil(n > 1 ? 'quota.etat.attentePlusieursJour' : 'quota.etat.attenteUneJour', {
    n,
    jour,
    heure
  })
}

/** Libellé affiché (infobulle, lecteur d'écran) de chaque valeur du filtre de statut du pied de liste. */
export const LIBELLE_FILTRE_STATUT = {
  toutes: 'liste.filtre.toutes',
  actives: 'liste.filtre.actives',
  inactives: 'liste.filtre.archivees'
} as const satisfies Record<'toutes' | 'actives' | 'inactives', Parameters<typeof texteFil>[0]>
/**
 * La liste des dossiers et la mémoire des retraits vivent dans `dossiers-du-chat.ts` depuis que la
 * croix du Board retire de la MÊME liste.
 */
export function ecrireDossiersRetires(retires: string[]): void {
  const erreur = ecrireRetiresPartages(retires)
  if (erreur) traceSilentFailure('dossiers-retires:persist', erreur)
}
/**
 * Dossier de travail choisi POUR LE PROCHAIN fil, memorise entre les sessions JUSQU'A ce que ce
 * fil naisse : il est alors vide (`consommerDossierNouveauFil`), il ne sert qu'une fois.
 */
export const CLE_DOSSIER_NOUVEAU_FIL = 'autowin.chat.dossierNouveauFil'

/**
 * Peut-on DEPOSER une conversation sur l'en-tete de ce groupe ?
 *
 * Oui pour un rangement voulu par l'utilisateur — un dossier de travail, ou une categorie. Non pour
 * un groupe DERIVE : « Auto-kaizen » vient du champ `autoKaizen`, « Divers » est l'absence de
 * rangement, « Recent » est un raccourci qui duplique. Y trainer une conversation ne voudrait rien
 * dire, et la cle du groupe n'est alors pas un rangement transmissible a `rangerDansDossier`.
 * fix-ok: cause mesurée dans la vue : la clé du groupe servait de cible de dépôt, or un groupe dérivé (Divers, Récent, Auto-kaizen) n'a pas de rangement transmissible ; on ne laisse déposer que sur un dossier ou une catégorie.
 */
export function deposable(kind: ConversationGroupKind): boolean {
  return kind === 'dossier' || kind === 'categorie'
}

export function lireJaugesMemorisees(): Record<string, ContextGauge> {
  try {
    const brut = globalThis.localStorage?.getItem(CLE_JAUGES)
    if (!brut) return {}
    const lu: unknown = JSON.parse(brut)
    return lu && typeof lu === 'object' ? (lu as Record<string, ContextGauge>) : {}
  } catch {
    return {}
  }
}

export function lireContextesMemorises(): Record<string, ContexteStatique> {
  try {
    const brut = globalThis.localStorage?.getItem(CLE_CONTEXTES)
    if (!brut) return {}
    const lu: unknown = JSON.parse(brut)
    return lu && typeof lu === 'object' ? (lu as Record<string, ContexteStatique>) : {}
  } catch {
    return {}
  }
}

export function memoriserContextes(contextes: Record<string, ContexteStatique>): void {
  const recents = Object.entries(contextes)
    .sort(([, a], [, b]) => (b.mesureLe ?? 0) - (a.mesureLe ?? 0))
    .slice(0, CONTEXTES_MEMORISES_MAX)
  try {
    globalThis.localStorage?.setItem(CLE_CONTEXTES, JSON.stringify(Object.fromEntries(recents)))
  } catch {
    /* stockage indisponible : le detail reste seulement en memoire. */
  }
}

export function memoriserJauges(jauges: Record<string, ContextGauge>): void {
  try {
    globalThis.localStorage?.setItem(CLE_JAUGES, JSON.stringify(jauges))
  } catch {
    /* stockage indisponible : la jauge reste seulement en memoire. */
  }
}

/**
 * Ghost-text d'un FIL donne : prompt suivant ecrit par le modele, sinon rubrique Recommande.
 * Extrait du composant pour que la MOSAIQUE l'obtienne aussi, par conversation (2026-08-30).
 */
/**
 * SIGNE INFINI DU ROND « MODE AUTO » — un TRACÉ, pas le caractère ∞ (2026-10-06).
 *
 * Le caractère de police se pose à une hauteur qui SAUTE avec le zoom Ctrl+molette (2,2 px trop
 * bas à 100 %, ~1,3 px à 150-300 %) : le `translateY(-2px)` réglé à 100 % le rendait trop haut
 * sur 21 crans de zoom sur 26 (mesuré dans Electron, 50-300 %). Ce tracé est symétrique autour
 * du centre de sa boîte (x 2-22, y 8-16) : le centrage flex du bouton suffit, à tout zoom.
 * Taille réglée en CSS (`.composer-auto > svg`) sur celle de l'ancien caractère (~10 × 5 px).
 */
export function IconeInfini(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * SURLIGNE dans un libelle les portions qui correspondent au terme cherche.
 *
 * Une liste filtree qui ne montre pas POURQUOI chaque ligne est la oblige a ouvrir chaque
 * conversation pour comprendre. `<mark>` porte aussi le sens semantiquement, pas seulement une
 * couleur : un lecteur d'ecran l'annonce.
 */
function TexteSurligne({ texte, terme }: { texte: string; terme: string }): React.JSX.Element {
  const segments = segmentsSurlignes(texte, terme)
  return (
    <>
      {segments.map((segment, index) =>
        segment.marque ? (
          <mark key={index} className="conv-highlight">
            {segment.texte}
          </mark>
        ) : (
          <span key={index}>{segment.texte}</span>
        )
      )}
    </>
  )
}

/**
 * PERLE D'ETAT DE L'EN-TETE (2026-10-10, variante « Jumeau »).
 *
 * Elle remplace l'ancienne boule de 26 px (`.chat-head-signal`) : trop grosse et toujours rose,
 * elle ne disait rien de la conversation. C'est desormais la JUMELLE de la pastille de la liste des
 * fils — meme case fixe de 18 px (`.conv-state-slot`), meme perle d'etat, meme <Spinner/> de 18 px
 * quand la conversation travaille — posee au debut de la ligne d'infos (« claude · Opus… »), a la
 * demande de l'utilisateur. Le balisage est RECOPIE de `LigneConversation` (et non partage) : un
 * test fige le balisage de la liste (ChatView.pastilles.test.ts).
 *
 * Memorisee sur des valeurs simples : l'en-tete se re-rend a chaque morceau de texte recu pendant
 * un tour, et l'etat ne doit pas etre recalcule a chaque fois
 * (ChatView.liste-stable-pendant-tour.test.tsx compte ces calculs). La case est un <div>, pas un
 * <span> : la ligne d'infos ecrit un « · » entre deux <span> voisins, la perle n'en veut pas.
 */
export const PastilleEnTete = memo(function PastilleEnTete({
  occupe,
  messageCount,
  lastMessageRole,
  lastAssistantStatus,
  asksUser,
  tourEnCours
}: {
  occupe: boolean
  messageCount: number
  lastMessageRole?: 'user' | 'assistant'
  lastAssistantStatus?: Conv['lastAssistantStatus']
  asksUser: boolean
  /** Un tour tourne encore plus haut dans le fil (`Conv.hasStreamingTurn`), même règle que la liste. */
  tourEnCours: boolean
}): React.JSX.Element {
  // La conversation affichee est lue par definition : jamais « non lue » (meme regle que la liste).
  const { t } = useTextesChatFil()
  const conversationState = deriveConversationState({
    busy: occupe,
    messageCount,
    lastMessageRole,
    lastAssistantStatus,
    asksUser,
    unseen: false,
    streamingTurn: tourEnCours
  })
  const stateDescription = `${conversationState.label} — ${conversationState.detail}`
  return (
    <div className="conv-state-slot chat-runtime-etat" data-testid="chat-runtime-etat">
      {conversationState.key === 'running' ? (
        <Spinner
          size={18}
          className="conversation-state is-running"
          label={t('liste.etat', { etat: stateDescription })}
          title={stateDescription}
          data-conversation-state={conversationState.key}
        />
      ) : (
        <span
          className={`conversation-state is-${conversationState.key}`}
          data-conversation-state={conversationState.key}
          role="img"
          aria-label={t('liste.etat', { etat: stateDescription })}
          title={stateDescription}
        />
      )}
    </div>
  )
})

/**
 * LES FILS D'UN PLAN DE LOTS RANGÉS SOUS LEUR FIL CHEF (lot 5 du plan-ba5b7d4a,
 * 2026-10-26). Avec plusieurs plans, les fils « Lot N/M — … » se mêlaient aux autres et on ne
 * savait plus à quel chef ils répondaient. Un fil de lot ne porte aucun lien vers son chef : seul
 * le plan le sait (canal `os:plansDeLots`, `main/plans-de-lots-app.ts`).
 *
 * Un lot qui a son onglet n'a plus de ligne (`lots-dans-la-liste.ts`)
 * Un lot d'un ancien plan non plus (le bloc du chef y mène). Ce rangement ne sert plus
 * qu'aux résultats de recherche.
 */
export interface LienDeLot {
  chef: string
  rang: number
  total: number
  /** Le lot appartient au plan que montre son chef : il a son onglet dans la super conv. */
  onglet: boolean
}
/**
 * Pur : fil de lot → son chef, son rang et le total, d'après la réponse du geste « tous ».
 * Les plans arrivent du plus ancien au plus récent : un fil présent dans deux plans
 * suit le plus récent, comme `planDuFil` côté app. Un lot ouvert dans le fil chef lui-même n'est
 * pas un enfant.
 */
export function liensDesPlans(plans: readonly PlanDansLaListe[]): Map<string, LienDeLot> {
  const liens = new Map<string, LienDeLot>()
  for (const plan of plans)
    for (const lot of plan.lots)
      if (lot.fil !== plan.chef)
        liens.set(lot.fil, {
          chef: plan.chef,
          rang: lot.rang,
          total: plan.total,
          onglet: plan.actuel
        })
  return liens
}

/**
 * Pur : le fil chef de la super conv dont `fil` fait partie, ou `null`. Le chef d'abord, comme
 * `planDuFil` côté app. Lu ici plutôt que relu du plan : passer d'un onglet à l'autre change de fil
 * sans changer de chef, donc les onglets restent à l'écran sans attendre de relecture.
 */
export function chefDeLaSuperConv(
  fil: string | null,
  liens: ReadonlyMap<string, LienDeLot>
): string | null {
  if (!fil) return null
  for (const lien of liens.values()) if (lien.chef === fil) return fil
  return liens.get(fil)?.chef ?? null
}

/** Vrai si les deux tables portent exactement les mêmes liens : rien à re-rendre. */
export function memesLiens(
  a: ReadonlyMap<string, LienDeLot>,
  b: ReadonlyMap<string, LienDeLot>
): boolean {
  if (a.size !== b.size) return false
  for (const [fil, lien] of a) {
    const autre = b.get(fil)
    if (
      !autre ||
      autre.chef !== lien.chef ||
      autre.rang !== lien.rang ||
      autre.total !== lien.total ||
      autre.onglet !== lien.onglet
    )
      return false
  }
  return true
}

/**
 * Pur : range chaque fil de lot juste après son chef, un cran plus à droite, par rang de lot. Un
 * fil hors plan garde sa place ; un lot dont le chef n'est pas dans le même groupe aussi (il garde
 * seulement son repère). Un fil jamais posé (lien circulaire) retombe en fin de groupe : on n'en
 * perd aucun.
 */
export function rangerSousLeurChef<T extends { hit: { conversation: { id: string } } }>(
  entrees: readonly T[],
  liens: ReadonlyMap<string, LienDeLot>,
  langue: Langue
): Array<{ entree: T; niveau: number; lot?: string }> {
  if (liens.size === 0) return entrees.map((entree) => ({ entree, niveau: 0 }))
  const presents = new Set(entrees.map((e) => e.hit.conversation.id))
  const chefPresent = (id: string): string | undefined => {
    const chef = liens.get(id)?.chef
    return chef && chef !== id && presents.has(chef) ? chef : undefined
  }
  const enfants = new Map<string, T[]>()
  for (const e of entrees) {
    const chef = chefPresent(e.hit.conversation.id)
    if (chef) enfants.set(chef, [...(enfants.get(chef) ?? []), e])
  }
  const rangDe = (e: T): number => liens.get(e.hit.conversation.id)?.rang ?? 0
  for (const liste of enfants.values()) liste.sort((a, b) => rangDe(a) - rangDe(b))
  const poses = new Set<string>()
  const sortie: Array<{ entree: T; niveau: number; lot?: string }> = []
  const poser = (entree: T, niveau: number): void => {
    const id = entree.hit.conversation.id
    if (poses.has(id)) return
    poses.add(id)
    const lien = liens.get(id)
    const lot = lien
      ? traduireChatFil('liste.lot', langue, { rang: lien.rang, total: lien.total })
      : undefined
    sortie.push({ entree, niveau, ...(lot ? { lot } : {}) })
    for (const enfant of enfants.get(id) ?? []) poser(enfant, niveau + 1)
  }
  for (const e of entrees) if (!chefPresent(e.hit.conversation.id)) poser(e, 0)
  for (const e of entrees) poser(e, 0)
  return sortie
}

/**
 * UNE LIGNE DE LA LISTE DES CONVERSATIONS, memorisee (heal gels vue chat, 2026-09-18).
 * Mesure dans l'app (serveur de dev, 637 lignes) : changer de conversation recreait TOUTES les
 * lignes (~430 ms par bascule, surtout de la creation d'elements). Une ligne ne se re-rend plus que
 * si SES donnees changent : a la bascule, seules l'ancienne et la nouvelle ligne active bougent.
 * Les actions passent par `actionsRef` (toujours les dernieres, sans invalider la memoire).
 */
type ActionsLigneConversation = {
  loadConv: (c: Conv) => Promise<void>
  basculerDansMosaique: (id: string) => Promise<void>
  toggleConvSelection: (id: string) => void
}
export const LigneConversation = memo(function LigneConversation({
  c,
  snippet,
  depth,
  lot,
  actif,
  occupe,
  nonVue,
  questionDUnLot,
  superConv,
  selectionnee,
  mosaiqueOuverte,
  convQuery,
  convSelectionMode,
  convViewMode,
  actionsRef,
  setConvMenu
}: {
  c: Conv
  snippet?: string
  depth: number
  /** « lot N/M » quand le fil est un lot d'un plan : une chaîne, pour garder `memo`. */
  lot?: string
  actif: boolean
  occupe: boolean
  nonVue: boolean
  /** Fil chef dont un lot attend ta réponse : voir `etatDuFil`. */
  questionDUnLot: boolean
  /**
   * Signe d'un fil chef (`signe-super-conv.ts`), encodé en chaîne pour garder `memo` ;
   * absent pour un fil hors plan.
   */
  superConv?: string
  selectionnee: boolean
  mosaiqueOuverte: boolean
  convQuery: string
  convSelectionMode: boolean
  convViewMode: string
  actionsRef: { readonly current: ActionsLigneConversation }
  setConvMenu: Dispatch<SetStateAction<{ conv: Conv; top: number; left: number } | null>>
}): React.JSX.Element {
  // Le gel de la liste compte ses lignes redessinées (`rendu-long.ts`).
  noterLigneListe(c.id)
  const { t } = useTextesChatFil()
  const conversationState = etatDuFil(c, occupe, nonVue, questionDUnLot)
  const stateDescription = `${conversationState.label} — ${conversationState.detail}`
  const signe = superConv === undefined ? null : lireSigneSuperConv(superConv)
  return (
    <div
      className={`conv-item${actif ? ' active' : ''}${c.surlignee ? ' surlignee' : ''}${signe ? ' conv-item--super' : ''}`}
      style={{ marginLeft: depth * 14 }}
      data-conversation-id={c.id}
      {...(lot ? { 'data-lot': lot } : {})}
      // Le glisser est un RACCOURCI, pas le seul chemin : le menu ⋮ offre la même
      // action au clavier. Une fonction qui n'existe qu'au glisser exclut de fait
      // ceux qui ne peuvent pas glisser.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/autowin-conversation', c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {convSelectionMode && convViewMode !== 'mosaic' && (
        <input
          type="checkbox"
          className="conv-select-box"
          checked={selectionnee}
          onChange={() => actionsRef.current.toggleConvSelection(c.id)}
          aria-label={t('liste.selectionner', { titre: c.title })}
        />
      )}
      <button
        className="conv-pick"
        onClick={() =>
          convViewMode === 'mosaic'
            ? void actionsRef.current.basculerDansMosaique(c.id)
            : void actionsRef.current.loadConv(c)
        }
      >
        {/* EN COURS = le MEME atome que partout ailleurs : le composant
            <Spinner/>. La pastille etait le dernier endroit a rendre l'ancien
            atome CSS a bordures (.spinner), d'ou un indicateur qui ne
            ressemblait a aucun autre. Les autres etats restent une pastille.
            CASE FIXE (.conv-state-slot, largeur = taille du spinner) : spinner 18px,
            pastille 7/11px et points 15px y sont CENTRES sur le meme axe, et le titre
            demarre au meme x sur toutes les lignes (2026-10-10). */}
        <span className="conv-state-slot">
          {conversationState.key === 'running' ? (
            <Spinner
              size={18}
              className="conversation-state is-running"
              label={t('liste.etat', { etat: stateDescription })}
              title={stateDescription}
              data-conversation-state={conversationState.key}
            />
          ) : (
            <span
              className={`conversation-state is-${conversationState.key}`}
              data-conversation-state={conversationState.key}
              role="img"
              aria-label={t('liste.etat', { etat: stateDescription })}
              title={stateDescription}
            />
          )}
        </span>
        <span className="conv-copy">
          {signe && signe.total > 0 ? (
            /* MÊME STRUCTURE QUE LA MAQUETTE CHOISIE (« ça ressemble pas du tout ») :
               titre, « N ? » puis « M/T » sur la ligne du titre, jauge dessous sur TOUTE la largeur.
               Les badges sont donc DANS le bouton de la ligne : le raccourci n'est pas un bouton
               (pas de bouton dans un bouton), il arrête le clic ; au clavier, le lot s'ouvre par
               son onglet dans la super conv. */
            <>
              <span className="conv-sc-tete">
                <span className="conv-label">
                  {convQuery ? <TexteSurligne texte={c.title} terme={convQuery} /> : c.title}
                </span>
                {signe.question && (
                  <span
                    className="conv-sc-question"
                    title={t('liste.superConv.question', { rang: signe.question.rang })}
                    onClick={(event) => {
                      event.stopPropagation()
                      window.dispatchEvent(
                        new CustomEvent('autowin:open-conversation', {
                          detail: signe.question?.fil
                        })
                      )
                    }}
                  >
                    {signe.question.rang} ?
                  </span>
                )}
                <span
                  className={`conv-sc-compte tnum${signe.finis === signe.total ? ' is-fini' : ''}`}
                  title={t('liste.superConv.compte', { finis: signe.finis, total: signe.total })}
                >
                  {signe.finis}/{signe.total}
                </span>
              </span>
              <JaugeSuperConv segments={signe.segments} />
            </>
          ) : (
            <span className="conv-label">
              {convQuery ? <TexteSurligne texte={c.title} terme={convQuery} /> : c.title}
            </span>
          )}
          {convQuery && snippet && (
            <span className="conv-snippet">
              <TexteSurligne texte={snippet} terme={convQuery} />
            </span>
          )}
          {/* Le NUMERO reste visible pendant une recherche, et surligne quand il
              correspond : taper « 171 » masquait la seule information qui prouve
              qu'on a trouve la bonne conversation (2026-09-03). */}
          <span className="conv-meta">
            <span>{convQuery ? <TexteSurligne texte={c.id} terme={convQuery} /> : c.id}</span>
            {/* Rang et total lus dans le PLAN : le titre ne sert qu'à choisir quels fils interroger. */}
            {lot && (
              <span className="conv-lot" title={t('liste.lot.titre')}>
                {lot}
              </span>
            )}
            {/* Fil privé (D6) : discret, à la couleur de la ligne de détail — ni or ni
                rouge, ce n'est pas un signal qui appelle l'utilisateur. */}
            {c.prive && (
              <span
                className="conv-prive"
                data-testid={`conv-prive-${c.id}`}
                title={t('liste.prive.titre')}
              >
                {t('liste.prive')}
              </span>
            )}
            {!convQuery && <span>{c.messageCount ?? c.messages?.length ?? 0} messages</span>}
          </span>
        </span>
        {convQuery && (
          <span className="conv-count tnum">{c.messageCount ?? c.messages?.length ?? 0}</span>
        )}
        {/* En mosaique, la liste n'est plus une SELECTION mais un jeu
            d'interrupteurs : l'etat ouvert/ferme se lit a droite du titre. */}
        {convViewMode === 'mosaic' && (
          <span
            className={`conv-mosaic-toggle${mosaiqueOuverte ? ' is-open' : ''}`}
            data-testid={`conv-mosaic-toggle-${c.id}`}
            role="img"
            aria-pressed={mosaiqueOuverte ? 'true' : 'false'}
            aria-label={
              mosaiqueOuverte
                ? t('liste.mosaiqueOuverte', { titre: c.title })
                : t('liste.mosaiqueFermee', { titre: c.title })
            }
            title={mosaiqueOuverte ? t('liste.ouverte') : t('liste.fermee')}
          >
            <span className="conv-mosaic-toggle-knob" aria-hidden="true" />
          </span>
        )}
      </button>
      <button
        className="conv-menu-trigger"
        // « Actions » s'écrit pareil en anglais.
        title="Actions"
        aria-label={t('liste.actions')}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          setConvMenu((current) =>
            current?.conv.id === c.id ? null : { conv: c, top: rect.top, left: rect.right + 6 }
          )
        }}
      >
        ⋮
      </button>
      {signe && <span className="conv-sc-pile" aria-hidden="true" />}
    </div>
  )
})

/**
 * `depotPresent` : le dossier de travail est-il un depot git ? Sans depot, `/salvage` n'a ni
 * branche ni remise de cote a trier -- la reecriture de la suite en ordre de tri est donc
 * desactivee (trois relances utilisateur des 09 et 10/09/2026 sur un dossier sans `.git`).
 */
/** Le texte de la dernière réponse de l'agent et la demande de CE tour, lus ensemble. */
function dernierTourDuFil(fil: Msg[]): { text: string; demandeDuTour?: string } | null {
  const lastAssistant = [...fil].reverse().find((m) => m.role === 'assistant') as
    AsstMsg | undefined
  if (!lastAssistant) return null
  const text = lastAssistant.parts
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
  // La demande de CE tour compte : quand elle EST l'ordre de tri, le tri vient d'avoir lieu et
  // rejouer `/salvage` fabrique une boucle sans fin (vécu trois tours d'affilée le 2026-09-04).
  const demandeDuTour = [...fil]
    .reverse()
    .find((m): m is UserMsg & { messageId?: string } => m.role === 'user')?.content
  return { text, demandeDuTour }
}

/**
 * Les suites notées du dernier tour, en boutons au-dessus du champ. Mêmes gardes de
 * publication que le texte grisé : la première de la liste EST ce texte grisé dès que le modèle a
 * émis ses suites. Sans ligne de suite, la liste est vide et seul le repli « Recommandé » reste.
 */
export function propositionsDuFil(fil: Msg[], depotPresent: boolean): PropositionSuite[] {
  const tour = dernierTourDuFil(fil)
  if (!tour) return []
  return extrairePropositionsSuite(tour.text, tour.demandeDuTour, depotPresent)
}

export function ghostDuFil(fil: Msg[], depotPresent: boolean): string | null {
  const tour = dernierTourDuFil(fil)
  if (!tour) return null
  const { text, demandeDuTour } = tour
  const suite =
    extrairePromptSuivant(text, demandeDuTour, depotPresent) ?? extractRecommendation(text)
  // Le repli sur la rubrique « Recommandé » obéit à la même règle : publier passe par /salvage —
  // et une publication que personne n'a demandée ne propose RIEN du tout.
  if (!suite) return suite
  if (publicationJamaisDemandee(suite, demandeDuTour, depotPresent)) return null
  return estPromptDePublication(suite, demandeDuTour, depotPresent) ? PROMPT_SALVAGE : suite
}

// Les suggestions d'accueil ne sont plus figées : elles se DÉRIVENT de l'état réel
// (`buildHomeSuggestions`), le jeu historique restant le repli quand l'état est vide.

export const MAX_ATTACHMENTS = 8
/** Cadence de la veille sur un tour declare vivant (sonde d'autorite cote main). */
export const TOUR_VIVANT_SONDE_MS = 4000
/**
 * Delai au bout duquel le libelle « Arret... » rend la main quand le tour survit a son annulation.
 */
export const STOP_REARMEMENT_MS = 10000
export const NEW_DRAFT_KEY = '__new__'
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024
/* ---------- Vue ---------- */

/**
 * Chat façon Claude Code : conversations à gauche, fil transparent au centre
 * (l'agent parle ET pilote — ses actions en puces inline), workflows (RUN.md)
 * repliables à droite. Tout se passe ici.
 */
/**
 * Un échec AVALÉ ne doit jamais disparaître : même quand le repli est correct (on garde l'écran
 * précédent), la cause doit rester diagnosticable. Trace unique, préfixée par sa portée.
 */
export function traceSilentFailure(scope: string, error: unknown): void {
  console.warn(`[chat] ${scope} — échec ignoré`, error)
}

export type AppNotice = { text: string; noticeId?: number }

export function newestNotice(current: AppNotice | null, incoming: AppNotice): AppNotice {
  if (
    current?.noticeId !== undefined &&
    incoming.noticeId !== undefined &&
    incoming.noticeId < current.noticeId
  ) {
    return current
  }
  return incoming
}

/**
 * Fil PERSISTÉ → fil live. Extrait de `loadConv` parce qu'un second appelant en a besoin : l'amorce
 * d'un tour initié côté main doit partir du store, sinon elle écrase l'historique dans le cache live
 * — qui fait autorité à la réouverture (« ma conversation était tronquée »).
 */
export type MessageStocke = Partial<StoredAssistantMessage> & {
  role: string
  content: string
  messageId?: string
  attachments?: UserMsg['attachments']
  done?: boolean
  orientation?: boolean
  coupeLaReponse?: number
  ts?: number
}

/**
 * LA SUITE DU TOUR SE RELIT SOUS LA CONSIGNE QUI L'A PROVOQUÉE (2026-09-19).
 *
 * Une consigne écrite pendant un tour est stockée APRÈS le message assistant du tour, qui porte
 * TOUT le texte — y compris la réponse à cette consigne. Au rechargement, cette réponse remontait
 * donc au-dessus de la question : « quand j'ai écrit fais tout ça a effacé ton message précédent ».
 * Le store note sur la consigne combien de parts existaient déjà (`coupeLaReponse`) ; on coupe la
 * bulle à cet endroit et la suite s'affiche sous la consigne. Tour encore en cours : rien ne bouge,
 * l'affichage en direct a sa propre coupure (`.directive-receipt`).
 */
/**
 * L'HEURE, QUAND LE NOMBRE NE VAUT PLUS (2026-10-31). Un fil enregistré avant le
 * recalage des coupures (`recalerLesCoupures`, conversations.ts) porte une coupure au-delà de la
 * réponse, ou aucune pour la 2e consigne d'un tour : toute la réponse remontait au-dessus. On coupe
 * alors avant la première part datée APRÈS la consigne ; une part sans heure prend celle de la
 * précédente. `undefined` si rien n'est daté : le fil reste tel qu'il était.
 */
function coupureALHeure(
  parts: readonly { kind: string }[],
  debut: number,
  ts: number | undefined
): number | undefined {
  if (ts === undefined) return undefined
  let heure: number | undefined
  for (let rang = 0; rang < parts.length; rang++) {
    const part = parts[rang] as { at?: unknown; artifact?: { createdAt?: unknown } }
    const propre = part.at ?? part.artifact?.createdAt
    if (typeof propre === 'number') heure = propre
    if (rang >= debut && heure !== undefined && heure > ts) return rang
  }
  return heure === undefined ? undefined : parts.length
}

function couperAuxConsignes(messages: readonly MessageStocke[]): MessageStocke[] {
  const out: MessageStocke[] = []
  for (let i = 0; i < messages.length; i++) {
    const assistant = messages[i]
    const parts = assistant.role === 'assistant' ? assistant.parts : undefined
    if (!parts || assistant.status === 'streaming') {
      out.push(assistant)
      continue
    }
    let debut = 0
    let coupe = false
    let j = i + 1
    const morceaux: MessageStocke[] = []
    for (; j < messages.length; j++) {
      const consigne = messages[j]
      if (consigne.role !== 'user' || !consigne.orientation) break
      const notee = consigne.coupeLaReponse
      const lue =
        typeof notee === 'number' && notee >= 0 && notee <= parts.length
          ? Math.max(notee, debut)
          : coupureALHeure(parts, debut, consigne.ts)
      // 0 est une vraie coupure : tout ce qui la précédait a été effacé, la réponse passe dessous.
      if (lue !== undefined && lue < parts.length) {
        if (lue > debut) {
          const tranche = parts.slice(debut, lue)
          morceaux.push({ ...assistant, parts: tranche, content: flattenChatParts(tranche) })
        }
        debut = lue
        coupe = true
      }
      morceaux.push(consigne)
    }
    if (!coupe) {
      out.push(assistant, ...messages.slice(i + 1, j))
    } else {
      const reste = parts.slice(debut)
      out.push(...morceaux, { ...assistant, parts: reste, content: flattenChatParts(reste) })
    }
    i = j - 1
  }
  return out
}

export function hydraterFilStocke(messages: readonly MessageStocke[]): Msg[] {
  return couperAuxConsignes(messages).map((m) =>
    m.role === 'user'
      ? {
          role: 'user' as const,
          content: m.content,
          attachments: m.attachments,
          messageId: m.messageId,
          ts: m.ts,
          // Le drapeau QUE LE MAIN ECRIT (directive-dans-le-fil.ts) : sans lui, une orientation
          // relue passait pour une demande ordinaire — etiquette absente, question `ask` crue
          // repondue, mode auto qui la comptait (saisies ts 1792054396405, 1792054407546).
          ...(m.orientation ? { orientation: true } : {})
        }
      : { ...hydrateStoredAssistant(m as StoredAssistantMessage), messageId: m.messageId }
  )
}

/** Doublon de pièce jointe par défaut : même nom ET même taille. */
export function cleNomTaille(fichier: { name: string; size: number }): string {
  return `${fichier.name}\u0000${fichier.size}`
}
