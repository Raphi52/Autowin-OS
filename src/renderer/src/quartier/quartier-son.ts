/**
 * LE GONG DU QUARTIER (conv-1421, « je voulais dire un gong pas un bong pardon »).
 *
 * Un gong n'attaque pas comme une cloche. Le grave part tout de suite ; les aigus, eux, montent après
 * le coup, le temps que la vibration gagne le bord du disque, et c'est ce souffle qui fait le gong.
 * Tout est synthétisé : aucun fichier à embarquer.
 *
 * LE SON NE PART QUE D'UN CLIC DE L'UTILISATEUR. La fiche dit « pas de son » (D2) : quinze agents qui
 * feraient sonner le gong pendant une réunion, c'est non. Un tanuki qui frappe le gong ne fait que le
 * faire vibrer à l'image.
 */
export interface PartielGong {
  /** Note, en Hz. Les rapports ne tombent pas juste : c'est ce qui sépare un gong d'une note. */
  f: number
  v: number
  /** Le temps que ce partiel met à monter après le coup, en secondes. */
  montee: number
  /** Sa durée totale, en secondes. */
  d: number
}

export const PARTIELS_GONG: readonly PartielGong[] = [
  { f: 98, v: 1, montee: 0.01, d: 6 },
  { f: 147.5, v: 0.62, montee: 0.02, d: 5.2 },
  { f: 196.8, v: 0.5, montee: 0.06, d: 4.6 },
  { f: 263, v: 0.34, montee: 0.16, d: 4.2 },
  { f: 351, v: 0.26, montee: 0.3, d: 3.8 },
  { f: 468, v: 0.2, montee: 0.45, d: 3.4 },
  { f: 627, v: 0.15, montee: 0.6, d: 3 },
  { f: 841, v: 0.11, montee: 0.75, d: 2.6 },
  { f: 1127, v: 0.07, montee: 0.9, d: 2.2 }
]

/** Le temps avant de refermer le son : le plus long partiel, plus une marge. */
export const DUREE_GONG_S = Math.max(...PARTIELS_GONG.map((p) => p.d)) + 0.5

interface FenetreAudio {
  AudioContext?: typeof AudioContext
}

export function jouerGong(): void {
  const Contexte = (window as unknown as FenetreAudio).AudioContext
  if (!Contexte) return
  const ac = new Contexte()
  const debut = ac.currentTime + 0.01
  const sortie = ac.createGain()
  sortie.gain.value = 0.42
  sortie.connect(ac.destination)
  for (const { f, v, montee, d } of PARTIELS_GONG) {
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'
    // La note glisse un peu vers le bas pendant que le disque se calme.
    o.frequency.setValueAtTime(f * 1.012, debut)
    o.frequency.exponentialRampToValueAtTime(f, debut + 1.2)
    g.gain.setValueAtTime(0.0001, debut)
    g.gain.exponentialRampToValueAtTime(v, debut + montee)
    g.gain.exponentialRampToValueAtTime(0.0001, debut + d)
    o.connect(g).connect(sortie)
    o.start(debut)
    o.stop(debut + d + 0.05)
  }
  // Le coup du maillet : un bruit bref et feutré.
  const n = Math.floor(ac.sampleRate * 0.1)
  const tampon = ac.createBuffer(1, n, ac.sampleRate)
  const canal = tampon.getChannelData(0)
  for (let i = 0; i < n; i++) canal[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3
  const bruit = ac.createBufferSource()
  bruit.buffer = tampon
  const filtre = ac.createBiquadFilter()
  filtre.type = 'lowpass'
  filtre.frequency.value = 300
  const volume = ac.createGain()
  volume.gain.value = 0.8
  bruit.connect(filtre).connect(volume).connect(sortie)
  bruit.start(debut)
  setTimeout(() => void ac.close(), DUREE_GONG_S * 1_000)
}
