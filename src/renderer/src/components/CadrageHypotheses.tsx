import { useState } from 'react'
import './AskDecision.css'
import './CadrageHypotheses.css'
import { amorceDeCorrection, type HypotheseDeCadrage } from '../../../shared/cadrage-confiance'
import { useTextesChatDecisions } from '../textes-ecrans/chat-decisions'

/*
 * Ce sur quoi le cadrage REPOSE sans l'avoir verifie — montre pendant le run, pas apres.
 *
 * POURQUOI CE N'EST PAS LE BLOC `ask`. La grammaire visuelle est la meme (pile de lignes, liseré or
 * qui pousse au survol, dépliable) et le CSS est litteralement partage. La SEMANTIQUE differe : un
 * `ask` fait choisir UNE option et le run attend ; ici on ne choisit rien, le run continue, et
 * chaque ligne offre de CORRIGER une supposition. Reutiliser `AskDecisionBlock` tel quel aurait
 * menti sur l'interaction — une ligne aurait eu l'air d'etre une reponse a donner.
 *
 * POURQUOI LE CLIC PREREMPLIT AU LIEU D'ENVOYER. Corriger une supposition demande de dire ce qui est
 * VRAI ; un clic ne le sait pas. Le composer recoit donc l'amorce et garde la main a l'utilisateur.
 *
 * POURQUOI UNE FLECHE ET PLUS UNE CROIX (demande du 19/10, conv-358). La croix faisait DISPARAITRE
 * le bloc ; l'utilisateur voulait seulement le REDUIRE a une ligne pendant qu'il travaille. La fleche
 * replie la liste et le pied sous la ligne de titre (bas = deplie, haut = replie), et la ligne garde
 * le compte des suppositions : rien n'est perdu, il se rouvre d'un clic. Le bloc disparait toujours
 * seul a la fin du run (ChatView, `orchestrate-end`).
 *
 * POURQUOI LE REPLI PEUT VENIR DU PARENT. Garde ici, il suivait l'INSTANCE, pas la conversation :
 * passer par un fil sans cadrage demontait le bloc (rouvert au retour), passer par un fil avec
 * cadrage reutilisait l'instance (le repli de A s'appliquait a B). ChatView le tient donc par fil
 * (`replie` + `onBasculerRepli`) ; sans ces props, le bloc garde son propre etat.
 */

export function CadrageHypotheses({
  hypotheses,
  onCorriger,
  replie: repliePilote,
  onBasculerRepli
}: {
  hypotheses: readonly HypotheseDeCadrage[]
  onCorriger?: (amorce: string) => void
  /** Repli tenu par le parent (par conversation). Absent : le bloc tient le sien. */
  replie?: boolean
  onBasculerRepli?: () => void
}): React.JSX.Element | null {
  const [deplie, setDeplie] = useState<ReadonlySet<number>>(() => new Set())
  const [replieLocal, setReplieLocal] = useState(false)
  const replie = repliePilote ?? replieLocal
  const { t } = useTextesChatDecisions()
  if (!hypotheses.length) return null
  const basculer = (index: number): void =>
    setDeplie((precedent) => {
      const suivant = new Set(precedent)
      if (!suivant.delete(index)) suivant.add(index)
      return suivant
    })

  return (
    <div
      className={`askd cadrage-hyp${replie ? ' is-replie' : ''}`}
      data-testid="cadrage-hypotheses"
    >
      <div className="askd-tete">
        <span className="askd-badge">{t('cadrage.badge')}</span>
        <span className="askd-question">{t('cadrage.question')}</span>
        {replie && (
          <span className="cadrage-hyp-compte">
            {t(hypotheses.length > 1 ? 'cadrage.compte.plusieurs' : 'cadrage.compte.un', {
              n: hypotheses.length
            })}
          </span>
        )}
        <button
          type="button"
          className="cadrage-hyp-plier"
          aria-expanded={!replie}
          aria-label={replie ? t('cadrage.deplierTout') : t('cadrage.reduire')}
          title={replie ? t('cadrage.deplier') : t('cadrage.reduire')}
          onClick={() =>
            onBasculerRepli ? onBasculerRepli() : setReplieLocal((valeur) => !valeur)
          }
        >
          {/* Chevron DESSINE comme celui des capsules du fil, pas un glyphe : bas ouvert, haut replie. */}
          <span className="cadrage-hyp-chevron" aria-hidden="true" />
        </button>
      </div>
      {!replie && (
        <div className="askd-liste">
          {hypotheses.map((hypothese, index) => {
            const ouvert = deplie.has(index)
            return (
              <div key={index} className="askd-item" data-testid="cadrage-hypothese">
                <div className="askd-ligne">
                  {/*
                   * Pas de triangle sans raison a montrer. Un deroulant qui s'ouvre sur la meme phrase
                   * toute faite a chaque ligne n'apprend rien — defaut vecu le 20/08.
                   */}
                  {hypothese.justification ? (
                    <button
                      type="button"
                      className="askd-tri"
                      aria-expanded={ouvert}
                      aria-label={ouvert ? t('cadrage.replier') : t('cadrage.deplier')}
                      onClick={() => basculer(index)}
                    >
                      {ouvert ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="askd-tri" aria-hidden="true">
                      ▸
                    </span>
                  )}
                  <button
                    type="button"
                    className="askd-choix"
                    onClick={() => onCorriger?.(amorceDeCorrection(hypothese))}
                  >
                    <span className="askd-libelle">{hypothese.affirmation}</span>
                    <span className="askd-consequence">{t(cleDeLaSource(hypothese.source))}</span>
                  </button>
                  <div className="askd-droite">
                    <span className="askd-entree">{t('cadrage.corriger')}</span>
                  </div>
                </div>
                {ouvert && hypothese.justification && (
                  <div className="askd-detail">
                    <div className="askd-q">
                      <b>{t('cadrage.pourquoi')}</b>
                      <p>{hypothese.justification}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!replie && (
        <div className="askd-pied">
          <span>{t('cadrage.pied.continue')}</span>
          <span>{t('cadrage.pied.correction')}</span>
        </div>
      )}
    </div>
  )
}

function cleDeLaSource(
  source: HypotheseDeCadrage['source']
): 'cadrage.source.confiance' | 'cadrage.source.besoin' {
  return source === 'confiance' ? 'cadrage.source.confiance' : 'cadrage.source.besoin'
}
