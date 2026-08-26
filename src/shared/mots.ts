/**
 * PLIER ET DECOUPER UN TEXTE EN MOTS — la seule source.
 *
 * Cette normalisation et ce decoupage existaient en DEUX exemplaires : `replier`/`motsCherchables`
 * dans `store/conversations.ts` et `normalized`/`motsDe`/`queryTokens` dans `amitel-context.ts`.
 * Meme normalisation NFD, meme regex, meme seuil de longueur -- entretenus separement, donc voues
 * a diverger. L'audit l'a releve ; c'est ici que ca vit desormais.
 *
 * `shared/` et non `main/` : les deux appelants sont dans `main`, mais rien ici ne depend d'Electron
 * ni du systeme de fichiers, et un module de texte pur n'a pas a etre enferme dans le processus
 * principal.
 */

/**
 * Replie un texte sur sa forme comparable : minuscules, accents retires.
 *
 * `NFD` separe la lettre de son accent, la plage `U+0300-U+036F` supprime les accents ainsi
 * isoles. « À jour » et « a jour » deviennent la meme chaine -- celui qui tape vite cherche la
 * meme chose que celui qui tape juste.
 */
export function replier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Les separateurs : tout ce qui n'est ni lettre, ni chiffre, ni ponctuation de chemin. */
const SEPARATEURS = /[^a-z0-9_.:-]+/

/**
 * Les mots comparables d'un texte, replies, sans doublon.
 *
 * `longueurMin` par defaut a 3 : en dessous, un mot voisine avec tout et ne discrimine rien. Les
 * appelants qui veulent tous les mots passent 1 explicitement.
 */
export function motsDe(texte: string, longueurMin = 3): string[] {
  return [
    ...new Set(
      replier(texte)
        .split(SEPARATEURS)
        .filter((mot) => mot.length >= longueurMin)
    )
  ]
}
