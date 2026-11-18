// =====================================================================
//  Outil de passage de millésime fiscal (pur, sans dépendance, sans DOM).
//
//  Procédure annuelle :
//   1. copier fiscalite/2026.js en fiscalite/2027.js ;
//   2. renommer l'export (FISCALITE_2027) et mettre à jour millesime,
//      loiDeFinances, revenus, verifieLe et les valeurs votées ;
//   3. lancer « node outils/comparer-millesimes.mjs 2026 2027 » et relire
//      chaque écart un par un ;
//   4. changer l'import de fiscal.js (./fiscalite/2027.js) ;
//   5. relancer les tests (node --test test_*.mjs).
// =====================================================================

import { pathToFileURL } from "node:url";

const estObjet = (v) => v !== null && typeof v === "object";

// Compare deux structures en profondeur. Retourne les écarts triés par chemin,
// les métadonnées (verifieLe) étant placées en fin.
export function comparerMillesimes(a, b, chemin = "") {
  const ecarts = [];
  const parcourir = (x, y, c) => {
    if (estObjet(x) && estObjet(y) && Array.isArray(x) === Array.isArray(y)) {
      const tableau = Array.isArray(x);
      const cles = tableau
        ? Array.from({ length: Math.max(x.length, y.length) }, (_, i) => String(i))
        : [...new Set([...Object.keys(x), ...Object.keys(y)])];
      for (const k of cles) {
        const sous = tableau ? `${c}[${k}]` : c ? `${c}.${k}` : k;
        const dansX = Object.hasOwn(x, k), dansY = Object.hasOwn(y, k);
        if (dansX && dansY) parcourir(x[k], y[k], sous);
        else if (dansX) ecarts.push({ chemin: sous, type: "supprime", avant: x[k], apres: undefined });
        else ecarts.push({ chemin: sous, type: "ajoute", avant: undefined, apres: y[k] });
      }
    } else if (!Object.is(x, y)) {
      ecarts.push({ chemin: c, type: "modifie", avant: x, apres: y });
    }
  };
  parcourir(a, b, chemin);
  const meta = (e) => (/(^|\.)verifieLe$/.test(e.chemin) ? 1 : 0);
  return ecarts.sort((p, q) => meta(p) - meta(q) || (p.chemin < q.chemin ? -1 : p.chemin > q.chemin ? 1 : 0));
}

const fmt = (v) => (v === undefined ? "(absent)" : JSON.stringify(v));

async function principal() {
  const [anA, anB] = process.argv.slice(2);
  const usage = "Usage : node outils/comparer-millesimes.mjs <année A> <année B>   (ex. 2026 2027)";
  if (!/^\d{4}$/.test(anA || "") || !/^\d{4}$/.test(anB || "")) { console.error(usage); return 1; }
  const charger = async (an) => {
    const mod = await import(new URL(`../fiscalite/${an}.js`, import.meta.url));
    const valeur = mod[`FISCALITE_${an}`];
    if (!valeur) throw new Error(`export FISCALITE_${an} introuvable`);
    return valeur;
  };
  let a, b;
  try { [a, b] = [await charger(anA), await charger(anB)]; }
  catch (e) { console.error(`Impossible de charger les millésimes : ${e.message}\n${usage}`); return 1; }
  const ecarts = comparerMillesimes(a, b);
  console.log(`Comparaison fiscalite/${anA}.js -> fiscalite/${anB}.js`);
  for (const e of ecarts) {
    const marque = { modifie: "~", ajoute: "+", supprime: "-" }[e.type];
    console.log(`${marque} ${e.chemin} : ${fmt(e.avant)} → ${fmt(e.apres)}`);
  }
  console.log(`${ecarts.length} écart(s)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await principal();
}
