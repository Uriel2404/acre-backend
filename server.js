import express from "express";
import cors from "cors";
import mysql from "mysql2";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// ✅ Configuración de CORS
app.use(
  cors({
    origin: [
      "https://acre.mx",
      "https://www.acre.mx",
      "http://localhost:5173" // opcional, para pruebas locales
    ],
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

// ✅ Conexión a MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error("❌ Error al conectar con MySQL:", err);
  } else {
    console.log("✅ Conectado con MySQL");
  }
});

// ✅ Ruta base de prueba
app.get("/", (req, res) => {
  res.send("API Funcionando ✅");
});

// ✅ Ruta de login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Faltan datos" });
  }

  const sql = "SELECT * FROM usuarios WHERE email = ? AND password = ?";
  db.query(sql, [email, password], (err, result) => {
    if (err) return res.status(500).json({ message: "Error en el servidor" });

    if (result.length > 0) {
      res.json({ message: "Login exitoso", user: result[0] });
    } else {
      res.status(401).json({ message: "Credenciales incorrectas" });
    }
  });
});

// ✅ Render usa variables de entorno PORT automáticamente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
