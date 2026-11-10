/**
 * GARDE D'ÉCRITURE HORS COPIE — refuse qu'un fil qui travaille dans sa copie écrive dans le dossier
 * partagé en chemin complet. Contrôle « avant outil » (PreToolUse), branché comme la garde npm :
 *  - `reglagesCliAutowin` (src/main/providers/claude.ts) pour les agents Claude lancés par l'app ;
 *  - `~/.grok/hooks/garde-ecriture.json` et `$CODEX_HOME/hooks.json`, contrôles personnels de Grok
 *    et de Codex (src/main/providers/hooks-des-cli.ts).
 *
 * POURQUOI : l'app de dev tourne depuis le dossier partagé (D:\AutoWinOS) et recharge l'interface en
 * direct depuis lui. Le travail d'un fil n'y entre que par la porte (« Garder », fusion à trois voies
 * depuis la copie). Une écriture directe en chemin complet passe à côté : elle n'est ni à la copie
 * ni publiée par elle, et c'est exactement le mélange de fils que la copie devait supprimer.
 *
 * CE QU'EST UNE COPIE : un dossier git LIÉ (son `.git` est un fichier `gitdir: …`) rangé dans les
 * données de l'app de son dépôt principal (`<dépôt>\.autowin-data\…`). Le dépôt principal lui-même,
 * ses sous-dossiers et tout dossier sans git ne sont pas des copies : rien n'y change. La copie d'un
 * autre projet rangée chez nous a un autre dépôt principal, dont elle n'est pas sous les données :
 * hors périmètre, rien ne change non plus.
 *
 * CE QUI PASSE : écrire dans la copie, écrire sous `<dépôt>\.autowin-data\` (fiches des runs,
 * données de l'app), lire le dossier partagé ou en copier un fichier VERS la copie.
 *
 * LE SHELL NE SE JUGE PAS PARFAITEMENT. Sont refusées les formes claires : redirections (`>`, `>>`,
 * `n>`, `*>`), Set-Content/Add-Content/Out-File/Tee-Object/New-Item, cp/mv/rm/touch/mkdir/tee/sed -i/dd,
 * copy/move/del de cmd, Copy-Item/Move-Item/Remove-Item/Rename-Item, -OutFile, curl -o,
 * [IO.File]::…, writeFileSync de node et open(…, 'w') de python, y compris après cd/Set-Location/pushd
 * et dans cmd /c, powershell -Command, bash -c. Ne sont PAS vues : un chemin bâti dans une variable
 * (`$p = 'D:\AutoWinOS'; … > $p\x`), un script lancé qui écrit lui-même, `git -C <dossier partagé>`
 * (checkout, commit…), une écriture à travers un lien de la copie (`node_modules`, relié au dépôt :
 * c'est la garde npm qui le protège), une commande coupée par Grok au-delà de 128 Kio.
 *
 * Aucune dépendance hors `node:` : Claude lance une COPIE de ce fichier, posée seule dans son dossier
 * de réglages. Une erreur interne laisse passer, comme la garde npm : une garde en panne ne doit pas
 * refuser tous les outils de tous les agents.
 */
import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DONNEES_APP = '.autowin-data'

/** `/d/Autowin` (Git Bash) → `D:/Autowin`. Le reste est laissé tel quel. */
export function cheminWindows(p) {
  const m = String(p).match(/^\/([a-zA-Z])(\/.*)?$/)
  return m ? `${m[1].toUpperCase()}:${m[2] ?? '/'}` : String(p)
}

const cle = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))

/** `chemin` est `racine` ou sous elle. Comparaison sur le chemin résolu, sans casse sous Windows. */
function sous(chemin, racine) {
  const c = cle(chemin)
  const r = cle(racine)
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep)
}

/**
 * La copie qui contient `dossier`, et le dossier partagé qu'elle protège ; `undefined` si `dossier`
 * n'est pas dans une copie. `sonde.git(d)` : `{ dossier: true }` si `d/.git` est un dossier,
 * `{ texte }` si c'est un fichier, `undefined` s'il manque. `sonde.lire(f)` : contenu ou `undefined`.
 */
