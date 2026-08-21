/**
 * Lecture du pari émis par la phase, sur le modèle du canal déjà éprouvé `AUTOWIN_LESSON_V1` :
 * une ligne finale, un JSON d'une ligne, aucun appel de modèle supplémentaire.
 *
 * POURQUOI SUR BUILD ET PAS SUR LE CADRAGE. Le brief de cadrage argumente explicitement contre le
 * fait de noter sa confiance, et il cite une mesure faite dans ce dépôt : « la confiance était la plus
 * haute là où la vérification était la plus faible » (phase-briefs.ts). Cette mesure porte sur une
 * certitude RESSENTIE à propos de faits — un nom d'API inventé paraît aussi solide qu'un vrai, donc
 * s'auto-noter là-dessus ne mesure rien. Un pari sur « ce travail passera-t-il le juge ? » est d'une
 * autre nature : c'est la prévision d'un ÉVÉNEMENT FUTUR OBSERVABLE, tranché par un tiers, et c'est
 * exactement l'objet que la calibration sait mesurer. La distinction n'est pas cosmétique : elle
 * décide si le chiffre est du bruit ou un signal.
 *
 * FAIL-OPEN de bout en bout : pari absent, JSON cassé, valeur hors bornes → `null`. Jamais une
 * exception. Une métrique qui ferait échouer un run serait pire que l'absence de métrique.
 */

const MARQUEUR = 'AUTOWIN_PARI_V1:'

export interface PariEmis {
  confiance: number
  refutateur: string
}

/** Rend le DERNIER pari valide du texte, ou `null`. Ne jette jamais. */
export function extrairePari(texte: string | undefined | null): PariEmis | null {
  if (!texte) return null
  let trouve: PariEmis | null = null
  for (const ligne of texte.split('\n')) {
    const debut = ligne.indexOf(MARQUEUR)
    if (debut < 0) continue
    const brut = ligne.slice(debut + MARQUEUR.length).trim()
    let parse: unknown
    try {
      parse = JSON.parse(brut)
    } catch {
      continue
    }
    if (!parse || typeof parse !== 'object') continue
    const { confiance, refutateur } = parse as { confiance?: unknown; refutateur?: unknown }
    if (typeof confiance !== 'number' || !Number.isFinite(confiance)) continue
    if (confiance < 0 || confiance > 1) continue
    if (typeof refutateur !== 'string' || !refutateur.trim()) continue
    trouve = { confiance, refutateur: refutateur.trim() }
  }
  return trouve
}
