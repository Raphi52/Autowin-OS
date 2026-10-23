/**
 * VUE « CARTE DU PROJET » — la carte des besoins (conv-1089, 2026-10-22).
 *
 * Demande d'origine : « une vue qui agrège les étapes de la carte du fil de toutes les conversations,
 * avec l'état prouvé de chaque demande et les runs bloqués, sans aucun appel de modèle ». Le calcul
 * vit dans le processus principal (`src/main/carte-des-besoins.ts`) ; ici, l'en-tête et la rivière.
 *
 * Depuis le 23/10 (conv-1113) : « il doit y avoir que ce board dans la view, supprime tout ce qui
 * est en dessous, et la vue n'est pas scrollable verticalement, on peut scroll que le kanban ». La
 * fiche d'un dépôt (/draft conv-1102), la liste « Toutes les demandes », ses filtres et son pied
 * sont retirés ; la vue ne défile plus, seul le tableau de la rivière défile (`RiviereDuProjet`).
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  cleDeLaDemande,
  type CarteDesBesoins,
  type DemandeDeLaCarte,
  type WorkItemDeLaDemande
} from '../../../shared/carte-des-besoins'
import { RiviereDuProjet } from './RiviereDuProjet'
import type { SourceDeTache } from './TachesDeLaDemande'
import { ViewTopBar } from './ViewTopBar'
import { deposerOuvertureConversation } from './pending-conversation-open'
import { useVerificationDuBoard } from './verification-du-board'
import './ViewPage.css'
import './CarteDesBesoinsView.css'

/** Le mot accordé au compte : « 1 prouvée », « 2 prouvées ». */
function accord(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return n > 1 ? plurielForme : singulier
}

