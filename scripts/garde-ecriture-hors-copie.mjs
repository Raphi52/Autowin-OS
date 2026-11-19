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
 * données de l'app), écrire un chemin que git IGNORE dans le dossier partagé (`entreprise/`, propre au
 * poste), lire le dossier partagé ou en copier un fichier VERS la copie. Un chemin ignoré n'entre
 * jamais par la porte, qui ne fusionne que ce que git suit : renvoyer son écriture vers la copie la
 * perdrait. C'est la définition du code de `cibleDEcritureDansLeDepot` (src/shared/copie-a-la-demande.ts) :
 * le dépôt moins ce que git ignore. Git muet sur un chemin : il compte dans le code (refusé).
 *
 * LE SHELL NE SE JUGE PAS PARFAITEMENT. Sont refusées les formes claires : redirections (`>`, `>>`,
 * `n>`, `*>`), Set-Content/Add-Content/Out-File/Tee-Object/New-Item, cp/mv/rm/touch/mkdir/tee/sed -i/dd,
 * copy/move/del de cmd, Copy-Item/Move-Item/Remove-Item/Rename-Item, -OutFile, curl -o,
 * [IO.File]::…, writeFileSync de node et open(…, 'w') de python, `git worktree add <dossier>`,
 * y compris après cd/Set-Location/pushd
 * et dans cmd /c, powershell -Command, bash -c. Ne sont PAS vues : un chemin bâti dans une variable
 * (`$p = 'D:\AutoWinOS'; … > $p\x`), un script lancé qui écrit lui-même, `git -C <dossier partagé>`
 * (checkout, commit…), une écriture à travers un lien de la copie (`node_modules`, relié au dépôt :
 * c'est la garde npm qui le protège), une commande coupée par Grok au-delà de 128 Kio.
 *
 * SECONDE RÈGLE, pour tout agent, dans une copie ou non (`refusALaRacineDuDisque`) : aucune entrée
 * NEUVE à la racine d'un disque (`D:\x.log`, `D:\tmp-lot9\`, `git worktree add D:\Projet-lot1`).
 *
 * TROISIÈME RÈGLE (`refusNomReserve`) : un outil d'écriture, une commande shell ou un correctif ne pose
 * pas un nom ou un terme réservé à l'entreprise dans un fichier suivi d'un dépôt qui porte des profils
 * d'entreprise. Le shell n'est lu que là où le texte posé est écrit dans la commande (`ecrituresDuShell`).
 *
 * Aucune dépendance hors `node:` : Claude lance une COPIE de ce fichier, posée seule dans son dossier
 * de réglages. Une erreur interne laisse passer, comme la garde npm : une garde en panne ne doit pas
 * refuser tous les outils de tous les agents.
 */
import { spawnSync } from 'node:child_process'
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

/**
 * Écrire `chemin` toucherait le code du dossier partagé : hors de ses données d'app, hors de la copie,
 * et suivi par git (`sonde.ignore`, appelée en dernier : seulement pour un chemin déjà refusable).
 */
function interdit(chemin, ctx, sonde) {
  return (
    sous(chemin, ctx.partage) &&
    !sous(chemin, join(ctx.partage, DONNEES_APP)) &&
    !sous(chemin, ctx.copie) &&
    sonde.ignore?.(ctx.partage, chemin) !== true
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
 * SOUS GIT BASH, `/x` SANS LETTRE DE DISQUE N'EST PAS SUR LE DISQUE COURANT : `/dev/null` est le
 * périphérique nul, `/tmp` le dossier temporaire, `/usr` le dossier de Git. Seul `/d/…` désigne un
 * disque (`cheminWindows`). PowerShell, lui, lit `/x` comme la racine du disque courant : son
 * `resoudre` reste celui de la sonde. Sans cette distinction, `2>/dev/null` devenait la création de
 * `D:\dev` et la garde de racine refusait toute commande qui jette une sortie.
 */
function resoudreSousBash(resoudre) {
  return (base, relatif) =>
    /^\/(?![\\/])(?![a-zA-Z](\/|$))/.test(String(relatif)) ? undefined : resoudre(base, relatif)
}

/**
 * Découpe une commande en segments `{ mots, redirs, tube, cite, heredoc }`, et rend `code`, la commande
 * privée de ses corps de texte. Guillemets respectés, `;` `&&` `||` `|` `&`
 * et fin de ligne séparent, les cibles de `>` sont mises à part. Les corps de here-doc (`<<EOF`) et
 * de here-string PowerShell (`@" … "@`) sont du TEXTE : ils ne sont pas lus comme des commandes.
 * `tube` : le segment lit la sortie du précédent (`a | b`) ; `cite` : son premier mot est une chaîne
 * entre guillemets (PowerShell l'écrit sur la sortie) ; `heredoc` : le corps du here-doc qu'il reçoit.
 */
function segmentsDe(commande) {
  const s = String(commande ?? '')
  const segments = []
  /** Les morceaux de `s` qui sont du texte (corps de here-doc et de here-string), à écarter du code. */
  const corps = []
  const neuf = () => ({ mots: [], redirs: [], tube: false, cite: false, heredoc: undefined })
  let seg = neuf()
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
    seg = neuf()
  }
  /** Le mot qui commence est le premier de la commande : une chaîne là est écrite sur la sortie. */
  const premierMot = () => mot === null && !cible && !entree && !seg.mots.length
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '"' || c === "'") {
      if (premierMot()) seg.cite = true
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
      if (!cible && !entree && !seg.mots.length) seg.cite = true
      const fin = s.indexOf(`\n${s[i + 1]}@`, i + 2)
      mot = fin < 0 ? s.slice(i + 2) : s.slice(i + 2, fin)
      corps.push([i + 2, fin < 0 ? s.length : fin])
      i = fin < 0 ? s.length : fin + 3
      continue
    }
    if (c === '\n') {
      finirSegment()
      i++
      // Les lignes d'un here-doc ouvert sur la ligne finie, jusqu'à son délimiteur ; le corps revient
      // au segment qui l'a ouvert.
      while (heredocs.length && i < s.length) {
        const nl = s.indexOf('\n', i)
        const ligne = (nl < 0 ? s.slice(i) : s.slice(i, nl)).replace(/\r$/, '')
        corps.push([i, nl < 0 ? s.length : nl])
        i = nl < 0 ? s.length : nl + 1
        const ouvert = heredocs[0]
        if (ligne.trim() === ouvert.fin) heredocs.shift()
        else ouvert.seg.heredoc = `${ouvert.seg.heredoc ?? ''}${ligne}\n`
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
      const tube = s[i + 1] !== '|'
      finirSegment()
      seg.tube = tube
      i += tube ? 1 : 2
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
          heredocs.push({ fin: m[2], seg })
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

/** Options globales de git qui prennent le mot suivant comme valeur (`git -c x=y worktree …`). */
const GIT_OPTIONS_A_VALEUR = new Set([
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env'
])
/** Options de `git worktree add` qui prennent le mot suivant comme valeur. */
const WORKTREE_ADD_A_VALEUR = new Set(['-b', '-B', '--reason'])

/**
 * `git [-C <dossier>] [options] worktree add [options] <chemin> [<commit>]` : le dossier que git va
 * créer. Une copie git est une écriture comme une autre, et la plus lourde : un dossier entier.
 */
function copiesGitDuSegment(mots, dossier, resoudre) {
  let base = dossier
  let i = 1
  for (; i < mots.length; i++) {
    const a = mots[i]
    if (a === '-C') base = cheminDuMot(mots[++i], base, resoudre)
    else if (GIT_OPTIONS_A_VALEUR.has(a)) i++
    else if (!a.startsWith('-')) break
  }
  if (mots[i] !== 'worktree' || mots[i + 1] !== 'add') return []
  for (let k = i + 2; k < mots.length; k++) {
    const a = mots[k]
    if (WORKTREE_ADD_A_VALEUR.has(a)) k++
    else if (!a.startsWith('-')) {
      const chemin = cheminDuMot(a, base, resoudre)
      return chemin ? [chemin] : []
    }
  }
  return []
}

/** Les chemins qu'un segment de shell écrit, résolus. */
function ciblesDuSegment(mots, dossier, resoudre) {
  const exe = nomDe(mots[0])
  if (exe === 'git') return copiesGitDuSegment(mots, dossier, resoudre)
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

/**
 * Parcourt une commande shell en suivant cd/Set-Location/pushd et les shells imbriqués : `code(code)`
 * reçoit chaque commande privée de ses corps de texte, `etape(e)` chaque segment avec son dossier
 * courant (`e.dossier`), la lecture de ses chemins (`e.lire`) et l'étape qui l'alimente par un tube
 * (`e.amont`). `e.commande` est faux pour un cd ou un shell imbriqué : seules ses redirections comptent.
 * `bash` : la commande est lue par bash ; un shell imbriqué dit le sien. Hors Windows, `/x` est un
 * vrai chemin absolu du système et se lit tel quel : seul Git Bash a besoin de `resoudreSousBash`.
 */
function parcourirShell(commande, cwd, resoudre, visiteur, profondeur = 0, bash = false) {
  const { segments, code } = segmentsDe(commande)
  visiteur.code(code)
  const lire = bash && process.platform === 'win32' ? resoudreSousBash(resoudre) : resoudre
  let dossier = cwd
  let amont
  for (const seg of segments) {
    const mots = [...seg.mots]
    while (mots.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[0])) mots.shift()
    const exe = nomDe(mots[0])
    // Un shell dans le shell : on lit la commande qu'il reçoit, depuis le même dossier.
    let interne
    const interneBash = /^(bash|sh|zsh)$/.test(exe)
    if (exe === 'cmd' && mots.length > 2 && /^\/[ck]$/i.test(mots[1]))
      interne = mots.slice(2).join(' ')
    else if (interneBash && mots[1] === '-c') interne = mots[2]
    else if (/^(powershell|pwsh)$/.test(exe)) {
      const k = mots.findIndex((m, idx) => idx > 0 && /^-(c|command)$/i.test(m))
      if (k > 0) interne = mots.slice(k + 1).join(' ')
    }
    const cd = /^(cd|chdir|pushd|set-location|sl|push-location)$/.test(exe)
    const etape = {
      seg,
      mots,
      exe,
      dossier,
      lire,
      amont: seg.tube ? amont : undefined,
      commande: mots.length > 0 && interne === undefined && !cd
    }
    amont = etape
    visiteur.etape(etape)
    if (interne !== undefined) {
      if (profondeur < 3)
        parcourirShell(interne, dossier, resoudre, visiteur, profondeur + 1, interneBash)
      continue
    }
    if (cd) {
      const args = mots.slice(1).filter((a) => !/^(\/d|-path|-literalpath)$/i.test(a))
      dossier =
        args[0] === undefined || args[0] === '-' ? undefined : cheminDuMot(args[0], dossier, lire)
    }
  }
}

/** Les cibles des redirections d'une étape, résolues depuis son dossier. */
const redirectionsDe = ({ seg, dossier, lire }) =>
  seg.redirs.map((r) => cheminDuMot(r, dossier, lire)).filter(Boolean)

/** Les chemins qu'une commande shell écrit. */
function ciblesDuShell(commande, cwd, resoudre, bash = false) {
  const cibles = []
  parcourirShell(
    commande,
    cwd,
    resoudre,
    {
      code: (code) => cibles.push(...ciblesDuCode(code, resoudre)),
      etape: (e) => {
        cibles.push(...redirectionsDe(e))
        if (e.commande) cibles.push(...ciblesDuSegment(e.mots, e.dossier, e.lire))
      }
    },
    0,
    bash
  )
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
/** Les outils de Claude dont la commande passe par bash (Git Bash sous Windows). */
const OUTILS_GIT_BASH = new Set(['bash', 'monitor'])
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
/** L'appel lu dans l'entrée d'un CLI : nom d'outil en minuscules, arguments, dossier, commande. */
function appelDe(entree) {
  const nom = String(entree?.tool_name ?? entree?.toolName ?? '').toLowerCase()
  const outil = entree?.tool_input ?? entree?.toolInput
  const cwd = entree?.cwd || undefined
  if (!nom || !outil || typeof outil !== 'object' || !cwd) return undefined
  const commande = Array.isArray(outil.command) ? outil.command.join(' ') : outil.command
  return { nom, outil, cwd, commande }
}

/** Les chemins que l'appel écrirait, résolus ; `[]` pour un outil qui n'écrit pas. */
function ciblesDeLAppel({ nom, outil, cwd, commande }, resoudre) {
  if (
    nom === 'apply_patch' ||
    (typeof commande === 'string' && /^\s*\*\*\* Begin Patch/.test(commande))
  )
    return ciblesDuCorrectif(commande, cwd, resoudre)
  if (OUTILS_SHELL.has(nom))
    return typeof commande === 'string'
      ? ciblesDuShell(commande, cwd, resoudre, OUTILS_GIT_BASH.has(nom))
      : []
  if (OUTILS_ECRITURE.has(nom))
    return CLES_CHEMIN.filter((k) => typeof outil[k] === 'string' && outil[k])
      .map((k) => cheminDuMot(outil[k], cwd, resoudre))
      .filter(Boolean)
  return []
}

export function refusEcritureHorsCopie(entree, sonde) {
  const appel = appelDe(entree)
  if (!appel) return undefined
  // La racine de session de Grok compte aussi : son `cwd` peut être celui d'une commande.
  const ctx =
    copieDe(appel.cwd, sonde) ??
    (entree?.workspaceRoot ? copieDe(entree.workspaceRoot, sonde) : undefined)
  if (!ctx) return undefined

  const cibles = ciblesDeLAppel(appel, sonde.resoudre)
  const fautive = cibles.find((c) => interdit(c, ctx, sonde))
  if (!fautive) return undefined
  const dansLaCopie = join(ctx.copie, relative(ctx.partage, fautive))
  return (
    `Refusé : ce fil travaille dans sa copie ${ctx.copie}, et cette écriture viserait ${fautive}, dans le dossier partagé ${ctx.partage}. ` +
    "L'app tourne depuis ce dossier : le travail d'un fil n'y entre que par la porte de fin de tour (« Garder »), jamais par une écriture directe. " +
    `Écris dans ta copie à la place (${dansLaCopie}) ; la porte le fera entrer. ` +
    `Seules les données de l'app (${join(ctx.partage, DONNEES_APP)}) restent ouvertes en écriture.`
  )
}

/** Les clés où un outil d'écriture porte le texte qu'il pose : contenu entier, ou nouveau texte d'une retouche. */
const CLES_TEXTE = [
  'content',
  'new_string',
  'newString',
  'new_str',
  'file_text',
  'new_source',
  'CodeContent',
  'ReplacementContent'
]

/** Le texte que l'appel écrirait, morceau par morceau (une retouche multiple en a plusieurs). */
function textesEcrits(outil) {
  const textes = []
  const prendre = (objet) => {
    for (const k of CLES_TEXTE)
      if (typeof objet?.[k] === 'string' && objet[k]) textes.push(objet[k])
  }
  prendre(outil)
  for (const liste of [outil.edits, outil.ReplacementChunks])
    if (Array.isArray(liste)) liste.forEach(prendre)
  return textes
}

/** Le dossier git le plus proche qui contient `chemin` (le fichier peut ne pas exister encore). */
function depotDuFichier(chemin, sonde) {
  for (let dossier = dirname(chemin); ;) {
    if (sonde.git(dossier)) return dossier
    const parent = dirname(dossier)
    if (parent === dossier) return undefined
    dossier = parent
  }
}

/** Chaque passage réservé de `texte` (nom d'un profil, casse ignorée, ou terme interdit) : début et fin. */
function passagesReserves(texte, noms, termes) {
  const passages = []
  const minuscules = texte.toLowerCase()
  for (const nom of noms)
    for (let i = minuscules.indexOf(nom); i >= 0; i = minuscules.indexOf(nom, i + nom.length))
      passages.push([i, i + nom.length])
  for (const { regex } of termes)
    for (const m of texte.matchAll(new RegExp(regex.source, `${regex.flags.replace('g', '')}g`)))
      passages.push([m.index, m.index + Math.max(1, m[0].length)])
  return passages.sort((a, b) => a[0] - b[0])
}

/** Commandes qui écrivent leurs arguments sur la sortie. */
const AFFICHE = new Set(['echo', 'printf', 'write-output'])
/** Commandes qui écrivent leur entrée (tube, here-doc) dans les fichiers qu'elles nomment. */
const ECRIT_L_ENTREE = new Set(['tee', 'tee-object', ...ECRIT_PREMIER])
/** Interpréteurs dont le here-doc est du code. */
const INTERPRETES = new Set(['node', 'python', 'python3', 'py'])

/**
 * Ce qu'une étape écrit sur sa sortie quand la commande le dit en clair : arguments d'un echo, chaîne
 * de PowerShell, here-doc rendu par cat ou tee. `undefined` pour une sortie qu'on ne connaît pas.
 */
function sortieDe(e) {
  if (!e?.commande) return undefined
  if (e.seg.cite) return e.mots.join(' ')
  if (AFFICHE.has(e.exe)) return e.mots.slice(1).join(' ')
  const lit = e.exe === 'cat' && e.mots.slice(1).every((m) => m === '-')
  if (lit || e.exe === 'tee' || e.exe === 'tee-object') return entreeDe(e)
  return undefined
}

/** Ce qu'une étape reçoit en entrée : son here-doc, ou la sortie connue de l'étape qui l'alimente. */
const entreeDe = (e) => e.seg.heredoc ?? sortieDe(e.amont)

/** Les valeurs écrites par Set-Content, Add-Content, Out-File : `-Value`, `-InputObject`, positionnels après le chemin. */
function valeursDeContenu(mots) {
  const valeurs = []
  const positionnels = []
  for (let i = 1; i < mots.length; i++) {
    const bas = mots[i].toLowerCase()
    const deux = /^(-[a-z]+):(.*)$/i.exec(mots[i])
    if (deux && /^-(value|inputobject)$/i.test(deux[1])) valeurs.push(deux[2])
    else if (bas === '-value' || bas === '-inputobject') valeurs.push(mots[++i])
    else if (PARAMS_CHEMIN.has(bas) || PARAMS_A_VALEUR.has(bas)) i++
    else if (!bas.startsWith('-')) positionnels.push(mots[i])
  }
  return [...valeurs, ...positionnels.slice(1)]
}

/** Les scripts d'un sed : valeurs de `-e`, sinon son premier mot libre. Un script lu d'un fichier (`-f`) n'est pas lu. */
function scriptsDeSed(mots) {
  const scripts = []
  const libres = []
  let parE = false
  for (let i = 1; i < mots.length; i++) {
    const a = mots[i]
    if (a === '-e' || a === '--expression') {
      scripts.push(mots[++i] ?? '')
      parE = true
    } else if (a.startsWith('--expression=')) {
      scripts.push(a.slice('--expression='.length))
      parE = true
    } else if (a === '-f' || a === '--file') {
      i++
      parE = true
    } else if (!a.startsWith('-')) libres.push(a)
  }
  if (!parE && libres.length) scripts.push(libres[0])
  return scripts
}

/**
 * Le texte qu'un script sed POSE : remplacement de `s`, cible de `y`, ligne de `a`, `i`, `c`. Ses
 * adresses et ses motifs sont lus, pas écrits : `s/terme/x/` et `/terme/d` retirent le terme, ils passent.
 */
function textesDuScriptSed(script) {
  const s = String(script)
  const textes = []
  let i = 0
  /** Lit jusqu'au délimiteur non échappé, le saute, rend le morceau lu. */
  const jusquA = (delim) => {
    const debut = i
    while (i < s.length && s[i] !== delim) i += s[i] === '\\' ? 2 : 1
    const morceau = s.slice(debut, Math.min(i, s.length))
    i++
    return morceau
  }
  while (i < s.length) {
    const c = s[i]
    if (/[\s;{}!,0-9$~+]/.test(c)) i++
    else if (c === '/') {
      i++
      jusquA('/')
    } else if (c === '\\') {
      i += 2
      jusquA(s[i - 1])
    } else if ((c === 's' || c === 'y') && s[i + 1] && !/[\s\\\n]/.test(s[i + 1])) {
      const delim = s[i + 1]
      i += 2
      jusquA(delim)
      textes.push(jusquA(delim))
      while (i < s.length && /[a-zA-Z0-9]/.test(s[i])) i++
    } else if (c === 'a' || c === 'i' || c === 'c') {
      const fin = s.indexOf('\n', i)
      textes.push(s.slice(i + 1, fin < 0 ? s.length : fin).replace(/^\\?\s*/, ''))
      i = fin < 0 ? s.length : fin + 1
    } else while (i < s.length && s[i] !== ';' && s[i] !== '\n') i++
  }
  return textes
}

/**
 * Code en ligne qui écrit un texte littéral à un chemin absolu littéral : `writeFile`/`appendFile` de
 * node, `[IO.File]::WriteAllText`/`AppendAllText` de .NET, `open(…, 'w').write(…)` et `write_text` de
 * python. Mêmes littéraux que `ciblesDuCode` : un texte bâti dans une variable n'est pas lu.
 */
function ecrituresDuCode(code, resoudre) {
  const s = String(code ?? '')
  const lit = (n) => String.raw`(["'\x60])([^"'\x60]*)` + `\\${n}`
  const ecritures = []
  const formes = [
    String.raw`\b(?:writeFile|appendFile)(?:Sync)?\(\s*${lit(1)}\s*,\s*${lit(3)}`,
    String.raw`\[(?:System\.)?IO\.File\]::(?:Write|Append)All(?:Text|Lines)\(\s*${lit(1)}\s*,\s*${lit(3)}`,
    String.raw`\bopen\(\s*[rRbBuU]?${lit(1)}\s*,\s*[rRbB]?["'][^"']*[wa+][^"']*["'][^)]*\)\s*\.write\(\s*[rRbBuUfF]?${lit(3)}`,
    String.raw`\bPath\(\s*[rRbBuU]?${lit(1)}\s*\)\s*\.write_text\(\s*[rRbBuUfF]?${lit(3)}`
  ]
  for (const forme of formes)
    for (const m of s.matchAll(new RegExp(forme, 'gi')))
      if (/^([a-zA-Z]:|\/[a-zA-Z]\/|\\\\)/.test(m[2]))
        ecritures.push({ cible: resoudre(m[2], '.'), texte: m[4] })
  return ecritures
}

/**
 * Le texte qu'une commande shell pose, fichier par fichier : `{ cible, texte }`. Seules les formes où le
 * texte est écrit dans la commande elle-même : echo/printf ou chaîne vers une redirection, here-doc
 * rendu par cat ou tee, Set-Content/Add-Content/Out-File/tee alimentés par un tube ou par leurs
 * valeurs, remplacements de `sed -i`, code en ligne. La sortie d'un programme (`grep … > f`) est inconnue.
 */
function ecrituresDuShell(commande, cwd, resoudre, bash = false) {
  const ecritures = []
  const poser = (cibles, textes) => {
    for (const cible of cibles)
      for (const texte of textes) if (texte) ecritures.push({ cible, texte })
  }
  parcourirShell(
    commande,
    cwd,
    resoudre,
    {
      code: (code) => ecritures.push(...ecrituresDuCode(code, resoudre)),
      etape: (e) => {
        poser(redirectionsDe(e), [sortieDe(e)])
        if (!e.commande) return
        if (INTERPRETES.has(e.exe) && e.seg.heredoc)
          ecritures.push(...ecrituresDuCode(e.seg.heredoc, resoudre))
        const ecrit = ECRIT_L_ENTREE.has(e.exe) || e.exe === 'sed'
        const cibles = ecrit ? ciblesDuSegment(e.mots, e.dossier, e.lire) : []
        if (!cibles.length) return
        if (e.exe === 'sed') poser(cibles, scriptsDeSed(e.mots).flatMap(textesDuScriptSed))
        else
          poser(cibles, [
            entreeDe(e),
            ...(ECRIT_PREMIER.has(e.exe) ? valeursDeContenu(e.mots) : [])
          ])
      }
    },
    0,
    bash
  )
  return ecritures
}

/** Le texte qu'ajoute un correctif `apply_patch` (ses lignes `+`), fichier par fichier, destination d'un `Move to` comprise. */
function ecrituresDuCorrectif(texte, cwd, resoudre) {
  const ecritures = []
  let courante
  for (const ligne of String(texte).split('\n')) {
    const entete = /^\*\*\* (Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/.exec(ligne)
    if (entete) {
      const cible = entete[1] === 'Delete File' ? undefined : cheminDuMot(entete[2], cwd, resoudre)
      if (entete[1] === 'Move to' && courante) courante.cible = cible
      else {
        courante = cible ? { cible, texte: '' } : undefined
        if (courante) ecritures.push(courante)
      }
    } else if (courante && ligne.startsWith('+')) courante.texte += `${ligne.slice(1)}\n`
  }
  return ecritures.filter((e) => e.cible && e.texte)
}

/**
 * Les règles de nom réservé d'un dépôt, depuis SON module (`scripts/identite-entreprise.mjs`) ;
 * `undefined` pour un dépôt sans ce module, sans profil, ou au profil mal formé (le crochet de commit
 * laisse alors passer lui aussi).
 */
async function reglesDuDepot(depot, sonde) {
  const module = join(depot, 'scripts', 'identite-entreprise.mjs')
  if (!sonde.existe(module)) return undefined
  const regles = await import(pathToFileURL(module).href)
  const profils = regles.racineDesProfils(depot)
  if (!profils) return undefined
  const { termes, erreurs } = regles.termesDesProfils(profils)
  if (erreurs.length) return undefined
  return { noms: regles.nomsDesProfils(profils), termes }
}

/** Ce que l'appel poserait, fichier par fichier : `{ cible, texte }`, quel que soit l'outil. */
function ecrituresDeLAppel({ nom, outil, cwd, commande }, resoudre) {
  if (
    nom === 'apply_patch' ||
    (typeof commande === 'string' && /^\s*\*\*\* Begin Patch/.test(commande))
  )
    return ecrituresDuCorrectif(commande, cwd, resoudre)
  if (OUTILS_SHELL.has(nom))
    return typeof commande === 'string'
      ? ecrituresDuShell(commande, cwd, resoudre, OUTILS_GIT_BASH.has(nom))
      : []
  if (!OUTILS_ECRITURE.has(nom)) return []
  const textes = textesEcrits(outil)
  return CLES_CHEMIN.filter((k) => typeof outil[k] === 'string' && outil[k])
    .map((k) => cheminDuMot(outil[k], cwd, resoudre))
    .filter(Boolean)
    .flatMap((cible) => textes.map((texte) => ({ cible, texte })))
}

/**
 * LE NOM RÉSERVÉ SE REFUSE À L'ÉCRITURE, PAS AU COMMIT. Dans un dépôt qui porte des profils d'entreprise
 * (`entreprise/<profil>/identite.json`, règles de `scripts/identite-entreprise.mjs`), un fichier suivi par
 * git ne doit porter ni le nom d'un profil ni ses termes interdits. Le crochet de commit le refusait bien,
 * mais à la fin du tour : le commit du fil échouait, l'envoi restait bloqué, et il fallait un tour de
 * plus pour retrouver le fichier (mesuré le 2026-11-19 sur cinq fils en trois jours). Ici, l'outil
 * d'écriture (Write, Edit, MultiEdit…) est refusé AVANT, avec la ligne fautive, le passage masqué.
 *
 * Mêmes règles que le crochet, chargées depuis le dépôt du fichier écrit (son module, pas une copie) ;
 * un dépôt sans ce module (un autre projet, une copie d'un autre projet rangée chez nous) n'est pas
 * concerné. Passent : `entreprise/`, les données de l'app, tout chemin que git ignore, un profil mal
 * formé (le crochet laisse alors passer lui aussi). Le shell est lu aussi (`ecrituresDuShell`), dans ses
 * formes claires ; un correctif `apply_patch` par ses lignes ajoutées.
 */
export async function refusNomReserve(entree, sonde = sondeSysteme) {
  const appel = appelDe(entree)
  if (!appel) return undefined
  /** Les règles de chaque dépôt touché, chargées une fois par appel. */
  const reglesDe = new Map()
  for (const { cible, texte } of ecrituresDeLAppel(appel, sonde.resoudre)) {
    const depot = depotDuFichier(cible, sonde)
    if (!depot) continue
    const relatif = relative(depot, cible).split(sep).join('/')
    if (relatif.startsWith('entreprise/') || relatif.startsWith(`${DONNEES_APP}/`)) continue
    if (!reglesDe.has(depot)) reglesDe.set(depot, await reglesDuDepot(depot, sonde))
    const regles = reglesDe.get(depot)
    if (!regles) continue
    const passages = passagesReserves(texte, regles.noms, regles.termes)
    if (!passages.length || sonde.ignore?.(depot, cible) === true) continue
    const [debut] = passages[0]
    const ligne = texte.slice(0, debut).split('\n').length
    const ouvre = texte.lastIndexOf('\n', debut - 1) + 1
    const ferme = texte.indexOf('\n', debut)
    const fin = ferme < 0 ? texte.length : ferme
    // La ligne fautive, chaque passage réservé masqué : l'agent retrouve l'endroit sans que le terme
    // ne reparte dans sa réponse, ni dans le fil.
    let extrait = ''
    let curseur = ouvre
    for (const [a, b] of passages.filter(([a, b]) => a < fin && b > ouvre)) {
      if (a < curseur) continue
      extrait += `${texte.slice(curseur, a)}«…»`
      curseur = Math.min(b, fin)
    }
    extrait = `${extrait}${texte.slice(curseur, fin)}`.trim().slice(0, 200)
    return (
      `Refusé : ce texte porte un nom ou un terme réservé à l'entreprise, et ${relatif} est suivi par git. ` +
      `Ligne ${ligne} du texte écrit : « ${extrait} » (passage réservé masqué par «…»). ` +
      "Le commit de fin de tour le refuserait et l'envoi du fil resterait bloqué. " +
      'Reformule sans lui (exemple fictif, « un dépôt de l’utilisateur »…), puis réécris. ' +
      `Restent libres : entreprise/, ${DONNEES_APP}/ et les fichiers que git ignore.`
    )
  }
  return undefined
}

/**
 * Le marqueur qu'un agent pose devant sa commande quand l'utilisateur a demandé LUI-MÊME, dans son
 * message, un emplacement à la racine d'un disque (« clone-le dans D:\ », « mets le zip sur D:\ »).
 */
const DEMANDE_UTILISATEUR = /\bAUTOWIN_DEMANDE_UTILISATEUR\s*=\s*['"]?1\b/

/** `D:\nom` : l'entrée de premier niveau du disque où tombe `chemin` ; `undefined` hors lettre de disque. */
export function entreeDeRacine(chemin) {
  const m = /^([a-zA-Z]:)[\\/]+([^\\/]+)/.exec(String(chemin ?? ''))
  return m ? `${m[1].toUpperCase()}\\${m[2]}` : undefined
}

/**
 * RIEN DE NEUF À LA RACINE D'UN DISQUE, pour tout agent lancé par l'app, dans une copie ou non.
 * Relevé du 18/11 : des lots qui travaillaient déjà dans une copie ouverte et retirée par l'app y ont
 * créé à la main une soixantaine de copies git et des centaines de journaux et de dossiers `tmp-`,
 * que rien ne range : la garde d'écriture hors copie ne protège que le dossier partagé. Une entrée
 * qui EXISTE déjà (un projet, `D:\tmp`) reste ouverte, la supprimer aussi ; seule la création d'une
 * nouvelle entrée de premier niveau est refusée. `sonde.existe` absente : rien n'est refusé.
 */
export function refusALaRacineDuDisque(entree, sonde) {
  const appel = appelDe(entree)
  if (!appel || typeof sonde?.existe !== 'function') return undefined
  if (typeof appel.commande === 'string' && DEMANDE_UTILISATEUR.test(appel.commande))
    return undefined
  const neuve = ciblesDeLAppel(appel, sonde.resoudre)
    .map(entreeDeRacine)
    .find((e) => e !== undefined && !sonde.existe(e))
  if (!neuve) return undefined
  return (
    `Refusé : cet appel créerait ${neuve}, à la racine du disque ${neuve.slice(0, 2)}\\. ` +
    "Rien ne range ce qu'un agent y laisse : des lots y ont laissé une soixantaine de copies git et des centaines de journaux. " +
    `Ton dossier de travail est ${appel.cwd} ; l'app y fait entrer ton travail dans main, sans copie de plus. ` +
    'Journaux et fichiers de travail : dans le dossier temporaire ($TEMP en Bash, $env:TEMP en PowerShell). ' +
    'Copie de comparaison (avant/après) : `git worktree add "$TEMP/<nom>" <commit>`, puis `git worktree remove` avant de rendre la main. ' +
    "Seulement si l'utilisateur a demandé lui-même cet emplacement dans son message : relance la commande précédée de AUTOWIN_DEMANDE_UTILISATEUR=1."
  )
}

/**
 * Sonde réelle : lit le `.git` des dossiers et le `commondir` de git, demande à git s'il ignore un
 * chemin. Ne modifie rien.
 */
export const sondeSysteme = {
  /** Vrai si git ignore `chemin` dans `depot`, faux s'il le suit, `undefined` si git n'a pas su répondre. */
  ignore(depot, chemin) {
    try {
      const r = spawnSync('git', ['-C', depot, 'check-ignore', '-q', '--', chemin], {
        timeout: 5000,
        windowsHide: true
      })
      return r.status === 0 ? true : r.status === 1 ? false : undefined
    } catch {
      return undefined
    }
  },
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
  },
  existe(chemin) {
    try {
      statSync(chemin)
      return true
    } catch {
      return false
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
    motif =
      refusEcritureHorsCopie(entree, sondeSysteme) ?? refusALaRacineDuDisque(entree, sondeSysteme)
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
  if (!motif) {
    try {
      motif = await refusNomReserve(entree)
    } catch {
      // Règles du dépôt illisibles : le crochet de commit reste le filet.
    }
  }
  if (motif) process.stdout.write(JSON.stringify(sortieDuRefus(motif, entree !== brut)))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await principal()
