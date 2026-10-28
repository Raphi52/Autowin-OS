/**
 * LES BOUTONS « VÉRIFIER » DU BOARD (conv-1136, 2026-10-23) — le calcul et le pourquoi vivent dans
 * `verification-du-board.ts` ; ici, seulement ce qui se clique.
 *
 * Deux gestes par post-it de la ligne « À vérifier », et un pour toute la ligne :
 *   - « Vérifier » : envoie `/check` dans le fil — le post-it ne quitte la ligne que par la preuve ;
 *   - « Vérifié à la main » : le pose en « Fait » sans preuve (comme le glisser, sur ce poste) ;
 *   - « Tout vérifier · N » : `/check` dans les N fils de la ligne affichés, après une confirmation
 *     qui dit le nombre — chaque envoi est un tour de modèle payé.
 */
import React, { useState } from 'react'
import { langueCourante } from '../langue'
import {
  traduireBoardEtMaintenance,
  useTextesBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'
import type { PostItDeLaRiviere } from './carte-riviere'
import { resumeDuBilan, type BilanDeVerification } from './verification-du-board'
import './VerificationDuBoard.css'

export type Verifier = (conversationIds: readonly string[]) => Promise<BilanDeVerification>

/** « Tout vérifier · N » dans la barre du tableau, avec sa confirmation sur place. */
export function ToutVerifier({
  aVerifier,
  verifier
}: {
  aVerifier: readonly PostItDeLaRiviere[]
  verifier: Verifier
}): React.JSX.Element {
  const { t } = useTextesBoardEtMaintenance()
  const [etape, setEtape] = useState<'repos' | 'confirmer' | 'envoi'>('repos')
  const [bilan, setBilan] = useState<string | null>(null)
  const n = aVerifier.length

  const lancer = async (): Promise<void> => {
    setEtape('envoi')
    try {
      setBilan(resumeDuBilan(await verifier(aVerifier.map((p) => p.conversationId))))
    } catch (e) {
      setBilan(
        traduireBoardEtMaintenance('verif.aucunLanceErreur', langueCourante(), {
          erreur: e instanceof Error ? e.message : String(e)
        })
      )
    } finally {
      setEtape('repos')
    }
  }

  return (
    <span className="riviere-tout-verifier">
      {etape === 'confirmer' ? (
        <span role="group" aria-label={t('verif.confirmer')}>
          <span className="riviere-tout-verifier-question">
            {t(n > 1 ? 'verif.question.plusieurs' : 'verif.question.un', { n })}
          </span>
          <button
            type="button"
            className="riviere-puce is-actif"
            data-testid="riviere-tout-verifier-confirmer"
            onClick={() => void lancer()}
          >
            {t('verif.lancer')}
          </button>
          <button type="button" className="riviere-puce" onClick={() => setEtape('repos')}>
            {t('commun.annuler')}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="riviere-puce"
          data-testid="riviere-tout-verifier"
          disabled={n === 0 || etape === 'envoi'}
          title={n === 0 ? t('verif.aucunPostit') : t('verif.toutAide', { n })}
          onClick={() => {
            setBilan(null)
            setEtape('confirmer')
          }}
        >
          {etape === 'envoi' ? t('verif.envoi') : t('verif.tout', { n })}
        </button>
      )}
      {bilan && (
        <span
          className="riviere-tout-verifier-bilan"
          role="status"
          data-testid="riviere-verif-bilan"
        >
          {bilan}
        </span>
      )}
    </span>
  )
}

/**
 * « Vérifier » et « Vérifié à la main » pour UN post-it : sur le post-it (variante `postit`, posée
 * par la rivière sur le coin du post-it — un bouton ne se met pas DANS un bouton —, montrée quand
 * `visible` : survol ou fiche ouverte) et dans sa fiche (variante `fiche`, libellés entiers).
 */
export function GestesDeVerification({
  postit,
  verifier,
  aLaMain,
  variante,
  style,
  visible,
  onEntrer,
  onSortir
}: {
  postit: PostItDeLaRiviere
  verifier?: Verifier
  aLaMain: () => void
  variante: 'postit' | 'fiche'
  style?: React.CSSProperties
  visible?: boolean
  /** Le pointeur arrive sur les gestes / les quitte : garde le survol du post-it ouvert. */
  onEntrer?: () => void
  onSortir?: () => void
}): React.JSX.Element {
  const { t } = useTextesBoardEtMaintenance()
  const [envoi, setEnvoi] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)
  const court = variante === 'postit'

  const lancer = async (): Promise<void> => {
    if (!verifier) return
    setEnvoi(true)
    setRefus(null)
    try {
      const bilan = await verifier([postit.conversationId])
      if (bilan.echecs.length > 0) setRefus(bilan.echecs[0].raison)
    } catch (e) {
      setRefus(e instanceof Error ? e.message : String(e))
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <span
      className={`riviere-verif riviere-verif-${variante}`}
      data-testid={`riviere-verif-${variante}`}
      // Pas `data-conversation` : c'est le sélecteur du post-it lui-même, dans les tests et la vue.
      data-verif-conversation={postit.conversationId}
      data-visible={visible || undefined}
      style={style}
      onPointerEnter={onEntrer}
      onPointerLeave={onSortir}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      {verifier && (
        <button
          type="button"
          className="riviere-verif-bouton"
          data-testid="riviere-verifier"
          disabled={envoi}
          title={t('verif.aide')}
          onClick={(e) => {
            e.stopPropagation()
            void lancer()
          }}
        >
          {envoi ? t('verif.envoi') : court ? t('verif.court') : t('verif.long')}
        </button>
      )}
      <button
        type="button"
        className="riviere-verif-bouton"
        data-testid="riviere-verifie-a-la-main"
        title={t('verif.aideALaMain')}
        onClick={(e) => {
          e.stopPropagation()
          aLaMain()
        }}
      >
        {court ? t('verif.mainCourt') : t('verif.mainLong')}
      </button>
      {refus && (
        <span className="riviere-verif-refus" role="alert">
          {t('verif.refus', { raison: refus })}
        </span>
      )}
    </span>
  )
}
