/**
 * LE COFFRE À CLÉS — les agents se servent d'une clé API par son NOM, jamais par sa valeur.
 *
 * Pourquoi : un agent qui a besoin d'une clé (Mistral, GitHub…) la réclamait dans le fil ou refusait
 * « je n'ai pas le droit ». Le coffre garde les clés du poste et celles que l'utilisateur saisit ; le
 * lancement d'un agent les injecte en variables d'environnement (`valeursPourAgent`), et tout texte qui
 * sort vers le fil, un fichier ou un journal peut être nettoyé par `masquerValeurs`.
 *
 * Trois règles tiennent ce fichier :
 * - la VALEUR ne quitte jamais le processus principal : `listerCles` ne rend que nom, origine, date et
 *   longueur — c'est tout ce que l'interface reçoit ;
 * - le fichier `coffre-cles.bin` est le JSON entier chiffré par le système (Electron `safeStorage`,
 *   DPAPI sous Windows). Chiffrement indisponible → coffre vide avec sa raison, et AUCUNE écriture :
 *   un coffre en clair serait pire que pas de coffre ;
 * - l'import du poste n'écrase jamais une clé saisie par l'utilisateur, ni ne ramène une clé qu'il a
 *   retirée (`ecartees`) : sinon « retirer » serait défait au démarrage suivant.
 *
 * Les dépendances système (chiffrement, registre, environnement) sont injectables : les tests
 * tournent sans Electron réel.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import { CLE_ENV_SYSTEME, CLE_ENV_UTILISATEUR, variablesDuRegistre } from './env-reload'

export type OrigineCle = 'poste' | 'utilisateur'

export interface EntreeCoffre {
  nom: string
  valeur: string
  origine: OrigineCle
  ajouteLe: string
}

/** Ce que l'interface a le droit de savoir d'une clé : tout sauf sa valeur. */
export interface CleListee {
  nom: string
  origine: OrigineCle
  ajouteLe: string
  longueur: number
}

export interface EtatCoffre {
  disponible: boolean
  /** Pourquoi le coffre est vide ou en lecture seule ; absente quand tout va bien. */
  raison?: string
  cles: CleListee[]
}

export interface BilanImport {
  ajoutees: number
  misesAJour: number
  /** Candidats retenus par le filtre mais laissés tels quels : déjà à jour, saisis ou retirés par l'utilisateur. */
  ignorees: number
  /** Présente quand rien n'a pu être écrit (chiffrement indisponible, coffre illisible). */
  raison?: string
}

/** La réponse d'un geste des réglages (ajouter, retirer, réimporter) : l'état à jour, jamais une valeur. */
export interface ReponseGesteCoffre {
  ok: boolean
  erreur?: string
  bilan?: BilanImport
  etat: EtatCoffre
}

/** Le sous-ensemble d'Electron `safeStorage` dont le coffre a besoin. */
export interface ChiffrementCoffre {
  isEncryptionAvailable(): boolean
  encryptString(texte: string): Buffer
  decryptString(donnees: Buffer): string
}

export interface OptionsCoffre {
  /** Chemin du fichier chiffré ; lu à chaque accès, la racine des données se configure au démarrage. */
  chemin?: () => string
  /** `undefined` rendu = chiffrement absent (hors Electron). */
  chiffrement?: () => ChiffrementCoffre | undefined
  /** Toutes les variables persistées sous une clé de registre. */
  lireRegistre?: (cle: string) => Map<string, string>
  env?: NodeJS.ProcessEnv
  maintenant?: () => Date
}

interface ContenuCoffre {
  version: 1
  entrees: EntreeCoffre[]
  /** Noms retirés par l'utilisateur : l'import du poste ne les ramène plus. */
  ecartees: string[]
}

type Lecture =
  { ok: true; contenu: ContenuCoffre } | { ok: false; raison: string; contenu: ContenuCoffre }

export const NOM_FICHIER_COFFRE = 'coffre-cles.bin'
/** En dessous, une valeur est trop courte pour être masquée sans abîmer du texte ordinaire. */
export const LONGUEUR_MIN_MASQUAGE = 8

