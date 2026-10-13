/**
 * Identite d'entreprise pour les SCRIPTS du depot — meme contrat que `src/main/identite-entreprise.ts`
 * (application) et `brain/tooling/brain_identite.py` (Brain).
 *
 * Le depot ne nomme aucune entreprise. Un profil `entreprise/<nom>/identite.json` (absent de la
 * version publique) fournit les noms deja poses sur ses postes. Ordre : la variable
 * `AUTOWIN_IDENTITE_ENTREPRISE` publiee par l'app (`{}` = neutre), puis le fichier du depot.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RACINE_DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const NEUTRE = Object.freeze({
  service: 'autowin-brain',
  dossierLocal: 'AutowinBrain',
  dossierMaison: '.autowin-brain',
  racinePartagee: '',
  variables: Object.freeze({})
})

/** Premier `entreprise/<nom>/identite.json` lisible, par ordre alphabetique (meme regle que l'app). */
export function lireProfil(racine = RACINE_DEPOT) {
  const dossier = join(racine, 'entreprise')
  let noms
  try {
    noms = readdirSync(dossier, { withFileTypes: true })
      .filter((entree) => entree.isDirectory())
      .map((entree) => entree.name)
      .sort()
  } catch {
    return undefined
  }
  for (const nom of noms) {
    try {
      return JSON.parse(readFileSync(join(dossier, nom, 'identite.json'), 'utf8'))
    } catch {
      continue
    }
  }
  return undefined
}

/** Profil en vigueur : celui publie par l'app, sinon celui du depot, sinon aucun. */
export function profilEnVigueur(env = process.env, racine = RACINE_DEPOT) {
  const publie = env.AUTOWIN_IDENTITE_ENTREPRISE?.trim()
  if (publie) {
    try {
      return JSON.parse(publie)
    } catch {
      return undefined
    }
  }
  return lireProfil(racine)
}

/** Identite du Brain : valeurs neutres, completees par le profil s'il est valide. */
export function identiteBrain(env = process.env, racine = RACINE_DEPOT) {
  const brain = profilEnVigueur(env, racine)?.brain ?? {}
  const champ = (nom, motif) =>
    typeof brain[nom] === 'string' && motif.test(brain[nom]) ? brain[nom] : NEUTRE[nom]
  const variables = {}
  for (const [neutre, ancien] of Object.entries(brain.variables ?? {})) {
    if (
      /^[A-Z][A-Z0-9_]*$/.test(neutre) &&
      typeof ancien === 'string' &&
      /^[A-Z][A-Z0-9_]*$/.test(ancien)
    ) {
      variables[neutre] = ancien
    }
  }
  return {
    service: champ('service', /^[a-z0-9][a-z0-9-]{0,62}$/),
    dossierLocal: champ('dossierLocal', /^(?!\.+$)[A-Za-z0-9._-]{1,64}$/),
    dossierMaison: champ('dossierMaison', /^(?!\.+$)[A-Za-z0-9._-]{1,64}$/),
    racinePartagee: typeof brain.racinePartagee === 'string' ? brain.racinePartagee : '',
    variables
  }
}

/**
 * Noms qu'aucun fichier hors de `entreprise/` ne doit porter : le nom de chaque dossier de profil et
 * le champ `nom` de son `identite.json`, en minuscules. Meme regle que la garde
 * `src/main/separation-entreprise.test.ts`.
 */
export function nomsDesProfils(racine = RACINE_DEPOT) {
  const dossier = join(racine, 'entreprise')
  let entrees
  try {
    entrees = readdirSync(dossier, { withFileTypes: true }).filter((entree) => entree.isDirectory())
  } catch {
    return []
  }
  const noms = new Set()
  for (const entree of entrees) {
    noms.add(entree.name.toLowerCase())
    try {
      const profil = JSON.parse(readFileSync(join(dossier, entree.name, 'identite.json'), 'utf8'))
      if (typeof profil.nom === 'string' && profil.nom.trim())
        noms.add(profil.nom.trim().toLowerCase())
    } catch {
      // Profil absent ou illisible : le nom du dossier suffit.
    }
  }
  return [...noms]
}

/**
 * Mots courants qu'aucun motif interdit ne doit toucher. Mesure le 2026-10-13 dans ce depot :
 * `corrige` 958 fichiers, `origine` 773, `origin` 654, `right` 490, `trigger` 161, `original` 161. Un
 * motif qui les attrape rendrait la garde aveugle (tout fichier le contiendrait) — meme raison que
 * le refus d'un nom de moins de 4 lettres.
 */
const MOTS_TEMOINS = Object.freeze([
  '',
  'origine',
  'origin',
  'original',
  'corrige',
  'trigger',
  'right',
  'rigoureux',
  'rigide',
  'rigueur'
])

