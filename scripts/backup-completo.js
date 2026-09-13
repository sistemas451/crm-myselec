/**
 * Backup COMPLETO de producción a disco local. Solo lectura sobre producción:
 * no ejecuta un solo INSERT, UPDATE ni DELETE.
 *
 * Descubre las tablas solas (information_schema) en vez de tener una lista
 * escrita a mano — así no se olvida ninguna si el schema cambió.
 *
 * Se lee con SELECT * en crudo a propósito: producción todavía no tiene las
 * columnas nuevas (priority, revisionDeId, anuladaAt, anuladaMotivo) y el
 * cliente de Prisma local sí las conoce, así que un findMany() fallaría.
 *
 * Deja: backups/completo-<fecha>/<Tabla>.json + _manifiesto.json
 *
 * OJO: el backup incluye AppSetting, que trae las contraseñas de las casillas
 * de mail en texto plano. Queda en backups/, que está en .gitignore — no
 * commitear ni mandar por mail.
 *
 * Uso: railway run node scripts/backup-completo.js
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const url = process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL — hay que correrlo con `railway run`'); process.exit(1); }

const db = new PrismaClient({ datasources: { db: { url } } });
const host = (url.match(/@([^\/]+)\//) || [])[1] || '?';

// BigInt no se serializa solo en JSON; los Date sí (quedan en ISO).
const reemplazo = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

(async () => {
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(__dirname, '..', 'backups', `completo-${sello}`);
  fs.mkdirSync(dir, { recursive: true });

  console.log('\n=== Backup completo de producción ===');
  console.log('  origen  :', host, '(SOLO LECTURA)');
  console.log('  destino :', dir);
  console.log('');

  const tablas = await db.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`);

  const manifiesto = { tomadoEl: new Date().toISOString(), origen: host, tablas: {} };
  let total = 0;

  for (const { table_name } of tablas) {
    const filas = await db.$queryRawUnsafe(`SELECT * FROM "${table_name}"`);
    fs.writeFileSync(path.join(dir, `${table_name}.json`), JSON.stringify(filas, reemplazo, 2));
    manifiesto.tablas[table_name] = filas.length;
    total += filas.length;
    console.log(`  ${table_name.padEnd(22)} ${String(filas.length).padStart(6)}`);
  }

  // El schema que estaba vigente cuando se tomó el backup, para poder comparar
  // después contra el desplegado.
  const columnas = await db.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`);
  fs.writeFileSync(path.join(dir, '_schema-columnas.json'), JSON.stringify(columnas, reemplazo, 2));

  manifiesto.filasTotales = total;
  fs.writeFileSync(path.join(dir, '_manifiesto.json'), JSON.stringify(manifiesto, reemplazo, 2));

  console.log(`\n  ${tablas.length} tablas · ${total} filas`);
  console.log(`  ✅ ${dir}\n`);
  await db.$disconnect();
})().catch(async e => {
  console.error('\nERROR:', e.message);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
