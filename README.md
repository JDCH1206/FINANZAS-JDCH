# Finanzas JDCH — PWA

App de finanzas personales: clasificación COICOP, presupuesto editable por mes (valor o %), tableros con comparativo 50/30/20 y canasta DANE, edición de categorías/subcategorías, importación de Excel y nube con usuarios (Firebase). Incluye un **módulo opcional de Vehículos** (combustible, mantenimiento y obligaciones legales como SOAT/tecnomecánica).

## Novedades (changelog)

La app no usa versión numérica formal; la referencia técnica es la constante `CACHE` del service worker (`sw.js`), hoy **v45**. Cambios por fecha (más reciente primero):

### 2026-06-29 · caché v45 — Recordatorios (notificaciones) + arreglos
- 🔔 **Recordatorios**: en Ajustes puedes activar notificaciones de vencimientos (SOAT/tecnomecánica/impuesto) y mantenimientos próximos (por km o fecha). Se muestran al abrir la app, una vez al día, y quedan en la bandeja del celular. (El aviso con la app totalmente cerrada requeriría un servidor de push; pendiente.)
- 🐛 **Fix doble-envío** en Cuentas y Metas (doble toque ya no crea duplicados; Movimientos ya estaba protegido).
- 🐛 **Fix desfase de 1 día** en fechas importadas (Excel/JSON) por zona horaria (UTC vs Colombia).

### 2026-06-29 · caché v44 — Botón de confirmación correcto (fix)
- 🐛 Los diálogos de confirmación mostraban siempre **"Eliminar"** (rojo), incluso al **importar** o **calcular presupuesto**. Ahora el botón dice lo que corresponde: **Importar / Calcular / Cerrar sesión** (y solo es rojo "Eliminar" cuando de verdad se borra algo). Al importar muestra "Importando…" mientras procesa.

### 2026-06-29 · caché v43 — Importar gastos por JSON
- 📥 **Importar gastos/ingresos desde JSON** (Ajustes → Importar gastos): acepta un respaldo o un archivo con `txs`/`incomes` (ej. `finanzas_datos.json`). Reemplaza gastos e ingresos, sin tocar categorías, cuentas ni vehículos. Pide confirmación.
- 🔧 `bulkSetTx` ahora conserva `pay`, `acct` y los vínculos de vehículo al importar/restaurar (antes solo guardaba fecha/desc/monto/categoría/subcategoría).

### 2026-06-29 · caché v42 — Importar combustible por JSON y borrado seguro
- 📥 **Importar combustible desde JSON** (además de Excel): acepta el JSON exportado por la app o el archivo `gasolina_moto_para_app.json`.
- 🔗 **Borrado seguro en el módulo de Vehículos**: borrar un tanqueo, mantenimiento u obligación **ya no borra el gasto** en Movimientos; solo quita el registro del módulo y elimina el vínculo. Los avisos de confirmación lo explican.

### 2026-06-29 · caché v41 — Anti-duplicados y guardado más rápido
- 🐛 **Fix duplicados**: al guardar/importar, el botón se bloquea al primer toque (muestra "Guardando…/Importando…") para que un doble-toque o la espera de red no cree registros repetidos. Aplica a gastos, ingresos, tanqueos, mantenimientos, obligaciones y vehículos.
- ⚡ **Importación más rápida**: las importaciones de mantenimiento y obligaciones ahora escriben en lote (un solo envío) en vez de uno por uno.
- 🧹 **Quitar duplicados**: botón en Mantenimiento y Obligaciones que aparece si hay registros repetidos del mismo gasto; quita los sobrantes dejando uno, sin borrar ningún gasto de Movimientos.

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

## Tecnologías

