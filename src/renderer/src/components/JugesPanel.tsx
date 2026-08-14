import React, { useEffect, useState } from 'react'
import { extraireVotesJuges, type VoteJuge } from './juges-votes'
import './JugesPanel.css'

/**
 * LE PANNEAU DES JUGES — leurs décisions en barre, le verdict complet en dépliant, exactement
 * comme le panneau des candidats du scout (demande utilisateur du 14/08).
 *
 * Les votes viennent du fil de sous-agents persisté du run (`runTrace`) : un step `judge` par
 * membre du panel, avec `vote: VALIDE|DEFAUT` et le texte intégral ; un juge crashé est montré
 * en échec — il ne vote pas, et le cacher ferait croire à un quorum plus fort qu'il n'est.
 */
const LIBELLE_VOTE: Record<VoteJuge['vote'], string> = {
  valide: '✅ VALIDE',
  defaut: '❌ DÉFAUT',
  echec: '⚠️ ÉCHEC'
}

export function JugesPanel({
  conversationId,
  charger
}: {
  conversationId: string
  /** Injectable pour les tests : le vrai chargeur lit les runs de la conversation puis leur trace. */
  charger?: (conversationId: string) => Promise<VoteJuge[]>
}): React.JSX.Element | null {
  const [votes, setVotes] = useState<VoteJuge[] | undefined>()
  const [deplies, setDeplies] = useState<ReadonlySet<number>>(new Set())
  useEffect(() => {
    let vivant = true
    const chargeur = charger ?? chargerVotesParDefaut
    chargeur(conversationId)
      .then((resultat) => {
        if (vivant) setVotes(resultat)
      })
      .catch(() => {
        if (vivant) setVotes([])
      })
    return () => {
      vivant = false
    }
  }, [conversationId, charger])
  if (!votes || votes.length === 0) return null
  const valides = votes.filter((vote) => vote.vote === 'valide').length
  const deplier = (index: number): void => {
    setDeplies((courant) => {
      const suivant = new Set(courant)
      if (suivant.has(index)) suivant.delete(index)
      else suivant.add(index)
      return suivant
    })
  }
  return (
    <div className="jpan" data-testid="juges-panel">
      <div className="jpan-tete">
        <span className="jpan-kicker">Juges</span>
        <span className="jpan-compte">
          {valides}/{votes.length} VALIDE
        </span>
      </div>
      {votes.map((vote, index) => (
        <div key={`${vote.libelle}-${index}`} className="jpan-item" data-testid="jpan-ligne">
          <div className="jpan-ligne">
            <button
              type="button"
              className="jpan-deplier"
              data-testid="jpan-deplier"
              onClick={() => deplier(index)}
              aria-expanded={deplies.has(index)}
              title={deplies.has(index) ? 'Replier le verdict' : 'Déplier le verdict complet'}
            >
              {deplies.has(index) ? '▾' : '▸'}
            </button>
            <span className="jpan-juge" onClick={() => deplier(index)}>
              {vote.libelle}
            </span>
            <span className={`jpan-vote is-${vote.vote}`}>{LIBELLE_VOTE[vote.vote]}</span>
            {vote.costUsd !== undefined && (
              <span className="jpan-cout">{vote.costUsd.toFixed(2)} $</span>
            )}
          </div>
          {deplies.has(index) && (
            <div className="jpan-verdict" data-testid="jpan-verdict">
              <b>Verdict complet</b>
              <p>{vote.texte}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Le vrai chargeur : dernier run de la conversation → trace → votes des juges. */
async function chargerVotesParDefaut(conversationId: string): Promise<VoteJuge[]> {
  const runs = await window.api.conversationRuns?.(conversationId)
  const dernier = runs?.[0]?.path
  if (!dernier) return []
  const steps = await window.api.runTrace?.(dernier)
  if (!steps) return []
  return extraireVotesJuges(steps as never)
}
