#!/usr/bin/env node
/**
 * SONDE DE CONTRAT du canal Amitel Brain — interroge le VRAI service, jamais un mock.
 *
 * Pourquoi elle existe (defaut mesure le 2026-09-02) : le client TS d Autowin et
 * `brain_server.py` vivent dans DEUX depots. Chacun a fait evoluer la poignee de main de son
 * cote — client (11/08) : `/challenge?nonce=<le sien>` puis attestation `request` obligatoire
 * dans la reponse ; serveur (20/08) : `/challenge` REFUSE tout parametre, emet SON nonce, et
 * n atteste jamais la requete. Resultat : chaque `brain_query` rendait `invalid`, en silence.
 * La suite de tests etait VERTE — ses mocks rejouaient les hypotheses du client.
 *
 * Cette sonde ne simule rien : elle parle au service configure et NOMME l endroit exact ou les
 * deux cotes divergent. Volontairement HORS de `npm test` : elle depend d un service vivant.
 *
 * Usage : npm run brain:doctor      (code de sortie 0 = canal utilisable, 1 = divergence)
 */
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVICE = 'amitel-brain'
const REQUEST_AAD = Buffer.from('amitel-brain/request-v1', 'utf8')

function token() {
  if (process.env.AMITEL_BRAIN_TOKEN) return process.env.AMITEL_BRAIN_TOKEN
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'AmitelBrain', 'service-token')
    : join(process.env.HOME ?? '', '.amitel-brain', 'service-token')
  return existsSync(base) ? readFileSync(base, 'ascii').trim() : ''
}

function origin() {
  const configured = process.env.AMITEL_BRAIN_ORIGIN
  if (configured) return configured.replace(/\/+$/, '')
  return `http://127.0.0.1:${process.env.AMITEL_BRAIN_PORT || '8765'}`
}

/** Verifie la signature HMAC et rend le corps authentifie (protocole 1 ou 2). */
function openEnvelope(raw, tok) {
  const payload = JSON.parse(raw)
  if (payload.service !== SERVICE) throw new Error(`service inattendu: ${payload.service}`)
  const signed = payload.protocol === 1 ? payload.context : payload.authenticated
  if (typeof signed !== 'string') throw new Error('enveloppe sans corps authentifie')
  const expected = createHmac('sha256', tok)
    .update(`${SERVICE}\n${payload.protocol}\n${signed}`, 'utf8')
    .digest('hex')
  if (expected !== payload.signature) throw new Error('signature HMAC invalide (mauvais jeton ?)')
  return payload.protocol === 1 ? { context: signed } : JSON.parse(signed)
}

function seal(payload, tok, nonce) {
  const key = createHash('sha256').update(tok, 'utf8').digest()
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'hex'))
  cipher.setAAD(REQUEST_AAD)
  const out = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ])
  return { nonce, ciphertext: out.toString('base64') }
}

const findings = []
const note = (verdict, quoi, detail) => {
  findings.push({ verdict, quoi })
  const mark = verdict === 'ok' ? 'OK  ' : 'FAIL'
  console.log(`[${mark}] ${quoi}${detail ? ` — ${detail}` : ''}`)
}

const CHALLENGE = /^challenge:([0-9a-f]{24})$/

