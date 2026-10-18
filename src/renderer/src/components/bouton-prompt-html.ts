/**
 * BOUTON « PROMPTER » D'UN BLOC ```html-render``` (conv-302, 2026-10-17 : « et faut un bouton pour
 * prompter au lieu du bloc ask »).
 *
 * Une galerie /draft montre ses propositions dans un carrousel (scripts/draft-carrousel.mjs). Le choix
 * se faisait ensuite dans un bloc `ask` SOUS la galerie : on regarde la proposition à un endroit, on la
 * choisit à un autre. Le bouton vit maintenant DANS le bloc, à côté de la proposition.
 *
 * Le fil n'exécute aucun script (chat-html-inline.ts) : le bouton est un simple lien
 * `<a href="#autowin-prompt">Affiner la 3 · Éditorial</a>`, qui passe le filtre tel quel (une ancre
 * interne). C'est la ligne de message (ChatMessageRow) qui intercepte le clic et l'envoie par le MÊME
 * chemin qu'une réponse `ask` (`onAnswerAsk`) : un message ordinaire, avec ses autorisations ordinaires.
 *
 * Confiance : exactement celle d'une option `ask`, écrite elle aussi par le modèle.
 *   - CE QUI PART EST CE QUI EST ÉCRIT : le message envoyé est le libellé VISIBLE du lien, jamais une
 *     charge cachée dans un attribut. L'utilisateur lit sur le bouton ce qu'il va envoyer.
 *   - Rien ne part pendant le tour (mêmes raisons que le bloc `ask`, ChatMessageRow) ;
 *   - un bloc dont un bouton a déjà été envoyé est fermé, de façon durable (`askReponseDuFil`).
 */

/** L'ancre qui marque un bouton « prompter ». */
export const ANCRE_PROMPT = '#autowin-prompt'

/** Au-delà, ce n'est plus un choix mais un texte : le bouton est ignoré. */
export const LONGUEUR_MAX_PROMPT = 300

export function normaliserPrompt(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim()
}

/**
 * Le prompt porté par la cible d'un clic : le libellé visible d'un lien `#autowin-prompt` situé DANS un
 * bloc html-render du fil. `null` pour tout autre clic — un lien Markdown ordinaire n'est pas un bouton.
 */
export function promptDuClic(cible: EventTarget | null): string | null {
  const noeud = cible as Node | null
  const element =
    noeud && noeud.nodeType === 1 ? (noeud as Element) : (noeud?.parentElement ?? null)
  const lien = element?.closest(`a[href="${ANCRE_PROMPT}"]`)
  if (!lien || !lien.closest('[data-testid="chat-inline-html"]')) return null
  const texte = normaliserPrompt(lien.textContent ?? '')
  return texte && texte.length <= LONGUEUR_MAX_PROMPT ? texte : null
}

const ENTITES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, code: string) => {
    if (code[0] !== '#') return ENTITES[code.toLowerCase()] ?? tout
    const valeur =
      code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return Number.isFinite(valeur) ? String.fromCodePoint(valeur) : tout
  })
}

/**
 * Les prompts que portent les boutons d'un texte de réponse, relus dans la SOURCE (pas le DOM) : le fil
 * s'en sert pour savoir, même après un redémarrage, qu'un bouton a déjà été envoyé. Même libellé que
 * `promptDuClic` : balises retirées, entités décodées, blancs réduits.
 */
export function promptsDesBoutons(texte: string): string[] {
  if (!texte.includes(ANCRE_PROMPT)) return []
  const prompts: string[] = []
  for (const lien of texte.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']#autowin-prompt["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const prompt = normaliserPrompt(decoderEntites(lien[1].replace(/<[^>]*>/g, '')))
    if (prompt && prompt.length <= LONGUEUR_MAX_PROMPT) prompts.push(prompt)
  }
  return prompts
}
