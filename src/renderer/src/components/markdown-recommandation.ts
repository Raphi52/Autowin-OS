/**
 * Extraction de la RECOMMANDATION, ISOLEE du composant.
 *
 * Un fichier de composants qui exporte AUSSI une fonction casse le rafraichissement a chaud :
 * `vite-plugin-react` refuse le module (« Could not Fast Refresh ») et invalide son PARENT — tout
 * l'arbre React est remonte et l'etat local perdu (mesure du 2026-09-02 dans le journal du serveur
 * de dev). Le `eslint-disable` qui vivait ici faisait taire l'avertissement sans regler le defaut.
 */

/**
 * Extrait la RECOMMANDATION (ligne « 👉 Recommandé : … » du bloc de clôture) d'une réponse.
 * Rend le texte de l'étape recommandée (sans le libellé, sans le gras markdown), ou null.
 * Sert de ghost-text pré-rempli dans le composer du chat (accepté par Tab).
 */
export function extractRecommendation(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('👉') || !/Recommand[ée]/u.test(line)) continue
    const m = line.match(/Recommand[ée]\**\s*(?:[:：]|[—–-])\s*(.+)$/u)
    const rec = (m ? m[1] : line.replace(/^👉\s*/u, ''))
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
    return rec || null
  }
  return null
}
