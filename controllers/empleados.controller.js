import Empleado from "../models/Empleado.js";

export const obtenerEmpleados = async (req, res) => {
  try {
    res.json(await Empleado.find());
  } catch {
    res.status(500).json({ error: "Error obteniendo empleados" });
  }
};

export const crearEmpleado = async (req, res) => {
  try {
    const nuevo = await Empleado.create(req.body);
    res.json(nuevo);
  } catch {
    res.status(500).json({ error: "Error creando empleado" });
  }
};

export const eliminarEmpleado = async (req, res) => {
  try {
    await Empleado.findByIdAndDelete(req.params.id);
    res.json({ mensaje: "Empleado eliminado" });
  } catch {
    res.status(500).json({ error: "Error eliminando empleado" });
  }
};
