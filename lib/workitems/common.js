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
  return refExpr.match (/.+\[(.+)+\]$/)[1];
};

const getReferenceType = refExpr => {
  return refExpr.match (/([^\[\]]+)(\[[^\]]*\])?$/)[1];
};

const referenceUseArity = refExpr => {
  return refExpr.match (/.+\[.*\]$/);
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
};
