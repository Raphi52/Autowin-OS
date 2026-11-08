#!/usr/bin/env node
/**
 * Quels COMMITS font refuser l'envoi vers un distant public, et à quelle ligne.
 *
 * Pourquoi : `scripts/separation-avant-push.mjs` refuse l'envoi en nommant des contenus (un chemin
 * et un identifiant d'objet), pas le commit qui les a introduits ni la ligne fautive. Pour réécrire
 * l'historique, il faut savoir quels commits corriger et où : sinon on devine, on en oublie un, et
 * l'envoi est refusé à nouveau après la réécriture. Mêmes règles (`fauteDeSeparation`), même
 * périmètre (ce que le distant n'a pas) ; le dossier `entreprise/` n'est pas relu, comme au push.
 *
 * Usage : node scripts/separation-commits-fautifs.mjs <distant> [<branche>]   (branche : HEAD)
 * Sortie : un bloc par commit fautif, du plus ancien au plus récent, avec le message et chaque
 * fichier qu'il ajoute ou modifie en faute, numéros de ligne compris.
 * Codes : 0 = aucun commit fautif ; 1 = au moins un ; 2 = vérification impossible.
 *
 * Mode --reecrire : node scripts/separation-commits-fautifs.mjs --reecrire <corrections.json>
 *                     <distant> <source> <cible>
 * Recopie l'historique de <source> que <distant> n'a pas sur une NOUVELLE branche <cible>, avec les
 * corrections du fichier. <source> n'est jamais modifiée et <cible> ne doit pas exister : la
 * réécriture se prépare et se relit avant que quiconque ne déplace main. Rejouable : main bouge
 * pendant qu'on décide, on relance le même fichier sur la main du moment.
 *   corrections.json = { "fichiers": [{ "blob": <oid>, "ligne": <n>, "texte": <ligne neutre> }],
 *                        "messages": [{ "commit": <sha>, "message": <message neutre> }] }
 * Un blob corrigé l'est dans CHAQUE commit qui le porte, quel que soit son chemin. Un commit sans
 * correction et sans parent réécrit garde son identifiant. La signature d'un commit réécrit tombe
 * (elle ne vaudrait plus). La correspondance ancien → nouveau s'écrit dans <corrections>.carte.tsv :
 * c'est elle qui permet ensuite de reposer les copies de travail sur la nouvelle main.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOSSIER_ENTREPRISE = 'entreprise/'

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'buffer',
    maxBuffer: 1 << 30,
    windowsHide: true,
    ...options
  })
}

function oidComplet(rev) {
  return git(['rev-parse', '--verify', `${rev}^{object}`])
    .toString('utf8')
    .trim()
}

/** `octets` avec la ligne `numero` (à partir de 1) remplacée par `texte`, fin de ligne gardée. */
export function remplacerLigne(texte, numero, nouvelle) {
  const morceaux = texte.split(/(\r?\n)/)
  const index = (numero - 1) * 2
  if (numero < 1 || index >= morceaux.length) {
    throw new Error(
      `ligne ${numero} absente (le fichier a ${Math.ceil(morceaux.length / 2)} lignes)`
    )
  }
  morceaux[index] = nouvelle
  return morceaux.join('')
}

/**
 * Un objet commit brut recopié : arbre et parents remplacés, signature retirée, message remplacé
 * si `message` est donné. Les autres en-têtes (auteur, date, encodage) restent octet pour octet.
 */
export function commitRecopie(brut, { arbre, parents, message }) {
  const fin = brut.indexOf('\n\n')
  const entetes = (fin === -1 ? brut : brut.slice(0, fin)).split('\n')
  const corps = fin === -1 ? '' : brut.slice(fin + 2)
  const gardes = []
  let dansSignature = false
  for (const ligne of entetes) {
    if (dansSignature && ligne.startsWith(' ')) continue
    dansSignature = false
    if (ligne.startsWith('gpgsig') || ligne.startsWith('gpgsig-sha256')) {
      dansSignature = true
      continue
    }
    if (ligne.startsWith('tree ') || ligne.startsWith('parent ')) continue
    gardes.push(ligne)
  }
  const nouveauCorps =
    message === undefined ? corps : message.endsWith('\n') ? message : `${message}\n`
  return (
    [`tree ${arbre}`, ...parents.map((p) => `parent ${p}`), ...gardes].join('\n') +
    `\n\n${nouveauCorps}`
  )
}

