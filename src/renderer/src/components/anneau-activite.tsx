/**
 * LE ROND DE VERRE ET SA LEGENDE — le cadre « Grand, deux lignes » du fil.
 *
 * Choix de l'utilisateur sur maquettes, conv-904 (2026-10-12, /draft « une nouvelle apparence pour
 * cette barre ») : « inspire toi du theme holo » -> « grand 2 lignes » -> « Legende » -> « Pleine
 * largeur » -> « go le 1 couleur sur l'exception et je veux aussi 2 lignes pour les boutons
 * raisonnement et actions ». Puis, sur le rendu : « le rond autour du chiffre est pas tres moderne
 * il fait tache et le highlight des actions verte rouge aussi est tres basique » -> « Rond de verre ».
 *
 * Ce que le dessin retient :
 * - a gauche, un ROND DE VERRE (reflet, nombre d'actions) ; plus d'anneau de couleur ;
 * - le rond est TEINTE par le verdict du groupe (« bof en vrai je preferais voir du vert et rouge
 *   la jme rend pas compte si un truc a rate ») : vert reussi, rouge echec, ambre attente, couleur
 *   du theme en cours. Une pastille de 9 px au coin, essayee avant, ne se voyait pas ;
 * - deux lignes a droite : la phrase d'etat entiere, puis la LEGENDE « couleur sur l'exception » (un
 *   outil reussi reste gris sans point) et le VERDICT en capsule de verre a deux cases, dont le code
 *   est teinte vert ou rouge.
 *
 * Les couleurs sont des JETONS (anneau-activite.css, a partir des jetons du theme) : le meme dessin
 * vaut pour tous les themes, comme les capsules du fil.
 */
import React from 'react'
import './anneau-activite.css'
import {
  ANIMATIONS_D_ATTERRISSAGE,
  casesDuVerdict,
  groupesDeLegende,
  verdictDuRond,
  type Atterrissage,
  type EtatArc,
  type OutilDeLegende
} from './anneau-activite-calcul'

/**
 * Le rond de verre : le nombre d'actions, TEINTE par le verdict du groupe — vert reussi, rouge en
 * echec, ambre en attente, couleur du theme en cours (« je preferais voir du vert et rouge »).
 */
export function RondDuCompte({
  etats,
  testid
}: {
  etats: readonly EtatArc[]
  testid?: string
}): React.JSX.Element {
  return (
    <span
      className="anneau-rond rond-compte"
      data-etats={etats.join(' ')}
      data-verdict={verdictDuRond(etats)}
      aria-hidden="true"
      {...(testid ? { 'data-testid': testid } : {})}
    >
      <span className="anneau-nombre">{etats.length}</span>
    </span>
  )
}

/**
 * Le meme emplacement, pour un bloc sans compte (Raisonnement) : le rond degrade et son icone.
 * Avec `etats` (capsule d'orchestration, conv-909 : « ce bloc orchestration doit etre comme celui de
 * Actions »), le rond garde son icone mais prend la TEINTE du verdict, comme le rond de compte :
 * vert reussi, rouge echec, ambre attente — le nombre de phases ne dirait rien de plus.
 */
export function RondDIcone({
  children,
  etats,
  atterrissage,
  onAtterri,
  testid
}: {
  children: React.ReactNode
  etats?: readonly EtatArc[]
  /** Le verdict qui « atterrit » : reflet ou secousse, au passage de fin du run (conv-981). */
  atterrissage?: Atterrissage | null
  /** Appele a la fin de l'effet, pour retirer la marque (sinon un retour d'onglet le rejouerait). */
  onAtterri?: () => void
  testid?: string
}): React.JSX.Element {
  return (
    <span
      className="anneau-rond"
      aria-hidden="true"
      {...(etats ? { 'data-etats': etats.join(' '), 'data-verdict': verdictDuRond(etats) } : {})}
      {...(atterrissage
        ? {
            'data-atterrissage': atterrissage,
            onAnimationEnd: (event: React.AnimationEvent) => {
              if (ANIMATIONS_D_ATTERRISSAGE.includes(event.animationName)) onAtterri?.()
            }
          }
        : {})}
      {...(testid ? { 'data-testid': testid } : {})}
    >
      {children}
    </span>
  )
}

/** La legende des outils, « couleur sur l'exception ». */
export function LegendeDesOutils({
  outils
}: {
  outils: readonly OutilDeLegende[]
}): React.JSX.Element {
  return (
    <>
      {groupesDeLegende(outils).map((groupe, i) => (
        <span
          key={`${groupe.nom}-${i}`}
          className="legende-outil"
          data-etat={groupe.etat}
          data-testid="legende-outil"
        >
          {groupe.etat !== 'ok' && <span className="legende-point" aria-hidden="true" />}
          {groupe.nom}
          {groupe.fois > 1 && <b className="legende-fois"> ×{groupe.fois}</b>}
        </span>
      ))}
    </>
  )
}

/**
 * Le verdict en CAPSULE DE VERRE a deux cases : la commande, puis le code. La fleche reste dans le
 * texte (copie, infobulle, lecteur d'ecran lisent « npm test → exit 1 ») ; a l'ecran, c'est le filet
 * entre les deux cases qui la remplace.
 */
export function VerdictDeVerre({
  label,
  etat
}: {
  label: string
  etat: string
}): React.JSX.Element {
  const { commande, code } = casesDuVerdict(label)
  return (
    <span className={`activity-outcome st-${etat}`} data-testid="activity-outcome" title={label}>
      {commande && (
        <>
          <span className="verdict-commande">{commande}</span>
          <span className="verdict-fleche"> → </span>
        </>
      )}
      <span className="verdict-code">{code}</span>
    </span>
  )
}
