/*
 * LE DEAL ET LE FUMEUR, REJOUÉS PAR DES HUMAINS RÉELS (conv-312, second tour).
 *
 * Demande de l'utilisateur : « Refais le deal et le fumeur du fond d'Accueil avec des humains
 * Rocketbox animés par leurs gestes capturés, à côté des 18 passants ». Ces deux scènes venaient du
 * brouillon de conv-301 (« un deal avec le mec adossé au mur de ma photo initiale »), joué alors par
 * des corps sculptés ; la direction « Heure de pointe » les avait retirées.
 *
 * Ce fichier ne contient QUE la chorégraphie, sans three.js : où est chacun, vers où il regarde et
 * quel geste il joue, en fonction de la position du lieu dans la rue. `home-decor-foule.ts` l'applique
 * aux personnes.
 *
 * LE TEMPS DE LA SCÈNE EST CELUI DU LIEU. La rue défile vers la caméra ; un lieu réapparaît au fond
 * tous les `fenetreLieux / vRue` secondes (155 s). La scène est réglée sur ce passage : le client
 * arrive quand le lieu est à mi-distance (`arrivee`), bien visible derrière les tuiles, et repart vers
 * nous jusqu'à sortir du cadre. Il n'apparaît ni ne disparaît jamais dans le champ.
 */

/** Les gestes capturés de `gestes.glb`. */
export const GESTES = [
  'm_cell_phone_textmessage',
  'm_gestic_talk_cool',
  'm_gestic_listen_nervous_01',
  'm_documents_take',
  'm_idle_look_around_02',
  'm_drink_drinking',
  // le taggeur (conv-312, « met un pieton taggeur aussi ») : secouer la bombe, les grands traits
  'm_work_mid',
  'm_wave_01'
] as const
export type NomGeste = (typeof GESTES)[number]

/** Qui joue qui : quatre personnes absentes de la foule des passants. */
export const FIGURANTS = { dealer: 'M11', client: 'M06', fumeur: 'M05', taggeur: 'M16' } as const

/** La marche du client (dans `marches.glb`). */
export const MARCHE_CLIENT = 'm_walk_neutral_01'

export const DEAL = {
  /** Le dealer, dos au mur, à côté de sa porte : écart à la façade et décalage le long de la rue. */
  ecartDealer: 0.42,
  dzDealer: 0.2,
  /** Le client s'arrête face à lui, à 0,8 m. */
  ecartClient: 1.25,
  dzClient: -0.35,
  /** Il arrive de loin : mètres de marche jusqu'au dealer. */
  approche: 22,
  /** Position du lieu (z) quand le client arrive : à mi-distance, là où on le voit. */
  arrivee: -27,
  /** Secondes pour se tourner vers le dealer, puis pour repartir. */
  pivot: 0.8,
  /** Durée de chaque temps : il écoute, il prend le paquet, il regarde autour de lui. */
  ecoute: 5,
  prend: 4.5,
  regarde: 4.5,
  /** Le paquet est dans sa main entre ces deux instants du geste « prendre » (en s). */
  paquet: [1.5, 3.7] as const,
  /** Au-delà, il est passé derrière la caméra : il n'est plus dessiné. */
  sortie: 13,
  /** Position d'un lieu quand il réapparaît au fond de la rue, et la longueur de la boucle des lieux. */
  debutLieux: -58,
  fenetreLieux: 70
} as const

export const FUMEUR = {
  /** Accoudé côté ville : écart à la rambarde. Il regarde la ville (vers -x). */
  ecartRambarde: 0.5,
  cap: -Math.PI / 2,
  geste: 'm_drink_drinking' as NomGeste,
  /**
   * La main est « à la bouche » en deçà de cette distance main–tête (m). Mesuré sur le geste
   * capturé (2026-10-17) : 0,52 à 0,59 m au repos, 0,22 à 0,30 m à la bouche — l'os de la tête est
   * à la base du crâne, pas aux lèvres.
   */
  bouche: 0.35,
  /** Une bouffée vit ce nombre de secondes. */
  bouffee: 3
} as const

export type GesteClient = 'marche' | 'ecoute' | 'prend' | 'regarde'
export interface EtatClient {
  visible: boolean
  /** Position relative au lieu le long de la rue (m) : le monde ajoute la position du lieu. */
  rel: number
  cap: number
  geste: GesteClient
  /** Secondes écoulées dans le geste en cours. */
  dansGeste: number
}

const lisse = (u: number): number => {
  const v = Math.min(1, Math.max(0, u))
  return v * v * (3 - 2 * v)
}

/** L'instant de la scène : secondes depuis que le lieu a réapparu au fond de la rue. */
export function tempsDuLieu(zLieu: number, vRue: number): number {
  return (zLieu - DEAL.debutLieux) / vRue
}

/** Le cap (rotation autour de y) pour regarder de (x1, z1) vers (x2, z2) ; 0 = vers +z, vers nous. */
export function capVers(x1: number, z1: number, x2: number, z2: number): number {
  return Math.atan2(x2 - x1, z2 - z1)
}

