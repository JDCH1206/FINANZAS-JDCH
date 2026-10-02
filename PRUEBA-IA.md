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
- **Ajustes → Reporte mensual (PDF) → ✨ Incluir análisis del mes con IA → Generar**: el PDF
  trae un resumen, hallazgos y recomendaciones redactados con IA a partir de tus cifras.
- **Movimientos → 🎤 Dictar o escribir**: toca 🎤 y habla (o escribe), *Interpretar* → revisa →
  *Guardar marcados*. El micrófono pide permiso la primera vez (en `localhost` funciona).
- **Movimientos → 📄 Importar extracto**: elige el PDF del banco o la tarjeta → revisa: las
  transferencias entre tus cuentas y los que ya tienes registrados salen **desmarcados**.
- **Tablero → Avanzado**: 📈 Proyección del mes y 🚨 Gastos inusuales (sin IA), ✨ Análisis del
  mes (elige el mes → *Analizar*) y ❓ Pregúntale a tus datos.
- Si un modelo no existe o agota su cupo, la app salta al siguiente (se ve en *Probar conexión*
  y en *Uso de hoy*). Las cadenas se cambian en Ajustes → IA → *Modelos*.

## 5. Para el celular (cuando pase a `main`)
App Check en la app publicada usa **Fraud Defense (antes reCAPTCHA Enterprise)**:
1. La clave de sitio (`6L…`) creada para el dominio `jdch1206.github.io` (sin ruta).
2. Firebase → App Check → Apps → tu app web → **Fraud Defense** → pegar la **clave de sitio** → Guardar.
3. En la app: Ajustes → IA → proveedor **Fraud Defense** → pegar la **clave de sitio** → Guardar.
(La clave secreta no se usa con Fraud Defense.)
