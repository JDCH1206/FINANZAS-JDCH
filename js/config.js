// js/config.js — constantes de la aplicación

export const APP_NAME = "Finanzas JDCH";

// Taxonomía base (COICOP adaptada · Moto y Tecnología como categorías propias)
export const DEFAULT_CATS = [
  { id: "alimentacion", name: "Alimentación", type: "Necesidad", dane: 24.4, subs: ["Mercado", "Restaurantes", "Snacks y bebidas", "Otros alimentos"] },
  { id: "vivienda", name: "Vivienda y servicios", type: "Necesidad", dane: 33.1, subs: ["Arriendo", "Servicios públicos", "Mantenimiento hogar"] },
  { id: "transporte", name: "Transporte", type: "Necesidad", dane: 12.9, subs: ["Transporte público", "Parqueadero", "Apps de transporte", "Combustible"] },
  { id: "moto", name: "Moto", type: "Necesidad", dane: null, subs: ["Gasolina", "Mantenimiento/reparaciones", "Pólizas/SOAT", "Lavado", "Accesorios"] },
  { id: "salud", name: "Salud", type: "Necesidad", dane: 4.0, subs: ["Consultas y exámenes", "Medicamentos", "Lentes y óptica", "Cuidado adulto mayor", "Seguridad social"] },
  { id: "comunicacion", name: "Comunicación y digital", type: "Necesidad", dane: 3.7, subs: ["Celular", "Internet", "Suscripciones IA", "Streaming", "Otras suscripciones"] },
  { id: "recreacion", name: "Recreación y cultura", type: "Deseo", dane: 3.8, subs: ["Salidas y eventos", "Alojamientos", "Bebidas alcohólicas y tabaco", "Hobbies"] },
  { id: "tecnologia", name: "Tecnología", type: "Deseo", dane: null, subs: ["Computadores", "Celulares y tablets", "Consolas y gaming", "Accesorios y periféricos"] },
  { id: "educacion", name: "Educación", type: "Deuda", dane: 4.4, subs: ["ICETEX", "Estudios formales", "Cursos"] },
  { id: "cuidado", name: "Cuidado personal", type: "Deseo", dane: 5.2, subs: ["Ropa y calzado", "Aseo personal", "Peluquería"] },
  { id: "misc", name: "Misceláneos", type: "Deseo", dane: 7.0, subs: ["Regalos", "Ayudas familiares", "Impuestos", "Trámites", "Ajustes", "Sin clasificar"] },
];

// Regla 50/30/20 (Elizabeth Warren)
export const RULE_503020 = { Necesidad: 50, Deseo: 30, Deuda: 20 };

export const PALETTE = ["#d8a657", "#5a8fb0", "#7fbf7f", "#e07a5f", "#c98bb9", "#88b0a0",
  "#e9c46a", "#9a8cd0", "#6fa8c7", "#cf8e6d", "#a3b18a", "#d98da0"];

// Tipos de ingreso y su naturaleza (Fijo / Variable / Recuperable)
export const INCOME_TYPES = ["Salario", "Prima", "Liquidación/Cesantías", "Subsidio", "Rendimientos", "Préstamo recibido", "Otros ingresos"];

export function classifyIncome(desc) {
  const d = (desc || "").toLowerCase();
  if (d.includes("salario")) return "Salario";
  if (d.includes("prima")) return "Prima";
  if (d.includes("liquidac") || d.includes("cesant")) return "Liquidación/Cesantías";
  if (d.includes("subsidio")) return "Subsidio";
  if (d.includes("interes") || d.includes("cdt")) return "Rendimientos";
  if (d.includes("prestamo") || d.includes("préstamo")) return "Préstamo recibido";
  return "Otros ingresos";
}
export const INCOME_NATURE = {
  "Salario": "Fijo", "Prima": "Variable", "Liquidación/Cesantías": "Variable",
  "Subsidio": "Variable", "Rendimientos": "Variable", "Préstamo recibido": "Recuperable", "Otros ingresos": "Variable",
};

// Tipos de cuenta para el módulo de Ahorros/Cuentas
export const ACCOUNT_TYPES = ["Ahorro", "Corriente", "Efectivo", "Inversión", "Por cobrar"];

// Medios de pago base (el usuario puede agregar otros desde Ajustes)
export const DEFAULT_PAY_METHODS = ["Efectivo", "Transferencia", "Tarjeta débito", "Tarjeta crédito", "Otro"];

