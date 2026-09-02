/**
 * CANDIDATS DANS UN MESSAGE DE SCOUT → panneau de sélection natif.
 *
 * Demande utilisateur du 2026-08-14 : le rendu du scout doit être « accompagné de checkbox et d'un
 * bouton qui frame les lignes sélectionnées ». Le HTML du modèle ne peut pas porter ces contrôles
 * (le sanitizeur refuse volontairement input/button — anti-hameçonnage) : c'est donc l'APP qui les
 * rend, en détectant la charge utile JSON que le scout termine toujours par (bloc ```json).
 *
 * Module PUR : détection + rédaction du prompt, testables sans React.
 */

export interface CandidatAffiche {
  titre: string
  /**
   * Ancrage interne `src/...:ligne` ou URL web — affiché tel quel, jamais réécrit.
   *
   * OPTIONNEL depuis le 2026-08-18 : un scout de code rend un tableau markdown dont toutes les
   * lignes ne portent pas d'ancrage. L'exiger interdisait au panneau de sélection d'exister sur
   * ces scouts — c'est-à-dire sur le cas d'usage principal.
   */
  url?: string
  citation?: string
  pertinence?: number
  type?: string
  dateSource?: string
  langue?: string
  what?: string
  why?: string
  how?: string
  /**
   * Pastilles du tableau scout, telles quelles ('g' | 'y' | 'r'). Sur un scout au format
   * Impact/Effort il n'existe AUCUN nombre : ces deux pastilles SONT l'indication de valeur de la
   * ligne. Les jeter vidait la ligne de tout reperage (constate le 2026-08-18).
   */
  impact?: 'g' | 'y' | 'r'
  effort?: 'g' | 'y' | 'r'
}

interface ChargeJson {
  valeur: unknown
  debut: number
  fin: number
}

function trouverDerniereChargeJson(texte: string): ChargeJson | undefined {
  const ouvertureJson = /^ {0,3}```json[ \t]*\r?$/gim
  let debut: number | undefined
  let finOuverture: number | undefined
  for (const correspondance of texte.matchAll(ouvertureJson)) {
    debut = correspondance.index
    finOuverture = correspondance.index + correspondance[0].length
  }
  if (debut === undefined || finOuverture === undefined) return undefined
  const apresOuverture = texte.slice(finOuverture)
  const fermeture = /^ {0,3}```[ \t]*\r?$/m.exec(apresOuverture)
  if (!fermeture || fermeture.index === undefined) return undefined
  const fin = finOuverture + fermeture.index + fermeture[0].length
  const charge = apresOuverture.slice(0, fermeture.index).trim()
  try {
    return {
      valeur: JSON.parse(charge),
      debut,
      fin
    }
  } catch {
    return undefined
  }
}

/**
 * Extrait les candidats d'un texte de message. On ne détecte QUE la forme émise par les scouts :
 * un tableau JSON d'objets portant au moins `titre` et `url`. Un JSON cassé ou d'une autre forme
 * rend `undefined` — ce panneau est un bonus, jamais une raison d'échouer un rendu.
 */
export function extraireCandidatsAffiches(texte: string): CandidatAffiche[] | undefined {
  const charge = trouverDerniereChargeJson(texte)
  if (!charge) return undefined
  const valeur = charge.valeur
  if (!Array.isArray(valeur) || valeur.length === 0) return undefined
  const candidats: CandidatAffiche[] = []
  for (const brut of valeur) {
    if (!brut || typeof brut !== 'object') return undefined
    const objet = brut as Record<string, unknown>
    if (typeof objet.titre !== 'string' || !objet.titre.trim()) return undefined
    if (typeof objet.url !== 'string' || !objet.url.trim()) return undefined
    candidats.push({
      titre: objet.titre.trim(),
      url: objet.url.trim(),
      ...(typeof objet.citation === 'string' && objet.citation.trim()
        ? { citation: objet.citation.trim() }
        : {}),
      ...(typeof objet.pertinence === 'number' && Number.isFinite(objet.pertinence)
        ? { pertinence: objet.pertinence }
        : {}),
      ...(typeof objet.type === 'string' && objet.type.trim() ? { type: objet.type.trim() } : {}),
      ...(typeof objet.dateSource === 'string' && objet.dateSource.trim()
        ? { dateSource: objet.dateSource.trim() }
        : {}),
      ...(typeof objet.langue === 'string' && objet.langue.trim()
        ? { langue: objet.langue.trim() }
        : {}),
      ...(typeof objet.what === 'string' && objet.what.trim() ? { what: objet.what.trim() } : {}),
      ...(typeof objet.why === 'string' && objet.why.trim() ? { why: objet.why.trim() } : {}),
      ...(typeof objet.how === 'string' && objet.how.trim() ? { how: objet.how.trim() } : {})
    })
  }
  return candidats
}

/** Premier ancrage `chemin:ligne` trouvé dans les cellules, dans l'ordre où on le lirait. */
function ancrageDansCellules(cellules: readonly string[]): string | undefined {
  for (const cellule of cellules) {
    const trouve = /(?:src|scripts|tests|tools)\/[\w./-]+:\d+/.exec(cellule)
    if (trouve) return trouve[0]
  }
  return undefined
}

