import { spawnSync } from 'node:child_process'

/*
 * TROUVER UN PORT REELLEMENT LIBRE — parce qu'un port « a nous » ne l'est pas toujours.
 *
 * DEFAUT MESURE le 2026-09-06 : le port fixe 9280 du lanceur de la sonde etait tenu en LISTENING
 * par un processus DEJA MORT (PID 42372 introuvable). Un enfant de l'application herite du socket
 * d'ecoute et le garde apres la fin du parent — cas deja documente cote `src/main/cdp-port.ts`.
 * Le harnais refusait donc de demarrer (« port deja occupe »), et la verification automatique
 * branchee sur `build:desktop` tombait a chaque construction pour une raison SANS AUCUN RAPPORT
 * avec le produit. Un socket fantome ne se tue pas : on prend le suivant.
 */

/** Les ports en ecoute, lus dans une sortie `netstat -ano`. Pure : la sortie est fournie. */
export function portsEnEcoute(sortieNetstat) {
  const ports = new Set()
  for (const ligne of String(sortieNetstat).split(/\r?\n/)) {
    if (!/LISTENING/i.test(ligne)) continue
    // L'adresse locale est le 2e champ : `127.0.0.1:9280` ou `[::]:9280`.
    const adresse = ligne.trim().split(/\s+/)[1]
    const port = Number(adresse?.slice(adresse.lastIndexOf(':') + 1))
    if (Number.isInteger(port)) ports.add(port)
  }
  return ports
}

/**
 * Le premier port libre a partir de `depart`, dans une fenetre BORNEE.
 *
 * La borne est volontaire : sans elle, une machine saturee ferait balayer des milliers de ports
 * avant d'echouer, et l'echec dirait « aucun port » au lieu de « la machine est saturee ».
 */
export function premierPortLibre(depart, occupes, fenetre = 20) {
  for (let port = depart; port < depart + fenetre; port += 1) if (!occupes.has(port)) return port
  return undefined
}

/** Le premier port libre reel, en interrogeant le systeme. */
export function choisirPortLibre(depart, fenetre = 20) {
  const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
  // netstat indisponible : on ne bloque pas le lanceur, on rend le port demande tel quel.
  if (netstat.status !== 0 || !netstat.stdout) return depart
  return premierPortLibre(depart, portsEnEcoute(netstat.stdout), fenetre)
}
