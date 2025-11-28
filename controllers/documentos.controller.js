import Documento from "../models/Documento.js";

export const obtenerDocumentos = async (req, res) => {
  try {
    const docs = await Documento.find().sort({ fecha: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener documentos" });
  }
};

export const subirDocumento = async (req, res) => {
  try {
    const nuevo = await Documento.create({
      nombre: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      categoria: req.body.categoria,
      departamento: req.body.departamento,
    });
    res.json(nuevo);
  } catch (err) {
    res.status(500).json({ error: "Error al subir documento" });
  }
};

export const eliminarDocumento = async (req, res) => {
  try {
    await Documento.findByIdAndDelete(req.params.id);
    res.json({ mensaje: "Documento eliminado" });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar documento" });
  }
};
