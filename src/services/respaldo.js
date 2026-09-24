/**
 * Respaldos en el bucket de Neon Object Storage (S3-compatible).
 *
 * Estructura del bucket:
 *   base/AAAA-MM-DD.dump     copia completa de la base (pg_dump), la sube backup/respaldo-base.js
 *   adjuntos/<ruta>          espejo de uploads/ (attachments, feedback, avatars), lo sube este módulo
 *   estado/base.json         resultado del último respaldo de la base
 *   estado/adjuntos.json     resultado del último respaldo de adjuntos
 *
 * El estado se guarda en el bucket y no en la base a propósito: el respaldo de
 * adjuntos corre de noche y no tiene por qué despertar el cómputo de Neon.
 *
 * Variables: AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AWS_REGION, y opcional RESPALDO_BUCKET (default "respaldos").
 */
const fs = require('fs');
const path = require('path');
const {
  S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand,
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.RESPALDO_BUCKET || 'respaldos';
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

const configurado = () => !!(process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

// Solo el servidor de producción sube adjuntos: un CRM local con las mismas
// credenciales en el .env mezclaría sus archivos de prueba con el respaldo real.
const esProduccion = () => process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

let _s3 = null;
function s3() {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,                      // Neon no soporta virtual-host
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    });
  }
  return _s3;
}

// Todos los objetos bajo un prefijo (ListObjectsV2 devuelve de a 1000)
async function listar(prefijo) {
  const out = [];
  let token;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefijo, ContinuationToken: token }));
    for (const o of r.Contents || []) out.push({ key: o.Key, size: o.Size, fecha: o.LastModified });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function leerJson(key) {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await r.Body.transformToString());
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

const escribirJson = (key, obj) => s3().send(new PutObjectCommand({
  Bucket: BUCKET, Key: key, Body: JSON.stringify(obj, null, 2), ContentType: 'application/json',
}));

// Archivos de uploads/ con su ruta relativa (con "/" siempre, para usarla de key)
function archivosLocales(dir = UPLOADS_ROOT, base = '') {
  const out = [];
  let entradas = [];
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entradas) {
    if (e.name === 'lost+found') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivosLocales(abs, rel));
    else if (e.isFile()) out.push({ rel, abs, size: fs.statSync(abs).size });
  }
  return out;
}

let adjuntosEnCurso = false;

/**
 * Sube al bucket los archivos de uploads/ que todavía no están (o cambiaron de
 * tamaño). Nunca borra nada del bucket: si un adjunto se elimina del CRM, su
 * copia queda en el respaldo.
 */
async function respaldarAdjuntos({ log = console.log } = {}) {
  if (!configurado()) throw new Error('Respaldo sin configurar (faltan variables AWS_*)');
  if (!esProduccion()) throw new Error('El respaldo de adjuntos solo corre en el servidor de producción');
  if (adjuntosEnCurso) return { omitido: 'ya hay un respaldo de adjuntos en curso' };
  adjuntosEnCurso = true;
  const t0 = Date.now();
  try {
    const remotos = new Map((await listar('adjuntos/')).map(o => [o.key, o.size]));
    const locales = archivosLocales();
    const faltan = locales.filter(f => remotos.get(`adjuntos/${f.rel}`) !== f.size);
    log(`💾 Respaldo de adjuntos: ${locales.length} en disco, ${faltan.length} para subir`);

    let subidos = 0, bytes = 0;
    const errores = [];
    const cola = [...faltan];
    const trabajador = async () => {
      for (let f = cola.shift(); f; f = cola.shift()) {
        try {
          await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: `adjuntos/${f.rel}`, Body: fs.readFileSync(f.abs) }));
          subidos++; bytes += f.size;
          if (subidos % 200 === 0) log(`   … ${subidos}/${faltan.length}`);
        } catch (e) {
          errores.push(`${f.rel}: ${e.message}`);
        }
      }
    };
    await Promise.all([1, 2, 3, 4].map(trabajador));

    const estado = {
      fecha: new Date().toISOString(), ok: errores.length === 0,
      archivosEnDisco: locales.length, bytesEnDisco: locales.reduce((s, f) => s + f.size, 0),
      subidos, bytesSubidos: bytes, errores: errores.slice(0, 20), cantErrores: errores.length,
      segundos: Math.round((Date.now() - t0) / 1000),
    };
    await escribirJson('estado/adjuntos.json', estado);
    log(`💾 Respaldo de adjuntos ${estado.ok ? 'OK' : 'CON ERRORES'}: ${subidos} subidos (${Math.round(bytes / 1048576)} MB) en ${estado.segundos}s${errores.length ? ` · ${errores.length} errores` : ''}`);
    return estado;
  } catch (e) {
    await escribirJson('estado/adjuntos.json', { fecha: new Date().toISOString(), ok: false, error: e.message }).catch(() => {});
    throw e;
  } finally {
    adjuntosEnCurso = false;
  }
}

// Resumen para la pantalla de Configuración
async function estadoRespaldos() {
  if (!configurado()) return { configurado: false };
  const [base, adjuntos, dumps] = await Promise.all([
    leerJson('estado/base.json'), leerJson('estado/adjuntos.json'), listar('base/'),
  ]);
  dumps.sort((a, b) => b.key.localeCompare(a.key));
  return {
    configurado: true, bucket: BUCKET, base, adjuntos,
    copiasBase: dumps.map(d => ({ archivo: d.key.replace('base/', ''), bytes: d.size })),
  };
}

module.exports = { configurado, esProduccion, respaldarAdjuntos, estadoRespaldos, listar, BUCKET };
