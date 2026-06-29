# Finanzas JDCH — PWA

App de finanzas personales: clasificación COICOP, presupuesto editable por mes (valor o %), tableros con comparativo 50/30/20 y canasta DANE, edición de categorías/subcategorías, importación de Excel y nube con usuarios (Firebase). Incluye un **módulo opcional de Vehículos** (combustible, mantenimiento y obligaciones legales como SOAT/tecnomecánica).

## Novedades (changelog)

La app no usa versión numérica formal; la referencia técnica es la constante `CACHE` del service worker (`sw.js`), hoy **v40**. Cambios por fecha (más reciente primero):

### 2026-06-29 · caché v40 — Importar al módulo de Vehículos
- 📥 **Importar gastos de mantenimiento**: en la pantalla de Mantenimiento del vehículo, lista los gastos de moto/mantenimiento ya registrados y los enlaza a la bitácora. Revisable (checklist), adivina el tipo por la descripción y no borra ni duplica el gasto.
- 📥 **Importar pagos (impuesto/SOAT/RTM)**: crea obligaciones a partir de pagos históricos; estima el vencimiento a 1 año del pago y marca por defecto solo el más reciente de cada tipo.
- 🐛 **Fix nube**: el enlace gasto→mantenimiento (`maintId`) no se guardaba en Firestore y se perdía al recargar; ahora persiste (junto con `obligId`).

### 2026-06-28 · caché v38–v39 — Gasto ↔ Mantenimiento
- Asociar un gasto a mantenimiento del vehículo (ej. llantas): crea el registro en la bitácora enlazado al gasto; edición y borrado se sincronizan en ambos sentidos.
- Aviso en el módulo de mantenimiento para recordar registrar el costo como gasto en Movimientos.

### 2026-06-23 — Vehículos (obligaciones) + presupuesto automático
- **Fase 4 Vehículos**: obligaciones legales (SOAT/RTM/impuesto/licencia) con semáforo, umbral de aviso configurable, estado "en trámite" y panel global de próximos vencimientos.
- **Presupuesto automático**: reparte el ingreso mensual por 50/30/20 + peso DANE, ponderado por tu historial real (categorías poco usadas reciben poco) y ajustable.
- Odómetro del vehículo refleja el último tanqueo reportado; herramienta "odómetro real" que desfasa todos los tanqueos sin alterar rendimientos; odómetro visible en el encabezado de Combustible.
- Pulido PWA: barra "Instalar app", indicador sin conexión, guía de ayuda en Ajustes.
- QA: migración de categorías (renombrar/eliminar), aviso de error en escrituras, paginación "Ver más", gráficos según tema, banner+badge de recordatorios, validación de montos.
- "Asociar a vehículo" solo aparece en categorías de vehículo; total de gasto por vehículo.

### 2026-06-22 — Módulo Vehículos (base) + finanzas
- **Fase 1**: registro de vehículos (moto/carro), activable en Ajustes, menú "Más".
- **Fase 2**: bitácora de combustible (odómetro, rendimiento método B), KPIs (mes actual vs anterior vs prom. 12m), gráficos, importar Excel y exportar JSON/Excel.
- **Fase 3**: mantenimiento (Taller vs Rutina) con alarmas por km/fecha y próximos servicios.
- Gasto ↔ tanqueo enlazado (borrado/edición en ambos sentidos; el valor del combustible se edita solo en Movimientos).
- Metas de ahorro con progreso en Resumen + recordatorio de respaldo cada 30 días.
- Filtros en Movimientos, tema claro/oscuro, balance acumulado en el tiempo, alertas de sobregiro de presupuesto.
- Editar movimientos y tanqueos al seleccionarlos; fix de fecha "hoy" en hora local (Colombia, UTC-5); botón flotante (+) siempre visible.

### 2026-06-21 — Tablero y recomendaciones
- Tablero con KPIs: Balance, Ahorro (saldo en cuentas), Colchón (meses cubiertos), Indispensable/mes, Gasto recomendado/mes, proyección fin de mes, mayor gasto y gasto hormiga.
- Gráficos: tasa de ahorro 12m, categorías vs promedio, gasto por día de la semana.
- Recomendación 50/30/20 basada solo en salario (excluye primas).
- Auto-actualización del service worker.

### Versión inicial
- PWA de finanzas: clasificación COICOP, presupuesto editable, importación de Excel, nube con Firebase y login.

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
js/views/  login · onboarding · summary · home · dashboard · budget · accounts · categories · vehicles · settings
js/components/  charts · modals
icons/  icon-192 · icon-512
```

## Control de versiones y despliegue (GitHub + Firebase)
El proyecto incluye `firebase.json`, `.firebaserc` y `.github/workflows/deploy.yml` para:
- Validar el código en cada cambio.
- Publicar a producción automáticamente al fusionar en `main`.
- Generar URLs de vista previa en cada Pull Request.

Pasos detallados en `GIT_Y_DESPLIEGUE.md`. Resumen: `git init` → subir a GitHub → `firebase init hosting:github` → trabajar con ramas y PRs.