- **JavaScript puro (vanilla) con ES modules** — sin framework, sin paso de compilación (build) ni bundler. Se sirve como archivos estáticos por HTTP.
- **PWA** — `manifest.json` (instalable) + `sw.js` (service worker, caché del shell, *network-first* con auto-actualización). La constante `CACHE` (`finanzas-jdch-vNN`) se sube en cada cambio para forzar la nueva versión.
- **Firebase** (cargado dinámicamente desde CDN cuando hay credenciales): **Authentication** (correo/contraseña + Google) y **Firestore** (datos en la nube, tiempo real con `onSnapshot`). Sin credenciales, la app cae a **modo local con `localStorage`**.
- **Chart.js** (global por CDN) para gráficos; **SheetJS/XLSX** (ESM por CDN, bajo demanda) para importar/exportar Excel.
- **CSS propio** en `css/` (tokens, base, components, pages) con tema claro/oscuro mediante variables CSS.
- Todo el dinero se maneja como **enteros COP**; fechas en **hora local** (Colombia, UTC-5).

## Arquitectura (núcleo — no son pantallas)

- **`firebase-service.js`** — La única costura entre la nube y el modo local. `FIREBASE_READY` decide en tiempo de ejecución. Expone la misma API a todas las vistas: `onAuth`, `signIn/signUp/signOut`, `loadData`, `subscribeData` (tiempo real), `saveConfig`, `addTx/deleteTx/bulkUpdateTx`, `addFuel/addMaint/addOblig`, etc. En modo local, las escrituras a la nube son no-ops y `persistXxxLocal` guarda en `localStorage`.
- **`state.js`** — Store global mínimo: `getState()`, `setState(patch)`, `subscribe(fn)`. Las vistas leen `getState()` y vuelven a dibujar su DOM en cada navegación (no hay virtual DOM ni binding reactivo).
- **`app.js`** — El "shell": barra de navegación inferior, `draw(route)` que conmuta entre vistas, botón flotante (+) en Movimientos, manejo de sesión (`startSession`/`stopSession`/`liveRefresh`), alertas de vehículo y recordatorio de respaldo.
- **`config.js`** — Constantes: `DEFAULT_CATS`, `RULE_503020`, `PALETTE`, `INCOME_TYPES`, `ACCOUNT_TYPES`, `DEFAULT_PAY_METHODS`, `VEHICLE_TYPES`, `FUEL_TYPES`, `OBLIG_TIPOS`, `MAINT_CATEGORIES`, `MAINT_TIPOS`, `DEPARTAMENTOS`…
- **`utils.js`** — Helpers: `fmt`/`fmtShort` (formato COP), `uid`, `todayISO`/`curMonth` (hora local), `escapeHtml`, `ym`, `monthLabel`, `sum`, `debounce`.
- **`components/charts.js`** — Envoltorio de Chart.js (`donut`, `lineTrend`, `lineNum`, `budgetBars`, `categoryBars`…); los colores se leen del tema (claro/oscuro) al crear el gráfico.
- **`components/modals.js`** — `openModal`/`closeModal`, `toast`, `confirmDialog`.

## Módulos (pantallas)

Cada módulo es una vista en `js/views/`. Formato: **para qué · cómo se usa · archivo y estado clave**.

