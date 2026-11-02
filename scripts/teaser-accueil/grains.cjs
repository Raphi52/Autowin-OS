// Tout ce qui est périodique sur BOUCLE, pour que la boucle n'ait aucun raccord :
// chaque grain revit une durée `vie` qui divise exactement la boucle.
function grains() {
  const hasard = (() => {
    let s = 1234567
    return () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
  })()
  const lignes = []
  // [x,y,z, vx,vy,vz, vie, phase, taille, r,g,b, genre]
  const ajouter = (l) => lignes.push(l)
  // poussière froide dans les rayons
  for (let i = 0; i < 2600; i++) {
    const x = (hasard() - 0.5) * 24,
      y = hasard() * 18,
      z = -20 + hasard() * 30
    ajouter([
      x,
      y,
      z,
      (hasard() - 0.5) * 0.25,
      0.05 + hasard() * 0.15,
      (hasard() - 0.5) * 0.2,
      12,
      hasard(),
      0.6 + hasard() * 1.1,
      0.55,
      0.68,
      1.0,
      0
    ])
  }
  // sable d'or qui remonte depuis le cercle, en spirale lente
  for (let i = 0; i < 2600; i++) {
    const a = hasard() * Math.PI * 2,
      r = 0.8 + hasard() * 3.0
    ajouter([
      Math.cos(a) * r,
      0.05,
      -0.6 + Math.sin(a) * r,
      Math.cos(a) * 0.08,
      0.55 + hasard() * 0.9,
      Math.sin(a) * 0.08 - 0.05,
      6,
      hasard(),
      0.35 + hasard() * hasard() * 1.4,
      1.0,
      0.68,
      0.26,
      1
    ])
  }
  // sable qui monte vers le magicien, le long de l'escalier
  for (let i = 0; i < 2600; i++) {
    const x = (hasard() - 0.5) * 11,
      z = -12 + hasard() * 7
    ajouter([
      x,
      2 + hasard() * 2,
      z,
      -x * 0.05,
      0.5 + hasard() * 0.8,
      0,
      4,
      hasard(),
      0.3 + hasard() * hasard() * 1.2,
      1.0,
      0.62,
      0.22,
      1
    ])
  }
  // cierges le long des marches et leur reflet
  for (const c of [-1, 1]) {
    for (let m = 0; m < 9; m++) {
      for (let k = 0; k < 3; k++) {
        const y = 0.34 * (m + 1) + 0.16 + hasard() * 0.2,
          z = -5.3 - m * 0.75 - hasard() * 0.2,
          x = c * (4.4 + k * 0.5 + hasard() * 0.4 + (m % 2) * 0.2)
        ajouter([x, y, z, 0, 0, 0, 12, hasard(), 2.2 + hasard() * 1.2, 1.0, 0.56, 0.2, 2])
      }
    }
    for (let k = 0; k < 7; k++) {
      const z = -4.6 + k * 1.35,
        x = c * (5.1 + hasard() * 0.5)
      ajouter([x, 0.3, z, 0, 0, 0, 12, hasard(), 2.6 + hasard(), 1.0, 0.56, 0.2, 2])
      ajouter([x, -0.3, z, 0, 0, 0, 12, hasard(), 2.2, 0.5, 0.28, 0.1, 2])
    }
  }
  // l'éclat de chaque coup de bâton
  for (let i = 0; i < 2400; i++) {
    const a = hasard() * Math.PI * 2,
      v = 2 + hasard() * hasard() * 15
    const c = hasard() < 0.25 ? [0.6, 0.78, 1.0] : [1.0, 0.68, 0.3]
    ajouter([
      Math.cos(a) * 0.5,
      0.1,
      Math.sin(a) * 0.5,
      Math.cos(a) * v,
      2 + hasard() * 9,
      Math.sin(a) * v,
      12,
      hasard(),
      0.5 + hasard() * 1.3,
      c[0],
      c[1],
      c[2],
      3
    ])
  }
  const taille = 13
  const donnees = new Float32Array(lignes.length * taille)
  lignes.forEach((l, i) => donnees.set(l, i * taille))
  return {
    donnees,
    taille,
    nombre: lignes.length,
    attributs: [
      ['aPos', 3, 0],
      ['aVit', 3, 3],
      ['aVie', 1, 6],
      ['aPhase', 1, 7],
      ['aTaille', 1, 8],
      ['aCoul', 3, 9],
      ['aGenre', 1, 12]
    ]
  }
}
module.exports = { grains }
