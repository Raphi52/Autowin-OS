/**
 * GARDE NPM — refuse une commande npm qui MODIFIE `node_modules` pendant que l'Electron qui en vit
 * tourne. Hook PreToolUse (Bash|PowerShell) de Claude Code, branché à DEUX endroits :
 *  - `.claude/settings.json` du dépôt : les sessions Claude ouvertes dans D:\Autowin ;
 *  - `reglagesCliAutowin` (src/main/providers/claude.ts) : les agents lancés par Autowin OS, qui
 *    tournent avec `--setting-sources ''` et ne lisent donc PAS le réglage du dépôt.
 *
 * LA PANNE, mesurée le 2026-10-05 (journal npm 2026-10-04T22_35_39_739Z) : un agent a lancé
 * `npm install` dans D:\Autowin pendant qu'Autowin OS tournait. npm a commencé à déplacer les
 * paquets (reify:retireShallow), a buté sur EBUSY (electron.exe verrouillé par l'app ouverte), et
 * s'est arrêté au milieu : `.bin` vide, des dizaines de paquets absents (@babel/core,
 * @electron-toolkit/*). Au lancement suivant : « 'electron-vite' n'est pas reconnu », bundle périmé.
 *
 * POURQUOI UN HOOK ET PAS UN `preinstall` : mesuré le même jour sous npm 10.8, le `preinstall` du
 * paquet racine s'exécute APRÈS la réécriture de `node_modules`, et `npm install <paquet>` ne
 * l'exécute pas du tout. Un garde npm arriverait après les dégâts.
 *
 * LE SIGNAL : `electron.exe` du `node_modules` RÉEL (jonction suivie : les copies agent relient
 * celui du dépôt, src/main/store/dependances-copie-agent.ts) ne s'ouvre pas en écriture. C'est la
 * condition exacte de l'EBUSY de npm, pas un nom de processus deviné. L'ouverture ne modifie rien.
 */
import { closeSync, existsSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Sous-commandes npm qui réécrivent `node_modules` (alias et fautes de frappe acceptées par npm). */
const NPM_MUTANTS = new Set(
  (
    'install i in ins inst insta instal isnt isnta isntal isntall add ' +
    'ci clean-install ic install-clean isntall-clean install-test it install-ci-test cit ' +
    'uninstall unlink remove rm r un update up upgrade udpate dedupe ddp prune rebuild rb link ln'
  ).split(' ')
)

/** Options npm qui prennent leur valeur dans le mot SUIVANT. */
const OPTIONS_A_VALEUR = new Set([
  '--prefix', '-C', '--registry', '--cache', '--userconfig', '--globalconfig', '--loglevel',
  '--workspace', '-w', '--tag', '--otp', '--location', '--omit', '--include', '--install-strategy'
])

function mots(texte) {
  const r = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(texte))) r.push(m[1] ?? m[2] ?? m[3])
  return r
}

/** `/d/Autowin` (Git Bash) → `D:/Autowin`. Le reste est laissé tel quel. */
export function cheminWindows(p) {
  const m = String(p).match(/^\/([a-zA-Z])(\/.*)?$/)
  return m ? `${m[1].toUpperCase()}:${m[2] ?? '/'}` : String(p)
}

/**
 * Dossier où une commande npm MODIFIANTE s'exécuterait, ou `undefined` si la commande n'en contient
 * pas. Suit les `cd` / `Set-Location` / `pushd` qui la précèdent, et `--prefix` / `-C`.
 * Pure : `resoudre(base, relatif)` est fourni par l'appelant.
 */
