/**
 * RÈGLES PURES DES MODS D'AUTOWIN — aucune dépendance au CLI, testables seules.
 *
 * Trois usages, choisis dans conv-58 (« fais le 1 2 3 ») :
 *  1. une app graphique lancée par un run est REDIRIGÉE vers son bureau caché au lieu de s'ouvrir
 *     sur l'écran de l'utilisateur ;
 *  2. le compte à rebours `<total_tokens>… tokens left</total_tokens>` que Claude Code glisse à
 *     chaque requête est retiré : il contredit la règle de l'utilisateur « pas de budget, on récupère
 *     le nécessaire » (src/main/orchestrator.ts, src/main/brain-protocol.ts) ;
 *  3. la règle du bureau caché est écrite DANS la description de l'outil shell, là où elle sert.
 *
 * Pourquoi rediriger et pas refuser : le refus déterministe a été RETIRÉ le 2026-09-17 à la demande
 * de l'utilisateur (conv-631, src/shared/garde-git-destructeur.ts) parce qu'il ne laissait aucune
 * issue. D'où trois portes de sortie ici : hors d'un run (pas d'identifiant de bureau) rien ne
 * change ; la marque `# ecran-utilisateur` laisse passer une ouverture voulue sur l'écran réel ; et
 * une commande déjà passée par le lanceur n'est jamais touchée.
 *
 * La détection reprend celle de l'ancien garde (git show 03c78e56:src/shared/garde-lancement-graphique.ts).
 */

/** Marque qui laisse partir une ouverture VOULUE sur l'écran de l'utilisateur. */
export const MARQUE_ECRAN_UTILISATEUR = '# ecran-utilisateur'

const GRAPHIQUES =
  /^(robloxstudio\w*|robloxplayer\w*|notepad|mspaint|calc|charmap|wordpad|winword|excel|powerpnt|outlook|msedge|chrome|firefox|brave|code|devenv|unity|unityhub|blender|godot\w*|obs64|spotify|teams|ms-teams)(\.exe)?$/i

/** Le corps d'un heredoc est du texte, pas des commandes (faux positif conv-597). */
function sansHeredocs(commande) {
  return commande.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
    '<<HEREDOC'
  )
}

/** Lit un jeton en tête : "…", '…' ou un mot. Rend [valeur, reste]. */
function jeton(texte) {
  const m = texte.match(/^\s*(?:"([^"]*)"|'([^']*)'|(\S+))/)
  if (!m) return ['', '']
  return [m[1] ?? m[2] ?? m[3] ?? '', texte.slice(m[0].length)]
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 de l'UTF-16LE (format de -EncodedCommand), sans Buffer : le module d'un mod n'est pas forcément Node. */
function base64Utf16le(texte) {
  const o = []
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i)
    o.push(c & 0xff, c >> 8)
  }
  let r = ''
  for (let i = 0; i < o.length; i += 3) {
    const n = (o[i] << 16) | ((o[i + 1] ?? 0) << 8) | (o[i + 2] ?? 0)
    r += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
    r += i + 1 < o.length ? ALPHABET[(n >> 6) & 63] : '='
    r += i + 2 < o.length ? ALPHABET[n & 63] : '='
  }
  return r
}

