// Règle d'architecture : une vue exporte rendre<Nom>() et monter<Nom>() (écouteurs, appelée une seule fois par app.js
// au démarrage) et n'a aucun effet de bord au niveau module. Elle importe ui/commun.js et les modules métier, et des
// fonctions (jamais de const/let) d'app.js : import circulaire sûr car ces fonctions sont hissées.
import { $, etat, memo, echapper, keur, cleProfilCourant, GEOM, ORDRE, COULEUR, TYPES_EV } from "../ui/commun.js";
import { eur, pct, diagnosticAchat, carriereDe, tauxGains, profilRisque } from "../moteur.js";
import { libertePatrimoine, moisPrecaution, CRISES, projeter, projeterCentral, simulerCrise, backtesterHistorique, scenarioInflation, SCENARIO_INFLATION } from "../projection.js";
import { HISTORIQUE } from "../historique.js";
import { NEUTRE, SCENARIOS_FISCAUX, optionFiscale, comparerTaux } from "../evolution-fiscale.js";
import { projectionCourante, graphiqueEventail, cleProjectionEnCache, blocObjectifs } from "./projection-commune.js";
import { rendreRetraite } from "./retraite.js";
import { echelle, cadre, colonnesSurvol, niveauCourant, profilPourMoteur, siNiveau, blocAchat, normaliserProfil, texteLie, rendreResultats, planifierSauvegardeProfil, A_MAX } from "../app.js";

function graphiqueComposition(central, defl, achat) {
  const plan = etat.brouillon;
  const ages = central.map((p) => p.age);
  const classes = ORDRE.filter((c) => central.some((p) => (p.classes[c] ?? 0) > 1));
  const piles = central.map((p, i) => { let cum = 0; return classes.map((c) => (cum += (p.classes[c] ?? 0) * defl(i))); });
  const ymax = echelle(Math.max(...piles.map((s) => s[s.length - 1] ?? 0)));
  const { x, y, s } = cadre(ages, ymax);
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Composition des placements selon l'âge (scénario central)">${s}`;
  classes.forEach((c, k) => {
    const haut = piles.map((pl, i) => `${x(i).toFixed(1)},${y(pl[k]).toFixed(1)}`);
    const bas = piles.map((pl, i) => `${x(i).toFixed(1)},${y(k ? pl[k - 1] : 0).toFixed(1)}`).reverse();
    svg += `<polygon points="${haut.concat(bas).join(" ")}" fill="var(${COULEUR[c]})" stroke="var(--surface)" stroke-width="1"/>`;
  });
  if (achat) {
    const i = central.findIndex((p) => p.evenement === "achat");
    if (i >= 0) svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${GEOM.h}" y2="${GEOM.H - GEOM.b}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${Math.min(x(i) + 6, GEOM.W - 150)}" y="${GEOM.h + 10}" style="fill:var(--fg);font-weight:600">Achat de la résidence</text>`;
  }
  svg += colonnesSurvol(ages, x, (i) => {
    const p = central[i];
    return `${p.age} ans · ${eur(p.financier * defl(i))}\n` + classes.filter((c) => (p.classes[c] ?? 0) > 1).reverse().map((c) => `${plan.classes[c].libelle} : ${eur(p.classes[c] * defl(i))}`).join("\n");
  }, "curseur-compo");
  svg += `</svg>`;
  return svg + `<div class="legende-g">${classes.slice().reverse().map((c) => `<span><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}</span>`).join("")}</div>`;
}

let minuteurTrajectoire = null;
export function planifierTrajectoire() {
  clearTimeout(minuteurTrajectoire);
  if (!$("#vue-trajectoire").hidden) minuteurTrajectoire = setTimeout(rendreTrajectoire, 200);
  else if (!$("#vue-retraite").hidden) minuteurTrajectoire = setTimeout(rendreRetraite, 250);
}
// Programme un rendu différé en partageant le minuteur de planifierTrajectoire : un nouveau rendu annule le précédent
export function programmerRendu(fn, delai) {
  clearTimeout(minuteurTrajectoire);
  minuteurTrajectoire = setTimeout(fn, delai);
}

// En Débutant : l'achat de la résidence est inclus s'il est actif, et les montants sont toujours en euros d'aujourd'hui
const achatInclus = () => niveauCourant() === "debutant" || $("#t-achat").checked;
const montantsReels = () => niveauCourant() === "debutant" || $("#t-reel").checked;

// Courbe centrale du patrimoine net (placements + immobilier − crédits), scénario central : tous niveaux.
// Les valeurs de l'infobulle sont celles de « Mon avenir en 3 chiffres » (C[i].net × defl(i)).
function graphiqueTrajectoire(central, defl, r, iR) {
  const ages = central.map((p) => p.age);
  const ymax = echelle(Math.max(...central.map((p, i) => Math.max(p.net, p.financier) * defl(i))));
  const { x, y, s } = cadre(ages, ymax);
  const ligne = (k, coul, larg, tiret) => `<path d="${central.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k] * defl(i)).toFixed(1)}`).join("")}" fill="none" stroke="${coul}" stroke-width="${larg}"${tiret ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
  const repere = (i, texte, decalage) => i > 0 && i < central.length
    ? `<line x1="${x(i)}" x2="${x(i)}" y1="${GEOM.h}" y2="${GEOM.H - GEOM.b}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${Math.min(x(i) + 6, GEOM.W - 110)}" y="${GEOM.h + 10 + decalage}" style="fill:var(--fg);font-weight:600">${texte}</text>` : "";
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Patrimoine net selon l'âge (scénario central)">${s}`;
  svg += ligne("financier", "var(--muted)", 1.5, true) + ligne("net", "var(--s1)", 2.5);
  svg += repere(central.findIndex((p) => p.evenement === "achat"), "Achat de la résidence", 14) + repere(iR, "Retraite", 0);
  svg += colonnesSurvol(ages, x, (i) => {
    const p = central[i], f = defl(i);
    return `${p.age} ans\nPatrimoine net : ${eur(p.net * f)}\nDont placements : ${eur(p.financier * f)}` + (p.bien - p.dette > 0.5 || p.bien > 0.5 ? `\nImmobilier net du crédit : ${eur((p.bien - p.dette) * f)}` : "");
  }, "curseur-traj");
  svg += `</svg>`;
  return svg + `<div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Patrimoine net (placements + immobilier − crédits)</span><span><span class="trait" style="background:var(--muted)"></span>Placements seuls (pointillés)</span></div>`;
}

// Résumé de l'achat de la résidence, à partir du même diagnostic que le panneau « Résidence principale » (blocAchat)
function resumeAchat(res) {
  const a = res?.achat; if (!a) return null;
  const plan = etat.brouillon;
  if (a.imperatif && a.horizon) return a.horizon.manque > 0.5 ? { ok: false, age: a.horizon.age, manque: a.horizon.manque } : { ok: true, age: a.horizon.age, manque: 0 };
  const ch = a.choisi, i = a.ideal;
  if (ch && (ch.horsLimite || ch.tropTard)) return { ok: false, age: ch.age, impossible: true, manque: 0 };
  if (ch) return ch.ok || ch.okAvecPlacements ? { ok: true, age: ch.age, manque: 0, aVendre: ch.ok ? 0 : ch.aVendre } : { ok: false, age: ch.age, manque: ch.manqueTotal };
  if (i) return { ok: true, age: i.age, manque: 0 }; // l'âge idéal est, par construction, finançable
  // Aucun âge finançable : on montre l'apport qui manque à l'âge où l'écart est le plus faible (colonne « Verdict » du tableau)
  const pires = a.serie.map((p) => diagnosticAchat(plan, p)).filter((d) => !d.tropTard);
  const meilleur = pires.reduce((m, d) => (!m || d.manqueTotal < m.manqueTotal ? d : m), null);
  return meilleur ? { ok: false, age: meilleur.age, manque: meilleur.manqueTotal } : { ok: false, age: null, impossible: true, manque: 0 };
}

