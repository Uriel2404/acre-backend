import mongoose from "mongoose";

const DocumentoSchema = new mongoose.Schema({
  nombre: String,
  url: String,
  categoria: String,
  departamento: String,
  fecha: { type: Date, default: Date.now },
});

export default mongoose.model("Documento", DocumentoSchema);
