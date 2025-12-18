export async function expirarDiasAcumulados(db) {
  const hoy = new Date();

  const [empleados] = await db.query(`
    SELECT id, dias_base, dias_acumulados, fecha_expiracion
    FROM empleados
    WHERE fecha_expiracion IS NOT NULL
      AND fecha_expiracion < CURDATE()
      AND dias_acumulados > 0
  `);

  for (const emp of empleados) {
    await db.query(
      `
      UPDATE empleados
      SET
        dias_acumulados = 0,
        dias_vacaciones = dias_base,
        fecha_expiracion = NULL
      WHERE id = ?
      `,
      [emp.id]
    );
  }

  return empleados.length;
}