const NOM_VALIDE = /^[A-Za-z_][A-Za-z0-9_]*$/
const SUFFIXES_DE_CLE = /(?:_API_KEY|_APIKEY|_KEY|_TOKEN|_SECRET|_PAT|_PASSWORD)$/i
/** Les réglages d'Autowin lui-même ne sont pas des clés d'agent ; `AUTOWIN_COFFRE_NOMS` y vit. */
const PREFIXE_RESERVE = /^AUTOWIN_/i
const LONGUEUR_MAX_VALEUR = 16_384

const RAISON_SANS_CHIFFREMENT =
  "Le chiffrement du système n'est pas disponible : le coffre reste vide et rien n'est écrit en clair."
const RAISON_ILLISIBLE =
  'Le coffre existant ne se déchiffre pas avec cette session Windows : il est laissé intact et rien ' +
  "n'y est écrit. Déplace coffre-cles.bin pour repartir d'un coffre vide."

const vide = (): ContenuCoffre => ({ version: 1, entrees: [], ecartees: [] })
const memeNom = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

/** Le filtre de l'import du poste : un nom de variable qui DÉSIGNE une clé, hors réglages d'Autowin. */
export function estNomDeCle(nom: string): boolean {
  return NOM_VALIDE.test(nom) && SUFFIXES_DE_CLE.test(nom) && !PREFIXE_RESERVE.test(nom)
}

function entreeValide(brute: unknown): brute is EntreeCoffre {
  const e = brute as Partial<EntreeCoffre> | null
  return (
    !!e &&
    typeof e.nom === 'string' &&
    NOM_VALIDE.test(e.nom) &&
    typeof e.valeur === 'string' &&
    e.valeur.length > 0 &&
    (e.origine === 'poste' || e.origine === 'utilisateur') &&
    typeof e.ajouteLe === 'string'
  )
}

/**
 * `safeStorage` chargé à la demande : un import d'`electron` en tête casserait les tests unitaires.
 * `createRequire` est appelé ICI et pas au chargement du module : le suivi des journaux d'agent
 * (`runs/stdout-journal.ts`) importe le coffre, et il est aussi emballé en module ES autonome
 * (`survivable-spawn.test.ts`), où `__filename` n'existe pas. Hors d'Electron, le coffre reste vide.
 */
function safeStorageElectron(): ChiffrementCoffre | undefined {
  try {
    const mod = createRequire(__filename)('electron') as { safeStorage?: ChiffrementCoffre }
    return typeof mod?.safeStorage?.encryptString === 'function' ? mod.safeStorage : undefined
  } catch {
    return undefined
  }
}

export interface Coffre {
  etat(): EtatCoffre
  listerCles(): CleListee[]
  ajouterCle(nom: string, valeur: string): void
  retirerCle(nom: string): boolean
  importerDuPoste(): BilanImport
  valeursPourAgent(exclusions: readonly string[]): Record<string, string>
  masquerValeurs(texte: string): string
}

