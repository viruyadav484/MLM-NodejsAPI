const OrientDB = require('orientjs');
// require('dotenv').config();

// const server = OrientDB({
//   host: 'localhost',
//   port: 2424,
//   username: 'root',
//   password: 'Viru@7862',
// });

// const db = server.use('demodb');

// module.exports = db;


const OrientDBClient = require("orientjs").OrientDBClient;
// require("dotenv").config();

let db;

async function connectDB() {
  const client = await OrientDBClient.connect({
    host: 'localhost',
    port: 2424,
  });

  db = await client.session({
    name: 'demodb',
    username: 'root',
    password: 'Viru@7862',
  });

  console.log("✅ Connected to OrientDB!");
  return db;
}

module.exports = { connectDB, getDB: () => db };
