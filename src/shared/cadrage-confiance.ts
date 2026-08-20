/**
 * Lit les affirmations NON VERIFIEES sur lesquelles un cadrage (phase FRAME) repose.
 *
 * POURQUOI. Le brief de FRAME impose deja une section `## Confiance` ou chaque affirmation porteuse
 * est etiquetee VERIFIE / DE L'UTILISATEUR / NON VERIFIE, et impose d'ecrire dans `## Besoin` toute
 * hypothese qu'on ne pouvait pas resoudre. Mesure du 20/08 : AUCUN code ne lisait cette section.
 * Elle etait donc produite a chaque run et jamais montree — l'utilisateur decouvrait le malentendu
 * a la fin, dans un livrable deja construit dessus.
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne suspend rien et ne devine rien. Il ne lit que des etiquettes
 * DECLAREES : pas de section, pas d'etiquette, pas d'hypothese ⇒ liste vide, jamais une hypothese
 * fabriquee. Le run continue dans tous les cas ; ce qui change, c'est que l'hypothese devient
 * VISIBLE et contestable tot, au lieu d'etre enfouie dans le cadrage.
 */

export type SourceHypothese = 'confiance' | 'besoin'

export interface HypotheseDeCadrage {
  /** L'affirmation, etiquette retiree. */
  affirmation: string
  source: SourceHypothese
}

/** Au-dela, la liste cesse d'etre lisible et redevient le mur de texte qu'on veut eviter. */
export const PLAFOND_HYPOTHESES = 5
const PLAFOND_AFFIRMATION = 240

/*
 * L'etiquette est cherchee telle qu'un modele l'ecrit : accents optionnels, tiret ou espace entre
 * `NON` et `VERIFIE`, pluriel possible. Un `\bVERIFIE\b` seul serait un piege — il matcherait
 * l'interieur de « NON VERIFIE » et inverserait exactement le signal ; on ne cherche donc jamais
 * `VERIFIE` seul.
 *
 * La fin de l'etiquette se ferme par `(?!\p{L})` et NON par `\b` : `\b` s'appuie sur `\w`, qui est
 * ASCII, donc apres le `É` final de « NON VÉRIFIÉ » la frontiere n'existe pas et l'etiquette la plus
 * courante ne matchait JAMAIS. Mesure du 20/08 : cinq tests rouges sur ce seul caractere.
 */
const ETIQUETTE_NON_VERIFIE = /\bNON\s*[- ]?\s*V[EÉ]RIFI[EÉ]E?S?(?!\p{L})/iu

const PREFIXE_PUCE = /^\s*(?:[-*•]|\d+[.)])\s*/u
const PONCTUATION_ORPHELINE = /^[\s:—–-]+|[\s:—–-]+$/gu

function titreDeSection(ligne: string): string | null {
  const titre = /^\s{0,3}#{1,6}\s+(.+?)\s*$/u.exec(ligne)
  return titre ? titre[1].toLowerCase() : null
}

