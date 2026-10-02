# Probar la IA en el PC (rama `ia-gemini`)

Esta rama **no se publica** en GitHub Pages (solo `main` se publica), así que la app del
celular no cambia mientras se prueba. Ojo: en el PC entras con **tu misma cuenta**, así que
los datos son los reales (lo que registres aparece también en el celular).

## 1. Activar la IA en Firebase (una sola vez)
1. Consola de Firebase → proyecto **app-finanzas-e0d42** → **AI Logic** → *Comenzar*.
2. Elegir **Gemini Developer API** ("Comienza sin costo"). **No** elegir *Agent Platform Gemini API* (exige facturación).
3. Continuar hasta terminar. Si pide plan Blaze o tarjeta → cancelar (opción equivocada).
4. Al final, AI Logic deja **App Check exigido** (obligatorio desde el 2-nov-2026).

## 2. Abrir la rama en el PC
1. En GitHub: rama **`ia-gemini`** → botón **Code → Download ZIP** → descomprimir.
2. Abrir una terminal en esa carpeta y ejecutar:
   `python -m http.server 8000`  (en Windows también puede ser `py -m http.server 8000`)
3. En **Chrome** abrir **http://localhost:8000** e iniciar sesión.

## 3. Registrar el token de depuración de App Check (solo para el PC)
1. En la app: **Ajustes → 🤖 Inteligencia artificial → Activar IA → Guardar → 🔌 Probar conexión**.
2. Abrir la consola del navegador (**F12 → Consola**) y copiar el valor de
   **"Firebase App Check debug token: xxxxxxxx-…"**.
3. Firebase → **App Check** → pestaña **Apps** → tu app web → menú ⋮ → **Administrar tokens de
   depuración** → agregar ese token.
4. Volver a **Probar conexión**: debe decir **"✅ Conectado. Respondió gemini-…"**.

> El token de depuración es privado: no lo publiques. Solo sirve para tu PC.

## 4. Probar las funciones
- **Movimientos → + → 🧾 Compra con varios productos → ✨ Leer recibo con IA**: tomar o cargar
  foto de un recibo → revisa productos, cantidades, valores y categorías → *Guardar compra*.
- **Vehículos → tu moto → Mantenimiento → 🧾 Registrar orden de trabajo → ✨ Leer factura del
  taller con IA**: foto de la factura → revisa las líneas → *Registrar orden*.
- Si un modelo no existe o agota su cupo, la app salta al siguiente (se ve en *Probar conexión*
  y en *Uso de hoy*). Las cadenas se cambian en Ajustes → IA → *Modelos*.

## 5. Para el celular (cuando pase a `main`)
App Check en la app publicada usa **reCAPTCHA v3**:
1. Crear una clave en https://www.google.com/recaptcha/admin (tipo **v3**) con el dominio de
   GitHub Pages (`jdch1206.github.io`).
2. Firebase → App Check → tu app web → **reCAPTCHA** → pegar la **clave secreta**.
3. En la app: Ajustes → IA → pegar la **clave de sitio** (la pública) → Guardar.
