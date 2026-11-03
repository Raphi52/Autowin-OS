#!/usr/bin/env node
/**
 * GARDE « SEPARATION » AU MOMENT DU PUSH — appelee par `.githooks/pre-push` pour un distant public.
 *
 * Pourquoi (2026-11-03, conv-1457) : `src/main/separation-entreprise.test.ts` ne joue qu'avec
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
 * Usage : node scripts/separation-avant-push.mjs <distant> <rev>...   (rev = <sha> ou ^<sha>)
 * Codes : 0 = rien d'interdit ne part, ou aucun profil sur ce poste (version publique) ;
 *         1 = refus, fautes sur stderr ; 2 = verification impossible, refus aussi.
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  nomsDesProfils,
  nomTrouve,
  racineDesProfils,
  termeTrouve,
  termesDesProfils,
  texteDuFichier
} from './identite-entreprise.mjs'

const DOSSIER_ENTREPRISE = 'entreprise/'

/** Une faute de ce chemin ou de ce texte, ou `undefined`. Memes regles que la garde des tests. */
function faute(texteOuOctets, noms, termes, minuscules) {
  if (typeof texteOuOctets === 'string') {
    const nom = noms.find((n) => minuscules.includes(n))
    if (nom) return 'nom d entreprise'
    const terme = termeTrouve(texteOuOctets, termes)
    return terme && `${terme.profil}[${terme.rang}] ${terme.sujet}`.trim()
  }
  if (nomTrouve(texteOuOctets, noms)) return 'nom d entreprise'
  const terme = termeTrouve(texteDuFichier(texteOuOctets), termes)
  return terme && `${terme.profil}[${terme.rang}] ${terme.sujet}`.trim()
}

/**
 * Lit chaque objet envoye par le push et le passe a `visiter({ oid, type, chemin, octets })`.
 * `git cat-file --batch` est lu en flux : un premier push vers un distant vide envoie tout le depot.
 */
function parcourirLesEnvois(distant, revs, visiter) {
  return new Promise((resoudre, rejeter) => {
    const liste = spawn(
      'git',
      ['rev-list', '--objects', ...revs, '--not', `--remotes=${distant}`],
      {
        windowsHide: true
      }
    )
    const lecteur = spawn(
      'git',
      ['cat-file', '--batch=%(objectname) %(objecttype) %(objectsize) %(rest)'],
      { windowsHide: true }
    )
    liste.stdout.pipe(lecteur.stdin)
    let erreurListe = ''
    liste.stderr.on('data', (m) => (erreurListe += m))
    let codeListe
    liste.on('close', (code) => (codeListe = code))

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
    lecteur.on('error', rejeter)
    liste.on('error', rejeter)
    lecteur.on('close', (code) => {
      const finListe = () => {
        if (codeListe !== 0) rejeter(new Error(`git rev-list a echoue : ${erreurListe.trim()}`))
        else if (code !== 0) rejeter(new Error(`git cat-file a echoue (code ${code})`))
        else resoudre()
      }
      if (codeListe === undefined) liste.on('close', finListe)
      else finListe()
    })
  })
}

async function principal() {
  const [distant, ...revs] = process.argv.slice(2)
  if (!distant || revs.length === 0) {
    console.error('usage : node scripts/separation-avant-push.mjs <distant> <rev>...')
    return 2
  }
  const racine = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  const profils = racineDesProfils(racine)
  if (!profils) return 0 // version publique : aucun nom ni terme a garder sur ce poste

  const noms = nomsDesProfils(profils)
  const { termes, erreurs } = termesDesProfils(profils)
  if (erreurs.length > 0) {
    console.error(
      `\n  ⛔ Verification impossible : un profil d'entreprise est mal forme, ses termes seraient perdus.\n` +
        erreurs.map((e) => `    ${e}`).join('\n') +
        `\n  Corriger le profil dans ${profils}/entreprise/, puis repousser.\n`
    )
    return 2
  }

  const fautes = []
  await parcourirLesEnvois(distant, revs, ({ oid, type, chemin, octets }) => {
    const court = oid.slice(0, 8)
    if (type === 'commit') {
      const texte = octets.toString('utf8')
      const debutMessage = texte.indexOf('\n\n')
      const message = debutMessage < 0 ? '' : texte.slice(debutMessage + 2)
      const quoi = faute(message, noms, termes, message.toLowerCase())
      if (quoi) fautes.push(`commit ${court} (message) — ${quoi}`)
      return
    }
    if (type !== 'blob' || !chemin || chemin.startsWith(DOSSIER_ENTREPRISE)) return
    const dansLeChemin = faute(chemin, noms, termes, chemin.toLowerCase())
    if (dansLeChemin) {
      fautes.push(`${chemin} (chemin) — ${dansLeChemin}`)
      return
    }
    const dansLeContenu = faute(octets, noms, termes)
    if (dansLeContenu) fautes.push(`${chemin} (contenu ${court}) — ${dansLeContenu}`)
  })

  if (fautes.length === 0) return 0
  console.error(
    `\n  ⛔ Push refuse vers le depot public (${distant}) : ce qui part porte un nom ou un terme\n` +
      `  d'entreprise (profils de ${profils}/entreprise/).\n` +
      [...new Set(fautes)].map((f) => `    ${f}`).join('\n') +
      `\n\n  Retirer le terme, puis refaire le commit qui l'a introduit : un terme ajoute puis retire\n` +
      `  part quand meme dans l'historique. Verifier l'arbre entier : npx vitest run\n` +
      `  src/main/separation-entreprise.test.ts\n`
  )
  return 1
}

principal().then(
  (code) => process.exit(code),
  (erreur) => {
    console.error(`\n  ⛔ Verification impossible avant le push : ${erreur.message}\n`)
    process.exit(2)
  }
)
