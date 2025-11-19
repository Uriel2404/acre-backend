import express from "express";
import cors from "cors";
import mysql from "mysql2";
import dotenv from "dotenv";
// import bcrypt from "bcrypt";

dotenv.config();
const app = express();

//  Configuración de CORS
app.use(cors({
  origin: [
    "https://acre.mx",
    "https://www.acre.mx",
    "http://localhost:5173"
  ],
  methods: ["GET", "POST"],
}));
app.use(express.json());

//  Pool de MySQL
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

//  Ruta base de prueba
app.get("/", (req, res) => {
  res.send("API Funcionando ✅");
});

// Ruta de login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Faltan datos" });
  }

  const sql = "SELECT * FROM usuarios WHERE email = ?";

  db.query(sql, [email], async (err, result) => {
    if (err) {
      console.error("ERROR MYSQL:", err);
      return res.status(500).json({ message: "Error en el servidor" });
    }

    if (result.length === 0) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    const user = result[0];

    // ✅ Si tus contraseñas son planas (sin hash) usa esto:
    // if (password === user.password) { ... }

    // Si quieres usar hash (bcrypt):
    // const match = await bcrypt.compare(password, user.password);
    // if (!match) return res.status(401).json({ message: "Credenciales incorrectas" });

    // Por ahora dejamos sin hash para mantener compatibilidad
    if (password !== user.password) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    res.json({ message: "Login exitoso", user });
  });
});


//  Servidor en Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});



