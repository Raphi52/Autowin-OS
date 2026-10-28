/**
 * « C'EST QUOI ÇA ? » — la référence exacte d'un élément de l'écran (conv-1038, 2026-10-21).
 *
 * Pourquoi : ~6 % des messages de l'utilisateur (71 sur 1 197, relevé du scout conv-1038) portent
 * sur l'app elle-même — « c'est quoi ce bloc chelou ? », « pk le bouton joindre fichier est
 * grisé » — et il devait DÉCRIRE ce qu'il voyait. Un Alt+clic pose à la place une référence que
 * l'agent sait suivre : le texte affiché, le bloc et son fichier source, le repère de test, la classe
 * (cherchables par grep), le fil et le tour (`turn-journals/<fil>/<tour>.jsonl`).
 *
 * Les étiquettes lues ici existent déjà dans le fil : `data-nature` sur chaque point du rail d'un
 * tour (`ChatMessageRow.tsx`, `noeud`) ; `data-origine`, `data-turn-id`, `data-message-id` et
 * `data-fil-du-tour` sur la racine des messages, `data-origine` sur la saisie. Rien n'est deviné : un élément sans étiquette garde seulement
 * ce qui est sûr.
 */

import { langueCourante } from '../langue'
import { traduireChatFilsEtLots, type CleChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'

const C = 'src/renderer/src/components/'

/*
 * La référence est la question de l'UTILISATEUR, posée dans son message : elle suit la langue de
 * l'écran (traduction anglaise, conv-1170). Ce que l'agent cherche par grep — chemins, classes,
 * repères de test, identifiants de fil et de tour — reste tel quel.
 */
type Bloc = { libelle: CleChatFilsEtLots; source: string }

/** Nature d'un point du rail (`rail-du-tour.ts`, `NatureDuNoeud`) → ce que l'utilisateur voit. */
const BLOCS_DU_TOUR: Record<string, Bloc> = {
  tour: { libelle: 'reference.blocs.tour', source: `${C}ChatMessageRow.tsx` },
  texte: { libelle: 'reference.blocs.texte', source: `${C}ChatMessageRow.tsx` },
  reponse: { libelle: 'reference.blocs.reponse', source: `${C}ChatMessageRow.tsx` },
  actions: { libelle: 'reference.blocs.actions', source: `${C}ChatView.parts.tsx` },
  image: { libelle: 'reference.blocs.image', source: `${C}ArtifactPile.tsx` },
  juge: { libelle: 'reference.blocs.juge', source: `${C}JugesPanel.tsx` }
}

/** Valeurs de `data-origine` posées sur les racines des grands blocs du chat. */
const ORIGINES: Record<string, Bloc> = {
  'reponse-agent': { libelle: 'reference.origine.reponse-agent', source: `${C}ChatMessageRow.tsx` },
  'message-utilisateur': {
    libelle: 'reference.origine.message-utilisateur',
    source: `${C}ChatMessageRow.tsx`
  },
  saisie: { libelle: 'reference.origine.saisie', source: `${C}ChatComposer.tsx` }
}

const LONGUEUR_MAX_TEXTE = 120

function texteVisible(element: Element): string {
  const texte = (element.textContent ?? '').replace(/\s+/gu, ' ').trim()
  return texte.length > LONGUEUR_MAX_TEXTE
    ? `${texte.slice(0, LONGUEUR_MAX_TEXTE - 1).trimEnd()}…`
    : texte
}

/** Le plus proche ancêtre (lui compris) qui porte l'attribut, et sa valeur. */
function attributProche(element: Element, attribut: string): string | undefined {
  return element.closest(`[${attribut}]`)?.getAttribute(attribut) ?? undefined
}

/**
 * La référence à poser dans la saisie, ou `null` dans un champ de saisie : Alt+clic y garde son
 * usage de texte (sélection, curseur), et la zone qu'on écrit n'a pas à se décrire elle-même.
 */
export function referenceDeLElement(
  cible: Element,
  contexte: { conversationId: string | null }
): string | null {
  if (cible.closest('textarea, input, select, [contenteditable="true"]')) return null
  const langue = langueCourante()
  const dire = (cle: CleChatFilsEtLots, valeurs?: Record<string, string>): string =>
    traduireChatFilsEtLots(cle, langue, valeurs)
  const morceaux: string[] = []

  const texte = texteVisible(cible)
  if (texte) morceaux.push(dire('reference.element', { texte }))

  const bouton = cible.closest('button, a, summary, [role="button"]')
  const nomDuBouton = bouton?.getAttribute('title') ?? bouton?.getAttribute('aria-label')
  if (bouton && nomDuBouton && nomDuBouton !== texte) {
    const desactive =
      bouton.hasAttribute('disabled') || bouton.getAttribute('aria-disabled') === 'true'
    morceaux.push(
      dire('reference.bouton', { nom: nomDuBouton }) +
        (desactive ? dire('reference.desactive') : '')
    )
  }

  const classe = cible.closest('[class]')?.classList[0]
  if (classe) morceaux.push(dire('reference.classe', { classe }))

  const bloc = BLOCS_DU_TOUR[attributProche(cible, 'data-nature') ?? '']
  if (bloc)
    morceaux.push(dire('reference.bloc', { libelle: dire(bloc.libelle), source: bloc.source }))

  const repere = attributProche(cible, 'data-testid')
  if (repere && repere !== 'rail-noeud') morceaux.push(dire('reference.repere', { repere }))

  const cleOrigine = attributProche(cible, 'data-origine')
  if (cleOrigine) {
    const origine = ORIGINES[cleOrigine]
    // La source du message n'est redite que si le bloc n'en a pas déjà donné une, plus précise.
    morceaux.push(
      dire('reference.dans', {
        origine: origine
          ? `${dire(origine.libelle)}${bloc ? '' : ` (${origine.source})`}`
          : cleOrigine
      })
    )
  }

  // Le journal d'un tour COPIÉ par une branche reste rangé sous le fil d'origine.
  const fil = attributProche(cible, 'data-fil-du-tour') ?? contexte.conversationId
  if (fil) morceaux.push(dire('reference.fil', { fil }))
  const tour = attributProche(cible, 'data-turn-id')
  if (tour) morceaux.push(dire('reference.tour', { tour }))

  return dire('reference.question', { morceaux: morceaux.join(' · ') })
}
