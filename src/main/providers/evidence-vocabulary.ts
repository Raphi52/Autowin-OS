/**
 * Vocabulaire PARTAGÉ du classement des preuves d'exécution — source unique pour tous les providers.
 *
 * POURQUOI UN CLASSEMENT PAR TOKEN, ET NON PAR REGEX FLOTTANTE.
 * Trois cycles d'audit successifs (2026-08-04) ont trouvé trois fois la MÊME classe de défaut dans
 * une implémentation à base de `\b…\b` cherchant le verbe n'importe où dans la commande :
 *   - `echo "git status" > f.txt` valait à la fois mutation ET oracle d'état : il se prouvait tout
 *     seul et fermait le gate sans aucun travail réel ;
 *   - `rg "Restart-Service" src` — une LECTURE — était classé mutation, donc deux lectures
 *     suffisaient à satisfaire un gate de mutation ;
 *   - à l'inverse `  git stash push` simplement INDENTÉ redevenait invisible, comme
 *     `pwsh -c "git stash push"`.
 * La cause commune n'était aucune des valeurs, mais la MÉTHODE : un littéral cité en argument est
 * indiscernable d'un verbe exécuté. On découpe donc la commande en SEGMENTS, on retire les lanceurs,
 * et on ne regarde que le PREMIER TOKEN de chaque segment — ce qui est réellement exécuté.
 *
 * Incident fondateur : `evidenceSatisfiesTask` exigeait une preuve de kind `mutation` alors que seuls
 * Edit/Write en produisaient ; une mutation faite par COMMANDE (git stash, redémarrage de service)
 * ne pouvait donc jamais satisfaire le gate — échec garanti quoi que fasse l'agent.
 */
export type ShellCommandKind = 'mutation' | 'verification' | 'inspection'

/** Lanceurs qui PRÉFIXENT une vraie commande : on les retire pour atteindre le verbe réel. */
const LAUNCHER = /^(?:sudo|command|time|nice)\s+|^(?:env|set)\s+[\w.]+=\S*\s+/i
/** Lanceurs qui portent la commande dans un ARGUMENT : `pwsh -c "…"`, `bash -c '…'`, `cmd /c …`. */
const LAUNCHER_WITH_INLINE =
  /^(?:pwsh|powershell|pwsh\.exe|powershell\.exe|bash|sh|zsh|cmd|cmd\.exe)\s+(?:-c|-Command|\/c|\/C)\s+(.+)$/i

type Rule = true | ((args: string[]) => boolean)
const firstIs =
  (...verbs: string[]) =>
  (args: string[]) =>
    verbs.includes((args[0] ?? '').toLowerCase())

const GIT_READ = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'ls-remote',
  'show-ref',
  'describe',
  'blame',
  'cat-file',
  'rev-list',
  'shortlog'
])
const GIT_WRITE = new Set([
  'commit',
  'checkout',
  'switch',
  'restore',
  'reset',
  'revert',
  'merge',
  'rebase',
  'cherry-pick',
  'apply',
  'am',
  'clean',
  'mv',
  'rm',
  'push',
  'pull',
  'fetch',
  'init',
  'add',
  'gc',
  'prune',
  'update-ref',
  'symbolic-ref',
  'submodule',
  'filter-branch'
])

/** Les arguments de `git` une fois retirés les drapeaux globaux (`-C <dir>`, `-c k=v`, `--no-pager`). */
function gitArgs(args: string[]): string[] {
  const rest = [...args]
  while (rest.length) {
    const head = rest[0]
    if (head === '-C' || head === '-c' || head === '--git-dir' || head === '--work-tree') {
      rest.splice(0, 2)
    } else if (head.startsWith('--')) {
      rest.shift()
    } else break
  }
  return rest
}