function depuisBase64Utf16le(b64) {
  const o = []
  const propre = b64.replace(/=+$/, '')
  for (let i = 0; i < propre.length; i += 4) {
    const n = [0, 1, 2, 3].reduce(
      (acc, k) => (acc << 6) | Math.max(0, ALPHABET.indexOf(propre[i + k] ?? 'A')),
      0
    )
    o.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const octets = o.slice(0, Math.floor((propre.length * 6) / 8))
  let r = ''
  for (let i = 0; i + 1 < octets.length; i += 2)
    r += String.fromCharCode(octets[i] | (octets[i + 1] << 8))
  return r
}

/** Littéral PowerShell entre apostrophes. */
function litteralPs(v) {
  return "'" + String(v).split("'").join("''") + "'"
}

/**
 * Lit UN morceau de commande. Rend :
 *  - `{ exe, args }` pour un lancement redirigeable ;
 *  - `{ refus }` pour un lancement qui ouvre une fenêtre sans programme à rediriger ;
 *  - `undefined` sinon.
 */
function lireLancement(segment) {
  let seg = segment.trim().replace(/^&\s*/, '')
  const affectation = /^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s*/
  while (affectation.test(seg)) seg = seg.replace(affectation, '')
  if (!seg) return undefined

  if (/^(start-process|saps)\b/i.test(seg)) {
    if (/-windowstyle\s+hidden|-nonewwindow/i.test(seg)) return undefined
    let reste = seg.replace(/^(start-process|saps)\b/i, '').replace(/^\s*-filepath\b/i, '')
    const [exe, apres] = jeton(reste)
    if (!exe || exe.startsWith('-')) return undefined
    reste = apres
    let args = ''
    const ma = reste.match(/-(?:argumentlist|args)\s+/i)
    if (ma) {
      const [a] = jeton(reste.slice((ma.index ?? 0) + ma[0].length))
      args = a
    } else {
      // Deuxième jeton positionnel = ArgumentList.
      const [a] = jeton(reste)
      if (a && !a.startsWith('-')) args = a
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(exe) && !/^[a-z]:[\\/]/i.test(exe)) {
      return { refus: `ouverture d'une adresse (${exe})` }
    }
    return { exe, args }
  }
  if (/^(invoke-item|ii)\s/i.test(seg)) return { refus: 'Invoke-Item' }
  if (/^(cmd(\.exe)?\s+\/c\s+)?start\s+("|[a-z]:|\/)/i.test(seg)) return { refus: 'start' }
  if (/^explorer(\.exe)?\s+\S/i.test(seg)) return { refus: 'explorer' }

  const [programme, args] = jeton(seg)
  const chemin = programme.split('/').join('\\')
  const base = chemin.split('\\').pop() ?? ''
  if (GRAPHIQUES.test(base)) return { exe: programme, args: args.trim() }
  if (/\.exe$/i.test(chemin) && /program files|appdata\\local\\programs/i.test(chemin)) {
    return { exe: programme, args: args.trim() }
  }
  return undefined
}

/**
 * La commande de remplacement : un `powershell -EncodedCommand`, identique quel que soit le shell
 * de l'outil (PowerShell ou Bash) — aucun guillemet à échapper d'un shell à l'autre. Le script
 * encodé résout un nom nu (`notepad`) en chemin complet : hdesk-lancer.ps1 exige un fichier.
 */
export function commandeBureauCache({ exe, args, idBureau, lanceur, travail }) {
  const script =
    `$e = ${litteralPs(exe)}; ` +
    `if (-not (Test-Path -LiteralPath $e -PathType Leaf)) { $e = (Get-Command $e -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }; ` +
    `& ${litteralPs(lanceur)} -Id ${litteralPs(idBureau)} -Executable $e` +
    (args ? ` -Arguments ${litteralPs(args)}` : '') +
    ` -Travail ${litteralPs(travail)}`
  const b64 = base64Utf16le(script)
  return `powershell -NoProfile -EncodedCommand ${b64}`
}

/** Décode une commande rendue par `commandeBureauCache` (tests, journal). */
export function decoderCommande(commande) {
  const m = String(commande).match(/-EncodedCommand\s+(\S+)/)
  return m ? depuisBase64Utf16le(m[1]) : ''
}

/**
 * Décision du mod 1 pour UNE commande shell.
 * @returns {{ action: 'laisser' } | { action: 'reecrire', commande: string } | { action: 'refuser', motif: string }}
 */
export function redirigerLancementGraphique(commande, { idBureau, lanceur } = {}) {
  const texte = typeof commande === 'string' ? commande : ''
  if (!texte.trim()) return { action: 'laisser' }
  // Hors d'un run : aucune règle nouvelle (conv-631).
  if (!idBureau || !/^[a-zA-Z0-9_-]+$/.test(idBureau) || !lanceur) return { action: 'laisser' }
  if (texte.includes(MARQUE_ECRAN_UTILISATEUR)) return { action: 'laisser' }
  if (
    /hdesk-lancer\.ps1|autowin-headless\.ps1|avec-instance-headless\.mjs|hors-ecran-capture\.ps1/i.test(
      texte
    )
  ) {
    return { action: 'laisser' }
  }
  const lisible = sansHeredocs(texte)
  let resultat = texte
  let change = false
  for (const brut of lisible.split(/;|&&|\|\||\||\r?\n/)) {
    const lu = lireLancement(brut)
    if (!lu) continue
    if (lu.refus) {
      return {
        action: 'refuser',
        motif:
          `Ouverture au premier plan non redirigée (${lu.refus}) : elle s'afficherait sur l'écran de l'utilisateur et je ne sais pas quel programme lancer. ` +
          `Lance le programme toi-même dans ton bureau caché : powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id ${idBureau} -Executable "<chemin.exe>" -Arguments "<fichier>" -Travail "<ce que tu fais>". ` +
          `Si l'utilisateur a demandé nommément de l'ouvrir sur SON écran, ajoute la marque ${MARQUE_ECRAN_UTILISATEUR} en fin de commande.`
      }
    }
    const morceau = brut.trim()
    const travail = `Redirigé par le mod Autowin : ${morceau}`.slice(0, 200)
    const remplacement = commandeBureauCache({
      exe: lu.exe,
      args: lu.args,
      idBureau,
      lanceur,
      travail
    })
    const i = resultat.indexOf(morceau)
    if (i < 0) continue
    resultat = resultat.slice(0, i) + remplacement + resultat.slice(i + morceau.length)
    change = true
  }
  return change ? { action: 'reecrire', commande: resultat } : { action: 'laisser' }
}

/* ---------------------------------------------------------------- mod 2 */

/** Types de rappels automatiques retirés, avec la raison. Stable : même réponse à chaque requête. */
export const RAPPELS_RETIRES = Object.freeze({
  // « <total_tokens>14974989 tokens left</total_tokens> » à chaque requête (mesuré le 2026-10-02) :
  // un compte à rebours pousse à économiser, contre « pas de budget, on récupère le nécessaire ».
  total_tokens_reminder: 'pas de budget (règle utilisateur du 2026-09-27)'
})

export function rappelRetire(type) {
  return Object.prototype.hasOwnProperty.call(RAPPELS_RETIRES, type)
}

/* ---------------------------------------------------------------- mod 3 */

export const REGLE_BUREAU_CACHE =
  "\n\nAutowin — application graphique : ne l'ouvre JAMAIS sur l'écran de l'utilisateur. " +
  'Lance-la dans ton bureau caché : powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id <ton bureau> -Executable "<chemin.exe>" -Arguments "<args>" -Travail "<ce que tu fais>", ' +
  'puis capture avec scripts/hdesk-observe.ps1 -InstanceId <ton bureau> -Output <png>. ' +
  'Dans un run, un lancement direct (Start-Process, notepad, chrome…) est réécrit vers ce bureau automatiquement. ' +
  `Ouverture demandée nommément sur l'écran de l'utilisateur : ajoute ${MARQUE_ECRAN_UTILISATEUR} en fin de commande.`

/** Description complétée UNE fois : un second passage rend le même texte (cache stable). */
export function descriptionAvecRegle(description) {
  const d = typeof description === 'string' ? description : ''
  if (d.includes(REGLE_BUREAU_CACHE.trim())) return d
  return d + REGLE_BUREAU_CACHE
}
