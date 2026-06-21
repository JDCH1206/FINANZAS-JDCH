# Finanzas JDCH — PWA

App de finanzas personales: clasificación COICOP, presupuesto editable por mes (valor o %), tableros con comparativo 50/30/20 y canasta DANE, edición de categorías/subcategorías, importación de Excel y nube con usuarios (Firebase).

## Probar ya (modo local)
1. Necesitas servir los archivos por HTTP (no abrir el index con doble clic).
   - Rápido: en la carpeta, ejecuta `python3 -m http.server 8000` y abre `http://localhost:8000`.
2. Regístrate con cualquier correo/contraseña: los datos se guardan en el navegador.

## Publicar como PWA instalable (gratis)
Opción más fácil — **Netlify Drop**:
1. Entra a https://app.netlify.com/drop
2. Arrastra la carpeta `app` completa.
3. Te da una URL https. Ábrela en el celular → menú → "Agregar a pantalla de inicio".

Alternativas gratis: GitHub Pages, Vercel, Cloudflare Pages.

## Activar la nube (multi-dispositivo + login real)
1. Crea un proyecto gratis en https://console.firebase.google.com
2. Authentication → habilita "Correo electrónico/contraseña".
3. Firestore Database → crea la base (modo producción) y pega las reglas que están al final de `firebase-config.js`.
4. Configuración del proyecto → app Web → copia el `firebaseConfig` dentro de `firebase-config.js`.
5. Vuelve a publicar. La app detecta las claves y activa la nube automáticamente.
   El mismo correo abre tus datos desde cualquier equipo.

## Importar tu Excel (gastos e ingresos)
Ajustes → Importar desde Excel → elige `FinanzasJDCH_estructura.xlsx`.
Lee la hoja "Gastos" (usa Cat_Nueva/Subcat_Nueva o clasifica sola) y la hoja "IngresosFechas" para los ingresos. También puedes cargar el archivo finanzas_datos.json en Ajustes → Restaurar respaldo.

## Estructura
```
index.html · firebase-config.js · manifest.json · sw.js
css/  tokens · base · components · pages
js/   config · state · utils · firebase-service · app
js/views/  login · onboarding · summary · home · dashboard · budget · accounts · categories · settings
js/components/  charts · modals
icons/  icon-192 · icon-512
```

## Control de versiones y despliegue (GitHub + Firebase)
El proyecto incluye `firebase.json`, `.firebaserc` y `.github/workflows/deploy.yml` para:
- Validar el código en cada cambio.
- Publicar a producción automáticamente al fusionar en `main`.
- Generar URLs de vista previa en cada Pull Request.

Pasos detallados en `GIT_Y_DESPLIEGUE.md`. Resumen: `git init` → subir a GitHub → `firebase init hosting:github` → trabajar con ramas y PRs.
