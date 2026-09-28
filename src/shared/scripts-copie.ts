/**
 * SCRIPTS DE PRÉPARATION ET DE LANCEMENT D'UNE COPIE DE TRAVAIL — la partie PURE (aucun disque,
 * aucun processus : tout se teste seul).
 *
 * Écart constaté le 2026-09-28 (veille concurrentielle, conv-877) : Conductor joue un script de
 * préparation à la création de chaque copie et offre un bouton « Run ». Autowin ne savait relier que
 * `node_modules` (en dur, `store/dependances-copie-agent.ts`) : un `.env` ignoré par git, un
 * `pip install`, un fichier généré manquaient dans chaque copie d'agent, et rien ne lançait l'appli.
 *
 * La déclaration vit dans le DÉPÔT, pour être partagée avec l'équipe :
 *
 *     .autowin/scripts.json
 *     {
 *       "preparation": "npm ci",
 *       "lancement": "npm run dev -- --port $AUTOWIN_PORT",
 *       "copier": [".env", ".env.local"]
 *     }
 *
 * Ce qui va au-delà de Conductor :
 * - `copier` est DÉCLARATIF : pas besoin d'écrire un `cp` qui casse sous Windows ;
 * - `$AUTOWIN_PORT` / `${AUTOWIN_PORT}` sont développés par Autowin AVANT l'exécution : la même
 *   ligne marche sous cmd.exe (qui ne connaît que `%VAR%`) comme sous bash ;
 * - un dépôt déjà configuré pour Conductor (`.conductor/settings.toml`) marche tel quel : ses
 *   `setup`/`run` sont lus, et ses variables `CONDUCTOR_*` sont fournies aussi ;
 * - sans aucune déclaration, « Lancer » propose `npm run dev` (ou `npm start`) lu dans
 *   `package.json` — jamais la préparation, qui reste un geste déclaré.
 */

export const CONFIG_AUTOWIN = '.autowin/scripts.json'
export const CONFIG_CONDUCTOR = '.conductor/settings.toml'

/** Nombre de ports réservés à chaque copie, comme Conductor (`CONDUCTOR_PORT` … `+9`). */
export const PORTS_PAR_COPIE = 10
const PORT_MIN = 20_000
const BLOCS_DE_PORTS = 3_000

export type SourceScripts = 'autowin' | 'conductor' | 'package.json'

export interface ScriptsCopie {
  source: SourceScripts
  preparation?: string
  lancement?: string
  /** Fichiers locaux (souvent ignorés par git) copiés du dépôt vers chaque copie, chemins relatifs. */
  copier: string[]
}

/** Ce que le bouton « Lancer » montre d’un lancement, poussé du principal vers l’interface. */
export type EtatLancement = {
  /** `arrete` : jamais lancé ou arrêté à la main. `termine` : sorti seul avec 0. */
  statut: 'arrete' | 'en-cours' | 'termine' | 'echec'
  /** La commande déclarée (non développée) et d'où elle vient. */
  commande?: string
  source?: ScriptsCopie['source']
  /** Déclaration invalide, ou échec de lancement. */
  erreur?: string
  code?: number | null
  port?: number
  adresse?: string
  lignes: string[]
  depuis?: number
}

export type LectureScripts = { ok: true; scripts: ScriptsCopie } | { ok: false; erreur: string }

/**
 * Un chemin à copier doit rester SOUS le dépôt et sous la copie : ni absolu, ni lecteur Windows,
 * ni remontée `..`. Sinon une déclaration pourrait lire ou écrire hors des deux dossiers.
 */
export function cheminACopierValide(chemin: string): boolean {
  const normalise = chemin.replace(/\\/g, '/').trim()
  if (!normalise || normalise.startsWith('/') || /^[a-z]:/i.test(normalise)) return false
  return normalise.split('/').every((segment) => segment !== '..' && segment !== '')
}

function commandeOptionnelle(valeur: unknown, cle: string): string | undefined {
  if (valeur === undefined || valeur === null) return undefined
  if (typeof valeur !== 'string') throw new Error(`« ${cle} » doit être une ligne de commande`)
  return valeur.trim() || undefined
}