function reecrire(fichierCorrections, distant, source, cible) {
  if (
    git(['for-each-ref', `refs/heads/${cible}`])
      .toString('utf8')
      .trim()
  ) {
    console.error(
      `La branche ${cible} existe deja : choisis un autre nom, elle n'est jamais ecrasee.`
    )
    return 2
  }
  const corrections = JSON.parse(readFileSync(fichierCorrections, 'utf8'))
  const blobs = new Map()
  for (const { blob, ligne, texte } of corrections.fichiers ?? []) {
    const ancien = oidComplet(blob)
    const avant = blobs.has(ancien)
      ? blobs.get(ancien).contenu
      : git(['cat-file', 'blob', ancien]).toString('utf8')
    const contenu = remplacerLigne(avant, ligne, texte)
    blobs.set(ancien, { contenu })
  }
  for (const [ancien, entree] of blobs) {
    entree.nouveau = git(['hash-object', '-w', '--stdin'], {
      input: Buffer.from(entree.contenu, 'utf8')
    })
      .toString('utf8')
      .trim()
    console.log(`blob ${ancien.slice(0, 9)} -> ${entree.nouveau.slice(0, 9)}`)
  }
  const messages = new Map(
    (corrections.messages ?? []).map((m) => [oidComplet(m.commit), m.message])
  )

  const commits = git([
    'rev-list',
    '--reverse',
    '--topo-order',
    source,
    '--not',
    `--remotes=${distant}`
  ])
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
  const carte = new Map()
  const index = join(tmpdir(), `separation-reecriture-${process.pid}.index`)
  let reecrits = 0
  try {
    for (const sha of commits) {
      const brut = git(['cat-file', 'commit', sha]).toString('utf8')
      const entetes = brut.slice(0, brut.indexOf('\n\n'))
      const encodage = /^encoding (.+)$/m.exec(entetes)?.[1]
      if (encodage && !/^utf-?8$/i.test(encodage))
        throw new Error(`${sha} : encodage ${encodage} non gere`)
      const arbre = /^tree (\w+)$/m.exec(entetes)[1]
      const anciensParents = [...entetes.matchAll(/^parent (\w+)$/gm)].map((m) => m[1])
      const parents = anciensParents.map((p) => carte.get(p) ?? p)

      const aRemplacer = git(['ls-tree', '-r', '-z', '--full-tree', arbre])
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((entree) => {
          const [meta, chemin] = entree.split('\t')
          const [mode, , oid] = meta.split(' ')
          return { mode, oid, chemin }
        })
        .filter(({ oid }) => blobs.has(oid))
      let nouvelArbre = arbre
      if (aRemplacer.length > 0) {
        const env = { ...process.env, GIT_INDEX_FILE: index }
        git(['read-tree', arbre], { env })
        for (const { mode, oid, chemin } of aRemplacer) {
          git(['update-index', '--cacheinfo', `${mode},${blobs.get(oid).nouveau},${chemin}`], {
            env
          })
        }
        nouvelArbre = git(['write-tree'], { env }).toString('utf8').trim()
      }
      const message = messages.get(sha)
      const inchange =
        nouvelArbre === arbre &&
        message === undefined &&
        parents.every((p, i) => p === anciensParents[i])
      if (inchange) {
        carte.set(sha, sha)
        continue
      }
      const recopie = commitRecopie(brut, { arbre: nouvelArbre, parents, message })
      const nouveau = git(['hash-object', '-t', 'commit', '-w', '--stdin'], {
        input: Buffer.from(recopie, 'utf8')
      })
        .toString('utf8')
        .trim()
      carte.set(sha, nouveau)
      reecrits += 1
    }
  } finally {
    rmSync(index, { force: true })
  }
  const ancienBout = oidComplet(source)
  const nouveauBout = carte.get(ancienBout) ?? ancienBout
  // Création seule : l'ancienne valeur vide fait échouer `update-ref` si la branche est apparue entre-temps.
  git(['update-ref', `refs/heads/${cible}`, nouveauBout, ''])
  const fichierCarte = fichierCorrections.replace(/\.json$/i, '') + '.carte.tsv'
  writeFileSync(fichierCarte, [...carte].map(([a, n]) => `${a}\t${n}`).join('\n') + '\n')
  const memeArbre =
    git(['rev-parse', `${ancienBout}^{tree}`])
      .toString('utf8')
      .trim() ===
    git(['rev-parse', `${nouveauBout}^{tree}`])
      .toString('utf8')
      .trim()
  console.log(
    `${commits.length} commits lus, ${reecrits} reecrits, ${commits.length - reecrits} inchanges.\n` +
      `${cible} = ${nouveauBout.slice(0, 9)} (source ${source} = ${ancienBout.slice(0, 9)}, intacte).\n` +
      `Contenu final identique a la source : ${memeArbre ? 'oui' : 'NON'}.\n` +
      `Correspondance ancien -> nouveau : ${fichierCarte}`
  )
  return 0
}

