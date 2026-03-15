import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBYuL4j_l-H12bPaWTY63x0UEXIY_aSVnY",
  authDomain: "pulperia-inventory.firebaseapp.com",
  projectId: "pulperia-inventory",
  storageBucket: "pulperia-inventory.firebasestorage.app",
  messagingSenderId: "887654148595",
  appId: "1:887654148595:web:b026085f3cff5d31750a86",
};

// Inicializar app
const app = initializeApp(firebaseConfig);

// Inicializar servicios
const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});
const auth = getAuth(app);

// Exportar para usar en toda la app
export { db, auth };
