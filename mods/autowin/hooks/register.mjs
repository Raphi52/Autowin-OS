// Mod Autowin OS — chargé par Autowin dans chacun de ses runs Claude Code (`--plugin-dir`, voir
// src/main/providers/claude.ts). Toute la logique est dans ./logique.mjs (testée).
import { redirigerVersBureauCache, descriptionOutilTerminal } from './logique.mjs'

export function register(on) {
  on('tool.describe', async ($, e, next) => {
    const r = await next(e)
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return r
    return { ...r, description: descriptionOutilTerminal(r?.description ?? e.description) }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    const conversation = await $.env.get('AUTOWIN_CONVERSATION_ID')
    const scriptLanceur = `${$.plugin.root}/../../scripts/hdesk-lancer.ps1`.split('\\').join('/')
    const reecrite = redirigerVersBureauCache(e.command, { conversation, scriptLanceur })
    return next(reecrite ? { ...e, command: reecrite } : e)
  })
}