export function cibleNpmQuiModifie(commande, cwd, resoudre) {
  let dossier = cwd
  for (const brut of String(commande ?? '').split(/;|&&|\|\||\||\r?\n/)) {
    let seg = brut.trim().replace(/^&\s*/, '')
    while (/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/.test(seg)) {
      seg = seg.replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '')
    }
    seg = seg.replace(/^cmd(\.exe)?\s+\/{1,2}[cC]\s+/, '').trim()
    // `cmd /c "npm install"` : seul un segment ENTIÈREMENT entre guillemets perd les siens.
    if (/^(["']).*\1$/.test(seg)) seg = seg.slice(1, -1).trim()
    if (!seg) continue

    const cd = seg.match(/^(cd|chdir|pushd|set-location|sl)\s+(.+)$/i)
    if (cd) {
      const args = mots(cd[2]).filter((a) => !/^(\/d|-path|-literalpath)$/i.test(a))
      // `cd $t`, `cd %X%`, `cd ~` : dossier INCONNU. Le résoudre depuis cwd visait le dépôt à tort
      // (faux refus mesuré le 2026-10-05) : inconnu ⇒ on ne refuse pas, sauf `--prefix` absolu.
      const a = args[0]
      if (a) {
        if (/[$%~`(]/.test(a)) dossier = undefined
        else if (/^([a-zA-Z]:|\/[a-zA-Z](\/|$))/.test(a)) dossier = resoudre(a, '.')
        else dossier = dossier === undefined ? undefined : resoudre(dossier, a)
      }
      continue
    }

    const m = mots(seg)
    const exe = (m[0] ?? '').split(/[\\/]/).pop().toLowerCase().replace(/\.(cmd|exe|ps1)$/, '')
    if (exe !== 'npm') continue

    let sous
    let prefixe
    let global = false
    for (let i = 1; i < m.length; i++) {
      const a = m[i]
      if (a === '-g' || a === '--global' || a === '--location=global') global = true
      if (a === '--location' && m[i + 1] === 'global') global = true
      if (a.startsWith('--prefix=')) prefixe = a.slice('--prefix='.length)
      if (OPTIONS_A_VALEUR.has(a)) {
        if (a === '--prefix' || a === '-C') prefixe = m[i + 1]
        i++
        continue
      }
      if (a.startsWith('-')) continue
      if (sous === undefined) sous = a.toLowerCase()
    }
    if (global || !sous || !NPM_MUTANTS.has(sous)) continue
    if (prefixe && !/[$%~`(]/.test(prefixe)) {
      if (dossier !== undefined) return resoudre(dossier, prefixe)
      if (/^([a-zA-Z]:|\/[a-zA-Z]\/)/.test(prefixe)) return resoudre(prefixe, '.')
      continue
    }
    if (dossier !== undefined) return dossier
  }
  return undefined
}

/**
 * Motif de refus, ou `undefined` pour laisser passer.
 * `sonde.modulesReels(dossier)` : chemin RÉEL du `node_modules` que npm toucherait depuis ce dossier.
 * `sonde.verrouille(chemin)` : vrai si le fichier ne s'ouvre pas en écriture (EBUSY / EPERM).
 */
export function refusNpmModulesPartages(commande, cwd, sonde) {
  const cible = cibleNpmQuiModifie(commande, cwd, sonde.resoudre)
  if (!cible) return undefined
  const modules = sonde.modulesReels(cible)
  if (!modules) return undefined
  if (!sonde.verrouille(join(modules, 'electron', 'dist', 'electron.exe'))) return undefined
  return (
    `Refusé : cette commande npm réécrirait ${modules}, dont l'Electron tourne en ce moment (Autowin OS ouvert : electron.exe verrouillé). ` +
    "Le 2026-10-05, un npm install lancé dans ces conditions a échoué en EBUSY au milieu et a laissé node_modules à moitié vide : l'app ne démarrait plus. " +
    "N'installe rien ici tant que l'app tourne. Un paquet ou un raccourci de .bin manque ? Lance l'outil par son chemin (ex. node node_modules/typescript/bin/tsc) " +
    "et SIGNALE le manque à l'utilisateur : le lanceur (scripts/launch_dev.py) répare node_modules au prochain démarrage, app fermée. " +
    "Pour essayer un paquet, installe-le dans un dossier séparé (autre node_modules)."
  )
}

/** Sonde réelle. `npm` travaille dans le dossier du `package.json` le plus proche. */
export const sondeSysteme = {
  resoudre: (base, relatif) => resolve(cheminWindows(base), cheminWindows(relatif)),
  modulesReels(dossier) {
    let d = resolve(cheminWindows(dossier))
    for (let i = 0; i < 40; i++) {
      if (existsSync(join(d, 'package.json'))) {
        const nm = join(d, 'node_modules')
        return existsSync(nm) ? realpathSync(nm) : undefined
      }
      const parent = dirname(d)
      if (parent === d) return undefined
      d = parent
    }
    return undefined
  },
  verrouille(chemin) {
    try {
      closeSync(openSync(chemin, 'r+'))
      return false
    } catch (e) {
      return e?.code === 'EBUSY' || e?.code === 'EPERM'
    }
  }
}

/** Entrée du hook : JSON PreToolUse sur stdin, refus structuré sur stdout. Ne bloque jamais sur une erreur. */
function principal() {
  let entree = {}
  try {
    // Un BOM en tête (pipe PowerShell 5.1, mesuré) faisait échouer JSON.parse : garde muet.
    entree = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}')
  } catch {
    return
  }
  const commande = entree?.tool_input?.command
  if (typeof commande !== 'string' || !/\bnpm/i.test(commande)) return
  let motif
  try {
    motif = refusNpmModulesPartages(commande, entree.cwd || process.cwd(), sondeSysteme)
  } catch {
    return
  }
  if (motif) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: motif
        }
      })
    )
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal()
