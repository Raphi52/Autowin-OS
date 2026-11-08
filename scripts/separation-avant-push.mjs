#!/usr/bin/env node
/**
 * GARDE « SEPARATION » — appelee par `.githooks/pre-commit` (mode --index) et par `.githooks/pre-push`
 * pour un distant public.
 *
 * Pourquoi (2026-11-03) : `src/main/gardes/separation-entreprise.test.ts` ne joue qu'avec
 * `npm test`. Ni le hook, ni `npm run publier:main`, ni la publication automatique ne le lancent :
 * quatre commentaires portant un terme metier sont partis sur le depot public. Ce script applique les
 * MEMES regles (`identite-entreprise.mjs` : `nomTrouve`, `termeTrouve`, `texteDuFichier`) a ce que le
 * push ENVOIE, et non a l'arbre de travail : les fichiers non commites d'autres fils ne bloquent
 * rien, et un terme commite puis efface du disque ne passe pas.
 *
 * Ce qui part = les objets que le distant n'a pas : `git rev-list --objects <revs> --not
 * --remotes=<distant>`. Chaque fichier de chaque commit envoye (un terme ajoute puis retire part
 * dans l'historique), et chaque message de commit. Le dossier `entreprise/` a sa propre garde dans le
 * hook ; ses fichiers ne sont pas relus ici, comme dans le test.
 *
 * Mode `--index` (appele par `.githooks/pre-commit`) : la MEME regle, appliquee aux fichiers que le
 * commit en cours ajoute ou modifie, lus dans l'index (`git diff --cached`, contre HEAD). Le commit d'une
 * copie de travail part ensuite vers GitHub : le pre-push, qui ne lit que les objets envoyes, ne le voit
 * qu'une fois le nom deja dans l'historique. Pas de message ici : le commit n'est pas encore ecrit.
 * fix-ok: scripts/separation-avant-push.mjs — cause mesurée : sans ce mode, aucun fichier du commit n'était lu, les copies comprises
 *
 * Usage : node scripts/separation-avant-push.mjs <distant> <rev>...   (rev = <sha> ou ^<sha>)
 *         node scripts/separation-avant-push.mjs --index              (fichiers indexes du commit)
 * Codes : 0 = rien d'interdit ne part, ou aucun profil sur ce poste (version publique) ;
 *         1 = refus, fautes sur stderr ; 2 = verification impossible : refus au push, et au commit
 *         le crochet le signale sans refuser (un commit propre ne se refuse jamais faute de controle).
 */
import { execFileSync, spawn } from 'node:child_process'

const DOSSIER_ENTREPRISE = 'entreprise/'
const AU_COMMIT = process.argv[2] === '--index'

/**
 * Les fautes d'un fichier qui part : son chemin, puis son contenu. Liste vide = rien d'interdit.
 * `faute(texte)` rend la faute trouvée dans un texte, ou rien.
 */
function fautesDUnFichier(chemin, octets, court, faute) {
  if (!chemin || chemin.startsWith(DOSSIER_ENTREPRISE)) return []
  const dansLeChemin = faute(chemin)
  if (dansLeChemin) return [`${chemin} (chemin) — ${dansLeChemin}`]
  const dansLeContenu = faute(octets)
  return dansLeContenu ? [`${chemin} (contenu ${court}) — ${dansLeContenu}`] : []
}

/** Un `git cat-file` qui lit ses objets sur son entree : une ligne `<oid> <chemin>` par objet. */
function lancerCatFile() {
  return spawn('git', ['cat-file', '--batch=%(objectname) %(objecttype) %(objectsize) %(rest)'], {
    windowsHide: true
  })
}

/**
 * Passe chaque objet que `lecteur` restitue a `visiter({ oid, type, chemin, octets })`, un par un : un
 * premier push vers un distant vide envoie tout le depot, on ne le charge pas d'un bloc. Resolue a la
 * fin de la sortie ; rejetee si `cat-file` echoue ou si une ligne est illisible.
 */
