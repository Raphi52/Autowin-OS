/**
 * Extraction de la RECOMMANDATION, ISOLEE du composant.
 *
 * Un fichier de composants qui exporte AUSSI une fonction casse le rafraichissement a chaud :
 * `vite-plugin-react` refuse le module (« Could not Fast Refresh ») et invalide son PARENT — tout
 * l'arbre React est remonte et l'etat local perdu (mesure du 2026-09-02 dans le journal du serveur
 * de dev). Le `eslint-disable` qui vivait ici faisait taire l'avertissement sans regler le defaut.
 */

/** Les autres en-tetes du bloc de cloture : ils BORNENT la rubrique « Recommandé ». */
const AUTRE_EN_TETE = /^\s*(?:✅|⚠️?|📍|⏳|👉)/u

/** Ligne technique du prompt pre-garni : ce n'est pas le texte de la rubrique. */
const LIGNE_TECHNIQUE = /^\s*AUTOWIN_PROMPT_V1\s*:/u

function nettoyer(texte: string): string {
  return texte
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[>*•\-–—]\s+/u, '')
    .trim()
}

/**
 * Extrait la RECOMMANDATION (rubrique « 👉 Recommandé » du bloc de cloture) d'une reponse.
 * Rend le texte de l'etape recommandee (sans le libelle, sans le gras markdown), ou null.
 * Sert de ghost-text pre-rempli dans le composer du chat (accepte par Tab).
 *
 * DEFAUT VECU (conv-159, saisie ts=1788413714805) : la rubrique peut etre ecrite en TITRE NU, son
 * contenu sur les lignes SUIVANTES. L'ancienne version ne lisait que la ligne du titre et rendait
 * donc le mot « Recommandé » — le mode auto l'a envoye comme ordre (un tour paye pour du bruit),
 * et le garde-fou d'arret n'a jamais vu le « rien » ecrit juste en dessous. On lit donc la
 * rubrique ENTIERE, et un titre sans contenu rend null.
 */
export function extractRecommendation(text: string): string | null {
  const lignes = text.split('\n')
  for (let i = 0; i < lignes.length; i++) {
    const line = lignes[i].trim()
    if (!line.startsWith('👉') || !/Recommand[ée]/u.test(line)) continue
    const m = line.match(/Recommand[ée]\**\s*(?:[:：]|[—–-])\s*(.+)$/u)
    if (m) return nettoyer(m[1]) || null
    // Titre nu : le contenu vit en dessous, jusqu'a la rubrique suivante.
    for (let j = i + 1; j < lignes.length; j++) {
      const suivante = lignes[j]
      if (AUTRE_EN_TETE.test(suivante)) break
      if (LIGNE_TECHNIQUE.test(suivante)) break
      const nu = nettoyer(suivante)
      if (nu) return nu
    }
    return null
  }
  return null
}
