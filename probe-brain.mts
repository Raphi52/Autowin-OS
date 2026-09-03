import { retrieveBrainContext } from './src/main/brain-retrieval'
const res = await retrieveBrainContext('procedure RIG greffe parametrage', { timeoutMs: 15000 })
console.log('statut :', res.status, '| longueur savoir :', res.context.length)
console.log('extrait :', res.context.slice(0, 200).replace(/\n/g, ' '))
