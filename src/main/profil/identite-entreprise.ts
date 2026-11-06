import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * IDENTITE D'ENTREPRISE, LUE EN OPTION — jamais ecrite dans le code.
 *
 * Pourquoi (2026-10-13, conv-913) : la version publique du depot ne doit porter aucune donnee
 * propre a une entreprise. Ces donnees vivent dans `entreprise/<nom>/identite.json`, un dossier
 * absent de la version publique. Le code ne connait que des valeurs NEUTRES ; un profil present
 * leur ajoute ce que les postes de cette entreprise ont DEJA sur disque : les anciens noms de
 * variables (lus en secours), le dossier d'installation du Brain, le nom de service que signe
 * chaque echange avec lui, et l'identifiant Windows de l'application.
 *
 * Retirer ces anciens noms sans les fournir ici couperait le Brain des postes deja installes :
 * leur serveur Python est une COPIE locale qui ne lit que ces noms-la (cf. `brain/install.ps1`).
 *
 * TRANSPORT : a la PREMIERE lecture de l'identite du processus, ce module cherche le profil a la
 * racine de l'application (le premier dossier parent qui porte un `package.json`) et publie son
 * contenu dans `AUTOWIN_IDENTITE_ENTREPRISE`. Workers, serveur Python et outils lances par l'app
 * heritent ainsi de la MEME identite — y compris en version empaquetee, ou le fichier vit dans
 * l'archive asar, que Python ne sait pas lire. La valeur `{}` force l'identite neutre (tests).
 *
 * POURQUOI A LA PREMIERE LECTURE, ET PAS AU DEMARRAGE DE `index.ts` : des modules calculent un
 * chemin du Brain des leur chargement (`SHARED_BRAIN_ROOT = sharedBrainRoot()`, viz/fs-brains.ts).
 * MESURE le 2026-10-13 sur le code construit (`out/main/index.js`) : l'empaqueteur charge ces
 * modules (ligne 25) AVANT toute instruction de `index.ts` (ligne 50), meme un import place en
 * premier. Publie au demarrage, le profil arrivait trop tard et cette racine ignorait les anciens
 * noms poses sur les postes de l'entreprise.
 */
export const VARIABLE_IDENTITE = 'AUTOWIN_IDENTITE_ENTREPRISE'

/** Dossier racine des profils, a la racine du depot. Exclu de la version publique. */
export const DOSSIER_ENTREPRISE = 'entreprise'

export interface IdentiteBrain {
  /** Nom de service signe dans chaque echange avec le serveur Brain, et prefixe des schemas de notes. */
  service: string
  /** Dossier d'installation du Brain partage, sous %LOCALAPPDATA%. */
  dossierLocal: string
  /** Meme role hors Windows, sous le dossier personnel. */
  dossierMaison: string
  /** Nom NEUTRE → ancien nom, lu en secours et recopie pour les serveurs deja installes. */
  variables: Readonly<Record<string, string>>
}

export interface IdentiteApplication {
  /** Identifiant Windows de l'application (AppUserModelID), deja connu des postes installes. */
  appId?: string
  /** Dossier d'editeur sous %LOCALAPPDATA% ; neutre : aucun. */
  dossierEditeur?: string
}

/**
 * DOMAINE METIER de l'entreprise (conv-916) : le vocabulaire que son Brain range a part — un scope
 * de notes, son theme, sa carte, ses projets de code. Le code n'en connait aucun : sans profil
 * (version publique), le graphe et le Brain n'ont pas de domaine metier.
 */
export interface IdentiteMetier {
  /** Cle du domaine : scope `<cle>`, theme `theme/<cle>`, carte `knowledge/_maps/<cle>`, projets `projects/<cle>-*`. */
  cle: string
  /** Libelle court affiche dans le graphe (ex. un sigle). */
  libelle: string
  /** Dossier de la documentation source, sous `knowledge/domain/`. */
  documentation?: string
  /** Sous-projet range a part dans le graphe, avant le domaine (chemins qui contiennent un motif). */
  sousProjet?: { libelle: string; motifs: string[] }
  /** Libelle de la categorie du graphe qui regroupe le domaine. */
  categorie?: string
  /** Projets de code du Brain (`projects/<dossier>/`) et leur libelle dans le graphe. */
  projets: { dossier: string; libelle: string }[]
  /** Mots propres au domaine, ajoutes aux regles des categories generiques du graphe. */
  motsCles: Readonly<Record<string, readonly string[]>>
}

export interface IdentiteEntreprise {
  application: IdentiteApplication
  brain: IdentiteBrain
  metier?: IdentiteMetier
}