function lireLesObjets(lecteur, visiter) {
  return new Promise((resoudre, rejeter) => {
    let morceaux = []
    let longueur = 0
    let entete
    const tout = () => {
      const b = morceaux.length === 1 ? morceaux[0] : Buffer.concat(morceaux, longueur)
      morceaux = [b]
      return b
    }
    const garder = (b, depuis) => {
      morceaux = [b.subarray(depuis)]
      longueur = b.length - depuis
    }
    lecteur.stdout.on('data', (m) => {
      morceaux.push(m)
      longueur += m.length
      for (;;) {
        if (!entete) {
          const b = tout()
          const fin = b.indexOf(10)
          if (fin < 0) return
          const ligne = b.subarray(0, fin).toString('utf8')
          garder(b, fin + 1)
          const champs = /^(\S+) (\S+) (\d+) ?(.*)$/.exec(ligne)
          if (!champs) {
            lecteur.kill()
            rejeter(new Error(`objet illisible : ${ligne}`))
            return
          }
          entete = { oid: champs[1], type: champs[2], taille: Number(champs[3]), chemin: champs[4] }
        }
        if (longueur < entete.taille + 1) return
        const b = tout()
        visiter({ ...entete, octets: b.subarray(0, entete.taille) })
        garder(b, entete.taille + 1)
        entete = undefined
      }
    })
    // Un `cat-file` mort pendant l'envoi de ses lignes : un refus nomme, jamais un plantage.
    lecteur.stdin.on('error', rejeter)
    lecteur.on('error', rejeter)
    lecteur.on('close', (code) => {
      if (code === 0) resoudre()
      else rejeter(new Error(`git cat-file a echoue (code ${code})`))
    })
  })
}

/** Ce qui part au push : les objets que le distant n'a pas, lus par `cat-file`. */
function parcourirLesEnvois(distant, revs, visiter) {
  const liste = spawn('git', ['rev-list', '--objects', ...revs, '--not', `--remotes=${distant}`], {
    windowsHide: true
  })
  const lecteur = lancerCatFile()
  liste.stdout.pipe(lecteur.stdin)
  let erreurListe = ''
  liste.stderr.on('data', (m) => (erreurListe += m))
  const listeFinie = new Promise((resoudre, rejeter) => {
    liste.on('error', rejeter)
    liste.on('close', (code) =>
      code === 0 ? resoudre() : rejeter(new Error(`git rev-list a echoue : ${erreurListe.trim()}`))
    )
  })
  return Promise.all([listeFinie, lireLesObjets(lecteur, visiter)]).then(() => undefined)
}

/**
 * Ce qui part au commit : les fichiers que CE commit ajoute ou modifie (`git diff --cached` contre HEAD),
 * lus dans l'index. Une ligne `<oid> <chemin>` par fichier, pour `cat-file`. Une suppression ne porte
 * aucun contenu qui parte, et un sous-module n'est pas un fichier : l'un et l'autre sont ecartes.
 */
function lignesDesFichiersIndexes() {
  const sortie = execFileSync(
    'git',
    ['diff', '--cached', '--raw', '-z', '--no-renames', '--no-abbrev', '--diff-filter=AM'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }
  )
  // Format `-z --raw` : `:<mode ancien> <mode nouveau> <oid ancien> <oid nouveau> <statut>`, NUL, chemin, NUL.
  const jetons = sortie.split('\0')
  let lignes = ''
  for (let i = 0; i + 1 < jetons.length; i += 2) {
    const [, modeNouveau, , oidNouveau] = jetons[i].split(' ')
    if (modeNouveau === '160000') continue
    lignes += `${oidNouveau} ${jetons[i + 1]}\n`
  }
  return lignes
}

