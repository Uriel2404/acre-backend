import express from "express";
import cors from "cors";
import mysql from "mysql2";
import dotenv from "dotenv";
import multer from "multer";
import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import crypto from "crypto";


dotenv.config();

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
  methods: ["GET", "POST", "PUT", "OPTIONS"],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.listen(3000, () => {
  console.log("Servidor corriendo");
});

// Multer (Render solo permite /tmp)
const upload = multer({
  dest: "/tmp",
  limits: { fileSize: 5 * 1024 * 1024 } // 5mb
});

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
  queueLimit: 0,
  dateStrings: true
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

// ===============================================================
//     SISTEMA DE RENOVACIÓN AUTOMÁTICA DE VACACIONES
// ===============================================================

// Tabla de días según años laborados
const TABLA_VACACIONES = {
  1: 12,
  2: 14,
  3: 16,
  4: 18,
  5: 20,
  6: 22, 7: 22, 8: 22, 9: 22, 10: 22,
  11: 24, 12: 24, 13: 24, 14: 24, 15: 24,
  16: 26, 17: 26, 18: 26, 19: 26, 20: 26,
  21: 28, 22: 28, 23: 28, 24: 28, 25: 28,
  26: 30, 27: 30, 28: 30, 29: 30, 30: 30,
  31: 32, 32: 32, 33: 32, 34: 32, 35: 32
};

// Función para calcular años completos entre dos fechas
function calcularAnosLaborados(fechaIngreso) {
  const hoy = new Date();
  const ingreso = new Date(fechaIngreso);
  
  let anos = hoy.getFullYear() - ingreso.getFullYear();
  const mesActual = hoy.getMonth();
  const mesIngreso = ingreso.getMonth();
  
  // Ajustar si aún no ha cumplido años este año
  if (mesActual < mesIngreso || 
      (mesActual === mesIngreso && hoy.getDate() < ingreso.getDate())) {
    anos--;
  }
  
  return anos;
}

// Función para obtener días de vacaciones según años
function obtenerDiasVacaciones(anosLaborados) {
  if (anosLaborados < 1) return 0;
  if (anosLaborados <= 35) return TABLA_VACACIONES[anosLaborados];
  return 32; // Máximo para más de 35 años
}

