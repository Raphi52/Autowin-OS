// fix-ok: cause mesurée — le hook PreToolUse (matcher Bash|PowerShell seul) ne vérifiait que git destructeur ; prod-niveau/autorite/passphrase.json passaient par Bash et Edit/Write (test rouge 3/4 : « Unexpected end of JSON input », « expected [Bash, PowerShell] to include Edit »).
/**
 * LA COMMANDE `run` FACE À LA PRODUCTION (évaluation conv-738, 2026-09-21).
 *
 * Deux failles, deux fonctions pures, appelées DANS `commands.ts` au moment de lancer :
 *   1. `refusReglageProd` — les fichiers de réglage de la protection (`prod-niveau.json`,
 *      `prod-autorite.json`, `prod-passphrase.json`) ne se touchent QUE par l'écran de réglages
 *      (IPC `prod:porte:niveau`, qui exige la phrase pour baisser la garde). Une commande `run` qui
 *      les nomme est refusée, quel que soit le niveau : sinon l'agent coupait la protection seul.
 *   2. `cibleSqlDeCommande` — un client SQL (sqlcmd, osql, bcp, Invoke-Sqlcmd) lancé par `run`
 *      vise une base : il doit passer par `PorteProd`, comme `sql_query`. Base introuvable dans la
 *      ligne → nom `inconnu`, que le classifieur traite comme de la production (refus par défaut).
 */

// AUTOPORTÉE (motif en ligne, aucune référence externe) : elle est aussi sérialisée dans le hook
// PreToolUse du CLI (`scriptHookGardes`), qui couvre le terminal et les outils Edit/Write de l'agent.
export function refusReglageProd(ligne: string): string | undefined {
  const m = /prod-(niveau|autorite|passphrase)\.json/i.exec(String(ligne ?? ''))
  if (!m) return undefined
  return (
    `la commande touche ${m[0]}, un réglage de la protection de production. ` +
    'Il ne se change que depuis l’écran de réglages, par l’utilisateur.'
  )
}

const CLIENT_SQL = /(?:^|[\s"'/(;&|])(sqlcmd|osql|bcp|invoke-sqlcmd)(?:\.exe)?(?=["'\s]|$)/i

export interface CibleSqlRun {
  client: string
  base: string
}

function valeurApres(jetons: string[], options: string[]): string | undefined {
  for (let i = 0; i < jetons.length - 1; i++) {
    if (options.includes(jetons[i].toLowerCase())) return jetons[i + 1]
  }
  return undefined
}

export function cibleSqlDeCommande(ligne: string): CibleSqlRun | undefined {
  // Même règle que le hook des agents : une simple MENTION d'un client SQL n'ouvre pas la porte prod.
  if (!refusSqlAgent(ligne, [])) return undefined
  const m = CLIENT_SQL.exec(ligne)
  if (!m) return undefined
  const client = m[1].toLowerCase()
  const reste = ligne.slice(m.index + m[0].length)
  const jetons = reste.match(/"[^"]*"|'[^']*'|\S+/g)?.map((j) => j.replace(/^["']|["']$/g, '')) ?? []
  let base = valeurApres(jetons, ['-d', '/d', '-database'])
  if (!base && client === 'bcp' && jetons[0] && !jetons[0].startsWith('-')) {
    const qualifie = jetons[0].split('.')
    if (qualifie.length >= 2) base = qualifie[0]
  }
  return { client, base: base?.replace(/^\[|\]$/g, '') || 'inconnu' }
}

/**
 * GARDE SQL DES AGENTS lancés par `orchestrate` (revue conv-738) : leur terminal ne passe ni par
 * `run` ni par `sql_query`, seul le hook PreToolUse du CLI le voit. Ce hook ne peut pas ouvrir la
 * fenêtre de confirmation : une base de production OU inconnue est donc refusée NET, et seules les
 * bases déclarées `non-prod` dans la liste d'autorité passent (refus par défaut, comme `classerCible`).
 * AUTOPORTÉE : sérialisée telle quelle dans le script du hook, aucune référence au module.
 */
