import { execFileSync } from 'node:child_process'
import { nomHistorique } from '../profil/identite-entreprise'

/**
 * RECHARGER UNE VARIABLE D'ENVIRONNEMENT A CHAUD — sans redemarrer le processus principal.
 *
 * DEFAUT VECU (2026-08-28) : le plafond de `verify` se regle par
 * `AUTOWIN_VERIFY_TIMEOUT_MS`, mais `process.env` est FIGE au lancement d'Electron. `setx` a
 * enregistre 86 400 000 dans `HKCU\Environment` (verifie par `reg query`, exit 0) et le processus a
 * continue de couper a 600 s : la valeur existait, personne ne la lisait. Faute de pouvoir
 * redemarrer l'app lui-meme, l'agent a rendu la main quatre tours de suite.
 *
 * Ce module lit la valeur PERSISTEE par l'OS et la reinjecte dans `process.env` du processus
 * courant. Aucune valeur ne vient du modele : il ne choisit que le NOM, et seulement dans une
 * liste blanche — un `PATH` ou un `NODE_OPTIONS` recharge a chaud changerait le comportement
 * d'execution du processus, ce n'est pas un reglage produit.
 */
/**
 * L'origine du Brain ajoutee le 2026-09-03 apres le meme defaut, vecu sur le canal Brain.
 * L'installation persiste le jeton et les chemins du Brain, mais PAS le port : l'origine ne vivait
 * que dans le shell ou elle avait ete tapee. Le service ecoutait 8766, le processus principal
 * retombait sur le defaut 8765, et chaque `brain_query` rendait « indisponible » en 15 ms
 * (connexion refusee) — cerveau muet, sans autre issue qu'un redemarrage de l'app.
 * `sharedBrainOrigin()` relit `process.env` a CHAQUE appel : recharger la variable suffit donc a
 * rebrancher le canal a chaud. La valeur reste validee loopback par `requireLoopbackBrainOrigin`.
 */
/*
 * `AUTOWIN_SQLCMD_BIN` — DEFAUT VECU (2026-09-02) : `sqlcmd` etait absent du poste.
 * Installe en version portable puis ajoute au PATH utilisateur, il restait INVISIBLE pour l'app :
 * une modification du PATH ne se propage jamais aux processus deja lances, et le redemarrage passe
 * par le lanceur, qui herite de l'ancien environnement. Un `setx` du PATH suivi d'un redemarrage
 * ne suffit donc PAS. Le PATH reste volontairement HORS de cette liste (cf. en-tete), mais
 * DESIGNER le binaire est un reglage produit, comme `CODEX_BIN` : la
 * valeur vient de l'OS, le modele ne choisit que le nom.
 */
export const VARIABLES_RECHARGEABLES = [
  'AUTOWIN_VERIFY_TIMEOUT_MS',
  'AUTOWIN_BRAIN_TIMEOUT_MS',
  'AUTOWIN_BRAIN_ORIGIN',
  'AUTOWIN_SQLCMD_BIN'
] as const

export type NomRechargeable = (typeof VARIABLES_RECHARGEABLES)[number]

/**
 * La liste blanche, plus l'ANCIEN nom de l'origine du Brain quand un profil d'entreprise en fournit
 * un : `sharedBrainOrigin` le lit toujours en secours, il doit donc se recharger au meme titre.
 */
export function variablesRechargeables(env: NodeJS.ProcessEnv = process.env): string[] {
  const ancien = nomHistorique('AUTOWIN_BRAIN_ORIGIN', env)
  return ancien ? [...VARIABLES_RECHARGEABLES, ancien] : [...VARIABLES_RECHARGEABLES]
}

export type LecteurEnvSysteme = (nom: string) => string | undefined

export interface RechargeEnv {
  nom: string
  avant?: string
  apres?: string
  change: boolean
  detail: string
}

