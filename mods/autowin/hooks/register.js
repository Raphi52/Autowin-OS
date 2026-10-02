/**
 * Point d'entrée des mods d'Autowin. Chargé par chaque run via `--plugin-dir` (src/main/providers/claude.ts).
 * Les décisions vivent dans ./regles.js (pures, testées) ; ce fichier ne fait que les brancher.
 *
 * L'outil shell s'appelle `PowerShell` sur ce poste, `Bash` ailleurs : les deux sont couverts.
 * `AUTOWIN_HDESK_ID` est posé par l'orchestrateur pour un run (identifiantBureauCache) ; sans lui,
 * le mod 1 ne change rien.
 */
import { descriptionAvecRegle, rappelRetire, redirigerLancementGraphique } from './regles.js'

export function register(on) {
  // Mod 1 — rediriger une app graphique vers le bureau caché du run.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const idBureau = await $.env.get('AUTOWIN_HDESK_ID')
    // fix-ok: register.js edite 4 fois parce que $.plugin.root est une VALEUR et non une fonction (types generes par la validation du CLI 2.1.287), et que le shell de ce poste s appelle PowerShell, pas Bash (matcher [Bash, PowerShell], mesure en run reel)
    const racine = $.plugin.root
    const lanceur = racine
      ? String(racine)
          .split('\\')
          .join('/')
          .replace(/\/mods\/[^/]+\/?$/, '') + '/scripts/hdesk-lancer.ps1'
      : ''
    const decision = redirigerLancementGraphique(e.command, { idBureau, lanceur })
    if (decision.action === 'refuser') return { deny: decision.motif }
    if (decision.action === 'reecrire') {
      $.ui.log('Lancement graphique redirigé vers le bureau caché ' + idBureau)
      return next({ ...e, command: decision.commande })
    }
    return next(e)
  })

  // Mod 2 — retirer les rappels automatiques qui contredisent la constitution.
  on('prompt.attachment', async ($, e, next) => {
    if (rappelRetire(e.type)) return { text: null }
    return next(e)
  })

  // Mod 3 — la règle du bureau caché dans la description de l'outil shell.
  on('tool.describe', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const r = await next(e)
    return { ...r, description: descriptionAvecRegle(r && r.description) }
  })
}
