import { useCallback, useEffect, useState } from 'react'
import type { CandidatVeille, StatutMarquable } from '../../../main/veille/candidats'
import type { StockVeille } from '../../../main/veille/candidats-store'
import { trierParPertinence, type TriVeille } from './veille-tri'
import './VeilleCandidatsSection.css'
import { Spinner } from './Spinner'
import { formaterDate } from '../langue'
import { useTextesTickets, type CleTickets } from '../textes-ecrans/tickets'

/**
 * Les candidats de veille, prêts à être promptés en un clic.
 *
 * Chaque ligne porte sa SOURCE cliquable et l'extrait lu. Ce n'est pas de la décoration : c'est ce qui
 * permet de vérifier en deux secondes qu'une feature annoncée existe vraiment, sans avoir à croire
 * l'agent qui l'a rapportée.
 *
 * Le bouton réutilise le chemin d'envoi EXISTANT (`autowin:prefill-conversation`), le même que celui du
 * traitement de tickets. Un second chemin d'envoi aurait divergé du premier au premier changement.
 *
 * Deux zéros qui mentiraient, et que cette vue refuse d'afficher comme tels :
 *  - « aucun candidat » alors que la lecture n'a pas encore répondu → état d'attente distinct ;
 *  - « aucun candidat » alors qu'aucune source n'a pu être lue → les sources muettes sont AFFICHÉES.
 */

export interface VeilleCandidatsSectionProps {
  /** Injectable pour les tests : sinon la vue parlerait au vrai IPC. */
  charger?: () => Promise<StockVeille>
  marquer?: (id: string, statut: StatutMarquable) => Promise<StockVeille>
  /** Injectable pour les tests : l'envoi réel passe par l'événement de pré-remplissage. */
  prompter?: (candidat: CandidatVeille) => Promise<void> | void
  /**
   * « En générer plus » : déclenche la passe INTERNE côté main (scout local sur les traces d'usage
   * et le code d'Autowin) puis relit le stock. Injectable pour les tests.
   */
  generer?: (conversationId?: string) => Promise<unknown>
  /** Injectable pour les tests : la préparation réelle crée ET OUVRE la conversation du scout. */
  ouvrirConversationScout?: () => Promise<string | undefined>
}

/** Le libellé de chaque statut, traduit au rendu (`textes-ecrans/tickets.ts`, conv-1170). */
const CLE_STATUT: Record<CandidatVeille['statut'], CleTickets> = {
  nouveau: 'veille.statut.nouveau',
  prompte: 'veille.statut.prompte',
  ecarte: 'veille.statut.ecarte',
  perime: 'veille.statut.perime'
}

/**
 * Prépare la conversation VISIBLE du scout interne : créée par la vue puis OUVERTE immédiatement
 * (navigation chat + activation), AVANT de lancer la génération. « Le bouton m'a encore pas lancé de
 * conversation dans laquelle je peux voir tout ce qui se passe » (14/08) : la version précédente la
 * créait côté main, en arrière-plan — présente dans la liste, mais humainement invisible.
 */
async function ouvrirConversationScoutParDefaut(): Promise<string | undefined> {
  const roleMap = await window.api.roles()
  const provider =
    roleMap.subagent?.provider ??
    roleMap.orchestrator?.provider ??
    Object.values(roleMap)[0]?.provider
  if (!provider) return undefined
  const conversation = await window.api.conversationsCreate({
    // Titre de conversation, pas un libellé de l'écran : il garde la forme française que pose aussi
    // le main (`veille/scout-visible.ts`) ; seule la date suit la langue (conv-1170).
    title: `[veille] scout interne ${formaterDate(new Date())}`.slice(0, 80),
    category: provider,
    provider
  })
  try {
    await window.api.appCommand?.('navigate', { tab: 'chat' })
  } catch {
    // Navigation refusée : le scout tournera quand même dans la conversation créée.
  }
  window.dispatchEvent(
    new CustomEvent('autowin:prefill-conversation', {
      detail: { conversationId: conversation.id, prompt: '', send: false }
    })
  )
  return conversation.id
}

