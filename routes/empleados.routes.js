import express from "express";
import {
  obtenerEmpleados,
  crearEmpleado,
  eliminarEmpleado
} from "../controllers/empleados.controller.js";

const router = express.Router();

router.get("/", obtenerEmpleados);
router.post("/", crearEmpleado);
router.delete("/:id", eliminarEmpleado);

export default router;
