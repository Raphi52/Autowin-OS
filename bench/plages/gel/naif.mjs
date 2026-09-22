export function disponibilites({ personnes, debut, fin }) { return personnes.length ? [{ debut, fin }] : []; }
