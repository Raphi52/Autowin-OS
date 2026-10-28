/**
 * Carte de confirmation « Supprimer la conversation ? » / « Supprimer N conversations ? »
 * (conv-1078, 2026-10-22 : /draft « une plus jolie popup pour quand je supprime les convs », puis
 * « 4 et 5 mais adapté en fonction du theme », puis « Implémenter la 2 · En-tête en ligne »).
 *
 * Ce qu'elle montre, et pourquoi :
 *  - un EN-TÊTE EN LIGNE : la tuile corbeille à gauche, le surtitre chiffré (fils, messages) et le
 *    titre à droite — plus compact que l'ancienne orbite posée au-dessus du titre ;
 *  - les fils NOMMÉS avec leur nombre de messages : on voit CE qui part avant de cliquer. Au-delà de
 *    trois fils, les deux premiers puis une ligne « + N autres » (la carte ne s'allonge pas) ;
 *  - le bouton irréversible en PLEINE LARGEUR au-dessus de « Garder », qui garde le focus.
 * Une seule conversation = la même carte, avec une liste d'une ligne.
 *
 * Aucune couleur écrite ici : la carte passe par les jetons du thème (`--chat-suppr-*`, ChatView.css)
 * et garde la classe commune `.delete-confirm-card`, que chaque thème habille. Holographique y ajoute
 * le cadre nacré et le bouton en gel (theme-nebuleuse-verre.css, bloc « CARTE DE SUPPRESSION DES FILS »),
 * repris tel quel par Holographique blanc, généré depuis ce fichier.
 *
 * Rendue dans `body` (portail) : posée dans le panneau du chat, elle restait SOUS la poignée de
 * largeur de la liste des fils (`.conv-pane-resizer`, z-index 4 dans la couche de la coque, quand la
 * carte, z-index 90, n'en avait que dans celle du chat) — un filet clair traversait la carte, et un
 * clic sur ces 9 px de « Supprimer » tombait sur la poignée (mesuré par `elementsFromPoint`,
 * conv-1078). Ses couleurs viennent toutes de `:root` : le portail ne lui fait rien perdre.
 */

import { createPortal } from 'react-dom'
import { useTextesChatFil } from '../textes-ecrans/chat-fil'
import { resumerSuppression, type FilASupprimer } from './suppression-conversations'

function CorbeilleIcone(): React.JSX.Element {
  // Trait en dégradé : ses deux arrêts sont peints par le thème (`.delete-confirm-tuile stop`).
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="suppr-fils-trait" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="delete-confirm-tuile-arret-a" />
          <stop offset="1" className="delete-confirm-tuile-arret-b" />
        </linearGradient>
      </defs>
      <path
        d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"
        fill="none"
        stroke="url(#suppr-fils-trait)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SuppressionConversationsCarte({
  fils,
  total,
  erreur,
  onGarder,
  onSupprimer
}: {
  fils: readonly FilASupprimer[]
  /** Nombre de conversations visées ; 1 = la carte d'une seule conversation. */
  total: number
  erreur?: string | null
  onGarder: () => void
  onSupprimer: () => void
}): React.JSX.Element {
  const { t } = useTextesChatFil()
  const resume = resumerSuppression(fils, total)
  const lot = total > 1
  const surtitre = lot
    ? t('suppression.surtitreLot', { total, messages: resume.messages })
    : // « CONVERSATION · n MSG » se lit tel quel en anglais : aucune traduction à porter.
      `CONVERSATION · ${resume.messages} MSG`
  return createPortal(
    <div className="delete-confirm-layer" role="presentation" onClick={onGarder}>
      <section
        className="delete-confirm-card delete-confirm-card--fils"
        role="dialog"
        aria-modal="true"
        aria-labelledby="suppr-fils-titre"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="delete-confirm-tete">
          <span className="delete-confirm-tuile" aria-hidden="true">
            <CorbeilleIcone />
          </span>
          <div className="delete-confirm-tete-texte">
            <span className="delete-confirm-kicker">{surtitre}</span>
            <h2 id="suppr-fils-titre">
              {lot ? t('suppression.titreLot', { total }) : t('suppression.titre')}
            </h2>
          </div>
        </div>
        <ul className="delete-confirm-fils" aria-label={t('suppression.liste')}>
          {resume.lignes.map((ligne) => (
            <li key={ligne.id} className="delete-confirm-fil">
              <span className="delete-confirm-fil-titre" title={ligne.titre}>
                {ligne.titre}
              </span>
              <span className="delete-confirm-fil-nombre">{ligne.messages} msg</span>
            </li>
          ))}
          {resume.autres && (
            <li className="delete-confirm-fil delete-confirm-fil--autres">
              <span className="delete-confirm-fil-titre">
                + {resume.autres.nombre}{' '}
                {resume.autres.nombre > 1 ? t('suppression.autres') : t('suppression.autre')}
              </span>
              <span className="delete-confirm-fil-nombre">{resume.autres.messages} msg</span>
            </li>
          )}
        </ul>
        <p>{lot ? t('suppression.detailLot') : t('suppression.detail')}</p>
        {erreur && <p className="c-danger">{erreur}</p>}
        <div className="delete-confirm-actions delete-confirm-actions--pile">
          <button className="btn delete-confirm-danger delete-confirm-gel" onClick={onSupprimer}>
            {lot ? t('suppression.supprimerLot', { total }) : t('suppression.supprimer')}
          </button>
          <button className="btn delete-confirm-cancel" onClick={onGarder} autoFocus>
            {lot ? t('suppression.garderLot') : t('suppression.garder')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
