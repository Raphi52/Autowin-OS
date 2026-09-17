import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { racineDepot } from './racine-depot.mjs'

/*
 * GARDE — AUCUNE SONDE NE SE RATTACHE A UN PORT DEVINE.
 *
 * Mesure conv-615 (« mes travaux en parallele se parasitent ») : `cdp-port.mjs` avait retire son
 * repli muet sur 9223 (conv-611), mais QUATORZE sondes gardaient leur propre defaut devine
 * (`--port 9224`, `|| 9231`, `?? 9251`...). Depuis une copie de travail qui n'a pas lance son
 * instance, elles pilotaient l'application d'un AUTRE travail — ou celle de l'utilisateur — en
 * rendant `ok: true`. Le commentaire du resolveur ne suffisait pas : ce controle refuse la rechute.
 *
 * Une sonde qui LANCE sa propre instance garde le droit de DEMANDER un port (`portDemande`, verrou
 * de `port-libre.mjs`) : ce port-la est reserve, il ne parasite personne.
 * Seul `cdp-port.mjs` a le droit de nommer le port par defaut : c'est lui qui les resout.
 */
const dossier = join(racineDepot(), 'scripts')
// `facture-claude.mjs` vise le port de debogage d'un BRAVE lance par l'utilisateur (9222, opt-in
// explicite `--cdp`) : ce n'est pas une instance Autowin, il ne parasite aucun travail Autowin.
const AUTORISES = new Set(['cdp-port.mjs', 'facture-claude.mjs'])
const RESERVATION = /portDemande|remote-debugging-port|portLibre|reserver|PORT_PAR_DEFAUT/i

const sondes = readdirSync(dossier).filter(
  (f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !AUTORISES.has(f)
)

describe('sondes : aucun port de rattachement devine', () => {
  for (const nom of sondes) {
    const source = readFileSync(join(dossier, nom), 'utf8')
    // Les commentaires gardent la memoire du defaut : seul le CODE est controle.
    const fautives = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .filter((l) => /\b92[2-9]\d\b/.test(l))
      .filter((l) => !RESERVATION.test(l))
    it(`${nom} ne devine aucun port de rattachement`, () => {
      expect(fautives).toEqual([])
    })
  }
})
