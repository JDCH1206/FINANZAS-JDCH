// =====================================================================
//  firebase-config.js  —  PEGA AQUÍ TUS CREDENCIALES DE FIREBASE
// =====================================================================
//  Cómo obtenerlas (gratis, 5 minutos):
//   1. Entra a https://console.firebase.google.com  y crea un proyecto.
//   2. Menú "Compilación" → Authentication → Sign-in method →
//      habilita "Correo electrónico/contraseña".
//   3. Menú "Compilación" → Firestore Database → Crear base de datos
//      (modo producción). En "Reglas" pega lo que está al final de este archivo.
//   4. Configuración del proyecto (⚙) → "Tus apps" → ícono Web (</>) →
//      registra la app y copia el objeto firebaseConfig aquí abajo.
//
//  Mientras dejes los valores "TU_..." la app funciona en MODO LOCAL
//  (guarda en este navegador). Al pegar tus claves reales se activa la
//  nube con login y sincronización entre equipos.
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyB3tPusH6xvVR1QPmqwq95I7fNspdm0DsU",
  authDomain: "app-finanzas-e0d42.firebaseapp.com",
  projectId: "app-finanzas-e0d42",
  storageBucket: "app-finanzas-e0d42.firebasestorage.app",
  messagingSenderId: "706595770551",
  appId: "1:706595770551:web:78e824c251ddd7ea15bd32",
};

// ¿Están las credenciales realmente puestas?
export const FIREBASE_READY = !firebaseConfig.apiKey.startsWith("TU_");

/* =====================================================================
   REGLAS DE SEGURIDAD para Firestore (cópialas en la pestaña "Reglas"):

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ===================================================================== */
