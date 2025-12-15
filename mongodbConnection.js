const { MongoClient } = require('mongodb');
require('dotenv').config();

async function connectMongoDB() {
   const mongoClient = new MongoClient(process.env.MONGO_URI, {
    useUnifiedTopology: true,
  });
  await mongoClient.connect();
  console.log("✅ MongoDB connected");
}

module.exports = { connectMongoDB };