export const IDENTITE_NEUTRE: IdentiteEntreprise = Object.freeze({
  application: Object.freeze({}),
  brain: Object.freeze({
    service: 'autowin-brain',
    dossierLocal: 'AutowinBrain',
    dossierMaison: '.autowin-brain',
    variables: Object.freeze({})
  })
})

const NOM_SERVICE = /^[a-z0-9][a-z0-9-]{0,62}$/
// Un nom fait seulement de points (`.`, `..`) viserait le dossier courant ou parent : refuse.
const NOM_DOSSIER = /^(?!\.+$)[A-Za-z0-9._-]{1,64}$/
const NOM_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/
const APP_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

function chaine(valeur: unknown, motif: RegExp): string | undefined {
  return typeof valeur === 'string' && motif.test(valeur) ? valeur : undefined
}

const CLE_METIER = /^[a-z][a-z0-9]{0,31}$/
// Dossiers, motifs et mots-cles sont compares a des chemins et textes mis en minuscules.
const MOT_METIER = /^[a-z0-9][a-z0-9 ._-]{0,63}$/
const LIBELLE = /^[^\r\n]{1,80}$/

function liste(valeur: unknown, motif: RegExp): string[] {
  return Array.isArray(valeur)
    ? valeur.filter((mot): mot is string => typeof mot === 'string' && motif.test(mot))
    : []
}

/** Domaine metier du profil, ou `undefined` (neutre) si sa cle ou son libelle manquent. */
function normaliserMetier(brut: unknown): IdentiteMetier | undefined {
  if (!brut || typeof brut !== 'object') return undefined
  const metier = brut as Record<string, unknown>
  const cle = chaine(metier.cle, CLE_METIER)
  const libelle = chaine(metier.libelle, LIBELLE)
  if (!cle || !libelle) return undefined
  const graphe = (
    metier.graphe && typeof metier.graphe === 'object' ? metier.graphe : {}
  ) as Record<string, unknown>
  const sous = (
    metier.sousProjet && typeof metier.sousProjet === 'object' ? metier.sousProjet : {}
  ) as Record<string, unknown>
  const sousLibelle = chaine(sous.libelle, LIBELLE)
  const sousMotifs = liste(sous.motifs, MOT_METIER)
  const motsCles: Record<string, string[]> = {}
  if (graphe.motsCles && typeof graphe.motsCles === 'object') {
    for (const [categorie, mots] of Object.entries(graphe.motsCles as Record<string, unknown>)) {
      const valides = liste(mots, MOT_METIER)
      if (valides.length > 0) motsCles[categorie] = valides
    }
  }
  return {
    cle,
    libelle,
    documentation: chaine(metier.documentation, MOT_METIER),
    sousProjet:
      sousLibelle && sousMotifs.length > 0
        ? { libelle: sousLibelle, motifs: sousMotifs }
        : undefined,
    categorie: chaine(graphe.categorie, LIBELLE),
    projets: (Array.isArray(graphe.projets) ? graphe.projets : []).flatMap((projet: unknown) => {
      const p = (projet && typeof projet === 'object' ? projet : {}) as Record<string, unknown>
      const dossier = chaine(p.dossier, MOT_METIER)
      const libelleProjet = chaine(p.libelle, LIBELLE)
      return dossier && libelleProjet ? [{ dossier, libelle: libelleProjet }] : []
    }),
    motsCles
  }
}

/**
 * Normalise un profil brut. Chaque champ invalide ou absent retombe sur sa valeur NEUTRE : un profil
 * mal forme ne peut ni injecter un chemin (`..`), ni faire lire une variable arbitraire.
 */
export function normaliserIdentite(brut: unknown): IdentiteEntreprise {
  const profil = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>
  const brain = (profil.brain && typeof profil.brain === 'object' ? profil.brain : {}) as Record<
    string,
    unknown
  >
  const application = (
    profil.application && typeof profil.application === 'object' ? profil.application : {}
  ) as Record<string, unknown>
  const variables: Record<string, string> = {}
  if (brain.variables && typeof brain.variables === 'object') {
    for (const [neutre, ancien] of Object.entries(brain.variables as Record<string, unknown>)) {
      const nom = chaine(ancien, NOM_VARIABLE)
      if (NOM_VARIABLE.test(neutre) && nom && nom !== neutre) variables[neutre] = nom
    }
  }
  const neutre = IDENTITE_NEUTRE.brain
  return {
    application: {
      appId: chaine(application.appId, APP_ID),
      dossierEditeur: chaine(application.dossierEditeur, NOM_DOSSIER)
    },
    brain: {
      service: chaine(brain.service, NOM_SERVICE) ?? neutre.service,
      dossierLocal: chaine(brain.dossierLocal, NOM_DOSSIER) ?? neutre.dossierLocal,
      dossierMaison: chaine(brain.dossierMaison, NOM_DOSSIER) ?? neutre.dossierMaison,
      variables
    },
    metier: normaliserMetier(profil.metier)
  }
}

