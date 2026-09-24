/**
 * Respaldo nocturno de la base: pg_dump → bucket de Neon Object Storage.
 *
 * Corre como servicio cron aparte en Railway (backup/Dockerfile, backup/railway.json),
 * porque necesita pg_dump 18 y el servidor del CRM no lo tiene. También se puede
 * correr a mano desde una PC con PostgreSQL 18 instalado:
 *   railway run node backup/respaldo-base.js
 *
 * Pasos:
 *   1. pg_dump en formato custom (el mismo que se usó para mudar la base).
 *   2. Control: pg_restore --list tiene que mostrar los datos de todas las tablas.
 *   3. Sube base/AAAA-MM-DD.dump (si corre dos veces el mismo día, pisa esa copia).
 *   4. Retención: últimos 7 días + la última copia de cada una de las últimas 4 semanas
 *      + la última de cada uno de los últimos 12 meses. El resto se borra.
 *   5. Deja el resultado en estado/base.json (lo muestra Configuración → Desarrollador).
 *
 * Variables: DATABASE_URL, AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, AWS_REGION, opcional RESPALDO_BUCKET y PG_BIN (carpeta de pg_dump).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.RESPALDO_BUCKET || 'respaldos';
const BIN = process.env.PG_BIN ? (n => path.join(process.env.PG_BIN, n)) : (n => n);

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});

const guardarEstado = estado => s3.send(new PutObjectCommand({
  Bucket: BUCKET, Key: 'estado/base.json', Body: JSON.stringify(estado, null, 2), ContentType: 'application/json',
}));

// Fecha en hora Argentina (UTC-3), para que el nombre del archivo sea el día local
const fechaArg = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);

function aConservar(fechas) {
  // fechas: 'AAAA-MM-DD' de más nueva a más vieja
  const quedan = new Set(fechas.slice(0, 7));
  const semana = f => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const semanas = new Set(), meses = new Set();
  for (const f of fechas) {
    if (semanas.size < 4 && !semanas.has(semana(f))) { semanas.add(semana(f)); quedan.add(f); }
    if (meses.size < 12 && !meses.has(f.slice(0, 7))) { meses.add(f.slice(0, 7)); quedan.add(f); }
  }
  return quedan;
}

(async () => {
  const t0 = Date.now();
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');

  // Conexión directa (sin el pooler): pg_dump necesita una sesión propia
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = url.hostname.replace('-pooler', '');

  const archivo = path.join(os.tmpdir(), `respaldo-${Date.now()}.dump`);
  const dump = spawnSync(BIN('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--file', archivo, '--dbname', url.toString()], { encoding: 'utf8' });
  if (dump.status !== 0) throw new Error(`pg_dump falló: ${(dump.stderr || dump.error?.message || '').replaceAll(url.password, '***').slice(0, 500)}`);

  // Control: que el archivo se pueda leer y traiga los datos de todas las tablas
  const lista = spawnSync(BIN('pg_restore'), ['--list', archivo], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (lista.status !== 0) throw new Error(`El respaldo no se puede leer: ${(lista.stderr || '').slice(0, 300)}`);
  const conDatos = (lista.stdout.match(/ TABLE DATA public /g) || []).length;
  const definidas = (lista.stdout.match(/ TABLE public /g) || []).length;
  if (!definidas || conDatos !== definidas) throw new Error(`Respaldo incompleto: ${conDatos} tablas con datos de ${definidas}`);

  const bytes = fs.statSync(archivo).size;
  const nombre = `${fechaArg()}.dump`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `base/${nombre}`, Body: fs.readFileSync(archivo), ContentType: 'application/octet-stream' }));
  fs.unlinkSync(archivo);

  // Retención
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'base/' }));
  const fechas = (r.Contents || []).map(o => o.Key.match(/^base\/(\d{4}-\d{2}-\d{2})\.dump$/)?.[1]).filter(Boolean).sort().reverse();
  const quedan = aConservar(fechas);
  const borrar = fechas.filter(f => !quedan.has(f));
  if (borrar.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: borrar.map(f => ({ Key: `base/${f}.dump` })) } }));

  const estado = {
    fecha: new Date().toISOString(), ok: true, archivo: nombre, bytes, tablas: definidas,
    copiasGuardadas: quedan.size, borradas: borrar, segundos: Math.round((Date.now() - t0) / 1000),
  };
  await guardarEstado(estado);
  console.log(`💾 Respaldo de la base OK: ${nombre} · ${Math.round(bytes / 1024)} KB · ${definidas} tablas · ${quedan.size} copias guardadas${borrar.length ? ` · borradas: ${borrar.join(', ')}` : ''}`);
})().catch(async e => {
  console.error('❌ Respaldo de la base FALLÓ:', e.message);
  await guardarEstado({ fecha: new Date().toISOString(), ok: false, error: e.message }).catch(() => {});
  process.exit(1);
});
