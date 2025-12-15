const OrientDBClient = require("orientjs").OrientDBClient;
require('dotenv').config();
let db;

async function connectOrientDB() {
  const client = await OrientDBClient.connect({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
  });

  db = await client.session({
    name: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
  });

  console.log("✅ Connected to OrientDB!");
  return db;
}

module.exports = { connectOrientDB, getDB: () => db };