export function copieDe(dossier, sonde) {
  if (!dossier) return undefined
  let d = sonde.resoudre(dossier, '.')
  for (let i = 0; i < 60; i++) {
    const git = sonde.git(d)
    if (git) {
      if (git.dossier || typeof git.texte !== 'string') return undefined
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(git.texte)
      if (!m) return undefined
      const gitdir = sonde.resoudre(d, m[1])
      // `commondir` donne le `.git` du dépôt principal, relatif au dossier git de la copie.
      const commun = sonde.lire(join(gitdir, 'commondir'))
      const dotGit = commun?.trim() ? sonde.resoudre(gitdir, commun.trim()) : undefined
      if (!dotGit || basename(dotGit).toLowerCase() !== '.git') return undefined
      const partage = dirname(dotGit)
      if (!sous(d, join(partage, DONNEES_APP))) return undefined
      return { partage, copie: d }
    }
    const parent = dirname(d)
    if (parent === d) return undefined
    d = parent
  }
  return undefined
}

/** Écrire `chemin` toucherait le dossier partagé, hors de ses données d'app et hors de la copie. */
function interdit(chemin, ctx) {
  return (
    sous(chemin, ctx.partage) &&
    !sous(chemin, join(ctx.partage, DONNEES_APP)) &&
    !sous(chemin, ctx.copie)
  )
}

/**
 * Le chemin absolu que désigne un mot du shell, ou `undefined` s'il dépend d'une variable, du
 * dossier personnel, ou d'un dossier courant inconnu : on ne refuse pas ce qu'on ne sait pas lire.
 */
