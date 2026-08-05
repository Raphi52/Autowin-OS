/**
 * Vocabulaire PARTAGÉ du classement des preuves d'exécution.
 *
 * Pourquoi une source unique : Codex portait déjà un `CODEX_MUTATION_COMMAND` (une commande shell
 * pouvait donc valoir `mutation`) alors que Claude n'en avait AUCUN — la même tâche passait le gate
 * sous un provider et échouait sous l'autre. Deux vocabulaires dupliqués, deux comportements. Ici
 * ils n'en ont plus qu'un.
 *
 * Incident fondateur (2026-08-04) : « met toi à jour » → l'agent a bien fait le `git stash` sur le
 * dépôt réel, et le run est revenu `failed`. `evidenceSatisfiesTask` exige une preuve de kind
 * `mutation` pour toute tâche mutante, or seuls Edit/Write en produisaient : une mutation faite par
 * COMMANDE (git stash, git commit, un déplacement de fichier, un redémarrage de service) ne pouvait
 * satisfaire le gate — insatisfiable par construction, échec garanti.
 */

/**
 * Commandes qui CHANGENT l'état du dépôt ou du disque sans passer par un outil d'édition.
 * `git stash list` / `git stash show` sont exclus par le lookahead : ce sont des lectures.
 */
export const SHELL_MUTATION_COMMAND =
  /(?:^|[;&|]\s*|\n\s*)git\s+(?:-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+)\s+)?(?:stash(?!\s+(?:list|show))|commit|checkout|switch|restore|reset|revert|merge|rebase|cherry-pick|apply|am|clean|mv|rm|tag(?!\s*(?:$|-l\b|--list|-n))|push|pull|fetch|init|add|worktree\s+(?:add|remove|prune)|branch\s+-[dDmM]|remote\s+(?:add|remove|set-url))\b|\b(?:apply_patch|set-content|new-item|copy-item|move-item|remove-item|sed\s+-i|perl\s+-pi)\b|(?:^|[;&|]\s*)(?:mv|rm|cp|mkdir|rmdir|ren|touch)\s|(?:^|\s)(?:echo|printf)\b[^\n]*>|\bnpm(?:\.cmd)?\s+(?:install|ci|uninstall)\b|\b(?:pip3?|uv)\s+(?:install|uninstall)\b|\b(?:Restart|Stop|Start|Set)-Service\b|\bsc(?:\.exe)?\s+(?:start|stop|config|delete)\b|\bsystemctl\s+(?:start|stop|restart|reload|enable|disable)\b|\b(?:docker|podman)(?:\s+compose)?\s+(?:run|up|start|stop|restart|rm|kill|build|push|pull)\b|\bdotnet\s+(?:publish|restore|ef\s+database\s+update)\b|\b(?:Rename|Remove|New|Copy|Move)-Item\b|\bAdd-Content\b|\bOut-File\b|\brobocopy\b|\bExpand-Archive\b|\bCompress-Archive\b/i

/**
 * Commandes de VÉRIFICATION universelles : un oracle qui échoue si le code est cassé.
 */
export const VERIFICATION_COMMAND =
  /\b(vitest|jest|pytest|cargo\s+test|dotnet\s+test|go\s+test|tsc|eslint|npm(?:\.cmd)?\s+(?:test|run\s+(?:test|typecheck|build|lint))|pnpm\s+(?:test|run\s+(?:test|typecheck|build|lint))|node\s+-e)\b/i

/**
 * Oracles d'ÉTAT : falsifiables, mais qui n'attestent QUE de l'état du dépôt.
 *
 * Volontairement PAS classés `verification` : sinon une édition de code pourrait se « vérifier »
 * par un `git status`, ce que le gate refuse à juste titre. C'est `evidenceSatisfiesTask` qui les
 * promeut en preuve, et seulement lorsque la mutation est elle-même un état.
 */
export const STATE_ORACLE_COMMAND =
  /(?:^|[;&|]\s*|\n\s*)git\s+(?:-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+)\s+)?(?:status|stash\s+(?:list|show)|diff(?:\s|$)|rev-parse|ls-files|log|show-ref|worktree\s+list|remote\s+-v)\b|\bGet-Service\b|\bsc(?:\.exe)?\s+query\b|\bsystemctl\s+(?:status|is-active)\b|\b(?:docker|podman)\s+(?:ps|inspect|images|logs)\b|\bdotnet\s+ef\s+migrations\s+list\b|\bGet-(?:Item|ChildItem|Content|Process)\b|\bTest-Path\b/i

export function isShellMutation(command: string | undefined): boolean {
  return Boolean(command) && SHELL_MUTATION_COMMAND.test(command as string)
}

export function isVerificationCommand(command: string | undefined): boolean {
  return Boolean(command) && VERIFICATION_COMMAND.test(command as string)
}

export function isStateOracle(command: string | undefined): boolean {
  return Boolean(command) && STATE_ORACLE_COMMAND.test(command as string)
}