// ======================
//  Ruta base
// ======================
app.get("/", (req, res) => {
  res.send("API Funcionando ✅");
});
// ======================
//  LOGIN CON EMPLEADO
// ======================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Faltan datos" });

  const sqlUser = "SELECT * FROM usuarios WHERE email = ?";
  const sqlEmpleado = "SELECT * FROM empleados WHERE correo = ?";

  db.query(sqlUser, [email], async (err, result) => {
    if (err) {
      console.error("ERROR MYSQL:", err);
      return res.status(500).json({ message: "Error en el servidor" });
    }

    if (result.length === 0)
      return res.status(401).json({ message: "Credenciales incorrectas" });

    const user = result[0];

    // Validación de password simple (igual que ya haces)
    if (password !== user.password) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    // AHORA BUSCAMOS SU REGISTRO DE EMPLEADO
    db.query(sqlEmpleado, [email], (err2, empleadoResult) => {
      if (err2) {
        console.error("ERROR MYSQL:", err2);
        return res.status(500).json({ message: "Error al obtener empleado" });
      }

      const empleado = empleadoResult.length > 0 ? empleadoResult[0] : null;

      return res.json({
        message: "Login exitoso",
        user,
        empleado,
      });
    });
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
  const sql = "SELECT * FROM noticias ORDER BY orden_seccion ASC, orden ASC";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: "Error al obtener noticias" });
    res.json(result);
  });
});
// Agregar noticia
app.post("/noticias/add", validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { seccion, titulo, descripcion, imagen_url, fecha } = req.body;
    const fechaFix = fecha || null;
    const sql = `
      INSERT INTO noticias (seccion, titulo, descripcion, imagen_url, fecha)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(sql, [seccion, titulo, descripcion, imagen_url, fechaFix], (err, result) => {
      if (err) {
        console.error("MYSQL ERROR:", err);
        return res.status(500).json({ message: "Error al agregar noticia" });
      }
      const noticiaId = result.insertId;
      // Ahora insertar en el calendario
      const calendarQuery = `
        INSERT INTO calendario (noticia_id, title, fecha, imagen)
        VALUES (?, ?, ?, ?)
      `;
      db.query(calendarQuery, [noticiaId, titulo, fechaFix, imagen_url], (err2) => {
        if (err2) {
          console.error("CALENDAR ERROR:", err2);
          return res.status(500).json({ message: "Noticia guardada, pero fallo calendario" });
        }
        // ✔ SOLO AQUÍ enviamos respuesta
        return res.json({
          message: "Noticia agregada y calendario actualizado",
          id: noticiaId
        });
      });
    });
  }
);

// Editar noticia
app.post("/noticias/edit",
  validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { id, seccion, titulo, descripcion, imagen_url, fecha } = req.body;
    // NO convertir la fecha
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
// Reordenar Secciones de Noticias
app.post("/noticias/reorder-secciones",
  validarRol(["Administrador", "RH"]),
  (req, res) => {
    const { sections } = req.body;
    // sections = [ { seccion: "A", orden_seccion: 0 }, ... ]
    const queries = sections.map(s => 
      db.promise().query(
        "UPDATE noticias SET orden_seccion = ? WHERE seccion = ?",
        [s.orden_seccion, s.seccion]
      )
    );
    Promise.all(queries)
      .then(() => res.json({ message: "Orden de secciones actualizado" }))
      .catch(err => {
        console.error(err);
        res.status(500).json({ message: "Error al actualizar secciones" });
      });
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


// ===============================================================
//                    D O C U M E N T O S
// ===============================================================
// ===============================
// CONFIGURACIÓN MULTER DOCUMENTOS
// ===============================
const uploadDocuments = multer({
  dest: "/tmp",
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
  }
});

// ======================================
//  APARTADO PARA LA SUBIDA DE DOCUMENTOS
// ======================================  

app.post(
  "/documents/upload",
  uploadDocuments.single("file"),        // ← USA MULTER CON LÍMITE
  validarRol(["Administrador", "RH"]),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No se envió archivo" });
      const { category, department, name } = req.body;
      const localPath = req.file.path;
      const timestamp = Date.now();
      const sanitized = req.file.originalname.replace(/\s+/g, "_");
      const remoteFilename = `${timestamp}_${sanitized}`;
      const safeCategory = (category || "otros").replace(/\s+/g, "_");
      const safeDept = (department || "general").replace(/\s+/g, "_");
      const remoteDir = `/public_html/Intranet/documents/${safeCategory}/${safeDept}`;
      const client = new ftp.Client();
      await client.access({
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASS,
        secure: false
      });
      await client.ensureDir(remoteDir);
      await client.uploadFrom(localPath, `${remoteDir}/${remoteFilename}`);
      client.close();
      const url = `https://acre.mx/Intranet/documents/${safeCategory}/${safeDept}/${remoteFilename}`;
      const sql = `INSERT INTO documents 
        (name, filename, category, department, url, mime, size, uploaded_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      const params = [
        name || req.file.originalname,
        remoteFilename,
        category || "Otros",
        department || "General",
        url,
        req.file.mimetype,
        req.file.size,
        req.body.uploaded_by || null
      ];
      db.query(sql, params, (err, result) => {
        fs.unlinkSync(localPath);
        if (err) {
          console.error(err);
          return res.status(500).json({ message: "Error guardando en BD" });
        }
        res.json({ message: "Archivo subido", id: result.insertId, url });
      });
    } catch (err) {
      console.error("UPLOAD DOCUMENT ERROR:", err);
      res.status(500).json({ message: "Error al subir documento" });
    }
  }
);
// RUTA: eliminar documento (body: id, rol). validarRol(["Administrador","RH"])
app.post("/documents/delete", validarRol(["Administrador","RH"]), async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ message: "Falta id" });
    // obtener registro
    db.query("SELECT * FROM documents WHERE id = ?", [id], async (err, rows) => {
      if (err) { console.error(err); return res.status(500).json({ message: "Error" }); }
      if (!rows.length) return res.status(404).json({ message: "No encontrado" });
      const doc = rows[0];
      // borrar archivo por FTP
      const client = new ftp.Client();
      await client.access({
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASS,
        secure: false
      });
      // construye remote path desde la url o filename
      // supongamos /public_html/Intranet/documents/{category}/{department}/{filename}
      const safeCategory = (doc.category || "otros").replace(/\s+/g, "_");
      const safeDept = (doc.department || "general").replace(/\s+/g, "_");
      const remotePath = `/public_html/Intranet/documents/${safeCategory}/${safeDept}/${doc.filename}`;
      try {
        await client.remove(remotePath);
      } catch (e) {
        // no abortamos si no se pudo borrar el archivo (sigue borrando BD)
        console.warn("No se pudo borrar remoto:", e.message);
      }
      client.close();
      db.query("DELETE FROM documents WHERE id = ?", [id], (err2) => {
        if (err2) { console.error(err2); return res.status(500).json({ message: "Error borrando BD" }); }
        res.json({ message: "Documento eliminado" });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error" });
  }
});
// RUTA: editar metadata (renombrar, mover depto/categoria) - validarRol
app.post("/documents/edit", validarRol(["Administrador","RH"]), (req, res) => {
  const { id, name, category, department } = req.body;
  if (!id) return res.status(400).json({ message: "Falta id" });
  // Si category/department cambian deberíamos mover archivo en FTP (opcional).
  // Aquí asumimos solo actualizamos metadata y dejamos archivo donde está.
  db.query("UPDATE documents SET name = ?, category = ?, department = ?, updated_at = NOW() WHERE id = ?", [name, category, department, id], (err) => {
    if (err) { console.error(err); return res.status(500).json({ message: "Error actualizando" }); }
    res.json({ message: "Documento actualizado" });
  });
});
// ==========================================
// OBTENER DOCUMENTOS (con filtros opcionales)
// ==========================================
app.get("/documents", (req, res) => {
  const { category, department, q } = req.query;
  let sql = "SELECT * FROM documents WHERE 1=1";
  let params = [];
  if (category && category !== "Todos") {
    sql += " AND category = ?";
    params.push(category);
  }
  if (department && department !== "Todos") {
    sql += " AND department = ?";
    params.push(department);
  }
  if (q) {
    sql += " AND name LIKE ?";
    params.push(`%${q}%`);
  }
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("ERROR GET /documents:", err);
      return res.status(500).json({ message: "Error al obtener documentos" });
    }
    res.json(rows);
  });
});



// ===============================================================
//                    E M P L E A D O S
// ===============================================================

const uploadEmpleado = multer({
  dest: "/tmp",
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// =================
// CREAR EMPLEADO
// =================
app.post("/empleados", uploadEmpleado.single("foto"), async (req, res) => {
    try {
        const { nombre, puesto, correo, telefono, departamento, fecha_ingreso } = req.body;
        if (!nombre || !puesto) {
            return res.status(400).json({ error: "Nombre y puesto son obligatorios" });
        }

        const fotoNueva = req.file
            ? `https://acre.mx/Intranet/empleados/${req.file.filename}`
            : null;

        await db.promise().query(
            "INSERT INTO empleados (nombre, puesto, correo, telefono, departamento, fecha_ingreso, foto) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [nombre, puesto, correo, telefono, departamento, fecha_ingreso, fotoNueva]
        );

        res.json({ success: true });

    } catch (err) {
        console.error("Error al crear empleado:", err);
        res.status(500).json({ error: "Error al crear empleado" });
    }
});

