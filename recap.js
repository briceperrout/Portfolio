// =====================================================================
//  RÉCAPITULATIF — un document HTML autonome et imprimable par profil :
//  plan d'action, répartition, comptes, achat, trajectoire, échéances
//  et mémo des placements concernés.
//  Contient aussi le codec du « lien magique » (profil ↔ texte URL-safe), pur et testable.
// =====================================================================
import { eur, pct } from "./moteur.js";
import { tauxEffectifs, consoliderEtrangers, expositionChange, NOM_DEVISE, TYPES_COMPTES_ETRANGERS } from "./devises.js";

const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const COULEURS = { bourse: "#2a78d6", bitcoin: "#eb6834", prudent: "#1baf7a", or: "#eda100", projet: "#e87ba4", securite: "#008300", scpi: "#6250d6" };
const ORDRE = ["bourse", "bitcoin", "prudent", "or", "projet", "securite", "scpi"];
const signe = (v) => (Math.abs(v) < 0.5 ? "0 €" : `${v > 0 ? "+" : "−"}${eur(Math.abs(v))}`);
const dateLongue = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function genererRecapHTML({ plan, nom, profil, res, proj, echeances, fiches, planDate, niveauNom, tauxDuJour = null }) {
  const C = res.capital || 1;
  const env = (id) => plan.enveloppes[id]?.libelle ?? id;
  const lib = (c) => plan.classes[c]?.libelle ?? c;
  const aujourdHui = dateLongue(new Date());

  // Comptes à l'étranger : famille, devise, équivalent en euros et date du taux ; jamais de libellé
  let etrangers = "";
  try {
    const T = tauxEffectifs(profil, tauxDuJour), C0 = consoliderEtrangers(profil, T.taux);
    if (C0.lignes.length) {
      const x = expositionChange(plan, profil, T.taux), horsEuro = 100 - (x.pourcentages.EUR ?? 0);
      const date = new Date(`${T.date}T12:00:00`).toLocaleDateString("fr-FR");
      etrangers = `<h2>Comptes à l'étranger</h2>
  <table><thead><tr><th>Famille</th><th>Devise</th><th class="m">Équivalent en euros</th></tr></thead><tbody>
  ${C0.lignes.map((l) => `<tr><td>${e(TYPES_COMPTES_ETRANGERS[l.type]?.libelle ?? l.type)}</td><td>${e(NOM_DEVISE[l.devise] ?? l.devise)}</td><td class="m">${eur(l.soldeEUR)}</td></tr>`).join("")}
  </tbody></table>
  <p class="note">Taux de change du ${e(date)}. Exposition hors euro : ${pct(Math.max(0, horsEuro))}.</p>`;
    }
  } catch { /* section facultative */ }

  // Situation
  const situation = [
    ["Âge", profil.couple ? `${profil.agePrincipal} ans et ${profil.ageConjoint} ans (foyer)` : `${profil.age} ans`],
    ["Salaire net", `${eur(profil.salaireNetMensuel)} par mois${profil.couple ? " (foyer)" : ""}`],
    ["Épargne", `${eur(profil.epargneMensuelle)} par mois`],
    ["Placements", eur(res.capital)],
    ...(profil.tmi !== "" && profil.tmi != null ? [["Tranche d'imposition", `${profil.tmi} %`]] : []),
    ...(profil.projetRP?.actif ? [["Projet", `Résidence principale à ${eur(profil.projetRP.prix)}${profil.projetRP.imperatif ? ` dans ${profil.projetRP.horizonAnnees} an(s) (impératif)` : ""}`]] : []),
  ];

  // Consignes : d'abord ce qu'il faut faire
  const ordreNiv = { action: 0, alerte: 1, info: 2 };
  const cons = [...res.consignes].sort((a, b) => ordreNiv[a.niveau] - ordreNiv[b.niveau]);
  const aFaire = cons.filter((c) => c.niveau === "action");
  const autres = cons.filter((c) => c.niveau !== "action");

  // Répartition
  const classes = ORDRE.filter((c) => plan.classes[c] && (res.alloc[c] > 0.5 || res.actuel[c] > 0.5));
  const barre = classes.filter((c) => res.alloc[c] > 0.5).map((c) => `<span style="flex-grow:${res.alloc[c]};background:${COULEURS[c]}" title="${e(lib(c))}"></span>`).join("");

  // Trajectoire
  let trajectoire = "";
  if (proj) {
    const H = plan.hypotheses, Cc = proj.central, E = proj.eventail;
    const iR = Math.max(0, Math.min(Cc.length - 1, (H.ageRetraite ?? 64) - Cc[0].age)), iF = Cc.length - 1;
    const idx = [...new Set(Cc.map((p, i) => i).filter((i) => i === 0 || Cc[i].age % 5 === 0 || i === iR || i === iF))];
    trajectoire = `<section><h2>Trajectoire du patrimoine</h2>
      <p class="note">Le plan est réappliqué chaque année. Rendements moyens du plan pour le scénario central ; ${proj.simulations} scénarios tirés au hasard pour la fourchette (8 sur 10 entre pessimiste et optimiste). Montants en euros de l'époque.</p>
      <div class="tuiles">
        <div><span>À ${Cc[iR].age} ans (médiane)</span><b>${eur(E[iR].p50)}</b></div>
        <div><span>Fourchette à ${Cc[iR].age} ans</span><b>${eur(E[iR].p10)} – ${eur(E[iR].p90)}</b></div>
        <div><span>Patrimoine net à ${Cc[iF].age} ans</span><b>${eur(Cc[iF].net)}</b></div>
        <div><span>Après impôts à ${Cc[iF].age} ans</span><b>${eur(Cc[iF].apresImpots)}</b></div>
      </div>
      <table><thead><tr><th>Âge</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Résidence nette</th><th class="m">Net après impôts</th></tr></thead><tbody>
      ${idx.map((i) => `<tr><td>${Cc[i].age} ans${Cc[i].evenement === "achat" ? " · achat" : ""}</td><td class="m">${eur(E[i].p10)}</td><td class="m">${eur(E[i].p50)}</td><td class="m">${eur(E[i].p90)}</td><td class="m">${eur(Cc[i].bien - Cc[i].dette)}</td><td class="m">${eur(Cc[i].apresImpots)}</td></tr>`).join("")}
      </tbody></table></section>`;
  }

  // Achat
  let achat = "";
  if (res.achat) {
    const a = res.achat, i = a.ideal, hz = a.imperatif ? a.horizon : null;
    achat = `<section><h2>Résidence principale · ${eur(a.prix)} (${e(a.type)})</h2>
      <ul>
        <li>Apport disponible aujourd'hui : ${eur(a.surplus)} (livrets au-dessus de l'épargne de sécurité), puis ${eur(a.epargneApport)} mis de côté chaque mois.</li>
        ${i ? `<li>Âge idéal d'achat : <b>${i.age} ans</b> (dans ${i.annees} an(s)) — apport ${eur(i.apportRequis)}, prêt de ${eur(i.pret)} sur ${i.duree} ans, mensualité ${eur(i.mensualite)}.</li>` : `<li>Achat hors de portée avant la limite du plan avec ces revenus.</li>`}
        ${hz ? `<li>Achat impératif dans ${hz.annees} an(s) : ${hz.manque > 0.5 ? `il manquera environ ${eur(hz.manque)} ; prix finançable à cette date : ${eur(hz.prixMax)}.` : `finançable ; ${eur(hz.aProtegerMaintenant)} mis à l'abri dès maintenant.`}</li>` : ""}
      </ul></section>`;
  }

  // Mémo des placements concernés
  const ids = new Set(res.consignes.map((c) => c.fiche).filter(Boolean));
  for (const l of res.lignes) { const f = plan.enveloppes[l.enveloppe]?.fiche; if (f && l.montant > 0.5) ids.add(f); }
  if (res.achat) ids.add("residence");
  const memo = fiches.filter((f) => ids.has(f.id)).map((f) => `<article class="fiche"><h3>${e(f.titre)}</h3>
    <p class="note">${e(f.accroche)}</p>
    <dl>${f.essentiel.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join("")}</dl>
    <p class="sous">Étapes</p><ol>${f.etapes.map((x) => `<li>${e(x)}</li>`).join("")}</ol>
    ${f.attention?.length ? `<p class="sous">Points de vigilance</p><ul>${f.attention.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : ""}</article>`).join("");

  const ech = echeances.slice(0, 14).map((x) => `<tr><td>${e(x.approx ? `vers ${x.date.toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}` : x.date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }))}</td><td><b>${e(x.titre)}</b><br><span class="note">${e(x.detail)}</span></td></tr>`).join("");

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan d'action · ${e(nom)}</title>
<style>
  :root { --fg: #141816; --muted: #5a635f; --line: #dde3e0; --accent: #1d5c48; --soft: #eef4f1; --act: #1d4f8a; --warn: #8a5a00; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6f5; color: var(--fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .page { max-width: 820px; margin: 0 auto; background: #fff; padding: 40px 48px 56px; }
  h1 { font-size: 26px; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--accent); break-after: avoid; }
  h3 { font-size: 15px; margin: 0 0 4px; }
  .entete { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .note { color: var(--muted); font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .situation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 20px; margin-top: 16px; }
  .situation div span, .tuiles div span { display: block; font-size: 11.5px; color: var(--muted); }
  .situation b { font-size: 14px; }
  ol.actions { padding-left: 20px; margin: 6px 0; } ol.actions li { margin: 4px 0; }
  .niv { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 1px 6px; border-radius: 4px; margin-right: 6px; background: var(--soft); color: var(--accent); }
  .niv.alerte { background: #fbf0d9; color: var(--warn); }
  .barre { display: flex; gap: 2px; height: 18px; margin: 8px 0 4px; } .barre span { border-radius: 3px; }
  .pastille { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; }
  .tuiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
  .tuiles div { background: var(--soft); border-radius: 6px; padding: 8px 10px; } .tuiles b { font-size: 15px; }
  .plus { color: var(--act); } .moins { color: var(--warn); }
  .fiche { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 10px 0; break-inside: avoid; }
  .fiche dl { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 4px 12px; margin: 8px 0; font-size: 13px; } .fiche dt { font-weight: 600; } .fiche dd { margin: 0; }
  .fiche ol, .fiche ul { margin: 4px 0; padding-left: 20px; font-size: 13px; }
  .sous { font-weight: 600; margin: 8px 0 0; font-size: 13px; }
  .imprimer { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  .pied { margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--line); }
  @media (max-width: 640px) { .page { padding: 24px 16px; } .situation, .tuiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media print { body { background: #fff; } .page { padding: 0; max-width: none; } .imprimer { display: none; } h2 { margin-top: 22px; } }
</style></head>
<body><div class="page">
  <div class="entete">
    <div><h1>Plan d'action · ${e(nom)}</h1><div class="note">Établi le ${aujourdHui} · plan ${planDate ? `enregistré le ${e(planDate)}` : "par défaut"}${niveauNom ? ` · Affichage : niveau ${e(niveauNom)}` : ""}</div></div>
    <button class="imprimer" onclick="window.print()">Imprimer ou enregistrer en PDF</button>
  </div>
  <div class="situation">${situation.map(([k, v]) => `<div><span>${e(k)}</span><b>${e(v)}</b></div>`).join("")}</div>

  <h2>À faire</h2>
  ${aFaire.length ? `<ol class="actions">${aFaire.map((c) => `<li>${e(c.texte)}</li>`).join("")}</ol>` : `<p>Rien d'urgent : continuer les versements du mois.</p>`}
  ${autres.length ? `<p class="sous">À savoir</p><ul>${autres.map((c) => `<li>${c.niveau === "alerte" ? '<span class="niv alerte">Attention</span>' : ""}${e(c.texte)}</li>`).join("")}</ul>` : ""}

  <h2>Ce mois-ci · ${eur(profil.epargneMensuelle)} d'épargne</h2>
  <table><tbody>${res.mouvements.map((m) => `<tr><td>${m.sens === "arbitrage" ? `Arbitrer de ${e(env(m.enveloppe))} vers ${e(env(m.vers))}` : `${m.sens === "retrait" ? "Retirer de" : "Verser sur"} ${e(env(m.enveloppe))}`}${m.note ? `<br><span class="note">${e(m.note)}</span>` : ""}</td><td class="m">${m.sens === "retrait" ? "−" : m.sens === "versement" ? "+" : ""}${eur(m.montant)}</td></tr>`).join("") || `<tr><td>Aucun mouvement.</td></tr>`}</tbody></table>

  <h2>Répartition cible</h2>
  <div class="barre">${barre}</div>
  <table><thead><tr><th>Classe</th><th class="m">Actuel</th><th class="m">Cible</th><th class="m">Part</th><th class="m">Écart</th></tr></thead><tbody>
  ${classes.map((c) => `<tr><td><span class="pastille" style="background:${COULEURS[c]}"></span>${e(lib(c))}</td><td class="m">${eur(res.actuel[c])}</td><td class="m">${eur(res.alloc[c])}</td><td class="m">${pct((100 * res.alloc[c]) / C)}</td><td class="m">${signe(res.alloc[c] - res.actuel[c])}</td></tr>`).join("")}
  </tbody></table>

  ${etrangers}

  <h2>Comptes</h2>
  <p class="note">${res.reeq.moisEquilibre ? `Équilibre atteint en environ ${res.reeq.moisEquilibre} mois avec l'épargne du mois et des transferts progressifs.` : "Rééquilibrage progressif avec l'épargne du mois."}</p>
  <table><thead><tr><th>Compte</th><th class="m">Actuel</th><th class="m">Cible</th><th class="m">Écart</th></tr></thead><tbody>
  ${res.reeq.comptes.map((l) => `<tr><td>${e(env(l.enveloppe))}<br><span class="note">${e(l.texte)}</span></td><td class="m">${eur(l.actuel)}</td><td class="m">${eur(l.cible)}</td><td class="m ${l.ecart > 0.5 ? "plus" : l.ecart < -0.5 ? "moins" : ""}">${signe(l.ecart)}</td></tr>`).join("")}
  </tbody></table>

  ${achat}
  ${trajectoire}

  ${ech ? `<h2>Prochaines échéances</h2><table><tbody>${ech}</tbody></table>` : ""}

  ${memo ? `<h2>Mémo des placements concernés</h2>${memo}` : ""}

  <p class="note pied">Simulation fondée sur les règles et les hypothèses du plan (rendements moyens, fiscalité ${e(plan.fiscalite?.verifieeLe ?? "")}) : les résultats sont indicatifs. Taux, plafonds et fiscalité évoluent ; les revérifier avant d'agir.</p>
</div></body></html>`;
}

// ---------------------------------------------------------------- partage d'un profil par lien
// #mon-profil?p=<code> : le profil (sans prénom ni nom d'établissement) est réduit à ce qui diffère
// d'un profil vide, puis encodé en JSON → UTF-8 → Base64 URL-safe. Le décodage traite le code comme
// une entrée non fiable : taille bornée, structure et types vérifiés, clés dangereuses écartées.
const CLES_INTERDITES = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_CODE_PARTAGE = 12000;
const ETAB_GENERIQUES = new Set(["Banque traditionnelle", "Autre courtier en ligne"]);

function diff(base, p) {
  if (p === undefined) return undefined;
  const objet = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (objet(base) && objet(p)) {
    const r = {};
    for (const k of Object.keys(p)) { const d = diff(base[k], p[k]); if (d !== undefined) r[k] = d; }
    return Object.keys(r).length ? r : undefined;
  }
  return JSON.stringify(base) === JSON.stringify(p) ? undefined : p;
}
function assainir(v, profondeur = 0) {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) <= 1e12 ? v : null;
  if (typeof v === "string") return v.replace(/[<>"&\u0000-\u001f]/g, " ").slice(0, 160);
  if (profondeur > 6) return undefined;
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => assainir(x, profondeur + 1)).filter((x) => x !== undefined);
  if (typeof v === "object") {
    const r = {};
    let n = 0;
    for (const [k, x] of Object.entries(v)) {
      if (CLES_INTERDITES.has(k) || !/^[A-Za-z_][\w-]{0,40}$/.test(k) || ++n > 80) continue;
      const a = assainir(x, profondeur + 1);
      if (a !== undefined) r[k] = a;
    }
    return r;
  }
  return undefined;
}
/** Profil → code Base64 URL-safe. `base` : profil vide de référence (seules les différences sont gardées). */
export function encoderProfilPartage(profil, base = {}) {
  const p = JSON.parse(JSON.stringify(profil));
  // Ni prénom ni nom d'établissement (Trade Republic, Boursorama…) ; les catégories génériques restent : elles changent les frais calculés.
  const sansNom = (pea) => { if (pea && !ETAB_GENERIQUES.has(pea.etablissement)) pea.etablissement = ""; };
  if (p.conjoint) { p.conjoint.prenom = ""; sansNom(p.conjoint.pea); }
  sansNom(p.pea);
  if (Array.isArray(p.comptesEtrangers)) for (const c of p.comptesEtrangers) if (c && typeof c === "object") delete c.libelle; // usage local libre : jamais partagé
  let bin = "";
  for (const o of new TextEncoder().encode(JSON.stringify(diff(base, p) ?? {}))) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Code → objet assaini (à fusionner avec le profil vide), ou null si le code est invalide ou vide. */
export function decoderProfilPartage(code) {
  if (typeof code !== "string" || !code || code.length > MAX_CODE_PARTAGE || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const o = JSON.parse(json);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const propre = assainir(o);
    return Object.keys(propre).length ? propre : null;
  } catch { return null; }
}
