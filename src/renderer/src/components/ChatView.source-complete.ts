import { readFileSync } from 'node:fs'

/**
 * Le code de ChatView.tsx a été découpé en fichiers voisins, déplacé tel quel. Les tests
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
  './chat-view-liste.tsx',
  './chat-view-section-fil.tsx',
  './chat-view-entete.tsx',
  './chat-view-fil-messages.tsx',
  './chat-view-saisie.tsx',
  './chat-view-cartes.tsx',
  './chat-view-panneau-liste.tsx',
  './chat-view-menus.tsx',
  './chat-view-mode-auto.ts',
  './chat-view-suggestions.ts',
  './chat-view-bandeaux.ts',
  './chat-view-affichage-liste.ts',
  './chat-view-recus.ts',
  './chat-view-panneau-runs.ts',
  './chat-view-panneau-outils.ts',
  './chat-view-passage.ts',
  './chat-view-modele.ts',
  './chat-view-brouillons.ts',
  './chat-view-file-attente.ts',
  './chat-view-fil.ts',
  './chat-view-montage.ts',
  './chat-view-ecouteurs.ts',
  './chat-view-gestes-fil.ts',
  './chat-view-gestes-liste.ts',
  './chat-view-gestes-mosaique.ts',
  './tenir-ref-a-jour.ts'
]

export function lireSourceDuChatView(): string {
  return MORCEAUX_DU_CHAT_VIEW.map((chemin) =>
    readFileSync(new URL(chemin, import.meta.url), 'utf8')
  ).join('\n')
}
