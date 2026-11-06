import { detailRefusFixGate, SEUIL_FIX_GATE } from '../gates/hooks'

/**
 * LE CONTRÔLE « CAUSE VÉRIFIÉE » SE SIGNALE PENDANT LE TRAVAIL (conv-1353, 2026-10-31).
 *
 * Mesure : conv-1324 (run-7b7d533c318e-1) a appris à la 134e minute, au contrôle final, que 14
 * modifications de src/main/bureau/navigateur-integre.ts n'avaient pas de cause vérifiée. Ce refus a rejoué
 * un passage complet, alors que l'agent aurait pu noter sa cause dès la 3e modification.
 *
 * `detectBlindFixLoop` ne change pas et refuse toujours pareil. Ce module ajoute seulement un hook
 * du CLI, APRÈS chaque outil d'édition, qui prévient l'agent à côté du résultat de son outil. Le CLI
 * lance le script dans un autre process, sans ce module : son état tient dans un fichier du dossier
 * de réglages de l'agent, nettoyé avec lui.
 *
 * LIMITE VOULUE : ce dossier est propre à UN agent lancé. Le compte repart donc à zéro à chaque
 * étape, alors que le contrôle final additionne toutes celles du run.
 */

/**
 * Les outils de modification d'un agent de run (`--tools`, `claude.ts`). `NotebookEdit` n'y est pas,
 * et sa cible (`notebook_path`) n'alimente pas le compte du contrôle final.
 */
export const OUTILS_D_EDITION = 'Edit|Write|MultiEdit'

const FICHIER_D_ETAT = 'cause-en-cours.json'

/**
 * Même expression que `JETON_DE_CAUSE` (`hooks/default-gate-hooks.ts`), recopiée et non importée :
 * pour l'exporter il faudrait modifier ce fichier, dont le dernier changement sert de témoin à trois
 * tests (voir `gates/echange-sans-cause.ts`). Le test « même règle de jeton » les tient liées.
 */
const JETON_DE_CAUSE = /\b(?:CausalHypothesis|fix-ok|check)\s*:/

interface ReglageDuSignal {
  /** Dossier du run : la clé d'un fichier est relative à lui, comme au contrôle final. */
  racine: string
  seuil: number
  outils: string
  jeton: string
}

/** Le disque vu par le hook : passé en paramètre pour que la décision reste autoportée. */
interface DisqueDuHook {
  etat: string
  existe(chemin: string): boolean
  lire(chemin: string): string
  ecrire(chemin: string, texte: string): void
  parent(chemin: string): string
  resoudre(base: string, chemin: string): string
}

interface SuiviDuFichier {
  editions: number
  jeton: boolean
  signale: boolean
}

/**
 * Compte une modification et rend la sortie du hook, ou rien.
 *
 * AUTOPORTÉE : le script du hook la recopie par `.toString()`, comme `lecteurDeTests`. Rien ici ne
 * doit nommer quoi que ce soit hors de son corps et de ses paramètres : un bundler peut renommer un
 * nom de module, jamais un nom local à la fonction.
 */