// « Mon avenir en 3 chiffres » (niveau Débutant) : tout vient du scénario central, sans tirages au hasard
function avenirEnTroisChiffres(r, defl, iR) {
  const C = r.central, H = etat.brouillon.hypotheses, R = r.retraite;
  const ageR = R?.age ?? C[iR].age;
  const net = C[iR].net * defl(iR);
  const L = libertePatrimoine(r, H, etat.resultat?.alloc ?? {});
  let libre = "pas de calcul possible", libreSous = "", phraseLibre = "";
  if (L && !(L.objectif > 0)) { libre = "déjà couverte"; libreSous = "ta retraite publique suffit"; phraseLibre = "Ta retraite publique couvre déjà tes besoins."; }
  else if (L) {
    libre = L.fire ? (L.fire.age <= C[0].age ? "déjà atteinte" : `à ${L.fire.age} ans`) : `pas avant ${ageR} ans`;
    libreSous = `capital de ${keur(L.objectif)} (25 × tes besoins annuels)`;
    phraseLibre = L.fire ? `Ton capital pourrait financer tes besoins ${L.fire.age <= C[0].age ? "dès aujourd'hui" : `dès ${L.fire.age} ans`}.` : `Ton capital ne suffirait pas à vivre de tes placements avant ${ageR} ans : il faut continuer d'épargner.`;
  }
  let tuile3, phrase3;
  if (etat.profil.projetRP?.actif) {
    const A = resumeAchat(etat.resultat);
    if (!A) { tuile3 = ["Achat de ta résidence", "prix à renseigner", "dans Mon profil"]; phrase3 = "Renseigne le prix visé dans Mon profil pour savoir à quel âge acheter ta résidence principale."; }
    else if (A.impossible) { tuile3 = ["Achat de ta résidence", A.age ? `impossible à ${A.age} ans` : "hors de portée", "revois l'âge ou le prix dans Mon profil"]; phrase3 = "Ton projet de résidence principale n'est pas finançable en l'état."; }
    else if (A.ok) { tuile3 = ["Achat de ta résidence", `finançable à ${A.age} ans`, A.aVendre > 0.5 ? `en vendant ${eur(A.aVendre)} de placements` : "apport couvert"]; phrase3 = `Ta résidence principale serait finançable à ${A.age} ans.`; }
    else { tuile3 = ["Achat de ta résidence", `apport manquant : ${eur(A.manque)}`, `pour acheter à ${A.age} ans`]; phrase3 = `Il te manque encore ${eur(A.manque)} d'apport pour acheter ta résidence principale à ${A.age} ans.`; }
  } else {
    const p0 = profilPourMoteur(), mois = moisPrecaution(p0.placements, p0.depensesMensuelles);
    tuile3 = ["Épargne de précaution", mois == null ? "dépenses à renseigner" : `${(Math.round(mois * 10) / 10).toLocaleString("fr-FR")} mois de dépenses`, "en livrets, avant d'investir"];
    phrase3 = mois == null ? "" : mois < 3 ? "Ton épargne de précaution couvre moins de 3 mois de dépenses : c'est la première priorité." : mois < 6 ? "Ton épargne de précaution couvre déjà plusieurs mois de dépenses : c'est solide." : "Ton épargne de précaution couvre 6 mois de dépenses ou plus : tu es à l'abri des imprévus.";
  }
  const tuiles = [[`Ton patrimoine à la retraite`, eur(net), `net, à ${ageR} ans, en euros d'aujourd'hui`], ["Liberté financière", libre, libreSous], tuile3];
  const phrase = `En suivant ton plan, tu aurais environ ${eur(net)} à ${ageR} ans, en euros d'aujourd'hui. ${phraseLibre} ${phrase3}`.replace(/\s+/g, " ").trim();
  return `<section class="panneau" id="tr-avenir" data-seul="debutant"><h2>Mon avenir en 3 chiffres</h2>
    <div class="tuiles trois">${tuiles.map(([k, v, sous]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b>${sous ? `<span class="small muted">${sous}</span>` : ""}</div>`).join("")}</div>
    <p class="note" style="margin:0">${echapper(phrase)}</p>
  </section>`;
}

export function rendreTrajectoire() {
  const t0 = performance.now();
  const plan = etat.brouillon, H = plan.hypotheses;
  const deb = niveauCourant() === "debutant";
  // Panneaux produits seulement au niveau où ils sont visibles : en Débutant, ni éventail, ni crise, ni fiscalité
  $("#achat-trajectoire").innerHTML = siNiveau("intermediaire", () => (etat.resultat ? blocAchat(etat.resultat) : "")
    || `<section class="panneau"><h2>Résidence principale</h2><p class="small muted" style="margin:6px 0 0">Pas de projet d'achat pour ce profil. Pour savoir à quel âge acheter et quel apport viser, coche « Projet d'achat » dans <a class="lien-fiche" href="#mon-profil">Mon profil</a>.</p></section>`);
  let r;
  try { r = projectionCourante(achatInclus(), { central: deb }); }
  catch (e) { console.error(e); $("#trajectoire").innerHTML = `<div class="erreur">La projection ne peut pas être calculée : ${echapper(e.message)}.</div>`; return; }
  const reel = montantsReels();
  const defl = (i) => (reel ? Math.pow(1 + (H.inflation ?? 0) / 100, -i) : 1);
  const C = r.central, E = r.eventail;
  const iR = Math.max(0, Math.min(C.length - 1, (H.ageRetraite ?? 64) - C[0].age));
  const iF = C.length - 1;
  const iRet = Math.max(0, Math.min(C.length - 1, (r.retraite?.age ?? H.ageRetraite ?? 64) - C[0].age));
  const unite = reel ? "en euros d'aujourd'hui" : "en euros de l'époque";

  const tuiles = siNiveau("intermediaire", () => `<div class="tuiles quatre" id="tr-tuiles" data-min="intermediaire">${[
    [`À ${C[iR].age} ans (médiane)`, eur(E[iR].p50 * defl(iR))],
    [`Fourchette à ${C[iR].age} ans`, `${keur(E[iR].p10 * defl(iR))} – ${keur(E[iR].p90 * defl(iR))}`],
    [`Patrimoine net à ${C[iF].age} ans`, eur(C[iF].net * defl(iF))],
    [`Après impôts à ${C[iF].age} ans`, eur(C[iF].apresImpots * defl(iF))],
  ].map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>`);
  const infoAchat = siNiveau("intermediaire", () => {
    let t = "";
    if (r.achat) {
      const a = r.achat, i = C.findIndex((p) => p.evenement === "achat");
      t = i >= 0
        ? `Achat de la résidence à ${a.age} ans (${a.imperatif ? "date impérative" : "âge idéal"}) : ${eur(a.prix)}, apport ${eur(a.apportRequis)} prélevé sur les placements, prêt de ${eur(a.pret)} sur ${a.duree} ans (${eur(a.mensualite)}/mois). Le loyer s'arrête, la mensualité est déduite de l'épargne.`
        : `L'achat prévu à ${a.age} ans n'a pas pu être financé dans le scénario central.`;
      if (r.achatsRates > 0) t += ` Dans ${Math.round((100 * r.achatsRates) / r.simulations)} % des scénarios, l'apport manque à cette date.`;
    } else if (etat.profil.projetRP?.actif && achatInclus()) t = "Aucun âge d'achat finançable avant la limite du plan : l'achat n'est pas inclus.";
    return t ? `<p class="small" style="margin:0" data-min="intermediaire">${echapper(t)}</p>` : "";
  });
  const infoPER = siNiveau("intermediaire", () => r.per?.actif ? `<p class="small" data-min="intermediaire" style="margin:6px 0 0">PER : ${eur(r.per.annuel)} versés par an jusqu'à ${Math.min(H.ageRetraite ?? 64, 70)} ans, ${plan.per?.reinvestirEconomie ? `et ${eur(r.per.economie)} d'économie d'impôt réépargnés chaque année` : "économie d'impôt non réépargnée"}. Dans « après impôts », les versements déduits sont imposés à ${plan.per?.tmiRetraite ?? 0} % à la sortie (hypothèse).</p>` : "");

  // Repères : tous les 5 ans, plus la retraite, l'achat et la fin de la projection
  const idx = [...new Set(C.map((p, i) => i).filter((i) => i % 5 === 0 || i === iR || i === iF || C[i].evenement === "achat"))].sort((x, y) => x - y);
  const gain = (x, mis) => (mis > 0.5 ? (x - mis) / mis : null);
  const celluleGain = (x, mis, f, i) => {
    const g = i === 0 ? null : gain(x, mis);
    return `<td class="m">${eur(x * f)}${g == null ? "" : `<div class="small ${g >= 0 ? "ecart-plus" : "ecart-moins"}">${g >= 0 ? "+" : "−"}${pct(Math.abs(100 * g))}</div>`}</td>`;
  };
  const panneauRapporte = () => {
    const lignesGains = idx.map((i) => {
      const f = defl(i), mis = C[i].verse;
      return `<tr><td>${C[i].age} ans${C[i].evenement === "achat" ? " · achat" : ""}</td><td class="m">${mis > 0.5 ? eur(mis * f) : '<span class="small muted">déjà tout récupéré</span>'}</td>
      ${celluleGain(E[i].p10, mis, f, i)}${celluleGain(E[i].p50, mis, f, i)}${celluleGain(E[i].p90, mis, f, i)}${celluleGain(C[i].financier, mis, f, i)}
      <td class="m"><b>${i === 0 ? "—" : E[i].probaGain >= 1 ? "100 %" : E[i].probaGain >= 0.995 ? "plus de 99 %" : `${Math.round(100 * E[i].probaGain)} %`}</b></td></tr>`;
    }).join("");
    return `<section class="panneau" id="tr-rapporte" data-min="intermediaire"><h2>Ce que rapporte ton épargne</h2>
      ${(() => { const RR = r.retraite; return RR ? `<p class="verdict ok" style="margin:4px 0 8px"><b>Hypothèses retraite utilisées :</b> arrêt de travail à ${RR.age} ans, puis ${eur(RR.revenu)} par mois (après impôt, en euros d'aujourd'hui) pris sur tes placements${RR.pension > 0 ? `, moins ${eur(RR.pension)} de retraite publique à partir de ${RR.agePension} ans` : ", sans retraite publique comptée"}. <a class="lien-fiche" href="#mon-profil">Modifier dans « Mon profil », bloc « Ta retraite »</a></p>` : ""; })()}
      <p class="note" style="margin:4px 0 8px">« Argent mis » : ton capital de départ, plus toute l'épargne versée jusqu'à cet âge${r.achat ? ", moins l'apport sorti pour l'achat" : ""}. Sous chaque montant, le gain ou la perte par rapport à cet argent mis. Pessimiste : 1 scénario sur 10 fait moins bien ; optimiste : 1 sur 10 fait mieux ; médiane : la moitié fait mieux, la moitié moins bien ; central : rendements moyens chaque année. Placements seulement, avant impôts.</p>
      <div class="table-wrap"><table><thead><tr><th>Âge</th><th class="m">Argent mis</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th><th class="m">Chances d'avoir gagné</th></tr></thead><tbody>${lignesGains}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">« Chances d'avoir gagné » : part des ${r.simulations} scénarios où les placements valent plus que l'argent mis à cet âge. Ces chances ne montent pas toujours avec l'âge : l'épargne des dernières années n'a pas encore eu le temps de rapporter, et un krach juste avant la date regardée suffit à faire repasser quelques scénarios sous l'argent mis. Après ${H.ageRetraite ?? 64} ans, l'argent mis diminue des revenus que tu te verses.</p>
    </section>`;
  };
  // Après impôts : impôt du scénario central, et même taux d'impôt sur les gains pour les autres scénarios
  const panneauApresImpots = () => {
    const lignesImpots = idx.map((i) => {
      const p = C[i], f = defl(i);
      const gainsCentral = Math.max(1, p.financier - p.baseTotal);
      const taux = Math.min(0.6, Math.max(0, p.impotPlacements / gainsCentral));
      const immo = p.bien - p.dette;
      // Chaque scénario a son propre impôt (sa composition, ses gains) ; à défaut, le taux du scénario central
      const parScenario = E[i].a10 != null;
      const cellule = (pX, aX, tX) => parScenario
        ? `<td class="m">${eur((aX + immo) * f)}<div class="small muted">impôts ${eur(tX * f)}</div></td>`
        : `<td class="m">${eur((pX - taux * Math.max(0, pX - p.baseTotal) - p.impotPER + immo) * f)}<div class="small muted">impôts ${eur((taux * Math.max(0, pX - p.baseTotal) + p.impotPER) * f)}</div></td>`;
      return `<tr><td>${p.age} ans</td><td class="m">${eur(immo * f)}</td>
      ${cellule(E[i].p10, E[i].a10, E[i].t10)}${cellule(E[i].p50, E[i].a50, E[i].t50)}${cellule(E[i].p90, E[i].a90, E[i].t90)}
      <td class="m"><b>${eur(p.apresImpots * f)}</b><div class="small muted">impôts ${eur((p.impotPlacements + p.impotPER) * f)}</div></td></tr>`;
    }).join("");
    return `<section class="panneau" id="tr-apres-impots" data-min="avance"><h2>Après impôts, si tout était vendu</h2>
      <p class="note" style="margin:4px 0 8px">Patrimoine net : placements moins les impôts dus si tout était vendu à cet âge, plus ${etat.profil.proprietaire || r.achat ? "l'immobilier net du crédit restant (colonne « Immobilier net »)" : "l'immobilier s'il y en a"}. Chaque scénario a sa ligne ; sous chaque montant, le total des impôts qui seraient payés.</p>
      <div class="table-wrap"><table><thead><tr><th>Âge</th><th class="m">Immobilier net</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th></tr></thead><tbody>${lignesImpots}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">Impôts calculés pour le scénario central selon la fiscalité ${plan.fiscalite?.verifieeLe ? `vérifiée le ${new Date(plan.fiscalite.verifieeLe + "T12:00").toLocaleDateString("fr-FR")}` : "du plan"} (gains de chaque compte, or au régime le plus favorable, résidence principale exonérée${r.per?.actif ? ", PER imposé à la sortie" : ""}) . Pessimiste, médiane et optimiste : chacun des scénarios tirés au hasard est taxé avec sa propre répartition et ses propres gains (moins de gains et plus de livrets quand les marchés ont stagné, donc moins d'impôt), puis on prend le 1er dixième, la médiane et le 9e dixième du résultat après impôts. Immobilier net : valeur du logement moins le crédit restant ; il est valorisé de ${pct(H.valorisationImmobiliere ?? 0)} par an (hypothèse modifiable dans « Mon plan »), donc en euros d'aujourd'hui il ne monte que si ce taux dépasse l'inflation (${pct(H.inflation ?? 0)}). Ne sont pas comptés : les impôts payés lors des rééquilibrages, les abattements annuels de l'assurance-vie et la plus-value d'un logement autre que la résidence principale.</p>
    </section>`;
  };

  $("#trajectoire").innerHTML = `
    ${deb ? avenirEnTroisChiffres(r, defl, iRet) : ""}
    <section class="panneau" id="tr-trajectoire"><h2>Trajectoire du patrimoine</h2>
      <p class="note" style="margin:4px 0 0">${etat.profil.foyer?.actif ? "Foyer : les âges affichés sont l'âge de référence du couple. " : ""}Chaque année, le plan est réappliqué : paliers, âge, protection de l'apport. L'épargne suit le salaire (${normaliserProfil(etat.profil).salaireDans10Ans > 0 ? "selon ton salaire espéré dans 10 ans, puis ta carrière" : `carrière « ${echapper((carriereDe(plan, etat.profil).libelle ?? "").split(" :")[0])} »`}) et s'arrête à ${r.retraite?.age ?? H.ageRetraite} ans. Montants ${unite}.</p>
      ${tuiles}${infoAchat}${infoPER}
      <div style="margin-top:10px">${graphiqueTrajectoire(C, defl, r, iRet)}</div>
      <p class="small" style="margin:6px 0 0" id="tr-ligne-retraite">À ${C[iRet].age} ans (retraite) : patrimoine net <b class="num">${eur(C[iRet].net * defl(iRet))}</b>, dont ${eur(C[iRet].financier * defl(iRet))} de placements. Survole le graphique pour lire chaque âge.</p>
    </section>
    ${siNiveau("intermediaire", () => `<div id="tr-objectifs" data-min="intermediaire">${blocObjectifs(r)}</div>`)}
    ${siNiveau("intermediaire", () => blocTranches(r, defl, unite))}
    ${siNiveau("avance", () => `<section class="panneau" id="tr-composition" data-min="avance"><h2>Composition des placements · scénario central</h2>
      <p class="note" style="margin:4px 0 8px">Rendements moyens du plan chaque année. Survole le graphique pour le détail.</p>${graphiqueComposition(C, defl, r.achat)}</section>`)}
    ${siNiveau("intermediaire", () => `<section class="panneau" id="tr-eventail" data-min="intermediaire"><h2>Éventail des possibles · ${r.simulations} scénarios</h2>
      <p class="note" style="margin:4px 0 8px">Les rendements sont tirés au hasard chaque année selon la volatilité de chaque classe (bitcoin très variable). La médiane est sous le scénario central : les années de baisse pèsent plus que les années de hausse.</p>${graphiqueEventail(C, E, defl)}</section>`)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-crise" data-min="avance"><h2>Et si une crise arrivait ?</h2>
      <p class="note" style="margin:4px 0 10px">On rejoue une crise passée sur ton portefeuille, puis les rendements moyens du plan. Pour voir ce que tu risques, et pourquoi il ne faut pas paniquer.</p>
      <div class="ligne-actions">
        <label for="crise-choix" class="small">Crise</label><select id="crise-choix" style="width:auto">${Object.entries(CRISES).map(([k, c]) => `<option value="${k}" ${k === uiCrise.id ? "selected" : ""}>${echapper(c.libelle)}</option>`).join("")}</select>
        <label for="crise-moment" class="small">Quand</label><select id="crise-moment" style="width:auto">${[["bientot", "L'année prochaine"], ["avant", "5 ans avant ta retraite"], ["retraite", "L'année où tu arrêtes de travailler"]].map(([k, l]) => `<option value="${k}" ${k === uiCrise.moment ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div id="crise-resultat" style="margin-top:10px"></div>
    </section>`)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-historique" data-min="avance"><h2>Rejouer l'histoire réelle (${HISTORIQUE.debut}–${HISTORIQUE.fin})</h2>
      <p class="note" style="margin:4px 0 10px">On applique à ton plan, une fenêtre après l'autre, les rendements et l'inflation réellement observés depuis ${HISTORIQUE.debut}. Ce n'est pas une prévision : le passé ne se répète pas à l'identique.</p>
      <div class="ligne-actions">
        <label for="hist-longueur" class="small">Durée</label><select id="hist-longueur" style="width:auto">${[20, 30].map((n) => `<option value="${n}" ${n === uiHistorique.longueur ? "selected" : ""}>${n} ans</option>`).join("")}</select>
        <label for="hist-depart" class="small">Départ</label><select id="hist-depart" style="width:auto"><option value="maintenant" ${uiHistorique.depart === "maintenant" ? "selected" : ""}>Maintenant</option><option value="retraite" ${uiHistorique.depart === "retraite" ? "selected" : ""}>À la retraite</option></select>
      </div>
      <div id="hist-resultat" style="margin-top:10px"></div>
    </section>`)}
    ${siNiveau("intermediaire", () => `<section class="panneau" id="bloc-inflation" data-min="intermediaire"><h2>Et si l'inflation restait à 4–6 % pendant 10 ans ?</h2>
      <div class="ligne-actions">
        <label for="infl-taux" class="small">Inflation</label><select id="infl-taux" style="width:auto">${[4, 5, 6].map((n) => `<option value="${n}" ${n === uiInflation.taux ? "selected" : ""}>${n} % par an</option>`).join("")}</select>
      </div>
      <div id="infl-resultat" style="margin-top:10px"></div>
    </section>`)}
    ${siNiveau("intermediaire", panneauRapporte)}
    ${siNiveau("avance", panneauApresImpots)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-ab" data-min="avance">${blocScenarios(r, reel)}</section>`)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-fiscal" data-min="avance"></section>`)}`;
  rendreCrise();
  rendreHistorique();
  rendreInflation();
  rendreFiscal();
  try { performance.measure(`rendreTrajectoire:${niveauCourant()}`, { start: t0 }); } catch {} // mesure lisible via performance.getEntriesByType("measure")
}