/**
 * Termes qu'aucun fichier hors de `entreprise/` ne doit porter, AU-DELA du nom : le champ
 * `termesInterdits` de chaque profil — le metier, les serveurs, les collegues, les chemins
 * personnels. Ce sont des MOTIFS (expressions regulieres, `ignorerCasse` en option) et non des
 * sous-chaines : un sigle de trois lettres cherche en sous-chaine toucherait `origine`. Meme source
 * pour la garde `src/main/separation-entreprise.test.ts` et l'export `export-public.mjs`.
 *
 * Rend `{ termes, erreurs }`. Une liste mal formee (pas une liste, motif absent, vide, illisible ou
 * trop large) est une ERREUR nommee, jamais une liste vide : une faute de frappe ne doit pas
 * desarmer la garde en silence. Un profil sans `termesInterdits` ne protege que son nom.
 */
export function termesDesProfils(racine = RACINE_DEPOT) {
  const dossier = join(racine, 'entreprise')
  let entrees
  try {
    entrees = readdirSync(dossier, { withFileTypes: true }).filter((entree) => entree.isDirectory())
  } catch {
    return { termes: [], erreurs: [] }
  }
  const termes = []
  const erreurs = []
  for (const entree of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
    let texte
    try {
      texte = readFileSync(join(dossier, entree.name, 'identite.json'), 'utf8')
    } catch {
      continue // pas de profil : le nom du dossier reste garde par `nomsDesProfils`
    }
    let profil
    try {
      profil = JSON.parse(texte)
    } catch {
      erreurs.push(`${entree.name}/identite.json : profil illisible, termes interdits inconnus`)
      continue
    }
    const liste = profil?.termesInterdits
    if (liste === undefined) continue
    if (!Array.isArray(liste)) {
      erreurs.push(`${entree.name} : termesInterdits doit etre une liste`)
      continue
    }
    liste.forEach((terme, rang) => {
      const ou = `${entree.name} : termesInterdits[${rang}]`
      if (!terme || typeof terme !== 'object' || typeof terme.motif !== 'string') {
        erreurs.push(`${ou} : motif absent`)
        return
      }
      if (!terme.motif.trim()) {
        erreurs.push(`${ou} : motif vide`)
        return
      }
      if (terme.ignorerCasse !== undefined && typeof terme.ignorerCasse !== 'boolean') {
        erreurs.push(`${ou} : ignorerCasse doit etre vrai ou faux`)
        return
      }
      let regex
      try {
        regex = new RegExp(terme.motif, terme.ignorerCasse ? 'i' : '')
      } catch (erreur) {
        erreurs.push(`${ou} : motif illisible (${erreur.message})`)
        return
      }
      const temoin = MOTS_TEMOINS.find((mot) => regex.test(mot))
      if (temoin !== undefined) {
        erreurs.push(`${ou} : motif trop large, il touche « ${temoin} »`)
        return
      }
      termes.push({
        profil: entree.name,
        rang,
        regex,
        sujet: typeof terme.sujet === 'string' ? terme.sujet : ''
      })
    })
  }
  return { termes, erreurs }
}

/**
 * Le texte d'un fichier, ou `undefined` s'il est binaire. Un octet nul signale un binaire, sauf en
 * UTF-16LE (scripts PowerShell : marque FF FE, ou un octet nul sur deux) — une image peut porter
 * trois lettres par hasard (mesure : `docs/screenshots/chat.png`), un script UTF-16 non.
 */
export function texteDuFichier(octets) {
  const debut = octets.subarray(0, 8192)
  if (!debut.includes(0)) return octets.toString('utf8')
  if (debut[0] === 0xff && debut[1] === 0xfe) return octets.toString('utf16le')
  let nulsImpairs = 0
  let nulsPairs = 0
  for (let i = 0; i < debut.length; i += 1) {
    if (debut[i] !== 0) continue
    if (i % 2 === 1) nulsImpairs += 1
    else nulsPairs += 1
  }
  const moitie = debut.length / 2
  return nulsImpairs > moitie * 0.3 && nulsPairs < moitie * 0.05
    ? octets.toString('utf16le')
    : undefined
}

/** Premier terme interdit trouve dans `texte` (contenu ou chemin), ou `undefined`. */
export function termeTrouve(texte, termes) {
  if (texte === undefined) return undefined
  return termes.find((terme) => terme.regex.test(texte))
}

/** Reglage : le nom NEUTRE d'abord, son ancien nom (profil) en secours. Vide = absent. */
export function lireReglage(neutre, env = process.env, racine = RACINE_DEPOT) {
  const ancien = identiteBrain(env, racine).variables[neutre]
  return env[neutre]?.trim() || (ancien ? env[ancien]?.trim() : undefined) || undefined
}
