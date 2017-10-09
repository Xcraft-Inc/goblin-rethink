module.exports = {
  set: (entity, type, table, references, initialStatus, buildInfo, context) => {
    if (!entity.meta) {
      entity.meta = {};
    }
    const meta = entity.meta;
    const now = new Date ().getTime ();
    meta.id = entity.id;
    meta.info = buildInfo ? buildInfo (entity) : null;
    meta.createdAt = now;
    meta.status = initialStatus;
    meta.version = 0;
    meta.type = type;
    meta.table = table;
    meta.references = references || null;
    meta.context = context || {};
  },
};