// =====================================
// LISTAR EMPLEADOS
// =====================================
app.get("/empleados", async (req, res) => {
  try {
    const [rows] = await db.promise().query("SELECT * FROM empleados ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("ERROR LISTAR EMPLEADOS:", err);
    res.status(500).json({ error: "Error al obtener empleados" });
  }
});

// =====================================
// EDITAR EMPLEADO
// =====================================
app.post("/empleados/:id", uploadEmpleado.single("foto"), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, puesto, correo, telefono, departamento, fecha_ingreso, foto_actual } = req.body;
    let fotoUrl = foto_actual || null;
    // Si sube nueva foto → subir al FTP
    if (req.file) {
      const localPath = req.file.path;
      const fileName = Date.now() + "_" + req.file.originalname;
      const client = new ftp.Client();
      await client.access({
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASS,
        secure: false
      });
      await client.ensureDir("/public_html/Intranet/empleados");
      await client.uploadFrom(localPath, `/public_html/Intranet/empleados/${fileName}`);
      client.close();
      fotoUrl = `https://acre.mx/Intranet/empleados/${fileName}`;
      fs.unlinkSync(localPath);
    }
    // Actualizar DB
    await db.promise().query(
      `UPDATE empleados 
       SET nombre=?, puesto=?, correo=?, telefono=?, departamento=?, fecha_ingreso=?, foto=?
       WHERE id=?`,
      [nombre, puesto, correo, telefono, departamento, fecha_ingreso, fotoUrl, id]
    );
    res.json({ success: true, message: "Empleado actualizado correctamente", foto: fotoUrl });
  } catch (err) {
    console.error("ERROR EDITAR EMPLEADO:", err);
    res.status(500).json({ error: "Error al editar empleado" });
  }
});

// ========================
// ELIMINAR EMPLEADO
// ========================
app.post("/empleados/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener registro
    const [rows] = await db.promise().query("SELECT foto FROM empleados WHERE id=?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Empleado no encontrado" });
    const fotoUrl = rows[0].foto;
    // Borrar foto por FTP
    if (fotoUrl) {
      try {
        const filename = fotoUrl.split("/empleados/")[1];
        const remotePath = `/public_html/Intranet/empleados/${filename}`;
        const client = new ftp.Client();
        await client.access({
          host: process.env.FTP_HOST,
          user: process.env.FTP_USER,
          password: process.env.FTP_PASS,
          secure: false
        });
        await client.remove(remotePath);
        client.close();
      } catch (e) {
        console.warn("No se pudo borrar la foto del FTP:", e.message);
      }
    }
    // Borrar BD
    await db.promise().query("DELETE FROM empleados WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("ERROR ELIMINAR EMPLEADO:", err);
    res.status(500).json({ error: "Error al eliminar empleado" });
  }
});


// ===============================================================
//                    O R G A N I G R A M A S
// ===============================================================

const uploadOrganigrama = multer({ dest: "/tmp" }); // Guardamos temporalmente en /tmp

// ==============================
// SUBIR O REEMPLAZAR ORGANIGRAMA
// ==============================
app.post("/organigramas/upload", uploadOrganigrama.single("archivo"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No se envió archivo" });
        const departamento = req.body.departamento || "General";
        const localPath = req.file.path;
        const fileName = Date.now() + path.extname(req.file.originalname);
        // Conectar a FTP
        const client = new ftp.Client();
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });
        await client.ensureDir("/public_html/Intranet/organigramas");
        await client.uploadFrom(localPath, `/public_html/Intranet/organigramas/${fileName}`);
        client.close();
        const archivoUrl = `https://acre.mx/Intranet/organigramas/${fileName}`;
        // Guardar en MySQL
        await db.promise().query(
            `INSERT INTO organigramas (departamento, archivo)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE archivo = VALUES(archivo)`,
            [departamento, archivoUrl]
        );
        fs.unlinkSync(localPath); // borrar temporal
        res.json({ success: true, url: archivoUrl });
    } catch (err) {
        console.error("ERROR SUBIR ORGANIGRAMA:", err);
        res.status(500).json({ error: "Error al subir organigrama" });
    }
});