/** Les instants clés de la scène, en secondes de lieu. */
export function jalonsDeal(
  vRue: number,
  vMarche: number
): {
  depart: number
  arrivee: number
  prend: number
  regarde: number
  repart: number
} {
  const arrivee = (DEAL.arrivee - DEAL.debutLieux) / vRue
  const depart = arrivee - DEAL.approche / vMarche
  const prend = arrivee + DEAL.ecoute
  const regarde = prend + DEAL.prend
  const repart = regarde + DEAL.regarde
  return { depart, arrivee, prend, regarde, repart }
}

/**
 * LE CLIENT. Il arrive de loin en marchant vers nous, se tourne vers le dealer, écoute, prend le
 * paquet, regarde autour de lui, puis repart vers nous et sort du cadre par la droite.
 */
export function etatClient(zLieu: number, vRue: number, vMarche: number): EtatClient {
  const tau = tempsDuLieu(zLieu, vRue)
  const j = jalonsDeal(vRue, vMarche)
  const face = capVers(0, DEAL.dzClient, DEAL.ecartClient - DEAL.ecartDealer, DEAL.dzDealer)
  if (tau < j.arrivee) {
    const rel = DEAL.dzClient - vMarche * (j.arrivee - tau)
    const cap = face * lisse(1 - (j.arrivee - tau) / DEAL.pivot)
    return { visible: tau >= j.depart, rel, cap, geste: 'marche', dansGeste: tau - j.depart }
  }
  if (tau < j.prend)
    return {
      visible: true,
      rel: DEAL.dzClient,
      cap: face,
      geste: 'ecoute',
      dansGeste: tau - j.arrivee
    }
  if (tau < j.regarde)
    return {
      visible: true,
      rel: DEAL.dzClient,
      cap: face,
      geste: 'prend',
      dansGeste: tau - j.prend
    }
  if (tau < j.repart)
    return {
      visible: true,
      rel: DEAL.dzClient,
      cap: face,
      geste: 'regarde',
      dansGeste: tau - j.regarde
    }
  const rel = DEAL.dzClient + vMarche * (tau - j.repart)
  const cap = face * (1 - lisse((tau - j.repart) / DEAL.pivot))
  const visible = zLieu + rel <= DEAL.sortie
  return { visible, rel, cap, geste: 'marche', dansGeste: tau - j.repart }
}

/** LE DEALER. Il tape sur son téléphone ; il se tourne vers le client et lui parle le temps du deal. */
export function etatDealer(
  zLieu: number,
  vRue: number,
  vMarche: number
): { cap: number; geste: NomGeste } {
  const tau = tempsDuLieu(zLieu, vRue)
  const j = jalonsDeal(vRue, vMarche)
  const rue = -Math.PI / 2
  const client = capVers(DEAL.ecartClient - DEAL.ecartDealer, DEAL.dzDealer, 0, DEAL.dzClient)
  // Il lève les yeux un peu avant que le client s'arrête, et retourne à son téléphone quand il repart.
  const k =
    lisse((tau - (j.arrivee - 1.5)) / DEAL.pivot) * (1 - lisse((tau - j.repart) / DEAL.pivot))
  const parle = tau >= j.arrivee - 1 && tau < j.regarde
  return {
    cap: rue + (client - rue) * k,
    geste: parle ? 'm_gestic_talk_cool' : 'm_cell_phone_textmessage'
  }
}

/** Le geste capturé que joue le client pour chaque temps de la scène. */
export const GESTE_CLIENT: Record<Exclude<GesteClient, 'marche'>, NomGeste> = {
  ecoute: 'm_gestic_listen_nervous_01',
  prend: 'm_documents_take',
  regarde: 'm_idle_look_around_02'
}

/*
 * LE TAGGEUR (conv-312) : « met un pieton taggeur aussi ». Face au mur tagué, il secoue sa bombe, trace
 * le mot en quatre traits — de loin vers nous, le sens où il se lit —, marche d'un trait au suivant,
 * puis surveille ses arrières. Rocketbox n'a pas de geste « bomber » : le trait est `m_wave_01`, le grand
 * balayage du bras droit (de côté, au-dessus de la tête, de côté), qui face au mur se lit comme un trait
 * de bombe ; `m_work_mid`, les mains qui s'affairent à mi-hauteur, secoue la bombe. La peinture se pose
 * là où vise sa main (home-decor-foule.ts) ; ce fichier dit seulement quand la bombe crache, quelle part
 * du mot doit être peinte, et où il se tient.
 */
export const TAGGEUR = {
  /** Debout face à la façade, à cet écart : bras tendu, la bombe arrive à quelques centimètres du mur. */
  ecartMur: 0.62,
  /**
   * Le centre de chaque trait le long du mur, relatif au centre du mur peint (4,8 m de large) : quatre
   * places, du fond vers nous. Il se tient un peu en retrait de son trait (`decalage`) : son bras droit
   * peint de son côté droit, qui est vers nous quand il fait face à la façade.
   */
  traits: [-1.35, -0.45, 0.45, 1.35] as const,
  decalage: -0.35,
  /** Position du mur (z du lieu) quand il commence : assez près pour être vu, le mot fini à mi-distance. */
  debut: -40,
  /** Secondes : secouer la bombe, un trait (la durée de `m_wave_01`), se tourner, surveiller. */
  secoue: 3,
  trait: 2.83,
  pivot: 0.5,
  regarde: 4.5,
  gestes: { secoue: 'm_work_mid', trait: 'm_wave_01', regarde: 'm_idle_look_around_02' } as const,
  /** Sa marche d'un trait au suivant (dans `marches.glb`). */
  marche: 'm_walk_slow_01'
} as const

