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
  db: 1,
  id: '_id',
  autoPrefix: true, // enable ID/key prefix:
  // idPrefix: 'messages:', // this would be the default
  redisOptions: redisOptions
}));

app.use('/users', service({
  Model: client,
  paginate: {
    default: 2,
    max: 4
  },
  monitor: true,
  db: 1,
  id: '_id',
  autoPrefix: true, // enable ID/key prefix:
  idPrefix: 'people:',  // override default
  redisOptions: redisOptions
}));

// A basic error handler, just like Express
app.use(handler());

// Message 1 will have the specific numbered ID, 2 will be auto-generated (UUID), 3 will be special text.
const message1Id = 'messages:1';
const message3Id = 'messages:mySpecialMessage3';

// Create a dummy Message
app.service('messages').create({
  _id: message1Id,
  text: 'message1: Oh hai!'
}).then(function (data) {
  console.log('app: Created message 1: ', data);
  app.service('messages').find({_id: 'message1*'}).then(
    data => console.log('app: get returned:', data)
  );
})
.catch(function (err) {
  console.error('app: create 1 error: ' + err.message);
});

// Try a create passing an array.
app.service('messages').create(
  [
    {
      // this one has no id specified, custom or default
      text: 'message 2: hai2u2!'
    }, {
      // this one has a custom text ID
      _id: message3Id,
      text: 'message 3: how r u?'
    }
  ]).then(function (items) {
    console.log('app: created message 2 and 3:', items);

    app.service('messages').get(message3Id)
      .then(function (item) {
        console.log('app: get message 3 success: ', item);
      })
      .catch(function (err) {
        console.error('app: get message 3 failed: ', err);
      });

    app.service('messages').remove(message3Id)
      .then(function () {
        console.log('app: remove message 3 success.');
      })
      .catch(function (err) {
        console.error('app: remove message 3 failed: ', err);
      });
  })
  .catch(function (err) {
    console.error('app: create 2 or 3 error: ' + err.message);
  });

// Start the server
app.listen(port, function () {
  console.log(`app: Feathers server listening on port ${port}`);
});
