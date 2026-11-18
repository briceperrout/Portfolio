// Éléments partagés par les vues Trajectoire et Retraite : éventail Monte-Carlo, objectifs, et projection mise en cache.
// Les caches sont des `let` de ce module ; aucune autre vue ne les écrit. Aucun effet de bord au niveau module.
import { etat, echapper, GEOM } from "../ui/commun.js";
import { eur } from "../moteur.js";
import { projeter, projeterCentral } from "../projection.js";
import { echelle, cadre, colonnesSurvol, profilPourMoteur } from "../app.js";

export function graphiqueEventail(central, eventail, defl) {
  const ages = eventail.map((p) => p.age);
  const ymax = echelle(Math.max(...eventail.map((p, i) => Math.max(p.p90, central[i].financier) * defl(i))));
  const { x, y, s } = cadre(ages, ymax);
  const ligne = (f) => eventail.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(f(p, i) * defl(i)).toFixed(1)}`).join("");
  const bande = eventail.map((p, i) => `${x(i).toFixed(1)},${y(p.p90 * defl(i)).toFixed(1)}`)
    .concat(eventail.map((p, i) => `${x(i).toFixed(1)},${y(p.p10 * defl(i)).toFixed(1)}`).reverse()).join(" ");
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Éventail des scénarios : placements selon l'âge">${s}`;
  svg += `<polygon points="${bande}" fill="var(--s1)" fill-opacity="0.16" stroke="none"/>`;
  svg += `<path d="${ligne((p) => p.p10)}" fill="none" stroke="var(--s1)" stroke-width="1" stroke-opacity="0.6"/>`;
  svg += `<path d="${ligne((p) => p.p90)}" fill="none" stroke="var(--s1)" stroke-width="1" stroke-opacity="0.6"/>`;
  svg += `<path d="${ligne((p, i) => central[i].financier)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  svg += `<path d="${ligne((p) => p.p50)}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
  svg += colonnesSurvol(ages, x, (i) => {
    const p = eventail[i], k = defl(i);
    return `${p.age} ans\nOptimiste (1 chance sur 10 de faire mieux) : ${eur(p.p90 * k)}\nMédiane : ${eur(p.p50 * k)}\nPessimiste (1 chance sur 10 de faire moins bien) : ${eur(p.p10 * k)}\nScénario central : ${eur(central[i].financier * k)}`;
  }, "curseur-eventail");
  svg += `</svg>`;
  return svg + `<div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Médiane</span><span><span class="pastille" style="background:var(--s1);opacity:.35"></span>8 scénarios sur 10 dans cette zone</span><span><span class="trait" style="background:var(--muted)"></span>Scénario central (rendements moyens, pointillés)</span></div>`;
}

// Projection mise en cache : la même sert à « Trajectoire » et à « Retraite ».
// Deux entrées : la projection complète (avec l'éventail Monte-Carlo) et le scénario central seul (niveau Débutant).
// Le central est identique dans les deux ; une projection complète déjà en cache sert aussi au besoin central.
let cacheProjection = { cle: null, r: null };
let cacheCentral = { cle: null, r: null };
let cacheLegere = { cle: null, r: null }; // tirages au hasard mais sans éventail (verdict Débutant de l'onglet Retraite)
export function projectionCourante(inclureAchat = true, { central = false, legere = false } = {}) {
  const r = { ...(etat.profil.retraite ?? {}) };
  const cle = JSON.stringify([etat.brouillon, { ...etat.profil, retraite: r }, inclureAchat]);
  if (cacheProjection.cle === cle) return cacheProjection.r;
  if (central) {
    if (cacheCentral.cle !== cle) cacheCentral = { cle, r: projeterCentral(etat.brouillon, profilPourMoteur(), { inclureAchat }) };
    return cacheCentral.r;
  }
  if (legere) {
    if (cacheLegere.cle !== cle) cacheLegere = { cle, r: projeter(etat.brouillon, profilPourMoteur(), { inclureAchat, legere: true }) };
    return cacheLegere.r;
  }
  cacheProjection = { cle, r: projeter(etat.brouillon, profilPourMoteur(), { inclureAchat }) };
  return cacheProjection.r;
}

// Chances de réussite de chaque objectif (parmi les scénarios tirés au hasard)
export function blocObjectifs(r, attrs = "") {
  const R = r.retraite, n = r.simulations, E = r.eventail;
  const items = [];
  if (r.achat) items.push([`Acheter ta résidence principale (${eur(r.achat.prix)}) à ${r.achat.age} ans`, 1 - r.achatsRates / n]);
  if (R) {
    items.push([`À ${R.age} ans, avoir plus que tout l'argent que tu as mis`, E[R.iR].probaGain]);
    items.push([`Arrêter de travailler à ${R.age} ans et te verser ${eur(R.revenu)} par mois jusqu'à ${R.ageFin} ans sans être à court`, R.probaDure]);
    items.push([`Transmettre à ${R.ageFin} ans au moins le capital que tu avais à ${R.age} ans`, R.probaTransmet]);
  }
  if (!items.length) return "";
  const niveau = (p) => (p >= 0.9 ? ["Très probable", "var(--s3)"] : p >= 0.7 ? ["Probable", "var(--s4)"] : p >= 0.5 ? ["Incertain", "var(--s2)"] : ["Peu probable", "var(--s2)"]);
  return `<section class="panneau"${attrs ? ` ${attrs}` : ""}><h2>Tes objectifs : chances de réussite</h2>
    <p class="note" style="margin:4px 0 10px">En suivant le plan, sur ${n} scénarios de marchés tirés au hasard (bonnes et mauvaises années, krachs compris).</p>
    <ul class="objectifs">${items.map(([t, p]) => { const [l, c] = niveau(p); const v = Math.round(100 * p); return `<li><span>${echapper(t)}</span><span class="jauge" role="img" aria-label="${v} %"><span style="width:${v}%;background:${c}"></span></span><b class="num">${p >= 0.995 && p < 1 ? "> 99" : v} %</b><span class="small muted">${l}</span></li>`; }).join("")}</ul>
  </section>`;
}

// Clé de la dernière projection complète en cache (lue par le calcul fiscal de la vue Trajectoire)
export function cleProjectionEnCache() { return cacheProjection.cle; }
