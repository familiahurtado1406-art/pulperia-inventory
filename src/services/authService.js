import { auth, db } from "../firebase/config";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

export const registerUser = async (email, password, nombreNegocio) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await setDoc(
      doc(db, "users", user.uid),
      {
        nombre: nombreNegocio,
        email,
        ownerId: user.uid,
        fechaCreacion: serverTimestamp(),
        activo: true,
      },
      { merge: true }
    );

    return user;
  } catch (error) {
    console.error("Error en registro:", error.code, error.message);
    throw error;
  }
};