/**
 * Convertit un tableau scout markdown déjà analysé en candidats SÉLECTIONNABLES.
 *
 * Le panneau de sélection ne savait lire qu'une charge JSON de veille web ; un scout interne rend un
 * tableau. Ce pont réutilise le panneau existant au lieu de recoder des cases à cocher ailleurs.
 * L'ancrage est EXTRAIT des cellules quand il y est, jamais inventé quand il n'y est pas.
 */
export function candidatsDepuisScoutTable(
  rows: readonly {
    num: string
    score?: number
    impact: 'g' | 'y' | 'r' | null
    effort: 'g' | 'y' | 'r' | null
    type: 'fix' | 'new' | null
    what: string
    why: string
    how: string
  }[]
): CandidatAffiche[] {
  return rows.map((row) => {
    const ancrage = ancrageDansCellules([row.how, row.what, row.why])
    return {
      titre: row.what.trim() || `Candidat #${row.num}`,
      ...(row.score === undefined ? {} : { pertinence: row.score }),
      ...(row.impact ? { impact: row.impact } : {}),
      ...(row.effort ? { effort: row.effort } : {}),
      ...(ancrage ? { url: ancrage } : {}),
      ...(row.type ? { type: row.type } : {}),
      ...(row.what.trim() ? { what: row.what.trim() } : {}),
      ...(row.why.trim() ? { why: row.why.trim() } : {}),
      ...(row.how.trim() ? { how: row.how.trim() } : {})
    }
  })
}

/**
 * Le prompt « parfait » pour enchaîner : le WORKFLOW COMPLET sur LA SÉLECTION, avec les ancrages et
 * preuves, et la consigne d'aller jusqu'au commit publié — le même contrat que les campagnes.
 *
 * Demande utilisateur du 2026-09-02 : le bouton de la shortlist scout doit lancer TOUT le workflow,
 * pas seulement le cadrage. Le préfixe `/frame` réduisait le run à la seule phase frame
 * (`skill-routing.ts` → `explicitPhase`), donc l'ancienne version ne pouvait rien livrer. Ici :
 * AUCUN préfixe de phase, et le mot « pipeline » dans la consigne classe la tâche en régime
 * `critical` (`task-regime.ts` : CRITICAL_SIGNALS), qui joue scout → frame → terrain → build → clean
 * puis le juge, sans qu'une intention en langage naturel puisse l'amputer.
 */
export function redigerPromptWorkflowSelection(selection: readonly CandidatAffiche[]): string {
  const lignes = selection.map((candidat, index) => {
    const morceaux = [
      candidat.url
        ? `${index + 1}. ${candidat.titre} — ancrage ${candidat.url}`
        : `${index + 1}. ${candidat.titre}`
    ]
    if (candidat.citation) morceaux.push(`preuve : « ${candidat.citation} »`)
    if (candidat.pertinence !== undefined) morceaux.push(`pertinence ${candidat.pertinence}/100`)
    const details = [
      candidat.type ? `   Type : ${candidat.type}` : undefined,
      candidat.what ? `   Quoi : ${candidat.what}` : undefined,
      candidat.why ? `   Pourquoi : ${candidat.why}` : undefined,
      candidat.how ? `   Comment : ${candidat.how}` : undefined,
      candidat.dateSource ? `   Date source : ${candidat.dateSource}` : undefined,
      candidat.langue ? `   Langue : ${candidat.langue}` : undefined
    ].filter((detail): detail is string => detail !== undefined)
    return [morceaux.join(' — '), ...details].join('\n')
  })
  return [
    selection.length > 1
      ? `Traite ENSEMBLE ces ${selection.length} candidats issus du scout interne d'Autowin :`
      : `Traite ce candidat issu du scout interne d'Autowin :`,
    '',
    ...lignes,
    '',
    'Commence par relire chaque ancrage et vérifier que le besoin tient toujours, puis joue le',
    'PIPELINE complet — cadrage, terrain, build, nettoyage, jugement — jusqu’au COMMIT PUBLIÉ et',
    'vérifié. Si un ancrage ne tient plus, dis-le franchement plutôt que de traiter un besoin mort.'
  ].join('\n')
}

/**
 * Le même texte SANS la charge utile JSON (et sa clôture de fence) : une fois le panneau de
 * sélection affiché, le pavé brut ferait doublon — c'est une charge machine, pas une lecture.
 */
export function texteSansChargeJson(texte: string): string {
  const charge = trouverDerniereChargeJson(texte)
  if (!charge) return texte
  const avant = texte.slice(0, charge.debut)
  const apres = texte.slice(charge.fin)
  return `${avant.trimEnd()}
${apres.trimStart()}`.trim()
}

/** L'emoji de nature, affiché dans la barre du candidat sans avoir à déplier. */
export function emojiType(type: string | undefined): string {
  // DEUX vocabulaires arrivent ici : celui de la veille web (« correction » / « ajout ») et celui du
  // tableau scout (« fix » / « new »). N'en connaitre qu'un affichait « ❔ » sur chaque ligne d'un
  // scout de code — constate le 2026-08-18. Le repli reste EXPLICITE pour une nature vraiment
  // inconnue : mieux vaut un point d'interrogation assume qu'un emoji devine.
  if (type === 'correction' || type === 'fix') return '🔧'
  if (type === 'ajout' || type === 'new') return '🆕'
  return '❔'
}
