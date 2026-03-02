import { auth, db } from "../firebase/config";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export const registerUser = async (email, password, nombreNegocio) => {
  try {
    // 1️⃣ Crear usuario en Authentication
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );

    const user = userCredential.user;

    // 2️⃣ Crear documento del negocio en Firestore
    await setDoc(doc(db, "negocios", user.uid), {
      nombre: nombreNegocio,
      ownerId: user.uid,
      fechaCreacion: serverTimestamp(),
      activo: true,
    });

    return user;
  } catch (error) {
    console.error("Error en registro:", error.code, error.message);
    throw error;
  }
};
