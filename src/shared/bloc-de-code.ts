/**
 * Suivi des BLOCS DE CODE délimités d'un texte markdown, ligne par ligne.
 *
 * Les lignes-marqueurs (`AUTOWIN_PROMPT_V1`, `AUTOWIN_PARI_V1`) citées dans un bloc de code sont des
 * EXEMPLES, pas des consignes. Un simple interrupteur sur « la ligne commence par ``` » laissait deux
 * trous : un bloc ouvert par `~~~` n'était pas vu du tout, et un ``` à l'intérieur d'un bloc ````
 * le « refermait » alors que la règle CommonMark exige le MÊME caractère, en nombre au moins égal.
 */

const DELIMITEUR = /^(`{3,}|~{3,})(.*)$/

export interface SuiviBlocDeCode {
  /** Consomme une ligne ; `true` si c'est un délimiteur (ouverture ou fermeture). */
  delimiteur(ligne: string): boolean
  /** Vrai entre une ouverture et sa fermeture. */
  readonly dansUnBloc: boolean
}

export function suivreBlocsDeCode(): SuiviBlocDeCode {
  let ouvert: string | null = null
  return {
    delimiteur(ligne: string): boolean {
      const m = DELIMITEUR.exec(ligne.trim())
      if (!m) return false
      const [, clotures, suite] = m
      if (ouvert === null) {
        // Une info-chaîne de bloc ``` ne peut pas contenir de backtick : ```a`b n'ouvre rien.
        if (clotures[0] === '`' && suite.includes('`')) return false
        ouvert = clotures
        return true
      }
      // Fermeture : même caractère, au moins autant, et rien derrière.
      if (clotures[0] === ouvert[0] && clotures.length >= ouvert.length && !suite.trim()) {
        ouvert = null
        return true
      }
      // Un délimiteur d'une autre espèce à l'intérieur d'un bloc n'est que du contenu.
      return false
    },
    get dansUnBloc() {
      return ouvert !== null
    }
  }
}
