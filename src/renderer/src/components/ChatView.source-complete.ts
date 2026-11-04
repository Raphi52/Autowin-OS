import { readFileSync } from 'node:fs'

/**
 * Le code de ChatView.tsx a été découpé en fichiers voisins, déplacé tel quel (conv-1508). Les tests
 * qui vérifient la SOURCE du composant lisent donc le composant ET ses morceaux : un invariant
 * déplacé reste vérifié là où il vit maintenant, au lieu d'être perdu ou recopié.
 */
export const MORCEAUX_DU_CHAT_VIEW = [
  './ChatView.tsx',
  './chat-view-outils.tsx',
  './chat-view-flux-pilote.ts',
  './chat-view-defilement.ts',
  './chat-view-envoi.ts',
  './chat-view-reprise.ts',
  './chat-view-mosaique.tsx',
  './chat-view-liste.tsx'
]

export function lireSourceDuChatView(): string {
  return MORCEAUX_DU_CHAT_VIEW.map((chemin) =>
    readFileSync(new URL(chemin, import.meta.url), 'utf8')
  ).join('\n')
}
