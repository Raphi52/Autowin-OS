/**
 * UN CHEMIN CITÉ À L'UTILISATEUR EST UN CHEMIN COMPLET (conv-1335, 2026-11-01).
 *
 * Mesuré sur ce fil : la clôture citait `film/sortie/…/autowin-os-film.mp4`, relatif à un dossier
 * que l'utilisateur ne peut pas deviner. Il a demandé « il est ou ? », puis « donne le path
 * complet », puis « kaizen ca en vrai que des full path » : deux tours perdus sur une seule ligne.
 *
 * La cause est double. `response-style.ts` ne disait que « écris-le tel quel », ce qui laisse
 * passer la forme relative qu'a l'agent en tête ; et aucune garde de fin de tour ne regardait les
 * chemins. Le défaut se lit sur le texte, donc il se contrôle : voir la relance dans agent-pilot.ts.
 *
 * Le filtre préfère rater un chemin plutôt que d'en inventer un : une relance à tort coûte un appel
 * au modèle, un chemin raté ne coûte que l'état d'avant. D'où l'extension exigée (un dossier nu ne
 * se distingue pas d'une branche : la consigne du style s'en charge), les commandes laissées de
 * côté et les blocs de code ignorés.
 */

/** Au-delà, la consigne s'allonge pour rien : le modèle a compris dès le premier exemple. */
const CHEMINS_NOMMES_MAX = 8

const SEPARATEUR = String.raw`[\\/]`
const CAR = String.raw`\p{L}\p{N}_.-`

/** `film/a.mp4`, `src\main\a.ts`, `.autowin-tmp/x/a.png` : au moins un séparateur et une extension. */
const CHEMIN_RELATIF = new RegExp(
  String.raw`(?<![${CAR}:/\\~%$@#&=+])` +
    String.raw`((?:[${CAR}]+${SEPARATEUR})+[${CAR}]*\.[A-Za-z][A-Za-z0-9_-]{0,11})` +
    String.raw`(?![\p{L}\p{N}_/\\-])`,
  'gu'
)

/** Premier segment qui se lit comme un nom de domaine (`dev.azure.com`), ou `Vue.js/React.js`. */
const DOMAINE = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u

const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)>\]]+/giu

/** Une ligne de code avec une espace est une commande, pas une adresse à copier. */
const COMMANDE_EN_LIGNE = /`[^`\n]*\s[^`\n]*`/gu

/**
 * Chemin Windows complet, espaces comprises (`C:\Program Files\nodejs\node.exe`) : sans ce retrait,
 * `Files\nodejs\node.exe` passerait pour relatif. Deux espaces par dossier au plus, pour ne pas
 * avaler la suite de la phrase.
 */
const ABSOLU_AVEC_ESPACES = (() => {
  const mot = String.raw`[^\s\\/:*?"<>|` + '`' + String.raw`]+`
  const dossier = String.raw`${mot}(?: ${mot}){0,2}`
  return new RegExp(String.raw`[A-Za-z]:${SEPARATEUR}(?:${dossier}${SEPARATEUR})*(?:${mot})?`, 'gu')
})()

/** Le texte que l'utilisateur lit vraiment comme de la prose : ni blocs de code, ni lignes techniques. */
function proseDeLaReponse(reponse: string): string {
  const gardees: string[] = []
  let cloture: string | undefined
  for (const ligne of (reponse ?? '').split(/\r?\n/u)) {
    const marque = /^\s{0,3}(`{3,}|~{3,})/u.exec(ligne)?.[1]
    if (cloture) {
      if (marque?.startsWith(cloture)) cloture = undefined
      continue
    }
    if (marque) {
      cloture = marque
      continue
    }
    if (!ligne.startsWith('AUTOWIN_')) gardees.push(ligne)
  }
  return gardees.join('\n')
}

/** Chemins de fichier relatifs cités dans une réponse, sans doublon, dans l'ordre du texte. */
export function cheminsRelatifsCites(reponse: string): string[] {
  const texte = proseDeLaReponse(reponse)
    .replace(URL, ' ')
    .replace(COMMANDE_EN_LIGNE, ' ')
    .replace(ABSOLU_AVEC_ESPACES, ' ')
  const trouves = new Set<string>()
  for (const [, chemin] of texte.matchAll(CHEMIN_RELATIF)) {
    if (!DOMAINE.test(chemin.split(/[\\/]/u)[0])) trouves.add(chemin)
  }
  return [...trouves]
}

/** Ce qu'on renvoie à l'agent : réécrire la réponse, qui REMPLACE la précédente à l'écran. */
export function relanceCheminsComplets(chemins: string[]): string {
  const nommes = chemins.slice(0, CHEMINS_NOMMES_MAX).map((chemin) => `\`${chemin}\``)
  const reste = chemins.length - nommes.length
  return (
    `SYSTÈME: ta réponse cite des chemins incomplets : ${nommes.join(', ')}` +
    `${reste > 0 ? ` et ${reste} autres` : ''}. L’utilisateur ne sait pas depuis quel dossier tu ` +
    'parles : il doit pouvoir copier chaque chemin tel quel. Ré-émets MAINTENANT ta réponse EN ' +
    'ENTIER, SANS aucune commande, avec le chemin complet de chaque fichier, disque compris ' +
    '(`D:\\Dossier\\sous-dossier\\fichier.ext`). Ne change rien d’autre. Elle REMPLACE la ' +
    'précédente à l’écran.'
  )
}
