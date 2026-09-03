import { execFileSync } from 'node:child_process'

/**
 * RECHARGER UNE VARIABLE D'ENVIRONNEMENT A CHAUD — sans redemarrer le processus principal.
 *
 * DEFAUT VECU (conv-1516, 2026-08-28) : le plafond de `verify` se regle par
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
/*
 * `AUTOWIN_SQLCMD_BIN` — DEFAUT VECU (conv-152, 2026-09-02) : `sqlcmd` etait absent du poste.
 * Installe en version portable puis ajoute au PATH utilisateur, il restait INVISIBLE pour l'app :
 * une modification du PATH ne se propage jamais aux processus deja lances, et le redemarrage passe
 * par le lanceur, qui herite de l'ancien environnement. Un `setx` du PATH suivi d'un redemarrage
 * ne suffit donc PAS. Le PATH reste volontairement HORS de cette liste (cf. en-tete), mais
 * DESIGNER le binaire est un reglage produit, comme `AUTOWIN_GRAPHIFY_BIN` ou `CODEX_BIN` : la
 * valeur vient de l'OS, le modele ne choisit que le nom.
 */
export const VARIABLES_RECHARGEABLES = [
  'AUTOWIN_VERIFY_TIMEOUT_MS',
  'AUTOWIN_BRAIN_TIMEOUT_MS',
  'AUTOWIN_SQLCMD_BIN'
] as const

export type NomRechargeable = (typeof VARIABLES_RECHARGEABLES)[number]

export type LecteurEnvSysteme = (nom: string) => string | undefined

export interface RechargeEnv {
  nom: string
  avant?: string
  apres?: string
  change: boolean
  detail: string
}

/** Lecture de la valeur PERSISTEE par l'utilisateur (Windows : `HKCU\Environment`). */
export const lecteurWindows: LecteurEnvSysteme = (nom) => {
  try {
    const sortie = execFileSync('reg', ['query', String.raw`HKCU\Environment`, '/v', nom], {
      encoding: 'utf8',
      windowsHide: true
    })
    // `    NOM    REG_SZ    valeur` — la valeur peut contenir des espaces, pas les deux colonnes
    // qui la precedent.
    const ligne = sortie
      .split(/\r?\n/)
      .find((l) => new RegExp(String.raw`\s${nom}\s+REG_`, 'i').test(l))
    const valeur = ligne?.split(/\s+REG_[A-Z_]+\s+/i)[1]
    return valeur?.trim() || undefined
  } catch {
    return undefined
  }
}

export function rechargerEnv(
  nom: unknown,
  options: { lecteur?: LecteurEnvSysteme; env?: NodeJS.ProcessEnv } = {}
): RechargeEnv {
  const demande = typeof nom === 'string' ? nom.trim() : ''
  if (!(VARIABLES_RECHARGEABLES as readonly string[]).includes(demande)) {
    throw new Error(
      `Variable non rechargeable : « ${demande || '(vide)'} ». ` +
        `Rechargeables : ${VARIABLES_RECHARGEABLES.join(', ')}.`
    )
  }
  const env = options.env ?? process.env
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
