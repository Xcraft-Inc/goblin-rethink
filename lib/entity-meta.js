//const MarkdownBuilder = require ('./markdownBuilder.js');

module.exports = {
  set: (
    entity,
    type,
    references,
    values,
    rootAggrId,
    rootAggrPath,
    initialStatus,
    context
  ) => {
    const now = new Date ().getTime ();
    if (!entity.meta) {
      entity.meta = {};
      entity.meta.version = 0;
      entity.meta.type = type;
      entity.meta.createdAt = now;
      entity.meta.id = entity.id;
      entity.meta.status = initialStatus;
      entity.meta.summaries.info = 'new ' + type;
      entity.meta.summaries.description = 'new ' + type;
      entity.meta.rootAggregateId = rootAggrId;
      entity.meta.rootAggregatePath = rootAggrPath;
    }
    const meta = entity.meta;
    meta.references = references || null;
    meta.values = values || null;
    meta.context = context || {};
  },
};
