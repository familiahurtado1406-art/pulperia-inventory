import { useState } from "react";
import { registerUser } from "../services/authService";

function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");

  const handleRegister = async (e) => {
    e.preventDefault();

    try {
      await registerUser(email, password, nombreNegocio);
      alert("Usuario y negocio creados correctamente");
    } catch (error) {
      console.error("ERROR:", error);
      alert(error.message);
    }
  };

  return (
    <div>
      <h2>Crear Cuenta</h2>
      <form onSubmit={handleRegister}>
        <input
          type="text"
          placeholder="Nombre del negocio"
          value={nombreNegocio}
          onChange={(e) => setNombreNegocio(e.target.value)}
          required
        />
        <br />
        <input
          type="email"
          placeholder="Correo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <br />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <br />
        <button type="submit">Registrarse</button>
      </form>
    </div>
  );
}

export default Register;
