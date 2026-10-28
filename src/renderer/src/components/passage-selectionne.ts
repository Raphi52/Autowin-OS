/**
 * RÉPONDRE À UN PASSAGE SÉLECTIONNÉ (conv-1038, 2026-10-21).
 *
 * Pourquoi : pour contester un point d'une longue réponse, l'utilisateur le RETAPAIT — le fil ne
 * gérait aucune sélection (`getSelection` absent de `ChatView*.tsx` et `ChatMessageRow*.tsx`, relevé
 * du scout conv-1038). La barre flottante (`BarrePassage.tsx`) pose le passage dans la saisie ;
 * c'est l'utilisateur qui envoie, rien ne part tout seul.
 *
 * Ce module est PUR (hors `passageDuFil`, qui lit une `Selection` qu'on lui donne) : la vue ne fait
 * qu'appliquer.
 */
import { langueCourante } from '../langue'
import { traduireChatFil } from '../textes-ecrans/chat-fil'

export type ActionPassage = 'citer' | 'detaille' | 'faux' | 'retenir'

/** Les gestes de la barre, dans l'ordre d'affichage. */
export const ACTIONS_PASSAGE: ReadonlyArray<{
  action: ActionPassage
  libelle: string
  titre: string
}> = [
  // Libellé et titre lus À L'AFFICHAGE, dans la langue de l'interface (conv-1170) : la barre qui
  // les montre se redessine quand la langue change. Les textes que le geste pose dans la saisie
  // (`texteDeLActionSurPassage`) restent en français : c'est une consigne envoyée à l'agent.
  {
    action: 'citer',
    get libelle() {
      return traduireChatFil('passage.citer', langueCourante())
    },
    get titre() {
      return traduireChatFil('passage.citer.titre', langueCourante())
    }
  },
  {
    action: 'detaille',
    get libelle() {
      return traduireChatFil('passage.detaille', langueCourante())
    },
    get titre() {
      return traduireChatFil('passage.detaille.titre', langueCourante())
    }
  },
  {
    action: 'faux',
    get libelle() {
      return traduireChatFil('passage.faux', langueCourante())
    },
    get titre() {
      return traduireChatFil('passage.faux.titre', langueCourante())
    }
  },
  {
    action: 'retenir',
    get libelle() {
      return traduireChatFil('passage.retenir', langueCourante())
    },
    get titre() {
      return traduireChatFil('passage.retenir.titre', langueCourante())
    }
  }
]

function enCitation(passage: string): string {
  return passage
    .split(/\r?\n/u)
    .map((ligne) => `> ${ligne}`.trimEnd())
    .join('\n')
}

/** Le texte que le geste pose dans la saisie. */
export function texteDeLActionSurPassage(action: ActionPassage, passage: string): string {
  const cite = enCitation(passage)
  switch (action) {
    case 'citer':
      // La ligne vide finale laisse le curseur prêt à écrire SOUS la citation.
      return `${cite}\n\n`
    case 'detaille':
      return `Détaille ce passage :\n${cite}`
    case 'faux':
      return `Ce passage me paraît faux — vérifie-le et corrige-le :\n${cite}`
    case 'retenir':
      return `Retiens ça pour la suite — dépose-le en mémoire :\n${cite}`
  }
}

/** Un brouillon déjà écrit n'est JAMAIS écrasé : l'ajout vient après une ligne vide. */
export function ajouterAuBrouillon(brouillon: string, ajout: string): string {
  const garde = brouillon.trimEnd()
  return garde ? `${garde}\n\n${ajout}` : ajout
}

function elementDe(noeud: Node | null): Element | null {
  if (!noeud) return null
  return noeud.nodeType === Node.ELEMENT_NODE ? (noeud as Element) : noeud.parentElement
}

/**
 * Le passage sélectionné, s'il est un passage DU FIL : ses deux bouts dans `fil`, chacun à
 * l'intérieur d'un message (`.msg`). Une sélection vide, hors d'un message (bandeau d'erreur,
 * squelette de chargement) ou qui déborde du fil vers la saisie ne donne rien.
 */
export function passageDuFil(selection: Selection | null, fil: Element | null): string | null {
  if (!selection || !fil || selection.rangeCount === 0 || selection.isCollapsed) return null
  for (const bout of [selection.anchorNode, selection.focusNode]) {
    const element = elementDe(bout)
    if (!element || !fil.contains(element)) return null
    const message = element.closest('.msg')
    if (!message || !fil.contains(message)) return null
  }
  // ENTIER : l'utilisateur a choisi ce passage à la souris. Avant conv-1228 (2026-10-28), il était
  // coupé à 4 000 caractères, et la citation perdait sa fin — souvent le point à contester. La seule
  // borne qui reste est celle de l'envoi d'un message (ipc-guards.ts), qui refuse en le disant.
  const texte = selection.toString().trim()
  return texte || null
}