function isMutatingGit(args: string[]): boolean {
  const rest = gitArgs(args)
  const verb = (rest[0] ?? '').toLowerCase()
  const sub = (rest[1] ?? '').toLowerCase()
  if (verb === 'stash') return !['list', 'show'].includes(sub)
  if (verb === 'tag') return rest.length > 1 && !['-l', '--list', '-n'].includes(sub)
  if (verb === 'branch') return rest.slice(1).some((a) => /^-[dDmM]$/.test(a))
  if (verb === 'worktree') return ['add', 'remove', 'prune', 'move', 'repair'].includes(sub)
  if (verb === 'remote') return ['add', 'remove', 'rm', 'set-url', 'rename'].includes(sub)
  return GIT_WRITE.has(verb)
}

function isReadingGit(args: string[]): boolean {
  const rest = gitArgs(args)
  const verb = (rest[0] ?? '').toLowerCase()
  const sub = (rest[1] ?? '').toLowerCase()
  if (verb === 'stash') return ['list', 'show'].includes(sub)
  if (verb === 'worktree') return sub === 'list'
  if (verb === 'remote') return rest.length === 1 || sub === '-v' || sub === 'show'
  if (verb === 'tag') return rest.length === 1 || ['-l', '--list', '-n'].includes(sub)
  return GIT_READ.has(verb)
}

function isMutatingContainer(args: string[]): boolean {
  const flat = args.map((a) => a.toLowerCase())
  const verb = flat[0] === 'compose' ? (flat[1] ?? '') : (flat[0] ?? '')
  return [
    'run',
    'up',
    'start',
    'stop',
    'restart',
    'rm',
    'rmi',
    'kill',
    'push',
    'create',
    'exec',
    'cp'
  ].includes(verb)
}

function isMutatingDotnet(args: string[]): boolean {
  const verb = (args[0] ?? '').toLowerCase()
  if (verb === 'ef') return args.slice(1, 3).join(' ').toLowerCase() === 'database update'
  return ['publish', 'pack', 'new', 'add', 'remove'].includes(verb)
}

function isVerifyingScript(args: string[]): boolean {
  const verb = (args[0] ?? '').toLowerCase()
  if (verb === 'test' || verb === 't') return true
  if (verb !== 'run' && verb !== 'run-script') return false
  return ['test', 'typecheck', 'build', 'lint', 'check'].includes((args[1] ?? '').toLowerCase())
}

/** Verbes qui CHANGENT un état. `true` = toujours ; sinon un prédicat sur les arguments. */
const MUTATING: Record<string, Rule> = {
  git: isMutatingGit,
  mv: true,
  rm: true,
  cp: true,
  mkdir: true,
  rmdir: true,
  ren: true,
  move: true,
  del: true,
  rd: true,
  touch: true,
  erase: true,
  copy: true,
  xcopy: true,
  robocopy: true,
  tee: true,
  'rename-item': true,
  'remove-item': true,
  'new-item': true,
  'copy-item': true,
  'move-item': true,
  'set-content': true,
  'add-content': true,
  'clear-content': true,
  'out-file': true,
  'expand-archive': true,
  'compress-archive': true,
  'new-itemproperty': true,
  'set-itemproperty': true,
  sed: (args) => args.some((a) => a === '-i' || a.startsWith('-i')),
  perl: (args) => args.some((a) => a.startsWith('-pi') || a === '-i'),
  apply_patch: true,
  patch: true,
  'restart-service': true,
  'stop-service': true,
  'start-service': true,
  'set-service': true,
  'stop-process': true,
  'stop-computer': true,
  taskkill: true,
  kill: true,
  pkill: true,
  sc: firstIs('start', 'stop', 'config', 'delete', 'create'),
  'sc.exe': firstIs('start', 'stop', 'config', 'delete', 'create'),
  systemctl: firstIs('start', 'stop', 'restart', 'reload', 'enable', 'disable'),
  docker: isMutatingContainer,
  podman: isMutatingContainer,
  npm: firstIs('install', 'i', 'ci', 'uninstall', 'remove', 'rm', 'link'),
  'npm.cmd': firstIs('install', 'i', 'ci', 'uninstall', 'remove', 'rm', 'link'),
  yarn: firstIs('add', 'remove', 'install'),
  pnpm: firstIs('add', 'remove', 'install', 'i'),
  pip: firstIs('install', 'uninstall'),
  pip3: firstIs('install', 'uninstall'),
  uv: firstIs('add', 'remove'),
  dotnet: isMutatingDotnet,
  reg: firstIs('add', 'delete', 'import', 'copy'),
  curl: (args) => args.some((a) => a === '-o' || a === '-O' || a === '--output'),
  wget: true,
  'invoke-webrequest': (args) => args.some((a) => /^-OutFile$/i.test(a)),
  'invoke-restmethod': (args) => args.some((a) => /^-(?:OutFile|Method)$/i.test(a))
}

