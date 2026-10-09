// fix-ok: cause mesurée — un filtre large /[a-z]+-scheduledtask/ refusait aussi la lecture et la suppression (Get-, Unregister-, New-ScheduledTaskAction : 3 tests rouges sur 13, réinjection du 2026-10-09) ; d'où la liste étroite register|set + schtasks /create|/change + COM RegisterTaskDefinition.
/**
 * GARDE : UN AGENT NE CRÉE PAS DE TÂCHE WINDOWS QUE L'UTILISATEUR NE VERRAIT PAS DANS AUTOWIN.
 *
 * Demande de l'utilisateur (conv-114, 2026-10-09) : « l'agent doit pouvoir les créer mais il ne doit
 * rien pouvoir créer que je ne peux pas supprimer manuellement dans le task manager ». Une tâche
 * posée dans le Planificateur de tâches Windows (schtasks, Register-ScheduledTask, l'objet COM
 * Schedule.Service) n'apparaît PAS dans l'écran Task Manager d'Autowin : elle échapperait à son
 * bouton « Supprimer ». La voie légitime est la commande `task_create`, qui écrit dans le même
 * stockage que l'écran.
 *
 * PORTÉE ÉTROITE : seuls les gestes qui CRÉENT ou MODIFIENT une tâche planifiée sont refusés.
 * Les lectures (`schtasks /query`, `Get-ScheduledTask`) et la suppression (`schtasks /delete`,
 * `Unregister-ScheduledTask`) restent libres, comme `New-ScheduledTask*`, qui ne fabrique qu'un
 * objet en mémoire et n'enregistre rien. La tâche de relais d'Autowin (`windows-relay.ts`) est
 * posée par l'app elle-même, hors du terminal de l'agent : ce garde ne la voit pas.
 *
 * CONTRAINTE : fonction AUTOPORTÉE (aucun import) — sérialisée telle quelle dans le script de hook
 * du CLI (`scriptHookGardes`).
 */
export function refusTacheWindows(commande: string): string | undefined {
  const c = String(commande ?? '').toLowerCase()
  if (!c.trim()) return undefined
  const formes: RegExp[] = [
    // schtasks /create …, schtasks.exe /Change …, schtasks -create …
    /\bschtasks(\.exe)?\b[^\n;|&]*\s[/-](create|change)\b/,
    // Register-ScheduledTask, Set-ScheduledTask (PowerShell, module ScheduledTasks)
    /\b(register|set)-scheduledtask\b/,
    // Objet COM du planificateur : $svc.GetFolder('\').RegisterTaskDefinition(…)
    /\.registertaskdefinition\s*\(/,
    /\.registertask\s*\(/
  ]
  if (!formes.some((re) => re.test(c))) return undefined
  return (
    `Création de tâche Windows refusée : une tâche posée dans le Planificateur de tâches Windows ` +
    `n'apparaît pas dans l'écran Task Manager d'Autowin, l'utilisateur ne pourrait pas l'y supprimer. ` +
    `Utilise la commande task_create (tâche programmée ou règle de surveillance) : elle est visible ` +
    `et supprimable dans le Task Manager. Lire (schtasks /query, Get-ScheduledTask) reste libre.`
  )
}
