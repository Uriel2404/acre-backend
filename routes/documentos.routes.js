import express from "express";
import {
  obtenerDocumentos,
  subirDocumento,
  eliminarDocumento
} from "../controllers/documentos.controller.js";

import upload from "../middleware/upload.js";

const router = express.Router();

router.get("/", obtenerDocumentos);
router.post("/subir", upload.single("archivo"), subirDocumento);
router.delete("/:id", eliminarDocumento);

export default router;