function cheminDuMot(mot, dossier, resoudre) {
  const p = String(mot ?? '')
    .replace(/^[({]+/, '')
    .replace(/[)};,]+$/, '')
  if (!p || /[$%`]/.test(p) || p.startsWith('~')) return undefined
  if (/^([a-zA-Z]:|\/[a-zA-Z](\/|$)|\\\\)/.test(p)) return resoudre(p, '.')
  return dossier === undefined ? undefined : resoudre(dossier, p)
}

/**
 * Découpe une commande en segments `{ mots, redirs }`, et rend `code`, la commande privée de ses
 * corps de texte. Guillemets respectés, `;` `&&` `||` `|` `&`
 * et fin de ligne séparent, les cibles de `>` sont mises à part. Les corps de here-doc (`<<EOF`) et
 * de here-string PowerShell (`@" … "@`) sont du TEXTE : ils ne sont pas lus comme des commandes.
 */
function segmentsDe(commande) {
  const s = String(commande ?? '')
  const segments = []
  /** Les morceaux de `s` qui sont du texte (corps de here-doc et de here-string), à écarter du code. */
  const corps = []
  let seg = { mots: [], redirs: [] }
  let mot = null
  let cible = false
  let entree = false
  const heredocs = []
  const finirMot = () => {
    if (mot === null) return
    if (cible) seg.redirs.push(mot)
    else if (!entree) seg.mots.push(mot)
    cible = false
    entree = false
    mot = null
  }
  const finirSegment = () => {
    finirMot()
    if (seg.mots.length || seg.redirs.length) segments.push(seg)
    seg = { mots: [], redirs: [] }
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < s.length && !(s[j] === c && s[j - 1] !== '`')) j++
      mot = (mot ?? '') + s.slice(i + 1, j)
      i = j + 1
      continue
    }
    if (
      c === '@' &&
      mot === null &&
      (s[i + 1] === '"' || s[i + 1] === "'") &&
      /^[ \t]*\r?\n/.test(s.slice(i + 2))
    ) {
      const fin = s.indexOf(`\n${s[i + 1]}@`, i + 2)
      mot = fin < 0 ? s.slice(i + 2) : s.slice(i + 2, fin)
      corps.push([i + 2, fin < 0 ? s.length : fin])
      i = fin < 0 ? s.length : fin + 3
      continue
    }
    if (c === '\n') {
      finirSegment()
      i++
      // Les lignes d'un here-doc ouvert sur la ligne finie, jusqu'à son délimiteur.
      while (heredocs.length && i < s.length) {
        const nl = s.indexOf('\n', i)
        const ligne = (nl < 0 ? s.slice(i) : s.slice(i, nl)).replace(/\r$/, '')
        corps.push([i, nl < 0 ? s.length : nl])
        i = nl < 0 ? s.length : nl + 1
        if (ligne.trim() === heredocs[0]) heredocs.shift()
      }
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      finirMot()
      i++
      continue
    }
    if (c === '#' && mot === null) {
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === ';') {
      finirSegment()
      i++
      continue
    }
    if (c === '|') {
      finirSegment()
      i += s[i + 1] === '|' ? 2 : 1
      continue
    }
    if (c === '&') {
      if (s[i + 1] === '&') {
        finirSegment()
        i += 2
      } else if (s[i + 1] === '>') {
        // `&>` : toutes les sorties vers la cible qui suit.
        finirMot()
        i++
      } else if (mot === null && !seg.mots.length && !seg.redirs.length) {
        // `& commande` : l'opérateur d'appel de PowerShell, pas une fin de commande.
        i++
      } else {
        finirSegment()
        i++
      }
      continue
    }
    if (c === '>') {
      // `2>`, `1>`, `*>` : le préfixe collé désigne la sortie, pas un mot de la commande.
      if (mot !== null && /^(\d+|\*)$/.test(mot)) mot = null
      else finirMot()
      i++
      if (s[i] === '>') i++
      if (s[i] === '|') i++
      if (s[i] === '&') {
        // `>&1`, `2>&1` : vers une autre sortie, aucun fichier.
        i++
        while (i < s.length && /[\d-]/.test(s[i])) i++
        continue
      }
      cible = true
      continue
    }
    if (c === '<') {
      finirMot()
      if (s[i + 1] === '<' && s[i + 2] !== '<') {
        i += 2
        if (s[i] === '-') i++
        while (s[i] === ' ' || s[i] === '\t') i++
        const m = /^(["']?)([A-Za-z0-9_.-]+)\1/.exec(s.slice(i))
        if (m) {
          heredocs.push(m[2])
          i += m[0].length
        }
        continue
      }
      i += s[i + 1] === '<' ? 3 : 1
      entree = true
      continue
    }
    mot = (mot ?? '') + c
    i++
  }
  finirSegment()
  let code = ''
  let depuis = 0
  for (const [debut, fin] of corps) {
    code += s.slice(depuis, debut)
    depuis = fin
  }
  return { segments, code: code + s.slice(depuis) }
}

const nomDe = (mot) =>
  String(mot ?? '')
    .replace(/^[({]+/, '')
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, '')

/** Toutes les cibles positionnelles sont écrites (supprimées, créées, déplacées). */
const ECRIT_TOUT = new Set(
  (
    'rm del erase rd rmdir ri remove-item touch mkdir md new-item ni clear-content clc tee truncate ' +
    'unlink shred mv move mi move-item ren rename rename-item rni sed'
  ).split(' ')
)
/** Seule la première cible positionnelle est un chemin, les suivantes sont des valeurs. */
const ECRIT_PREMIER = new Set(
  'set-content sc add-content ac out-file tee-object export-csv'.split(' ')
)
/** La dernière cible positionnelle est la destination, les autres sont lues. */
const ECRIT_DERNIER = new Set('cp copy cpi copy-item xcopy install ln rsync scp'.split(' '))
/** Paramètres nommés qui portent un chemin écrit. `-path` d'une copie est une SOURCE : voir plus bas. */
const PARAMS_CHEMIN = new Set([
  '-path',
  '-literalpath',
  '-lp',
  '-pspath',
  '-filepath',
  '-destination',
  '-outfile'
])
/** Paramètres PowerShell qui prennent le mot suivant comme valeur (les autres sont des interrupteurs). */
const PARAMS_A_VALEUR = new Set(
  (
    '-value -encoding -itemtype -type -name -newname -filter -include -exclude -credential -stream ' +
    '-delimiter -inputobject -width -depth -uri -method -body -headers -contenttype -target'
  ).split(' ')
)

/** Les chemins qu'un segment de shell écrit, résolus. */
function ciblesDuSegment(mots, dossier, resoudre) {
  const exe = nomDe(mots[0])
  const ecrit = ECRIT_TOUT.has(exe) || ECRIT_PREMIER.has(exe) || ECRIT_DERNIER.has(exe)
  const cibles = []
  const positionnels = []
  for (let i = 1; i < mots.length; i++) {
    const a = mots[i]
    const bas = a.toLowerCase()
    const deux = /^(-[a-z]+):(.+)$/i.exec(a)
    // fix-ok: lu en relecture avant le premier vert — `-Path` comptait comme écriture pour toute
    // commande, donc `Get-Content -Path <partagé>` aurait été refusé ; jumeau « lire le dossier
    // partagé » du test. Un `-Path` ne vaut écriture que pour une commande qui écrit ; `-OutFile`
    // écrit quelle que soit la commande (Invoke-WebRequest, Invoke-RestMethod…).
    const ouvert = ecrit || bas === '-outfile' || deux?.[1].toLowerCase() === '-outfile'
    if (!ouvert && (PARAMS_CHEMIN.has(bas) || (deux && PARAMS_CHEMIN.has(deux[1].toLowerCase())))) {
      if (!deux) i++
      continue
    }
    if (deux && PARAMS_CHEMIN.has(deux[1].toLowerCase())) {
      if (!(ECRIT_DERNIER.has(exe) && /^-(path|literalpath|lp|pspath)$/i.test(deux[1])))
        cibles.push(deux[2])
      continue
    }
    if (PARAMS_CHEMIN.has(bas)) {
      // La source d'une copie est lue, pas écrite.
      if (!(ECRIT_DERNIER.has(exe) && /^-(path|literalpath|lp|pspath)$/.test(bas)))
        cibles.push(mots[i + 1])
      i++
      continue
    }
    if (PARAMS_A_VALEUR.has(bas)) {
      i++
      continue
    }
    if ((exe === 'cp' || exe === 'mv' || exe === 'ln' || exe === 'install') && a === '-t') {
      cibles.push(mots[++i])
      continue
    }
    if (a.startsWith('--target-directory=')) {
      cibles.push(a.slice('--target-directory='.length))
      continue
    }
    if (exe === 'curl' && (a === '-o' || a === '--output')) cibles.push(mots[++i])
    else if (exe === 'wget' && (a === '-O' || a === '--output-document')) cibles.push(mots[++i])
    else if (exe === 'dd' && bas.startsWith('of=')) cibles.push(a.slice(3))
    else if (exe === 'sed' && (a === '-e' || a === '-f')) i++
    else if (exe === 'mkdir' && a === '-m') i++
    else if (!a.startsWith('-')) positionnels.push(a)
  }
  if (ECRIT_TOUT.has(exe)) {
    // `sed` n'écrit qu'avec -i, et son premier mot libre est le script.
    if (exe === 'sed') {
      if (mots.some((m) => /^(-i|--in-place)/.test(m))) {
        const sansScript = mots.some((m) => m === '-e' || m === '-f')
          ? positionnels
          : positionnels.slice(1)
        cibles.push(...sansScript)
      }
    } else cibles.push(...positionnels)
  } else if (ECRIT_PREMIER.has(exe)) {
    if (!cibles.length && positionnels.length) cibles.push(positionnels[0])
  } else if (ECRIT_DERNIER.has(exe)) {
    if (!cibles.length && positionnels.length > 1) cibles.push(positionnels.at(-1))
  } else if (exe === 'robocopy') {
    if (positionnels[1]) cibles.push(positionnels[1])
  }
  return cibles.map((c) => cheminDuMot(c, dossier, resoudre)).filter(Boolean)
}

/** Code en ligne (PowerShell .NET, node, python) : le chemin littéral d'un appel qui écrit. */
function ciblesDuCode(commande, resoudre) {
  const s = String(commande ?? '')
  // Un littéral entre guillemets ; `n` = numéro du groupe de son guillemet ouvrant, pour le fermer.
  // fix-ok: mesuré au premier passage du test — le 1er littéral de l'appel .NET renvoyait au groupe 1
  // (le nom de la méthode) : [IO.File]::WriteAllText('…') n'était jamais reconnu.
  const lit = (n) => String.raw`(["'\x60])([^"'\x60]+)` + `\\${n}`
  const cibles = []
  const dotnet = new RegExp(
    String.raw`\[(?:System\.)?IO\.(?:File|Directory)\]::(\w+)\(\s*${lit(2)}(?:\s*,\s*${lit(4)})?`,
    'gi'
  )
  for (const m of s.matchAll(dotnet)) {
    const methode = m[1].toLowerCase()
    if (/^(copy)$/.test(methode)) cibles.push(m[5])
    else if (/^(move|replace)$/.test(methode)) cibles.push(m[3], m[5])
    else if (/^(write|append|create|delete|open(write)?$|setattributes)/.test(methode))
      cibles.push(m[3])
  }
  for (const m of s.matchAll(
    new RegExp(
      String.raw`\b(?:writeFile|appendFile|mkdir|rmdir|rm|unlink)(?:Sync)?\(\s*${lit(1)}`,
      'g'
    )
  ))
    cibles.push(m[2])
  for (const m of s.matchAll(
    new RegExp(String.raw`\b(?:copyFile|cp|rename)(?:Sync)?\(\s*${lit(1)}\s*,\s*${lit(3)}`, 'g')
  ))
    cibles.push(m[4])
  for (const m of s.matchAll(
    new RegExp(String.raw`\bopen\(\s*[rRbBuU]?${lit(1)}\s*,\s*[rRbB]?(["'])[^"']*[wax+]`, 'g')
  ))
    cibles.push(m[2])
  // Seuls les chemins absolus comptent : un chemin relatif dans du code dépend du dossier du programme.
  return cibles
    .filter((c) => c && /^([a-zA-Z]:|\/[a-zA-Z]\/|\\\\)/.test(c))
    .map((c) => resoudre(c, '.'))
}

/** Les chemins qu'une commande shell écrit, en suivant cd/Set-Location/pushd et les shells imbriqués. */
function ciblesDuShell(commande, cwd, resoudre, profondeur = 0) {
  const { segments, code } = segmentsDe(commande)
  const cibles = [...ciblesDuCode(code, resoudre)]
  let dossier = cwd
  for (const seg of segments) {
    let mots = [...seg.mots]
    while (mots.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[0])) mots.shift()
    for (const r of seg.redirs) {
      const c = cheminDuMot(r, dossier, resoudre)
      if (c) cibles.push(c)
    }
    if (!mots.length) continue
    const exe = nomDe(mots[0])
    // Un shell dans le shell : on lit la commande qu'il reçoit, depuis le même dossier.
    let interne
    if (exe === 'cmd' && mots.length > 2 && /^\/[ck]$/i.test(mots[1]))
      interne = mots.slice(2).join(' ')
    else if (/^(bash|sh|zsh)$/.test(exe) && mots[1] === '-c') interne = mots[2]
    else if (/^(powershell|pwsh)$/.test(exe)) {
      const k = mots.findIndex((m, idx) => idx > 0 && /^-(c|command)$/i.test(m))
      if (k > 0) interne = mots.slice(k + 1).join(' ')
    }
    if (interne !== undefined) {
      if (profondeur < 3) cibles.push(...ciblesDuShell(interne, dossier, resoudre, profondeur + 1))
      continue
    }
    if (/^(cd|chdir|pushd|set-location|sl|push-location)$/.test(exe)) {
      const args = mots.slice(1).filter((a) => !/^(\/d|-path|-literalpath)$/i.test(a))
      dossier =
        args[0] === undefined || args[0] === '-'
          ? undefined
          : cheminDuMot(args[0], dossier, resoudre)
      continue
    }
    cibles.push(...ciblesDuSegment(mots, dossier, resoudre))
  }
  return cibles
}

/** Les chemins d'un correctif `apply_patch` de Codex (`*** Add File: …`, `*** Move to: …`). */
function ciblesDuCorrectif(texte, cwd, resoudre) {
  const cibles = []
  for (const m of String(texte).matchAll(
    /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/gm
  )) {
    const c = cheminDuMot(m[1], cwd, resoudre)
    if (c) cibles.push(c)
  }
  return cibles
}

const OUTILS_SHELL = new Set([
  'bash',
  'powershell',
  'monitor',
  'run_terminal_command',
  'run_command',
  'shell',
  'exec_command',
  'local_shell'
])
const OUTILS_ECRITURE = new Set([
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'search_replace',
  'write_file',
  'hashline_edit',
  'strreplace',
  'editnotebook',
  'delete',
  'edit_file',
  'write_to_file',
  'create_file',
  'delete_file',
  'notebook_edit'
])
const CLES_CHEMIN = [
  'file_path',
  'filePath',
  'path',
  'notebook_path',
  'target_notebook',
  'target_file',
  'Path',
  'TargetFile'
]

/**
 * agy (Antigravity) envoie `toolCall: { name, args }`, avec `CommandLine` pour sa commande, `Path`
 * pour ses fichiers et `Cwd` quand la commande change de dossier (relevé sur agy 1.5, `read_file`,
 * `write_file`, `edit_file`, `run_command`). Ramené ici à la forme de Grok ; le reste est rendu tel quel.
 */
export function entreeCommune(entree) {
  const appel = entree?.toolCall
  if (!appel || typeof appel !== 'object') return entree
  const args = appel.args && typeof appel.args === 'object' ? appel.args : {}
  return {
    ...entree,
    toolName: appel.name,
    toolInput: { ...args, command: args.CommandLine },
    cwd: (typeof args.Cwd === 'string' && args.Cwd) || entree.cwd
  }
}

/**
 * Ce que l'appel écrirait, dans la forme que lit le contrôle de la copie à la demande
 * (`src/shared/copie-a-la-demande.ts`) : une commande (`Bash`) ou un fichier par cible (`Edit`).
 * Les corps de here-doc sont du texte : ils ne partent pas avec la commande.
 */
export function appelsVus(entree) {
  const nom = String(entree?.tool_name ?? entree?.toolName ?? '').toLowerCase()
  const outil = entree?.tool_input ?? entree?.toolInput
  const cwd = entree?.cwd || undefined
  if (!nom || !outil || typeof outil !== 'object' || !cwd) return []
  // Une commande donnée en liste (`["bash", "-lc", "…"]`) : un mot qui porte des espaces reprend ses
  // guillemets, pour rester UN mot quand le contrôle la redécoupe.
  const commande = Array.isArray(outil.command)
    ? outil.command
        .map((m) => (/\s/.test(String(m)) ? JSON.stringify(String(m)) : String(m)))
        .join(' ')
    : outil.command
  const fichier = (chemin) => ({ outil: 'Edit', chemin, shell: '', cwd })
  if (
    nom === 'apply_patch' ||
    (typeof commande === 'string' && /^\s*\*\*\* Begin Patch/.test(commande))
  ) {
    return [
      ...String(commande ?? '').matchAll(
        /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/gm
      )
    ].map((m) => fichier(m[1]))
  }
  if (OUTILS_SHELL.has(nom)) {
    if (typeof commande !== 'string') return []
    return [{ outil: 'Bash', chemin: '', shell: segmentsDe(commande).code, cwd }]
  }
  if (OUTILS_ECRITURE.has(nom))
    return CLES_CHEMIN.filter((k) => typeof outil[k] === 'string' && outil[k]).map((k) =>
      fichier(outil[k])
    )
  return []
}

/**
 * LA COPIE DU FIL S'OUVRE À SA PREMIÈRE ÉCRITURE, pour Codex, Grok et agy. Autowin désigne la conf
 * du lancement par `AUTOWIN_COPIE_A_LA_DEMANDE` ; sans elle (un lancement hors d'Autowin, un fil déjà
 * dans sa copie), rien ne se passe. Le module nommé par la conf porte le contrôle lui-même, le même
 * que celui du CLI Claude. Rend le motif qui renvoie l'agent dans sa copie, ou `undefined`.
 */
export async function copieALaDemande(entree, env = process.env) {
  const fichier = env.AUTOWIN_COPIE_A_LA_DEMANDE
  if (!fichier) return undefined
  const conf = JSON.parse(readFileSync(fichier, 'utf8'))
  if (!conf || typeof conf.module !== 'string') return undefined
  const appels = appelsVus(entree)
  if (!appels.length) return undefined
  const { motifDeCopie } = await import(pathToFileURL(conf.module).href)
  return motifDeCopie(appels, conf)
}

/**
 * Motif de refus, ou `undefined` pour laisser passer. `entree` : le JSON PreToolUse de Claude, de
 * Codex (`tool_name`/`tool_input`/`cwd`) ou de Grok (`toolName`/`toolInput`/`cwd`/`workspaceRoot`) ;
 * celui d'agy passe d'abord par `entreeCommune`.
 */
export function refusEcritureHorsCopie(entree, sonde) {
  const nom = String(entree?.tool_name ?? entree?.toolName ?? '').toLowerCase()
  const outil = entree?.tool_input ?? entree?.toolInput
  const cwd = entree?.cwd || undefined
  if (!nom || !outil || typeof outil !== 'object' || !cwd) return undefined
  // La racine de session de Grok compte aussi : son `cwd` peut être celui d'une commande.
  const ctx =
    copieDe(cwd, sonde) ??
    (entree?.workspaceRoot ? copieDe(entree.workspaceRoot, sonde) : undefined)
  if (!ctx) return undefined

  let cibles = []
  const commande = Array.isArray(outil.command) ? outil.command.join(' ') : outil.command
  if (
    nom === 'apply_patch' ||
    (typeof commande === 'string' && /^\s*\*\*\* Begin Patch/.test(commande))
  ) {
    cibles = ciblesDuCorrectif(commande, cwd, sonde.resoudre)
  } else if (OUTILS_SHELL.has(nom)) {
    if (typeof commande !== 'string') return undefined
    cibles = ciblesDuShell(commande, cwd, sonde.resoudre)
  } else if (OUTILS_ECRITURE.has(nom)) {
    for (const k of CLES_CHEMIN) {
      if (typeof outil[k] === 'string' && outil[k])
        cibles.push(cheminDuMot(outil[k], cwd, sonde.resoudre))
    }
    cibles = cibles.filter(Boolean)
  } else return undefined

  const fautive = cibles.find((c) => interdit(c, ctx))
  if (!fautive) return undefined
  const dansLaCopie = join(ctx.copie, relative(ctx.partage, fautive))
  return (
    `Refusé : ce fil travaille dans sa copie ${ctx.copie}, et cette écriture viserait ${fautive}, dans le dossier partagé ${ctx.partage}. ` +
    "L'app tourne depuis ce dossier : le travail d'un fil n'y entre que par la porte de fin de tour (« Garder »), jamais par une écriture directe. " +
    `Écris dans ta copie à la place (${dansLaCopie}) ; la porte le fera entrer. ` +
    `Seules les données de l'app (${join(ctx.partage, DONNEES_APP)}) restent ouvertes en écriture.`
  )
}

/** Sonde réelle : lit le `.git` des dossiers et le `commondir` de git. Ne modifie rien. */
export const sondeSysteme = {
  resoudre: (base, relatif) => resolve(cheminWindows(base), cheminWindows(relatif)),
  git(dossier) {
    const g = join(dossier, '.git')
    try {
      if (statSync(g).isDirectory()) return { dossier: true }
      return { texte: readFileSync(g, 'utf8') }
    } catch {
      return undefined
    }
  },
  lire(fichier) {
    try {
      return readFileSync(fichier, 'utf8')
    } catch {
      return undefined
    }
  }
}

/**
 * Le refus, dans la forme que lit chaque CLI : `hookSpecificOutput` pour Claude, Codex et Grok,
 * `decision`/`reason` pour agy (`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`).
 */
export function sortieDuRefus(motif, pourAgy) {
  return pourAgy
    ? { decision: 'deny', reason: motif }
    : {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: motif
        }
      }
}

/** Entrée du hook : JSON PreToolUse sur stdin, refus structuré sur stdout. Ne bloque jamais sur une erreur. */
async function principal() {
  let brut
  try {
    // Un BOM en tête (pipe PowerShell 5.1) faisait échouer JSON.parse de la garde npm : même parade.
    brut = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}')
  } catch {
    return
  }
  const entree = entreeCommune(brut)
  let motif
  try {
    motif = refusEcritureHorsCopie(entree, sondeSysteme)
  } catch {
    // Une garde en panne ne refuse rien.
  }
  if (!motif) {
    try {
      motif = await copieALaDemande(entree)
    } catch {
      // Conf ou module illisible : l'appel passe, comme avant les copies.
    }
  }
  if (motif) process.stdout.write(JSON.stringify(sortieDuRefus(motif, entree !== brut)))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await principal()
