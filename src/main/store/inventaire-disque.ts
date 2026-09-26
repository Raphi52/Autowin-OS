import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/**
 * CE QU'AUTOWIN OCCUPE SUR LE DISQUE, PAR FAMILLE.
 *
 * Mesure du 2026-09-11 : l'utilisateur a du POSER la question (« est-ce qu'autowin OS accumule des
 * Go en l'utilisant ? »). Reponse du jour : 3,2 Go, dont 634 Mo de copies de travail, 592 Mo de
 * traces de prompts et 387 Mo de traces causales. Les chiffres du menage existaient deja
 * (`removed` / `freedBytes` / `remaining`) mais leur seul lecteur etait un `console.log` de
 * demarrage, invisible depuis l'interface.
 *
 * BORNE DURE : ce comptage tourne dans le processus principal, dans une vue qui sert justement a
 * diagnostiquer les gels. Il ne doit donc JAMAIS etre celui qui fige l'application -- d'ou un
 * plafond de fichiers visites, et un drapeau `partiel` qui le DIT au lieu de rendre un total faux.
 */
export interface FamilleDisque {
  nom: string
  octets: number
  fichiers: number
  /** Le plafond de visite a ete atteint : le total de cette famille est un PLANCHER, pas un total. */
  partiel: boolean
}

export interface InventaireDisque {
  racine: string
  octets: number
  familles: FamilleDisque[]
  partiel: boolean
  /** Ce que la derniere passe de menage au demarrage a libere, quand elle a eu lieu. */
  menage: MenageDemarrage[]
}

export interface MenageDemarrage {
  famille: string
  supprimes: number
  octetsLiberes: number
  /** Ce qui attend la prochaine passe, quand le collecteur sait le dire. */
  restants?: number
}

/** Plafond de fichiers visites par famille. Au-dela, on rend un plancher et on le DIT. */
export const MAX_FICHIERS_PAR_FAMILLE = 20_000

function mesurerDossier(
  chemin: string,
  restant: { fichiers: number }
): { octets: number; fichiers: number } {
  let octets = 0
  let fichiers = 0
  let entrees: Dirent[]
  try {
    entrees = readdirSync(chemin, { withFileTypes: true, encoding: 'utf8' }) as Dirent[]
  } catch {
    // Dossier absent, verrouille ou sans droits : il compte pour zero, il ne fait pas echouer.
    return { octets: 0, fichiers: 0 }
  }
  for (const entree of entrees) {
    if (restant.fichiers <= 0) break
    const enfant = join(chemin, entree.name)
    if (entree.isDirectory()) {
      const sous = mesurerDossier(enfant, restant)
      octets += sous.octets
      fichiers += sous.fichiers
      continue
    }
    try {
      octets += statSync(enfant).size
      fichiers += 1
      restant.fichiers -= 1
    } catch {
      /* disparu entre le listing et le stat : il ne compte pas */
    }
  }
  return { octets, fichiers }
}

/**
 * Inventorie les familles NOMMEES sous `racine`. On ne balaie jamais la racine entiere : les caches
 * Chromium y vivent aussi, et les compter ferait passer pour « accumule par Autowin » ce qui
 * appartient au navigateur embarque.
 */
export function inventorierDisque(
  racine: string,
  familles: readonly string[],
  menage: readonly MenageDemarrage[] = []
): InventaireDisque {
  const mesures = familles.map((nom) => {
    const restant = { fichiers: MAX_FICHIERS_PAR_FAMILLE }
    const { octets, fichiers } = mesurerDossier(join(racine, nom), restant)
    return { nom, octets, fichiers, partiel: restant.fichiers <= 0 }
  })
  return {
    racine,
    octets: mesures.reduce((total, famille) => total + famille.octets, 0),
    familles: [...mesures].sort((a, b) => b.octets - a.octets),
    partiel: mesures.some((famille) => famille.partiel),
    menage: [...menage]
  }
}

/**
 * Le menage du demarrage n'a lieu QU'UNE FOIS, bien avant que l'interface demande quoi que ce soit.
 * Ses chiffres n'existaient donc plus quand on voulait les montrer : on les RETIENT ici.
 */
const menageDuDemarrage: MenageDemarrage[] = []

export function retenirMenageDemarrage(passe: MenageDemarrage): void {
  const existant = menageDuDemarrage.findIndex((item) => item.famille === passe.famille)
  if (existant >= 0) menageDuDemarrage[existant] = passe
  else menageDuDemarrage.push(passe)
}

export function menageDemarrage(): MenageDemarrage[] {
  return [...menageDuDemarrage]
}

/** Remet le releve a zero. Existe pour qu'aucun chiffre ne fuite d'un test a l'autre. */
export function oublierMenageDemarrage(): void {
  menageDuDemarrage.length = 0
}