// ============================
// VER LISTADO DE ORGANIGRAMAS
// ============================
app.get("/organigramas", async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT * FROM organigramas");
        res.json(rows);
    } catch (err) {
        console.error("ERROR LISTANDO ORGANIGRAMAS:", err);
        res.status(500).json({ error: "Error al obtener organigramas" });
    }
});
// ===============================
// ELIMINAR ORGANIGRAMAS
// ==============================
app.delete("/organigramas/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // Buscar archivo
        const [rows] = await db.promise().query(
            "SELECT archivo FROM organigramas WHERE id = ?",
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: "Organigrama no encontrado" });
        }
        const archivoUrl = rows[0].archivo;
        const fileName = archivoUrl.split("/").pop();
        // Borrar del FTP
        const client = new ftp.Client();
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });
        await client.remove(`/public_html/Intranet/organigramas/${fileName}`);
        client.close();
        // Borrar de BD
        await db.promise().query("DELETE FROM organigramas WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (err) {
        console.error("ERROR ELIMINANDO ORGANIGRAMA:", err);
        res.status(500).json({ error: "Error eliminando organigrama" });
    }
});

// ===============================
//      C A L E N D A R I O
// ===============================
app.get("/calendar/events", (req, res) => {
  const sql = `
    SELECT 
      id,
      titulo AS title,
      fecha,
      imagen_url AS imagen
    FROM noticias
    WHERE fecha IS NOT NULL
    ORDER BY fecha ASC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("ERROR AL OBTENER EVENTOS:", err);
      return res.status(500).json({ message: "Error obteniendo eventos" });
    }

    res.json(rows);
  });
});


// -----------------------------------------------------
// SERVIDOR
// -----------------------------------------------------
app.listen(3001, () => {
  console.log("Servidor corriendo en http://localhost:3001");
});


// ============================================
// OBTENER USUARIO CUANDO INGRESA A LA INTRANET
// ============================================
app.get("/empleadoByEmail/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const [rows] = await db.promise().query(
      "SELECT * FROM empleados WHERE correo = ?",
      [email]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("ERROR OBTENER EMPLEADO POR EMAIL:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});



// ===============================================================
//                 D E S A R R O L L O S   A C T I V O S
// ===============================================================

// Obtener desarrollos
app.get("/desarrollos", (req, res) => {
  const sql = "SELECT * FROM desarrollos ORDER BY id DESC";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: "Error al obtener desarrollos" });
    res.json(result);
  });
});

// Agregar desarrollo (solo Admin o RH)
app.post("/desarrollos/add", (req, res) => {
    const { imagen_url } = req.body;
    if (!imagen_url)
      return res.status(400).json({ message: "URL de imagen requerida" });
    const sql = `INSERT INTO desarrollos (imagen_url) VALUES (?)`;
    db.query(sql, [imagen_url], (err) => {
      if (err) return res.status(500).json({ message: "Error al agregar desarrollo" });
      res.json({ message: "Imagen agregada exitosamente" });
    });
  }
);

// Eliminar desarrollo
app.post("/desarrollos/delete",
  (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ message: "ID requerido" });
    const sql = "DELETE FROM desarrollos WHERE id = ?";
    db.query(sql, [id], (err) => {
      if (err) return res.status(500).json({ message: "Error al eliminar desarrollo" });
      res.json({ message: "Imagen eliminada" });
    });
  }
);

// Subir imagen de desarrollo por FTP
app.post("/upload-desarrollo", upload.single("imagen"), async (req, res) => {
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

    await client.ensureDir("/public_html/Intranet/desarrollos");
    await client.uploadFrom(localPath, `/public_html/Intranet/desarrollos/${fileName}`);
    client.close();

    const imageUrl = `https://acre.mx/Intranet/desarrollos/${fileName}`;

    // Limpia archivo temporal
    fs.unlinkSync(localPath);

    res.json({ message: "Imagen subida", url: imageUrl });

  } catch (error) {
    console.log("UPLOAD ERROR:", error);
    res.status(500).json({ message: "Error al subir imagen" });
  }
});


// ===============================================================
//                S O L I C I T U D E S   D E   V A C A C I O N E S
// ===============================================================