// ---------- Módulo de Vehículos ----------
export const VEHICLE_TYPES = ["Moto", "Carro"];
export const FUEL_TYPES = ["Corriente", "Extra", "Diésel", "Gas"];
export const SERVICE_TYPES = ["Particular", "Público"];
export const MAINT_CATEGORIES = ["Taller", "Rutina"];
export const MAINT_TIPOS = {
  Taller: ["Cambio de aceite", "Filtro de aceite", "Llantas", "Frenos (pastillas)", "Kit de arrastre", "Bujía", "Sincronización / válvulas", "Batería", "Reparación", "Otro"],
  Rutina: ["Lubricación de cadena", "Tensión de cadena", "Presión de llantas", "Nivel de aceite", "Luces", "Limpieza", "Otro"],
};
export const DEPARTAMENTOS = [
  "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar", "Boyacá",
  "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba", "Cundinamarca",
  "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño",
  "Norte de Santander", "Putumayo", "Quindío", "Risaralda", "San Andrés y Providencia",
  "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada",
];

// Reglas de clasificación automática para importar (descripción → [categoría, subcategoría])
export function classify(desc, origCat) {
  const d = (desc || "").toLowerCase();
  const has = (re) => re.test(d);
  if (origCat === "Moto" || has(/\bmoto\b|gasolina|lavada|poliza|póliza|soat|intercomunicador/))
    return ["Moto", has(/gasolina/) ? "Gasolina" : has(/poliza|póliza|soat/) ? "Pólizas/SOAT" : has(/lavad/) ? "Lavado" : "Mantenimiento/reparaciones"];
  if (origCat === "ICETEX" || has(/icetex/)) return ["Educación", "ICETEX"];
  if (origCat === "Maestría" || has(/maestr|matricula|matrícula|semestre/)) return ["Educación", "Estudios formales"];
  if (origCat === "Vivienda" || has(/arriendo/)) return ["Vivienda y servicios", "Arriendo"];
  if (has(/gemini|chatgpt|claude|copilot/)) return ["Comunicación y digital", "Suscripciones IA"];
  if (has(/netflix|spotify|youtube|crunchyroll|disney|streaming/)) return ["Comunicación y digital", "Streaming"];
  if (has(/claro|celular|recarga/)) return ["Comunicación y digital", "Celular"];
  if (has(/iphone|asus|xbox|consola|computador|portatil|portátil|tablet|ipad/)) return ["Tecnología", has(/xbox|consola|asus/) ? "Consolas y gaming" : "Celulares y tablets"];
  if (origCat === "Transporte" || has(/\bbus\b|pasaje|taxi|uber|peaje|transmilenio/)) return ["Transporte", has(/taxi|uber/) ? "Apps de transporte" : "Transporte público"];
  if (has(/parqueadero/)) return ["Transporte", "Parqueadero"];
  if (has(/lente|optica|óptica|gafas|limpisol/)) return ["Salud", "Lentes y óptica"];
  if (has(/medicament|dolex|droguer|farmacia|gripa|pastas|gotas/)) return ["Salud", "Medicamentos"];
  if (has(/cita|consulta|examen/)) return ["Salud", "Consultas y exámenes"];
  if (has(/seguridad social|eps/)) return ["Salud", "Seguridad social"];
  if (has(/corte de (cabello|pelo)|peluquer|barber/)) return ["Cuidado personal", "Peluquería"];
  if (has(/desodorante|shampoo|jabon|jabón|cepillo|cuchillas|crema/)) return ["Cuidado personal", "Aseo personal"];
  if (has(/adidas|nike|tenis|tennis|camiseta|camisa|ropa|zapato|buzo|boxer/)) return ["Cuidado personal", "Ropa y calzado"];
  if (has(/cerveza|polas|trago|aguardiente|licor|cigarr/)) return ["Recreación y cultura", "Bebidas alcohólicas y tabaco"];
  if (has(/alojamiento|hotel|habitación|habitacion|hospedaje/)) return ["Recreación y cultura", "Alojamientos"];
  if (origCat === "Recreación" || has(/cine|concierto|paseo|salida|entrada|viaje/)) return ["Recreación y cultura", "Salidas y eventos"];
  if (origCat === "Alimentación") {
    if (has(/mercado|d1|ara|exito|fruta|carne|verdura|huevos|leche/)) return ["Alimentación", "Mercado"];
    if (has(/almuerzo|cena|restaurante|domicilio|pizza|hamburg|lechona/)) return ["Alimentación", "Restaurantes"];
    if (has(/café|cafe|empanada|gaseosa|snack|postre|agua/)) return ["Alimentación", "Snacks y bebidas"];
    return ["Alimentación", "Otros alimentos"];
  }
  if (has(/regalo|cumple/)) return ["Misceláneos", "Regalos"];
  if (has(/prestamo|préstamo|ayuda|pago felipe|pago jenny/)) return ["Misceláneos", "Ayudas familiares"];
  if (has(/impuesto|predial|tecnomecanic/)) return ["Misceláneos", "Impuestos"];
  return ["Misceláneos", "Sin clasificar"];
}
