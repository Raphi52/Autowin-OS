import { useCallback, useEffect, useState } from 'react'
import type { CandidatVeille } from '../../../main/veille/candidats'
import type { StockVeille } from '../../../main/veille/candidats-store'
import { trierParPertinence, type TriVeille } from './veille-tri'
import './VeilleCandidatsSection.css'

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
  marquer?: (id: string, statut: CandidatVeille['statut']) => Promise<StockVeille>
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

const LIBELLE_STATUT: Record<CandidatVeille['statut'], string> = {
  nouveau: 'nouveau',
  prompte: 'prompté',
  ecarte: 'écarté'
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
    title: `[veille] scout interne ${new Date().toLocaleString('fr-FR')}`.slice(0, 80),
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
  return (
    <li className={`veille-ligne is-${candidat.statut}`}>
      <div className="veille-ligne-tete">
        <span className="veille-concurrent">{candidat.concurrent}</span>
        <span className="veille-date">{candidat.dateSource}</span>
        {candidat.langue && <span className="veille-langue">{candidat.langue}</span>}
        {/* La note du scout, à côté du candidat : « lequel reprendre d'abord » se lit d'un coup. */}
        {candidat.pertinence !== undefined ? (
          <span
            className="veille-pertinence"
            data-testid="veille-pertinence"
            title="Pertinence pour Autowin, notée par le scout (0-100)"
          >
            <b>{candidat.pertinence}</b>
            <small>/100</small>
          </span>
        ) : (
          <span className="veille-pertinence is-absente" data-testid="veille-pertinence-absente">
            non noté
          </span>
        )}
        <span className={`veille-statut is-${candidat.statut}`}>
          {LIBELLE_STATUT[candidat.statut]}
        </span>
      </div>
      <strong className="veille-titre">{candidat.titre}</strong>
      {/* L'extrait lu, mot pour mot : c'est la preuve que la feature existe. */}
      <blockquote className="veille-citation">{candidat.citation}</blockquote>
      <div className="veille-actions">
        <a href={candidat.url} target="_blank" rel="noreferrer" className="veille-source">
          ouvrir la source
        </a>
        <button type="button" className="veille-prompter" onClick={() => onPrompter(candidat)}>
          Prompter dans Autowin
        </button>
        <button
          type="button"
          onClick={() => onEcarter(candidat)}
          disabled={candidat.statut === 'ecarte'}
        >
          Écarter
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
  const [stock, setStock] = useState<StockVeille>()
  const [erreur, setErreur] = useState<string>()
  const [voirEcartes, setVoirEcartes] = useState(false)
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
    statut: CandidatVeille['statut']
  ): Promise<void> => {
    const ecrivain =
      marquer ?? ((id: string, s: CandidatVeille['statut']) => window.api.veilleMarquer(id, s))
    setStock(await ecrivain(candidat.id, statut))
  }

  if (erreur) {
    return (
      <section className="veille" data-testid="veille-section">
        <p className="veille-message is-error" role="alert" data-testid="veille-erreur">
          Veille illisible : {erreur}
        </p>
      </section>
    )
  }

  if (!stock) {
    return (
      <section className="veille" data-testid="veille-section">
        <p className="veille-message" role="status" data-testid="veille-attente">
          Lecture des candidats…
        </p>
      </section>
    )
  }

  const visibles = trierParPertinence(
    stock.candidats.filter((c) => voirEcartes || c.statut !== 'ecarte'),
    tri
  )
  const ajouts = visibles.filter((c) => c.type === 'ajout')
  // `autre` va avec les corrections : ce n'est pas un ajout prouvé, donc il n'a rien à faire dans la
  // colonne où l'on va piocher ce qu'on implémente.
  const corrections = visibles.filter((c) => c.type !== 'ajout')
  const lancerPrompt = (candidat: CandidatVeille): void => {
    void (prompter ?? prompterParDefaut)(candidat)
    void changerStatut(candidat, 'prompte')
  }
  const ecartes =
    stock.candidats.length - stock.candidats.filter((c) => c.statut !== 'ecarte').length

  return (
    <section className="veille" data-testid="veille-section">
      <header className="veille-head">
        <div className="veille-compte" data-testid="veille-compte">
          <b>{visibles.length}</b>
          <span>{visibles.length === 1 ? 'candidat' : 'candidats'}</span>
        </div>
        <div className="veille-meta">
          {stock.dernierePasse ? (
            <span data-testid="veille-derniere-passe">
              dernière lecture&nbsp;: {new Date(stock.dernierePasse).toLocaleString('fr-FR')}
            </span>
          ) : (
            // Jamais lu ≠ rien trouvé. Le dire évite de prendre une veille jamais lancée pour un calme plat.
            <span data-testid="veille-jamais-lue">aucune lecture effectuée pour l’instant</span>
          )}
          <label className="veille-tri">
            trier par
            <select
              value={tri}
              onChange={(e) => setTri(e.target.value as TriVeille)}
              data-testid="veille-tri"
            >
              <option value="pertinence">pertinence</option>
              <option value="date">ordre de lecture</option>
            </select>
          </label>
          {ecartes > 0 && (
            <button type="button" onClick={() => setVoirEcartes((v) => !v)}>
              {voirEcartes ? 'masquer' : 'voir'} {ecartes} écarté{ecartes > 1 ? 's' : ''}
            </button>
          )}
          <button type="button" onClick={() => void lire()} data-testid="veille-actualiser">
            Actualiser
          </button>
          <button
            type="button"
            className="veille-generer"
            onClick={() => void genererPlus()}
            disabled={generation}
            data-testid="veille-generer"
            title="Scout interne : analyse les conversations loggées, les workflows et le code d’Autowin pour proposer de nouveaux candidats"
          >
            {generation ? 'Génération en cours…' : 'En générer plus'}
          </button>
        </div>
      </header>

      {stock.echecs.length > 0 && (
        <div className="veille-echecs" role="alert" data-testid="veille-echecs">
          <strong>
            {stock.echecs.length} source{stock.echecs.length > 1 ? 's' : ''} muette
            {stock.echecs.length > 1 ? 's' : ''} à la dernière lecture
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
          Aucun candidat. Une lecture n’a peut-être jamais été lancée, ou les sources n’annoncent
          rien.
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
              Nouveautés <b>{ajouts.length}</b>
            </h3>
            {ajouts.length === 0 ? (
              <p className="veille-message">Aucun ajout de capacité dans cette lecture.</p>
            ) : (
              <ul className="veille-liste" data-testid="veille-liste">
                {ajouts.map((candidat) => (
                  <LigneCandidat
                    key={candidat.id}
                    candidat={candidat}
                    onPrompter={lancerPrompt}
                    onEcarter={(c) => void changerStatut(c, 'ecarte')}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="veille-colonne" data-testid="veille-colonne-corrections">
            <h3>
              Corrections &amp; autres <b>{corrections.length}</b>
            </h3>
            {corrections.length === 0 ? (
              <p className="veille-message">Aucune correction relevée.</p>
            ) : (
              <ul className="veille-liste" data-testid="veille-liste-corrections">
                {corrections.map((candidat) => (
                  <LigneCandidat
                    key={candidat.id}
                    candidat={candidat}
                    onPrompter={lancerPrompt}
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
