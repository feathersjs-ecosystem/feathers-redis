import Proto from 'uberproto';
import filter from 'feathers-query-filters';
import errors from 'feathers-errors';
import uuid from 'node-uuid';
import Promise from 'bluebird';
import { sorter, matcher, select, _ } from 'feathers-commons';
import errorHandler from './error-handler';

const DEFAULT_ID = 'id';  // callers can override in options, e.g. maybe '_id'

// Create the service.
class Service {
  constructor (options) {
    if (!options) {
      throw new Error('Redis options must be provided');
    }

    if (!options.Model) {
      throw new Error('Redis database `Model` must be provided');
    }

    this.Model = options.Model;
    this.id = options.id || DEFAULT_ID;
    this.idPrefix = options.idPrefix || null; // redis namespace
    this.autoPrefix = options.autoPrefix || false;
    this.events = options.events || [];
    this.paginate = options.paginate || {};
    this.useMonitor = options.monitor || false;
    this.debugLevel = options.debugLevel || 0;

    this.path = 'unknown';

    let _this = this;

    if (this.useMonitor) {
      this.Model.on('monitor', function (time, args, rawReply) {
        if (_this.useMonitor) {
          console.log(time + ': ' + args); // 1458910076.446514:['set', 'foo', 'bar']
        }
      });
    }
    this.Model.on('error', function (err) {
      console.error('Redis error: ' + err);
    });

    this.Model.on('connect', function () {
      if (_this.debugLevel >= 2) {
        console.log('monitor: connected to Redis');
      }
    });

    this.Model.on('end', function () {
      if (_this.debugLevel >= 2) {
        console.log('monitor: connection to Redis closed');
      }
    });

    this.Model.on('reconnecting', function () {
      if (_this.debugLevel >= 2) {
        console.warn('monitor: reconnecting to Redis');
      }
    });
  }

  extend (obj) {
    return Proto.extend(obj, this);
  }

  _pick (source, ...keys) {
    const result = {};
    for (let key of keys) {
      result[key] = source[key];
    }
    return result;
  }

  setup (app, path) {
    this.app = app;
    this.path = path;
    if (!this.idPrefix) {
      this.idPrefix = path + ':'; // e.g. 'todos:' for 'todos:123' IDs
    }
    console.log('setup: feathers-redis initialized for: ' + path);
  }

  _idToObject (id) {
    let result = { };
    result[this.id] = id;
    return result;
  }

  _newId () {
    var buffer = new Buffer(16);
    uuid.v4(null, buffer, 0);
    var id = uuid.unparse(buffer);
    if (this.autoPrefix && this.idPrefix) {
      if (!id.startsWith(this.idPrefix)) {
        id = this.idPrefix + id;
      }
    }
    return id;
  }

  _multiOptions (id, params) {
    let query = Object.assign({}, params.query);
    let options = Object.assign({ multi: true }, params.redis || params.options);

    if (id !== null) {
      options.multi = false;
      query[this.id] = id;
    }

    return { query, options };
  }

  _getSelect (select) {
    if (Array.isArray(select)) {
      var result = {};
      select.forEach(name => {
        result[name] = 1;
      });
      return result;
    }

    return select;
  }

  // We need to jump through hoops (or loops in this case) here
  // because Redis can return any number of results from 0 to
  // well beyond limit.  So we need to loop on promises in a
  // while loop until resolved. This function resursively call
  // scan, accumulating the results until the returned cursor is 0.
  _scanLoop (pattern, limit) {
    let required = limit;
    let _this = this;

    function scanFrom (cursor, pattern, limit, accum) {
      // build SCAN command args
      let args = [ cursor ];
      args.push('match', pattern);
      if (limit) {
        args.push('count', limit);
      }
      if (_this.debugLevel >= 1) {
        console.log('monitor: _scan:', args);
      }
      return Promise.try(function () {
        return _this.Model.scanAsync(args);
      })
      .then(data => {
        if (!data) {
          throw new errors.NotFound('Invalid data returned on id scan.');
        }
        let results = accum.concat(data[1]);
        if (results.length >= required) {
          if (results.length > required) {
            results = results.slice(0, required);
          }
          console.log('scanFrom complete1:', results);
          return results;
        }
        // Otherwise we need more data, so execute a SCAN "recursively"
        // (which isn't recursive if the calls are async).
        if (data[0]) {  // non-zero cursor?
          return Promise.try(
            // repeat the scan, but this time from the resulting cursor
            scanFrom(data[0], pattern, limit, results)
          ).then(function (recursiveData) {
            console.log('scanFrom complete2:', results, ' | ', recursiveData[1]);
            return results.concat(recursiveData[1]);
          });
        } else {
          // Done looping
          console.log('scanFrom complete3:', results);
          return results;
        }
      });
    }

    return scanFrom(0, pattern, limit, [ ]);
  }

  // This actually does the Redis SCAN query to return the IDs that match.
  _scan (query, limit) {
    // This only supports query by id (redis.scan).
    if (this.debugLevel >= 3) {
      console.log('monitor: _scan:', query);
    }
    let pattern = '*';

    for (let member in query) {
      // This only supports query by id (redis.scan).
      if (member === this.id) {
        pattern = query[this.id];
        if (pattern['$like']) {
          pattern = pattern['$like'].replace(/%/g, '*');
        }
      } else {
        throw new errors.AssertionError('_scan: redis query only supports id field');
      }
    }

    // query.id can be a pattern
    return this._scanLoop(pattern, limit);
  }

