module.exports = {
  set: (entity, type, table, references, initialStatus, buildInfo, context) => {
    const now = new Date ().getTime ();
    if (!entity.meta) {
      entity.meta = {};
      entity.meta.version = 0;
      entity.meta.type = type;
      entity.meta.table = table;
      entity.meta.createdAt = now;
      entity.meta.id = entity.id;
      entity.meta.status = initialStatus;
    }
    const meta = entity.meta;
    meta.info = buildInfo ? buildInfo (entity) : null;
    meta.references = references || null;
    meta.context = context || {};
  },
};
