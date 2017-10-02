module.exports = {
  set: (entity, table, references, initialStatus, context) => {
    if (!entity.meta) {
      entity.meta = {};
    }
    const meta = entity.meta;
    const now = new Date ().getTime ();
    meta.id = entity.id;
    meta.createdAt = now;
    meta.status = initialStatus;
    meta.version = 0;
    meta.table = table;
    meta.references = references || null;
    meta.context = context || {};
  },
};