export type GesteTaggeur = 'secoue' | 'trait' | 'marche' | 'regarde'
export interface EtatTaggeur {
  /** Position le long de la rue, relative au centre du mur peint (m). */
  rel: number
  cap: number
  geste: GesteTaggeur
  /** Secondes écoulées dans le geste en cours. */
  dansGeste: number
  /** Part du mot peinte, de 0 (mur vierge, le lieu vient de réapparaître) à 1 (mot fini). */
  peinture: number
  /** La bombe crache. */
  bombe: boolean
}

/** Face à la façade (vers +x) ; vers nous en marchant (vers +z). */
const FACE_MUR = Math.PI / 2
const VERS_NOUS = 0

/** Où et que fait le taggeur, selon la position du mur tagué dans la rue. */
export function etatTaggeur(zLieu: number, vRue: number, vMarche: number): EtatTaggeur {
  const tau = tempsDuLieu(zLieu, vRue)
  const n = TAGGEUR.traits.length
  const place = (k: number): number => TAGGEUR.traits[k] + TAGGEUR.decalage
  const d0 = (TAGGEUR.debut - DEAL.debutLieux) / vRue + TAGGEUR.secoue
  const pas = (TAGGEUR.traits[1] - TAGGEUR.traits[0]) / vMarche
  const deplacement = 2 * TAGGEUR.pivot + pas
  if (tau < d0)
    return {
      rel: place(0),
      cap: FACE_MUR,
      geste: 'secoue',
      dansGeste: tau,
      peinture: 0,
      bombe: false
    }
  for (let k = 0; k < n; k++) {
    const debut = d0 + k * (TAGGEUR.trait + deplacement)
    const u = tau - debut
    if (u < TAGGEUR.trait)
      return {
        rel: place(k),
        cap: FACE_MUR,
        geste: 'trait',
        dansGeste: u,
        peinture: (k + u / TAGGEUR.trait) / n,
        bombe: true
      }
    const m = u - TAGGEUR.trait
    if (k < n - 1 && m < deplacement) {
      // il se tourne vers nous, marche jusqu'au trait suivant, se retourne vers le mur
      const marche = Math.min(1, Math.max(0, (m - TAGGEUR.pivot) / pas))
      const cap =
        m < TAGGEUR.pivot
          ? FACE_MUR + (VERS_NOUS - FACE_MUR) * lisse(m / TAGGEUR.pivot)
          : m < TAGGEUR.pivot + pas
            ? VERS_NOUS
            : VERS_NOUS + (FACE_MUR - VERS_NOUS) * lisse((m - TAGGEUR.pivot - pas) / TAGGEUR.pivot)
      return {
        // arrivé, il est EXACTEMENT à la place du trait suivant (pas d'écart d'arrondi au premier trait)
        rel: marche >= 1 ? place(k + 1) : place(k) + (place(k + 1) - place(k)) * marche,
        cap,
        geste: 'marche',
        dansGeste: m,
        peinture: (k + 1) / n,
        bombe: false
      }
    }
  }
  const fin = tau - (d0 + n * TAGGEUR.trait + (n - 1) * deplacement)
  return {
    rel: place(n - 1),
    cap: FACE_MUR,
    geste: fin < TAGGEUR.regarde ? 'regarde' : 'secoue',
    dansGeste: fin < TAGGEUR.regarde ? fin : fin - TAGGEUR.regarde,
    peinture: 1,
    bombe: false
  }
}

export interface Obstacle {
  x: number
  z: number
  /** Distance latérale gardée (m). */
  distance: number
  /** En deçà de cette distance le long de la rue, l'écart est complet ; au-delà de `portee`, aucun. */
  plein: number
  portee: number
  /** Le côté où l'on passe : -1 vers les x négatifs, 1 vers les x positifs ; absent = le plus proche. */
  cote?: -1 | 1
}

/**
 * UN PASSANT CONTOURNE UN OBSTACLE : il glisse de côté en approchant, jusqu'à `distance`, et reprend
 * sa file une fois passé. Continu : aucun saut d'une image à l'autre.
 */
export function ecarter(x: number, z: number, o: Obstacle): number {
  const dx = x - o.x
  const cote = o.cote ?? (dx < 0 ? -1 : 1)
  // Déjà assez loin, et du bon côté.
  if (cote * dx >= o.distance) return x
  const loin = Math.abs(z - o.z)
  if (loin >= o.portee) return x
  const u = lisse((o.portee - loin) / (o.portee - o.plein))
  return x + (o.x + cote * o.distance - x) * u
}