/** L'envoi réel : création de conversation puis pré-remplissage, exactement comme pour un ticket. */
async function prompterParDefaut(candidat: CandidatVeille): Promise<void> {
  /*
    Le fournisseur vient de la configuration de RÔLES, comme pour le traitement d'un ticket : la
    conversation doit s'ouvrir sur le modèle que l'utilisateur a choisi, pas sur un défaut inventé ici.
    Sans fournisseur résolu on n'ouvre RIEN — mieux vaut ne rien faire que créer une conversation
    inutilisable, qu'il faudrait ensuite supprimer à la main.
  */
  const roleMap = await window.api.roles()
  const provider =
    roleMap.orchestrator?.provider ??
    roleMap.subagent?.provider ??
    Object.values(roleMap)[0]?.provider
  if (!provider) return
  const conversation = await window.api.conversationsCreate({
    title: `[veille] ${candidat.titre}`.slice(0, 80),
    category: provider,
    provider
  })
  try {
    await window.api.appCommand?.('navigate', { tab: 'chat' })
  } catch {
    // Navigation refusée : le prompt est quand même préparé dans la conversation.
  }
  window.dispatchEvent(
    new CustomEvent('autowin:prefill-conversation', {
      detail: { conversationId: conversation.id, prompt: candidat.prompt, send: false }
    })
  )
}

/** Une ligne de candidat. Extraite pour que les DEUX colonnes rendent exactement la même chose. */
function LigneCandidat({
  candidat,
  onPrompter,
  onEcarter
}: {
  candidat: CandidatVeille
  onPrompter: (candidat: CandidatVeille) => void
  onEcarter: (candidat: CandidatVeille) => void
}): React.JSX.Element {
  // Dépliage Quoi/Pourquoi/Comment (14/08) : les candidats du scout interne portent le contrat
  // étendu ; les autres retombent honnêtement sur ce qu'ils ont (titre, citation, ancrage).
  const [deplie, setDeplie] = useState(false)
  const { t } = useTextesTickets()
  return (
    <li className={`veille-ligne is-${candidat.statut}`}>
      <div className="veille-ligne-tete">
        <button
          type="button"
          className="veille-deplier"
          data-testid="veille-deplier"
          onClick={() => setDeplie((v) => !v)}
          aria-expanded={deplie}
          title={deplie ? t('veille.replier') : t('veille.deplier')}
        >
          {deplie ? '▾' : '▸'}
        </button>
        <span className="veille-concurrent">{candidat.concurrent}</span>
        <span className="veille-date">{candidat.dateSource}</span>
        {candidat.langue && <span className="veille-langue">{candidat.langue}</span>}
        {/* La note du scout, à côté du candidat : « lequel reprendre d'abord » se lit d'un coup. */}
        {candidat.pertinence !== undefined ? (
          <span
            className="veille-pertinence"
            data-testid="veille-pertinence"
            title={t('veille.pertinenceTitre')}
          >
            <b>{candidat.pertinence}</b>
            <small>/100</small>
          </span>
        ) : (
          <span className="veille-pertinence is-absente" data-testid="veille-pertinence-absente">
            {t('veille.nonNote')}
          </span>
        )}
        <span className={`veille-statut is-${candidat.statut}`}>
          {t(CLE_STATUT[candidat.statut])}
        </span>
      </div>
      <strong className="veille-titre" onClick={() => setDeplie((v) => !v)}>
        {candidat.titre}
      </strong>
      {/* L'extrait lu, mot pour mot : c'est la preuve que la feature existe. */}
      <blockquote className="veille-citation">{candidat.citation}</blockquote>
      {deplie && (
        <div className="veille-details" data-testid="veille-details">
          <div className="veille-q">
            <b>{t('veille.quoi')}</b>
            <p>{candidat.what ?? candidat.titre}</p>
          </div>
          <div className="veille-q">
            <b>{t('veille.pourquoi')}</b>
            <p>{candidat.why ?? t('veille.preuveLue', { citation: candidat.citation })}</p>
          </div>
          <div className="veille-q">
            <b>{t('veille.comment')}</b>
            <p>{candidat.how ?? t('veille.partirAncrage', { url: candidat.url })}</p>
          </div>
        </div>
      )}
      <div className="veille-actions">
        <a href={candidat.url} target="_blank" rel="noreferrer" className="veille-source">
          {t('veille.ouvrirSource')}
        </a>
        <button
          type="button"
          className="veille-prompter"
          onClick={() => onPrompter(candidat)}
          disabled={candidat.statut === 'perime'}
          title={candidat.statut === 'perime' ? t('veille.raisonPerime') : undefined}
        >
          {t('veille.prompter')}
        </button>
        <button
          type="button"
          onClick={() => onEcarter(candidat)}
          disabled={candidat.statut === 'ecarte' || candidat.statut === 'perime'}
        >
          {t('veille.ecarter')}
        </button>
      </div>
    </li>
  )
}

