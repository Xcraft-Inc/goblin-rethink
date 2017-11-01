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
      entity.meta.info = 'new ' + type;
      entity.meta.description = 'new ' + type;
    }
    const meta = entity.meta;
    meta.info = buildInfo ? buildInfo (entity) : meta.info;
    meta.references = references || null;
    meta.context = context || {};
  },
};