// ---------------------------------------------------------------- évolution de la fiscalité
// « Et si la fiscalité changeait ? » : tout est recalculé avec d'autres règles à partir d'une année choisie
let simFiscale = { scenario: "ps", annee: 1, perso: { ...NEUTRE, dPS: 1.4 }, ...(memo.get("sim-fiscale") ?? {}) };
let cacheFiscal = { cle: null, r: null, sens: null }, minuteurFiscal = null;
const reglesFiscales = () => (simFiscale.scenario === "perso" ? simFiscale.perso : SCENARIOS_FISCAUX.find((s) => s.id === simFiscale.scenario)?.h ?? {});
function rendreFiscal() {
  const el = $("#bloc-fiscal"); if (!el) return;
  const plan = etat.brouillon, base = projectionCourante(true), R = base.retraite;
  const iR = R?.iR ?? null, ageAuj = base.central[0]?.age ?? 0;
  const S = SCENARIOS_FISCAUX.find((s) => s.id === simFiscale.scenario);
  const P = simFiscale.perso;
  const annees = [[1, `En ${new Date().getFullYear() + 1} (prochaine loi de finances)`], [5, "Dans 5 ans"], [10, "Dans 10 ans"], ...(iR > 0 ? [[iR, `À ta retraite (${ageAuj + iR} ans)`]] : [])];
  const ch = (id, lib, v, aide = "") => `<label class="coche"><input type="checkbox" data-fs="${id}" ${v ? "checked" : ""}> ${lib}</label>${aide ? `<p class="note" style="margin:-4px 0 0">${aide}</p>` : ""}`;
  const nb = (id, lib, v, unite, pas, min, max) => `<div class="champ"><label for="fs-${id}">${lib}</label><div class="saisie"><input id="fs-${id}" type="number" step="${pas}" min="${min}" max="${max}" data-fs="${id}" value="${v}"><span>${unite}</span></div></div>`;
  el.innerHTML = `<h2>Et si la fiscalité changeait ?</h2>
    <p class="note" style="margin:4px 0 8px">Les règles changent presque chaque année avec la loi de finances : flat tax en 2018, prélèvements sociaux relevés en 2026, amortissement du meublé rogné en 2025… Choisis un changement possible et sa date : le site recalcule ta trajectoire et ta retraite avec ces nouvelles règles, pour voir à quel point ton plan en dépend. Ce sont des hypothèses, pas des prévisions.</p>
    <div class="champs" style="max-width:640px">
      <div class="champ"><label for="fs-scenario">Changement à tester</label><select id="fs-scenario">${SCENARIOS_FISCAUX.map((s) => `<option value="${s.id}" ${s.id === simFiscale.scenario ? "selected" : ""}>${echapper(s.nom)}</option>`).join("")}<option value="perso" ${simFiscale.scenario === "perso" ? "selected" : ""}>Mon propre scénario</option></select></div>
      <div class="champ"><label for="fs-annee">À partir de</label><select id="fs-annee">${annees.map(([v, l]) => `<option value="${v}" ${v === simFiscale.annee ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    ${S ? `<p class="small" style="margin:6px 0 0">${echapper(S.texte)}</p>` : ""}
    <details id="fs-perso" style="margin-top:8px" ${simFiscale.scenario === "perso" ? "open" : ""}><summary class="small"><b>Construire mon propre scénario</b></summary>
      <div class="champs" style="max-width:640px;margin-top:8px">
        ${nb("dPS", "Prélèvements sociaux : variation (18,6 % aujourd'hui)", P.dPS, "points", 0.1, -5, 10)}
        ${nb("dIR", "Part impôt de la flat tax : variation (12,8 % aujourd'hui)", P.dIR, "points", 0.1, -5, 20)}
        ${ch("peaIR", "Le PEA de plus de 5 ans paie aussi l'impôt sur le revenu", P.peaIR)}
        ${ch("avFin", "L'assurance-vie de plus de 8 ans perd son taux réduit", P.avFin)}
        ${ch("livrets", "Les intérêts du Livret A, du LDDS et du LEP deviennent imposés", P.livrets)}
        ${ch("lmnpFin", "Fin de l'amortissement en location meublée (LMNP)", P.lmnp === false)}
        ${nb("perDed", "PER : part de l'économie d'impôt qui reste", P.perDed, "%", 10, 0, 100)}
        <div class="champ"><label for="fs-perSortie">PER : tranche appliquée à la sortie</label><select id="fs-perSortie" data-fs="perSortie">${[["", `Celle du plan (${plan.per?.tmiRetraite ?? 11} %)`], ["0", "0 %"], ["11", "11 %"], ["30", "30 %"], ["41", "41 %"]].map(([v, l]) => `<option value="${v}" ${String(P.perSortie ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
    </details>
    <div id="fs-resultat" style="margin-top:12px"><p class="muted small">Calcul en cours…</p></div>`;
  clearTimeout(minuteurFiscal);
  minuteurFiscal = setTimeout(calculerFiscal, 60);
}
function calculerFiscal() {
  const out = $("#fs-resultat"); if (!out) return;
  const plan = etat.brouillon, H = plan.hypotheses, infl = (H.inflation ?? 0) / 100;
  const profil = profilPourMoteur();
  const h = reglesFiscales(), annee = simFiscale.annee;
  const cle = JSON.stringify([cleProjectionEnCache(), h, annee]);
  let base, r;
  try {
    base = projectionCourante(true);
    if (cacheFiscal.cle !== cle) {
      r = projeter(plan, profil, { inclureAchat: true, fiscF: optionFiscale(plan, h, annee) });
      // Sensibilité : chaque changement seul, scénario central (rapide)
      const ref = projeterCentral(plan, profil, { inclureAchat: true });
      const ecart = (pts, i) => pts.central[i] ? pts.central[i].financier - pts.central[i].impotPlacements - pts.central[i].impotPER : 0;
      const sens = SCENARIOS_FISCAUX.filter((s) => !["noir", "baisse"].includes(s.id)).map((s) => {
        const c = projeterCentral(plan, profil, { inclureAchat: true, fiscF: optionFiscale(plan, s.h, annee) });
        return { s, retraite: ecart(c, ref.iR) - ecart(ref, ref.iR), fin: ecart(c, ref.dernier) - ecart(ref, ref.dernier), iR: ref.iR, dernier: ref.dernier };
      }).sort((a, b) => a.retraite - b.retraite);
      cacheFiscal = { cle, r, sens };
    }
    r = cacheFiscal.r;
  } catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Calcul impossible : ${echapper(e.message)}</p>`; return; }
  const R0 = base.retraite, R1 = r.retraite;
  if (!R0 || !R1) { out.innerHTML = '<p class="muted small">La retraite est hors de la période projetée : pas de comparaison possible.</p>'; return; }
  const iR = R0.iR, iF = R0.dernier;
  const reel = (v, i) => v / Math.pow(1 + infl, i);
  const net = (pts, i) => pts.central[i].financier - pts.central[i].impotPlacements - pts.central[i].impotPER;
  const ecartTxt = (a, b, unite = "") => { const d = b - a; return Math.abs(d) < 0.5 ? '<span class="muted">inchangé</span>' : `<span class="${d < 0 ? "ecart-moins" : "ecart-plus"}">${d < 0 ? "−" : "+"}${eur(Math.abs(d))}${unite}${a > 0 ? ` (${d < 0 ? "−" : "+"}${pct(Math.abs((100 * d) / a))})` : ""}</span>`; };
  const tuiles = [
    [`Placements après impôts à ${base.central[iR].age} ans (départ)`, reel(net(base, iR), iR), reel(net(r, iR), iR), ""],
    ["Revenu possible sans entamer le capital", R0.revenuPreserve ?? 0, R1.revenuPreserve ?? 0, "/mois"],
    [`Placements après impôts à ${base.central[iF].age} ans`, reel(net(base, iF), iF), reel(net(r, iF), iF), ""],
  ];
  const pctD = (x) => `${Math.round(x * 100)} %`;
  const taux = comparerTaux(plan, h, tauxGains(plan, profilPourMoteur(), "scpi")).filter((l) => Math.abs(l.apres - l.avant) > 0.05 || l.avant > 0);
  const sens = cacheFiscal.sens ?? [];
  const pire = sens[0];
  out.innerHTML = `<div class="tuiles">${tuiles.map(([k, a, b, u]) => `<div class="tuile"><span>${k}</span><b class="num">${eur(b)}${u}</b><span class="small">${ecartTxt(a, b, u)} par rapport aux règles actuelles (${eur(a)}${u})</span></div>`).join("")}
      <div class="tuile"><span>Chances que l'argent dure jusqu'à ${base.central[iF].age} ans</span><b class="num">${pctD(R1.probaDure)}</b><span class="small">${Math.round(R1.probaDure * 100) === Math.round(R0.probaDure * 100) ? '<span class="muted">inchangé</span>' : `<span class="${R1.probaDure < R0.probaDure ? "ecart-moins" : "ecart-plus"}">${pctD(R0.probaDure)} avec les règles actuelles</span>`}</span></div></div>
    <p class="note" style="margin:6px 0 0">En euros d'aujourd'hui, scénario central (rendements moyens) ; les chances viennent des ${r.simulations} scénarios tirés au hasard. Les nouvelles règles s'appliquent à partir de ${new Date().getFullYear() + simFiscale.annee} : aux ventes, aux retraits de la retraite, aux loyers, aux intérêts des livrets et aux versements sur le PER.</p>
    <h3 style="margin:14px 0 4px">Ce qui change, produit par produit</h3>
    <div class="table-wrap"><table><thead><tr><th>Produit</th><th class="m">Taux sur les gains aujourd'hui</th><th class="m">Dans ce scénario</th></tr></thead><tbody>
      ${taux.map((l) => `<tr><td>${l.nom}</td><td class="m">${pct(l.avant)}</td><td class="m">${Math.abs(l.apres - l.avant) > 0.05 ? `<b class="${l.apres > l.avant ? "ecart-moins" : "ecart-plus"}">${pct(l.apres)}</b>` : pct(l.apres)}</td></tr>`).join("")}
      ${(h.perDed ?? 100) !== 100 ? `<tr><td>PER : économie d'impôt sur les versements</td><td class="m">100 %</td><td class="m"><b class="ecart-moins">${h.perDed} %</b></td></tr>` : ""}
      ${h.lmnp === false ? `<tr><td>Meublé (LMNP au réel) : amortissement</td><td class="m">Oui</td><td class="m"><b class="ecart-moins">Supprimé</b></td></tr>` : ""}
    </tbody></table></div>
    <h3 style="margin:14px 0 4px">Pour toi, quels changements pèseraient le plus ?</h3>
    <p class="note" style="margin:0 0 6px">Chaque changement testé seul, à partir de ${new Date().getFullYear() + simFiscale.annee}, sur tes placements après impôts (scénario central, euros d'aujourd'hui).</p>
    <div class="table-wrap"><table><thead><tr><th>Changement</th><th class="m">À ton départ</th><th class="m">À ${base.central[iF].age} ans</th></tr></thead><tbody>
      ${sens.map((x) => `<tr><td>${echapper(x.s.nom)}</td><td class="m">${ecartTxt(0, reel(x.retraite, x.iR)).replace(/ \(.*\)/, "")}</td><td class="m">${ecartTxt(0, reel(x.fin, x.dernier)).replace(/ \(.*\)/, "")}</td></tr>`).join("")}
    </tbody></table></div>
    <ul class="points" style="margin-top:10px">
      ${pire && pire.retraite < -1000 ? `<li>Ton plan est le plus sensible à : <b>${echapper(pire.s.nom.toLowerCase())}</b>. C'est le risque fiscal à surveiller à chaque loi de finances (en décembre).</li>` : `<li>Aucun changement testé seul ne pèse beaucoup sur ton plan : ta fiscalité est bien répartie.</li>`}
      <li>Répartir son épargne entre plusieurs enveloppes (PEA, assurance-vie, PER, livrets) limite ce risque : une réforme touche rarement tout à la fois.</li>
      <li>Les réformes épargnent souvent l'argent déjà placé : en 2017, la flat tax de l'assurance-vie n'a visé que les versements faits après le 27 septembre 2017. Ouvrir tôt un PEA et une assurance-vie, même avec peu, garde l'antériorité.</li>
      <li>Ici, par prudence, les nouvelles règles s'appliquent à tout, y compris à l'argent déjà placé : c'est le pire cas.</li>
    </ul>`;
}
// ---------------------------------------------------------------- comparer des scénarios
// Jusqu'à 3 scénarios figés (mémorisés dans ce navigateur et dans l'export), comparés au profil actuel.
const MAX_SCENARIOS = 3, COULEURS_SC = ["--s2", "--s5", "--s7"];
// Rangés par profil : chaque profil (l'exemple, le tien, ceux des proches) a ses propres scénarios
const cleScenarios = () => `scenarios:${cleProfilCourant()}`;
export function scenariosGardes() {
  let L = memo.get(cleScenarios());
  if (!Array.isArray(L)) {
    // Anciennes versions : une seule liste pour tout le navigateur, attribuée au premier profil qui l'ouvre
    const ancien = memo.get("scenarios"), A = memo.get("scenario-A");
    L = Array.isArray(ancien) ? ancien : A ? [A] : [];
    memo.set(cleScenarios(), L);
    try { localStorage.removeItem("scenarios"); localStorage.removeItem("scenario-A"); } catch {}
  }
  return L.slice(0, MAX_SCENARIOS);
}
export function garderScenarios(L) { return memo.set(cleScenarios(), L.slice(0, MAX_SCENARIOS)); }
function blocScenarios(r, reel) {
  const H = etat.brouillon.hypotheses, infl = (H.inflation ?? 0) / 100;
  const S = scenariosGardes();
  const lettre = (k) => String.fromCharCode(65 + k);
  const intro = `<h2>Comparer des scénarios</h2>
    <p class="note" style="margin:4px 0 8px">Par exemple « locataire, 100 % ETF », « achat de ma résidence », « investissement locatif » ou « départ à 55 ans ». Fige le scénario actuel sous un nom, change ton profil, fige le suivant (3 au plus) : chaque courbe se superpose au profil actuel (patrimoine net, scénario central). Survole le graphique pour lire les écarts année par année.</p>
    <div class="ligne-actions"><input id="ab-nom" type="text" class="texte" maxlength="40" placeholder="Nom du scénario (ex. Locataire, 100 % ETF)" style="max-width:280px"><button type="button" class="principal" id="ab-figer" ${S.length >= MAX_SCENARIOS ? "disabled" : ""}>Figer le scénario actuel${S.length ? ` (${lettre(S.length)})` : " (A)"}</button>${S.length >= MAX_SCENARIOS ? `<span class="small muted">3 scénarios au plus : supprimes-en un pour en figer un autre.</span>` : ""}</div>
    ${S.length ? `<ul class="points" style="margin:8px 0 0">${S.map((x, k) => `<li><span class="trait" style="display:inline-block;width:18px;height:3px;vertical-align:middle;background:var(${COULEURS_SC[k]})"></span> <b>${lettre(k)} : ${echapper(x.nom || "sans nom")}</b> <span class="small muted">figé le ${new Date(x.date).toLocaleDateString("fr-FR")}</span> <button type="button" class="lien" data-suppr-sc="${k}">Supprimer</button></li>`).join("")}</ul>` : ""}`;
  if (!S.length) return intro;
  const B = r.central.map((p, i) => ({ age: p.age, v: p.net, i }));
  const val = (x) => (reel ? x.v / Math.pow(1 + infl, x.i) : x.v);
  const ages = B.map((b) => b.age);
  const serie = (sc) => ages.map((a) => { const p = sc.points.find((q) => q.age === a); return p ? { age: a, v: p.net, i: p.i } : null; });
  const series = S.map(serie);
  const tous = [...B.map(val), ...series.flatMap((se) => se.filter(Boolean).map(val))];
  const { W, H: Hh, g, d, h, b } = GEOM;
  const ymax = echelle(Math.max(1, ...tous)), ymin = Math.min(0, ...tous);
  const x = (i) => g + (i * (W - g - d)) / Math.max(1, ages.length - 1);
  const y = (v) => Hh - b - ((v - ymin) * (Hh - b - h)) / (ymax - ymin || 1);
  const chemin = (se) => se.map((p, i) => (p ? `${x(i).toFixed(1)},${y(val(p)).toFixed(1)}` : null)).filter(Boolean).join(" ");
  let svg = `<svg class="graphe" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Patrimoine net des scénarios figés et du profil actuel selon l'âge">`;
  for (let k = 0; k <= 4; k++) { const v = ymin + ((ymax - ymin) * k) / 4; svg += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`; }
  ages.forEach((a, i) => { if (i % 5 === 0 || i === ages.length - 1) svg += `<text x="${x(i)}" y="${Hh - 9}" text-anchor="middle">${a} ans</text>`; });
  svg += `<line class="axe" x1="${g}" x2="${W - d}" y1="${Hh - b}" y2="${Hh - b}"/>`;
  series.forEach((se, k) => { svg += `<polyline points="${chemin(se)}" fill="none" stroke="var(${COULEURS_SC[k]})" stroke-width="2" stroke-dasharray="6 4"/>`; });
  svg += `<polyline points="${chemin(B)}" fill="none" stroke="var(--s1)" stroke-width="2.5"/>`;
  svg += colonnesSurvol(ages, x, (i) => {
    const vb = val(B[i]);
    return `${ages[i]} ans\nActuel : ${eur(vb)}` + series.map((se, k) => (se[i] ? `\n${lettre(k)} (${S[k].nom || "sans nom"}) : ${eur(val(se[i]))} · actuel ${vb - val(se[i]) >= 0 ? "+" : "−"}${eur(Math.abs(vb - val(se[i])))}` : "")).join("");
  }, "curseur-ab");
  svg += `</svg>`;
  const idx = ages.map((a, i) => i).filter((i) => i % 5 === 0 || i === ages.length - 1);
  const lignes = idx.map((i) => `<tr><td>${ages[i]} ans</td><td class="m"><b>${eur(val(B[i]))}</b></td>${series.map((se) => { if (!se[i]) return '<td class="m muted">—</td>'; const dd = val(B[i]) - val(se[i]); return `<td class="m">${eur(val(se[i]))}<div class="small"><span class="${dd >= 0 ? "ecart-plus" : "ecart-moins"}">actuel ${dd >= 0 ? "+" : "−"}${eur(Math.abs(dd))}</span></div></td>`; }).join("")}</tr>`).join("");
  return intro + `<div style="margin-top:10px">${svg}</div>
    <div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Profil actuel</span>${S.map((sc, k) => `<span><span class="trait" style="background:var(${COULEURS_SC[k]})"></span>${lettre(k)} : ${echapper(sc.nom || "sans nom")}</span>`).join("")}</div>
    <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Âge</th><th class="m">Actuel</th>${S.map((sc, k) => `<th class="m">${lettre(k)} : ${echapper(sc.nom || "sans nom")}</th>`).join("")}</tr></thead><tbody>${lignes}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">Patrimoine net (placements + immobilier − crédits), scénario central, ${reel ? "en euros d'aujourd'hui" : "en euros de l'époque"}. Les scénarios sont gardés dans ce navigateur et dans l'export de tes données.</p>`;
}

// Crise rejouée : trois trajectoires (sans crise, en gardant le cap, en paniquant)
const uiCrise = { id: memo.get("crise-id") ?? "2008", moment: memo.get("crise-moment") ?? "bientot" };
function rendreCrise() {
  const out = $("#crise-resultat"); if (!out) return;
  const plan = etat.brouillon, H = plan.hypotheses;
  const p = profilPourMoteur(), age0 = Math.round(normaliserProfil(p).age ?? 30);
  const PRage = projectionCourante(achatInclus()).retraite?.age ?? H.ageRetraite ?? 64;
  const ageDebut = uiCrise.moment === "bientot" ? age0 + 1 : uiCrise.moment === "avant" ? Math.max(age0 + 1, PRage - 5) : Math.max(age0 + 1, PRage);
  let r;
  try { r = simulerCrise(plan, p, { crise: uiCrise.id, ageDebut, inclureAchat: achatInclus() }); }
  catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const reel = montantsReels(), infl = (H.inflation ?? 0) / 100;
  const defl = (i) => (reel ? Math.pow(1 + infl, -i) : 1);
  const S = r.sans, G = r.garde, P = r.panique, d = r.debut, n = r.crise.annees.length;
  const ages = S.map((pt) => pt.age);
  // Pire moment, retour au niveau d'avant, écarts à la retraite
  // Pire moment : le plus grand écart avec la même vie sans crise (achat et retraits compris des deux côtés)
  let iMin = d; for (let i = d; i <= Math.min(S.length - 1, d + n + 2); i++) if (G[i].financier / (S[i].financier || 1) < G[iMin].financier / (S[iMin].financier || 1)) iMin = i;
  const perte = S[iMin].financier - G[iMin].financier, avant = G[d].financier;
  const iRetour = G.findIndex((pt, i) => i > d && i > iMin && pt.financier >= avant);
  const iRet = Math.min(S.length - 1, d + 10);  // comparaison 10 ans après le début de la crise
  const cmp = (a, b) => `${a >= b ? "+" : "−"}${eur(Math.abs(a - b))} (${a >= b ? "+" : "−"}${pct(Math.abs(100 * (a - b) / (b || 1)))})`;
  const ymax = echelle(Math.max(...S.map((pt, i) => Math.max(pt.financier, G[i].financier, P[i].financier) * defl(i))));
  const { x, y, s } = cadre(ages, ymax);
  const ligne = (T, coul, larg, tiret) => `<path d="${T.map((pt, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pt.financier * defl(i)).toFixed(1)}`).join("")}" fill="none" stroke="${coul}" stroke-width="${larg}"${tiret ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Placements avec et sans crise">${s}`;
  svg += `<rect x="${x(d)}" y="${GEOM.h}" width="${Math.max(2, x(Math.min(S.length - 1, d + n)) - x(d))}" height="${GEOM.H - GEOM.b - GEOM.h}" fill="var(--warn)" fill-opacity="0.08"/>`;
  svg += ligne(S, "var(--muted)", 1.5, true) + ligne(P, "var(--s2)", 2) + ligne(G, "var(--s1)", 2.5);
  svg += colonnesSurvol(ages, x, (i) => `${ages[i]} ans\nSans crise : ${eur(S[i].financier * defl(i))}\nCrise, en gardant le cap : ${eur(G[i].financier * defl(i))}\nCrise, en paniquant : ${eur(P[i].financier * defl(i))}`, "curseur-crise");
  svg += `</svg><div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Crise, en gardant le cap</span><span><span class="trait" style="background:var(--s2)"></span>Crise, en paniquant (tout vendu au plus bas, retour 2 ans plus tard)</span><span><span class="trait" style="background:var(--muted)"></span>Sans crise (pointillés)</span><span><span class="pastille" style="background:var(--warn);opacity:.3"></span>Années de crise</span></div>`;
  const tuiles = [
    [`Pire moment (${ages[iMin]} ans), par rapport à sans crise`, `−${eur(perte * defl(iMin))} (−${pct(100 * perte / (S[iMin].financier || 1))})`],
    ["Retour au niveau d'avant la crise", iRetour > 0 ? `${iRetour - d} an(s) après le début` : "pas avant la fin de la projection"],
    [`10 ans après (${ages[iRet]} ans), en gardant le cap`, cmp(G[iRet].financier * defl(iRet), S[iRet].financier * defl(iRet))],
    [`10 ans après (${ages[iRet]} ans), en paniquant`, cmp(P[iRet].financier * defl(iRet), S[iRet].financier * defl(iRet))],
  ];
  out.innerHTML = `<p class="small" style="margin:0 0 8px"><b>${echapper(r.crise.libelle)}</b>, rejouée à partir de ${ages[d]} ans : ${echapper(r.crise.resume)}</p>
    ${svg}
    <div class="tuiles quatre">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
    <ul class="points" style="margin-top:4px">
      <li>${texteLie(`Dix ans après le début de la crise, garder le cap coûte ${eur(Math.max(0, (S[iRet].financier - G[iRet].financier) * defl(iRet)))} par rapport à une vie sans crise ; paniquer au plus bas coûte ${eur(Math.max(0, (G[iRet].financier - P[iRet].financier) * defl(iRet)))} de plus. Vendre après la baisse, c'est rendre la perte définitive et rater la remontée.`)}</li>
      <li>${texteLie("Pendant la crise, l'épargne de chaque mois continue d'acheter, mais moins cher : c'est ce qui fait remonter le portefeuille plus vite que la bourse elle-même. C'est tout l'intérêt d'investir progressivement, chaque mois.")}</li>
      <li>${texteLie("L'épargne de sécurité, l'assurance-vie, les obligations et l'or amortissent le choc : c'est pour ça que le plan ne met jamais tout en bourse, et devient plus prudent avec l'âge.")}</li>
      <li>${texteLie("Une crise juste avant ou au début de la retraite fait plus mal : on vend pour vivre pendant que les prix sont bas. D'où la réserve sans risque de 2 à 3 ans de retraits (onglet Retraite).")}</li>
    </ul>
    <p class="note" style="margin:8px 0 0">Rendements de crise approximatifs (ordres de grandeur en euros : bourse 70 % S&amp;P 500, 30 % STOXX Europe 600 ; le bitcoin n'existant pas avant 2009, on lui applique une chute comparable à 2018 et 2022). Après la crise, les rendements moyens du plan s'appliquent. Montants ${reel ? "en euros d'aujourd'hui" : "en euros de l'époque"}.</p>`;
}
// Histoire réelle rejouée (fenêtres glissantes sur HISTORIQUE) et inflation persistante
const uiHistorique = { longueur: Number(memo.get("hist-longueur")) === 20 ? 20 : 30, depart: memo.get("hist-depart") === "maintenant" ? "maintenant" : "retraite" };
const uiInflation = { taux: [4, 5, 6].includes(Number(memo.get("infl-taux"))) ? Number(memo.get("infl-taux")) : 5 };
let cacheHistorique = { cle: null, r: null };
let cacheInflation = { cle: null, r: null };
function rendreHistorique() {
  const out = $("#hist-resultat"); if (!out) return;
  if (!HISTORIQUE.annees?.length) { out.innerHTML = `<p class="note">Données historiques indisponibles.</p>`; return; }
  const plan = etat.brouillon, p = profilPourMoteur();
  const retraiteDeja = (Math.round(normaliserProfil(p).age ?? 0)) >= (projectionCourante(achatInclus()).retraite?.age ?? plan.hypotheses.ageRetraite ?? 64);
  const depart = retraiteDeja ? "maintenant" : uiHistorique.depart;
  const sel = $("#hist-depart"); if (sel) { sel.disabled = retraiteDeja; sel.value = depart; }
  const cle = JSON.stringify([plan, etat.profil, achatInclus(), uiHistorique.longueur, depart]);
  let r;
  try {
    if (cacheHistorique.cle === cle) r = cacheHistorique.r;
    else { r = backtesterHistorique(plan, p, { series: HISTORIQUE.annees, longueur: uiHistorique.longueur, depart, inclureAchat: achatInclus(), estimations: HISTORIQUE.estimations }); cacheHistorique = { cle, r }; }
  } catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  if (!r.fenetres.length) { out.innerHTML = `<p class="note">Données historiques indisponibles pour cette durée.</p>`; return; }
  const S = r.synthese, ages = r.fenetres[0].trajectoireReelle.map((pt) => pt.age);
  const ymax = echelle(Math.max(1, ...r.fenetres.map((f) => Math.max(...f.trajectoireReelle.map((pt) => pt.valeur)))));
  const { x, y, s } = cadre(ages, ymax);
  const trace = (f, coul, larg, op) => `<path d="${f.trajectoireReelle.map((pt, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pt.valeur).toFixed(1)}`).join("")}" fill="none" stroke="${coul}" stroke-width="${larg}" stroke-opacity="${op}" stroke-linejoin="round"/>`;
  const cible = (R) => r.fenetres.find((f) => R && f.debut === R.debut && f.fin === R.fin);
  const fPire = cible(S.pire), fMed = cible(S.mediane);
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Trajectoires du capital selon toutes les périodes historiques">${s}`;
  svg += r.fenetres.map((f) => trace(f, "var(--s1)", 1, 0.22)).join("");
  if (fMed) svg += trace(fMed, "var(--s1)", 2.5, 1);
  if (fPire) svg += trace(fPire, "var(--s2)", 2.5, 1);
  svg += colonnesSurvol(ages, x, (i) => `${ages[i]} ans\nPire période (${S.pire.debut}–${S.pire.fin}) : ${eur(fPire?.trajectoireReelle[i]?.valeur ?? 0)}\nPériode médiane (${S.mediane.debut}–${S.mediane.fin}) : ${eur(fMed?.trajectoireReelle[i]?.valeur ?? 0)}`, "curseur-hist");
  svg += `</svg><div class="legende-g"><span><span class="trait" style="background:var(--s1);opacity:.4"></span>Chaque période historique</span><span><span class="trait" style="background:var(--s1)"></span>Période médiane</span><span><span class="trait" style="background:var(--s2)"></span>Pire période</span></div>`;
  const estimeesDe = (f) => {
    const L = r.estimationsLibelles ?? {};
    const t = ["scpi", "prudent", "bitcoin"].filter((c) => f?.anneesEstimees?.[c] > 0 && L[c]).map((c) => `${f.anneesEstimees[c]} ${f.anneesEstimees[c] > 1 ? "ans" : "an"} ${L[c]}`);
    return t.join(", ");
  };
  const ligneS = (lib, R) => {
    if (!R) return "";
    const e = estimeesDe(cible(R));
    return `<li>${lib} : ${R.debut}–${R.fin}, capital réel en fin de fenêtre <b class="num">${eur(R.capitalReelFinFenetre)}</b>${e ? ` <span class="small">(${echapper(e)})</span>` : ""}</li>`;
  };
  const nbMesurees = r.fenetres.filter((f) => !(f.anneesEstimees?.scpi > 0) && !(f.anneesEstimees?.prudent > 0)).length;
  const detientBtc = r.fenetres.some((f) => f.anneesEstimees?.bitcoin > 0);
  const trois = [...r.fenetres].sort((a, b) => a.capitalReelFinFenetre - b.capitalReelFinFenetre).slice(0, 3);
  const substit = r.fenetres.some((f) => f.anneesEstimees?.bitcoin > 0);
  const sources = Object.entries(HISTORIQUE.sources ?? {}).filter(([, v]) => v);
  const fiabilite = Object.entries(HISTORIQUE.fiabilite ?? {}).filter(([, v]) => v);
  out.innerHTML = `<p style="margin:0 0 6px"><b>Dans ${Math.round(100 * (S.tauxSucces ?? 0))} % des périodes historiques, ton capital aurait tenu</b> (${S.nb} périodes de ${r.longueur} ans, départ à ${r.ageDepart} ans).</p>
    ${svg}
    <ul class="points" style="margin-top:6px">${ligneS("Pire", S.pire)}${ligneS("Médiane", S.mediane)}${ligneS("Meilleure", S.meilleure)}
      <li>Scénario central du plan, au même horizon (patrimoine financier en euros d'aujourd'hui) : <b class="num">${eur(r.centralReelFinFenetre)}</b></li></ul>
    <p class="note" style="margin:6px 0 0">${nbMesurees} période${nbMesurees > 1 ? "s" : ""} sur ${S.nb} ${nbMesurees > 1 ? "reposent" : "repose"} uniquement sur des données mesurées${detientBtc ? " (hors bitcoin, remplacé par les actions avant 2018)" : ""}.</p>
    <div class="table-wrap"><table><caption class="small" style="text-align:left">Les 3 pires périodes</caption><thead><tr><th>Période</th><th>Inflation moyenne</th><th>Capital réel en fin de période</th><th>Capital épuisé à</th><th>Données estimées</th></tr></thead><tbody>
      ${trois.map((f) => `<tr><td>${f.debut}–${f.fin}</td><td>${pct(f.inflationMoyenne)}</td><td class="num">${eur(f.capitalReelFinFenetre)}</td><td>${f.ageEpuisement != null ? `${f.ageEpuisement} ans` : "—"}</td><td>${echapper(estimeesDe(f)) || "—"}</td></tr>`).join("")}</tbody></table></div>
    ${substit ? `<p class="note" style="margin:8px 0 0">Avant 2018, le bitcoin n'était pas accessible de façon réaliste et liquide à un épargnant français : sa part est remplacée par des actions pour les années concernées.</p>` : ""}
    ${sources.length ? `<details style="margin-top:8px"><summary class="small">Sources</summary><ul class="points">${sources.map(([k, v]) => `<li><b>${echapper(k)}</b> : ${echapper(v)}</li>`).join("")}${fiabilite.map(([k, v]) => `<li><b>${echapper(k)}</b> : Données estimées : ${echapper(v)}</li>`).join("")}</ul></details>` : ""}`;
}
function rendreInflation() {
  const out = $("#infl-resultat"); if (!out) return;
  const plan = etat.brouillon, p = profilPourMoteur();
  const cle = JSON.stringify([plan, etat.profil, achatInclus(), uiInflation.taux]);
  let r;
  try {
    if (cacheInflation.cle === cle) r = cacheInflation.r;
    else { r = scenarioInflation(plan, p, { taux: uiInflation.taux, inclureAchat: achatInclus() }); cacheInflation = { cle, r }; }
  } catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const classes = [["securite", "Livrets"], ["prudent", "Fonds euros"], ["bourse", "Actions"], ["or", "Or"], ["scpi", "SCPI"], ["bitcoin", "Bitcoin"]];
  const L = 680, ligneH = 26, gauche = 110, droite = 56, H = classes.length * ligneH + 22;
  const finale = (k) => { const s = r.indicesReels[k]; return Array.isArray(s) && s.length ? s[s.length - 1] : 0; };
  const vmax = Math.max(120, ...classes.map(([k]) => finale(k))) * 1.05;
  const xv = (v) => gauche + (v / vmax) * (L - gauche - droite);
  let svg = `<svg class="graphe" viewBox="0 0 ${L} ${H}" role="img" aria-label="Pouvoir d'achat final par classe d'actifs, base 100">`;
  classes.forEach(([k, lib], i) => {
    const v = finale(k), yy = 8 + i * ligneH;
    svg += `<text x="${gauche - 8}" y="${yy + 14}" text-anchor="end">${lib}</text><rect x="${gauche}" y="${yy + 2}" width="${Math.max(1, xv(v) - gauche).toFixed(1)}" height="${ligneH - 8}" fill="${v >= 100 ? "var(--s1)" : "var(--s2)"}" fill-opacity="0.85"/><text x="${xv(v) + 6}" y="${yy + 14}">${Math.round(v)}</text>`;
  });
  svg += `<line x1="${xv(100)}" x2="${xv(100)}" y1="4" y2="${H - 14}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${xv(100)}" y="${H - 2}" text-anchor="middle">100 = pouvoir d'achat d'aujourd'hui</text></svg>`;
  const E = r.patrimoine, R = r.retraite;
  const ageTxt = (a) => (a == null ? "pas d'épuisement" : `${a} ans`);
  const effet = R.ageEpuisementCentral !== R.ageEpuisementScenario
    ? `<li>Effet sur la retraite : capital épuisé à ${ageTxt(R.ageEpuisementScenario)} au lieu de ${ageTxt(R.ageEpuisementCentral)} dans le scénario central.</li>` : "";
  const S = SCENARIO_INFLATION;
  out.innerHTML = `${svg}
    <ul class="points" style="margin-top:6px">
      <li>Dans ${r.duree} ans, ton patrimoine financier réel (hors résidence) serait de <b class="num">${eur(E.scenarioReel)}</b> contre <b class="num">${eur(E.centralReel)}</b> dans le scénario central, soit <b class="num">${E.ecart >= 0 ? "+" : "−"}${eur(Math.abs(E.ecart))}</b> (${E.ecart >= 0 ? "+" : "−"}${pct(Math.abs(E.ecartPct))}).</li>${effet}${achatInclus() ? `<li>Ce résultat inclut ton projet d'achat : avec un crédit à taux fixe, les mensualités ne bougent pas alors que le loyer évité suit l'inflation, ce qui amortit le choc.</li>` : ""}</ul>
    <details style="margin-top:8px"><summary class="small">Hypothèses du scénario</summary><ul class="points">
      <li>Ce sont des hypothèses de travail, pas des données mesurées.</li>
      <li>Inflation constante à ${r.taux} % pendant ${r.duree} ans, à partir d'aujourd'hui.</li>
      <li>Livrets : taux de l'inflation moins ${S.ecartLivrets} point (au minimum ${S.plancherLivrets} %).</li>
      <li>Fonds euros : le rendement monte de ${S.prudentHausseParAn} point par an, sans dépasser l'inflation moins ${S.prudentEcartPlafond} point.</li>
      <li>Actions : rendement réel moyen du plan, moins ${Math.abs(S.bourseChocReel)} points les ${S.bourseAnneesChoc} premières années (hausse des taux).</li>
      <li>Or : plus ${S.orPrimeReelle} points de rendement réel (valeur refuge). SCPI : moins ${Math.abs(S.scpiPrimeReelle)} point (loyers indexés avec retard). Bitcoin : rendement réel inchangé.</li></ul></details>`;
}
function choisirAgeAchat(v) {
  etat.profil.projetRP ??= {};
  etat.profil.projetRP.ageChoisi = v > 0 ? v : null;
  memo.set("profil-v2", etat.profil);
  rendreResultats(); rendreTrajectoire(); planifierSauvegardeProfil();
}
// Tous les 5 ans : âge, salaire, épargne, placements et répartition ; les bascules du plan
function basculesDuPlan(r) {
  const plan = etat.brouillon, H = plan.hypotheses, C = r.central;
  const p0 = normaliserProfil(etat.profil);
  const R = profilRisque(plan, p0);
  const ev = [];
  const part = (pt, c) => (pt.financier > 0 ? (pt.classes?.[c] ?? 0) / pt.financier : 0);
  const ENTREES = {
    bitcoin: "Le bitcoin entre dans la répartition",
    or: "L'or physique entre dans la répartition",
    scpi: "L'immobilier (SCPI) entre dans la répartition",
  };
  for (const [c, texte] of Object.entries(ENTREES)) {
    if (!plan.classes[c]) continue;
    // Première apparition seulement (une classe déjà détenue aujourd'hui n'« entre » pas)
    const y = C.findIndex((pt, k) => part(pt, c) >= 0.005 && C.slice(0, k).every((q) => part(q, c) < 0.005));
    if (y > 0) ev.push({ y, court: texte.replace(" dans la répartition", ""), texte: `${texte} : le capital atteint environ ${keur(C[y].financier)}. Sa part monte ensuite progressivement, selon les paliers de capital du plan.` });
  }
  const debut = plan.age.ageDebut + (R.decalageAge ?? 0);
  const y0 = debut - C[0].age;
  if (y0 > 0 && y0 < C.length) ev.push({ y: y0, court: "Début de la prudence", texte: `Début du passage progressif vers la prudence (profil ${R.libelle ?? ""}) : chaque année, ${pct(plan.age.pointsParAn)} du capital passe des placements risqués vers l'assurance-vie et les obligations, jusqu'à ${pct(plan.age.maxPoints)} au total.` });
  else if (y0 <= 0) ev.push({ y: 0, court: "Prudence en cours", texte: `Le passage progressif vers la prudence a déjà commencé (depuis ${debut} ans) : ${pct(plan.age.pointsParAn)} du capital par an vers l'assurance-vie et les obligations.` });
  const iA = C.findIndex((pt) => pt.evenement === "achat");
  if (iA >= 0 && r.achat) {
    ev.push({ y: iA, court: "Achat de la résidence", texte: `Achat de la résidence principale (${eur(r.achat.prix)}) : ${eur(r.achat.apportRequis)} d'apport pris sur les placements, crédit de ${eur(r.achat.mensualite)} par mois pendant ${r.achat.duree} ans.` });
    const fin = iA + r.achat.duree;
    if (fin < C.length) ev.push({ y: fin, court: "Fin du crédit", texte: "Fin du crédit immobilier : la mensualité redevient de l'épargne." });
  }
  const yR = (r.retraite?.age ?? H.ageRetraite ?? 64) - C[0].age;
  if (yR > 0 && yR < C.length) ev.push({ y: yR, court: "Retraite", texte: `Retraite : l'épargne s'arrête et tu te verses ${eur(r.retraite?.revenu ?? 0)} par mois (en euros d'aujourd'hui) pris sur tes placements. Détail dans l'onglet « 4. Retraite ».` });
  // Investissement locatif
  const iL = C.findIndex((p) => p.locatif);
  if (iL >= 0) ev.push({ y: iL, court: "Locatif", texte: {
    achat: "Achat du bien locatif : l'apport sort des placements, le crédit commence, les loyers arrivent.",
    impossible: "Investissement locatif impossible : pas assez de placements pour l'apport à cet âge. Il n'est pas compté.",
    refuse: `Investissement locatif refusé par la banque : avec ce crédit, l'endettement dépasserait ${A_MAX()} % (voir « Ton taux d'endettement » dans « Mon profil »). Il n'est pas compté.`,
  }[C[iL].locatif] });
  // Événements de vie saisis dans « Mon profil »
  for (const e of etat.profil.evenements ?? []) {
    const yE = Math.round(Number(e.age) || 0) - C[0].age;
    if (!(yE >= 0 && yE < C.length)) continue;
    const n = Math.max(1, Number(e.annees) || 1), lib = e.libelle || TYPES_EV.find(([v]) => v === e.type)?.[1] || "Événement";
    ev.push({ y: yE, court: lib, texte: e.type === "pause" ? `${lib} : pas d'épargne pendant ${n} an(s).` : `${lib} : ${e.type === "entree" ? "+" : "−"}${eur(Number(e.montant) || 0)}${n > 1 ? ` par an pendant ${n} ans` : ""} (euros d'aujourd'hui).` });
  }
  return ev.sort((a, b) => a.y - b.y);
}

function blocTranches(r, defl, unite) {
  const plan = etat.brouillon, C = r.central;
  const ev = basculesDuPlan(r);
  const pas = [0, 5, 10, 15, 20, 25, 30].filter((k) => k < C.length);
  const lignes = pas.map((k, j) => {
    const pt = C[k], f = defl(k);
    const total = pt.financier || 1;
    const classes = ORDRE.filter((c) => (pt.classes?.[c] ?? 0) > 0.5);
    const barre = `<div class="mini-barre" data-bulle="${echapper(`À ${pt.age} ans · ${eur(pt.financier * f)}\n` + classes.map((c) => `${plan.classes[c].libelle} : ${eur(pt.classes[c] * f)} (${pct((100 * pt.classes[c]) / total)})`).join("\n"))}">${classes.map((c) => `<span style="flex-grow:${pt.classes[c]};background:var(${COULEUR[c]})"></span>`).join("")}</div>`;
    const avant = j === 0 ? -1 : pas[j - 1];
    const changes = ev.filter((e) => (j === 0 ? e.y === 0 : e.y > avant && e.y <= k));
    return `<tr><td>${k === 0 ? "Aujourd'hui" : `Dans ${k} ans`}</td><td class="m">${pt.age} ans</td><td class="m">${pt.salaire > 0 ? eur(pt.salaire * f) : "retraite"}</td><td class="m">${eur(Math.max(0, pt.epargne ?? 0) * f)}</td><td class="m"><b>${eur(pt.financier * f)}</b></td><td>${barre}</td>
      <td class="bascules">${changes.map((e) => `<div>${C[e.y].age} ans : ${echapper(e.court)}</div>`).join("") || "—"}</td></tr>`;
  }).join("");
  const legende = ORDRE.filter((c) => pas.some((k) => (C[k].classes?.[c] ?? 0) > 0.5)).map((c) => `<span><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}</span>`).join("");
  const p0 = normaliserProfil(etat.profil);
  const hausse = p0.salaireDans10Ans > 0 ? `selon ton salaire espéré dans 10 ans (${eur(p0.salaireDans10Ans)}), puis ta carrière` : `selon ta carrière : ${echapper((carriereDe(plan, p0).libelle ?? "").toLowerCase())}, en plus de l'inflation (${pct(plan.hypotheses.inflation ?? 0)})`;
  return `<section class="panneau" id="tr-tranches" data-min="intermediaire"><h2>Tous les 5 ans</h2>
    <p class="note" style="margin:4px 0 8px">Scénario central, en suivant le plan. Salaire ${hausse} ; l'épargne suit le salaire. Montants ${unite}. Survole une barre pour le détail.</p>
    <div class="table-wrap"><table><thead><tr><th></th><th class="m">Âge</th><th class="m">Salaire net</th><th class="m">Épargne / mois</th><th class="m">Placements</th><th>Répartition</th><th>Ce qui change</th></tr></thead><tbody>${lignes}</tbody></table></div>
    <div class="legende-g">${legende}</div>
    ${ev.length ? `<h3 style="margin:16px 0 0">Les bascules du plan</h3><ul class="bascules">${ev.map((e) => `<li><b class="quand">${C[e.y].age} ans</b><span>${texteLie(e.texte)}</span></li>`).join("")}</ul>` : ""}
  </section>`;
}

// Écouteurs de l'onglet Trajectoire (scénarios, fiscalité, crise, histoire, inflation, âge d'achat), attachés une seule fois au démarrage par app.js
export function monterTrajectoire() {
  $("#trajectoire").addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fs-scenario") simFiscale.scenario = t.value;
    else if (t.id === "fs-annee") simFiscale.annee = Number(t.value);
    else if (t.dataset?.fs) {
      const k = t.dataset.fs, P = simFiscale.perso;
      if (k === "lmnpFin") P.lmnp = !t.checked;
      else if (t.type === "checkbox") P[k] = t.checked;
      else if (k === "perSortie") P.perSortie = t.value === "" ? null : Number(t.value);
      else P[k] = t.value === "" ? NEUTRE[k] : Number(t.value);
      simFiscale.scenario = "perso";
    } else return;
    memo.set("sim-fiscale", simFiscale);
    rendreFiscal();
  });
  $("#trajectoire").addEventListener("click", (e) => {
    const t = e.target;
    if (t.id !== "ab-figer" && !t.dataset?.supprSc) return;
    let r; try { r = projectionCourante(achatInclus()); } catch { return; }
    const S = scenariosGardes();
    if (t.id === "ab-figer" && S.length < MAX_SCENARIOS) S.push({ nom: $("#ab-nom")?.value?.trim() || "", date: new Date().toISOString(), points: r.central.map((p, i) => ({ age: p.age, net: p.net, i })) });
    else if (t.dataset.supprSc) S.splice(Number(t.dataset.supprSc), 1);
    garderScenarios(S);
    $("#bloc-ab").innerHTML = blocScenarios(r, montantsReels());
  });
  $("#t-reel").addEventListener("change", rendreTrajectoire);
  $("#trajectoire").addEventListener("change", (e) => {
    if (e.target.id === "crise-choix") { uiCrise.id = e.target.value; memo.set("crise-id", uiCrise.id); rendreCrise(); }
    if (e.target.id === "crise-moment") { uiCrise.moment = e.target.value; memo.set("crise-moment", uiCrise.moment); rendreCrise(); }
  });
  $("#trajectoire").addEventListener("change", (e) => {
    if (e.target.id === "hist-longueur") { uiHistorique.longueur = Number(e.target.value) === 20 ? 20 : 30; memo.set("hist-longueur", uiHistorique.longueur); rendreHistorique(); }
    if (e.target.id === "hist-depart") { uiHistorique.depart = e.target.value === "maintenant" ? "maintenant" : "retraite"; memo.set("hist-depart", uiHistorique.depart); rendreHistorique(); }
    if (e.target.id === "infl-taux") { uiInflation.taux = Number(e.target.value); memo.set("infl-taux", uiInflation.taux); rendreInflation(); }
  });
  $("#achat-trajectoire").addEventListener("change", (e) => { if (e.target.id === "age-achat") choisirAgeAchat(Math.round(Number(e.target.value))); });
  $("#achat-trajectoire").addEventListener("click", (e) => { if (e.target.id === "age-ideal") choisirAgeAchat(null); });
  $("#t-achat").addEventListener("change", rendreTrajectoire);
}
