const prisma = require('../db');

async function nextCode(model, prefix, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const last = await model.findFirst({
      where:   { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select:  { code: true },
    });
    const num = last ? (parseInt(last.code.split('-').pop()) || 0) : 0;
    const code = `${prefix}-${String(num + 1 + attempt).padStart(3, '0')}`;
    const exists = await model.findFirst({ where: { code }, select: { code: true } });
    if (!exists) return code;
  }
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-X${ts}`;
}

module.exports = { nextCode };
