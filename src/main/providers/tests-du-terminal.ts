/**
 * TESTS DU TERMINAL (conv-1059, 2026-10-22) — lire, dans UNE ligne shell lancée par l'agent, les
 * tests qu'elle a joués et LEUR code de sortie. La carte du fil les compte ensuite comme preuve.
 *
 * Pourquoi un module à part, et pas `isVerificationCommand` (evidence-vocabulary.ts) : ce dernier
 * sert le contrôle des runs, qui veut savoir si un segment QUELCONQUE de la ligne vérifie quelque
 * chose (`node -e` et `npm run build` y comptent). Ici la question est plus étroite : le code de
 * sortie qu'on tient est-il celui d'un TEST ? Deux pièges, mesurés sur les tours de conv-1038 :
 *   - le code rendu est celui du DERNIER maillon : `false | cat` rend 0 dans le terminal de l'agent
 *     (constaté le 2026-10-22), donc `npx vitest run … | tail -20` ne prouve RIEN ;
 *   - le motif dominant de l'agent est `npm run typecheck > log 2>&1; echo EXIT=$?` : le code rendu
 *     est celui d'`echo` (0), et le vrai n'existe que dans la SORTIE (`EXIT=2`).
 * Dans le doute, rien n'est rendu : une étape « sans preuve » est honnête, un faux vert ne l'est pas.
 */
import type { TestDuTerminal } from '../../shared/chat-turn'

export type TestLu = Pick<TestDuTerminal, 'commande' | 'codeDeSortie'>

type Separateur = '&&' | '||' | ';' | '&' | '\n'

/** Une chaîne de maillons reliés par `|`, et l'opérateur qui la suit. */
interface Chaine {
  maillons: string[]
  apres: Separateur | null
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

const LIBELLE_MAX = 300

/** Le libellé du test si le DERNIER maillon de la chaîne en lance un (son code est le sien), sinon null. */
function testDeLaChaine(chaine: Chaine): string | null {
  const dernier = chaine.maillons.at(-1)
  if (!dernier) return null
  const mots = sansLanceurs(sansRedirections(motsDe(dernier)))
  if (!lanceUnTest(mots)) return null
  return mots.join(' ').slice(0, LIBELLE_MAX)
}

/**
 * Un `echo …$?…` qui suit immédiatement un test : `$?` y vaut le code de ce test. Rend le motif
 * qui relit ce code dans la sortie. Refusé si `$?` n'y serait pas développé (apostrophes) ou si
 * autre chose y est développé ou redirigé : on ne saurait plus ce que la ligne imprimée contient.
 */
function motifDEcho(maillon: string): { cle: string; modele: RegExp } | null {
  const brut = /^echo\s+(.*)$/su.exec(maillon.trim())?.[1]
  if (brut === undefined || brut.startsWith('-')) return null
  if (/['`\\<>|]/u.test(brut)) return null
  const morceaux = brut.replace(/"/gu, '').split('$?')
  if (morceaux.length !== 2 || morceaux.some((morceau) => morceau.includes('$'))) return null
  const [avant, apres] = morceaux.map((morceau) => morceau.replace(/\s+/gu, ' '))
  const echapper = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const cle = `${avant.trimStart()}$?${apres.trimEnd()}`
  return {
    cle,
    modele: new RegExp(`^${echapper(avant.trimStart())}(\\d+)${echapper(apres.trimEnd())}$`, 'u')
  }
}

/**
 * Les tests joués par `ligne` et leur code de sortie.
 *
 * `codeDeSortie` est celui que l'outil a rendu pour la ligne ENTIÈRE (`null` s'il est inconnu) ;
 * `sortie` est ce que la ligne a imprimé.
 */
export function testsDuTerminal(
  ligne: string,
  issue: { codeDeSortie: number | null; sortie: string }
): TestLu[] {
  const chaines = decouper(ligne)
  if (!chaines || chaines.length === 0) return []
  const lus: Array<TestLu & { rang: number }> = []

  // 1. Les tests suivis d'un `echo …$?…` : leur code est dans la sortie.
  const marques: Array<{ rang: number; commande: string; cle: string; modele: RegExp }> = []
  chaines.forEach((chaine, rang) => {
    const commande = testDeLaChaine(chaine)
    const suivante = chaines[rang + 1]
    if (!commande || !suivante || suivante.maillons.length !== 1) return
    const motif = motifDEcho(suivante.maillons[0])
    if (motif) marques.push({ rang, commande, ...motif })
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
    if (memeMotif.length === 1 && codes.length > 0)
      lus.push({ ...memeMotif[0], codeDeSortie: codes[codes.length - 1] })
    else if (memeMotif.length > 1 && codes.length === memeMotif.length)
      memeMotif.forEach((marque, k) => lus.push({ ...marque, codeDeSortie: codes[k] }))
  }

  // 2. Le test qui FINIT la ligne : son code est celui que l'outil a rendu. Pas après un `||`
  // (qui masque un échec ou saute le test), ni en fond (`&` : la main revient avant la fin).
  const derniere = chaines[chaines.length - 1]
  const masque = chaines.some((chaine) => chaine.apres === '||') || derniere.apres === '&'
  const commande = testDeLaChaine(derniere)
  if (issue.codeDeSortie !== null && !masque && commande)
    lus.push({ rang: chaines.length - 1, commande, codeDeSortie: issue.codeDeSortie })

  return lus
    .sort((a, b) => a.rang - b.rang)
    .map(({ commande: libelle, codeDeSortie }) => ({ commande: libelle, codeDeSortie }))
}

/**
 * Le code de sortie d'un résultat `Bash` du CLI Claude : sans erreur, la commande a rendu 0 ; en
 * erreur, le CLI ouvre le texte par « Exit code N » (constaté dans run-stdout/, 2026-10-22). Une
 * erreur sans ce préfixe (délai dépassé, refus) n'a pas de code : `null`.
 */
export function codeDeSortieDuResultatClaude(enErreur: boolean, texte: string): number | null {
  if (!enErreur) return 0
  const code = /^Exit code (\d+)/u.exec(texte.trimStart())?.[1]
  return code === undefined ? null : Number(code)
}