  _postFilter (data, filters) {
    const total = data.length;
    let values = data.filter(matcher(filters));

    if (filters.$sort) {
      values.sort(sorter(filters.$sort));
    }

    if (filters.$skip) {
      values = values.slice(filters.$skip);
    }

    if (filters.$limit) {
      values = values.slice(0, filters.$limit);
    }

    if (filters.$select) {
      values = values.map(value => this._pick(values, filters.$select));
    }

    return {
      total,
      limit: filters.$limit,
      skip: filters.$skip || 0,
      data: values
    };
  }

  _find (params, count, getFilter = filter) {
    // Start with finding all, and limit when necessary.
    let {filters, query} = getFilter(params.query || {});
    return this._scan(query, filters.$limit)
    .then(data => {
      console.log('_find: scan result: cursor at', data.cursor, data.keys);
      let allKeys = data.keys.map(key => {
        return this._idToObject(key);
      });

      // It may be that only the ID was specified.
      let resultsQuery = _.omit(query, this.id);
      if (resultsQuery.length === 0) {
        return { };
      }

      // return the filtered key list
      return allKeys.filter(matcher(resultsQuery));
    })
    .then(data => {
      // get the full records for the matching keys
      return (data.length >= 1) ? this._get(data) : [ ];
    })
    .then(data => {
      let results = this._postFilter(data, filters);
      return Promise.resolve(results);
    })
    .catch(errorHandler);
  }

  find (params) {
    if (this.debugLevel >= 1) {
      console.log('monitor: find ', params);
    }

    const paginate = (params && typeof params.paginate !== 'undefined')
      ? params.paginate : this.paginate;
    const result = this._find(params, !!paginate.default,
      query => filter(query, paginate)
    );

    if (!paginate.default) {
      return result.then(page => page.data);
    }

    return result;
  }

  _get (id) {
    if (id === undefined) {
      console.trace('_get: id is undefined');
    }
    if (typeof id === 'object') {
      console.error('_get with object for id:', id);
    }
    return this.Model.getAsync(id)
    .then(data => {
      console.log('getAsync returned data =', data);
      if (!data) {
        throw new errors.NotFound(`No record found for id '${id}'`);
      }

      if (this.debugLevel >= 1) {
        console.log('monitor: get(', id, ') =', data);
      }
      return data;
    })
    .catch(errorHandler);
  }

  get (id, params) {
    return this._get(id, params);
  }

  _findOrGet (id, params) {
    if (!id) {
      return this._find(params).then(page => page.data);
    }

    return this._get(id, params);
  }

  create (data) {
    const setId = item => {
      const resource = Object.assign({}, item);

      // Generate a Redis ID if we use a custom id
      if (this.id !== DEFAULT_ID && typeof resource[this.id] === 'undefined') {
        resource[this.id] = this._newId();
      }
      if (!resource[this.id]) {
        resource[this.id] = this._newId();
      }
      return resource;
    };

    const createResource = item => {
      var resource = setId(item);
      var key = resource[this.id];
      var value = JSON.stringify(resource);

      if (this.debugLevel >= 1) {
        console.log('monitor: create(', key, ' =', value);
      }

      return this.Model
        .setAsync(key, value)
        .then(res => { if (res !== 'OK') { console.warn(res); } });
    };

    if (Array.isArray(data)) {
      return Promise.map(data, function (entry) {
        // Promise.map awaits for returned promises.
        return createResource(entry);
      });
    } else {
      return createResource(data);
    }
  }

  patch (id, data, params) {
    if (this.debugLevel >= 1) {
      console.log('monitor: patch(', id, ',', data);
    }

    return this._findOrGet(id, params)
    .then(function (items) {
      let patchData = [];
      if (Array.isArray(items)) {
        for (var x = 0; x < items.length; x++) {
          patchData.push(items[x].id, Object.assign({}, items[x], data));
        }
      } else {
        patchData.push(items.id, Object.assign({}, items, data));
      }

      // Run the query
      return this.Model
        .msetAsync(patchData)
        .then(() => this._findOrGet(id, params))
        .then(select(params, this.id));
    })
    .catch(errorHandler);
  }

  update (id, data, params) {
    if (this.debugLevel >= 1) {
      console.log('monitor: update(', id, ',', data);
    }

    if (Array.isArray(data) || id === null) {
      return Promise.reject('Not replacing multiple records. Did you mean `patch`?');
    }

    return this.Model
    .setAsync(id, data)
    .then(() => this._findOrGet(id))
    .then(select(params, this.id))
    .catch(errorHandler);
  }

  remove (id, params) {
    let _this = this;
    if (_this.debugLevel >= 1) {
      console.log('monitor: remove(', id, ',', params);
    }

    return this._findOrGet(id, params)
    .then(items => {
      _this.Model.delAsync(id)
      .then(() => items)
      .then(select(params, this.id));
    })
    .catch(errorHandler);
  }
}

export default function init (options) {
  return new Service(options);
}

init.Service = Service;
