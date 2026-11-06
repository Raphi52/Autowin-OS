/**
 * RAPPELS AU BON MOMENT (idée reprise des « time-traveling stream rules » d'omp).
 *
 * Constat : une règle dite À DISTANCE du geste — dans AGENTS.md ou dans la description d'un outil —
 * est enfreinte au moment du geste. Mesure du 2026-11-03 dans les sorties brutes des modèles
 * (script `.autowin-tmp/conv-1457/mesure/regles-violees.mjs`) : 16 lectures directes de
 * `conversations.json` en une journée, alors qu'AGENTS.md dit que ce fichier n'est qu'un instantané.
 * AGENTS.md le reconnaissait lui-même : « Règles du dépôt — AUCUN contrôle ne les bloque » (titre
 * changé le 2026-11-05, quand ces règles sont passées dans le hook des gardes).
 *
 * Réponse : le script lancé AVANT chaque outil (`scriptHookGardes`) lit le fichier versionné
 * `mods/autowin/rappels-outils.json` et glisse, à côté de l'appel qui correspond, le texte de la
 * règle (`additionalContext`). Jamais un refus : c'est un rappel. Au plus une fois par règle et par
 * appel du CLI. Le fichier est relu à chaque appel d'outil : une règle ajoutée vaut dès l'appel
 * suivant, sans redémarrer l'app.
 *
 * CLAUDE SEULEMENT : ce point d'accroche est un hook du CLI Claude. Codex n'en a pas d'équivalent ;
 * ses agents ne reçoivent pas ces rappels.
 *
 * Fonction AUTOPORTÉE : elle est sérialisée telle quelle dans le script (`.toString()`), sans aucun
 * import ni constante du module. Les bornes lui sont donc passées en argument. Toute panne d'une
 * règle (champ mal typé, expression invalide) n'emporte que cette règle ; une panne globale rend
 * `undefined`. Le script qui l'appelle reste en échec FERMÉ (`onFailure: 'block'`, providers/claude.ts) :
 * une exception ici bloquerait tous les outils, d'où les `try` partout.
 */

/** Nom du fichier de règles, dans le dossier du mod Autowin chargé (`mods/autowin`). */
export const NOM_FICHIER_RAPPELS = 'rappels-outils.json'

/**
 * `parRegle` : longueur du texte d'une règle (un texte trop long est coupé). `total` : tout ce qui
 * part avec UN appel d'outil ; une règle qui ne tient plus reste due pour l'appel suivant.
 * `entree` : longueur lue de chaque champ de l'appel — une commande de 200 000 caractères ne doit
 * pas faire durer le contrôle, qui précède CHAQUE outil.
 */
export const BORNES_RAPPELS = { parRegle: 600, total: 2000, entree: 20_000 } as const

export interface BornesRappels {
  parRegle: number
  total: number
  entree: number
}

/**
 * Les rappels dus pour UN appel d'outil.
 *
 * @param brut contenu du fichier de règles (liste JSON)
 * @param outil nom de l'outil appelé (`Bash`, `Read`…), comparé EN ENTIER à `outils`
 * @param champs valeurs lues de l'appel (commande, chemin, motif, adresse) ; seuls les textes comptent
 * @param dejaDonnes identifiants des règles déjà rappelées pendant cet appel du CLI
 */
export function rappelsDeLAppel(
  brut: string,
  outil: string,
  champs: readonly unknown[],
  dejaDonnes: readonly string[],
  bornes: BornesRappels
): { ids: string[]; texte: string } | undefined {
  let regles: unknown
  try {
    regles = JSON.parse(String(brut))
  } catch {
    return undefined
  }
  if (!Array.isArray(regles)) return undefined
  const textes = (Array.isArray(champs) ? champs : [])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.slice(0, bornes.entree))
  if (textes.length === 0) return undefined
  const deja = Array.isArray(dejaDonnes) ? dejaDonnes : []
  const ids: string[] = []
  const morceaux: string[] = []
  let total = 0
  for (const r of regles) {
    try {
      if (!r || typeof r !== 'object') continue
      const { id, outils, motif, sauf, texte } = r as Record<string, unknown>
      if (typeof id !== 'string' || !id || deja.includes(id) || ids.includes(id)) continue
      if (typeof outils !== 'string' || !outils || typeof motif !== 'string' || !motif) continue
      if (typeof texte !== 'string' || !texte.trim()) continue
      if (sauf !== undefined && typeof sauf !== 'string') continue
      // Nom d'outil comparé EN ENTIER : `Read` ne doit pas viser `ReadMcpResource`.
      if (!new RegExp(`^(?:${outils})$`).test(String(outil))) continue
      const m = new RegExp(motif, 'i')
      const s = sauf ? new RegExp(sauf, 'i') : undefined
      if (!textes.some((t) => m.test(t) && !(s && s.test(t)))) continue
      let corps = texte.trim()
      if (corps.length > bornes.parRegle) corps = `${corps.slice(0, bornes.parRegle - 1)}…`
      const morceau = `Rappel [${id}] : ${corps}`
      const ajout = morceau.length + (morceaux.length > 0 ? 2 : 0)
      // Plus de place : cette règle et les suivantes restent dues (non notées « données »).
      if (total + ajout > bornes.total) break
      total += ajout
      morceaux.push(morceau)
      ids.push(id)
    } catch {
      // Expression invalide ou règle illisible : on passe à la suivante.
    }
  }
  return ids.length > 0 ? { ids, texte: morceaux.join('\n\n') } : undefined
}