async function principal() {
  const [distant, ...revs] = process.argv.slice(2)
  if (!AU_COMMIT && (!distant || revs.length === 0)) {
    console.error('usage : node scripts/separation-avant-push.mjs <distant> <rev>...  |  --index')
    return 2
  }
  // Les règles se chargent ici et non en import statique : un module absent ou cassé ferait sortir Node
  // en code 1 avant tout `catch`, et le crochet de commit le prendrait pour un refus. Chargées ici, leur
  // échec sort en code 2 (contrôle impossible) : le commit propre passe, l'envoi vers GitHub refuse.
  const { fauteDeSeparation, nomsDesProfils, racineDesProfils, termesDesProfils } =
    await import('./identite-entreprise.mjs')
  const racine = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  const profils = racineDesProfils(racine)
  if (!profils) return 0 // version publique : aucun nom ni terme a garder sur ce poste

  const noms = nomsDesProfils(profils)
  const { termes, erreurs } = termesDesProfils(profils)
  // fix-ok: scripts/separation-avant-push.mjs — cause mesurée : au commit, le message ⛔ « refaire le commit » sortait alors que le commit passe (test rouge : stderr « ⛔ Verification impossible »).
  if (erreurs.length > 0) {
    if (AU_COMMIT) {
      console.error(
        `\n  ⚠️  Contrôle des noms d'entreprise non fait pour ce commit : un profil d'entreprise est mal formé.\n` +
          erreurs.map((e) => `    ${e}`).join('\n') +
          `\n  Le commit passe. L'envoi vers GitHub refusera tant que le profil n'est pas corrigé dans ${profils}/entreprise/.\n`
      )
    } else {
      console.error(
        `\n  ⛔ Verification impossible : un profil d'entreprise est mal forme, ses termes seraient perdus.\n` +
          erreurs.map((e) => `    ${e}`).join('\n') +
          `\n  Corriger le profil dans ${profils}/entreprise/, puis repousser.\n`
      )
    }
    return 2
  }

  const faute = (texte) => fauteDeSeparation(texte, noms, termes)
  const fautes = []
  const visiter = ({ oid, type, chemin, octets }) => {
    const court = oid.slice(0, 8)
    if (type === 'commit') {
      const texte = octets.toString('utf8')
      const debutMessage = texte.indexOf('\n\n')
      const message = debutMessage < 0 ? '' : texte.slice(debutMessage + 2)
      const quoi = faute(message)
      if (quoi) fautes.push(`commit ${court} (message) — ${quoi}`)
      return
    }
    if (type !== 'blob') return
    fautes.push(...fautesDUnFichier(chemin, octets, court, faute))
  }

  if (AU_COMMIT) {
    const lignes = lignesDesFichiersIndexes()
    if (lignes) {
      const lecteur = lancerCatFile()
      lecteur.stdin.end(lignes)
      await lireLesObjets(lecteur, visiter)
    }
  } else {
    await parcourirLesEnvois(distant, revs, visiter)
  }

  if (fautes.length === 0) return 0
  const liste = [...new Set(fautes)].map((f) => `    ${f}`).join('\n')
  if (AU_COMMIT) {
    console.error(
      `\n  ⛔ Commit refuse : ce qui est commite porte un nom ou un terme d'entreprise.\n` +
        `${liste}\n\n  Retirer le nom ou le terme du fichier, puis refaire le git add et le commit.\n` +
        `  Rien n'est publie.\n`
    )
    return 1
  }
  console.error(
    `\n  ⛔ Push refuse vers le depot public (${distant}) : ce qui part porte un nom ou un terme\n` +
      `  d'entreprise (profils de ${profils}/entreprise/).\n` +
      liste +
      `\n\n  Retirer le terme, puis refaire le commit qui l'a introduit : un terme ajoute puis retire\n` +
      `  part quand meme dans l'historique. Verifier l'arbre entier : npx vitest run\n` +
      `  src/main/gardes/separation-entreprise.test.ts\n`
  )
  return 1
}

principal().then(
  (code) => process.exit(code),
  (erreur) => {
    if (AU_COMMIT) {
      console.error(
        `\n  ⚠️  Contrôle des noms d'entreprise non fait pour ce commit : ${erreur.message}\n  Le commit passe ; le contrôle à l'envoi vers GitHub le refera.\n`
      )
    } else {
      console.error(`\n  ⛔ Verification impossible avant le push : ${erreur.message}\n`)
    }
    process.exit(2)
  }
)
