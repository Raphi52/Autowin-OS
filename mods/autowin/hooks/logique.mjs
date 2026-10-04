/**
 * Logique PURE du mod Autowin (aucun import : un module de mod n'importe que ses propres fichiers).
 * Testée par src/shared/mod-autowin.test.ts. Demande utilisateur conv-58 (2026-10-02), points 1 à 3.
 */

/** Marqueur qui laisse une commande s'ouvrir sur l'ÉCRAN RÉEL : l'utilisateur l'a demandé nommément. */
export const MARQUEUR_ECRAN = 'ecran-utilisateur'

const GRAPHIQUES =
  /^(robloxstudio\w*|robloxplayer\w*|notepad|mspaint|calc|charmap|wordpad|winword|excel|powerpnt|outlook|msedge|chrome|firefox|brave|code|devenv|unity|unityhub|blender|godot\w*|obs64|spotify)(\.exe)?$/i

/** Découpe une ligne en mots, guillemets respectés. `undefined` si guillemet non fermé. */
function mots(ligne) {
  const r = []
  let mot = ''
  let ouvert = false
  let q = null
  for (const ch of ligne) {
    if (q) {
      if (ch === q) q = null
      else mot += ch
    } else if (ch === '"' || ch === "'") {
      q = ch
      ouvert = true
    } else if (/\s/.test(ch)) {
      if (ouvert) r.push(mot)
      mot = ''
      ouvert = false
    } else {
      mot += ch
      ouvert = true
    }
  }
  if (q) return undefined
  if (ouvert) r.push(mot)
  return r
}

const ps = (v) => `'${String(v).replace(/'/g, "''")}'`

/**
 * POINT 1 — REDIRIGER, NE PLUS REFUSER. Une commande SIMPLE qui ouvrirait une fenêtre graphique sur
 * l'écran de l'utilisateur est réécrite pour s'ouvrir dans le bureau caché (scripts/hdesk-lancer.ps1).
 * L'ancien blocage avait été retiré le 2026-09-17 (conv-631) parce qu'il ne laissait AUCUNE issue :
 * ici, le marqueur `# ecran-utilisateur` garde la voie de l'écran réel quand c'est lui qui la demande.
 *
 * Portée volontairement étroite : une seule commande (pas de ; && | ni saut de ligne), programme
 * reconnu. Tout le reste passe INTACT — pas de refus, pas de réécriture risquée.
 *
 * @returns la commande réécrite, ou `undefined` pour laisser passer telle quelle.
 */
export function redirigerVersBureauCache(commande, { conversation, scriptLanceur }) {
  // L'opérateur d'appel PowerShell `& "chemin.exe"` en tête n'est pas un enchaînement.
  const c = String(commande ?? '').trim().replace(/^&\s+/, '')
  if (!c || !conversation || !scriptLanceur) return undefined
  if (c.includes(MARQUEUR_ECRAN)) return undefined
  if (/hdesk-|autowin-headless|avec-instance-headless|-windowstyle\s+hidden|-nonewwindow/i.test(c)) return undefined
  if (/[;|&\r\n`]|\$\(/.test(c)) return undefined
  const m = mots(c)
  if (!m || m.length === 0) return undefined
  let exe
  let args = []
  const tete = m[0].toLowerCase()
  if (tete === 'start-process' || tete === 'saps') {
    // Start-Process [-FilePath] <exe> [-ArgumentList <args>] — toute autre option : on ne touche pas.
    let i = 1
    while (i < m.length) {
      const o = m[i].toLowerCase()
      if (o === '-filepath') exe = m[++i]
      else if (o === '-argumentlist') args.push(...(m[++i] ?? '').split(',').map((a) => a.trim()).filter(Boolean))
      else if (o.startsWith('-')) return undefined
      else if (!exe) exe = m[i]
      else return undefined
      i++
    }
  } else {
    exe = m[0]
    args = m.slice(1)
  }
  if (!exe) return undefined
  const base = exe.split(/[\\/]/).pop() ?? ''
  const installee = /\.exe$/i.test(exe) && /program files|appdata[\\/]local[\\/]programs/i.test(exe)
  if (!GRAPHIQUES.test(base) && !installee) return undefined
  const id = `chat-${String(conversation).replace(/[^A-Za-z0-9_-]/g, '')}`
  const executable = /[\\/]/.test(exe) ? ps(exe) : `(Get-Command ${ps(exe)} -ErrorAction Stop).Source`
  const interne =
    `& ${ps(scriptLanceur)} -Id ${ps(id)} -Executable ${executable}` +
    (args.length ? ` -Arguments ${ps(args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '))}` : '') +
    ` -Travail ${ps(`lancement redirige : ${base}`)} -Conversation ${ps(conversation)}`
  return `powershell -NoProfile -Command "${interne.replace(/"/g, '\\"')}"`
}

/**
 * POINTS 2 ET 3 — CE QUE LE MODÈLE LIT DES OUTILS TERMINAL.
 *
 * 2. Contradiction MESURÉE : la description de Claude Code dit qu'une tâche `run_in_background`
 *    « continue entre les tours et te relance ». Dans Autowin chaque tour est une session `-p`
 *    distincte : la tâche est arrêtée à la fin du tour et son résultat ne revient jamais
 *    (src/main/providers/claude.ts, avis « Tâche de fond arrêtée à la fin de ce tour » ; vécu conv-9, conv-54).
 * 3. La règle du bureau caché est posée là où elle sert — dans la description de l'outil — avec le
 *    marqueur de sortie vers l'écran réel.
 */
export function descriptionOutilTerminal(description) {
  const d = String(description ?? '')
  const corrige = d.replace(
    /it keeps running across turns and re-invokes you when it exits\./,
    'in Autowin OS it is STOPPED when the current turn ends and its result never comes back (see below).'
  )
  return (
    corrige +
    `\n\nAutowin OS — rules for this tool:\n` +
    `- Background tasks do NOT survive the end of your turn here: each turn is a separate session. ` +
    `For work longer than the turn, wait for it in the foreground (timeout up to 600000 ms), or start a ` +
    `fully detached process that writes to a log file, and say so in your answer.\n` +
    `- A graphical app (notepad, a browser, Code, Roblox Studio, an installed .exe…) opens in a HIDDEN desktop, ` +
    `never on the user's screen: a simple launch is automatically rewritten to scripts/hdesk-lancer.ps1, ` +
    `then capture it with scripts/hdesk-observe.ps1. Only when the user explicitly asked to see it on HIS ` +
    `screen, append the comment \`# ${MARQUEUR_ECRAN}\` to the command to keep it on the real screen.\n` +
    `- Never stop Electron or node by NAME (taskkill /IM, Stop-Process -Name): that kills Autowin itself. Target a PID you started.`
  )
}
