import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/config";

function Login() {
  const navigate = useNavigate();
  const [isRegistering, setIsRegistering] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) navigate("/dashboard", { replace: true });
    });
    return () => unsubscribe();
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage("");

    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        await updateProfile(userCredential.user, {
          displayName: nombre,
        });

        await setDoc(doc(db, "users", userCredential.user.uid), {
          nombre,
          email,
          createdAt: new Date(),
          rol: "admin",
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      navigate("/dashboard", { replace: true });
    } catch (error) {
      console.error("Error auth:", error);
      setErrorMessage("Error al autenticar. Verifica los datos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <img src="/logo.png" alt="Pulperia Inventory" className="login-logo" />
        <h2>Pulperia Inventory</h2>
        <p className="login-subtitle">{isRegistering ? "Crear cuenta" : "Iniciar sesion"}</p>

        <form onSubmit={handleSubmit}>
          {isRegistering && (
            <input
              type="text"
              placeholder="Nombre completo"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="login-input"
              required
            />
          )}

          <input
            type="email"
            placeholder="Correo electronico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="login-input"
            required
          />

          <input
            type="password"
            placeholder="Contrasena"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input"
            required
          />

          {errorMessage && <div className="login-error">{errorMessage}</div>}

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? <div className="spinner" /> : isRegistering ? "Registrarme" : "Entrar"}
          </button>
        </form>

        <div className="login-switch">
          {isRegistering ? (
            <>
              Ya tienes cuenta?
              <span onClick={() => setIsRegistering(false)}>Inicia sesion</span>
            </>
          ) : (
            <>
              No tienes cuenta?
              <span onClick={() => setIsRegistering(true)}>Registrate</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
