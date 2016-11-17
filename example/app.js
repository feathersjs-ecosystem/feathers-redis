const feathers = require('feathers');
const rest = require('feathers-rest');
const socketio = require('feathers-socketio');
const handler = require('feathers-errors/handler');
const bodyParser = require('body-parser');
const Promise = require('bluebird');
const service = require('../lib');

// var to allow promisifyAll
var redis = require('redis');

const port = 3030;

const redisOptions = {
  // some example connection configuration options
  // url: 'redis://h:abc123@host.com:6379'
  // host: "pub-redis-12345.us-east-1-1.1.ec2.bigredis.blah"
  // host: 'host.com'
  // port: 6379,
  // password: 'abc123',
  db: 0, // the default, if set, redis will run select(db) on connect
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

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

// Connect to your Redis client instance(s)
var client = redis.createClient(redisOptions);

client.set('testkey', 'testvalue');
client.setAsync('asynckey', 'asyncvalue');

app.use('/messages', service({
  Model: client,
  paginate: {
    default: 2,
    max: 4
  },
  monitor: true,
  idPrefix: 'messages:',
  redisOptions: redisOptions
}));

// A basic error handler, just like Express
app.use(handler());

// Create a dummy Message
app.service('messages').create({
  _id: 'messages:1',
  text: 'message1: Oh hai!'
}).then(function () {
  console.log('Created message 1.');
  app.service('messages').get('messages:1').then(
    function (data) {
      console.dir(data);
    }
  );
})
.catch(function (err) {
  console.error('create 1 error: ' + err.message);
});

app.service('messages').create(
  [
    {
      text: 'message 2: hai2u2!'
    }, {
      _id: 'messages:mySpecialMessage',
      text: 'message 3: how r u?'
    }
  ]).then(function () {
    console.log('Created message 2 and 3.');
  })
  .catch(function (err) {
    console.error('create 2 error: ' + err.message);
  });

// Start the server
app.listen(port, function () {
  console.log(`Feathers server listening on port ${port}`);
});
