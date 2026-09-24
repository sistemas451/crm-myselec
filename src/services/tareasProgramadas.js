/**
 * Tareas automáticas del servidor, con un solo reloj de 10 minutos.
 *
 * Neon cobra (o descuenta de las horas gratis) por el tiempo que la base está
 * despierta, y cualquier consulta la despierta ~5 minutos. Antes cada tarea tenía
 * su propio timer y consultaba la base aunque fuera de noche: el sync de mails
 * leía la ventana horaria de la base en cada ciclo solo para decidir no correr, y
 * el chequeo de inactividad corría cada hora las 24 hs.
 *
 * Ahora la configuración de la ventana vive en memoria: se lee de la base al
 * arrancar y se actualiza cuando alguien la guarda (PATCH /api/settings llama a
 * recargarConfig). Fuera de la ventana el reloj no consulta la base para nada.
 *
 *   - Sync de mails:           cada `mail_sync_interval_hours`, dentro de la ventana
 *   - Chequeo de inactividad:  cada 1 hora, dentro de la ventana
 *   - Alertas de etapa (mail): una vez por día, en el primer tick dentro de la ventana
 *   - Respaldo de adjuntos:    3 am, no toca la base (ver services/respaldo.js)
 *
 * Si la ventana está desactivada en Configuración, todo corre a cualquier hora
 * (el comportamiento de antes).
 */
const prisma = require('../db');
const { syncMails } = require('./mailReader');
const { runIdleCheck, runStageAlerts } = require('./notifier');
const respaldo = require('./respaldo');

const TICK_MS = 10 * 60 * 1000;
const CLAVES = ['mail_sync_interval_hours', 'mail_sync_enabled', 'mail_sync_window_enabled',
  'mail_sync_window_days', 'mail_sync_window_start_hour', 'mail_sync_window_end_hour'];

let cfg = null;

// map: { clave: valor } con los settings (los que falten toman el default)
function recargarConfig(map = {}) {
  cfg = {
    syncCadaMs:    Math.max(0.25, parseFloat(map.mail_sync_interval_hours || '2')) * 3600e3, // mínimo 15 min
    syncActivo:    map.mail_sync_enabled !== 'false',
    ventanaActiva: map.mail_sync_window_enabled !== 'false',
    dias:          (map.mail_sync_window_days || '1,2,3,4,5').split(',').map(d => parseInt(d, 10)),
    desde:         parseInt(map.mail_sync_window_start_hour ?? '8', 10),
    hasta:         parseInt(map.mail_sync_window_end_hour ?? '20', 10),
  };
}

async function leerConfigDeLaBase() {
  const filas = await prisma.appSetting.findMany({ where: { key: { in: CLAVES } } });
  recargarConfig(Object.fromEntries(filas.map(f => [f.key, f.value])));
  console.log(`⏰ Tareas automáticas: sync de mails cada ${cfg.syncCadaMs / 3600e3}h${cfg.syncActivo ? '' : ' (DESACTIVADO)'}` +
    (cfg.ventanaActiva ? ` · solo días ${cfg.dias.join(',')} de ${cfg.desde} a ${cfg.hasta}hs` : ' · sin restricción de horario'));
}

// Hora Argentina (UTC-3) como fecha "UTC" para leer día y hora sin depender del huso del server
const ahoraArg = () => new Date(Date.now() - 3 * 3600e3);

function dentroDeVentana() {
  if (!cfg.ventanaActiva) return true;
  const a = ahoraArg();
  return cfg.dias.includes(a.getUTCDay()) && a.getUTCHours() >= cfg.desde && a.getUTCHours() < cfg.hasta;
}

const ultimo = { sync: Date.now(), inactividad: 0, alertasDia: null, respaldoDia: null };

async function tick() {
  const a = ahoraArg();
  const dia = a.toISOString().slice(0, 10);

  // Respaldo de adjuntos: 3 am, fuera de la ventana a propósito (no usa la base)
  if (a.getUTCHours() === 3 && ultimo.respaldoDia !== dia && respaldo.configurado() && respaldo.esProduccion()) {
    ultimo.respaldoDia = dia;
    respaldo.respaldarAdjuntos().catch(e => console.error('❌ Respaldo de adjuntos falló:', e.message));
  }

  if (!cfg || !dentroDeVentana()) return; // fuera de horario: no se toca la base

  if (cfg.syncActivo && Date.now() - ultimo.sync >= cfg.syncCadaMs) {
    ultimo.sync = Date.now();
    console.log('📧 Auto-sync de mails...');
    try { await syncMails(); } catch (e) { console.error('Auto-sync error:', e.message); }
  }

  if (Date.now() - ultimo.inactividad >= 3600e3) {
    ultimo.inactividad = Date.now();
    runIdleCheck().catch(e => console.error('idle check error:', e.message));
  }

  if (ultimo.alertasDia !== dia) {
    ultimo.alertasDia = dia;
    runStageAlerts().catch(e => console.error('stage alerts error:', e.message));
  }
}

let enCurso = false;
async function tickSeguro() {
  if (enCurso) return; // un sync largo no se superpone con el siguiente tick
  enCurso = true;
  try { await tick(); } catch (e) { console.error('tareas programadas error:', e.message); } finally { enCurso = false; }
}

function iniciar() {
  leerConfigDeLaBase()
    .catch(e => { console.error('No se pudo leer la config de tareas, uso los valores por defecto:', e.message); recargarConfig(); })
    .finally(() => {
      setTimeout(tickSeguro, 60 * 1000); // primer tick al minuto de arrancar
      setInterval(tickSeguro, TICK_MS);
    });
}

module.exports = { iniciar, recargarConfig, dentroDeVentana };
