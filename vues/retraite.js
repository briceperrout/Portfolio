// Règle d'architecture : une vue exporte rendre<Nom>() et monter<Nom>() (écouteurs, appelée une seule fois par app.js
// au démarrage) et n'a aucun effet de bord au niveau module. Elle importe ui/commun.js et les modules métier, et des
// fonctions (jamais de const/let) d'app.js : import circulaire sûr car ces fonctions sont hissées.
import { $, etat, memo, echapper, keur, ORDRE, COULEUR, pause } from "../ui/commun.js";
import { eur, pct } from "../moteur.js";
import { eurArrondi, eurEnviron } from "../utilitaires.js";
import { libertePatrimoine, projeter, capitalNecessaire, contexteRetraite, evaluerRetraite } from "../projection.js";
import { ABATTEMENT_AV, PRELEVEMENTS, SEUIL_PRIMES_AV } from "../fiscal.js";
import { reserveAVTransmissible } from "../succession.js";
import { estimerPension, ageEnTexte } from "../pension.js";
import { projectionCourante, graphiqueEventail, blocObjectifs } from "./projection-commune.js";
import { planifierTrajectoire, programmerRendu } from "./trajectoire.js";
import { niveauCourant, normaliserProfil, texteLie, profilPourMoteur, planifierSauvegardeProfil, syncRetraite0, choisirAgeDepart } from "../app.js";

// Liberté financière : capital qui suffit (règle des 4 %), et âge « Coast FIRE » à partir duquel
// on pourrait ne plus rien épargner et atteindre quand même l'objectif à l'âge de la retraite
function blocLiberte(r) {
  const L = libertePatrimoine(r, etat.brouillon.hypotheses, etat.resultat?.alloc ?? {});
  if (!L) return "";
  const R = r.retraite, C = r.central;
  const { besoinAn, objectif, rr, coast, fire, ageR, v0 } = L;
  if (!(objectif > 0)) return `<section class="panneau" id="bloc-liberte" data-min="intermediaire"><h2>Liberté financière</h2><p class="small muted" style="margin:0">Ta retraite publique couvre l'objectif : pas besoin de capital pour le revenu visé.</p></section>`;
  return `<section class="panneau" id="bloc-liberte" data-min="intermediaire"><h2>Liberté financière</h2>
    <p class="note" style="margin:4px 0 8px">Règle des 4 % : un capital de 25 fois tes besoins annuels permet en général de retirer 4 % par an pendant 30 ans sans être à court. Tes besoins : ${eur(besoinAn / 12)} par mois${R.pension > 0 ? " (après la retraite publique comptée)" : ""}, soit un objectif de <b>${eur(objectif)}</b> en euros d'aujourd'hui.</p>
    <div class="tuiles">
      <div class="tuile"><span>Ton capital placé aujourd'hui</span><b class="num">${eur(v0)}</b><span class="small muted">${pct((100 * v0) / objectif)} de l'objectif</span></div>
      <div class="tuile"><span>Coast FIRE (ne plus épargner)</span><b class="num">${coast ? (coast.age <= C[0].age ? "déjà atteint" : `à ${coast.age} ans`) : "pas avant la retraite"}</b><span class="small muted">rendement réel moyen ${pct(rr * 100)} par an</span></div>
      <div class="tuile"><span>Liberté financière (tout de suite)</span><b class="num">${fire ? `à ${fire.age} ans` : `pas avant ${ageR} ans`}</b><span class="small muted">capital ≥ ${keur(objectif)}</span></div>
    </div>
    <p class="note" style="margin:8px 0 0">${coast ? `À partir de ${coast.age <= C[0].age ? "maintenant" : `${coast.age} ans`}, même sans épargner un euro de plus, ton capital (${eur(coast.v)}) grandirait jusqu'à environ ${eur(objectif)} à ${ageR} ans grâce aux seuls intérêts composés. Tu pourrais alors épargner moins, ou travailler moins, sans renoncer à ta retraite.` : `En suivant le plan, ton capital n'atteint pas ce seuil avant ${ageR} ans : il faut continuer d'épargner jusqu'à la retraite.`} Scénario central, en euros d'aujourd'hui, avant impôts sur les gains. La règle des 4 % vient d'études américaines ; en France, beaucoup visent plutôt 3,5 % (28 fois les besoins) par prudence.</p>
  </section>`;
}
// ---- Retraite : ordre de retrait fiscalement optimal (décumulation, calculé par projection.js / pension.js)
const POCHES_LIBELLES = { livrets: "Livrets", av_apres70: "Assurance-vie (versements après 70 ans)", av_avant70: "Assurance-vie (versements avant 70 ans)", pea: "PEA", cto: "Compte-titres", per: "PER", orPhysique: "Or physique", scpi: "SCPI", plateformeCrypto: "Bitcoin (plateforme)", coldWallet: "Bitcoin (cold wallet)" };
const libellePoche = (id, plan) => POCHES_LIBELLES[id] ?? plan.enveloppes?.[id]?.libelle ?? plan.classes?.[id]?.libelle ?? id;
function ordreRetraitsHtml(priorite, D) {
  let ordreLiquides;
  if (D?.ordreEtape3 === "ctoDabord") ordreLiquides = "Le compte-titres et les autres placements d'abord, puis le PEA : ton épargne sera consommée, autant laisser fructifier le PEA, moins taxé.";
  else if (D?.ordreEtape3 === "peaDabord" && D.ageEpuisementOptimise == null) ordreLiquides = "Le PEA d'abord, puis le compte-titres : ton épargne ne sera pas épuisée, et les plus-values du compte-titres sont effacées au décès.";
  else ordreLiquides = "Le PEA d'abord (moins taxé), puis le compte-titres et les autres placements.";
  if (D?.gainOrdreReel >= 1) ordreLiquides += ` (environ ${eur(Math.round(D.gainOrdreReel / 10) * 10)} de plus transmis, après impôts au décès${D.gainOrdreApresDroits ? " et droits de succession" : ""}, en euros d'aujourd'hui, que l'ordre inverse)`;
  const etapes = [
    "Le PER est vidé progressivement sur les années qui restent, sans dépasser ta tranche d'imposition.",
    "L'assurance-vie de plus de 8 ans est rachetée chaque année dans la limite de l'abattement (peu ou pas d'impôt sur le revenu).",
    "Les livrets, au-delà d'une réserve de précaution.",
    ordreLiquides,
    "L'assurance-vie des versements après 70 ans, au-delà de l'abattement.",
  ];
  const perHors = "Le PER au-delà de la tranche d'imposition.", avAvant = "L'assurance-vie des versements avant 70 ans, gardée pour la transmission.";
  const fin = priorite === "consommer" ? [avAvant, perHors] : [perHors, avAvant];
  return [...etapes, ...fin, "En dernier : la réserve de livrets, puis l'or physique."].map((t) => `<li>${echapper(t)}</li>`).join("");
}
function exemplesRetraitsHtml(D, plan) {
  if (!D?.exemples?.length) return "";
  const lignes = D.exemples.map((e) => e.retraits.map((r, k) => `<tr>${k === 0 ? `<td rowspan="${e.retraits.length + 1}">${e.age} ans</td>` : ""}<td>${echapper(libellePoche(r.id, plan))}</td><td class="m">${eur(r.montant)}</td><td class="m">${eur(r.impot)}</td></tr>`).join("") + `<tr><td><b>Total</b></td><td class="m"><b>${eur(e.brut)}</b></td><td class="m"><b>${eur(e.impots)}</b></td></tr>`).join("");
  return `<p class="note" style="margin:12px 0 6px">Exemples d'années : ce qui est retiré, compte par compte, et l'impôt payé (en euros de l'époque).</p>
    <div class="table-wrap"><table><thead><tr><th>Âge</th><th>Compte</th><th class="m">Retiré</th><th class="m">Impôt</th></tr></thead><tbody>${lignes}</tbody></table></div>`;
}
function economieRetraitsHtml(D) {
  if (!D || !(D.gainPatrimoineNetReel >= 1) || !(D.anneesComparees > 0)) return "";
  const ageOpt = D.ageEpuisementOptimise, agePro = D.ageEpuisementProrata;
  const epuise = ageOpt !== agePro && agePro != null ? ` Ton épargne tient aussi jusqu'à ${ageOpt == null ? "la fin de la projection" : `${ageOpt} ans`} au lieu de ${agePro} ans.` : "";
  const dix = (x) => eur(Math.round(x / 10) * 10);
  const impots = D.economieReel >= 1
    ? ` dont <b class="num">${dix(D.economieReel)}</b> d'impôts en moins sur ${D.anneesComparees} ans.`
    : " Les impôts payés sont un peu décalés dans le temps (moins au début, davantage plus tard), mais ton capital a plus longtemps travaillé.";
  return `<section class="panneau" id="ret-economie-retraits" data-min="intermediaire"><h2>Retirer dans le bon ordre</h2>
      <p style="margin:6px 0 0">Retirer dans le bon ordre te laisse environ <b class="num">${dix(D.gainPatrimoineNetReel)}</b> de plus à ${D.ageFinal} ans (en euros d'aujourd'hui) qu'un retrait au prorata, pour le même revenu.${impots}${epuise}</p>
      <p class="note" style="margin:6px 0 0">Scénario central, en euros d'aujourd'hui, après les impôts dus au décès sur les plus-values (hors droits de succession).</p>
    </section>`;
}
// Impôts au décès, droits de succession et net transmis, pour la stratégie choisie et pour le retrait au prorata (euros d'aujourd'hui)
function blocDroitsSuccession(D, priorite) {
  if (!D || D.droitsSuccessionOptimise == null || D.droitsSuccessionProrata == null) return "";
  const ligne = (nom, brut, net, droits, apres) => `<tr><td>${nom}</td><td class="m">${eur(brut - net)}</td><td class="m">${eur(droits)}</td><td class="m"><b>${eur(apres)}</b></td></tr>`;
  const nomStrategie = priorite === "consommer" ? "Ordre optimal, priorité « Consommer »" : "Ordre optimal, priorité « Transmettre »";
  return `<h3 style="margin:14px 0 6px">Ce qui serait transmis en fin de projection</h3>
    <div class="table-wrap"><table><thead><tr><th>Stratégie de retraits</th><th class="m">Impôts au décès</th><th class="m">Droits de succession</th><th class="m">Net transmis après droits</th></tr></thead><tbody>
      ${ligne(nomStrategie, D.patrimoineFinalOptimiseReel, D.patrimoineFinalNetReel, D.droitsSuccessionOptimise, D.patrimoineFinalNetApresDroitsReel)}
      ${ligne("Retrait au prorata", D.patrimoineFinalProrataReel, D.patrimoineFinalNetProrataReel, D.droitsSuccessionProrata, D.patrimoineFinalNetApresDroitsProrataReel)}
    </tbody></table></div>
    <p class="note" style="margin:6px 0 0">Droits estimés pour ta situation familiale, sur la part transmise par les placements ; la résidence principale n'y est pas imputée. <a class="lien-fiche" href="#transmission">Voir le détail dans l'onglet Transmission</a>.</p>`;
}
// « N chances sur 100 » : formulation lisible d'une probabilité (0..1), sans pourcentage ni faux 0 / 100
function chancesSur100(p) {
  const n = Math.round(100 * p);
  if (n <= 0) return p > 0 ? "moins d'une chance sur 100" : "0 chance sur 100";
  if (n >= 100) return p < 1 ? "presque à coup sûr (plus de 99 chances sur 100)" : "100 chances sur 100";
  return `${n} ${n === 1 ? "chance" : "chances"} sur 100`;
}