/** Verbes de VÉRIFICATION : un oracle qui échoue si le code est cassé. */
const VERIFYING: Record<string, Rule> = {
  vitest: true,
  jest: true,
  pytest: true,
  tsc: true,
  eslint: true,
  ctest: true,
  npm: isVerifyingScript,
  'npm.cmd': isVerifyingScript,
  pnpm: isVerifyingScript,
  yarn: isVerifyingScript,
  npx: firstIs('vitest', 'jest', 'tsc', 'eslint', 'pytest'),
  cargo: firstIs('test'),
  go: firstIs('test'),
  dotnet: firstIs('test'),
  node: (args) => args.includes('-e')
}

/**
 * Oracles d'ÉTAT : falsifiables, mais qui n'attestent QUE d'un état (dépôt, service, conteneur).
 * Volontairement PAS des `verification` : sinon une édition de code se « vérifierait » par un
 * `git status`. C'est `evidenceSatisfiesTask` qui les promeut en preuve, et seulement quand la
 * mutation est elle-même un état.
 */
const STATE_ORACLE: Record<string, Rule> = {
  git: isReadingGit,
  'get-service': true,
  'get-process': true,
  'get-item': true,
  'get-childitem': true,
  'get-content': true,
  'test-path': true,
  'get-itemproperty': true,
  sc: firstIs('query'),
  'sc.exe': firstIs('query'),
  systemctl: firstIs('status', 'is-active', 'is-enabled'),
  docker: firstIs('ps', 'inspect', 'images', 'logs'),
  podman: firstIs('ps', 'inspect', 'images', 'logs'),
  dotnet: (args) => args.slice(0, 3).join(' ').toLowerCase() === 'ef migrations list'
}

function hasOption(args: string[], ...names: string[]): boolean {
  return args.some((arg) =>
    names.some((name) => arg === name || arg.toLowerCase().startsWith(`${name.toLowerCase()}=`))
  )
}

function isStrictlyReadingRipgrep(args: string[]): boolean {
  return !hasOption(args, '--pre', '--pre-glob', '--generate')
}

/**
 * Lectures locales admises pendant une séquence d'attestation. Cette liste est volontairement
 * fermée : une commande inconnue (`python -c`, `node -e`, script maison…) peut écrire même si son
 * nom ne ressemble pas à un mutateur. Les redirections sont rejetées par `tokensOf`.
 */
const STRICTLY_READ_ONLY: Record<string, Rule> = {
  rg: isStrictlyReadingRipgrep,
  grep: true,
  findstr: true,
  'select-string': true,
  cat: true,
  type: true,
  head: true,
  tail: true,
  wc: true,
  ls: true,
  dir: true,
  pwd: true,
  'get-content': true,
  'get-childitem': true,
  'get-item': true,
  'get-location': true,
  'get-filehash': true,
  'test-path': true,
  'measure-object': true
}