export function decisionSignalDeCause(
  brut: string,
  reglage: ReglageDuSignal,
  disque: DisqueDuHook,
  detail: (compte: number, fichier: string) => string
): string | undefined {
  const entree = JSON.parse(brut)
  if (!entree || !new RegExp(`^(?:${reglage.outils})$`).test(String(entree.tool_name))) return
  const evenement =
    entree.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse'
  if (entree.is_interrupt) return
  const outil = entree.tool_input ?? {}
  // Même lecture que la preuve d'une édition (`part.input?.file_path`, `claude.ts`).
  const plat = String(outil.file_path ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!plat) return

  /*
   * MÊME EXCLUSION QUE LE CONTRÔLE FINAL (`estDansUnDepotGit`, conv-1149) : un `.git`, dossier ou
   * fichier d'une copie de travail, au-dessus du fichier. Un chemin relatif est relatif au dépôt du
   * run, il compte. Un autre dépôt que celui du run compte aussi.
   */
  const absolu = /^[a-z]:\//i.test(plat) || plat.startsWith('/')
  if (absolu || plat.startsWith('../')) {
    let dossier = disque.parent(disque.resoudre(reglage.racine, plat))
    while (!disque.existe(disque.resoudre(dossier, '.git'))) {
      const parent = disque.parent(dossier)
      if (parent === dossier) return
      dossier = parent
    }
  }

  // Même clé que `fichiersEditesParLeRun` : le chemin relatif au run quand il est dessous.
  const base = `${reglage.racine.replace(/\\/g, '/').replace(/\/+$/, '')}/`
  const cle = plat.toLowerCase().startsWith(base.toLowerCase()) ? plat.slice(base.length) : plat

  /*
   * Le jeton compté est celui que l'agent ÉCRIT, jamais un ancien du fichier : navigateur-integre.ts
   * portait déjà 21 `fix-ok:` dans le cas de conv-1324, et le contrôle final ne crédite que les
   * lignes ajoutées (sources 1 et 3 de `jetonsDeCauseParFichier`). Une ligne reprise telle quelle
   * dans le texte remplacé n'est donc pas écrite. Une modification en échec n'écrit rien.
   */
  const reussie = evenement === 'PostToolUse'
  const lignes = (texte: unknown): string[] =>
    typeof texte === 'string' ? texte.split(/\r?\n/) : []
  const neuves = (apres: unknown, avant: unknown): string[] => {
    const anciennes = new Set(lignes(avant))
    return lignes(apres).filter((ligne) => !anciennes.has(ligne))
  }
  const remplacements: { old_string?: unknown; new_string?: unknown }[] = Array.isArray(outil.edits)
    ? outil.edits
    : []
  const ecrites = [
    ...neuves(outil.new_string, outil.old_string),
    // `originalFile` : mesuré dans le résultat réel de `Write` (null à la création).
    ...neuves(outil.content, entree.tool_response?.originalFile),
    ...remplacements.flatMap((r) => neuves(r?.new_string, r?.old_string))
  ]
  const jeton = new RegExp(reglage.jeton)

  const etat: Record<string, SuiviDuFichier> = disque.existe(disque.etat)
    ? JSON.parse(disque.lire(disque.etat))
    : {}
  const suivi = etat[cle] ?? { editions: 0, jeton: false, signale: false }
  // Un appel d'outil = un compte, même en échec : `fichiersEditesParLeRun` ne filtre pas sur `ok`.
  suivi.editions += 1
  if (reussie && ecrites.some((ligne) => jeton.test(ligne))) suivi.jeton = true
  const signaler = suivi.editions >= reglage.seuil && !suivi.jeton && !suivi.signale
  if (signaler) suivi.signale = true
  etat[cle] = suivi
  disque.ecrire(disque.etat, JSON.stringify(etat))
  if (!signaler) return

  const texte =
    `Refus à venir au contrôle final : ${detail(suivi.editions, cle)}. ` +
    'Écris-le maintenant, avec la cause réellement mesurée : ce refus ferait rejouer tout le passage en fin de travail.'
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: evenement, additionalContext: texte }
  })
}

/**
 * Le script du hook PostToolUse / PostToolUseFailure des agents de run. Entrée et sortie :
 * https://code.claude.com/docs/en/hooks (`hookSpecificOutput.additionalContext` est rendu à l'agent
 * à côté du résultat de son outil). Toute panne = aucun message, jamais un refus : l'outil a déjà
 * tourné, et ce hook ne porte aucun `onFailure`.
 *
 * @param racine dossier de travail du run, fixé au lancement : le `cwd` lu par le hook suit les
 * `cd` de l'agent, et la clé d'un fichier changerait en cours de route.
 */
export function scriptHookCauseEnCours(racine: string): string {
  const reglage: ReglageDuSignal = {
    racine,
    seuil: SEUIL_FIX_GATE,
    outils: OUTILS_D_EDITION,
    jeton: JETON_DE_CAUSE.source
  }
  return `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const decision = ${decisionSignalDeCause.toString()};
const detail = ${detailRefusFixGate.toString()};
const reglage = ${JSON.stringify(reglage)};
const disque = {
  etat: join(dirname(process.argv[1]), ${JSON.stringify(FICHIER_D_ETAT)}),
  existe: existsSync,
  lire: (chemin) => readFileSync(chemin, 'utf8'),
  ecrire: (chemin, texte) => writeFileSync(chemin, texte, 'utf8'),
  parent: dirname,
  resoudre: resolve
};
let d = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (b) => (d += b));
process.stdin.on('end', () => {
  try {
    const sortie = decision(d, reglage, disque, detail);
    if (sortie) process.stdout.write(sortie);
  } catch {}
});
`
}