async function main() {
  const tok = token()
  const base = origin()
  console.log(`service   : ${base}`)
  console.log(`jeton     : ${tok ? `present (${tok.length} car.)` : 'ABSENT'}`)
  if (!tok) {
    note('fail', 'jeton de service', 'ni AMITEL_BRAIN_TOKEN ni le fichier local')
    return 1
  }

  // 1. Le service repond-il, et son index est-il servable ?
  try {
    const res = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${tok}` } })
    const health = JSON.parse(await res.text()).health
    const state = health?.state ?? 'non declare'
    // Un 200 SANS detail de sante n est pas une preuve de sante : la version publique du serveur
    // repond 200 a /health sans jamais regarder l index. Ne jamais deduire "healthy" d un 2xx.
    if (res.ok && !health)
      note(
        'fail',
        'sante non declaree',
        'HTTP 200 mais aucun champ health — serveur plus ancien que le client'
      )
    else if (res.ok) note('ok', 'service joignable', `etat ${state}`)
    else
      note(
        'fail',
        'index de savoir inutilisable',
        `etat ${state} — ${(health?.reasons ?? []).join(' / ') || `HTTP ${res.status}`}`
      )
  } catch (err) {
    note('fail', 'service injoignable', `${base} — ${err.message}`)
    return 1
  }

  /*
   * 2. Poignee de main. Le CONTRAT est : le serveur emet un nonce a usage unique sur `GET
   * /challenge` SANS parametre. Le client d Autowin envoyait `?nonce=<le sien>` et exigeait
   * l echo — le serveur repond 400 a toute chaine de requete, donc chaque lecture echouait en
   * silence. La sonde teste le contrat d abord, puis signale si le serveur accepte encore
   * l ancienne forme (un serveur en retard sur le client).
   */
  let nonce = ''
  const bare = await fetch(`${base}/challenge`).catch(() => null)
  if (bare?.ok) {
    nonce = CHALLENGE.exec(openEnvelope(await bare.text(), tok).context)?.[1] ?? ''
    if (nonce) note('ok', 'defi emis par le serveur', 'nonce a usage unique, signature verifiee')
    else note('fail', 'defi illisible', 'la reponse ne porte pas challenge:<24 hex>')
  } else {
    const mine = randomBytes(12).toString('hex')
    const withParam = await fetch(`${base}/challenge?nonce=${mine}`).catch(() => null)
    if (withParam?.ok) {
      note(
        'fail',
        'defi: le serveur attend le nonce du client',
        `HTTP ${bare?.status} sur /challenge nu — ce serveur est en retard sur le client, qui laisse desormais le serveur tirer le nonce`
      )
    } else {
      note('fail', 'defi absent', `/challenge -> HTTP ${bare?.status ?? 'aucune reponse'}`)
    }
  }
  if (!nonce) return 1

  // 3. Interrogation reelle, scellee avec le nonce que le serveur accepte.
  const request = {
    query: 'sonde de contrat brain-doctor',
    harness: 'brain-doctor',
    trace_id: 'brain-doctor'
  }
  const res = await fetch(`${base}/query-secure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(seal(request, tok, nonce))
  }).catch(() => null)
  if (!res?.ok) {
    note(
      'fail',
      'interrogation refusee',
      `/query-secure -> HTTP ${res?.status ?? 'aucune reponse'}`
    )
  } else {
    let body
    try {
      body = openEnvelope(await res.text(), tok)
    } catch (err) {
      note('fail', 'reponse rejetee', err.message)
      body = null
    }
    if (body) {
      note('ok', 'reponse signee et verifiee', `${(body.context ?? '').length} car. de savoir`)
      // 4. Champ que le CLIENT exige — son absence est la seconde divergence.
      if (body.request) note('ok', 'attestation de la requete', 'presente')
      else
        note(
          'fail',
          'attestation de la requete absente',
          'le client jette toute reponse sans request{query,trace_id} — ce serveur n en emet pas'
        )
    }
  }

  // 5. Ecriture (`remember`) : 404 = route absente, autre = route presente.
  const ing = await fetch(`${base}/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: '{}'
  }).catch(() => null)
  if (ing?.status === 404)
    note('fail', 'ecriture indisponible', '/ingest absent — remember ne deposerait rien')
  else note('ok', 'ecriture disponible', `/ingest present (HTTP ${ing?.status})`)

  const failures = findings.filter((f) => f.verdict === 'fail')
  console.log('')
  console.log(
    failures.length === 0
      ? 'CANAL UTILISABLE — client et serveur parlent le meme protocole.'
      : `CANAL CASSE — ${failures.length} divergence(s) : ${failures.map((f) => f.quoi).join(' ; ')}`
  )
  return failures.length === 0 ? 0 : 1
}

// `exitCode` plutot que `process.exit()` : une sortie brutale pendant qu une requete HTTP est
// encore en vol fait planter la boucle d evenements de Node (assertion uv async.c) et masque le
// verdict que la sonde vient de rendre.
main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(`sonde interrompue: ${err.message}`)
    process.exitCode = 1
  }
)
