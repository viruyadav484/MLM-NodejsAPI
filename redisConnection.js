const Redis = require('ioredis');
require('dotenv').config();

async function connectRedis() {
  const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  redis.on("connect", () => console.log("✅ Redis connected"));
  redis.on("error", (err) => console.error("Redis error:", err));
  return redis;
}

module.exports = { connectRedis };