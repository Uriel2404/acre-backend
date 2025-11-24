import express from "express";
import cors from "cors";
import mysql from "mysql2";
import dotenv from "dotenv";
import multer from "multer";
import ftp from "basic-ftp";
import fs from "fs";

dotenv.config();

// Multer (Render solo permite /tmp)
const upload = multer({
  dest: "/tmp",
  limits: { fileSize: 5 * 1024 * 1024 } // 5mb
});

const app = express();

// ======================
//  CORS
// ======================
app.use(cors({
  origin: [
    "https://acre.mx",
    "https://www.acre.mx",
    "http://localhost:5173"
  ],
  methods: ["GET", "POST"],
}));

app.use(express.json());

// ======================
//  MySQL Connection Pool
// ======================
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

// ======================
//  Middleware validar rol
// ======================
function validarRol(permisos = []) {
  return (req, res, next) => {
    const { rol } = req.body;
    if (!rol || !permisos.includes(rol)) {
      return res.status(403).json({ message: "No autorizado" });
    }
    next();
  };
}

// ======================
//  Ruta base
// ======================
app.get("/", (req, res) => {
  res.send("API Funcionando ✅");
});

// ======================
//  LOGIN
// ======================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Faltan datos" });

  const sql = "SELECT * FROM usuarios WHERE email = ?";

  db.query(sql, [email], async (err, result) => {
    if (err) {
      console.error("ERROR MYSQL:", err);
      return res.status(500).json({ message: "Error en el servidor" });
    }

    if (result.length === 0)
      return res.status(401).json({ message: "Credenciales incorrectas" });

    const user = result[0];

    if (password !== user.password) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    res.json({ message: "Login exitoso", user });
  });
});

// ===============================================================
//                    C A R R U S E L
// ===============================================================

// Obtener carrusel
app.get("/carrusel", (req, res) => {
  const sql = "SELECT * FROM carrusel ORDER BY orden ASC";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: "Error al obtener" });
    res.json(result);
  });
});

// Agregar imagen carrusel
app.post("/carrusel/add", (req, res) => {
  const { imagen_url, titulo, descripcion } = req.body;

  const sql =
    "INSERT INTO carrusel (imagen_url, titulo, descripcion) VALUES (?, ?, ?)";
  db.query(sql, [imagen_url, titulo, descripcion], (err, result) => {
    if (err) return res.status(500).json({ message: "Error al agregar" });
    res.json({ message: "Imagen agregada", id: result.insertId });
  });
});

// Eliminar imagen carrusel
app.post("/carrusel/delete", (req, res) => {
  const { id } = req.body;
  const sql = "DELETE FROM carrusel WHERE id = ?";
  db.query(sql, [id], (err) => {
    if (err) return res.status(500).json({ message: "Error al eliminar" });
    res.json({ message: "Imagen eliminada" });
  });
});

// Reordenar carrusel
app.post("/carrusel/reorder", (req, res) => {
  const { order } = req.body;

  const queries = order.map((item) =>
    db.promise().query("UPDATE carrusel SET orden = ? WHERE id = ?", [
      item.orden,
      item.id,
    ])
  );

  Promise.all(queries)
    .then(() => res.json({ message: "Orden actualizado" }))
    .catch(() => res.status(500).json({ message: "Error al reordenar" }));
});

// Subir imagen carrusel por FTP
app.post("/upload-carrusel", upload.single("imagen"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No se envió imagen" });

    const localPath = req.file.path;
    const fileName = Date.now() + "_" + req.file.originalname;

    const client = new ftp.Client();
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false
    });

    await client.ensureDir("/public_html/Intranet/carrusel");
    await client.uploadFrom(localPath, `/public_html/Intranet/carrusel/${fileName}`);
    client.close();

    const imageUrl = `https://acre.mx/Intranet/carrusel/${fileName}`;

    const sql = "INSERT INTO carrusel (imagen_url) VALUES (?)";
    db.query(sql, [imageUrl], (err, result) => {
      if (err) return res.status(500).json({ message: "Error guardando en MySQL" });

      res.json({
        message: "Imagen subida",
        id: result.insertId,
        url: imageUrl
      });
    });

    fs.unlinkSync(localPath);

  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    res.status(500).json({ message: "Error al subir imagen" });
  }
});

// ===============================================================
//                      N O T I C I A S
// ===============================================================

// Obtener noticias
app.get("/noticias", (req, res) => {
  const sql = "SELECT * FROM noticias ORDER BY seccion, orden ASC";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: "Error al obtener noticias" });
    res.json(result);
  });
});

// Agregar noticia
app.post(
  "/noticias/add",
  validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { seccion, titulo, descripcion, imagen_url, fecha } = req.body;

    // 🚫 NO convertir la fecha
    // ✔️ Guardarla tal cual llega
    const fechaFix = fecha || null;

    const sql =
      "INSERT INTO noticias (seccion, titulo, descripcion, imagen_url, fecha) VALUES (?, ?, ?, ?, ?)";

    db.query(
      sql,
      [seccion, titulo, descripcion, imagen_url, fechaFix],
      (err, result) => {
        if (err) {
          console.error("MYSQL ERROR:", err);
          return res.status(500).json({ message: "Error al agregar noticia" });
        }
        res.json({ message: "Noticia agregada", id: result.insertId });
      }
    );
  }
);

// Editar noticia
app.post("/noticias/edit",
  validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { id, seccion, titulo, descripcion, imagen_url, fecha } = req.body;

    // 🚫 NO convertir la fecha
    const fechaFix = fecha || null;

    const sql =
      "UPDATE noticias SET seccion = ?, titulo = ?, descripcion = ?, imagen_url = ?, fecha = ? WHERE id = ?";

    db.query(sql, [seccion, titulo, descripcion, imagen_url, fechaFix, id], (err) => {
      if (err) return res.status(500).json({ message: "Error al editar noticia" });
      res.json({ message: "Noticia actualizada" });
    });
  }
);

// Eliminar noticia
app.post("/noticias/delete",
  validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { id } = req.body;

    const sql = "DELETE FROM noticias WHERE id = ?";
    db.query(sql, [id], (err) => {
      if (err) return res.status(500).json({ message: "Error al eliminar noticia" });
      res.json({ message: "Noticia eliminada" });
    });
  }
);

// Reordenar noticias
app.post("/noticias/reorder",
  validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { order } = req.body;

    const updates = order.map((item) =>
      db.promise().query(
        "UPDATE noticias SET orden = ? WHERE id = ?",
        [item.orden, item.id]
      )
    );

    Promise.all(updates)
      .then(() => res.json({ message: "Orden actualizado" }))
      .catch(() => res.status(500).json({ message: "Error al reordenar" }));
  }
);

// Subir imagen noticia por FTP
app.post("/upload-noticia", upload.single("imagen"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No se envió imagen" });

    const localPath = req.file.path;
    const fileName = Date.now() + "_" + req.file.originalname;

    const client = new ftp.Client();
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false
    });

    await client.ensureDir("/public_html/Intranet/noticias");
    await client.uploadFrom(localPath, `/public_html/Intranet/noticias/${fileName}`);
    client.close();

    const imageUrl = `https://acre.mx/Intranet/noticias/${fileName}`;

    res.json({ message: "Imagen subida", url: imageUrl });

    fs.unlinkSync(localPath);

  } catch (error) {
    console.log("UPLOAD ERROR:", error);
    res.status(500).json({ message: "Error al subir imagen" });
  }
});

// ======================
//  Servidor en Render
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});