/** Les lignes (numérotées à partir de 1) d'un texte qui portent une faute. */
function lignesFautives(texte, faute) {
  const lignes = []
  texte.split(/\r?\n/).forEach((ligne, i) => {
    const quoi = faute(ligne)
    if (quoi) lignes.push({ numero: i + 1, quoi })
  })
  return lignes
}

async function main() {
  if (process.argv[2] === '--reecrire') {
    const [fichier, distant, source, cible] = process.argv.slice(3)
    if (!cible) {
      console.error(
        'Usage : node scripts/separation-commits-fautifs.mjs --reecrire <corrections.json> <distant> <source> <cible>'
      )
      return 2
    }
    return reecrire(fichier, distant, source, cible)
  }
  const [distant, branche = 'HEAD'] = process.argv.slice(2)
  if (!distant) {
    console.error('Usage : node scripts/separation-commits-fautifs.mjs <distant> [<branche>]')
    return 2
  }
  const { fauteDeSeparation, nomsDesProfils, racineDesProfils, termesDesProfils, texteDuFichier } =
    await import('./identite-entreprise.mjs')
  // Même chargement que `separation-avant-push.mjs` : depuis une copie de travail, les profils vivent
  // dans le dossier principal du dépôt.
  const racine = git(['rev-parse', '--show-toplevel']).toString('utf8').trim()
  const profils = racineDesProfils(racine)
  if (!profils) {
    console.log('Aucun profil d entreprise sur ce poste : rien a controler.')
    return 0
  }
  const noms = nomsDesProfils(profils)
  const { termes, erreurs } = termesDesProfils(profils)
  if (erreurs.length > 0) {
    console.error(
      `Profils mal formes, termes interdits inconnus :\n${erreurs.map((e) => `  ${e}`).join('\n')}`
    )
    return 2
  }
  const faute = (texteOuOctets) => fauteDeSeparation(texteOuOctets, noms, termes)

  const commits = git(['rev-list', '--reverse', branche, '--not', `--remotes=${distant}`])
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
  let fautifs = 0
  for (const sha of commits) {
    const blocs = []
    const message = git(['log', '-1', '--format=%B', sha]).toString('utf8')
    const dansLeMessage = lignesFautives(message, faute)
    if (dansLeMessage.length > 0) {
      blocs.push(
        `  message : ${dansLeMessage.map((l) => `ligne ${l.numero} (${l.quoi})`).join(', ')}`
      )
    }
    // Les fichiers que CE commit ajoute ou modifie (contre son premier parent ; une fusion compte
    // contre le premier parent aussi : ce qu'elle apporte de l'autre branche part avec elle).
    const parent = git(['rev-list', '--parents', '-n', '1', sha])
      .toString('utf8')
      .trim()
      .split(' ')[1]
    const diff = parent
      ? git([
          'diff-tree',
          '-r',
          '-z',
          '--no-renames',
          '--diff-filter=AM',
          '--name-only',
          parent,
          sha
        ])
      : git(['ls-tree', '-r', '-z', '--name-only', sha])
    const chemins = diff.toString('utf8').split('\0').filter(Boolean)
    for (const chemin of chemins) {
      if (chemin.startsWith(DOSSIER_ENTREPRISE)) continue
      const dansLeChemin = faute(chemin)
      if (dansLeChemin) blocs.push(`  ${chemin} (chemin) — ${dansLeChemin}`)
      const octets = git(['show', `${sha}:${chemin}`])
      if (!faute(octets)) continue
      const texte = texteDuFichier(octets)
      const lignes = texte === undefined ? [] : lignesFautives(texte, faute)
      // Une faute qu'aucune ligne seule ne porte (nom coupé sur deux lignes, binaire) se signale
      // quand même : le push la refuse.
      const ou =
        lignes.length > 0
          ? lignes.map((l) => `ligne ${l.numero} (${l.quoi})`).join(', ')
          : 'fichier entier'
      blocs.push(`  ${chemin} : ${ou}`)
    }
    if (blocs.length === 0) continue
    fautifs += 1
    const titre = git(['log', '-1', '--format=%h %ad %s', '--date=format:%d/%m %H:%M', sha])
      .toString('utf8')
      .trim()
    console.log(`${titre}\n${blocs.join('\n')}`)
  }
  console.log(
    fautifs === 0
      ? `Aucun commit fautif sur ${commits.length} qui partiraient vers ${distant}.`
      : `${fautifs} commit(s) fautif(s) sur ${commits.length} qui partiraient vers ${distant}.`
  )
  return fautifs === 0 ? 0 : 1
}

// Lancé en commande seulement : le test importe `remplacerLigne` et `commitRecopie` sans rien exécuter.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (erreur) => {
      console.error(`Verification impossible : ${erreur.message}`)
      process.exit(2)
    }
  )
}