export function CarteDesBesoinsView({
  active,
  onOpenConversation
}: {
  active: boolean
  onOpenConversation: (target: { conversationId: string }) => void
}): React.JSX.Element {
  const [carte, setCarte] = useState<CarteDesBesoins | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      setCarte(await window.api.carteDesBesoins())
      setErreur(null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setChargement(false)
    }
  }, [])
  // « Vérifier » / « Tout vérifier » du Board (conv-1136) : `/check` dans le fil, carte relue pendant le tour.
  const verifier = useVerificationDuBoard(active, carte, charger)

  // Relue à chaque retour sur l'onglet : le calcul ne refait que les fils qui ont bougé.
  // Work items (conv-1127) : ce que la passe de lecture des `#1234` n'a pas pu faire, dit en clair.
  const [avisTaches, setAvisTaches] = useState<string | null>(null)
  // Les sources de tickets configurées (conv-1127) : à partir de deux, « + task » propose de choisir.
  const [sourcesDesTaches, setSourcesDesTaches] = useState<SourceDeTache[]>([])

  useEffect(() => {
    if (!active || typeof window.api.ticketSources !== 'function') return
    let annule = false
    window.api
      .ticketSources()
      .then((liste) => {
        if (!annule)
          setSourcesDesTaches(liste.map((s) => ({ id: s.profile.id, label: s.profile.label })))
      })
      .catch(() => {
        // Liste illisible : pas de choix affiché ; avec une seule source le rattachement marche
        // quand même, avec plusieurs le processus principal refuse et le dit.
      })
    return () => {
      annule = true
    }
  }, [active])

  /**
   * Une passe de lecture des fiches nommées par les prompts (`#1234`, titres des fils de la vue
   * Tickets), bornée côté processus principal. Elle pose un lien seulement si la fiche existe ; si
   * elle a lu quelque chose, la carte est recalculée UNE fois.
   */
  const verifierLesTaches = useCallback(async () => {
    if (typeof window.api.carteVerifierMentions !== 'function') return
    try {
      const bilan = await window.api.carteVerifierMentions()
      setAvisTaches(
        bilan.injoignable ? 'source de tickets injoignable : liens #1234 non vérifiés' : null
      )
      if (bilan.lues > bilan.introuvables) await charger()
    } catch (e) {
      setAvisTaches(`tasks non vérifiées : ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [charger])

  useEffect(() => {
    // Même chargement à l'activation que la vue Tests : l'état posé par `charger` vient d'un appel
    // asynchrone, il ne boucle pas. Puis la lecture des `#1234` (conv-1127), après le calcul.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void charger().then(verifierLesTaches)
  }, [active, charger, verifierLesTaches])

  const lierWorkItem = useCallback(
    async (d: DemandeDeLaCarte, saisie: string, sourceId?: string) => {
      const resultat = await window.api.carteLierWorkItem({
        conversationId: d.conversationId,
        demande: cleDeLaDemande(d),
        saisie,
        ...(sourceId ? { sourceId } : {})
      })
      if (resultat.ok) await charger()
      return resultat
    },
    [charger]
  )

  const delierWorkItem = useCallback(
    async (d: DemandeDeLaCarte, w: WorkItemDeLaDemande) => {
      const resultat = await window.api.carteDelierWorkItem({
        conversationId: d.conversationId,
        demande: cleDeLaDemande(d),
        sourceId: w.sourceId,
        id: w.id
      })
      if (resultat.ok) await charger()
      else setAvisTaches(resultat.raison)
    },
    [charger]
  )

  const ouvrir = useCallback(
    (conversationId: string) => {
      // Chat jamais monté : son écouteur n'existe pas encore, la demande est déposée pour lui.
      deposerOuvertureConversation(conversationId)
      onOpenConversation({ conversationId })
    },
    [onOpenConversation]
  )

  return (
    <section className="view-page besoins-view" data-testid="besoins-view" data-active={active}>
      <ViewTopBar
        eyebrow="PROJET"
        title="Board"
        description="Tes fils posés au jour de leur dernière demande, un étage par état prouvé. Calculé sans modèle, à partir des fils."
        actions={
          <span className="besoins-entete">
            {carte && (
              <span className="besoins-stats" data-testid="besoins-stats">
                <span>
                  <b>{carte.demandes}</b> {accord(carte.demandes, 'demande')}
                </span>
                <span>
                  <b className="is-ok">{carte.comptes.prouve}</b>{' '}
                  {accord(carte.comptes.prouve, 'prouvée')}
                </span>
                <span>
                  <b className="is-err">{carte.comptes.refuse}</b>{' '}
                  {accord(carte.comptes.refuse, 'refusée')}
                </span>
                {carte.runsBloques > 0 && (
                  <span className="is-alerte">
                    <b>{carte.runsBloques}</b>{' '}
                    {accord(carte.runsBloques, 'run bloqué', 'runs bloqués')}
                  </span>
                )}
                {avisTaches && (
                  <span className="is-alerte" data-testid="besoins-avis-taches">
                    {avisTaches}
                  </span>
                )}
              </span>
            )}
            <button
              type="button"
              className="btn btn-sm"
              data-testid="besoins-actualiser"
              disabled={chargement}
              onClick={() => void charger()}
            >
              {chargement ? 'Calcul…' : 'Actualiser'}
            </button>
          </span>
        }
      />

      {erreur && (
        <p className="besoins-erreur" role="alert" data-testid="besoins-erreur">
          Carte impossible à calculer : {erreur}
        </p>
      )}

      {!carte && !erreur && <p className="besoins-vide">Calcul de la carte…</p>}

      {/* LA RIVIÈRE (/draft conv-1113) : seule dans la vue ; elle prend toute la hauteur restante et
          son tableau est le seul endroit qui défile. */}
      {carte && (
        <RiviereDuProjet
          carte={carte}
          ouvrir={ouvrir}
          lierWorkItem={lierWorkItem}
          delierWorkItem={delierWorkItem}
          sourcesDesTaches={sourcesDesTaches}
          verifier={verifier}
        />
      )}
    </section>
  )
}
