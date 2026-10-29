/**
 * TESTS DU TERMINAL (conv-1059, 2026-10-22) — lire, dans UNE ligne shell lancée par l'agent, les
 * tests qu'elle a joués et LEUR code de sortie. La carte du fil les compte ensuite comme preuve.
 *
 * Pourquoi un module à part, et pas `isVerificationCommand` (evidence-vocabulary.ts) : ce dernier
 * sert le contrôle des runs, qui veut savoir si un segment QUELCONQUE de la ligne vérifie quelque
 * chose (`node -e` et `npm run build` y comptent). Ici la question est plus étroite : le code de
 * sortie qu'on tient est-il celui d'un TEST ? Deux pièges, mesurés sur les tours de conv-1038 :
 *   - le code rendu est celui du DERNIER maillon : `false | cat` rend 0 dans le terminal de l'agent
 *     (constaté le 2026-10-22), donc `npx vitest run … | tail -20` ne prouve RIEN par son code ;
 *   - le motif dominant de l'agent est `npm run typecheck > log 2>&1; echo EXIT=$?` : le code rendu
 *     est celui d'`echo` (0), et le vrai n'existe que dans la SORTIE (`EXIT=2`).
 * Dans le doute, rien n'est rendu : une étape « sans preuve » est honnête, un faux vert ne l'est pas.
 *
 * conv-1221 (2026-10-28) : « dans le board ya bcp de trucs qui restent en mode à vérifier meme quand
 * claude a testé ». Mesure sur 6 jours de journaux : 251 tests lancés au terminal, 25 comptés ; 190
 * passaient par un tube. Deux ajouts, choisis par l'utilisateur :
 *   - lire le vrai code quand la SORTIE le montre : `echo "exit ${PIPESTATUS[0]}"` après un tube, ou
 *     le bilan de vitest resté visible (« Test Files 1 passed ») ;
 *   - PRÉVENIR l'agent, à côté du résultat de sa commande, qu'un test qu'il vient de lancer ne
 *     comptera pas (hook PostToolUse du CLI, `scriptHookTestsNonComptes`).
 */
import type { TestDuTerminal } from '../../shared/chat-turn'

export type TestLu = Pick<TestDuTerminal, 'commande' | 'codeDeSortie'>

/** Ce que la ligne a rendu : son code de sortie (`null` s'il est inconnu) et ce qu'elle a imprimé. */
export interface IssueDuTerminal {
  codeDeSortie: number | null
  sortie: string
}

export interface LecteurDeTests {
  testsDuTerminal(ligne: string, issue: IssueDuTerminal): TestLu[]
  testsNonComptes(ligne: string, issue: IssueDuTerminal): string[]
  avertissement(ligne: string, issue: IssueDuTerminal, enFond: boolean): string | undefined
  codeDeSortie(enErreur: boolean, texte: string): number | null
}

/**
 * Tout le lecteur dans UNE fonction AUTOPORTÉE : le hook du CLI la recopie par `.toString()` dans
 * son script (`scriptHookTestsNonComptes`), qui tourne dans un autre process, sans ce module. Rien
 * ici ne doit donc nommer quoi que ce soit hors de son corps (ni import, ni constante du module) :
 * un bundler peut renommer un nom de module, jamais un nom local à la fonction.
 */
