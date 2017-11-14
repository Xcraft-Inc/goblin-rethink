//const MarkdownBuilder = require ('./markdownBuilder.js');

module.exports = {
  set: (entity, type, references, initialStatus, context) => {
    const now = new Date ().getTime ();
    if (!entity.meta) {
      entity.meta = {};
      entity.meta.version = 0;
      entity.meta.type = type;
      entity.meta.createdAt = now;
      entity.meta.id = entity.id;
      entity.meta.status = initialStatus;
      entity.meta.info = 'new ' + type;
      entity.meta.description = 'new ' + type;
    }
    const meta = entity.meta;
    meta.references = references || null;
    meta.context = context || {};
  },
};
