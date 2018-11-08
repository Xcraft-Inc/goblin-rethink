'use strict';

const _ = require('lodash');

function buildNestedFieldReql(path, reql) {
  const subfields = path.split('.');
  let nestedField = null;

  for (let subfield of subfields) {
    nestedField = !nestedField ? reql(subfield) : nestedField(subfield);
  }

  return nestedField;
}

function _constructFilterReql(entry, filterObj, filterRegex) {
  function _construct(_keys, _reql) {
    if (_keys.length === 0) {
      return _reql;
    } else {
      return _construct(
        _keys.slice(1),
        _reql.and(
          buildNestedFieldReql(_keys[0], entry).match(
            filterRegex(filterObj[_keys[0]])
          )
        )
      );
    }
  }

  const keys = Object.keys(filterObj);

  if (keys.length === 0) {
    return {};
  } else {
    return _construct(
      keys.slice(1),
      buildNestedFieldReql(keys[0], entry).match(
        filterRegex(filterObj[keys[0]])
      )
    );
  }
}

function _escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function buildFilterReql(filter, regex, escapeValues) {
  function _constructValidKeys(obj, path, validKeys) {
    if (!obj) {
      return;
    } else if (typeof obj === 'object') {
      Object.keys(obj).forEach(key =>
        _constructValidKeys(obj[key], `${path}.${key}`, validKeys)
      );
    } else {
      // primitive type
      validKeys[_.trimStart(path, '.')] = obj;
    }
  }

  const validKeys = {};
  _constructValidKeys(filter, '', validKeys);

  return entry =>
    _constructFilterReql(entry, validKeys, value =>
      regex(
        escapeValues === undefined || escapeValues === true
          ? _escapeRegExp(value)
          : value
      )
    );
}

function buildOrderByReql(key, dir, indexed) {
  const r = require('rethinkdb');
  const fieldReql = buildNestedFieldReql(key, r.row);

  if (indexed) {
    return {index: r[dir](fieldReql)};
  } else {
    return r[dir](fieldReql.downcase());
  }
}

module.exports = {
  buildNestedFieldReql: buildNestedFieldReql,
  buildFilterReql: buildFilterReql,
  buildOrderByReql: buildOrderByReql,
};