let derniereLecture: { brut: string; identite: IdentiteEntreprise } | undefined
let profilDuProcessusCherche = false

/** Racine de l'application : premier dossier parent de ce module qui porte un `package.json`. */
export function racineDeLApplication(
  depart = dirname(fileURLToPath(import.meta.url))
): string | undefined {
  let dossier = depart
  for (let profondeur = 0; profondeur < 8; profondeur += 1) {
    if (existsSync(join(dossier, 'package.json'))) return dossier
    const parent = dirname(dossier)
    if (parent === dossier) return undefined
    dossier = parent
  }
  return undefined
}

/**
 * Identite portee par `env` (defaut : celle du processus). Absente, vide ou illisible = neutre.
 * Pour le PROCESSUS seulement (`env` = `process.env`), une variable absente declenche une seule
 * recherche du profil a la racine de l'application. Un `env` explicite (un test, un enfant prepare)
 * ne lit que ce qu'il porte.
 */
export function identiteEntreprise(env: NodeJS.ProcessEnv = process.env): IdentiteEntreprise {
  if (env === process.env && env[VARIABLE_IDENTITE] === undefined && !profilDuProcessusCherche) {
    profilDuProcessusCherche = true
    const racine = racineDeLApplication()
    if (racine) publierIdentiteEntreprise(racine, env)
  }
  const brut = env[VARIABLE_IDENTITE]?.trim()
  if (!brut) return IDENTITE_NEUTRE
  if (derniereLecture?.brut === brut) return derniereLecture.identite
  let identite: IdentiteEntreprise
  try {
    identite = normaliserIdentite(JSON.parse(brut))
  } catch {
    identite = IDENTITE_NEUTRE
  }
  derniereLecture = { brut, identite }
  return identite
}

export function identiteBrain(env: NodeJS.ProcessEnv = process.env): IdentiteBrain {
  return identiteEntreprise(env).brain
}

/** Domaine metier de l'entreprise, ou `undefined` (version publique, tests). */
export function identiteMetier(env: NodeJS.ProcessEnv = process.env): IdentiteMetier | undefined {
  return identiteEntreprise(env).metier
}

/** Ancien nom d'une variable NEUTRE, s'il en existe un pour cette entreprise. */
export function nomHistorique(
  neutre: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return identiteBrain(env).variables[neutre]
}

/**
 * Recopie, dans l'environnement d'un processus enfant, chaque reglage NEUTRE sous son ancien nom.
 * Un serveur Brain deja installe sur le poste ne lit que l'ancien nom : sans cette recopie, il
 * retomberait sur ses defauts (port 8765, racine heritee) — le defaut vecu le 2026-09-03 (conv-8).
 */
export function recopierNomsHistoriques(
  enfant: NodeJS.ProcessEnv,
  env: NodeJS.ProcessEnv = process.env
): void {
  for (const [neutre, ancien] of Object.entries(identiteBrain(env).variables)) {
    const valeur = enfant[neutre]
    if (valeur !== undefined) enfant[ancien] = valeur
  }
}

/**
 * Cherche `entreprise/<nom>/identite.json` sous la racine de l'application. Un seul profil est
 * attendu ; s'il y en a plusieurs, le premier par ordre alphabetique gagne (ordre deterministe).
 */
export function lireIdentiteDuDepot(racine: string): string | undefined {
  const dossier = join(racine, DOSSIER_ENTREPRISE)
  let noms: string[]
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
      const brut = readFileSync(join(dossier, nom, 'identite.json'), 'utf8')
      // Valide avant de publier : un JSON casse ne doit pas masquer le profil suivant.
      JSON.parse(brut)
      return brut
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * Au demarrage du processus principal : publie l'identite du depot dans l'environnement. Le fichier
 * du depot prime sur une valeur heritee (un redemarrage herite de l'ancien environnement : sans cette
 * priorite, un profil modifie ne serait jamais relu). Sans fichier, la valeur heritee reste en
 * vigueur. Rend la valeur en vigueur.
 */
export function publierIdentiteEntreprise(
  racine: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const brut = lireIdentiteDuDepot(racine)
  if (!brut) return env[VARIABLE_IDENTITE]?.trim() || undefined
  const compact = JSON.stringify(JSON.parse(brut))
  env[VARIABLE_IDENTITE] = compact
  return compact
}
