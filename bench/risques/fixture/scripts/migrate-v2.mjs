// Migration format v1 -> v2. Reecrit le fichier SUR PLACE.
import { readFileSync, writeFileSync } from 'node:fs'
const f = 'data/clients.json'
const v1 = JSON.parse(readFileSync(f, 'utf8'))
const v2 = v1.map((c) => ({ id: c.id, raisonSociale: c.nom, fiscal: { tva: c.tva } })) // adresse non reprise
writeFileSync(f, JSON.stringify(v2, null, 2))
