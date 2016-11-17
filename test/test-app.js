const feathers = require('feathers');
const rest = require('feathers-rest');
const socketio = require('feathers-socketio');
const bodyParser = require('body-parser');
const redis = require('redis');
const Promise = require('bluebird');
const service = require('../lib');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

// Connect to the db, create and register a Feathers service.
const db = redis.createClient();

// Redis ids do not seem to be generated sequentially but sorted lexigraphically
// if no other sort order is given. This means that items can not be returned in the
// same order they have been created so this counter is used for sorting instead.
let counter = 0;

const todoService = service({
  Model: db,
  paginate: {
    default: 2,
    max: 4
  }
}).extend({
  find (params) {
    params.query = params.query || {};
    if (!params.query.$sort) {
      params.query.$sort = { counter: 1 };
    }

    return this._super(params);
  },

  create (data, params) {
    data.counter = ++counter;
    return this._super(data, params);
  }
});

// Create a feathers instance.
var app = feathers()
  // Enable REST services
  .configure(rest())
  // Enable Socket.io services
  .configure(socketio())
  // Turn on JSON parser for REST services
  .use(bodyParser.json())
  // Turn on URL-encoded parser for REST services
  .use(bodyParser.urlencoded({extended: true}))
  .use('/todos', todoService);

// Start the server.
const port = 3030;

module.exports = app.listen(port);
