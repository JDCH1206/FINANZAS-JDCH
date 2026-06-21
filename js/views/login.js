// js/views/login.js
import { signIn, signUp, signInWithGoogle, isCloud } from "../firebase-service.js";
import { toast } from "../components/modals.js";

export function renderLogin(root, onAuthed) {
  let mode = "in"; // in | up
  function draw() {
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card pop">
          <div class="auth-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/></svg>
          </div>
          <h1 class="disp">Finanzas JDCH</h1>
          <p class="tagline">${mode === "in" ? "Entra a tu cuenta" : "Crea tu cuenta"} · ${isCloud() ? "nube activa ☁" : "modo local"}</p>
          <div class="field"><label class="label">Correo</label><input id="email" class="input" type="email" placeholder="tu@correo.com" autocomplete="email"></div>
          <div class="field"><label class="label">Contraseña</label><input id="pass" class="input" type="password" placeholder="••••••••" autocomplete="current-password"></div>
          <button id="go" class="btn btn-primary btn-block">${mode === "in" ? "Entrar" : "Registrarme"}</button>
          ${isCloud() ? `
          <div class="row gap-2 mt-3" style="align-items:center"><div style="flex:1;height:1px;background:var(--line)"></div><span class="tiny muted">o</span><div style="flex:1;height:1px;background:var(--line)"></div></div>
          <button id="google" class="btn btn-ghost btn-block mt-3" style="gap:9px">
            <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continuar con Google
          </button>` : ""}
          <p class="auth-switch">${mode === "in" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"} <b id="switch">${mode === "in" ? "Regístrate" : "Inicia sesión"}</b></p>
          ${!isCloud() ? `<p class="tiny muted center mt-3">Sin Firebase configurado: tus datos se guardan en este navegador. Pon tus claves en firebase-config.js para activar la nube.</p>` : ""}
        </div>
      </div>`;

    root.querySelector("#switch").onclick = () => { mode = mode === "in" ? "up" : "in"; draw(); };
    const gbtn = root.querySelector("#google");
    if (gbtn) gbtn.onclick = async () => {
      gbtn.disabled = true; gbtn.style.opacity = ".6";
      try { onAuthed(await signInWithGoogle()); }
      catch (e) { toast(e.code === "auth/popup-closed-by-user" ? "Ventana cerrada" : "No se pudo entrar con Google", true); gbtn.disabled = false; gbtn.style.opacity = "1"; }
    };
    root.querySelector("#go").onclick = async () => {
      const email = root.querySelector("#email").value.trim();
      const pass = root.querySelector("#pass").value;
      if (!email || !pass) return toast("Completa correo y contraseña", true);
      const btn = root.querySelector("#go"); btn.disabled = true; btn.textContent = "...";
      try {
        const user = mode === "in" ? await signIn(email, pass) : await signUp(email, pass);
        onAuthed(user);
      } catch (e) {
        toast(traduce(e.code || e.message), true);
        btn.disabled = false; btn.textContent = mode === "in" ? "Entrar" : "Registrarme";
      }
    };
  }
  draw();
}

function traduce(code) {
  const m = {
    "auth/invalid-email": "Correo inválido",
    "auth/user-not-found": "Usuario no encontrado",
    "auth/wrong-password": "Contraseña incorrecta",
    "auth/invalid-credential": "Credenciales incorrectas",
    "auth/email-already-in-use": "Ese correo ya está registrado",
    "auth/weak-password": "La contraseña debe tener 6+ caracteres",
  };
  return m[code] || "No se pudo completar. Revisa los datos.";
}
