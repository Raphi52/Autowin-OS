/**
 * GARDE : UNE CLÉ DU COFFRE SE SERT PAR SON NOM, ELLE NE S'AFFICHE NI NE S'ÉCRIT.
 *
 * Pourquoi : l'agent reçoit les clés du coffre en variables d'environnement (`envDuCoffre`,
 * src/main/providers/cles-du-coffre.ts) pour s'en SERVIR dans ses commandes. Une commande qui affiche
 * la valeur (`echo $NOM`, `printenv`, `Get-ChildItem env:`) la fait entrer dans le contexte du modèle,
 * dans la sortie du CLI et dans le fil ; un Write/Edit qui la recopie la laisse dans un fichier du
 * dépôt. La consigne le dit en prose ; ce refus le tient avant que l'outil parte, et dit quoi faire.
 *
 * Ce qui reste LIBRE, parce que c'est le but : la clé passée à une commande (`curl -H "Authorization:
 * Bearer $NOM"`, `$env:NOM` en argument, `echo $NOM | gh auth login --with-token`), sa longueur, son
 * nom dans un fichier (`process.env.NOM`), et tout ce qui se passe sans clé injectée.
 *
 * Les noms surveillés sont ceux d'`AUTOWIN_COFFRE_NOMS`, posé avec les clés ; les valeurs se relisent
 * dans l'environnement du hook, celui de l'agent, jamais ailleurs. Une valeur de moins de 8 caractères
 * n'est pas cherchée : c'est le seuil du masquage du coffre (`LONGUEUR_MIN_MASQUAGE`), en dessous on
 * refuserait du texte ordinaire.
 *
 * Lecture « comme un shell », volontairement simple : segments (`;`, `&&`, `||`, `&`, retour à la
 * ligne), tubes, mots entre guichets, `bash -c` / `powershell -Command` / `cmd /c` relus dedans. Une
 * valeur n'est « affichée » que si la sortie de la commande finit à l'écran ou dans un fichier : un
 * tube vers une commande qui la CONSOMME (curl, gh) laisse passer, un tube vers un filtre (grep, tee,
 * Format-Table) non. Ce n'est pas une barrière contre un agent qui voudrait contourner (python -c,
 * node -e) : la sortie du CLI est de toute façon masquée à son entrée dans Autowin.
 *
 * CONTRAINTE : fonction AUTOPORTÉE (aucun import, aucune constante extérieure) — sérialisée telle
 * quelle dans le script de hook du CLI (`scriptHookGardes`). Elle ne lève JAMAIS : le hook est en
 * échec fermé, une exception refuserait toutes les commandes de l'agent.
 */
