import mongoose from "mongoose";

const EmpleadoSchema = new mongoose.Schema({
  nombre: String,
  puesto: String,
  departamento: String,
  correo: String,
});

export default mongoose.model("Empleado", EmpleadoSchema);
