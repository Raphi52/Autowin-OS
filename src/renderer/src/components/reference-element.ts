/**
 * L'ÉLÉMENT CIBLÉ — la référence exacte d'un élément de l'écran (conv-1038, 2026-10-21 ; étendue à
 * toute l'app, avec styles et composant, conv-1338, 2026-10-30).
 *
 * Pourquoi : ~6 % des messages de l'utilisateur (71 sur 1 197, relevé du scout conv-1038) portent
 * sur l'app elle-même — « c'est quoi ce bloc chelou ? », « pk le bouton joindre fichier est
 * grisé » — et 163 retouches d'octobre décrivent un endroit en mots. Un Alt+clic pose à la place une
 * référence que l'agent sait suivre : le texte affiché, le bloc et son fichier source, le composant,
 * le repère de test, la classe (cherchables par grep), le fil et le tour
 * (`turn-journals/<fil>/<tour>.jsonl`), puis les styles calculés.
 *
 * La phrase est NEUTRE : « C'est quoi ça ? » n'a jamais servi (0 occurrence sur 1 094 messages depuis
 * le 01/10, conv-1338), et une question contredisait un ordre comme « met une croix ici ».
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

const SELECTEUR_BOUTON = 'button, a, summary, [role="button"]'

/**
 * L'élément que la référence et la capture décrivent : le bouton ou le lien autour de la cible s'il
 * y en a un. Un clic tombe souvent sur son icône, un dessin de 12 px sans marge ni couleur utile.
 */
export function elementVise(cible: Element): Element {
  return cible.closest(SELECTEUR_BOUTON) ?? cible
}

type Fibre = { type?: unknown; return?: Fibre | null }
type PorteurDeNom = { displayName?: unknown; name?: unknown; type?: unknown; render?: unknown }

/** Assez de marches pour sortir des balises d'un composant, sans parcourir toute l'app. */
const MARCHES_MAX = 40

/** Le nom d'un type React : fonction ou classe, ou enveloppe `memo` / `forwardRef`. */
function nomDuType(type: unknown): string | undefined {
  if (!type || (typeof type !== 'object' && typeof type !== 'function')) return undefined
  const porteur: PorteurDeNom = type
  const nom = porteur.displayName ?? porteur.name
  if (typeof nom === 'string' && nom) return nom
  return nomDuType(porteur.type) ?? nomDuType(porteur.render)
}

/** La fibre React de l'élément ou de son plus proche parent qui en a une (SVG injecté…). */
function fibreDe(element: Element): Fibre | undefined {
  for (let noeud: Element | null = element; noeud; noeud = noeud.parentElement) {
    const entree = Object.entries(noeud).find(([nom]) => nom.startsWith('__reactFiber$'))
    const fibre: unknown = entree?.[1]
    if (typeof fibre === 'object' && fibre !== null) return fibre
  }
  return undefined
}

/**
 * Le composant React le plus proche. Le nom n'est fiable qu'avec le serveur de développement : une
 * version construite raccourcit les noms, et un nom faux enverrait l'agent au mauvais endroit.
 */
function composantDe(element: Element): string | undefined {
  if (!import.meta.env.DEV) return undefined
  let fibre = fibreDe(element)
  for (let marche = 0; fibre && marche < MARCHES_MAX; marche += 1) {
    const nom = nomDuType(fibre.type)
    if (nom && /^[A-Z]/u.test(nom)) return nom
    fibre = fibre.return ?? undefined
  }
  return undefined
}

/** Le premier fond opaque en remontant : un élément transparent montre celui de son parent. */
function fondEffectif(element: Element): string {
  for (let noeud: Element | null = element; noeud; noeud = noeud.parentElement) {
    const fond = getComputedStyle(noeud).backgroundColor
    if (fond && fond !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/u.test(fond)) return fond
  }
  return 'transparent'
}

/** Mêmes valeurs que l'élément choisi du navigateur intégré (`navigateur-page-script.ts`). */
function stylesDe(element: Element): Record<string, string> {
  const styles = getComputedStyle(element)
  return {
    police: styles.fontFamily.split(',')[0].replace(/["']/gu, '').trim(),
    taille: styles.fontSize,
    couleur: styles.color,
    fond: fondEffectif(element),
    marge: styles.margin,
    retrait: styles.padding
  }
}

/**
 * La référence à poser dans la saisie, ou `null` quand elle n'aurait rien à dire : dans un champ de
 * saisie, Alt+clic garde son usage de texte (sélection, curseur), et sur le fond de la page ou un
 * élément sans aucun indice, le clic reste ordinaire au lieu de poser une référence vide.
 */
export function referenceDeLElement(
  cible: Element,
  contexte: { conversationId: string | null }
): string | null {
  if (cible.matches('html, body')) return null
  if (cible.closest('textarea, input, select, [contenteditable="true"]')) return null
  const langue = langueCourante()
  const dire = (cle: CleChatFilsEtLots, valeurs?: Record<string, string>): string =>
    traduireChatFilsEtLots(cle, langue, valeurs)
  const morceaux: string[] = []

  const texte = texteVisible(cible)
  if (texte) morceaux.push(dire('reference.element', { texte }))

  const bouton = cible.closest(SELECTEUR_BOUTON)
  const nomDuBouton = bouton?.getAttribute('title') ?? bouton?.getAttribute('aria-label')
  const desactive =
    bouton?.hasAttribute('disabled') || bouton?.getAttribute('aria-disabled') === 'true'
  if (bouton && nomDuBouton && nomDuBouton !== texte) {
    morceaux.push(
      dire('reference.bouton', { nom: nomDuBouton }) +
        (desactive ? dire('reference.desactive') : '')
    )
  } else if (desactive) {
    morceaux.push(dire('reference.boutonDesactive'))
  }

  const classe = cible.closest('[class]')?.classList[0]
  if (classe) morceaux.push(dire('reference.classe', { classe }))

  const composant = composantDe(cible)
  if (composant) morceaux.push(dire('reference.composant', { composant }))

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

  // Rien de sûr sur l'élément lui-même : le fil seul ne désignerait rien.
  if (morceaux.length === 0) return null

  // Le journal d'un tour COPIÉ par une branche reste rangé sous le fil d'origine.
  const fil = attributProche(cible, 'data-fil-du-tour') ?? contexte.conversationId
  if (fil) morceaux.push(dire('reference.fil', { fil }))
  const tour = attributProche(cible, 'data-turn-id')
  if (tour) morceaux.push(dire('reference.tour', { tour }))

  morceaux.push(dire('reference.styles', stylesDe(elementVise(cible))))

  return dire('reference.cible', { morceaux: morceaux.join(' · ') })
}
