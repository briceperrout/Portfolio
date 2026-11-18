// Règle d'architecture : une vue exporte rendre<Nom>() et monter<Nom>() (écouteurs, appelée une seule fois par app.js
// au démarrage) et n'a aucun effet de bord au niveau module. Elle importe ui/commun.js et les modules métier, et des
// fonctions (jamais de const/let) d'app.js : import circulaire sûr car ces fonctions sont hissées.
import { $, lire, ecrire, memo, etat, echapper, DEPART_DEFAUT } from "../ui/commun.js";
import { eur, pct, consequencesDepart, NOTE_CONSEQUENCES_DEPART } from "../moteur.js";
import { tauxEffectifs, consoliderEtrangers } from "../devises.js";
import { entreeDepuisProfil, comparerStatutsConjugaux, partageDepuisProfil, simulerSuccession, comparerOptionsConjoint, simulerDonationNP, optionsPossibles } from "../succession.js";
import { exitTax } from "../fiscal.js";
import { creerChampCE, lienFiche, planifierSauvegardeProfil, profilDeCalcul, profilPourMoteur } from "../app.js";

// ---------------------------------------------------------------- Transmission : succession et donation (calculs dans succession.js)
// Les champs « succession.* » sont liés au profil par data-p ; les montants en euros passent par eur(), donc par le mode discrétion (Alt+H).
const DETENUS_TEXTE = { pp: "pleine propriété", np: "nue-propriété", us: "usufruit", "pp+us": "pleine propriété (un quart) et usufruit" };
const SITUATION_TEXTE = { seul: "Seul(e)", mariage: "Marié(e)", pacs: "Pacsé(e)", concubin: "En concubinage" };
const OPTION_TEXTE = {
  quart_pp: "Un quart en pleine propriété", usufruit: "Usufruit de toute la succession",
  quart_pp_usufruit: "Un quart en pleine propriété et usufruit du reste", quotite_disponible: "Quotité disponible en pleine propriété",
  communaute_universelle: "Si changement de régime (notaire) : communauté universelle",
};
const heritierTexte = (h) => (h.lien === "conjoint" ? "Conjoint survivant" : h.lien === "pacs" ? "Partenaire de PACS" : h.lien === "concubin" ? "Concubin" : `Enfant ${h.id.replace("enfant", "")}`);
// ---------------------------------------------------------------- Quitter la France : exit tax et sort des comptes (fiscal.js, moteur.js)
// Les champs « simulationDepart.* » sont liés au profil par data-p ; le rendu est construit sans innerHTML (textContent) et les montants passent par eur() (mode discrétion).
const ACTION_DEPART = { conserver: "Conserver", cloturer: "Clôturer", gelerVersements: "Conserver, arrêter les versements" };
function noeudDepart(balise, texte, attrs = {}) { const e = creerChampCE(balise, attrs); if (texte != null) e.textContent = texte; return e; }
function ligneTableDepart(cellules) {
  const tr = document.createElement("tr");
  cellules.forEach(([texte, montant]) => tr.append(noeudDepart("td", texte, montant ? { class: "m num" } : {})));
  return tr;
}
export function rendreDepart() {
  const bloc = $("#dp-resultat"); if (!bloc) return;
  const plan = etat.brouillon, p = etat.profil, D = { ...DEPART_DEFAUT, ...(p.simulationDepart ?? {}) };
  const select = $("#dp-pays");
  if (!select.options.length) {
    select.append(noeudDepart("option", "Choisis un pays", { value: "" }));
    for (const [code, v] of Object.entries(plan.residence?.pays ?? {})) if (code !== "FR") select.append(noeudDepart("option", v.libelle ?? code, { value: code }));
  }
  const calcul = profilPourMoteur();
  const T = tauxEffectifs(p, etat.tauxDuJour);
  const epargneEtrangere = consoliderEtrangers(p, T.taux).lignes.filter((l) => l.type === "epargneEtrangere").reduce((t, l) => t + l.soldeEUR, 0);
  const titresDefaut = Math.round((Number(calcul.placements?.cto) || 0) + epargneEtrangere);
  $("#dp-titres").placeholder = String(titresDefaut);
  const titres = D.valeurTitres == null ? titresDefaut : Number(D.valeurTitres) || 0;
  const annees = D.anneesResidence10 == null ? 10 : Number(D.anneesResidence10) || 0;
  const x = exitTax({ valeurTitres: titres, plusValuesLatentes: D.plusValuesLatentes, moinsValuesLatentes: D.moinsValuesLatentes, participation50: D.participation50 === true, anneesResidence10: annees, destination: D.destination === "autre" ? "autre" : "ue" });
  const enfants = [];
  const verdict = noeudDepart("p", null, { style: "margin:8px 0 4px" });
  verdict.append(noeudDepart("b", x.assujetti ? "Exit tax : tu serais assujetti(e)." : "Exit tax : tu ne serais pas assujetti(e)."));
  enfants.push(verdict);
  const motifs = noeudDepart("ul", null, { class: "points" });
  x.motifs.forEach((m) => motifs.append(noeudDepart("li", m)));
  enfants.push(motifs);
  if (x.assujetti) {
    const tab = noeudDepart("table"), corps = noeudDepart("tbody");
    corps.append(
      ligneTableDepart([["Base imposable (plus-values latentes moins moins-values latentes)", false], [eur(x.base), true]]),
      ligneTableDepart([["Impôt sur le revenu (prélèvement forfaitaire)", false], [eur(x.impotIR), true]]),
      ligneTableDepart([["Prélèvements sociaux", false], [eur(x.prelevementsSociaux), true]]),
      ligneTableDepart([["Total", false], [eur(x.total), true]]),
      ligneTableDepart([["Sursis de paiement", false], [x.sursis === "automatique" ? "Automatique (UE ou EEE avec convention)" : "Sur demande, avec garanties", false]]),
      ligneTableDepart([["Dégrèvement possible si les titres sont gardés", false], [`${x.degrevementApresAns} ans`, false]]),
    );
    corps.lastElementChild.previousElementSibling.previousElementSibling.classList.add("tm-ligne-total");
    tab.append(corps);
    const wrap = noeudDepart("div", null, { class: "table-wrap" }); wrap.append(tab); enfants.push(wrap);
    const notes = noeudDepart("ul", null, { class: "points small muted" });
    x.notes.forEach((m) => notes.append(noeudDepart("li", m)));
    enfants.push(notes);
  }
  // Sort de chaque compte
  const lignes = consequencesDepart(plan, calcul, D.pays || "AUTRE");
  enfants.push(noeudDepart("h3", "Sort de tes comptes", { style: "margin:12px 0 4px" }));
  if (!lignes.length) enfants.push(noeudDepart("p", "Aucun compte avec un solde à examiner (les comptes à l'étranger ne sont pas concernés).", { class: "muted", style: "margin:0" }));
  else {
    const wrap = noeudDepart("div", null, { class: "table-wrap" }), tab = noeudDepart("table"), tete = noeudDepart("thead"), tr = document.createElement("tr");
    ["Compte", "Solde", "Décision", "Pourquoi"].forEach((t, i) => tr.append(noeudDepart("th", t, i === 1 ? { class: "m" } : {})));
    tete.append(tr);
    const corps = noeudDepart("tbody");
    lignes.forEach((l) => {
      const ligne = document.createElement("tr");
      ligne.append(noeudDepart("td", l.libelle), noeudDepart("td", eur(l.solde), { class: "m num" }), noeudDepart("td", ACTION_DEPART[l.action] ?? l.action), noeudDepart("td", l.explication));
      corps.append(ligne);
    });
    tab.append(tete, corps); wrap.append(tab); enfants.push(wrap);
  }
  enfants.push(noeudDepart("p", NOTE_CONSEQUENCES_DEPART, { class: "small muted", style: "margin:8px 0 0" }));
  bloc.replaceChildren(...enfants);
}
export function rendreTransmission() {
  const sortie = $("#tm-resultat"); if (!sortie) return;
  const p = etat.profil;
  rendreDepart();
  // Champs liés au profil (sauf celui qu'on est en train de saisir)
  document.querySelectorAll("#vue-transmission [data-p]").forEach((el) => {
    if (el === document.activeElement) return;
    const v = lire(p, el.dataset.p);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  });
  const annee = new Date().getFullYear();
  let entree, r;
  try { entree = entreeDepuisProfil(profilDeCalcul(p), annee); r = simulerSuccession(entree); }
  catch (e) { console.error(e); sortie.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const sit = entree.situation, couple = sit === "mariage" || sit === "pacs", avecEnfants = entree.enfants > 0;
  $("#tm-rappel").innerHTML = `Repris de ton profil : <b>${SITUATION_TEXTE[sit]}</b> · tu as <b>${entree.ageDefunt} ans</b>${sit !== "seul" ? ` · ton conjoint ou partenaire a <b>${entree.ageConjoint} ans</b>` : ""} · <b>${entree.enfants}</b> enfant${entree.enfants > 1 ? "s" : ""}. Pour les changer, va dans <a class="lien-fiche" href="#mon-profil">Mon profil</a>.`;
  const montre = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  montre("#tm-ch-union", couple); montre("#tm-ch-regime", sit === "mariage");
  montre("#tm-ch-testament", sit === "pacs" || sit === "concubin"); montre("#tm-ch-mineur", sit === "seul" || sit === "concubin");
  montre("#tm-ch-clause", sit !== "seul");
  montre("#tm-ch-option", sit === "mariage" && avecEnfants && entree.regime !== "communaute_universelle"); montre("#tm-ch-ddv", sit === "mariage" && avecEnfants);
  montre("#tm-ch-noncommuns", sit === "mariage" && avecEnfants); montre("#tm-ch-propres", sit !== "seul" && entree.regime !== "communaute_universelle"); montre("#tm-ch-propres-conjoint", sit !== "seul" && entree.regime !== "communaute_universelle");
  $("#tm-noncommuns").max = String(entree.enfants);
  // Options du conjoint impossibles dans cette situation : grisées (« auto » reste toujours disponible) ; si la valeur enregistrée
  // est devenue impossible, simulerSuccession se replie sur le quart en pleine propriété et l'indique dans les hypothèses
  const possibles = optionsPossibles(entree);
  document.querySelectorAll("#tm-option option").forEach((o) => { o.disabled = o.value !== "auto" && !possibles.includes(o.value); });

  const M = r.masse;
  const lignesH = r.heritiers.map((h) => `<tr><td>${heritierTexte(h)}</td><td>${h.recuSuccession > 0 ? DETENUS_TEXTE[h.droitsDetenus] ?? "" : "—"}</td><td class="m">${eur(h.recuSuccession)}</td><td class="m">${eur(h.avHorsSuccession)}</td><td class="m">${eur(h.abattement)}</td><td class="m">${eur(h.droitsTotal)}</td><td class="m"><b>${eur(h.net)}</b></td></tr>`).join("");
  const synthese = `<section class="panneau" id="tm-synthese">
    <h2>Ce que tes héritiers recevraient</h2>
    <p class="small muted" style="margin:0 0 8px">Masse successorale nette : <b>${eur(M.masseNette)}</b> (actifs de la succession ${eur(M.actifBrut)}${M.abattementRP > 0 ? `, moins l'abattement de 20 % sur la résidence principale ${eur(M.abattementRP)}` : ""}, moins les dettes ${eur(M.passif)}, moins le forfait funéraire ${eur(M.forfaitFuneraire)}). L'assurance-vie et le PER sont hors succession.</p>
    ${r.heritiers.length ? `<div class="table-wrap"><table><thead><tr><th>Héritier</th><th>Reçoit en</th><th class="m">Reçu (valeur fiscale)</th><th class="m">Assurance-vie et PER</th><th class="m">Abattement</th><th class="m">Droits</th><th class="m">Net</th></tr></thead><tbody>${lignesH}
      <tr class="tm-ligne-total"><td colspan="5">Total</td><td class="m">${eur(r.totalDroits)}</td><td class="m">${eur(r.netTransmis)}</td></tr></tbody></table></div>
    <p style="margin:8px 0 0">Droits totaux : <b>${eur(r.totalDroits)}</b> · net transmis : <b>${eur(r.netTransmis)}</b> · taux effectif : <b>${pct(r.tauxEffectif)}</b></p>` : `<p class="muted">Aucun héritier modélisé dans cette situation (voir les points hors périmètre).</p>`}
    ${r.hypotheses.length ? `<ul class="points tm-liste">${r.hypotheses.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul>` : ""}
    <details style="margin-top:8px"><summary class="small">Hors périmètre de cette estimation</summary><ul class="points">${r.horsPerimetre.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul></details>
    <p class="note" style="margin:8px 0 0">${lienFiche("heritage", "Fiche Héritage et transmission")}</p>
  </section>`;

  let options = "";
  let lignesO = [];
  try { lignesO = comparerOptionsConjoint(entree); } catch (e) { console.error(e); }
  if (lignesO.length) {
    const meilleure = lignesO.find((l) => l.option !== "communaute_universelle");
    const corps = lignesO.map((l) => `<tr${l === meilleure ? ' class="meilleure"' : ""}><td>${OPTION_TEXTE[l.option] ?? l.option}${l === meilleure ? " (la moins chère)" : ""}</td><td class="m">${eur(l.droits1erDeces)}</td><td class="m">${eur(l.droits2eDeces)}</td><td class="m">${eur(l.total)}</td><td class="m">${eur(l.netEnfants)}</td></tr>`).join("");
    options = `<section class="panneau" id="tm-options" data-min="avance">
      <h2>Options du conjoint survivant : deux décès</h2>
      <p class="small muted" style="margin:0 0 8px">Droits payés par les enfants au premier décès, puis au second (à valeurs constantes, sans consommation du patrimoine).</p>
      <div class="table-wrap"><table><thead><tr><th>Option</th><th class="m">1er décès</th><th class="m">2e décès</th><th class="m">Total des droits</th><th class="m">Net pour les enfants</th></tr></thead><tbody>${corps}</tbody></table></div>
    </section>`;
  }
  sortie.innerHTML = synthese + options;

  // Concubinage, PACS ou mariage ? (même profil et même année que la simulation ci-dessus)
  const stat = $("#tm-statuts"), part = $("#tm-partage");
  let cmp = null, sep = null;
  try { cmp = comparerStatutsConjugaux(profilDeCalcul(p), annee); } catch (e) { console.error(e); }
  try { sep = partageDepuisProfil(profilDeCalcul(p), annee); } catch (e) { console.error(e); }
  const STATUT_TEXTE = { concubin: "Concubinage", pacs: "PACS", mariage: "Mariage" };
  if (stat) {
    if (!cmp) stat.innerHTML = "";
    else {
      const g = cmp.impot.gainCommun;
      const phrase = Math.abs(g) < 1 ? "Imposition commune : aucune différence d'impôt par rapport à deux déclarations séparées." : g > 0 ? `Imposition commune : <b>${eur(g)}</b> d'impôt en moins par an.` : `Imposition commune : <b>${eur(-g)}</b> d'impôt en plus par an.`;
      const corps = cmp.lignes.map((l) => `<tr><td>${STATUT_TEXTE[l.statut] ?? l.statut}${l.testament ? " + testament" : ""}</td><td class="m">${eur(l.impotAnnuel)}</td><td class="m">${eur(l.droitsSurvivant)}</td><td class="m">${eur(l.netSurvivant)}</td><td>${l.heritierLegal ? "Oui" : "Non"}</td></tr>`).join("");
      stat.innerHTML = `<section class="panneau">
        <h2>Concubinage, PACS ou mariage ?</h2>
        <p class="small" style="margin:0 0 8px">${phrase}</p>
        <div class="table-wrap"><table><thead><tr><th>Statut</th><th class="m">Impôt sur le revenu / an</th><th class="m">Droits au décès</th><th class="m">Net reçu par le survivant</th><th>Héritier sans testament</th></tr></thead><tbody>${corps}</tbody></table></div>
        <details style="margin-top:8px"><summary class="small">Hypothèses</summary><ul class="points">${cmp.hypotheses.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul></details>
      </section>`;
    }
  }
  if (part) {
    if (!sep) part.innerHTML = "";
    else {
      const prenom = echapper(p.conjoint?.prenom?.trim() || "Ton conjoint");
      const REGIME_TEXTE = { communaute_legale: "communauté réduite aux acquêts", separation: "séparation de biens", communaute_universelle: "communauté universelle" };
      const regime = sep.situation === "mariage" ? `, régime : ${REGIME_TEXTE[sep.regime] ?? echapper(sep.regime ?? "")}` : "";
      const ligne = (nom, x) => `<tr><td>${nom}</td><td class="m">${eur(x.propres)}</td><td class="m">${eur(x.communs)}</td><td class="m">${eur(x.dettes)}</td><td class="m"><b>${eur(x.net)}</b></td></tr>`;
      const phraseEcart = Math.abs(sep.ecart) < 1 ? "Le partage laisse à chacun le même patrimoine net." : `Le partage laisse à ${sep.ecart > 0 ? "toi" : prenom} <b>${eur(Math.abs(sep.ecart))}</b> de patrimoine net de plus.`;
      part.innerHTML = `<section class="panneau">
        <h2>En cas de séparation</h2>
        <p class="small muted" style="margin:0 0 8px">Situation actuelle : ${SITUATION_TEXTE[sep.situation] ?? sep.situation}${regime}.</p>
        <div class="table-wrap"><table><thead><tr><th></th><th class="m">Biens propres</th><th class="m">Part des biens communs ou indivis</th><th class="m">Dettes</th><th class="m">Patrimoine net</th></tr></thead><tbody>${ligne("Toi", sep.A)}${ligne(prenom, sep.B)}</tbody></table></div>
        <p style="margin:8px 0 0">${phraseEcart}</p>
        <details style="margin-top:8px"><summary class="small">Hypothèses et points non pris en compte</summary><ul class="points">${sep.hypotheses.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul><p class="small" style="margin:6px 0 0">Non pris en compte :</p><ul class="points">${sep.horsPerimetre.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul></details>
        <p class="note" style="margin:8px 0 0">Estimation indicative : seul un notaire ou un avocat chiffre un partage réel.</p>
      </section>`;
    }
  }

  // Donation de nue-propriété
  const D = p.succession?.projetDonation ?? {};
  const bloc = $("#tm-donation-resultat");
  const sansEnfant = entree.enfants <= 0;
  document.querySelectorAll("#tm-donation input").forEach((el) => { el.disabled = sansEnfant; });
  if (sansEnfant) bloc.innerHTML = `<p class="muted" style="margin:0">Indique au moins un enfant dans <a class="lien-fiche" href="#mon-profil">Mon profil</a> pour simuler une donation.</p>`;
  else if (!(Number(D.valeur) > 0)) bloc.innerHTML = `<p class="muted" style="margin:0">Saisis la valeur du bien à donner pour voir l'économie de droits.</p>`;
  else {
    let d = null;
    // Reste de la succession : part moyenne reçue par chaque enfant dans la simulation ci-dessus (elle s'ajoute au bien au décès)
    const recus = r.heritiers.filter((h) => h.lien === "enfant").map((h) => h.recuSuccession);
    const autres = recus.length ? recus.reduce((t, x) => t + x, 0) / recus.length : 0;
    try { d = simulerDonationNP({ valeur: Number(D.valeur), ageDonateur: entree.ageDefunt, enfants: entree.enfants, donations: entree.donations, annee, croissance: (Number(D.croissance) || 0) / 100, anneesAvantDeces: Number(D.annees) || 0, autresBiensParEnfant: autres }); }
    catch (e) { console.error(e); }
    bloc.innerHTML = d ? `<p style="margin:0">À ${entree.ageDefunt} ans, la nue-propriété vaut <b>${pct(d.nuePropriete)}</b> du bien, soit <b>${eur(d.valeurNP)}</b> à partager entre ${entree.enfants} enfant${entree.enfants > 1 ? "s" : ""}.</p>
      <div class="table-wrap"><table><tbody>
        <tr><td>Droits si tu donnes aujourd'hui</td><td class="m">${eur(d.droitsDonation)}</td></tr>
        ${d.droitsDecesAvecDonation > 0 || autres > 0 ? `<tr><td>Droits au décès sur le reste de la succession (donation rappelée si moins de 15 ans)</td><td class="m">${eur(d.droitsDecesAvecDonation)}</td></tr>` : ""}
        <tr><td>Droits si rien n'est donné : bien et reste de la succession transmis au décès, dans ${Number(D.annees) || 0} ans</td><td class="m">${eur(d.droitsSansDonation)}</td></tr>
        <tr class="tm-ligne-total"><td>Économie de droits</td><td class="m">${eur(d.economie)}</td></tr></tbody></table></div>
      <p class="small muted" style="margin:8px 0 4px">Le reste de ta succession (${eur(autres)} par enfant dans la simulation ci-dessus) est pris en compte : une donation de moins de 15 ans est rappelée au décès et consomme l'abattement de 100 000 €. Si le bien donné figure déjà dans tes placements ou ton logement, il est compté deux fois dans ce reste.</p>
      <p class="small muted" style="margin:8px 0 4px">Renouvellements de l'abattement de 100 000 € par enfant (tous les 15 ans) :</p>
      <ul class="points">${d.calendrier.map((l) => `<li>${l.annee}, à ${l.age} ans : ${eur(l.abattementParEnfant)} par enfant, nue-propriété à ${pct(l.nuePropriete)}</li>`).join("")}</ul>` : "";
  }
}
export function monterTransmission() {
  $("#vue-transmission").addEventListener("input", (e) => {
    const el = e.target;
    if (!el.dataset?.p) return;
    if (el.type === "number" && el.max !== "" && el.value !== "" && Number(el.value) > Number(el.max)) el.value = el.max;
    const v = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : el.value === "" ? (el.placeholder ? null : 0) : Number(el.value);
    ecrire(etat.profil, el.dataset.p, v);
    memo.set("profil-v2", etat.profil);
    rendreTransmission();
    planifierSauvegardeProfil();
  });
}
