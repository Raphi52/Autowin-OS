/**
 * L'accusé de réception SONORE de Jarvis.
 *
 * Sans lui, l'utilisateur appelle « Jarvis » et n'a aucun moyen de savoir s'il a été entendu : il
 * parle dans le vide et conclut que le micro ne marche pas. Deux notes courtes, montantes, jouées
 * dès que le nom est reconnu — pas à la fin de la phrase, sinon le signal arrive trop tard pour
 * dire « tu peux parler ».
 *
 * Aucune dépendance à un fichier audio : la note est synthétisée, donc rien à empaqueter.
 */

type FabriqueAudio = new () => AudioContext

function fabriqueAudio(): FabriqueAudio | null {
  const w = window as unknown as {
    AudioContext?: FabriqueAudio
    webkitAudioContext?: FabriqueAudio
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

let contexte: AudioContext | null = null

/** Un seul contexte pour toute la session : en créer un par bip finit par saturer le navigateur. */
function contexteAudio(): AudioContext | null {
  if (contexte) return contexte
  const Fabrique = fabriqueAudio()
  if (!Fabrique) return null
  contexte = new Fabrique()
  return contexte
}

/** Joue l'accusé de réception. Rend `false` si l'audio n'est pas disponible dans cette fenêtre. */
export function jouerBipEveil(): boolean {
  const ctx = contexteAudio()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const debut = ctx.currentTime
    for (const [index, hertz] of [880, 1320].entries()) {
      const oscillateur = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillateur.type = 'sine'
      oscillateur.frequency.setValueAtTime(hertz, debut + index * 0.09)
      gain.gain.setValueAtTime(0.0001, debut + index * 0.09)
      gain.gain.exponentialRampToValueAtTime(0.18, debut + index * 0.09 + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, debut + index * 0.09 + 0.08)
      oscillateur.connect(gain)
      gain.connect(ctx.destination)
      oscillateur.start(debut + index * 0.09)
      oscillateur.stop(debut + index * 0.09 + 0.09)
    }
    return true
  } catch {
    // Un audio refusé (politique d'autoplay, périphérique absent) ne doit pas casser l'écoute :
    // le widget continue, seul le signal sonore manque.
    return false
  }
}

/** Pour les tests et le démontage : repart d'un contexte neuf. */
export function reinitialiserBip(): void {
  void contexte?.close?.()
  contexte = null
}