/** Découpe une commande composée en segments réellement exécutés. */
function segmentsOf(command: string): string[] {
  return command
    .split(/\r?\n|&&|\|\||[;&|]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Retire les lanceurs, puis rend `[verbe, ...arguments]` du segment. */
function tokensOf(segment: string): string[] {
  let current = segment.trim()
  for (let i = 0; i < 3; i += 1) {
    const inline = current.match(LAUNCHER_WITH_INLINE)
    if (inline) {
      current = inline[1]
        .trim()
        .replace(/^["'](.*)["']$/s, '$1')
        .trim()
      continue
    }
    const stripped = current.replace(LAUNCHER, '')
    if (stripped === current) break
    current = stripped.trim()
  }
  // Une redirection vers un FICHIER est une écriture, quel que soit le verbe qui la précède.
  if (/>>?\s*[^\s&]/.test(current)) return ['__redirection__', ...splitTokens(current)]
  return splitTokens(current)
}

/**
 * Découpe en tokens en RESPECTANT les guillemets : `-C "C:/Amitel/Autowin OS"` est UN argument.
 * Sans cela, un chemin contenant un espace décalait tous les tokens suivants et le verbe réel
 * (`stash`) devenait invisible — la commande EXACTE de l'incident fondateur retombait en
 * `inspection`, ce que le premier jeu de tests a immédiatement révélé.
 */
function splitTokens(value: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return tokens.filter((token) => token.length > 0)
}

function matches(table: Record<string, Rule>, tokens: string[]): boolean {
  const verb = (tokens[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '')
  const rule = table[verb]
  if (rule === undefined) return false
  return rule === true ? true : rule(tokens.slice(1))
}

/**
 * LE classement, appelé par TOUS les providers — c'est ce qui garantit qu'ils ne divergent plus.
 *
 * Précédence `verification` > `mutation` > `inspection` : une commande composée qui lance un test
 * PROUVE quelque chose, et c'est cette preuve que le gate cherche. Conséquence assumée : pour une
 * mutation d'ÉTAT, l'agent doit produire son oracle dans un appel SÉPARÉ — ce que le gate exige
 * déjà par ailleurs, l'oracle devant être une preuve distincte de la mutation.
 */
export function classifyShellCommand(command: string | undefined): ShellCommandKind {
  if (!command) return 'inspection'
  const segments = segmentsOf(command).map(tokensOf)
  if (segments.some((tokens) => matches(VERIFYING, tokens))) return 'verification'
  if (segments.some((tokens) => tokens[0] === '__redirection__')) return 'mutation'
  if (segments.some((tokens) => matches(MUTATING, tokens))) return 'mutation'
  return 'inspection'
}

export function isShellMutation(command: string | undefined): boolean {
  return classifyShellCommand(command) === 'mutation'
}

export function isVerificationCommand(command: string | undefined): boolean {
  return classifyShellCommand(command) === 'verification'
}

/** Vrai seulement si CHAQUE segment est une lecture explicitement connue et sans redirection. */
export function isStrictlyReadOnlyCommand(command: string | undefined): boolean {
  if (!command) return false
  // Une lecture n'est fiable que sous forme d'une commande simple. Ces caractères ouvrent une
  // seconde évaluation dans PowerShell/cmd/POSIX (substitution, pipeline, bloc ou redirection).
  if (/[\r\n`$%(){}<>;&|^!]/u.test(command)) return false
  // Le mode strict ne dépile AUCUN lanceur : chacun ajoute une seconde sémantique d'évaluation et
  // peut cacher un environnement ou une commande inline. Seule une lecture directe est admissible.
  if (
    /^\s*(?:sudo|command|time|nice|env|set|pwsh|powershell|pwsh\.exe|powershell\.exe|bash|sh|zsh|cmd|cmd\.exe)(?:\s|$)/iu.test(
      command
    )
  )
    return false
  if (/^\s*[\w.]+\s*=/u.test(command)) return false
  const segments = segmentsOf(command).map(tokensOf)
  return segments.length > 0 && segments.every((tokens) => matches(STRICTLY_READ_ONLY, tokens))
}

/** Un oracle d'ÉTAT : vrai si un segment constate un état, et qu'aucun ne mute. */
export function isStateOracle(command: string | undefined): boolean {
  if (!command) return false
  if (classifyShellCommand(command) === 'mutation') return false
  return segmentsOf(command)
    .map(tokensOf)
    .some((tokens) => matches(STATE_ORACLE, tokens))
}
