/**
 * Parse le markdown d'un retour "scout" (suggestions groupées) en un ARRAY structuré, pour le rendre
 * comme une vraie grille de chips CLIQUABLES au lieu de `code`-spans inertes dans du texte.
 *
 * Format reconnu (celui que scout émet aujourd'hui) :
 *   3 jeux proposés :
 *   A — Découverte/onboarding
 *   `Que peux-tu faire ?` · `Crée ma première conversation` · ...
 *   B — Pilotage-agents avancé (score le plus haut)
 *   `Mets le juge sur codex` · ...
 *
 * → groupes { key:'A', title:'Découverte/onboarding', subtitle?, items:[{label}] } où le label EST
 * le prompt à renvoyer au clic. PUR (aucune dépendance) → testable directement.
 *
 * Anti-faux-positif : ne matche QUE si (≥2 groupes) OU (une amorce « …proposés/jeux/suggestions »
 * en tête ET un groupe d'au moins 2 items).
 *
 * ET le message doit être ENTIÈREMENT à ce format : chaque ligne non vide est l'amorce (première
 * ligne seulement, terminée par « : »), un titre de groupe, ou une ligne faite UNIQUEMENT de
 * pastilles. Une seule autre ligne (prose, puce, bloc de code) → null. Pourquoi : la grille
 * REMPLACE le texte du message (chat-view-model.ts). conv-1014 : une réponse ordinaire a disparu
 * derrière 8 pastilles — « proposer » passait pour l'amorce, la ligne mermaid « G -- oui --> » pour
 * un titre, et les noms de fichiers des puces suivantes pour des pastilles.
 */

export interface SuggestionItem {
  /** Texte de la chip = prompt renvoyé au clic. */
  label: string
}
export interface SuggestionGroup {
  key: string
  title: string
  subtitle?: string
  items: SuggestionItem[]
}

const GROUP_HEADER = /^([A-Z])\s*[—–-]\s*(.+)$/
const CODE_SPAN = /`([^`]+)`/g
/** Une ligne de pastilles ne contient QUE des `…`, séparés par des espaces ou « · ». */
const CHIP_LINE = /^`[^`]+`(?:[\s·•]*`[^`]+`)*$/
const INTRO_CUE = /\b(propos|jeux|suggest)/i

function splitTitleSubtitle(raw: string): { title: string; subtitle?: string } {
  const m = /^(.+?)\s*\((.+)\)\s*$/.exec(raw.trim())
  if (m) return { title: m[1].trim(), subtitle: m[2].trim() }
  return { title: raw.trim() }
}

export function parseScoutSuggestions(text: string): SuggestionGroup[] | null {
  const lines = text
    .split('\n')
    .map((raw) => raw.trim())
    .filter(Boolean)
  const intro = INTRO_CUE.test(lines[0] ?? '') && (lines[0] ?? '').endsWith(':')
  const groups: SuggestionGroup[] = []
  let current: SuggestionGroup | null = null

  for (const [rang, line] of lines.entries()) {
    if (rang === 0 && intro) continue
    const header = GROUP_HEADER.exec(line)
    // Un en-tête de groupe ne contient pas de chip inline (sinon c'est une ligne d'items).
    if (header && !line.includes('`')) {
      const { title, subtitle } = splitTitleSubtitle(header[2])
      current = { key: header[1], title, subtitle, items: [] }
      groups.push(current)
      continue
    }
    // Ni amorce, ni titre, ni ligne de pastilles sous un titre : ce message n'est pas une grille.
    if (!current || !CHIP_LINE.test(line)) return null
    const codes = [...line.matchAll(CODE_SPAN)].map((m) => m[1].trim()).filter(Boolean)
    for (const c of codes) current.items.push({ label: c })
  }

  const valid = groups.filter((g) => g.items.length > 0)
  if (!valid.length) return null
  const enough = valid.length >= 2 || (intro && valid.some((g) => g.items.length >= 2))
  return enough ? valid : null
}
