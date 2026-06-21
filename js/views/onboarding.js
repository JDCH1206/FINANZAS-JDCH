// js/views/onboarding.js
import { getState, setState } from "../state.js";
import { saveConfig } from "../firebase-service.js";

export function renderOnboarding(root, done) {
  const s = getState();
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card card pop">
        <h1 class="disp" style="font-size:26px">¡Bienvenido!</h1>
        <p class="tagline">Dos datos para empezar. Podrás cambiarlos luego.</p>
        <div class="field"><label class="label">¿Cómo te llamas?</label><input id="name" class="input" placeholder="Tu nombre"></div>
        <div class="field"><label class="label">Ingreso mensual estimado (COP)</label><input id="income" class="input" type="number" value="6000000"></div>
        <button id="go" class="btn btn-primary btn-block">Comenzar</button>
        <p class="tiny muted center mt-3">Vienes con 11 categorías COICOP listas (Moto y Tecnología incluidas). Puedes editarlas cuando quieras.</p>
      </div>
    </div>`;
  root.querySelector("#go").onclick = async () => {
    const profile = {
      name: root.querySelector("#name").value.trim() || "Usuario",
      income: +root.querySelector("#income").value || 6000000,
    };
    setState({ profile });
    await saveConfig(s.user.uid, { profile, cats: s.cats, budgets: s.budgets });
    done();
  };
}
