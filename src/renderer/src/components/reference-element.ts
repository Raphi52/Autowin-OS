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

const C = 'src/renderer/src/components/'

type Bloc = { libelle: string; source: string }

/** Nature d'un point du rail (`rail-du-tour.ts`, `NatureDuNoeud`) → ce que l'utilisateur voit. */
const BLOCS_DU_TOUR: Record<string, Bloc> = {
  tour: { libelle: 'en-tête du tour', source: `${C}ChatMessageRow.tsx` },
  texte: { libelle: 'texte de la réponse', source: `${C}ChatMessageRow.tsx` },
  reponse: { libelle: 'réponse finale du tour', source: `${C}ChatMessageRow.tsx` },
  actions: {
    libelle: 'bloc d’activité du tour (actions, raisonnement, travaux confiés)',
    source: `${C}ChatView.parts.tsx`
  },
  image: { libelle: 'image ou fichier montré dans le tour', source: `${C}ArtifactPile.tsx` },
  juge: { libelle: 'bloc des juges', source: `${C}JugesPanel.tsx` }
}

/** Valeurs de `data-origine` posées sur les racines des grands blocs du chat. */
const ORIGINES: Record<string, Bloc> = {
  'reponse-agent': { libelle: 'réponse de l’agent', source: `${C}ChatMessageRow.tsx` },
  'message-utilisateur': { libelle: 'ton message', source: `${C}ChatMessageRow.tsx` },
  saisie: { libelle: 'zone de saisie', source: `${C}ChatComposer.tsx` }
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
  const morceaux: string[] = []

  const texte = texteVisible(cible)
  if (texte) morceaux.push(`élément pointé : « ${texte} »`)

  const bouton = cible.closest('button, a, summary, [role="button"]')
  const nomDuBouton = bouton?.getAttribute('title') ?? bouton?.getAttribute('aria-label')
  if (bouton && nomDuBouton && nomDuBouton !== texte) {
    const desactive =
      bouton.hasAttribute('disabled') || bouton.getAttribute('aria-disabled') === 'true'
    morceaux.push(`bouton « ${nomDuBouton} »${desactive ? ' (désactivé)' : ''}`)
  }

  const classe = cible.closest('[class]')?.classList[0]
  if (classe) morceaux.push(`classe ${classe}`)

  const bloc = BLOCS_DU_TOUR[attributProche(cible, 'data-nature') ?? '']
  if (bloc) morceaux.push(`bloc : ${bloc.libelle} (${bloc.source})`)

  const repere = attributProche(cible, 'data-testid')
  if (repere && repere !== 'rail-noeud') morceaux.push(`repère ${repere}`)

  const cleOrigine = attributProche(cible, 'data-origine')
  if (cleOrigine) {
    const origine = ORIGINES[cleOrigine]
    // La source du message n'est redite que si le bloc n'en a pas déjà donné une, plus précise.
    morceaux.push(
      origine
        ? `dans : ${origine.libelle}${bloc ? '' : ` (${origine.source})`}`
        : `dans : ${cleOrigine}`
    )
  }

  // Le journal d'un tour COPIÉ par une branche reste rangé sous le fil d'origine.
  const fil = attributProche(cible, 'data-fil-du-tour') ?? contexte.conversationId
  if (fil) morceaux.push(`fil ${fil}`)
  const tour = attributProche(cible, 'data-turn-id')
  if (tour) morceaux.push(`tour ${tour}`)

  return `C’est quoi ça ? [${morceaux.join(' · ')}]`
}
