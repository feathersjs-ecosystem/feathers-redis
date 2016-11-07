const feathers = require('feathers');
const rest = require('feathers-rest');
const socketio = require('feathers-socketio');
const handler = require('feathers-errors/handler');
const bodyParser = require('body-parser');
const redis = require('redis');
const service = require('../lib');

const port = 3030;

const redisOptions = {
  // some example connection configuration options
  // url: 'redis://h:abc123@host.com:6379'
  // host: "pub-redis-12345.us-east-1-1.1.ec2.bigredis.blah"
  // host: 'host.com'
  // port: 6379,
  // password: 'abc123',
  host: 'localhost' // the default, so it could be left out
};

// Create a feathers instance.
const app = feathers()
// Enable Socket.io
.configure(socketio())
// Enable REST services
.configure(rest())
// Turn on JSON parser for REST services
.use(bodyParser.json())
// Turn on URL-encoded parser for REST services
.use(bodyParser.urlencoded({extended: true}));

const promise = new Promise(function (resolve) {
  // Connect to your Redis client instance(s)
  redis.createClient(redisOptions).then(function (db) {
    // Connect to the db, create and register a Feathers service.
    app.use('/messages', service({
      Model: db,
      paginate: {
        default: 2,
        max: 4
      }
    }));

    // A basic error handler, just like Express
    app.use(handler());

    // Create a dummy Message
    app.service('messages').create({
      text: 'Sample message: Oh hai!'
    }).then(function (message) {
      console.log('Created message', message);
    });

    // Start the server
    var server = app.listen(port);
    server.on('listening', function () {
      console.log('Feathers Message Redis service running on 127.0.0.1:3030');
      resolve(server);
    });
  }).catch(function (error) {
    console.error(error);
  });
});

module.exports = promise;