- **Login** (`login.js`) — *Para qué:* entrar a la cuenta. *Cómo se usa:* correo/contraseña (o Google en modo nube); en modo local cualquier correo crea una sesión en el navegador. *Estado:* sin estado a nivel de módulo.
- **Onboarding** (`onboarding.js`) — *Para qué:* configuración inicial al primer ingreso (perfil e ingreso mensual). *Cómo se usa:* aparece solo si el usuario es nuevo; al terminar entra al Resumen.
- **Resumen** (`summary.js`) — *Para qué:* foto general de tus finanzas. *Cómo se usa:* muestra ingresos/gastos totales, tasa de ahorro, disponible en cuentas, reparto 50/30/20, top categorías, metas de ahorro y el recordatorio de respaldo. *Variables:* calcula `ahorroFlujo`, `tasa`, `disponible`, buckets `Necesidad/Deseo/Deuda`; lee `fz_last_backup` de `localStorage`.
- **Movimientos** (`home.js`) — *Para qué:* registrar y ver gastos e ingresos. *Cómo se usa:* botón flotante (+) para agregar; tocar una fila para editar; pestañas Gastos/Ingresos; buscador y filtros. Asociar un gasto a un vehículo (combustible / mantenimiento / otro) crea el registro enlazado en el módulo Vehículos. *Estado:* `tabKind`, `query`, `fMonth`/`fCat`/`fMin`/`fMax`, `limit` (paginación). *Funciones:* `openTxModal`, `openIncomeModal`.
- **Tablero** (`dashboard.js`) — *Para qué:* análisis con KPIs y gráficos. *Cómo se usa:* KPIs (Balance, Ahorro, Colchón, Indispensable/mes, Gasto recomendado, proyección…) y gráficos (tasa de ahorro 12m, categorías vs promedio, gasto por día). *Estado:* `period` (rango de tiempo).
- **Presupuesto** (`budget.js`) — *Para qué:* fijar y seguir el presupuesto mensual por categoría. *Cómo se usa:* eliges el mes y editas por valor o por % (50/30/20 + peso DANE como base automática). *Estado:* `mes`, `mode` (`valor`/`%`); guarda con `debounce`.
- **Cuentas** (`accounts.js`) — *Para qué:* saldos de tus cuentas (ahorro, efectivo, etc.). *Cómo se usa:* CRUD de cuentas con su saldo; alimenta el "disponible" del Resumen. *Estado:* guarda con `debounce`.
- **Categorías** (`categories.js`) — *Para qué:* gestionar categorías y subcategorías (y su tipo 50/30/20). *Cómo se usa:* crear/renombrar/eliminar; al renombrar o borrar, migra los gastos afectados (las categorías se guardan por nombre en cada gasto). *Estado:* `openId`; `migrateCatName` con `bulkUpdateTx`.
- **Vehículos** (`vehicles.js`) — *Para qué:* módulo opcional multi-vehículo. *Cómo se usa:* se activa en Ajustes y se abre desde el menú "Más". Contiene tres sub-módulos por vehículo:
  - **Combustible** — bitácora de tanqueos; calcula rendimiento (km/gal, método B: tanque lleno a tanque lleno). El odómetro del vehículo refleja el último tanqueo reportado.
  - **Mantenimiento** — bitácora Taller/Rutina con alarmas por km/fecha; botón **📥 Importar gastos de mantenimiento** trae gastos ya registrados.
  - **Obligaciones** — SOAT/RTM/impuesto/licencia con semáforo de vencimiento; botón **📥 Importar pagos** crea obligaciones desde pagos históricos.
  - *Estado:* `activeFuelVid`/`activeMaintVid`/`activeObligVid` (qué bitácora se ve) y cachés `allFuel`/`allMaint`/`allOblig` (se cargan bajo demanda, no en tiempo real).
- **Ajustes** (`settings.js`) — *Para qué:* configuración y datos. *Cómo se usa:* editar perfil, importar Excel, respaldar/restaurar (JSON), exportar, medios de pago, tema claro/oscuro, activar/desactivar Vehículos, guía de ayuda y cerrar sesión.

### Modelo de datos en Firestore (`users/{uid}`)
- **Doc del usuario** (config en campos): `profile, cats, budgets, accounts, payMethods, vehicles, vehiclesEnabled, goals`.
- **Subcolecciones** (crecen): `transactions`, `incomes`, `fuel`, `maintenance`, `obligations`. Los registros de fuel/maint/oblig llevan `vehicleId`; los gastos enlazados llevan `vehicleId` + `fuelId`/`maintId`/`obligId`.

## Control de versiones y despliegue (GitHub + Firebase)
El proyecto incluye `firebase.json`, `.firebaserc` y `.github/workflows/deploy.yml` para:
- Validar el código en cada cambio.
- Publicar a producción automáticamente al fusionar en `main`.
- Generar URLs de vista previa en cada Pull Request.

Pasos detallados en `GIT_Y_DESPLIEGUE.md`. Resumen: `git init` → subir a GitHub → `firebase init hosting:github` → trabajar con ramas y PRs.
