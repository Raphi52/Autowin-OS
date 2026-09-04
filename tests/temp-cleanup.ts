import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * NETTOYAGE DES DOSSIERS TEMPORAIRES DE LA SUITE DE TESTS.
 *
 * MESURÉ le 2026-09-02 : le dossier temporaire de Windows contenait 4 240 dossiers `autowin*` pour
 * 1 274 Mo, dont `autowin-trace-large` (780 Mo), `autowin-shortcut-identity` (88 Mo) et
 * `autowin-trace-volume` (34 Mo). La cause n'est pas l'application : ~240 fichiers de test appellent
 * `mkdtempSync` et n'appellent JAMAIS `rmSync`. Le tas grossit à chaque `npm test`.
 *
 * Le corriger fichier par fichier, c'est ~240 éditions et un oubli garanti au prochain test écrit.
 * On le corrige donc à l'endroit qui possède le CYCLE DE VIE de la suite : un teardown global.
 *
 * DEUX GARDES, parce qu'un nettoyage large est plus dangereux que la fuite qu'il répare :
 *
 * 1. Seuls les dossiers CRÉÉS PENDANT ce run partent (`birthtime >= debutDuRun`). Un dossier
 *    temporaire qui appartient à une autre exécution — la suite d'un collègue, une autre copie de
 *    travail qui teste en parallèle, l'application elle-même — n'est jamais touché.
 * 2. `autowin-tests-appdata` est ÉPARGNÉ : ce n'est pas un résidu mais la racine de données isolée
 *    que `vitest.config.ts` impose à tous les tests (chemin stable et voulu, pas aléatoire).
 *
 * Le préfixe seul ne suffirait pas comme critère : `autowin-tests-appdata` le porte aussi.
 */
export const PREFIXE_TEMPORAIRE_DE_TEST = 'autowin'

/**
 * PREFIXES DES DOSSIERS TEMPORAIRES DE LA SUITE.
 *
 * MESURE du 2026-09-04 sur le dossier temporaire du poste : 27 995 dossiers portant un prefixe de
 * l'app ou de ses tests, dont 5 000+ en `aos-` (`aos-chatsess-`, `aos-sessresume-`,
 * `aos-convruns-dod-`...). Le nettoyage ci-dessus ne regardait que `autowin` : tout le tas `aos-`
 * lui echappait entierement.
 */
export const PREFIXES_TEMPORAIRES_DE_TEST = ['autowin', 'aos-'] as const

/** Racine de données isolée des tests — voir `vitest.config.ts`. Jamais supprimée. */
export const DOSSIER_A_EPARGNER = 'autowin-tests-appdata'

/**
 * DOSSIERS DE L'APPLICATION QUI TOURNE — jamais supprimés, même nés pendant le run.
 *
 * MESURÉ le 2026-09-04 : 10 appels au CLI claude sont morts en `exit 1` sur
 * « Settings file not found: (dossier temporaire de reglages) », dont deux phases
 * kaizen et un freeze utilisateur. Cause : ces dossiers portent le préfixe `autowin`, donc la garde
 * n°1 (« né pendant ce run ») ne les protégeait PAS — l'application vit sur le même poste que la
 * suite, et un `npm test` lancé pendant qu'un appel provider démarre lui arrachait, sous les pieds,
 * le fichier de réglages que le CLI n'avait pas encore lu.
 *
 * Une date de naissance ne distingue pas un résidu de test d'un fichier VIVANT. Le préfixe, si :
 * ceux-ci sont créés par `src/main/providers/*.ts` pour la durée d'un appel, et nettoyés par lui.
 * Les quelques tests qui réutilisent ces préfixes laissent un dossier vide — coût sans commune
 * mesure avec un appel de modèle tué en plein vol.
 */
export const PREFIXES_VIVANTS_DE_LAPP = [
  'autowin-os-settings-',
  'autowin-os-system-',
  'autowin-os-mcp-',
  'autowin-os-attachments-',
  'autowin-os-gemini-',
  'autowin-os-gemini-auth-',
  'autowin-os-kimi-'
] as const

export interface ResultatNettoyage {
  supprimes: string[]
  epargnes: string[]
  echecs: string[]
}

