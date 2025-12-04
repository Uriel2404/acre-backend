import express from "express";
import cors from "cors";
import mysql from "mysql2";
import dotenv from "dotenv";
import multer from "multer";
import ftp from "basic-ftp";
import fs from "fs";
import path from "path";

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
app.use(express.urlencoded({ extended: true }));
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





// ===============================================================
//                S O L I C I T U D E S   D E   V A C A C I O N E S
// ===============================================================

// Crear solicitud de vacaciones
app.post("/vacaciones/solicitar", (req, res) => {
  const {
    empleado_id,
    nombre,
    departamento,
    fecha_inicio,
    fecha_fin,
    dias,
    comentarios
  } = req.body;

  if (!empleado_id || !fecha_inicio || !fecha_fin || !dias) {
    return res.status(400).json({ message: "Faltan datos obligatorios" });
  }

  const sql = `
    INSERT INTO vacaciones (
      empleado_id,
      nombre,
      departamento,
      fecha_inicio,
      fecha_fin,
      dias,
      comentarios,
      estado,
      fecha_solicitud
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente', NOW())
  `;

  db.query(
    sql,
    [empleado_id, nombre, departamento, fecha_inicio, fecha_fin, dias, comentarios],
    (err, result) => {
      if (err) {
        console.error("MYSQL ERROR:", err);
        return res.status(500).json({ message: "Error al registrar solicitud" });
      }

      res.json({
        message: "Solicitud enviada correctamente",
        id: result.insertId
      });
    }
  );
});

// Obtener solicitudes por empleado
app.get("/vacaciones/mis-solicitudes/:empleado_id", (req, res) => {
  const { empleado_id } = req.params;

  const sql = `
    SELECT * FROM vacaciones
    WHERE empleado_id = ?
    ORDER BY fecha_solicitud DESC
  `;

  db.query(sql, [empleado_id], (err, rows) => {
    if (err) {
      console.error("MYSQL ERROR:", err);
      return res.status(500).json({ message: "Error al obtener solicitudes" });
    }

    res.json(rows);
  });
});

// Obtener TODAS las solicitudes (solo RH y Admin)
app.get("/vacaciones/todas", (req, res) => {
  const sql = `
    SELECT * FROM vacaciones
    ORDER BY fecha_solicitud DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("MYSQL ERROR:", err);
      return res.status(500).json({ message: "Error al obtener solicitudes" });
    }

    res.json(rows);
  });
});

// Cambiar estado (Aprobar / Rechazar)
app.post("/vacaciones/cambiar-estado", (req, res) => {
  const { id, estado } = req.body;

  if (!id || !estado) {
    return res.status(400).json({ message: "Faltan datos" });
  }

  const sql = `
    UPDATE vacaciones
    SET estado = ?, fecha_respuesta = NOW()
    WHERE id = ?
  `;

  db.query(sql, [estado, id], (err) => {
    if (err) {
      console.error("MYSQL ERROR:", err);
      return res.status(500).json({ message: "Error al actualizar estado" });
    }

    res.json({ message: "Estado actualizado" });
  });
});