export function VeilleCandidatsSection({
  charger,
  marquer,
  prompter,
  generer,
  ouvrirConversationScout
}: VeilleCandidatsSectionProps): React.JSX.Element {
  const { t } = useTextesTickets()
  const [stock, setStock] = useState<StockVeille>()
  const [erreur, setErreur] = useState<string>()
  const [voirEcartes, setVoirEcartes] = useState(false)
  /** Ce qu'un clic n'a PAS fait, dit en clair : un bouton muet se lirait comme une panne. */
  const [avis, setAvis] = useState<string>()
  // Par défaut on trie par pertinence : la vue existe pour décider quoi reprendre en premier.
  const [tri, setTri] = useState<TriVeille>('pertinence')

  const lire = useCallback(async (): Promise<void> => {
    const lecteur = charger ?? ((): Promise<StockVeille> => window.api.veilleSnapshot())
    try {
      setStock(await lecteur())
      setErreur(undefined)
    } catch (cause) {
      // Une lecture en échec est NOMMÉE : sans ça, la vue afficherait une liste vide, donc « rien de neuf ».
      setErreur(cause instanceof Error ? cause.message : String(cause))
    }
  }, [charger])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void lire()
  }, [lire])

  const [generation, setGeneration] = useState(false)
  const genererPlus = useCallback(async (): Promise<void> => {
    // La vue ne fabrique aucun candidat : elle déclenche la passe interne côté main, dont le
    // contrôle de citation reste l'unique chemin d'écriture — puis elle RELIT le stock.
    const lanceur =
      generer ??
      ((conversationId?: string): Promise<unknown> => window.api.veilleGenerer(conversationId))
    setGeneration(true)
    try {
      // La conversation est créée et OUVERTE d'abord : l'utilisateur regarde le scout travailler.
      const conversationId = await (ouvrirConversationScout ?? ouvrirConversationScoutParDefaut)()
      await lanceur(conversationId)
      await lire()
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setGeneration(false)
    }
  }, [generer, ouvrirConversationScout, lire])

  const changerStatut = async (
    candidat: CandidatVeille,
    statut: StatutMarquable
  ): Promise<void> => {
    const ecrivain =
      marquer ?? ((id: string, s: StatutMarquable) => window.api.veilleMarquer(id, s))
    setStock(await ecrivain(candidat.id, statut))
  }

  if (erreur) {
    return (
      <section className="veille" data-testid="veille-section">
        <p className="veille-message is-error" role="alert" data-testid="veille-erreur">
          {t('veille.illisible', { erreur })}
        </p>
      </section>
    )
  }

  if (!stock) {
    return (
      <section className="veille" data-testid="veille-section">
        <p className="veille-message" role="status" data-testid="veille-attente">
          <Spinner /> {t('veille.lecture')}
        </p>
      </section>
    )
  }

  // Écartés et périmés sont masqués ensemble par défaut : ni l'un ni l'autre n'est à reprendre.
  const masque = (c: CandidatVeille): boolean => c.statut === 'ecarte' || c.statut === 'perime'
  const visibles = trierParPertinence(
    stock.candidats.filter((c) => voirEcartes || !masque(c)),
    tri
  )
  const ajouts = visibles.filter((c) => c.type === 'ajout')
  // `autre` va avec les corrections : ce n'est pas un ajout prouvé, donc il n'a rien à faire dans la
  // colonne où l'on va piocher ce qu'on implémente.
  const corrections = visibles.filter((c) => c.type !== 'ajout')
  /**
   * Prompter RE-LIT le stock d'abord : c'est cette lecture qui re-vérifie, côté main, que la ligne
   * citée est encore dans son fichier. La vue peut être ouverte depuis des heures — le défaut a pu
   * être corrigé entre l'affichage et le clic (cas réel : conv-947, servi trois semaines après).
   */
  const lancerPrompt = async (candidat: CandidatVeille): Promise<void> => {
    const lecteur = charger ?? ((): Promise<StockVeille> => window.api.veilleSnapshot())
    let frais: StockVeille
    try {
      frais = await lecteur()
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
      return
    }
    setStock(frais)
    const actuel = frais.candidats.find((c) => c.id === candidat.id)
    if (!actuel || actuel.statut === 'perime') {
      setAvis(
        actuel
          ? t('veille.nonEnvoye', { titre: candidat.titre, raison: t('veille.raisonPerime') })
          : t('veille.horsStock', { titre: candidat.titre })
      )
      return
    }
    setAvis(undefined)
    void (prompter ?? prompterParDefaut)(actuel)
    void changerStatut(actuel, 'prompte')
  }
  const ecartes = stock.candidats.filter((c) => c.statut === 'ecarte').length
  const perimes = stock.candidats.filter((c) => c.statut === 'perime').length
  const masques = [
    ...(ecartes > 0
      ? [t(ecartes > 1 ? 'veille.masques.ecartes' : 'veille.masques.ecarte', { n: ecartes })]
      : []),
    ...(perimes > 0
      ? [t(perimes > 1 ? 'veille.masques.perimes' : 'veille.masques.perime', { n: perimes })]
      : [])
  ].join(' · ')

  return (
    <section className="veille" data-testid="veille-section">
      <header className="veille-head">
        <div className="veille-compte" data-testid="veille-compte">
          <b>{visibles.length}</b>
          <span>{visibles.length === 1 ? t('veille.candidat') : t('veille.candidats')}</span>
        </div>
        <div className="veille-meta">
          {stock.dernierePasse ? (
            <span data-testid="veille-derniere-passe">
              {t('veille.derniereLecture', { date: formaterDate(stock.dernierePasse) })}
            </span>
          ) : (
            // Jamais lu ≠ rien trouvé. Le dire évite de prendre une veille jamais lancée pour un calme plat.
            <span data-testid="veille-jamais-lue">{t('veille.jamaisLue')}</span>
          )}
          <label className="veille-tri">
            {t('veille.trierPar')}
            <select
              value={tri}
              onChange={(e) => setTri(e.target.value as TriVeille)}
              data-testid="veille-tri"
            >
              <option value="pertinence">{t('veille.tri.pertinence')}</option>
              <option value="date">{t('veille.tri.date')}</option>
            </select>
          </label>
          {masques && (
            <button type="button" onClick={() => setVoirEcartes((v) => !v)}>
              {voirEcartes ? t('veille.masquer') : t('veille.voir')} {masques}
            </button>
          )}
          <button type="button" onClick={() => void lire()} data-testid="veille-actualiser">
            {t('veille.actualiser')}
          </button>
          <button
            type="button"
            className="veille-generer"
            onClick={() => void genererPlus()}
            disabled={generation}
            data-testid="veille-generer"
            title={t('veille.genererTitre')}
          >
            {generation ? (
              <>
                <Spinner /> {t('veille.generation')}
              </>
            ) : (
              t('veille.generer')
            )}
          </button>
        </div>
      </header>

      {avis && (
        <p className="veille-message" role="status" data-testid="veille-avis">
          {avis}
        </p>
      )}

      {stock.echecs.length > 0 && (
        <div className="veille-echecs" role="alert" data-testid="veille-echecs">
          <strong>
            {t(stock.echecs.length > 1 ? 'veille.echecs.plusieurs' : 'veille.echecs.un', {
              n: stock.echecs.length
            })}
          </strong>
          <ul>
            {stock.echecs.map((echec) => (
              <li key={`${echec.concurrent}:${echec.url}`}>
                {echec.concurrent} — {echec.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="veille-message" data-testid="veille-vide">
          {t('veille.vide')}
        </p>
      ) : (
        /*
          DEUX colonnes : ce qui s'ajoute d'un côté, ce qui se corrige de l'autre.
          Les deux sont utiles pour des raisons différentes — un ajout se reprend, une correction dit où
          un concurrent bute. Les mélanger noyait les ajouts : mesuré, 19 corrections pour 2 ajouts dans
          un seul changelog.
        */
        <div className="veille-colonnes" data-testid="veille-colonnes">
          <div className="veille-colonne" data-testid="veille-colonne-ajouts">
            <h3>
              {t('veille.nouveautes')} <b>{ajouts.length}</b>
            </h3>
            {ajouts.length === 0 ? (
              <p className="veille-message">{t('veille.aucunAjout')}</p>
            ) : (
              <ul className="veille-liste" data-testid="veille-liste">
                {ajouts.map((candidat) => (
                  <LigneCandidat
                    key={candidat.id}
                    candidat={candidat}
                    onPrompter={(c) => void lancerPrompt(c)}
                    onEcarter={(c) => void changerStatut(c, 'ecarte')}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="veille-colonne" data-testid="veille-colonne-corrections">
            <h3>
              {t('veille.corrections')} <b>{corrections.length}</b>
            </h3>
            {corrections.length === 0 ? (
              <p className="veille-message">{t('veille.aucuneCorrection')}</p>
            ) : (
              <ul className="veille-liste" data-testid="veille-liste-corrections">
                {corrections.map((candidat) => (
                  <LigneCandidat
                    key={candidat.id}
                    candidat={candidat}
                    onPrompter={(c) => void lancerPrompt(c)}
                    onEcarter={(c) => void changerStatut(c, 'ecarte')}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