export function refusSqlAgent(ligne: string, basesNonProd: readonly string[]): string | undefined {
  const texte = String(ligne ?? '')
  // Seul un APPEL est bloqué : le client en position de commande — début de ligne, après `;` `|` `&`
  // `&&` `(` `{`, ou dans `bash -c`, `cmd /c`, `powershell -c`, `$(…)`, `find -exec`. Avant (conv-770,
  // 2026-09-26), le motif valait pour TOUTE la ligne et bloquait `grep -n "<client>" fichier`, tout en
  // laissant passer un appel par chemin complet (`"C:\…\SQLCMD.EXE" …`). Dans le doute — guillemet non
  // fermé, code passé à un interpréteur (`node -e`, `python -c`), imbrication profonde —, l'ancien
  // motif s'applique : on bloque.
  const clients = ['sqlcmd', 'osql', 'bcp', 'invoke-sqlcmd']
  const partout = /(?:^|[\s"'/\\(;&|])(sqlcmd|osql|bcp|invoke-sqlcmd)(?:\.exe)?(?=["'\s]|$)/i
  const prefixes = /^(sudo|exec|env|time|nohup|command|builtin|call|start|start-process|xargs|timeout|nice)$/
  const optionAValeur = /^(-u|-g|-c|-s|-k|-i|--user|--group|--chdir|--signal|--kill-after)$/
  const coquilles = /^(bash|sh|zsh|dash|cmd|powershell|pwsh|eval|iex|invoke-expression)$/
  const interpretes = /^(node|nodejs|python[\d.]*|py|ruby|perl|php|deno|bun|tsx|ts-node)$/
  const nomDe = (mot: string): string =>
    (mot.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
  const decoupe = (s: string): string[] => s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  const depuisMotif = (code: string): { client: string; suite: string[] } | undefined => {
    const m = partout.exec(code)
    return m ? { client: m[1].toLowerCase(), suite: decoupe(code.slice(m.index + m[0].length)) } : undefined
  }
  const analyser = (
    mots: string[],
    profondeur: number
  ): { client: string; suite: string[] } | undefined => {
    let k = 0
    while (k < mots.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[k])) k++
    for (let tour = 0; tour < 8 && k < mots.length; tour++) {
      const nom = nomDe(mots[k])
      if (clients.includes(nom)) return { client: nom, suite: mots.slice(k + 1) }
      if (prefixes.test(nom)) {
        const chemin = mots.findIndex((m, i) => i > k && /^-filepath$/i.test(m))
        if (chemin > 0 && mots[chemin + 1]) {
          k = chemin + 1
          continue
        }
        k++
        while (k < mots.length) {
          const m = mots[k].toLowerCase()
          if (optionAValeur.test(m)) k += 2
          else if (m.startsWith('-') || /^\d+[smhd]?$/.test(m) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(m)) k++
          else break
        }
        continue
      }
      if (coquilles.test(nom)) {
        const reste = mots.slice(k + 1)
        const i = reste.findIndex((m) => /^(-c|-command|\/c|\/k)$/i.test(m))
        const code = (i >= 0 ? reste.slice(i + 1) : reste.filter((m) => !m.startsWith('-'))).join(' ')
        return code ? chercher(code, profondeur + 1) : undefined
      }
      if (interpretes.test(nom)) {
        const i = mots.findIndex((m, j) => j > k && /^(-e|-p|-c|-r|--eval|--print)$/i.test(m))
        return i > 0 ? depuisMotif(mots.slice(i + 1).join(' ')) : undefined
      }
      break
    }
    const e = mots.findIndex((m) => /^-(exec|execdir|ok|okdir)$/.test(m))
    if (e >= 0 && mots[e + 1] && clients.includes(nomDe(mots[e + 1])))
      return { client: nomDe(mots[e + 1]), suite: mots.slice(e + 2) }
    return undefined
  }
  function chercher(source: string, profondeur: number): { client: string; suite: string[] } | undefined {
    if (profondeur > 4) return depuisMotif(source)
    const commandes: string[][] = [[]]
    const imbriques: string[] = []
    let mot = ''
    let ouvert = false
    let q: string | null = null
    const finMot = (): void => {
      if (ouvert) commandes[commandes.length - 1].push(mot)
      mot = ''
      ouvert = false
    }
    for (let i = 0; i < source.length; i++) {
      const c = source[i]
      if (q === "'") {
        if (c === "'") q = null
        else mot += c
        continue
      }
      if (c === '$' && source[i + 1] === '(') {
        // Sous-commande `$(…)`, exécutée même entre guillemets doubles.
        let prof = 0
        let fin = -1
        for (let j = i + 1; j < source.length; j++) {
          if (source[j] === '(') prof++
          else if (source[j] === ')' && --prof === 0) {
            fin = j
            break
          }
        }
        if (fin < 0) return depuisMotif(source)
        imbriques.push(source.slice(i + 2, fin))
        i = fin
        ouvert = true
        continue
      }
      if (c === '`') {
        if (q === '"' && source[i + 1] === '"') {
          mot += '"'
          i++
          continue
        }
        const fin = source.indexOf('`', i + 1)
        if (fin > i) {
          imbriques.push(source.slice(i + 1, fin))
          i = fin
          ouvert = true
          continue
        }
      }
      if (q === '"') {
        if (c === '"') q = null
        else if (c === '\\' && source[i + 1] === '"') {
          mot += '"'
          i++
        } else mot += c
        continue
      }
      if (c === "'" || c === '"') {
        q = c
        ouvert = true
      } else if (c === ' ' || c === '\t') finMot()
      else if ('\r\n;|&(){}'.includes(c)) {
        finMot()
        commandes.push([])
      } else {
        mot += c
        ouvert = true
      }
    }
    if (q) return depuisMotif(source)
    finMot()
    for (const code of imbriques) {
      const appel = chercher(code, profondeur + 1)
      if (appel) return appel
    }
    for (const mots of commandes) {
      const appel = analyser(mots, profondeur)
      if (appel) return appel
    }
    return undefined
  }
  const appel = chercher(texte, 0)
  if (!appel) return undefined
  const client = appel.client
  const jetons = appel.suite.map((j) => j.replace(/^["']|["']$/g, ''))
  let base: string | undefined
  for (let i = 0; i < jetons.length - 1; i++) {
    if (['-d', '/d', '-database'].includes(jetons[i].toLowerCase())) {
      base = jetons[i + 1]
      break
    }
  }
  if (!base && client === 'bcp' && jetons[0] && !jetons[0].startsWith('-') && jetons[0].includes('.')) {
    base = jetons[0].split('.')[0]
  }
  const nom = (base ?? '').replace(/^\[|\]$/g, '').trim().toLowerCase()
  if (nom && basesNonProd.some((b) => String(b).trim().toLowerCase() === nom)) return undefined
  return (
    `${client} vers la base « ${nom || 'inconnue'} » refusé : elle n'est pas déclarée non-prod, ` +
    `donc traitée comme de la production. Un agent ne touche pas la prod depuis son terminal ; ` +
    `passe par sql_query (lecture seule, avec confirmation de l'utilisateur).`
  )
}