export function refusSecretDuCoffre(
  outil: string,
  entree: unknown,
  shell: string,
  env: Record<string, string | undefined>
): string | undefined {
  try {
    const noms = String((env && env.AUTOWIN_COFFRE_NOMS) || '')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
    if (noms.length === 0) return undefined
    const voie = (nom: string): string =>
      `utilise $${nom} dans ta commande, n'affiche pas sa valeur (en PowerShell : $env:${nom}).`
    const t = (entree && typeof entree === 'object' ? entree : {}) as Record<string, unknown>

    // (a) Écriture d'un fichier : le contenu NEUF ne porte aucune valeur du coffre.
    if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(String(outil || ''))) {
      const ecrits: string[] = []
      for (const v of [t.content, t.new_string, t.new_source])
        if (typeof v === 'string') ecrits.push(v)
      if (Array.isArray(t.edits)) {
        for (const e of t.edits) {
          const neuf =
            e && typeof e === 'object' ? (e as Record<string, unknown>).new_string : undefined
          if (typeof neuf === 'string') ecrits.push(neuf)
        }
      }
      for (const nom of noms) {
        const valeur = env[nom]
        if (typeof valeur !== 'string' || valeur.length < 8) continue
        if (!ecrits.some((x) => x.includes(valeur))) continue
        const fichier = String(t.file_path || t.notebook_path || 'ce fichier')
        return (
          `Écriture refusée : le contenu destiné à ${fichier} contient la valeur de ${nom}, une clé du ` +
          `coffre d'Autowin. Une valeur de clé ne s'écrit dans aucun fichier : le code la lit dans ` +
          `l'environnement quand il tourne (process.env.${nom}, os.environ["${nom}"], $env:${nom}). ` +
          `Pour t'en servir, ${voie(nom)}`
        )
      }
      return undefined
    }

    const texte = String(shell || '')
    if (!texte.trim()) return undefined
    const alt = noms.join('|')
    // Une référence que le shell REMPLACE par la valeur. Entre apostrophes, rien n'est remplacé
    // (bash comme PowerShell) ; `.Length` et `${#NOM}` ne rendent que la longueur.
    const reRef = new RegExp(
      `\\$\\{?(?:env:)?(${alt})(?![A-Za-z0-9_])|%(${alt})%|GetEnvironmentVariable\\(\\s*['"](${alt})['"]`,
      'i'
    )
    const referenceDans = (code: string): string | undefined => {
      const net = code
        .replace(/GetEnvironmentVariable\(\s*'([A-Za-z0-9_]+)'/gi, 'GetEnvironmentVariable("$1"')
        .replace(/'[^']*'/g, "''")
        .replace(/(\$\{?(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}?)\.length\b/gi, 'LONGUEUR')
      const m = net.match(reRef)
      if (!m) return undefined
      const trouve = m[1] || m[2] || m[3] || ''
      return noms.find((n) => n.toUpperCase() === trouve.toUpperCase())
    }
    const estNomDuCoffre = (mot: string): string | undefined =>
      noms.find((n) => n.toUpperCase() === mot.toUpperCase())

    const refusValeur = (nom: string): string =>
      `Commande refusée : elle afficherait la valeur de ${nom}, une clé du coffre d'Autowin, dans ` +
      `ta sortie et dans le fil — ${voie(nom)} La commande s'en sert sans que personne la voie.`
    const refusTout = (): string =>
      `Commande refusée : elle afficherait tout l'environnement, où vivent les clés du coffre ` +
      `d'Autowin (${noms.join(', ')}). Lis seulement la variable dont tu as besoin (printenv PATH, ` +
      `$env:PATH) ; pour une clé, utilise $NOM dans ta commande, n'affiche pas sa valeur.`

    // Découpe en pipelines de commandes, hors guillemets.
    const pipelines = (code: string): string[][] => {
      const sortie: string[][] = []
      let courant: string[] = []
      let mot = ''
      let q = ''
      const finCommande = (): void => {
        courant.push(mot)
        mot = ''
      }
      const finPipeline = (): void => {
        finCommande()
        sortie.push(courant)
        courant = []
      }
      for (let i = 0; i < code.length; i++) {
        const c = code[i]
        if (q) {
          if (c === '\\' && q === '"' && i + 1 < code.length) {
            mot += c + code[++i]
            continue
          }
          if (c === q) q = ''
          mot += c
          continue
        }
        if (c === '"' || c === "'") {
          q = c
          mot += c
          continue
        }
        if (c === '\\' && i + 1 < code.length && code[i + 1] !== '\n') {
          mot += c + code[++i]
          continue
        }
        const suivant = code[i + 1]
        if (c === '\n' || c === ';') {
          finPipeline()
          continue
        }
        if ((c === '&' && suivant === '&') || (c === '|' && suivant === '|')) {
          i++
          finPipeline()
          continue
        }
        if (c === '|') {
          finCommande()
          continue
        }
        // `&` seul sépare (tâche de fond bash), sauf `2>&1`, `&>` et l'opérateur d'appel PowerShell.
        if (c === '&' && code[i - 1] !== '>' && suivant !== '>' && mot.trim()) {
          finPipeline()
          continue
        }
        mot += c
      }
      finPipeline()
      return sortie.map((p) => p.map((x) => x.trim())).filter((p) => p.some(Boolean))
    }

    const motsDe = (commande: string): string[] => {
      const mots: string[] = []
      const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(commande)))
        mots.push(m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, '$1') : (m[2] ?? m[3] ?? ''))
      return mots
    }
    const debut = (commande: string): string => commande.replace(/^[\s({&]+/, '')
    const nomDe = (mot: string): string =>
      String(mot || '')
        .split(/[\\/]/)
        .pop()!
        .toLowerCase()
        .replace(/\.exe$/, '')

    const AFFICHEURS = new Set([
      'echo',
      'printf',
      'print',
      'write',
      'write-output',
      'write-host',
      'write-information',
      'write-warning',
      'write-error',
      'write-verbose',
      'write-debug',
      'out-host'
    ])
    // Ce qui, au bout d'un tube, laisse la valeur à l'écran (ou dans un fichier).
    const FILTRES = new Set([
      'cat',
      'tee',
      'tee-object',
      'head',
      'tail',
      'more',
      'less',
      'sort',
      'sort-object',
      'uniq',
      'grep',
      'egrep',
      'fgrep',
      'rg',
      'findstr',
      'select-string',
      'sls',
      'cut',
      'awk',
      'sed',
      'tr',
      'column',
      'nl',
      'base64',
      'xxd',
      'od',
      'out-host',
      'out-string',
      'out-default',
      'oh',
      'write-output',
      'write-host',
      'format-table',
      'format-list',
      'format-wide',
      'ft',
      'fl',
      'fw',
      'select-object',
      'select',
      'where-object',
      'where',
      '?',
      'foreach-object',
      '%'
    ])
    const LECTEURS_PS = new Set([
      'get-childitem',
      'gci',
      'ls',
      'dir',
      'get-item',
      'gi',
      'get-content',
      'gc',
      'cat',
      'type',
      'get-itemproperty',
      'gp',
      'get-itempropertyvalue',
      'gpv'
    ])
    const reEnvTout = /^env:[\\/]?$|^env:.*\*/i
    const reEnvNom = new RegExp(`^env:[\\\\/]?(${alt})$`, 'i')

    const analyser = (code: string, profondeur: number): string | undefined => {
      if (profondeur > 3) return undefined
      for (const pipeline of pipelines(code)) {
        for (let i = 0; i < pipeline.length; i++) {
          const commande = debut(pipeline[i])
          if (!commande) continue
          // Sortie à l'écran ou dans un fichier : rien après, ou seulement des filtres.
          const affichee = pipeline
            .slice(i + 1)
            .every((suite) => FILTRES.has(nomDe(motsDe(debut(suite))[0] || '')))
          if (!affichee) continue
          let mots = motsDe(commande)
          while (mots.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(mots[0])) mots = mots.slice(1)
          const f = nomDe(mots[0] || '')
          const args = mots.slice(1)

          // Shells imbriqués : leur script est relu comme une commande.
          if (/^(bash|sh|zsh|dash|ksh)$/.test(f)) {
            const k = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
            if (k >= 0 && args[k + 1]) {
              const r = analyser(args[k + 1], profondeur + 1)
              if (r) return r
            }
          }
          if (f === 'powershell' || f === 'pwsh') {
            const k = args.findIndex((a) => /^-(c|co|com|comm|comma|comman|command)$/i.test(a))
            if (k >= 0 && args.length > k + 1) {
              const r = analyser(args.slice(k + 1).join(' '), profondeur + 1)
              if (r) return r
            }
          }
          if (f === 'cmd') {
            const k = args.findIndex((a) => /^\/[ck]$/i.test(a))
            if (k >= 0 && args.length > k + 1) {
              const r = analyser(args.slice(k + 1).join(' '), profondeur + 1)
              if (r) return r
            }
          }

          // Une valeur affichée par une commande d'affichage, ou par une expression seule en tête
          // (PowerShell rend la valeur d'une expression ; bash exécute la valeur et la cite en erreur).
          // Le PREMIER MOT seul compte : `& "C:\outil.exe" --token $env:NOM` passe la clé à l'outil.
          const ref = referenceDans(commande)
          if (ref && AFFICHEURS.has(f)) return refusValeur(ref)
          const premier = (commande.match(/^("(?:\\.|[^"\\])*"|'[^']*'|\S+)/) || [''])[0]
          const refEnTete = /^[$"'[]/.test(premier) ? referenceDans(premier) : undefined
          if (
            refEnTete &&
            !/^\s*[({]*\s*&/.test(pipeline[i]) &&
            !/^\$[\w:{}.]+\s*(?:[-+*/%]|\?\?)?=(?!=)/.test(commande)
          )
            return refusValeur(refEnTete)

          if (/^\[(system\.)?environment\]::getenvironmentvariables\s*\(/i.test(commande))
            return refusTout()
          if (args.some((a) => /^\/proc\/[^/\s]+\/environ$/.test(a))) return refusTout()
          if (LECTEURS_PS.has(f)) {
            const nom = args.map((a) => a.match(reEnvNom)).find(Boolean)
            if (nom) return refusValeur(estNomDuCoffre(nom[1]) || nom[1])
            if (args.some((a) => reEnvTout.test(a))) return refusTout()
          }
          if (f === 'printenv') {
            const operandes = args.filter((a) => !a.startsWith('-'))
            if (operandes.length === 0) return refusTout()
            const nom = operandes.map(estNomDuCoffre).find(Boolean)
            if (nom) return refusValeur(nom)
          }
          if (f === 'env') {
            let commandeLancee = false
            for (let k = 0; k < args.length; k++) {
              const a = args[k]
              if (/^(-u|-C|--unset|--chdir)$/.test(a)) {
                k++
                continue
              }
              if (/^(-S|--split-string)/.test(a)) {
                commandeLancee = true
                break
              }
              if (a.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue
              commandeLancee = true
              break
            }
            if (!commandeLancee) return refusTout()
          }
          if (f === 'set' && args.length === 0) return refusTout()
          // `export NOM` ne fait que marquer la variable ; seul `-p` (ou rien) affiche.
          if (f === 'export' || f === 'declare' || f === 'typeset') {
            const options = args.filter((a) => a.startsWith('-'))
            const nom = args.map(estNomDuCoffre).find(Boolean)
            if (nom && options.some((a) => /^-[a-z]*p/.test(a))) return refusValeur(nom)
            if (args.every((a) => /^-[px]+$/.test(a))) return refusTout()
          }
        }
      }
      return undefined
    }
    return analyser(texte, 0)
  } catch {
    return undefined
  }
}
