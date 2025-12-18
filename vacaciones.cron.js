import cron from "node-cron";
import { expirarDiasAcumulados } from "./vacaciones.service.js";
import { db } from "./db.js";

cron.schedule("0 2 * * *", async () => {
  console.log("⏳ Ejecutando expiración de vacaciones...");

  try {
    const total = await expirarDiasAcumulados(db);
    console.log(`✅ Vacaciones expiradas: ${total}`);
  } catch (error) {
    console.error("❌ Error en cron de vacaciones", error);
  }
});
