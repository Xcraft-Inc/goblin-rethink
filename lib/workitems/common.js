const Goblin = require ('xcraft-core-goblin');

function isFunction (fn) {
  return typeof fn === 'function';
}

function isGenerator (fn) {
  return (
    fn &&
    isFunction (fn) &&
    fn.constructor &&
    fn.constructor.name === 'GeneratorFunction'
  );
}

const registerHinters = (goblinName, hinters) => {
  if (hinters) {
    Object.keys (hinters).forEach (h => {
      Goblin.registerQuest (goblinName, `change-${h}`, function (
        quest,
        newValue
      ) {
        const hinter = quest.use (`${h}-hinter`);
        hinter.search ({value: newValue});
      });

      if (hinters[h].onValidate) {
        Goblin.registerQuest (
          goblinName,
          `hinter-validate-${h}`,
          hinters[h].onValidate
        );
      }
    });
  }
};

const registerActions = (goblinName, actions) => {
  if (actions) {
    Object.keys (actions).forEach (a => {
      Goblin.registerQuest (goblinName, a, function (quest) {
        quest.do ();
      });
    });
  }
};

const registerQuests = (goblinName, quests) => {
  if (quests) {
    Object.keys (quests).forEach (q => {
      Goblin.registerQuest (goblinName, q, quests[q]);
    });
  }
};

const getReferenceArity = refExpr => {
  let arity = '';
  const match = refExpr.match (/.+\[(.+)+\]$/);
  if (match && match.length === 2) {
    arity = match[1];
  }
  switch (arity) {
    case '1':
    case '1-1':
    case '1..1':
      return '1..1';
    case '1-n':
    case '1..n':
      return '1..n';
    case '0-1':
    case '0..1':
      return '0..1';
    case '':
    case '0':
    case '0-n':
    case '0..n':
    default:
      return '0..n';
  }
};

const getReferenceType = refExpr => {
  return refExpr.match (/([^\[\]]+)(\[[^\]]*\])?$/)[1];
};

const referenceUseArity = refExpr => {
  return refExpr.match (/.+\[.*\]$/);
};

const getEntityQuest = function* (quest, entityId) {
  if (!entityId) {
    throw new Error ('Unable to get entity: ', entityId);
  }
  const i = quest.openInventory ();
  if (i.has (entityId)) {
    const entity = yield i.use (entityId).get ();
    return entity;
  }

  const entity = yield quest.warehouse.get ({path: entityId});
  if (entity) {
    return entity;
  } else {
    const i = quest.openInventory ();
    const r = i.useAny ('rethink');
    const type = entityId.split ('@')[0];
    const document = yield r.get ({table: type, documentId: entityId});
    if (!document) {
      throw new Error ('Unable to get entity: ', entityId);
    }
    return document;
  }
};

module.exports = {
  registerQuests,
  registerActions,
  registerHinters,
  isGenerator,
  isFunction,
  referenceUseArity,
  getReferenceArity,
  getReferenceType,
  getEntityQuest,
};
