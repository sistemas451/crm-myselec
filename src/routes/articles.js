const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const crypto  = require('crypto');
const {authMiddleware, isAdmin } = require('../middleware/auth');
const prisma = require('../db');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Cache en memoria para preview pendiente (token → parsed rows)
const previewCache = new Map(); // token → { rows, expiresAt }

// ── Helper: parsear XLS de Flexxus desde buffer ───────────────────────────
function parseArticlesXLS(buffer) {
  const COL = { code: 0, description: 1, category: 5, coefVar: 8, type: 9, class: 10, active: 11 };
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return rows.slice(9) // fila 10 en adelante (headers en fila 9)
    .filter(r => r[COL.code] && r[COL.description])
    .map(r => ({
      code:        String(r[COL.code]).trim(),
      description: String(r[COL.description]).trim(),
      category:    r[COL.category]  ? String(r[COL.category]).trim()  : null,
      type:        r[COL.type]      ? String(r[COL.type]).trim()      : null,
      class:       r[COL.class]     ? String(r[COL.class]).trim()     : null,
      coefVar:     r[COL.coefVar] !== '' ? parseFloat(r[COL.coefVar]) || null : null,
      active:      String(r[COL.active]).trim().toUpperCase() !== 'NO',
    }));
}

// GET /api/articles?q=&category=&type=&class=&active=&sortBy=code&sortDir=asc&limit=100&offset=0
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { q, category, type, active, limit = 100, offset = 0,
            sortBy = 'code', sortDir = 'asc' } = req.query;
    const where = {};

    if (q) {
      where.OR = [
        { code:        { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = { equals: category, mode: 'insensitive' };
    if (type)     where.type     = { equals: type,     mode: 'insensitive' };
    if (req.query.class) where.class = { equals: req.query.class, mode: 'insensitive' };
    if (active !== undefined) where.active = active === 'true';

    const VALID_SORT = ['code', 'description', 'category', 'type', 'class'];
    const orderField = VALID_SORT.includes(sortBy) ? sortBy : 'code';
    const orderDir   = sortDir === 'desc' ? 'desc' : 'asc';

    const [items, total] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: { [orderField]: orderDir },
        take:    parseInt(limit),
        skip:    parseInt(offset),
        select:  { id: true, code: true, description: true, category: true, type: true, class: true, active: true },
      }),
      prisma.article.count({ where }),
    ]);

    res.json({ items, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/articles/meta — rubros, tipos y clases únicos en un solo call
router.get('/meta', authMiddleware, async (req, res) => {
  try {
    const [cats, types, classes] = await Promise.all([
      prisma.article.findMany({ where: { category: { not: null }, active: true }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } }),
      prisma.article.findMany({ where: { type:     { not: null }, active: true }, select: { type:     true }, distinct: ['type'],     orderBy: { type:     'asc' } }),
      prisma.article.findMany({ where: { class:    { not: null }, active: true }, select: { class:    true }, distinct: ['class'],    orderBy: { class:    'asc' } }),
    ]);
    res.json({
      categories: cats.map(c => c.category).filter(Boolean),
      types:      types.map(t => t.type).filter(Boolean),
      classes:    classes.map(c => c.class).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/articles/categories — lista de rubros únicos
router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const cats = await prisma.article.findMany({
      where:   { category: { not: null }, active: true },
      select:  { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    res.json(cats.map(c => c.category).filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/articles/search?q= — búsqueda rápida para autocomplete (top 10)
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (q.length < 2) return res.json([]);
    const items = await prisma.article.findMany({
      where: {
        active: true,
        OR: [
          { code:        { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      take: 10,
      select: { id: true, code: true, description: true, category: true },
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/articles/:code — artículo por código exacto
router.get('/:code', authMiddleware, async (req, res) => {
  try {
    const article = await prisma.article.findUnique({
      where: { code: req.params.code },
    });
    if (!article) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/articles — crear artículo manualmente (admin only)
router.post('/', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { code, description, category, type, class: cls, coefVar, active = true } = req.body;
    if (!code?.trim())        return res.status(400).json({ error: 'El código es requerido' });
    if (!description?.trim()) return res.status(400).json({ error: 'La descripción es requerida' });
    const article = await prisma.article.create({
      data: {
        code:        code.trim().toUpperCase(),
        description: description.trim(),
        category:    category?.trim() || null,
        type:        type?.trim()     || null,
        class:       cls?.trim()      || null,
        coefVar:     coefVar != null && coefVar !== '' ? parseFloat(coefVar) : null,
        active:      active === true || active === 'true',
      },
    });
    res.json(article);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Ya existe un artículo con ese código' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/articles/:code — editar artículo (admin only)
router.patch('/:code', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { description, category, type, class: cls, coefVar, active } = req.body;
    const data = {};
    if (description !== undefined) data.description = description.trim();
    if (category    !== undefined) data.category    = category?.trim()  || null;
    if (type        !== undefined) data.type        = type?.trim()      || null;
    if (cls         !== undefined) data.class       = cls?.trim()       || null;
    if (coefVar     !== undefined) data.coefVar     = coefVar !== '' ? parseFloat(coefVar) || null : null;
    if (active      !== undefined) data.active      = active === true || active === 'true';
    const article = await prisma.article.update({ where: { code: req.params.code }, data });
    res.json(article);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Artículo no encontrado' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/articles/:code — eliminar artículo individual o todos (admin only)
router.delete('/:code', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });

  // Caso especial: eliminar TODO el catálogo
  if (req.params.code === 'all') {
    try {
      const result = await prisma.article.deleteMany({});
      return res.json({ ok: true, deleted: result.count });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Eliminar artículo individual
  try {
    await prisma.article.delete({ where: { code: req.params.code } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Artículo no encontrado' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/articles/preview — subir XLS, comparar con DB, devolver diff sin tocar nada
router.post('/preview', authMiddleware, upload.single('file'), async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    // 1. Parsear XLS
    const incoming = parseArticlesXLS(req.file.buffer);
    if (!incoming.length) return res.status(400).json({ error: 'No se encontraron artículos en el archivo. Verificá el formato.' });

    const incomingMap = new Map(incoming.map(a => [a.code, a]));

    // 2. Traer todos los artículos actuales de la DB
    const existing = await prisma.article.findMany({
      select: { code: true, description: true, category: true, type: true, class: true, coefVar: true, active: true },
    });
    const existingMap = new Map(existing.map(a => [a.code, a]));

    // 3. Clasificar
    const toAdd     = []; // en XLS, no en DB
    const toUpdate  = []; // en ambos, con cambios
    const unchanged = []; // en ambos, sin cambios
    const toRemove  = []; // en DB, no en XLS

    for (const [code, row] of incomingMap) {
      const ex = existingMap.get(code);
      if (!ex) {
        toAdd.push(row);
      } else {
        const changed =
          ex.description !== row.description ||
          (ex.category || null) !== row.category ||
          (ex.type     || null) !== row.type     ||
          (ex.class    || null) !== row.class     ||
          ex.active            !== row.active;
        changed ? toUpdate.push({ ...row, _old: ex }) : unchanged.push(code);
      }
    }
    for (const [code, ex] of existingMap) {
      if (!incomingMap.has(code)) toRemove.push(ex);
    }

    // 4. Guardar en cache con token (expira en 30 min)
    const token = crypto.randomBytes(16).toString('hex');
    previewCache.set(token, {
      rows:      incoming,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    // Limpiar tokens viejos
    for (const [k, v] of previewCache) if (v.expiresAt < Date.now()) previewCache.delete(k);

    res.json({
      token,
      summary: {
        total:     incoming.length,
        toAdd:     toAdd.length,
        toUpdate:  toUpdate.length,
        unchanged: unchanged.length,
        toRemove:  toRemove.length,
      },
      toAdd:    toAdd.slice(0, 20),      // preview de los primeros 20
      toUpdate: toUpdate.slice(0, 20),
      toRemove,                          // lista completa para confirmación
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/articles/sync — aplicar cambios confirmados
router.post('/sync', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { token, deleteCodes = [] } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const cached = previewCache.get(token);
    if (!cached || cached.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'El preview expiró. Volvé a subir el archivo.' });
    }

    const { rows } = cached;
    previewCache.delete(token);

    // 1. Upsert todos los artículos del XLS
    let upserted = 0;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      await Promise.all(rows.slice(i, i + BATCH).map(r =>
        prisma.article.upsert({
          where:  { code: r.code },
          update: { description: r.description, category: r.category, type: r.type, class: r.class, coefVar: r.coefVar, active: r.active },
          create: r,
        })
      ));
      upserted += Math.min(BATCH, rows.length - i);
    }

    // 2. Eliminar los confirmados
    let deleted = 0;
    if (deleteCodes.length) {
      const result = await prisma.article.deleteMany({ where: { code: { in: deleteCodes } } });
      deleted = result.count;
    }

    res.json({ ok: true, upserted, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
