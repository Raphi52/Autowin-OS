/**
 * LE PANNEAU D'OUTIL À DROITE DU FIL : un seul à la fois, navigateur intégré ou Bureaux cachés —
 * à 1280 px les deux ensemble ne laissent plus de place au fil.
 *
 * CHAQUE FIL RETIENT LE SIEN. Le panneau ouvert dans le fil A n'a rien à faire dans le fil B :
 * tenu comme une seule valeur pour toute la vue, il suivait l'utilisateur d'un fil à l'autre — le
 * navigateur surgissait vide (« Aucune page ouverte ») dans un fil neuf, et les Bureaux cachés
 * s'ouvraient dans des fils qui n'avaient lancé aucun bureau (« Aucun bureau caché dans ce fil »).
 * D'où un panneau par fil : il se cache quand on quitte le fil et revient avec lui.
 *
 * Deux places ne sont pas des fils : le fil pas encore créé (« Nouveau fil »), dont le panneau
 * passe au fil que crée le premier envoi, et la mosaïque, qui montre plusieurs fils à la fois et
 * n'a donc qu'un panneau pour elle seule.
 */
export type OutilDuPanneau = 'navigateur' | 'bureaux'

/** L'outil ouvert dans chaque place ; une place absente n'en a aucun. */
export type PanneauxParFil = Readonly<Record<string, OutilDuPanneau>>

export const AUCUN_PANNEAU: PanneauxParFil = {}

/** Places hors fil : entre parenthèses, elles ne peuvent pas être un identifiant `conv-NNN`. */
export const PLACE_FIL_NEUF = '(fil neuf)'
export const PLACE_MOSAIQUE = '(mosaïque)'

/** La place dont l'écran montre le panneau : la mosaïque, sinon le fil affiché, sinon le fil neuf. */
export function placeDuPanneau(conversationId: string | null, mosaique: boolean): string {
  if (mosaique) return PLACE_MOSAIQUE
  return conversationId ?? PLACE_FIL_NEUF
}

/** Rend le même objet quand rien ne change : React n'a alors rien à redessiner. */
export function ouvrirDans(
  panneaux: PanneauxParFil,
  place: string,
  outil: OutilDuPanneau
): PanneauxParFil {
  return panneaux[place] === outil ? panneaux : { ...panneaux, [place]: outil }
}

export function fermerDans(panneaux: PanneauxParFil, place: string): PanneauxParFil {
  if (!(place in panneaux)) return panneaux
  const reste = { ...panneaux }
  delete reste[place]
  return reste
}

/** Le navigateur ne vit que dans un vrai fil : sans fil, il n'a pas d'onglets à montrer. */
export function navigateurOuvertDans(
  panneaux: PanneauxParFil,
  conversationId: string | null
): boolean {
  return conversationId !== null && panneaux[conversationId] === 'navigateur'
}

export function bureauxOuvertsDans(panneaux: PanneauxParFil, place: string): boolean {
  return panneaux[place] === 'bureaux'
}

/**
 * Bouton du globe et Ctrl+Shift+B : ferme le navigateur s'il est ouvert dans ce fil, l'y ouvre
 * sinon, à la place des Bureaux cachés. Sans fil ouvert, rien ne change.
 */
export function basculerNavigateurDans(
  panneaux: PanneauxParFil,
  conversationId: string | null
): PanneauxParFil {
  if (conversationId === null) return panneaux
  return navigateurOuvertDans(panneaux, conversationId)
    ? fermerDans(panneaux, conversationId)
    : ouvrirDans(panneaux, conversationId, 'navigateur')
}

export function basculerBureauxDans(panneaux: PanneauxParFil, place: string): PanneauxParFil {
  return bureauxOuvertsDans(panneaux, place)
    ? fermerDans(panneaux, place)
    : ouvrirDans(panneaux, place, 'bureaux')
}

/** Le premier envoi crée le fil : le panneau ouvert sur le fil neuf passe à lui, et la place se vide. */
export function adopterLeFilNeuf(panneaux: PanneauxParFil, conversationId: string): PanneauxParFil {
  const outil = panneaux[PLACE_FIL_NEUF]
  if (!outil) return panneaux
  return ouvrirDans(fermerDans(panneaux, PLACE_FIL_NEUF), conversationId, outil)
}

/*
 * CE QUE L'AGENT OUVRE NE S'IMPOSE PLUS À L'ÉCRAN (2026-11-19 : « quand un bureau caché se lance,
 * au lieu de m'ouvrir le panel, ça doit me mettre un petit 1 rouge sous l'icône ; pareil pour les
 * navigateurs ouverts »). Un bureau lancé ou une page ouverte par l'agent ne déploie plus le panneau :
 * il ajoute 1 au compteur de l'icône du fil, que l'ouverture du panneau remet à zéro. Un panneau déjà
 * ouvert sur cet outil montre la nouveauté lui-même : rien à compter.
 * Le fil neuf n'a jamais de compteur : ni bureau guetté ni onglet sans fil créé.
 */

/** Nouveautés pas encore vues, par place puis par outil ; une place ou un outil absent vaut 0. */
export type NouveautesParFil = Readonly<
  Record<string, Readonly<Partial<Record<OutilDuPanneau, number>>>>
>

/**
 * Panneaux et compteurs dans UN état : ouvrir un panneau efface son compteur dans le même geste,
 * sans effet qui le rattraperait au rendu suivant (le compteur se verrait une image de trop).
 */
export interface OutilsDuFil {
  panneaux: PanneauxParFil
  nouveautes: NouveautesParFil
}

export const OUTILS_AU_REPOS: OutilsDuFil = { panneaux: AUCUN_PANNEAU, nouveautes: {} }

export function nouveautesDans(
  outils: OutilsDuFil,
  place: string | null,
  outil: OutilDuPanneau
): number {
  return place === null ? 0 : (outils.nouveautes[place]?.[outil] ?? 0)
}

/** Pose les panneaux suivants : chacun de ceux qui sont ouverts remet son compteur à zéro. */
export function poserLesPanneaux(outils: OutilsDuFil, panneaux: PanneauxParFil): OutilsDuFil {
  if (panneaux === outils.panneaux) return outils
  return { panneaux, nouveautes: oublierLesOuverts(outils.nouveautes, panneaux) }
}

/** Ajoute `combien` à l'icône de l'outil, sauf si son panneau est déjà ouvert dans cette place. */
export function signalerDans(
  outils: OutilsDuFil,
  place: string,
  outil: OutilDuPanneau,
  combien = 1
): OutilsDuFil {
  if (combien <= 0 || outils.panneaux[place] === outil) return outils
  const dejaLa = outils.nouveautes[place] ?? {}
  return {
    ...outils,
    nouveautes: {
      ...outils.nouveautes,
      [place]: { ...dejaLa, [outil]: (dejaLa[outil] ?? 0) + combien }
    }
  }
}

/** Rend le même objet quand rien n'est à effacer, pour ne rien redessiner. */
function oublierLesOuverts(
  nouveautes: NouveautesParFil,
  panneaux: PanneauxParFil
): NouveautesParFil {
  let suivantes: Record<string, Partial<Record<OutilDuPanneau, number>>> | null = null
  for (const [place, outil] of Object.entries(panneaux)) {
    if (!nouveautes[place]?.[outil]) continue
    suivantes ??= { ...nouveautes }
    const reste = { ...suivantes[place] }
    delete reste[outil]
    if (Object.keys(reste).length) suivantes[place] = reste
    else delete suivantes[place]
  }
  return suivantes ?? nouveautes
}