/** Les variables persistées de l'utilisateur, et celles du système (lues pour tous les comptes). */
export const CLE_ENV_UTILISATEUR = String.raw`HKCU\Environment`
export const CLE_ENV_SYSTEME = String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`

/**
 * `    NOM    REG_SZ    valeur` — la valeur peut contenir des espaces, pas les deux colonnes qui la
 * precedent. Partagé par les deux lectures ci-dessous pour qu'elles ne divergent jamais.
 */
function valeurDeLigneReg(ligne: string): string | undefined {
  return ligne.split(/\s+REG_[A-Z_]+\s+/i)[1]?.trim() || undefined
}

/** Lecture de la valeur PERSISTEE par l'utilisateur (Windows : `HKCU\Environment`). */
export const lecteurWindows: LecteurEnvSysteme = (nom) => {
  try {
    const sortie = execFileSync('reg', ['query', CLE_ENV_UTILISATEUR, '/v', nom], {
      encoding: 'utf8',
      windowsHide: true
    })
    const ligne = sortie
      .split(/\r?\n/)
      .find((l) => new RegExp(String.raw`\s${nom}\s+REG_`, 'i').test(l))
    return ligne === undefined ? undefined : valeurDeLigneReg(ligne)
  } catch {
    return undefined
  }
}

/**
 * TOUTES les variables persistées sous une clé, en un seul appel à `reg` : le coffre à clés doit
 * découvrir des NOMS qu'il ne connaît pas d'avance, ce que `lecteurWindows` (un nom donné) ne fait pas.
 * Clé illisible ou hors Windows → table vide, jamais d'exception.
 */
export function variablesDuRegistre(cle: string): Map<string, string> {
  const variables = new Map<string, string>()
  try {
    const sortie = execFileSync('reg', ['query', cle], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      // Une clé absente est un cas normal : son message d'erreur n'a rien à faire dans la console.
      stdio: ['ignore', 'pipe', 'ignore']
    })
    for (const ligne of sortie.split(/\r?\n/)) {
      const nom = /^\s+(\S+)\s+REG_[A-Z_]+/i.exec(ligne)?.[1]
      const valeur = nom ? valeurDeLigneReg(ligne) : undefined
      if (nom && valeur) variables.set(nom, valeur)
    }
  } catch {
    // Clé absente, droit refusé ou `reg` introuvable : rien à importer de cette source.
  }
  return variables
}

export function rechargerEnv(
  nom: unknown,
  options: { lecteur?: LecteurEnvSysteme; env?: NodeJS.ProcessEnv } = {}
): RechargeEnv {
  const demande = typeof nom === 'string' ? nom.trim() : ''
  const env = options.env ?? process.env
  const rechargeables = variablesRechargeables(env)
  if (!rechargeables.includes(demande)) {
    throw new Error(
      `Variable non rechargeable : « ${demande || '(vide)'} ». ` +
        `Rechargeables : ${rechargeables.join(', ')}.`
    )
  }
  const lecteur = options.lecteur ?? lecteurWindows
  const avant = env[demande]
  const apres = lecteur(demande)
  if (apres === undefined) {
    return {
      nom: demande,
      ...(avant === undefined ? {} : { avant }),
      change: false,
      detail: `${demande} : aucune valeur persistée trouvée — le processus garde ${avant ?? 'son défaut'}.`
    }
  }
  if (apres === avant) {
    return {
      nom: demande,
      avant,
      apres,
      change: false,
      detail: `${demande} : déjà à ${apres}, rien à recharger.`
    }
  }
  env[demande] = apres
  return {
    nom: demande,
    ...(avant === undefined ? {} : { avant }),
    apres,
    change: true,
    detail: `${demande} : ${avant ?? '(absente)'} → ${apres}, appliqué à chaud dans le processus principal.`
  }
}

/**
 * CLÉS DES FOURNISSEURS RELUES DEPUIS L'OS (2026-11-04) : `setx MISTRAL_API_KEY` puis
 * `restart_app` laissait le service absent du sélecteur. Cause prouvée : le redémarrage repasse par le
 * lanceur (`npm run dev` lancé à 13:37:16 par un cmd.exe déjà là), qui transmet son ANCIEN
 * environnement — même défaut que `AUTOWIN_SQLCMD_BIN`. Le catalogue appelle donc ceci
 * avant de lire les clés : une clé ABSENTE du processus est reprise de `HKCU\Environment`.
 * Jamais d'écrasement d'une valeur déjà là, jamais de valeur venue du modèle, aucun journal.
 */
export function hydraterClesFournisseurs(
  noms: readonly string[],
  options: { lecteur?: LecteurEnvSysteme; env?: NodeJS.ProcessEnv } = {}
): string[] {
  const env = options.env ?? process.env
  const lecteur = options.lecteur ?? lecteurWindows
  const repris: string[] = []
  for (const nom of noms) {
    if (env[nom]?.trim()) continue
    const valeur = lecteur(nom)
    if (valeur) {
      env[nom] = valeur
      repris.push(nom)
    }
  }
  return repris
}