/** Lit `.autowin/scripts.json`. Une erreur NOMME la clé fautive : jamais une config ignorée en silence. */
export function lireConfigAutowin(texte: string): LectureScripts {
  let brut: unknown
  try {
    brut = JSON.parse(texte)
  } catch (erreur) {
    return {
      ok: false,
      erreur: `${CONFIG_AUTOWIN} illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    }
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return { ok: false, erreur: `${CONFIG_AUTOWIN} doit contenir un objet JSON` }
  }
  const objet = brut as Record<string, unknown>
  try {
    const copierBrut = objet.copier ?? []
    if (!Array.isArray(copierBrut) || !copierBrut.every((c) => typeof c === 'string')) {
      throw new Error('« copier » doit être une liste de chemins')
    }
    const invalides = copierBrut.filter((c) => !cheminACopierValide(c))
    if (invalides.length) {
      throw new Error(`« copier » refuse les chemins hors du dépôt : ${invalides.join(', ')}`)
    }
    return {
      ok: true,
      scripts: {
        source: 'autowin',
        preparation: commandeOptionnelle(objet.preparation, 'preparation'),
        lancement: commandeOptionnelle(objet.lancement, 'lancement'),
        copier: copierBrut.map((c) => c.replace(/\\/g, '/').trim())
      }
    }
  } catch (erreur) {
    return { ok: false, erreur: `${CONFIG_AUTOWIN} : ${(erreur as Error).message}` }
  }
}

/** Une chaîne TOML simple : `"…"` (échappements \" \\ \n \t) ou `'…'` (littérale). */
function chaineToml(valeur: string): string | undefined {
  const v = valeur.trim()
  const simple = /^'([^']*)'\s*(#.*)?$/.exec(v)
  if (simple) return simple[1]
  const double = /^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/.exec(v)
  if (!double) return undefined
  return double[1].replace(/\\(["\\nt])/g, (_m, c: string) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c
  )
}

/**
 * Lit la partie UTILE de `.conductor/settings.toml` : `[scripts]` `setup` et `run`, et les scripts
 * nommés `[scripts.run.<id>]` (`command`, celui marqué `default = true` en priorité). Ce n'est PAS
 * un lecteur TOML complet : tout le reste du fichier est ignoré, et une valeur sur plusieurs lignes
 * n'est pas lue. Rend `null` quand le fichier ne déclare ni préparation ni lancement.
 */
export function lireConfigConductor(texte: string): ScriptsCopie | null {
  let section = ''
  let preparation: string | undefined
  let lancement: string | undefined
  const nommes: Array<{ commande?: string; parDefaut: boolean }> = []
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.trim()
    if (!ligne || ligne.startsWith('#')) continue
    const titre = /^\[\s*([^\]]+?)\s*\]$/.exec(ligne)
    if (titre) {
      section = titre[1]
      if (/^scripts\.run\.[^.]+$/.test(section)) nommes.push({ parDefaut: false })
      continue
    }
    const affectation = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(ligne)
    if (!affectation) continue
    const [, cle, valeur] = affectation
    if (section === 'scripts') {
      if (cle === 'setup') preparation = chaineToml(valeur) ?? preparation
      if (cle === 'run') lancement = chaineToml(valeur) ?? lancement
    } else if (/^scripts\.run\.[^.]+$/.test(section) && nommes.length) {
      const courant = nommes[nommes.length - 1]
      if (cle === 'command') courant.commande = chaineToml(valeur)
      if (cle === 'default') courant.parDefaut = /^true\b/.test(valeur.trim())
    }
  }
  const nomme = nommes.find((n) => n.parDefaut && n.commande) ?? nommes.find((n) => n.commande)
  lancement = lancement?.trim() || nomme?.commande?.trim() || undefined
  preparation = preparation?.trim() || undefined
  if (!preparation && !lancement) return null
  return { source: 'conductor', preparation, lancement, copier: [] }
}

/**
 * Sans déclaration : le lancement DÉTECTÉ dans `package.json` (`dev`, sinon `start`). Jamais de
 * préparation détectée — installer des dépendances à chaque copie doit rester un choix écrit.
 */
export function lancementDetecte(packageJson: string): ScriptsCopie | null {
  try {
    const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts
    if (!scripts || typeof scripts !== 'object') return null
    const lancement =
      typeof scripts.dev === 'string'
        ? 'npm run dev'
        : typeof scripts.start === 'string'
          ? 'npm start'
          : undefined
    return lancement ? { source: 'package.json', lancement, copier: [] } : null
  } catch {
    return null
  }
}

/** Le premier port du bloc réservé à une copie : stable pour un même identifiant. */
export function portDeBase(identifiant: string): number {
  let h = 2166136261
  for (let i = 0; i < identifiant.length; i++) {
    h ^= identifiant.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return PORT_MIN + ((h >>> 0) % BLOCS_DE_PORTS) * PORTS_PAR_COPIE
}

/** Le bloc suivant, pour chercher un port libre sans sortir de la plage. */
export function blocSuivant(port: number): number {
  const suivant = port + PORTS_PAR_COPIE
  return suivant >= PORT_MIN + BLOCS_DE_PORTS * PORTS_PAR_COPIE ? PORT_MIN : suivant
}

export interface ContexteCopie {
  /** Le dépôt d'origine (celui de l'utilisateur). */
  depot: string
  /** Le dossier où la commande s'exécute : la copie de l'agent, ou le dossier de la conversation. */
  copie: string
  /** Nom lisible de la copie (identifiant du run ou de la conversation). */
  nom: string
  port: number
}

/** Les variables fournies aux scripts, sous les noms Autowin ET les noms Conductor. */
export function variablesDeCopie(c: ContexteCopie): Record<string, string> {
  return {
    AUTOWIN_DEPOT: c.depot,
    AUTOWIN_COPIE: c.copie,
    AUTOWIN_COPIE_NOM: c.nom,
    AUTOWIN_PORT: String(c.port),
    CONDUCTOR_ROOT_PATH: c.depot,
    CONDUCTOR_WORKSPACE_PATH: c.copie,
    CONDUCTOR_WORKSPACE_NAME: c.nom,
    CONDUCTOR_PORT: String(c.port)
  }
}

/**
 * Développe `$NOM` et `${NOM}` pour NOS variables seulement : le reste de la ligne n'est pas touché
 * (un `$HOME` ou un `%PATH%` restent au shell).
 */
export function developperVariables(commande: string, variables: Record<string, string>): string {
  return commande.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (tout, a, b) => {
    const nom = (a ?? b) as string
    return Object.prototype.hasOwnProperty.call(variables, nom) ? variables[nom] : tout
  })
}

/** Retire les codes couleur ANSI d'une sortie de terminal. */
export function sansCodesCouleur(texte: string): string {
  // eslint-disable-next-line no-control-regex
  return texte.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
}

/** La première adresse locale annoncée dans la sortie (serveur de dev prêt), sinon `undefined`. */
export function adresseLocale(sortie: string): string | undefined {
  const trouve =
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'"<>)]*)?/i.exec(
      sansCodesCouleur(sortie)
    )
  return trouve?.[0].replace('0.0.0.0', 'localhost').replace(/[.,;]+$/, '')
}