export function creerCoffre(options: OptionsCoffre = {}): Coffre {
  const chemin = options.chemin ?? (() => join(autowinAppDataRoot(), NOM_FICHIER_COFFRE))
  const chiffrement = options.chiffrement ?? safeStorageElectron
  const lireRegistre = options.lireRegistre ?? variablesDuRegistre
  const env = options.env ?? process.env
  const maintenant = options.maintenant ?? (() => new Date())
  // Seule une lecture RÉUSSIE est gardée : `safeStorage` n'est prêt qu'après `app.whenReady`, un
  // échec mis en cache laisserait le coffre vide jusqu'au redémarrage.
  let cache: ContenuCoffre | undefined

  function chiffreurPret(): ChiffrementCoffre | undefined {
    try {
      const c = chiffrement()
      return c?.isEncryptionAvailable() ? c : undefined
    } catch {
      return undefined
    }
  }

  /** `frais` : une modification repart toujours du disque, jamais d'un cache qui l'ignorerait. */
  function charger(frais = false): Lecture {
    if (frais) cache = undefined
    if (cache) return { ok: true, contenu: cache }
    const c = chiffreurPret()
    if (!c) return { ok: false, raison: RAISON_SANS_CHIFFREMENT, contenu: vide() }
    const fichier = chemin()
    if (!existsSync(fichier)) {
      cache = vide()
      return { ok: true, contenu: cache }
    }
    try {
      const brut = JSON.parse(c.decryptString(readFileSync(fichier))) as Partial<ContenuCoffre>
      if (brut?.version !== 1 || !Array.isArray(brut.entrees)) throw new Error('forme inconnue')
      cache = {
        version: 1,
        entrees: brut.entrees.filter(entreeValide),
        ecartees: Array.isArray(brut.ecartees)
          ? brut.ecartees.filter((n): n is string => typeof n === 'string')
          : []
      }
      return { ok: true, contenu: cache }
    } catch {
      // Jamais le détail de l'erreur : un message de déchiffrement peut citer un morceau du contenu.
      return { ok: false, raison: RAISON_ILLISIBLE, contenu: vide() }
    }
  }

  /** Écriture atomique du JSON chiffré ; refusée (exception lisible) si le coffre n'est pas sûr. */
  function enregistrer(contenu: ContenuCoffre): void {
    const lecture = charger()
    if (!lecture.ok) throw new Error(lecture.raison)
    const c = chiffreurPret()
    if (!c) throw new Error(RAISON_SANS_CHIFFREMENT)
    const fichier = chemin()
    const temporaire = `${fichier}.${process.pid}.tmp`
    mkdirSync(dirname(fichier), { recursive: true })
    try {
      writeFileSync(temporaire, c.encryptString(JSON.stringify(contenu)), { mode: 0o600 })
      renameSync(temporaire, fichier)
    } catch (erreur) {
      rmSync(temporaire, { force: true })
      throw erreur
    } finally {
      cache = undefined
    }
  }

  function lister(contenu: ContenuCoffre): CleListee[] {
    return contenu.entrees
      .map(({ nom, origine, ajouteLe, valeur }) => ({
        nom,
        origine,
        ajouteLe,
        longueur: valeur.length
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom))
  }

  return {
    etat() {
      const lecture = charger()
      return lecture.ok
        ? { disponible: true, cles: lister(lecture.contenu) }
        : { disponible: false, raison: lecture.raison, cles: [] }
    },

    listerCles() {
      return lister(charger().contenu)
    },

    ajouterCle(nomBrut, valeurBrute) {
      const nom = typeof nomBrut === 'string' ? nomBrut.trim() : ''
      const valeur = typeof valeurBrute === 'string' ? valeurBrute.trim() : ''
      if (!NOM_VALIDE.test(nom))
        throw new Error(
          'Nom de clé invalide : lettres, chiffres et « _ », sans commencer par un chiffre.'
        )
      if (PREFIXE_RESERVE.test(nom))
        throw new Error('Les noms AUTOWIN_… sont réservés aux réglages d’Autowin.')
      if (!valeur) throw new Error('La valeur de la clé est vide.')
      if (valeur.length > LONGUEUR_MAX_VALEUR)
        throw new Error(`Valeur trop longue (plus de ${LONGUEUR_MAX_VALEUR} caractères).`)
      const actuel = charger(true)
      if (!actuel.ok) throw new Error(actuel.raison)
      const entrees = actuel.contenu.entrees.filter((e) => !memeNom(e.nom, nom))
      entrees.push({ nom, valeur, origine: 'utilisateur', ajouteLe: maintenant().toISOString() })
      enregistrer({
        version: 1,
        entrees,
        ecartees: actuel.contenu.ecartees.filter((n) => !memeNom(n, nom))
      })
    },

    retirerCle(nomBrut) {
      const nom = typeof nomBrut === 'string' ? nomBrut.trim() : ''
      const actuel = charger(true)
      if (!actuel.ok) throw new Error(actuel.raison)
      const entrees = actuel.contenu.entrees.filter((e) => !memeNom(e.nom, nom))
      if (entrees.length === actuel.contenu.entrees.length) return false
      const ecartees = actuel.contenu.ecartees.filter((n) => !memeNom(n, nom))
      ecartees.push(nom)
      enregistrer({ version: 1, entrees, ecartees })
      return true
    },

    importerDuPoste() {
      const actuel = charger(true)
      if (!actuel.ok) return { ajoutees: 0, misesAJour: 0, ignorees: 0, raison: actuel.raison }
      // Ordre de priorité = la valeur qu'un processus NEUF verrait : l'utilisateur l'emporte sur le
      // système, et l'environnement figé au lancement ne complète que ce qui n'est pas persisté.
      const candidats = new Map<string, { nom: string; valeur: string }>()
      const sources: Iterable<[string, string | undefined]>[] = [
        lireRegistre(CLE_ENV_UTILISATEUR),
        lireRegistre(CLE_ENV_SYSTEME),
        Object.entries(env)
      ]
      for (const source of sources) {
        for (const [nom, brute] of source) {
          const valeur = brute?.trim()
          if (!valeur || !estNomDeCle(nom)) continue
          const cle = nom.toUpperCase()
          if (!candidats.has(cle)) candidats.set(cle, { nom, valeur })
        }
      }
      const bilan: BilanImport = { ajoutees: 0, misesAJour: 0, ignorees: 0 }
      const entrees = actuel.contenu.entrees.map((e) => ({ ...e }))
      for (const { nom, valeur } of candidats.values()) {
        const existante = entrees.find((e) => memeNom(e.nom, nom))
        if (actuel.contenu.ecartees.some((n) => memeNom(n, nom))) bilan.ignorees++
        else if (!existante) {
          entrees.push({ nom, valeur, origine: 'poste', ajouteLe: maintenant().toISOString() })
          bilan.ajoutees++
        } else if (existante.origine === 'utilisateur' || existante.valeur === valeur)
          bilan.ignorees++
        else {
          existante.valeur = valeur
          bilan.misesAJour++
        }
      }
      if (bilan.ajoutees || bilan.misesAJour) {
        try {
          enregistrer({ version: 1, entrees, ecartees: actuel.contenu.ecartees })
        } catch (erreur) {
          return {
            ajoutees: 0,
            misesAJour: 0,
            ignorees: candidats.size,
            raison: erreur instanceof Error ? erreur.message : String(erreur)
          }
        }
      }
      return bilan
    },

    valeursPourAgent(exclusions) {
      const valeurs: Record<string, string> = {}
      for (const e of charger().contenu.entrees) {
        if (!exclusions.some((x) => memeNom(x, e.nom))) valeurs[e.nom] = e.valeur
      }
      return valeurs
    },

    masquerValeurs(texte) {
      if (!texte) return texte
      try {
        // Les plus longues d'abord : une valeur qui en contient une autre doit être masquée entière.
        const aMasquer = charger()
          .contenu.entrees.filter((e) => e.valeur.length >= LONGUEUR_MIN_MASQUAGE)
          .sort((a, b) => b.valeur.length - a.valeur.length || a.nom.localeCompare(b.nom))
        let sortie = texte
        for (const e of aMasquer) {
          if (sortie.includes(e.valeur)) sortie = sortie.split(e.valeur).join(`[secret:${e.nom}]`)
        }
        return sortie
      } catch {
        return texte
      }
    }
  }
}

// Le coffre du processus principal : un seul cache, partagé par l'IPC et les lancements d'agents.
let coffreDuProcessus: Coffre | undefined
const coffre = (): Coffre => (coffreDuProcessus ??= creerCoffre())

export const etatCoffre = (): EtatCoffre => coffre().etat()
export const listerCles = (): CleListee[] => coffre().listerCles()
export const ajouterCle = (nom: string, valeur: string): void => coffre().ajouterCle(nom, valeur)
export const retirerCle = (nom: string): boolean => coffre().retirerCle(nom)
export const importerDuPoste = (): BilanImport => coffre().importerDuPoste()
export const valeursPourAgent = (exclusions: readonly string[]): Record<string, string> =>
  coffre().valeursPourAgent(exclusions)
export const masquerValeurs = (texte: string): string => coffre().masquerValeurs(texte)