/**
 * PREFIXES LUS DANS LE CODE DE LA SUITE — la liste ne se maintient plus a la main.
 *
 * MESURE du 2026-09-04 : 15 581 dossiers residuels dans le dossier temporaire du poste. Les plus
 * gros tas — `gel-` (1 582), `cible-` (1 356), `ledger-refus-` (1 169), `moteur-`, `flux-brut-`,
 * `tests-view-` — ne portent NI `autowin` NI `aos-`, donc le nettoyage ci-dessous ne les voyait
 * pas. Ajouter ces six prefixes aurait rouvert le trou au prochain test ecrit avec un septieme.
 *
 * On lit donc les prefixes la ou ils sont DECLARES : les appels `mkdtempSync(join(tmpdir(), '...'))`
 * du depot. Consequence : le nettoyage ne connait que le vocabulaire de la SUITE — un dossier
 * temporaire d'un autre programme ne peut pas y entrer par accident, et un test ecrit demain est
 * couvert sans toucher a ce fichier.
 *
 * LIMITE ASSUMEE : un prefixe calcule (`mkdtempSync(join(tmpdir(), prefixe))`) n'est pas litteral,
 * donc pas vu. Ces dossiers restent au filet de la purge par age.
 */
const MOTIF_PREFIXE = /mkdtempSync\(\s*(?:join|resolve)\(\s*(?:os\.)?tmpdir\(\)\s*,\s*['"`]([^'"`]+)['"`]/g

/** Dossiers du depot ou vivent les appels a `mkdtempSync` (tests et sources). */
const DOSSIERS_A_LIRE = ['src', 'tests', 'scripts'] as const

function fichiersCandidats(racine: string, restant: { budget: number }): string[] {
  if (restant.budget <= 0) return []
  let entrees: { nom: string; dossier: boolean }[]
  try {
    entrees = readdirSync(racine, { withFileTypes: true }).map((e) => ({
      nom: e.name,
      dossier: e.isDirectory()
    }))
  } catch {
    return []
  }
  const trouves: string[] = []
  for (const entree of entrees) {
    if (entree.nom === 'node_modules' || entree.nom.startsWith('.')) continue
    const chemin = join(racine, entree.nom)
    if (entree.dossier) {
      trouves.push(...fichiersCandidats(chemin, restant))
      continue
    }
    if (!/\.(ts|mts|mjs|js)$/.test(entree.nom)) continue
    restant.budget -= 1
    trouves.push(chemin)
    if (restant.budget <= 0) break
  }
  return trouves
}

const cachePrefixes = new Map<string, string[]>()

/**
 * Rend les prefixes temporaires utilises par la suite : les deux historiques, plus tous ceux
 * declares litteralement dans le depot. Resultat mis en cache par racine (un teardown, une lecture).
 */
export function prefixesTemporairesDeLaSuite(racineDepot?: string): string[] {
  const racine = racineDepot ?? fileURLToPath(new URL('..', import.meta.url))
  const enCache = cachePrefixes.get(racine)
  if (enCache) return enCache

  const prefixes = new Set<string>(PREFIXES_TEMPORAIRES_DE_TEST)
  const restant = { budget: 5000 }
  for (const dossier of DOSSIERS_A_LIRE) {
    for (const fichier of fichiersCandidats(join(racine, dossier), restant)) {
      let contenu: string
      try {
        contenu = readFileSync(fichier, 'utf-8')
      } catch {
        continue
      }
      if (!contenu.includes('mkdtempSync')) continue
      MOTIF_PREFIXE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = MOTIF_PREFIXE.exec(contenu)) !== null) {
        const prefixe = m[1]
        // GARDE-FOU DE LARGEUR. Sur les 555 prefixes lus le 2026-09-04, quelques-uns sont trop
        // generiques pour servir de critere de suppression (`tj-`, `jis-`, et meme `...` capture
        // dans un exemple de commentaire). On n'accepte donc qu'un prefixe d'au moins 4 signes
        // termine par `-` : assez specifique pour ne jamais designer le dossier d'un autre
        // programme, et c'est la forme qu'ont tous les vrais prefixes de la suite.
        if (prefixe.length >= 4 && prefixe.endsWith('-')) prefixes.add(prefixe)
      }
    }
  }

  const liste = [...prefixes]
  cachePrefixes.set(racine, liste)
  return liste
}

/**
 * Supprime, dans `racine`, les dossiers temporaires de test créés à partir de `debutDuRun`.
 * Rend le détail pour que le nettoyage soit VÉRIFIABLE, pas seulement effectué.
 */
export function nettoyerDossiersTemporairesDeTest(
  racine: string,
  debutDuRun: number
): ResultatNettoyage {
  const resultat: ResultatNettoyage = { supprimes: [], epargnes: [], echecs: [] }

  let entrees: string[]
  try {
    entrees = readdirSync(racine)
  } catch {
    // Racine illisible (poste verrouillé, chemin absent) : un nettoyage n'a jamais le droit de
    // faire échouer une suite qui vient de passer.
    return resultat
  }

  const prefixes = prefixesTemporairesDeLaSuite()

  for (const nom of entrees) {
    if (!prefixes.some((prefixe) => nom.startsWith(prefixe))) continue
    if (nom === DOSSIER_A_EPARGNER) {
      resultat.epargnes.push(nom)
      continue
    }
    // Dossier de vie de l'application qui tourne : jamais à nous, même né pendant ce run.
    if (PREFIXES_VIVANTS_DE_LAPP.some((prefixe) => nom.startsWith(prefixe))) {
      resultat.epargnes.push(nom)
      continue
    }
    const chemin = join(racine, nom)
    let ne: number
    try {
      const infos = statSync(chemin)
      if (!infos.isDirectory()) continue
      ne = infos.birthtimeMs
    } catch {
      continue
    }
    // Antérieur au run : il appartient à quelqu'un d'autre.
    if (ne < debutDuRun) {
      resultat.epargnes.push(nom)
      continue
    }
    try {
      rmSync(chemin, { recursive: true, force: true })
      resultat.supprimes.push(nom)
    } catch {
      // Un verrou Windows sur un fichier encore ouvert ne doit pas rendre la suite rouge.
      resultat.echecs.push(nom)
    }
  }

  return resultat
}


/**
 * PURGE BORNEE PAR L'AGE — le tas deja accumule, que la garde « ne pendant ce run » ne peut pas
 * toucher par construction.
 *
 * La borne d'age est le garde-fou : un dossier de plus de `ageMinimalMs` n'appartient a aucun appel
 * ni a aucune suite en cours. Les dossiers VIVANTS de l'application (voir `PREFIXES_VIVANTS_DE_LAPP`)
 * restent epargnes quel que soit leur age — un appel provider peut etre long.
 */
export function purgerDossiersTemporairesAnciens(
  racine: string,
  maintenant: number,
  ageMinimalMs: number
): ResultatNettoyage {
  const resultat: ResultatNettoyage = { supprimes: [], epargnes: [], echecs: [] }
  const prefixesAnciens = prefixesTemporairesDeLaSuite()

  let entrees: string[]
  try {
    entrees = readdirSync(racine)
  } catch {
    return resultat
  }

  for (const nom of entrees) {
    if (!prefixesAnciens.some((prefixe) => nom.startsWith(prefixe))) continue
    if (nom === DOSSIER_A_EPARGNER) {
      resultat.epargnes.push(nom)
      continue
    }
    if (PREFIXES_VIVANTS_DE_LAPP.some((prefixe) => nom.startsWith(prefixe))) {
      resultat.epargnes.push(nom)
      continue
    }
    const chemin = join(racine, nom)
    let derniereActivite: number
    try {
      const infos = statSync(chemin)
      if (!infos.isDirectory()) continue
      derniereActivite = Math.max(infos.birthtimeMs, infos.mtimeMs)
    } catch {
      continue
    }
    if (maintenant - derniereActivite < ageMinimalMs) {
      resultat.epargnes.push(nom)
      continue
    }
    try {
      rmSync(chemin, { recursive: true, force: true })
      resultat.supprimes.push(nom)
    } catch {
      resultat.echecs.push(nom)
    }
  }

  return resultat
}