function nettoyer(ligne: string): string {
  return ligne
    .replace(PREFIXE_PUCE, '')
    .replace(ETIQUETTE_NON_VERIFIE, ' ')
    .replace(/\((?:\s*)\)/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .replace(PONCTUATION_ORPHELINE, '')
    .trim()
    .slice(0, PLAFOND_AFFIRMATION)
}

/**
 * Les hypotheses porteuses d'un cadrage, dans l'ordre du texte.
 *
 * Deux sources, par conception distinctes : la section `## Confiance` (les affirmations que le
 * modele a lui-meme marquees NON VERIFIE) et les lignes de `## Besoin` qui s'annoncent comme des
 * hypotheses. Une ligne ETIQUETEE verifiee ou attribuee a l'utilisateur n'est jamais reprise : elle
 * a une autorite, contrairement a une deduction.
 */
export function hypothesesDuCadrage(texte: unknown): HypotheseDeCadrage[] {
  if (typeof texte !== 'string' || !texte.trim()) return []
  const trouvees: HypotheseDeCadrage[] = []
  const vues = new Set<string>()
  let sectionCourante: SourceHypothese | null = null

  for (const ligneBrute of texte.split(/\r?\n/u)) {
    const titre = titreDeSection(ligneBrute)
    if (titre !== null) {
      sectionCourante = titre.includes('confiance')
        ? 'confiance'
        : titre.includes('besoin')
          ? 'besoin'
          : null
      continue
    }
    if (!sectionCourante) continue
    const ligne = ligneBrute.trim()
    if (!ligne) continue

    let retenue = false
    if (sectionCourante === 'confiance') {
      /*
       * SEULE l'etiquette NON VERIFIE explicite compte. Une ligne SANS etiquette n'est pas reprise :
       * remonter tout ce qui n'est pas marque verifie ferait de chaque phrase de la section une
       * hypothese, et le bloc redeviendrait le mur de texte qu'on cherche a supprimer. Une
       * affirmation deja VERIFIE ou tenue DE L'UTILISATEUR porte son autorite, on la laisse.
       */
      retenue = ETIQUETTE_NON_VERIFIE.test(ligne)
    } else {
      retenue = /^\s*(?:[-*•]|\d+[.)])?\s*hypoth[eè]se\b/iu.test(ligne)
    }
    if (!retenue) continue

    // Le mot d'annonce tombe AVANT le nettoyage, sinon les deux-points qu'il laisse derriere lui
    // survivent au trim de ponctuation et l'affirmation commence par « : ».
    const affirmation = nettoyer(ligne.replace(PREFIXE_PUCE, '').replace(/^hypoth[eè]se\b/iu, ''))
    if (!affirmation) continue
    const cle = affirmation.toLowerCase()
    if (vues.has(cle)) continue
    vues.add(cle)
    trouvees.push({ affirmation, source: sectionCourante })
    if (trouvees.length >= PLAFOND_HYPOTHESES) break
  }
  return trouvees
}

/**
 * L'amorce posee dans le composer quand l'utilisateur conteste une supposition.
 *
 * Elle se termine OUVERTE, par des deux-points : corriger demande de dire ce qui est vrai, et un
 * clic ne le sait pas. Le modele ne recoit donc jamais un verdict vide « c'est faux » sans la
 * suite ; c'est l'utilisateur qui complete.
 */
export function amorceDeCorrection(hypothese: HypotheseDeCadrage): string {
  return `Correction du cadrage — « ${hypothese.affirmation} » est faux. En réalité : `
}

/**
 * La note remise au JUGE : les suppositions que le cadrage a portees sans les verifier.
 *
 * POURQUOI LE JUGE ET PAS SEULEMENT L'UTILISATEUR. Un livrable peut etre impeccable et reposer sur
 * une supposition fausse : le juge le validait alors en silence, parce que rien dans son prompt ne
 * nommait ce sur quoi le travail repose. La note ne cree aucune nouvelle source — elle rappelle ce
 * que le cadrage a lui-meme etiquete.
 *
 * CE QUE LA NOTE NE FAIT PAS : elle n'affirme pas que ces suppositions sont fausses. Remettre au
 * juge une conclusion deja tiree revient a lui faire tamponner un postulat au lieu de l'auditer. Il
 * lui est demande de VERIFIER celles dont le livrable depend, et de conclure sur ce qu'il a lu.
 */
export function noteHypothesesPourJuge(hypotheses: readonly HypotheseDeCadrage[]): string {
  if (!hypotheses.length) return ''
  const lignes = hypotheses.map((hypothese) => `- ${hypothese.affirmation}`).join('\n')
  return (
    `SUPPOSITIONS DU CADRAGE — le cadrage a lui-meme etiquete ces affirmations comme NON VERIFIEES, ` +
    `et le livrable peut reposer dessus :\n${lignes}\n` +
    `Pour chacune dont le livrable DEPEND : verifie-la avec tes outils de lecture et dis ce que tu as lu. ` +
    `Une supposition que ta lecture CONTREDIT est un defaut, meme si le reste du livrable est impeccable. ` +
    `Une supposition que tu ne peux pas trancher se dit en objection, jamais en silence — et ne conclus ` +
    `pas qu'une supposition est fausse du seul fait qu'elle figure ici.\n`
  )
}
