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
const SAUT = String.fromCharCode(10)

export interface PariEmis {
  confiance: number
  refutateur: string
}

/** Rend le DERNIER pari valide du texte, ou `null`. Ne jette jamais. */
export function extrairePari(texte: string | undefined | null): PariEmis | null {
  if (!texte) return null
  let trouve: PariEmis | null = null
  let dansUnBloc = false
  for (const ligne of texte.split(SAUT)) {
    /*
     * UN EXEMPLE N'EST PAS UN PARI. Une phase qui documente le format, recopie son brief ou explique
     * la mecanique a l'utilisateur cite la ligne dans un bloc de code : sans ce compteur de cloture,
     * un « exemple pedagogique » a 0,99 entrait dans la mesure comme un vrai pari, et c'est
     * exactement le bruit qui rend un score de Brier inexploitable.
     */
    if (ligne.trimStart().startsWith('```')) {
      dansUnBloc = !dansUnBloc
      continue
    }
    if (dansUnBloc) continue
    /*
     * `lastIndexOf` et non `indexOf` : deux marqueurs sur la MEME ligne (un modele qui reformule)
     * faisaient echouer le `JSON.parse` sur la concatenation, et le pari pourtant declare
     * disparaissait en silence.
     */
    const debut = ligne.lastIndexOf(MARQUEUR)
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