export function lecteurDeTests(): LecteurDeTests {
  type Separateur = '&&' | '||' | ';' | '&' | '\n'

  /** Une chaîne de maillons reliés par `|`, et l'opérateur qui la suit. */
  interface Chaine {
    maillons: string[]
    apres: Separateur | null
  }

  /** Un test lu : sa place dans la ligne (chaîne, maillon), son libellé et son code. */
  interface Lu {
    rang: number
    maillon: number
    commande: string
    codeDeSortie: number
  }

  /**
   * Découpe la ligne au niveau SUPÉRIEUR seulement : un `|` ou un `;` entre guillemets, dans `$( … )`,
   * dans `( … )` ou entre accents graves n'est pas un opérateur de la ligne. `null` si la ligne n'est
   * pas lisible sûrement (guillemet non fermé, heredoc).
   */
  function decouper(ligne: string): Chaine[] | null {
    const chaines: Chaine[] = []
    let maillons: string[] = []
    let courant = ''
    let profondeur = 0
    let guillemet: '"' | "'" | '`' | null = null
    const couperMaillon = (): void => {
      maillons.push(courant.trim())
      courant = ''
    }
    const couperChaine = (apres: Separateur): void => {
      couperMaillon()
      const pleins = maillons.filter((maillon) => maillon !== '')
      if (pleins.length > 0) chaines.push({ maillons: pleins, apres })
      else if (chaines.length > 0) chaines[chaines.length - 1].apres = apres
      maillons = []
    }
    for (let i = 0; i < ligne.length; i += 1) {
      const c = ligne[i]
      const suivant = ligne[i + 1]
      if (guillemet) {
        courant += c
        if (c === '\\' && guillemet === '"' && suivant !== undefined) {
          courant += suivant
          i += 1
        } else if (c === guillemet) guillemet = null
        continue
      }
      if (c === '\\' && suivant !== undefined) {
        courant += c + suivant
        i += 1
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        guillemet = c
        courant += c
        continue
      }
      if (c === '(') profondeur += 1
      if (c === ')' && profondeur > 0) profondeur -= 1
      if (profondeur > 0) {
        courant += c
        continue
      }
      if (c === '<' && suivant === '<') return null
      if (c === '|' && suivant === '|') {
        couperChaine('||')
        i += 1
      } else if (c === '|') {
        couperMaillon()
        if (suivant === '&') i += 1
      } else if (c === '&' && suivant === '&') {
        couperChaine('&&')
        i += 1
      } else if (c === '&' && ligne[i - 1] !== '>' && ligne[i - 1] !== '<' && suivant !== '>') {
        couperChaine('&')
      } else if (c === ';' || c === '\n' || c === '\r') {
        if (c !== '\r') couperChaine(c === ';' ? ';' : '\n')
      } else courant += c
    }
    if (guillemet || profondeur > 0) return null
    couperMaillon()
    const pleins = maillons.filter((maillon) => maillon !== '')
    if (pleins.length > 0) chaines.push({ maillons: pleins, apres: null })
    return chaines
  }

  /** Les mots d'un maillon, guillemets et `$( … )` respectés (un mot garde ses guillemets). */
  function motsDe(maillon: string): string[] {
    const mots: string[] = []
    let courant = ''
    let profondeur = 0
    let guillemet: '"' | "'" | '`' | null = null
    for (let i = 0; i < maillon.length; i += 1) {
      const c = maillon[i]
      if (guillemet) {
        courant += c
        if (c === '\\' && guillemet === '"' && i + 1 < maillon.length) courant += maillon[++i]
        else if (c === guillemet) guillemet = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') guillemet = c
      if (c === '(') profondeur += 1
      if (c === ')' && profondeur > 0) profondeur -= 1
      if (/\s/u.test(c) && profondeur === 0) {
        if (courant) mots.push(courant)
        courant = ''
      } else courant += c
    }
    if (courant) mots.push(courant)
    return mots
  }

  /** Retire les redirections (`> f`, `2>&1`, `&>f`, `>/dev/null`, `< f`) : elles ne changent pas le test. */
  function sansRedirections(mots: string[]): string[] {
    const restants: string[] = []
    for (let i = 0; i < mots.length; i += 1) {
      const mot = mots[i]
      if (/^(?:\d*|&)>>?$|^\d*<$/u.test(mot)) {
        i += 1 // la cible est le mot suivant
        continue
      }
      if (/^(?:\d*|&)>>?.+|^\d*<.+/u.test(mot)) continue
      restants.push(mot)
    }
    return restants
  }

  const nu = (mot: string | undefined): string =>
    (mot ?? '')
      .replace(/^["']|["']$/gu, '')
      .toLowerCase()
      .replace(/^.*[\\/]/u, '')
      .replace(/\.(?:cmd|exe)$/u, '')

  /** Retire les lanceurs qui préfixent le vrai verbe : `timeout 540`, `env X=1`, `X=1`, `time`… */
  function sansLanceurs(mots: string[]): string[] {
    let reste = mots
    for (let tour = 0; tour < 6; tour += 1) {
      const verbe = nu(reste[0])
      if (/^[A-Za-z_][\w]*=/u.test(reste[0] ?? '')) reste = reste.slice(1)
      else if (['sudo', 'command', 'time', 'nice', 'exec'].includes(verbe)) reste = reste.slice(1)
      else if (verbe === 'env') {
        reste = reste.slice(1)
        while (reste[0] && (/^-/u.test(reste[0]) || /^[A-Za-z_]\w*=/u.test(reste[0])))
          reste = reste.slice(1)
      } else if (verbe === 'timeout') {
        reste = reste.slice(1)
        while (reste[0]?.startsWith('-')) {
          const option = reste[0]
          reste = reste.slice(1)
          if (/^(?:-s|-k|--signal|--kill-after)$/u.test(option)) reste = reste.slice(1)
        }
        reste = reste.slice(1) // la durée
      } else break
    }
    return reste
  }

  const SCRIPT_DE_TEST = /^(?:test|typecheck|lint|check)(?::[\w:-]+)?$/u
  const LANCEURS_DIRECTS = new Set(['vitest', 'jest', 'pytest', 'mocha', 'tsc', 'eslint', 'ctest'])

  /**
   * Le verbe lance-t-il un TEST, dont le code dit vert ou rouge ? Liste FERMÉE : un verbe inconnu ne
   * prouve rien. `npm run build` construit, `node -e` exécute n'importe quoi : ni l'un ni l'autre.
   */
  function lanceUnTest(mots: string[]): boolean {
    const verbe = nu(mots[0])
    const args = mots.slice(1).map(nu)
    if (LANCEURS_DIRECTS.has(verbe)) return true
    if (verbe === 'npm') {
      if (args[0] === 'test' || args[0] === 't') return true
      return (args[0] === 'run' || args[0] === 'run-script') && SCRIPT_DE_TEST.test(args[1] ?? '')
    }
    if (verbe === 'pnpm' || verbe === 'yarn' || verbe === 'bun') {
      if (verbe === 'bun' && args[0] === 'test') return true
      const script = args[0] === 'run' ? args[1] : args[0]
      return SCRIPT_DE_TEST.test(script ?? '')
    }
    if (verbe === 'npx') {
      const sansOptions = mots.slice(1).filter((mot) => !mot.startsWith('-'))
      const outil = nu(sansOptions[0])
      if (outil === 'playwright') return nu(sansOptions[1]) === 'test'
      return LANCEURS_DIRECTS.has(outil)
    }
    if (verbe === 'node') return args.includes('--test')
    if (/^(?:python3?|py)$/u.test(verbe))
      return args[0] === '-m' && (args[1] === 'pytest' || args[1] === 'unittest')
    if (['cargo', 'go', 'dotnet', 'deno'].includes(verbe)) return args[0] === 'test'
    return false
  }

  /** vitest lancé DIRECTEMENT : son bilan dit son code. `npm test` joue aussi typage et lint ici. */
  function estVitest(mots: string[]): boolean {
    const verbe = nu(mots[0])
    if (verbe === 'vitest') return true
    if (verbe !== 'npx') return false
    return nu(mots.slice(1).find((mot) => !mot.startsWith('-'))) === 'vitest'
  }

  const LIBELLE_MAX = 300

  const motsDuMaillon = (maillon: string | undefined): string[] =>
    sansLanceurs(sansRedirections(motsDe(maillon ?? '')))

  /** Le libellé du test si ce maillon en lance un, sinon null. */
  function testDuMaillon(maillon: string | undefined): string | null {
    const mots = motsDuMaillon(maillon)
    if (!lanceUnTest(mots)) return null
    return mots.join(' ').slice(0, LIBELLE_MAX)
  }

  /**
   * Un `echo …` qui suit immédiatement un test et imprime son code : `$?` (code du DERNIER maillon
   * de la chaîne précédente) ou `${PIPESTATUS[k]}` (code du maillon k, conv-1221). Rend le maillon
   * visé (`null` = le dernier) et le motif qui relit ce code dans la sortie. Refusé si le marqueur
   * n'y serait pas développé (apostrophes) ou si autre chose y est développé ou redirigé : on ne
   * saurait plus ce que la ligne imprimée contient.
   */
  function motifDEcho(
    maillon: string
  ): { cle: string; modele: RegExp; maillonVise: number | null } | null {
    const brut = /^echo\s+(.*)$/su.exec(maillon.trim())?.[1]
    if (brut === undefined || brut.startsWith('-')) return null
    if (/['`\\<>|]/u.test(brut)) return null
    const sansGuillemets = brut.replace(/"/gu, '')
    const marqueurs = [...sansGuillemets.matchAll(/\$\?|\$\{PIPESTATUS\[(\d+)\]\}/gu)]
    if (marqueurs.length !== 1) return null
    const marqueur = marqueurs[0]
    const avant = sansGuillemets.slice(0, marqueur.index).replace(/\s+/gu, ' ')
    const apres = sansGuillemets
      .slice((marqueur.index ?? 0) + marqueur[0].length)
      .replace(/\s+/gu, ' ')
    if (avant.includes('$') || apres.includes('$')) return null
    const echapper = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    return {
      cle: `${avant.trimStart()}${marqueur[0]}${apres.trimEnd()}`,
      modele: new RegExp(`^${echapper(avant.trimStart())}(\\d+)${echapper(apres.trimEnd())}$`, 'u'),
      maillonVise: marqueur[1] === undefined ? null : Number(marqueur[1])
    }
  }

  /**
   * Le code lu dans le BILAN de vitest (conv-1221), ou null. Rouge dès qu'un « failed » ou une ligne
   * « Errors » se lit, quel que soit le filtre. Vert seulement si rien n'a pu retirer une ligne du
   * bilan : après vitest, que des `tail`/`cat`/`tee` (ils gardent une fin CONTIGUË de la sortie), et
   * le bilan va jusqu'à « Duration ». Un `grep` qui ne garde que « Test Files|Tests » aurait aussi
   * retiré la ligne « Errors » d'un run rouge (vitest rend 1 sur une erreur hors test).
   */
  function codeDuBilanVitest(chaine: Chaine, sortie: string): number | null {
    // eslint-disable-next-line no-control-regex
    const lignes = sortie.replace(/\u001b\[[0-9;]*m/gu, '').split(/\r?\n/u)
    let debut = -1
    lignes.forEach((texte, rang) => {
      if (/^\s*Test Files\s/u.test(texte)) debut = rang
    })
    if (debut < 0) return null
    const bilan = lignes.slice(debut)
    const rouge = bilan.some(
      (texte) =>
        /^\s*(?:Test Files|Tests|Snapshots)\s.*\bfailed\b/u.test(texte) ||
        /^\s*(?:Type )?Errors\s+\d+/u.test(texte)
    )
    if (rouge) return 1
    const filtresSurs = chaine.maillons
      .slice(1)
      .every((maillon) => ['tail', 'cat', 'tee'].includes(nu(motsDuMaillon(maillon)[0])))
    const passe = /\bpassed\b/u.test(bilan[0])
    const entier = bilan.some((texte) => /^\s*Duration\s/u.test(texte))
    return filtresSurs && passe && entier ? 0 : null
  }

  /** Tous les tests lus dans la ligne, avec leur place. `null` si la ligne n'est pas lisible. */
  function lire(ligne: string, issue: IssueDuTerminal): { chaines: Chaine[]; lus: Lu[] } | null {
    const chaines = decouper(ligne)
    if (!chaines || chaines.length === 0) return null
    const lus: Lu[] = []
    const dejaLu = (rang: number, maillon: number): boolean =>
      lus.some((lu) => lu.rang === rang && lu.maillon === maillon)

    // 1. Les tests suivis d'un `echo …$?…` ou `echo …${PIPESTATUS[k]}…` : leur code est dans la sortie.
    const marques: Array<{
      rang: number
      maillon: number
      commande: string
      cle: string
      modele: RegExp
    }> = []
    chaines.forEach((chaine, rang) => {
      const suivante = chaines[rang + 1]
      if (!suivante || suivante.maillons.length !== 1) return
      const motif = motifDEcho(suivante.maillons[0])
      if (!motif) return
      const maillon = motif.maillonVise ?? chaine.maillons.length - 1
      const commande = testDuMaillon(chaine.maillons[maillon])
      if (commande) marques.push({ rang, maillon, commande, cle: motif.cle, modele: motif.modele })
    })
    const lignesImprimees = issue.sortie
      .split(/\r?\n/u)
      .map((texte) => texte.replace(/\s+/gu, ' ').trim())
    for (const cle of new Set(marques.map((marque) => marque.cle))) {
      const memeMotif = marques.filter((marque) => marque.cle === cle)
      const codes = lignesImprimees.flatMap((texte) => {
        const code = memeMotif[0].modele.exec(texte)?.[1]
        return code === undefined ? [] : [Number(code)]
      })
      // Un seul marqueur : sa DERNIÈRE impression (la sortie du test a pu imprimer la même chose
      // avant). Plusieurs : autant d'impressions que de marqueurs, sinon on ne sait plus qui est qui.
      const garder = (marque: (typeof marques)[number], code: number): void => {
        const { rang, maillon, commande } = marque
        lus.push({ rang, maillon, commande, codeDeSortie: code })
      }
      if (memeMotif.length === 1 && codes.length > 0) garder(memeMotif[0], codes[codes.length - 1])
      else if (memeMotif.length > 1 && codes.length === memeMotif.length)
        memeMotif.forEach((marque, k) => garder(marque, codes[k]))
    }

    // 2. Le test qui FINIT la ligne : son code est celui que l'outil a rendu. Pas après un `||`
    // (qui masque un échec ou saute le test), ni en fond (`&` : la main revient avant la fin).
    const rangFinal = chaines.length - 1
    const derniere = chaines[rangFinal]
    const masque = chaines.some((chaine) => chaine.apres === '||') || derniere.apres === '&'
    const maillonFinal = derniere.maillons.length - 1
    const commandeFinale = testDuMaillon(derniere.maillons[maillonFinal])
    if (
      issue.codeDeSortie !== null &&
      !masque &&
      commandeFinale &&
      !dejaLu(rangFinal, maillonFinal)
    )
      lus.push({
        rang: rangFinal,
        maillon: maillonFinal,
        commande: commandeFinale,
        codeDeSortie: issue.codeDeSortie
      })

    // 3. Le bilan de vitest resté visible (conv-1221) — si la ligne ne lance qu'UN vitest : avec
    // deux, on ne saurait plus à qui est le bilan.
    const vitests = chaines.flatMap((chaine, rang) =>
      chaine.maillons.some((maillon) => estVitest(motsDuMaillon(maillon))) ? [rang] : []
    )
    if (vitests.length === 1) {
      const rang = vitests[0]
      const chaine = chaines[rang]
      const commande = testDuMaillon(chaine.maillons[0])
      if (
        commande &&
        estVitest(motsDuMaillon(chaine.maillons[0])) &&
        chaine.apres !== '&' &&
        !dejaLu(rang, 0)
      ) {
        const code = codeDuBilanVitest(chaine, issue.sortie)
        if (code !== null) lus.push({ rang, maillon: 0, commande, codeDeSortie: code })
      }
    }

    return { chaines, lus: lus.sort((a, b) => a.rang - b.rang || a.maillon - b.maillon) }
  }

  function testsDuTerminal(ligne: string, issue: IssueDuTerminal): TestLu[] {
    return (lire(ligne, issue)?.lus ?? []).map(({ commande, codeDeSortie }) => ({
      commande,
      codeDeSortie
    }))
  }

  /**
   * Les tests que la ligne LANCE mais dont aucun code n'a pu être lu : ils ne compteront pas comme
   * preuve. Ligne illisible (heredoc, guillemet ouvert) : rien — on ne devine pas.
   */
  function testsNonComptes(ligne: string, issue: IssueDuTerminal): string[] {
    const lu = lire(ligne, issue)
    if (!lu) return []
    return lu.chaines.flatMap((chaine, rang) =>
      chaine.maillons.flatMap((maillon, k) => {
        const commande = testDuMaillon(maillon)
        const compte = lu.lus.some((test) => test.rang === rang && test.maillon === k)
        return commande && !compte ? [commande] : []
      })
    )
  }

  /** Le texte glissé à l'agent à côté du résultat de sa commande, ou rien. */
  function avertissement(
    ligne: string,
    issue: IssueDuTerminal,
    enFond: boolean
  ): string | undefined {
    const tests = enFond
      ? (decouper(ligne) ?? []).flatMap((chaine) =>
          chaine.maillons.flatMap((maillon) => {
            const commande = testDuMaillon(maillon)
            return commande ? [commande] : []
          })
        )
      : testsNonComptes(ligne, issue)
    if (tests.length === 0) return undefined
    const noms = [...new Set(tests)].map((commande) => `\`${commande}\``).join(', ')
    const raison = enFond
      ? 'lancé en fond, il rend la main avant sa fin'
      : 'le code rendu par la ligne n’est pas le sien (tube `|`, `||`, commande qui le suit) et la sortie ne le montre pas'
    return [
      `Autowin — ce test ne comptera PAS comme preuve sur le Board : ${noms}.`,
      `Raison : ${raison}. La demande restera « À vérifier ».`,
      'Pour qu’il compte : relance-le seul, sans `|` ni `||` ; ou par l’outil `verify` ; ou suivi de `; echo "exit ${PIPESTATUS[0]}"` s’il doit rester raccourci.'
    ].join('\n')
  }

  /**
   * Le code de sortie d'un résultat `Bash` du CLI Claude : sans erreur, la commande a rendu 0 ; en
   * erreur, le CLI ouvre le texte par « Exit code N » (constaté dans run-stdout/, 2026-10-22). Une
   * erreur sans ce préfixe (délai dépassé, refus) n'a pas de code : `null`.
   */
  function codeDeSortie(enErreur: boolean, texte: string): number | null {
    if (!enErreur) return 0
    const code = /^Exit code (\d+)/u.exec(texte.trimStart())?.[1]
    return code === undefined ? null : Number(code)
  }

  return { testsDuTerminal, testsNonComptes, avertissement, codeDeSortie }
}

const LECTEUR = lecteurDeTests()

/**
 * Les tests joués par `ligne` et leur code de sortie.
 *
 * `codeDeSortie` est celui que l'outil a rendu pour la ligne ENTIÈRE (`null` s'il est inconnu) ;
 * `sortie` est ce que la ligne a imprimé.
 */
export const testsDuTerminal = (ligne: string, issue: IssueDuTerminal): TestLu[] =>
  LECTEUR.testsDuTerminal(ligne, issue)

/** Les tests lancés par `ligne` dont le code reste illisible : ils ne compteront pas. */
export const testsNonComptes = (ligne: string, issue: IssueDuTerminal): string[] =>
  LECTEUR.testsNonComptes(ligne, issue)

/** L'avertissement donné à l'agent quand un test qu'il vient de lancer ne comptera pas. */
export const avertissementTestsNonComptes = (
  ligne: string,
  issue: IssueDuTerminal,
  enFond: boolean
): string | undefined => LECTEUR.avertissement(ligne, issue, enFond)

/** Le code de sortie d'un résultat `Bash` du CLI Claude (« Exit code N » en tête d'une erreur). */
export const codeDeSortieDuResultatClaude = (enErreur: boolean, texte: string): number | null =>
  LECTEUR.codeDeSortie(enErreur, texte)

/**
 * Le script du hook PostToolUse / PostToolUseFailure (outil Bash) des tours de CHAT : à côté du
 * résultat d'une commande, il dit à l'agent qu'un test qu'il vient de lancer ne comptera pas, avec
 * les façons de le faire compter. Champs d'entrée et de sortie : https://code.claude.com/docs/en/hooks
 * (`tool_response.stdout/stderr` sur succès, `error` « Exit code N » sur échec,
 * `hookSpecificOutput.additionalContext` rendu à l'agent à côté du résultat). Toute panne = aucun
 * avertissement, jamais un refus : la commande a déjà tourné.
 */
export function scriptHookTestsNonComptes(): string {
  return `const lecteur = (${lecteurDeTests.toString()})();
let d = '';
process.stdin.on('data', (b) => (d += b));
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d);
    if (!j || j.tool_name !== 'Bash') return;
    const t = j.tool_input || {};
    const ligne = String(t.command || '');
    const evenement = j.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse';
    let issue;
    if (evenement === 'PostToolUseFailure') {
      if (j.is_interrupt) return;
      const erreur = String(j.error || '');
      issue = { codeDeSortie: lecteur.codeDeSortie(true, erreur), sortie: erreur };
    } else {
      const r = j.tool_response || {};
      if (r.interrupted) return;
      const sortie = [r.stdout, r.stderr].filter((x) => typeof x === 'string' && x).join('\\n');
      issue = { codeDeSortie: 0, sortie };
    }
    const texte = lecteur.avertissement(ligne, issue, t.run_in_background === true);
    if (texte) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evenement, additionalContext: texte } }));
  } catch {}
});
`
}