//=================
// PEDIR VACACIONES
//=================
  app.post("/vacaciones", async (req, res) => {
    const { empleado_id, fecha_inicio, fecha_fin, motivo } = req.body;

    try {
      const [empRows] = await db.promise().query(
        "SELECT nombre, dias_vacaciones, dias_vacaciones_anteriores, fecha_expiracion_anteriores, jefe_id FROM empleados WHERE id = ?",
        [empleado_id]
      );

      if (!empRows.length) {
        return res.status(404).json({ error: "Empleado no encontrado" });
      }

      const empleado = empRows[0];
      const jefe_id = empleado.jefe_id;

      if (!jefe_id) {
        return res.status(400).json({
          error: true,
          message: "No tienes un jefe directo asignado. Contacta a RH."
        });
      }

      // Calcular días disponibles totales
      const hoy = new Date();
      let diasAnterioresDisponibles = 0;

      if (empleado.dias_vacaciones_anteriores > 0 && empleado.fecha_expiracion_anteriores) {
        const fechaExp = new Date(empleado.fecha_expiracion_anteriores);
        if (hoy <= fechaExp) {
          diasAnterioresDisponibles = empleado.dias_vacaciones_anteriores;
        }
      }

      const diasActuales = empleado.dias_vacaciones || 0;
      const diasTotalesDisponibles = diasActuales + diasAnterioresDisponibles;
      

      const inicio = new Date(fecha_inicio);
      const fin = new Date(fecha_fin);
      const diasSolicitados = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;

      if (diasSolicitados > diasTotalesDisponibles) {
      return res.status(400).json({
        error: true,
        message: `No puedes solicitar ${diasSolicitados} días. Disponibles: ${diasTotalesDisponibles} (${diasActuales} actuales + ${diasAnterioresDisponibles} del año anterior)`
      });
    }

      const tokenJefe = crypto.randomBytes(32).toString("hex");
      const expira = new Date(Date.now() + 1000 * 60 * 60 * 48);

      const [result] = await db.promise().query(
        `
        INSERT INTO vacaciones
        (empleado_id, jefe_id, fecha_inicio, fecha_fin, motivo, estado, aprobado_jefe, aprobado_rh, token_jefe, token_jefe_expira)
        VALUES (?, ?, ?, ?, ?, 'Pendiente', 0, 0, ?, ?)
        `,
        [empleado_id, jefe_id, fecha_inicio, fecha_fin, motivo, tokenJefe, expira]
      );
    // ==============================================
    // ENVIAR CORREO AL JEFE PARA APROBAR O RECHAZAR
    // ==============================================

    // Obtener datos del jefe
    const [jefeRows] = await db.promise().query(
      "SELECT nombre, correo FROM empleados WHERE id = ?",
      [jefe_id]
    );

    const jefe = jefeRows[0];

    const linkAprobar = `https://acre-backend.onrender.com/vacaciones/jefe/aprobar?token=${tokenJefe}`;
    const linkRechazar = `https://acre-backend.onrender.com/vacaciones/jefe/rechazar?token=${tokenJefe}`;

    const mensajeJefe = `
    <!DOCTYPE html>
    <html lang="es">
    <body style="font-family:Arial; background:#f3f4f6; padding:30px;">
      <table width="600" align="center" style="background:#ffffff; border-radius:8px;">
        <tr>
          <td style="background:#0f5132; color:#ffffff; padding:20px; text-align:center;">
            <h2>Nueva solicitud de vacaciones</h2>
          </td>
        </tr>

        <tr>
          <td style="padding:20px; color:#333;">
            <p>Hola <strong>${jefe.nombre}</strong>,</p>
            <p>${empleado.nombre} ha solicitado vacaciones.</p>

            <p><strong>Fechas:</strong> ${fecha_inicio} al ${fecha_fin}</p>

            <div style="margin-top:25px; text-align:center;">
              <a href="${linkAprobar}"
                style="background:#198754; color:#fff; padding:12px 20px;
                      text-decoration:none; border-radius:6px; margin-right:10px;">
                ✅ Aprobar
              </a>

              <a href="${linkRechazar}"
                style="background:#dc3545; color:#fff; padding:12px 20px;
                      text-decoration:none; border-radius:6px;">
                ❌ Rechazar
              </a>
            </div>

            <p style="margin-top:30px; font-size:12px; color:#777;">
              Este enlace es personal y expira en 48 horas.
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

      try {
      const responseJefe = await fetch("https://acre.mx/api/send-mail.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.MAIL_API_KEY
        },
        body: JSON.stringify({
          to: jefe.correo, 
          subject: "Solicitud de vacaciones por aprobar",
          message: mensajeJefe
        })
      });

      

      const textJefe = await responseJefe.text();
      console.log("📨 Correo enviado al jefe:", jefe.correo);

    } catch (err) {
      console.error("❌ Error enviando correo al jefe:", err);
    }

    // =====================================
    // ENVIAR CORREO A RH (NUEVA SOLICITUD)
    // ====================================

    try {
      const subjectRH = "Nueva solicitud de vacaciones";
      const messageRH = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Nueva Solicitud de Vacaciones</title>
      </head>

      <body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">

        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:30px 0;">
          <tr>
            <td align="center">

              <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">

                <!-- HEADER -->
                <tr>
                  <td style="background-color:#127726; padding:20px; text-align:center;">
                    <h1 style="margin:0; color:#ffffff; font-size:22px;">
                      📩 Nueva Solicitud de Vacaciones
                    </h1>
                  </td>
                </tr>

                <!-- CONTENT -->
                <tr>
                  <td style="padding:25px; color:#333333; font-size:14px; line-height:1.6;">

                    <p><strong>Empleado:</strong> ${empleado.nombre}</p>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:15px 0;">

                    <p><strong>Fechas:</strong> ${fecha_inicio} al ${fecha_fin}</p>
                    <p><strong>Días solicitados:</strong> ${diasSolicitados}</p>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:15px 0;">

                    <p><strong>Estado:</strong></p>

                    <span style="
                      display:inline-block;
                      padding:6px 14px;
                      background-color:#fef3c7;
                      color:#92400e;
                      border-radius:20px;
                      font-size:12px;
                      font-weight:bold;
                    ">
                      PENDIENTE
                    </span>

                    <p style="margin-top:15px;"><strong>Motivo:</strong><br>
                      ${motivo || "No especificado"}
                    </p>

                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td style="background-color:#f9fafb; padding:15px; text-align:center; font-size:12px; color:#6b7280;">
                    Mensaje automático generado por la Intranet ACRE<br>
                    No responder este correo
                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>

      </body>
      </html>
      `;

      const response = await fetch("https://acre.mx/api/send-mail.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.MAIL_API_KEY
        },
        body: JSON.stringify({
          to: "uriel.ruiz@acre.mx", // CAMBIAR POR CORREO RH CUANDO YA ESTÉ FUNCIONANDO AL 100%
          subject: subjectRH,
          message: messageRH
        })
      });

      const text = await response.text();

    } catch (err) {
      console.error("❌ Error enviando correo RH:", err);
    }

    return res.json({
      ok: true,
      message: "Solicitud enviada correctamente",
      id: result.insertId,
      diasSolicitados,
      diasDisponibles: diasTotalesDisponibles
    });

  } catch (err) {
    console.error("Error al insertar solicitud:", err);
    return res.status(500).json({ error: "Error al enviar la solicitud" });
  }
});


  // =============================================
  // APROBAR VACACIONES POR TOKEN (JEFE)
  // ============================================
  app.get("/vacaciones/jefe/aprobar", async (req, res) => {
    const { token } = req.query;
    
    console.log("🔑 Token recibido:", token);

    if (!token) {
      return res.status(400).send("Token inválido");
    }

    try {
      // Buscar solicitud
      console.log("🔍 Buscando solicitud con token...");

      const [rows] = await db.promise().query(
        `
        SELECT id, token_jefe_expira, aprobado_jefe
        FROM vacaciones
        WHERE token_jefe = ?
        `,
        [token]
      );
      
      console.log("📄 Resultado BD:", rows);

      if (!rows.length) {
        return res.status(404).send("Solicitud no encontrada");
      }

      const solicitud = rows[0];

      // Token expirado
      if (new Date(solicitud.token_jefe_expira) < new Date()) {
        return res.status(410).send("⏰ Este enlace ya expiró");
      }

      // Ya aprobada
      if (solicitud.aprobado_jefe === 1) {
        return res.send("✅ Esta solicitud ya fue aprobada");
      }

      // Aprobar
      console.log("🟢 Aprobando solicitud ID:", solicitud.id);
      await db.promise().query(
        `
        UPDATE vacaciones
        SET aprobado_jefe = 1,
            estado = 'Pendiente RH'
        WHERE id = ?
        `,
        [solicitud.id]
      );


      return res.send(`
        <html>
          <body style="font-family:Arial; background:#f3f4f6; padding:40px; text-align:center;">
            <h2 style="color:#198754;">✅ Vacaciones aprobadas</h2>
            <p>Gracias. La solicitud fue aprobada correctamente.</p>
          </body>
        </html>
      `);

    } catch (err) {
      console.error(err);
      return res.status(500).send("Error al aprobar solicitud");
    }
  });


  // =======================================
  // RECHAZAR VACACIONES POR TOKEN (JEFE)
  // =======================================

  app.get("/vacaciones/jefe/rechazar", async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send("Token inválido");
    }

    try {
      const [rows] = await db.promise().query(
        `
        SELECT id, token_jefe_expira
        FROM vacaciones
        WHERE token_jefe = ?
        `,
        [token]
      );

      if (!rows.length) {
        return res.status(404).send("Solicitud no encontrada");
      }

      const solicitud = rows[0];

      if (new Date(solicitud.token_jefe_expira) < new Date()) {
        return res.status(410).send("⏰ Este enlace ya expiró");
      }

      await db.promise().query(
        `
        UPDATE vacaciones
        SET aprobado_jefe = 0,
          estado = 'Rechazada'
        WHERE id = ?
        `,
        [solicitud.id]
      );


      return res.send(`
        <html>
          <body style="font-family:Arial; background:#f3f4f6; padding:40px; text-align:center;">
            <h2 style="color:#dc3545;">❌ Vacaciones rechazadas</h2>
            <p>La solicitud fue rechazada correctamente.</p>
          </body>
        </html>
      `);

    } catch (err) {
      console.error(err);
      return res.status(500).send("Error al rechazar solicitud");
    }
  });