export function rendreRetraite() {
  if (niveauCourant() === "debutant") { rendreRetraiteDebutant(); return; }
  const plan = etat.brouillon, H = plan.hypotheses;
  let r;
  try { r = projectionCourante(true); }
  catch (e) { console.error(e); $("#retraite").innerHTML = `<div class="erreur">Calcul impossible : ${echapper(e.message)}.</div>`; return; }
  const R = r.retraite, C = r.central, E = r.eventail;
  const p0 = normaliserProfil(etat.profil);
  const ageAuj = Math.ceil(p0.age ?? 0), ageLegal = H.ageRetraite ?? 64;
  const ageDepart = R?.age ?? ageLegal;
  // Repère : 70 à 80 % du dernier salaire (en euros d'aujourd'hui)
  const iDernier = Math.max(0, (R?.iR ?? 0) - 1);
  const dernierSalaire = C[iDernier]?.salaire ? C[iDernier].salaire / Math.pow(1 + (H.inflation ?? 0) / 100, iDernier) : 0;
  const repere = dernierSalaire > 0 ? `Repère : on vise souvent 70 à 80 % de son dernier salaire. Le tien serait d'environ ${eur(dernierSalaire)} par mois (en euros d'aujourd'hui) à ${C[iDernier].age} ans, soit ${eur(Math.round(dernierSalaire * 0.7 / 50) * 50)} à ${eur(Math.round(dernierSalaire * 0.8 / 50) * 50)} par mois.` : "";
  const optionsAge = Array.from({ length: Math.max(0, ageLegal - ageAuj + 1) }, (_, k) => ageAuj + k).map((a) => `<option value="${a}" ${a === ageDepart ? "selected" : ""}>${a} ans${a === ageLegal ? " (au plus tard)" : ""}</option>`).join("");
  const aLoyers = !!((etat.profil.proprietaire && etat.profil.logement?.usage === "loue") || etat.profil.projetLocatif?.actif);
  const saisie = `<section class="panneau" id="ret-hypotheses" data-min="intermediaire"><h2>Tes hypothèses</h2>
    <div class="champs" style="max-width:600px;margin-top:10px">
      <div class="champ"><label for="r-revenu"><b>Une retraite convenable pour toi</b>, par mois, après impôt, en euros d'aujourd'hui</label><div class="saisie"><input id="r-revenu" type="number" min="0" step="100" value="${p0.retraite?.revenu ?? ""}" placeholder="${plan.retraite?.revenuMensuelDefaut ?? 2000}"><span>€/mois</span></div></div>
      ${repere ? `<p class="note" style="margin:-4px 0 0">${repere}</p>` : ""}
      ${optionsAge ? `<div class="champ"><label for="r-age">Âge où tu arrêtes de travailler</label><select id="r-age">${optionsAge}</select></div>` : ""}
      <div class="champ"><label for="r-mode">Retraite publique</label><select id="r-mode">${[["auto", "Estimée automatiquement (suit l'âge d'arrêt)"], ["manuel", "Montant que j'indique"], ["zero", "Ne pas la compter (prudence)"]].map(([v, l]) => `<option value="${v}" ${(etat.profil.retraite?.modePension ?? "auto") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="champ"><label for="r-pension">Retraite publique comptée (nette après impôt, en euros d'aujourd'hui)</label><div class="saisie"><input id="r-pension" type="number" min="0" step="10" value="${p0.retraite?.pension ?? ""}" placeholder="0" ${(etat.profil.retraite?.modePension ?? "auto") === "manuel" ? "" : "disabled"}><span>€/mois</span></div></div>
      <p class="note" style="margin:-4px 0 0">${(etat.profil.retraite?.modePension ?? "auto") === "auto" ? `Calculée pour un arrêt à ${ageDepart} ans${(Number(p0.retraite?.pension) || 0) > 0 ? `, versée à partir de ${R?.agePension ?? ageLegal} ans` : ""} : elle change toute seule quand tu changes l'âge d'arrêt (moins de trimestres = retraite plus basse). Détail plus bas, dans « Estimer ta retraite publique ».` : (Number(p0.retraite?.pension) || 0) > 0 ? `Versée à partir de ${R?.agePension ?? ageLegal} ans.` : "Aucune retraite publique comptée : tout vient de tes placements."}</p>
      ${aLoyers ? `<label class="coche" data-min="avance"><input type="checkbox" id="r-loyers" ${etat.profil.retraite?.compterLoyers !== false ? "checked" : ""}> Compter les loyers nets de mes biens loués dans mes revenus à la retraite</label>
      <p class="note" data-min="avance" style="margin:-4px 0 0">${etat.profil.retraite?.compterLoyers !== false ? "Oui, ils sont comptés : chaque année, les loyers nets (après charges, impôt et crédit) rejoignent tes placements, ce qui réduit ce que tu dois y puiser. Décoche pour voir ta retraite sans eux (bien vendu, travaux, vacance…)." : "Non comptés : à partir de ta retraite, les loyers nets ne servent plus à financer ton revenu (le crédit encore en cours, lui, reste payé)."}</p>` : ""}
    </div>
    <p class="note" style="margin:8px 0 0">${(Number(p0.retraite?.pension) || 0) > 0 ? `Tes placements complètent la retraite publique à partir de ${R?.agePension ?? ageLegal} ans, et paient tout avant.` : "Par prudence, le plan compte 0 € de retraite publique : tout vient de tes placements. Pour l'estimer, voir « Estimer ta retraite publique » plus bas."} Tu arrêtes de travailler et d'épargner à ${ageDepart} ans (${ageLegal} ans au plus tard), puis tu te verses ce revenu jusqu'à ${R?.ageFin ?? ageLegal + (plan.retraite?.dureeAnnees ?? 30)} ans, relevé chaque année de l'inflation (${pct(H.inflation ?? 0)} par an)${R ? ` : ${eur(R.revenu)} d'aujourd'hui vaudront environ ${eur(R.revenu * Math.pow(1 + (H.inflation ?? 0) / 100, R.iR))} par mois en ${new Date().getFullYear() + R.iR}` : ""}.</p>
  </section>`;
  if (!R) {
    $("#retraite").innerHTML = saisie + `<section class="panneau"><p class="muted" style="margin:0">${(p0.age ?? 0) >= (H.ageRetraite ?? 64) ? "Ce profil a déjà l'âge de la retraite : la simulation part de la situation actuelle." : "Retraite hors de la période projetée."}</p></section>`;
    return;
  }
  const infl = (H.inflation ?? 0) / 100;
  const reel = (v, i) => v / Math.pow(1 + infl, i);
  const iR = R.iR, iF = R.dernier;
  const capR = reel(C[iR].financier, iR), capF = reel(C[iF].financier, iF);
  const medF = reel(E[iF].p50, iF), p10F = reel(E[iF].p10, iF);
  const probaTxt = chancesSur100(R.probaDure);
  const tuiles = [
    [`Capital à ${C[iR].age} ans (central)`, eur(capR)],
    [`Capital à ${C[iR].age} ans (médiane)`, eur(reel(E[iR].p50, iR))],
    ["Revenu possible sans entamer le capital", R.revenuPreserve != null ? `${eur(R.revenuPreserve)}/mois` : "—"],
    [`Revenu possible en consommant tout d'ici ${C[iF].age} ans`, R.revenuConsomme != null ? `${eur(R.revenuConsomme)}/mois` : "—"],
    [`Chances que l'argent dure jusqu'à ${C[iF].age} ans`, probaTxt],
    [`À transmettre à ${C[iF].age} ans (médiane)`, eur(Math.max(0, medF))],
  ];
  const ok = R.probaDure >= SEUIL_TENABLE, moyen = R.probaDure >= SEUIL_FRAGILE;
  const verdict = `<p class="verdict ${ok ? "ok" : "ko"}"><b>${ok ? "Objectif tenable." : moyen ? "Objectif fragile." : "Objectif risqué."}</b> Avec ${eur(R.revenu)} par mois (en euros d'aujourd'hui)${R.pension > 0 ? `, dont ${eur(R.pension)} de retraite publique` : ""}, il y a ${probaTxt} que l'argent dure jusqu'à ${C[iF].age} ans (scénarios simulés).${R.epuiseA ? ` Dans le scénario central, les placements sont épuisés à ${R.epuiseA} ans.` : ` Dans le scénario central, il reste ${eur(Math.max(0, capF))} (en euros d'aujourd'hui) à ${C[iF].age} ans.`}${R.revenuPreserve != null ? ` Pour transmettre au moins le capital de départ (${eur(capR)}), le revenu possible est d'environ ${eur(R.revenuPreserve)} par mois.` : ""}${ok ? "" : " Leviers : épargner plus, partir plus tard, viser un revenu plus bas, ou garder une part de bourse plus importante à la retraite."}</p>`;

  // Évolution pendant la retraite (en euros d'aujourd'hui)
  const defl = (i) => Math.pow(1 + infl, -(i + iR));
  const graphe = graphiqueEventail(C.slice(iR), E.slice(iR), defl);
  const idx = [...new Set(C.map((p, i) => i).filter((i) => i >= iR && ((i - iR) % 5 === 0 || i === iF)))];
  const lignes = idx.map((i) => {
    const p = C[i];
    return `<tr><td>${p.age} ans</td><td class="m">${p.retraitNet > 0 ? `${eur(reel(p.retraitNet, i))}<div class="small muted">${eur(p.retraitNet)} de l'époque</div>` : "—"}</td>
      <td class="m">${eur(reel(E[i].p10, i))}</td><td class="m">${eur(reel(E[i].p50, i))}</td><td class="m">${eur(reel(E[i].p90, i))}</td><td class="m"><b>${eur(reel(p.financier, i))}</b></td></tr>`;
  }).join("");

  // La première année : d'où vient l'argent, et la réserve sans risque
  const pR = C[iR], tot = pR.financier || 1;
  const brut1 = pR.brutRetraits ?? 12 * R.besoin * Math.pow(1 + infl, iR);
  const tauxPremiereAnnee = brut1 > 0 ? (100 * (pR.impotRetraits ?? 0)) / brut1 : 0;
  const D = r.decumulation, priorite = etat.profil.retraite?.priorite === "consommer" ? "consommer" : "transmettre";
  const classes = ORDRE.filter((c) => (pR.classes?.[c] ?? 0) > 0.5);
  // L'or physique est gardé (sauf si la case « vendre aussi mon or » est cochée) : le retrait se répartit sur le reste
  const vendreOr = !!etat.profil.retraite?.vendreOr || !(plan.reequilibrage?.jamaisVendre ?? []).includes("orPhysique");
  const totVendable = classes.filter((c) => vendreOr || c !== "or").reduce((t, c) => t + pR.classes[c], 0) || 1;
  const lignesVentes = classes.map((c) => { const garde = !vendreOr && c === "or"; return `<tr><td><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}${garde ? '<div class="small muted">gardé : ni vendu, ni rééquilibré</div>' : ""}</td><td class="m">${eur(reel(pR.classes[c], iR))}</td><td class="m">${pct((100 * pR.classes[c]) / tot)}</td><td class="m">${garde ? "0 €" : eur(reel((brut1 * pR.classes[c]) / totVendable, iR))}</td></tr>`; }).join("");
  const aDeLOr = (pR.classes?.or ?? 0) > 0.5;
  const sansRisque = ["securite", "projet", "prudent"].reduce((t, c) => t + (pR.classes?.[c] ?? 0), 0);
  const anneesReserve = brut1 > 0 ? sansRisque / brut1 : null;
  const tauxRetrait = pR.financier > 0 ? (100 * brut1) / pR.financier : 0;

  const centralAge = agePossibleCentral();
  const cleP = clePessimiste();
  const P = pessimiste.cle === cleP ? pessimiste : null;
  const fmtAge = (a, enCours) => (enCours ? '<span class="muted small">calcul en cours…</span>' : a == null ? `pas avant ${ageLegal} ans` : `${a} ans`);
  const blocAge = `<section class="panneau" id="ret-age" data-min="intermediaire"><h2>À quel âge peux-tu t'arrêter ?</h2>
    <p class="note" style="margin:4px 0 0">Le plus tôt possible pour te verser ${eur(R.revenu)} par mois jusqu'à ${R.ageFin} ans <b>en transmettant à ${R.ageFin} ans tout le capital que tu avais en arrêtant</b> (en euros d'aujourd'hui). À ${ageLegal} ans, on s'arrête quoi qu'il arrive.</p>
    <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="tuile"><span>Scénario central (rendements moyens)</span><b class="num">${fmtAge(centralAge)}</b></div>
      <div class="tuile"><span>Scénario pessimiste (ça marche dans 9 cas sur 10)</span><b class="num" id="age-pessimiste">${fmtAge(P?.age, !P)}</b></div>
    </div>
    <div class="ligne-actions" id="actions-age">${boutonsAge(centralAge, P?.age, ageDepart, ageLegal)}</div>
    <p class="note" style="margin:8px 0 0">Pessimiste : on rejoue 200 scénarios de marchés tirés au hasard (krachs compris) ; l'âge retenu est celui où le capital est transmis intact dans au moins 9 scénarios sur 10. C'est la version prudente à retenir.</p>
  </section>`;
  $("#retraite").innerHTML = saisie + blocObjectifs(r, 'id="ret-objectifs" data-min="intermediaire"') + blocAge + blocLiberte(r) + blocPension(p0) + `
    <section class="panneau" id="ret-resultat" data-min="intermediaire"><h2>Ce que ça donne</h2>
      <div class="tuiles">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
      <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:0">
        <div class="tuile"><span>Pessimiste (9 cas sur 10) : revenu possible sans entamer le capital</span><b class="num" id="pess-preserve">${P ? `${eur(P.revenuPreserve)}/mois` : '<span class="muted small">calcul en cours…</span>'}</b></div>
        <div class="tuile"><span>Pessimiste (9 cas sur 10) : revenu possible en consommant tout d'ici ${C[iF].age} ans</span><b class="num" id="pess-consomme">${P ? `${eur(P.revenuConsomme)}/mois` : '<span class="muted small">calcul en cours…</span>'}</b></div>
      </div>
      ${verdict}
      <p class="note" style="margin:10px 0 0">Tous les montants sont en euros d'aujourd'hui (inflation déduite). Les revenus possibles sont calculés dans le scénario central (rendements moyens), impôts sur les ventes compris : environ ${pct(tauxPremiereAnnee)} de chaque retrait la première année, puis plus ensuite, car la part de gains dans ce qu'il reste augmente (le capital restant continue de rapporter). Chaque scénario tiré au hasard est taxé avec ses propres gains. L'abattement annuel de l'assurance-vie de plus de 8 ans (${eur(ABATTEMENT_AV.seul)} de gains, ${eur(ABATTEMENT_AV.couple)} pour un couple marié ou pacsé) est utilisé chaque année.</p>
    </section>
${economieRetraitsHtml(D)}
    <section class="panneau" id="ret-capital" data-min="intermediaire"><h2>Ton capital pendant la retraite</h2>
      <p class="note" style="margin:4px 0 8px">Chaque année, le revenu est pris sur les placements, et le reste continue d'être placé selon le plan (de plus en plus prudent avec l'âge). En euros d'aujourd'hui.</p>
      ${graphe}
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Âge</th><th class="m">Revenu versé / mois</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th></tr></thead><tbody>${lignes}</tbody></table></div>
    </section>
    <section class="panneau" id="ret-decaissement" data-min="avance"><h2>Comment se verser ce revenu</h2>
      <ol class="points" style="margin-top:10px">
        <li>${texteLie(`Une fois par an (en janvier, par exemple), retirer 12 mois de revenu : environ ${eur(reel(brut1, iR))} la première année (en euros d'aujourd'hui), impôts compris, soit ${pct(tauxRetrait)} du capital. On le met sur le compte courant ou un livret, et on se fait un virement automatique chaque mois.`)}</li>
        <li>${texteLie(`Garder une réserve sans risque (livrets, fonds euros, obligations) d'au moins 2 à 3 ans de retraits. Avec le plan, elle représente ${anneesReserve != null ? `environ ${String(Math.round(anneesReserve * 10) / 10).replace(".", ",")} années de retraits` : "—"} au départ.`)}</li>
        <li>${texteLie("Les bonnes années, vendre surtout ce qui dépasse sa cible (c'est le rééquilibrage du plan). Les années de forte baisse de la bourse, puiser dans la réserve sans risque plutôt que vendre des actions au plus bas, puis la reconstituer quand la bourse remonte.")}</li>
        <li>${texteLie("Garder le reste investi selon le plan : à 64 ans, il reste plus de 25 ans à tenir, et une part de bourse est ce qui permet au capital de durer et d'être transmis.")}</li>
      </ol>
      <h3 style="margin:16px 0 4px">Dans quel ordre retirer</h3>
      <div class="champ" style="max-width:420px" data-min="avance"><label for="r-priorite">Priorité</label><select id="r-priorite" data-min="avance"><option value="transmettre" ${priorite === "transmettre" ? "selected" : ""}>Transmettre (garder l'assurance-vie pour mes héritiers)</option><option value="consommer" ${priorite === "consommer" ? "selected" : ""}>Consommer (profiter de mon épargne)</option></select></div>
      <ol class="points" style="margin-top:10px">${ordreRetraitsHtml(priorite, D)}</ol>
      <div id="ret-ordre-retraits" data-min="avance">${exemplesRetraitsHtml(D, plan)}</div>
      <h3 style="margin:16px 0 4px">D'où vient l'argent la première année</h3>
      <p class="note" style="margin:0 0 6px">La simulation retire l'argent dans un ordre qui limite l'impôt, puis ajuste tes familles de placements pour rester proche du plan${aDeLOr && !vendreOr ? " (sauf l'or physique, gardé)" : ""}. Répartition des placements à l'âge du départ, en euros d'aujourd'hui :</p>
      ${aDeLOr ? `<p class="${vendreOr ? "verdict ko" : "note"}" style="margin:0 0 6px">${vendreOr ? "<b>Tu as choisi de vendre aussi ton or physique.</b> C'est possible, mais déconseillé : " : "<b>Ton or physique n'est pas vendu.</b> "}${vendreOr ? "l'or" : "L'or"} physique n'est pas fait pour financer la retraite : il protège contre les crises graves et se transmet (pièces et lingots, avec une fiscalité de transmission comme le reste du patrimoine). Mieux vaut le garder et puiser dans la bourse, l'assurance-vie et l'épargne. Il ne serait vendu qu'en dernier recours, si tout le reste était épuisé. <a class="lien-fiche" href="#mon-profil">Changer ce choix (« Ta retraite » dans Mon profil)</a></p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Placement</th><th class="m">Montant à ${pR.age} ans</th><th class="m">Part</th><th class="m">À vendre dans l'année</th></tr></thead><tbody>${lignesVentes}</tbody></table></div>
    </section>
    <section class="panneau" id="ret-impots" data-min="avance"><h2>Impôts et transmission</h2>
      <ul class="points" style="margin-top:10px">
        <li>${texteLie(`Assurance-vie de plus de 8 ans : l'abattement annuel (${eur(ABATTEMENT_AV.seul)} de gains, ${eur(ABATTEMENT_AV.couple)} pour un couple marié ou pacsé) est utilisé chaque année par des rachats partiels ; au-delà, les gains paient ${pct(PRELEVEMENTS.IR_AV_8ANS)} d'impôt (${pct(PRELEVEMENTS.IR_PFU)} sur la part des contrats dépassant ${eur(SEUIL_PRIMES_AV)} de versements) et ${pct(PRELEVEMENTS.PS_PATRIMOINE)} de prélèvements sociaux.`)}</li>
        <li>${texteLie("PEA de plus de 5 ans : retraits sans impôt sur le revenu, seulement 18,6 % de prélèvements sociaux sur la part de gains. Il est consommé avant le compte-titres, imposé à 31,4 % sur la part de gains de chaque vente.")}</li>
        <li>${texteLie("PER : la sortie en capital est lissée sur les années restantes, en restant dans ta tranche d'imposition (les versements déduits sont imposés au barème, les gains à 31,4 %), pour éviter une grosse facture d'un seul coup.")}</li>
        <li>${texteLie("Pour transmettre, l'assurance-vie est l'outil le plus avantageux : les sommes versées avant 70 ans sont transmises jusqu'à 152 500 € par bénéficiaire sans droits de succession ; après 70 ans, 30 500 € de versements au total (les gains sont exonérés). Le PEA, lui, est fermé au décès et entre dans la succession.")}</li>
        <li>${reserveAVTransmissible(etat.profil) > 0 ? texteLie(`L'assurance-vie des versements faits avant 70 ans est gardée pour la fin : elle se transmet jusqu'à 152 500 € par bénéficiaire sans droits de succession, soit ${eur(reserveAVTransmissible(etat.profil))} mis de côté pour ta situation (choix « Consommer » pour l'utiliser plus tôt). À faire valider par un conseiller ou un notaire selon ta situation.`) : `L'assurance-vie n'est pas mise de côté pour la transmission : ton conjoint ou partenaire est bénéficiaire de la clause et déjà exonéré de droits. Pour profiter de l'abattement de 152 500 € par bénéficiaire, désigne tes enfants dans la clause (réglage dans l'onglet <a class="lien-fiche" href="#transmission">Transmission</a>), puis l'assurance-vie sera gardée pour la fin.`}</li>
        <li>Droits de succession, abattements, donations : <a class="lien-fiche" href="#fiche-heritage">tout sur l'héritage</a>. Pour aller plus loin : <a class="lien-fiche" href="#fiche-optimisation-fiscale">optimisation fiscale</a>.</li>
      </ul>
      ${blocDroitsSuccession(D, priorite)}
      <p class="note" style="margin:10px 0 0">Limites : simulation fondée sur les rendements du plan ; elle ne compte ni la dépendance (maison de retraite), ni une éventuelle retraite publique si tu la laisses à 0 €. Les droits de succession sont une estimation (barèmes 2026, euros d'aujourd'hui) : le détail et les hypothèses sont dans l'onglet Transmission.</p>
    </section>`;
  majPension();
  lancerPessimiste();
}
// ---- Retraite, niveau Débutant : une seule question, « Est-ce que ma retraite tient ? ».
// Mêmes tirages et mêmes seuils que « Ce que ça donne » (projeter en version allégée) : aucun écart entre les deux niveaux.
const SEUIL_TENABLE = 0.9, SEUIL_FRAGILE = 0.7;
const verdictRetraite = (proba) => (proba >= SEUIL_TENABLE ? "tenable" : proba >= SEUIL_FRAGILE ? "fragile" : "pas-tenable");
let cacheNecessaire = { cle: null, r: null };
let suggestionRetraite = { cle: null, res: null };
let jetonSuggestion = 0;
function htmlSuggestionRetraite(s) {
  if (!s) return `<p class="small muted" style="margin:0">Je cherche la solution la plus simple… calcul en cours.</p>`;
  const { age, revenu } = s;
  if (age == null && revenu == null) return `<p class="note" style="margin:0">Aucun départ plus tardif ni revenu plus bas ne suffit avec ce plan. Pour aller plus loin, épargne davantage dans « Mon profil » : le détail est dans le niveau Intermédiaire.</p>`;
  const phrase = age != null && revenu != null ? `En t'arrêtant à ${age} ans, ou avec un revenu de ${eur(revenu)} par mois, ça tient.`
    : age != null ? `En t'arrêtant à ${age} ans, ça tient.` : `Avec un revenu de ${eur(revenu)} par mois, ça tient.`;
  return `<p style="margin:0 0 8px"><b>${phrase}</b></p>
    <div class="ligne-actions">${age != null ? `<button type="button" class="principal" data-age-depart="${age}">Arrêter à ${age} ans</button>` : ""}${revenu != null ? `<button type="button" ${age == null ? 'class="principal" ' : ""}data-revenu-retraite="${revenu}">Viser ${eur(revenu)} par mois</button>` : ""}</div>`;
}
// Cherche le départ le plus proche, et le revenu le plus proche, pour lesquels le verdict devient « Tenable ».
// Recherche rapide (moins de tirages), puis confirmation avec les tirages du verdict : la suggestion appliquée donne bien « Tenable ».
async function chercherSuggestionRetraite(R, ageLegal, jeton, cle) {
  const RAPIDE = 200;
  const proba = async (modif, tirages) => {
    await pause();
    if (jeton !== jetonSuggestion) throw new Error("annulé");
    const p = normaliserProfil({ ...etat.profil, retraite: { ...(etat.profil.retraite ?? {}), ...modif } });
    return projeter(etat.brouillon, p, { inclureAchat: true, legere: true, tirages })?.retraite?.probaDure ?? 0;
  };
  try {
    const okAge = async (a, t) => (await proba({ ageDepart: a >= ageLegal ? null : a }, t)) >= SEUIL_TENABLE;
    let age = null;
    const de = R.age + 1;
    if (de <= ageLegal && await okAge(ageLegal, RAPIDE)) {
      let bas = de, haut = ageLegal;
      while (bas < haut) { const m = Math.floor((bas + haut) / 2); if (await okAge(m, RAPIDE)) haut = m; else bas = m + 1; }
      age = haut;
      while (age <= ageLegal && !(await okAge(age))) age++;
      if (age > ageLegal) age = null;
    }
    const PAS = 50;
    const okRevenu = async (k, t) => (await proba({ revenu: k * PAS }, t)) >= SEUIL_TENABLE;
    let revenu = null;
    const kMax = Math.ceil(R.revenu / PAS) - 1;
    if (kMax >= 1) {
      let bas = 0, haut = kMax;
      while (bas < haut) { const m = Math.ceil((bas + haut) / 2); if (await okRevenu(m, RAPIDE)) bas = m; else haut = m - 1; }
      let k = bas;
      while (k > 0 && !(await okRevenu(k))) k--;
      revenu = k > 0 ? k * PAS : null;
    }
    if (jeton !== jetonSuggestion) return;
    suggestionRetraite = { cle, res: { age, revenu } };
    const el = $("#ret-suggestion");
    if (el) el.innerHTML = htmlSuggestionRetraite(suggestionRetraite.res);
  } catch (e) {
    if (e.message !== "annulé") { console.error(e); const el = $("#ret-suggestion"); if (el) el.innerHTML = ""; }
  }
}
function rendreRetraiteDebutant() {
  const plan = etat.brouillon, H = plan.hypotheses;
  let r;
  try { r = projectionCourante(true, { legere: true }); }
  catch (e) { console.error(e); $("#retraite").innerHTML = `<div class="erreur">Calcul impossible : ${echapper(e.message)}.</div>`; return; }
  const R = r.retraite, C = r.central;
  const p0 = normaliserProfil(etat.profil);
  const ageAuj = Math.ceil(p0.age ?? 0), ageLegal = H.ageRetraite ?? 64, ageDepart = R?.age ?? ageLegal;
  const optionsAge = Array.from({ length: Math.max(0, ageLegal - ageAuj + 1) }, (_, k) => ageAuj + k).map((a) => `<option value="${a}" ${a === ageDepart ? "selected" : ""}>${a} ans${a === ageLegal ? " (au plus tard)" : ""}</option>`).join("");
  const reglages = `<section class="panneau" id="ret-simple" data-seul="debutant"><h2>Ta retraite en 2 questions</h2>
    <div class="champs" style="max-width:600px;margin-top:10px">
      ${optionsAge ? `<div class="champ"><label for="r-age">Âge où tu veux arrêter de travailler</label><select id="r-age">${optionsAge}</select></div>` : ""}
      <div class="champ"><label for="r-revenu">Revenu voulu par mois, après impôt, en euros d'aujourd'hui</label><div class="saisie"><input id="r-revenu" type="number" min="0" step="100" value="${p0.retraite?.revenu ?? ""}" placeholder="${plan.retraite?.revenuMensuelDefaut ?? 2000}"><span>€/mois</span></div></div>
    </div>
  </section>`;
  if (!R) {
    $("#retraite").innerHTML = reglages + `<section class="panneau" data-seul="debutant"><p class="muted" style="margin:0">${(p0.age ?? 0) >= ageLegal ? "Ce profil a déjà l'âge de la retraite : la simulation part de la situation actuelle." : "Retraite hors de la période projetée."}</p></section>`;
    return;
  }
  const infl = (H.inflation ?? 0) / 100, reel = (v, i) => v / Math.pow(1 + infl, i);
  const mode = etat.profil.retraite?.modePension ?? "auto";
  const lignePension = mode === "zero" ? "Retraite publique : non comptée (réglage prudent, modifiable en niveau Intermédiaire)."
    : R.pension > 0 ? `Retraite publique ${mode === "auto" ? "estimée" : "comptée (montant saisi en niveau Intermédiaire)"} : ${eur(R.pension)}/mois à partir de ${R.agePension} ans.`
    : "Retraite publique : pas encore estimée (indique ton salaire dans « Mon profil »). Pour l'instant, tes placements paient tout.";
  const proba = R.probaDure, k = verdictRetraite(proba);
  const titre = { tenable: "Tenable", fragile: "Fragile", "pas-tenable": "Pas tenable" }[k];
  const probaTxt = chancesSur100(proba);
  const capR = reel(C[R.iR].financier, R.iR);
  const cle = JSON.stringify([etat.brouillon, etat.profil]);
  if (cacheNecessaire.cle !== cle) cacheNecessaire = { cle, r: capitalNecessaire(etat.brouillon, profilPourMoteur(), { inclureAchat: true }) };
  const nec = cacheNecessaire.r ? reel(cacheNecessaire.r.capital, R.iR) : null;
  const ecart = nec == null ? "" : capR >= nec
    ? (k === "tenable" ? "" : ` Avec des rendements moyens, ton capital suffirait ; mais quelques mauvaises années de bourse au mauvais moment suffisent à le vider : c'est ce qui rend le résultat ${k === "fragile" ? "fragile" : "risqué"}.`)
    : ` Il manque environ ${eurArrondi(nec - capR)} pour tenir avec des rendements moyens.`;
  const verdict = `<p class="verdict ${k === "tenable" ? "ok" : "ko"}" id="ret-verdict"><b>${titre}.</b> Avec ${eur(R.revenu)} par mois (en euros d'aujourd'hui), il y a ${probaTxt} que ton argent dure jusqu'à ${R.ageFin} ans, sur des milliers de scénarios de bourse simulés, bons et mauvais.${k === "tenable" ? "" : " Plus ce chiffre est bas, plus tu risques de manquer d'argent."}${ecart}</p>`;
  let suggestion = "";
  if (k !== "tenable") {
    const memoire = suggestionRetraite.cle === cle ? suggestionRetraite.res : null;
    suggestion = `<div id="ret-suggestion" style="margin-top:10px">${htmlSuggestionRetraite(memoire)}</div>`;
    if (!memoire) { const jeton = ++jetonSuggestion; chercherSuggestionRetraite(R, ageLegal, jeton, cle); }
  } else jetonSuggestion++;
  const tuiles = [
    [`Capital nécessaire à ${R.age} ans`, nec != null ? `${eurEnviron(nec)}` : "—", `pour que l'argent dure jusqu'à ${R.ageFin} ans (rendements moyens)`],
    [`Capital prévu à ${R.age} ans`, `${eurEnviron(capR)}`, "ce que ton plan aura mis de côté (rendements moyens)"],
  ];
  $("#retraite").innerHTML = reglages + `<section class="panneau" id="ret-verdict-bloc" data-seul="debutant"><h2>Est-ce que ma retraite tient ?</h2>
      ${verdict}
      ${suggestion}
      <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px">${tuiles.map(([t, v, sous]) => `<div class="tuile"><span>${t}</span><b class="num">${v}</b><span class="small muted">${sous}</span></div>`).join("")}</div>
      <p class="note" style="margin:10px 0 0">${lignePension} <a class="lien-fiche" href="#fiche-retraite-publique">Comment elle est estimée</a></p>
      <p class="note" style="margin:6px 0 0">Tous les montants sont en euros d'aujourd'hui (inflation déduite). Tu arrêtes de travailler et d'épargner à ${R.age} ans ; tu te verses ensuite ce revenu jusqu'à ${R.ageFin} ans, pris sur tes placements.</p>
    </section>`;
}

// Estimation de la retraite publique (base + complémentaire)
function blocPension(p0) {
  const plan = etat.brouillon, RP = plan.retraitePublique ?? {};
  const rr = p0.retraite ?? {};
  const ages = Array.from({ length: 70 - 62 + 1 }, (_, k) => 62 + k);
  return `<section class="panneau" id="bloc-pension" data-min="intermediaire"><h2>Estimer ta retraite publique</h2>
    <p class="note" style="margin:4px 0 10px">Estimation simplifiée pour un salarié du privé, à partir de ton salaire et de ta carrière (voir la fiche <a class="lien-fiche" href="#fiche-retraite-publique">Retraite publique</a>). Ton relevé officiel est sur info-retraite.fr.</p>
    <div class="estimateur" style="max-width:640px">
      <div class="champ"><label for="pp-debut">Âge de ton premier emploi</label><div class="saisie"><input id="pp-debut" type="number" min="14" max="40" step="1" value="${rr.ageDebutCarriere ?? ""}" placeholder="${RP.ageDebutCarriere ?? 22}"><span>ans</span></div></div>
      <div class="champ"><label for="pp-trim">Trimestres déjà validés (sur ton relevé, facultatif)</label><div class="saisie"><input id="pp-trim" type="number" min="0" max="200" step="1" value="${rr.trimestresDeja ?? ""}" placeholder="estimés"><span>trim.</span></div></div>
      <div class="champ"><label for="pp-enf">Trimestres pour enfants (jusqu'à 8 par enfant, en général pour la mère)</label><div class="saisie"><input id="pp-enf" type="number" min="0" max="80" step="1" value="${rr.trimestresEnfants ?? ""}" placeholder="0"><span>trim.</span></div></div>
      <div class="champ"><label for="pp-demande">Âge où tu la demandes</label><select id="pp-demande">${ages.map((a) => `<option value="${a}" ${Number(rr.ageDemande) === a ? "selected" : ""}>${a} ans</option>`).join("")}</select></div>
    </div>
    <div id="pension-resultat" style="margin-top:12px"></div>
  </section>`;
}
function majPension() {
  const out = $("#pension-resultat"); if (!out) return;
  const plan = etat.brouillon, RP = plan.retraitePublique ?? {};
  const p0 = normaliserProfil(etat.profil), rr = p0.retraite ?? {};
  const PR = projectionCourante(true).retraite;
  const ageArret = PR?.age ?? plan.hypotheses.ageRetraite ?? 64;
  let est;
  try { est = estimerPension(plan, p0, { ageDebut: rr.ageDebutCarriere, trimestresDeja: rr.trimestresDeja, ageArret, ageDemande: rr.ageDemande, trimestresEnfants: rr.trimestresEnfants }); }
  catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Estimation impossible : ${echapper(e.message)}</p>`; return; }
  const sel = $("#pp-demande");
  if (sel && !rr.ageDemande) sel.value = String(Math.ceil(Math.max(est.regles.ageLegal, ageArret)));
  if ($("#pp-trim") && !(rr.trimestresDeja >= 0 && rr.trimestresDeja !== null && rr.trimestresDeja !== "")) $("#pp-trim").placeholder = `≈ ${est.passes}`;
  const lignes = [[`À l'âge légal (${ageEnTexte(est.regles.ageLegal)})`, est.auLegal], [`À ${RP.ageTauxPlein ?? 67} ans (taux plein automatique)`, est.aTauxPlein]];
  const demande = est.demande;
  if (![est.auLegal.age, est.aTauxPlein.age].includes(demande.age)) lignes.push([`À ${ageEnTexte(demande.age)} (ton choix)`, demande]);
  const tab = lignes.map(([l, x]) => `<tr><td>${l}</td><td class="m">${pct(x.taux)}${x.decote ? `<div class="small muted">décote de ${x.decote} trim.</div>` : ""}${x.surcote > 0 ? `<div class="small muted">surcote +${pct(x.surcote)}</div>` : ""}${x.majEnfants ? `<div class="small muted">+${x.majEnfants} % (3 enfants)</div>` : ""}</td><td class="m">${eur(x.base)}</td><td class="m">${eur(x.complementaire)}</td><td class="m">${eur(x.net)}</td><td class="m"><b>${eur(x.apres)}</b></td></tr>`).join("");
  const manque = Math.max(0, est.regles.trimestres - est.trimestres);
  const agePension = Math.ceil(demande.age);
  const actuel = Number(rr.pension) || 0;
  out.innerHTML = `
    <p class="small" style="margin:0 0 8px">Né(e) vers ${est.naissance} : âge légal <b>${ageEnTexte(est.regles.ageLegal)}</b>, <b>${est.regles.trimestres} trimestres</b> pour le taux plein. Avec un premier emploi à ${est.debut} ans et un arrêt à ${ageArret} ans : <b>${est.trimestres} trimestres</b>${manque ? `, soit ${manque} de moins que le taux plein` : ", assez pour le taux plein"}. ${est.regime === "ssi" ? "Revenu annuel moyen cotisé (25 meilleures années, plafonné au PASS)" : "Salaire annuel moyen retenu (25 meilleures années, brut, plafonné)"} : ${eur(est.sam)} ; ${est.points.toLocaleString("fr-FR")} points de complémentaire (${est.libelleComplementaire ?? "Agirc-Arrco"}).</p>
    ${est.alertes?.length ? `<ul class="note attention" style="margin:0 0 8px">${est.alertes.map((a) => `<li>${echapper(a)}</li>`).join("")}</ul>` : ""}
    ${ageArret < est.regles.ageLegal ? `<p class="verdict ko" style="margin:0 0 8px"><b>Tu arrêtes à ${ageArret} ans : la retraite publique n'est versée qu'à partir de ${ageEnTexte(est.regles.ageLegal)} au plus tôt.</b> Entre les deux, tes placements doivent tout payer, et tu ne valides plus de trimestres.</p>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Si tu la demandes</th><th class="m">Taux</th><th class="m">Base (net)</th><th class="m">${est.libelleComplementaire ?? "Agirc-Arrco"} (net)</th><th class="m">Total net / mois</th><th class="m">Après impôt</th></tr></thead><tbody>${tab}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">En euros d'aujourd'hui. Approximations : ${est.regime === "ssi" ? `trimestres validés selon le revenu (150 h au SMIC = ${eur(Math.round(((RP.independants?.smicHoraire ?? 12.02) * (RP.independants?.heuresParTrimestre ?? 150))))} par trimestre)` : "4 trimestres par année travaillée"}, salaires passés déduits de ton profil de carrière, trimestres pour enfants seulement si tu les indiques, pas de trimestres pour chômage ou maladie, complémentaire réduite comme la base en cas de décote. Surcote de 1,25 % par trimestre travaillé après l'âge légal au-delà de la durée requise ; +10 % sur la base et la complémentaire avec au moins 3 enfants (champ « Enfants à charge » de « Mon profil » ; compte aussi les enfants élevés, même plus à charge) ; plus de malus Agirc-Arrco depuis décembre 2023. « Après impôt » : barème 2026 pour une personne seule, abattement de 10 % compris (<a class="lien-fiche" href="#fiche-net-impot">net avant ou après impôt ?</a>). Les règles peuvent encore changer d'ici ta retraite.</p>
    <div class="ligne-actions" style="margin-top:10px">
      ${(rr.modePension ?? "auto") === "auto"
        ? `<span class="small"><b>✓ Comptée automatiquement</b> : ${eur(Math.round(demande.apres / 10) * 10)} par mois à partir de ${agePension} ans, recalculée si tu changes l'âge d'arrêt.</span><button type="button" class="lien" data-pension="0" data-age-pension="">Ne pas la compter (prudence)</button>`
        : `<button type="button" class="principal" data-pension="auto" data-age-pension="">Revenir au calcul automatique (${eur(Math.round(demande.apres / 10) * 10)} par mois)</button>${actuel > 0 ? `<button type="button" class="lien" data-pension="0" data-age-pension="">Revenir à 0 € (prudence)</button><span class="small muted">Actuellement compté : ${eur(actuel)} à partir de ${PR?.agePension ?? agePension} ans.</span>` : ""}`}
    </div>`;
}
// Retraite publique automatique : les trimestres et l'âge de départ saisis changent le montant compté

// Âge de départ possible et revenus « pessimistes » (9 scénarios sur 10)
const clePessimiste = () => { const r = { ...(etat.profil.retraite ?? {}) }; delete r.ageDebutCarriere; delete r.trimestresDeja; delete r.ageDemande; return JSON.stringify([etat.brouillon, { ...etat.profil, retraite: r }]); };
let pessimiste = { cle: null };
let jetonPessimiste = 0;
function agePossibleCentral() {
  const ctx = contexteRetraite(etat.brouillon, profilPourMoteur());
  const { PR, profil } = ctx;
  const ok = (a) => !!evaluerRetraite(ctx, { age: a })?.preserve;
  return chercherAge(ok, Math.ceil(profil.age), PR.ageLegal);
}
function chercherAge(ok, de, a) {
  if (a < de || !ok(a)) return null;
  let bas = de, haut = a;
  while (bas < haut) { const m = Math.floor((bas + haut) / 2); if (ok(m)) haut = m; else bas = m + 1; }
  return haut;
}
function boutonsAge(central, pess, actuel, legal) {
  const b = [];
  if (pess != null && pess !== actuel) b.push(`<button type="button" class="principal" data-age-depart="${pess}">Simuler un départ à ${pess} ans (pessimiste)</button>`);
  if (central != null && central !== actuel && central !== pess) b.push(`<button type="button" data-age-depart="${central}">Simuler un départ à ${central} ans (central)</button>`);
  if (actuel !== legal) b.push(`<button type="button" class="lien" data-age-depart="${legal}">Revenir à ${legal} ans</button>`);
  return b.join("");
}
async function lancerPessimiste() {
  const cle = clePessimiste();
  if (pessimiste.cle === cle) return;
  const jeton = ++jetonPessimiste;
  const ctx = contexteRetraite(etat.brouillon, profilPourMoteur());
  const { PR, profil } = ctx;
  const N = 200;
  const ok = async (a, revenu, critere) => { await pause(); if (jeton !== jetonPessimiste) throw new Error("annulé"); return !!evaluerRetraite(ctx, { age: a, revenu, scenarios: N })?.[critere]; };
  try {
    // Âge le plus tôt où le capital est transmis intact dans 9 cas sur 10
    let age = null;
    const de = Math.ceil(profil.age), a = PR.ageLegal;
    if (a >= de && await ok(a, PR.revenu, "preserve")) {
      let bas = de, haut = a;
      while (bas < haut) { const m = Math.floor((bas + haut) / 2); if (await ok(m, PR.revenu, "preserve")) haut = m; else bas = m + 1; }
      age = haut;
    }
    if (jeton !== jetonPessimiste) return;
    $("#age-pessimiste") && ($("#age-pessimiste").innerHTML = age == null ? `pas avant ${PR.ageLegal} ans` : `${age} ans`);
    // Revenus possibles à l'âge de départ choisi, dans 9 cas sur 10
    const chercher = async (critere) => { let bas = 0, haut = 20000; for (let k = 0; k < 13; k++) { const m = (bas + haut) / 2; if (await ok(PR.age, m, critere)) bas = m; else haut = m; } return bas; };
    const revenuPreserve = await chercher("preserve");
    if ($("#pess-preserve")) $("#pess-preserve").textContent = `${eur(revenuPreserve)}/mois`;
    const revenuConsomme = await chercher("dure");
    if ($("#pess-consomme")) $("#pess-consomme").textContent = `${eur(revenuConsomme)}/mois`;
    pessimiste = { cle, age, revenuPreserve, revenuConsomme };
    if ($("#actions-age")) $("#actions-age").innerHTML = boutonsAge(agePossibleCentral(), age, PR.age, PR.ageLegal);
  } catch (e) { if (e.message !== "annulé") console.error(e); }
}

// Écouteurs de l'onglet Retraite (pension, âge de départ, mode, priorité, revenu voulu), attachés une seule fois au démarrage par app.js
export function monterRetraite() {
  $("#vue-retraite").addEventListener("input", (e) => {
    const map = { "pp-debut": "ageDebutCarriere", "pp-trim": "trimestresDeja", "pp-enf": "trimestresEnfants" };
    const k = map[e.target.id]; if (!k) return;
    etat.profil.retraite ??= {};
    etat.profil.retraite[k] = e.target.value === "" ? null : Number(e.target.value);
    memo.set("profil-v2", etat.profil); planifierSauvegardeProfil();
    majPension();
  });
  $("#vue-retraite").addEventListener("change", (e) => {
    if (!["pp-debut", "pp-trim", "pp-enf"].includes(e.target.id) || (etat.profil.retraite?.modePension ?? "auto") !== "auto") return;
    syncRetraite0(); rendreRetraite(); planifierTrajectoire();
  });
  $("#vue-retraite").addEventListener("change", (e) => {
    if (e.target.id !== "pp-demande") return;
    etat.profil.retraite ??= {};
    etat.profil.retraite.ageDemande = Number(e.target.value);
    memo.set("profil-v2", etat.profil); planifierSauvegardeProfil();
    majPension();
    if ((etat.profil.retraite?.modePension ?? "auto") === "auto") { syncRetraite0(); rendreRetraite(); planifierTrajectoire(); }
  });
  $("#vue-retraite").addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-pension]"); if (!b) return;
    etat.profil.retraite ??= {};
    etat.profil.retraite.modePension = b.dataset.pension === "auto" ? "auto" : Number(b.dataset.pension) > 0 ? "manuel" : "zero";
    etat.profil.retraite.pension = Number(b.dataset.pension) || null;
    etat.profil.retraite.agePension = Number(b.dataset.agePension) || null;
    syncRetraite0();
    memo.set("profil-v2", etat.profil); planifierSauvegardeProfil();
    rendreRetraite();
  });
  $("#vue-retraite").addEventListener("click", (e) => { const b = e.target.closest?.("[data-age-depart]"); if (b) choisirAgeDepart(Number(b.dataset.ageDepart)); });
  $("#vue-retraite").addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-revenu-retraite]"); if (!b) return;
    etat.profil.retraite ??= {};
    etat.profil.retraite.revenu = Number(b.dataset.revenuRetraite);
    memo.set("profil-v2", etat.profil);
    syncRetraite0();
    planifierSauvegardeProfil();
    rendreRetraite();
  });
  $("#vue-retraite").addEventListener("change", (e) => {
    if (e.target.id === "r-age") choisirAgeDepart(Number(e.target.value));
    if (e.target.id === "r-mode" || e.target.id === "r-loyers" || e.target.id === "r-priorite") {
      etat.profil.retraite ??= {};
      if (e.target.id === "r-mode") etat.profil.retraite.modePension = e.target.value;
      else if (e.target.id === "r-priorite") etat.profil.retraite.priorite = e.target.value === "consommer" ? "consommer" : "transmettre";
      else etat.profil.retraite.compterLoyers = e.target.checked;
      memo.set("profil-v2", etat.profil); syncRetraite0(); planifierSauvegardeProfil(); rendreRetraite(); planifierTrajectoire();
    }
  });
  $("#vue-retraite").addEventListener("input", (e) => {
    if (e.target.id !== "r-revenu" && e.target.id !== "r-pension") return;
    etat.profil.retraite ??= {};
    const v = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
    if (e.target.id === "r-revenu") etat.profil.retraite.revenu = v; else etat.profil.retraite.pension = v;
    memo.set("profil-v2", etat.profil);
    syncRetraite0();
    planifierSauvegardeProfil();
    programmerRendu(() => {
      const actif = document.activeElement?.id;
      rendreRetraite();
      if (actif) { const el = document.getElementById(actif); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch {} } }
    }, 400);
  });
}