//===============================
// VER SOLICITUDES DE VACACIONES
//===============================
// GET /vacaciones -> lista solicitudes con datos del empleado
app.get("/vacaciones", async (req, res) => {
  try {
    const sql = `
      SELECT v.id, v.empleado_id, v.fecha_inicio, v.fecha_fin, v.motivo, v.estado,
             e.id AS emp_id, e.nombre AS nombre_empleado, e.dias_vacaciones
      FROM vacaciones v
      LEFT JOIN empleados e ON v.empleado_id = e.id
      ORDER BY v.id DESC
    `;
    const [rows] = await db.promise().query(sql);
    res.json(rows);
  } catch (err) {
    console.error("ERROR GET /vacaciones:", err);
    res.status(500).json({ message: "Error al obtener solicitudes" });
  }
});

//===============================
// APROBAR O RECHAZAR SOLICITUDES RH
//===============================

app.put("/vacaciones/:id", async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  const estadosPermitidos = ["Aprobada", "Rechazada"];
  if (!estadosPermitidos .includes (estado)) {
    return res.status(400).json({ error: "Estado no permitido" })
  };

  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    // 1) Obtener solicitud + empleado
    const [rows] = await conn.query(
      `SELECT v.id, v.empleado_id, v.fecha_inicio, v.fecha_fin, v.estado as estado_actual,
       e.nombre, e.correo, e.dias_vacaciones, e.dias_vacaciones_anteriores, e.fecha_expiracion_anteriores
       FROM vacaciones v
       JOIN empleados e ON v.empleado_id = e.id
       WHERE v.id = ? FOR UPDATE`,
      [id]
    );

    if (!rows.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }

    const solicitud = rows[0];

    if (solicitud.estado_actual !== "Pendiente RH") {
      await conn.rollback();
      return res.status(400).json({
        error: `La solicitud no puede ser procesada en estado: ${solicitud.estado_actual}`
      });
    }



    // calcular dias solicitados (incluyendo el día final)
    const inicio = new Date(solicitud.fecha_inicio);
    const fin = new Date(solicitud.fecha_fin);
    const diasSolicitados = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;

    // Si aprueba, restar días (primero de anteriores, luego de actuales)
    if (estado === "Aprobada") {
      const hoy = new Date();
      let diasAnterioresDisponibles = 0;

      // Verificar días anteriores disponibles
      if (solicitud.dias_vacaciones_anteriores > 0 && solicitud.fecha_expiracion_anteriores) {
        const fechaExp = new Date(solicitud.fecha_expiracion_anteriores);
        if (hoy <= fechaExp) {
          diasAnterioresDisponibles = solicitud.dias_vacaciones_anteriores;
        }
      }

      const diasActuales = solicitud.dias_vacaciones || 0;
      const diasTotales = diasActuales + diasAnterioresDisponibles;

      if (diasSolicitados > diasTotales) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ 
          error: `El empleado no tiene suficientes días disponibles. Disponibles: ${diasTotales}, Solicitados: ${diasSolicitados}` 
        });
      }

      // Restar días (primero de anteriores, luego de actuales)
      let diasPorRestar = diasSolicitados;
      let nuevosAnteriores = diasAnterioresDisponibles;
      let nuevosActuales = diasActuales;

      if (diasPorRestar <= diasAnterioresDisponibles) {
        // Se cubren todos con días anteriores
        nuevosAnteriores -= diasPorRestar;
      } else {
        // Usar todos los anteriores y parte de los actuales
        diasPorRestar -= diasAnterioresDisponibles;
        nuevosAnteriores = 0;
        nuevosActuales -= diasPorRestar;
      }

      await conn.query(`
        UPDATE empleados 
        SET dias_vacaciones = ?,
            dias_vacaciones_anteriores = ?
        WHERE id = ?
      `, [nuevosActuales, nuevosAnteriores, solicitud.empleado_id]);
    }
    // 2) Actualizar estado de la solicitud
    await conn.query(
      `
      UPDATE vacaciones
      SET estado = ?, aprobado_rh = ?
      WHERE id = ?
      `,
      [estado, estado === "Aprobada" ? 1 : 0, id]
    );

    // 3) Si fue aprobada -> restar dias en empleados
    if (estado === "Aprobada") {
      await conn.query(
        "UPDATE empleados SET dias_vacaciones = dias_vacaciones - ? WHERE id = ?",
        [diasSolicitados, solicitud.empleado_id]
      );
    }

    await conn.commit();

    // ======================
    // ENVIAR CORREO A EMPLEADO
    // ======================
    try {
      let subject = "";

      if (estado === "Aprobada") subject = "Vacaciones aprobadas";
      if (estado === "Rechazada") subject = "Vacaciones rechazadas";

      if (subject) {
        const message = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>${subject}</title>
      </head>

      <body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">

        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6; padding:30px 0;">
          <tr>
            <td align="center">

              <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">

                <!-- HEADER -->
                <tr>
                  <td style="background-color:#127726; padding:20px; text-align:center;">
                    <h2 style="margin:0; color:#ffffff; font-size:20px;">
                      Intranet Acre Residencial
                    </h2>
                  </td>
                </tr>

                <!-- CONTENT -->
                <tr>
                  <td style="padding:25px; color:#333333; font-size:14px; line-height:1.6;">

                    <p style="margin-top:0;">
                      Hola <strong>${solicitud.nombre}</strong>,
                    </p>

                    ${
                      estado === "Aprobada"
                        ? `
                        <p>
                          Tu solicitud de vacaciones fue 
                          <strong style="color:#127726;">APROBADA</strong>.
                        </p>

                        <p>
                          <strong>Días aprobados:</strong> ${diasSolicitados}
                        </p>

                        <p>
                          ¡Disfruta tu descanso! 😊
                        </p>

                        <div style="
                          margin-top:15px;
                          display:inline-block;
                          padding:8px 18px;
                          background-color:#dcfce7;
                          color:#166534;
                          border-radius:20px;
                          font-size:12px;
                          font-weight:bold;
                        ">
                          ✔ Solicitud aprobada
                        </div>
                        `
                        : `
                        <p>
                          Tu solicitud de vacaciones fue 
                          <strong style="color:#b91c1c;">RECHAZADA</strong>.
                        </p>

                        <p>
                          Para más información, por favor contacta al área de Recursos Humanos.
                        </p>

                        <div style="
                          margin-top:15px;
                          display:inline-block;
                          padding:8px 18px;
                          background-color:#fee2e2;
                          color:#7f1d1d;
                          border-radius:20px;
                          font-size:12px;
                          font-weight:bold;
                        ">
                          ✖ Solicitud rechazada
                        </div>
                        `
                    }

                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td style="background-color:#f9fafb; padding:15px; text-align:center; font-size:12px; color:#6b7280;">
                    Este correo fue enviado automáticamente por la Intranet Acre Residencial.<br>
                    No respondas a este mensaje.
                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>

      </body>
      </html>
      `;

        await fetch("https://acre.mx/api/send-mail.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": process.env.MAIL_API_KEY
          },
          body: JSON.stringify({
            to: solicitud.correo,
            subject,
            message
          })
        });
      }

    } catch (mailError) {
      console.error("❌ Error enviando correo a empleado:", mailError);
    }

    return res.json({ ok: true, message: `Solicitud ${estado.toLowerCase()} correctamente`});

  } catch (err) {
    await conn.rollback().catch(() => {});
    conn.release();
    
    console.error("ERROR PUT /vacaciones/:id", err);
    return res.status(500).json({ error: "Error procesando solicitud RH" });
  } finally {
    conn.release();
  }
});


// =============================
// VER SOLICITUDES POR EMPLEADO
// =============================
app.get("/vacaciones/empleado/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const sql = `
      SELECT 
        v.id,
        v.fecha_inicio,
        v.fecha_fin,
        v.motivo,
        v.estado,
        v.fecha_solicitud,
        e.nombre,
        e.dias_vacaciones
      FROM vacaciones v
      INNER JOIN empleados e ON v.empleado_id = e.id
      WHERE v.empleado_id = ?
      ORDER BY v.id DESC
    `;

    const [rows] = await db.promise().query(sql, [id]);
    res.json(rows);

  } catch (err) {
    console.error("ERROR GET /vacaciones/empleado/:id:", err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// =====================================================
// ENDPOINT: Renovar vacaciones (ejecutar con cron job)
// =====================================================

app.post("/vacaciones/renovar-automatico", async (req, res) => {
  try {
    console.log("🔄 Iniciando renovación automática de vacaciones...");

    // Obtener todos los empleados activos
    const [empleados] = await db.promise().query(`
      SELECT id, nombre, fecha_ingreso, dias_vacaciones, 
             dias_vacaciones_anteriores, fecha_expiracion_anteriores, ultima_renovacion
      FROM empleados 
      WHERE fecha_ingreso IS NOT NULL
    `);

    const hoy = new Date();
    let renovados = 0;
    let expirados = 0;

    for (const emp of empleados) {
      const fechaIngreso = new Date(emp.fecha_ingreso);
      const ultimaRenovacion = emp.ultima_renovacion ? new Date(emp.ultima_renovacion) : fechaIngreso;
      
      // Calcular años laborados
      const anosLaborados = calcularAnosLaborados(emp.fecha_ingreso);
      
      // Verificar si ya cumplió un año desde la última renovación
      const mesesDesdeRenovacion = (hoy.getFullYear() - ultimaRenovacion.getFullYear()) * 12 + 
                                    (hoy.getMonth() - ultimaRenovacion.getMonth());
      
      const diaCumpleAniversario = fechaIngreso.getDate();
      const mesCumpleAniversario = fechaIngreso.getMonth();
      
      // Si hoy es el aniversario o ya pasó y no se ha renovado este año
      const debeRenovar = (
        anosLaborados > 0 &&
        hoy.getMonth() === mesCumpleAniversario &&
        hoy.getDate() === diaCumpleAniversario &&
        mesesDesdeRenovacion >= 12
      );

      if (debeRenovar) {
        // Calcular días no usados del período anterior
        const diasNoUsados = emp.dias_vacaciones || 0;
        
        // Obtener nuevos días según años laborados
        const nuevosDias = obtenerDiasVacaciones(anosLaborados);
        
        // Fecha de expiración: 4 meses desde hoy
        const fechaExpiracion = new Date(hoy);
        fechaExpiracion.setMonth(fechaExpiracion.getMonth() + 4);
        
        // Actualizar empleado
        await db.promise().query(`
          UPDATE empleados 
          SET dias_vacaciones = ?,
              dias_vacaciones_anteriores = ?,
              fecha_expiracion_anteriores = ?,
              ultima_renovacion = ?
          WHERE id = ?
        `, [
          nuevosDias,
          diasNoUsados,
          fechaExpiracion.toISOString().split('T')[0],
          hoy.toISOString().split('T')[0],
          emp.id
        ]);

        console.log(`✅ ${emp.nombre}: ${nuevosDias} días nuevos + ${diasNoUsados} días anteriores (expiran: ${fechaExpiracion.toISOString().split('T')[0]})`);
        renovados++;
      }

      // Verificar si hay días anteriores expirados
      if (emp.dias_vacaciones_anteriores > 0 && emp.fecha_expiracion_anteriores) {
        const fechaExp = new Date(emp.fecha_expiracion_anteriores);
        
        if (hoy > fechaExp) {
          // Expirar días anteriores
          await db.promise().query(`
            UPDATE empleados 
            SET dias_vacaciones_anteriores = 0,
                fecha_expiracion_anteriores = NULL
            WHERE id = ?
          `, [emp.id]);

          console.log(`⏰ ${emp.nombre}: ${emp.dias_vacaciones_anteriores} días anteriores EXPIRADOS`);
          expirados++;
        }
      }
    }

    console.log(`✅ Renovación completada: ${renovados} empleados renovados, ${expirados} expiraciones`);
    
    res.json({
      ok: true,
      message: "Renovación automática completada",
      renovados,
      expirados,
      total_empleados: empleados.length
    });

  } catch (err) {
    console.error("❌ Error en renovación automática:", err);
    res.status(500).json({ error: "Error en renovación automática" });
  }
});
