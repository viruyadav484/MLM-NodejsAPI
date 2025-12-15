const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectOrientDB, getDB } = require('./orientdbConnection');
const { connectMongoDB } = require('./mongodbConnection');
const { connectRedis } = require('./redisConnection');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
const PORT = process.env.PORT || 5009;

let db;
let mongoClient;
let redis;

async function startServer() {
  db = await connectOrientDB();
  mongoClient = await connectMongoDB();
  redis = await connectRedis();

  // ------------------ SIGNUP ------------------
  app.post('/signup', async (req, res) => {
    const { name, email, mobile, referrerId, position } = req.body;
    let {refferalCode} = req.body;
    refferalCode = refferalCode || generateUserId()
    try {
      // STEP 1 — check Redis cache first
      const cachedUser = await redis.get(`user:${email}:${mobile}`);
      if (cachedUser) {
        return res.status(400).json({ message: 'User already exists (cached)' });
      }

      // STEP 2 — DB duplicate check
      const existingUser = await db.exec(
        `SELECT FROM User WHERE mobile = :mobile OR email = :email`,
        { params: { mobile, email } }
      );
      if (existingUser.length > 0) {
        await redis.set(`user:${email}:${mobile}`, JSON.stringify(existingUser[0]), 'EX', 60 * 10); // cache 10 mins
        return res.status(400).json({ message: 'User already exists' });
      }

      // STEP 3 — Root user check
      const rootUser = await db.exec(`SELECT FROM User WHERE position = 'root' LIMIT 1`);
      if (rootUser.length === 0) {
        const root = await db.exec(
          `INSERT INTO User SET name=:name, email=:email, mobile=:mobile, userId=:userId, position='root', parent=null`,
          { params: { name, email, mobile, userId: refferalCode } }
        );

        // Clear related caches
        await redis.del('userTree:root');
        return res.status(201).json({ message: 'Root user created', user: root[0] });
      }

      let parentId = null;
      let childPosition = 'left';

      // STEP 4 — Placement logic
      if (!referrerId && !position) {
        parentId = await findFirstAvailableSlot(rootUser[0]['@rid']);
      } else if (!referrerId && position) {
        parentId = await findFirstAvailableSlot(rootUser[0]['@rid']);
        childPosition = position.toLowerCase() === 'right' ? 'right' : 'left';
      } else if (referrerId) {
        const ref = await db.exec(`SELECT FROM User WHERE userId=:id`, { params: { id: referrerId } });
        if (ref.length === 0) return res.status(400).json({ message: 'Invalid referrer ID' });
        const refUser = ref[0];

        if (!position) {
          parentId = await findFirstAvailableSlot(refUser['@rid']);
        } else if (position.toLowerCase() === 'left') {
          const leftChild = await db.exec(
            `SELECT FROM User WHERE parent=:pid AND position='left' LIMIT 1`,
            { params: { pid: refUser['@rid'] } }
          );
          if (leftChild.length === 0) {
            parentId = refUser['@rid'];
          } else {
            parentId = await findFirstAvailableSlot(leftChild[0]['@rid']);
          }
        } else if (position.toLowerCase() === 'right') {
          const rightChild = await db.exec(
            `SELECT FROM User WHERE parent=:pid AND position='right' LIMIT 1`,
            { params: { pid: refUser['@rid'] } }
          );
          if (rightChild.length === 0) {
            parentId = refUser['@rid'];
            childPosition = 'right';
          } else {
            parentId = await findFirstAvailableSlot(rightChild[0]['@rid']);
          }
        }
      }

      if (!parentId) {
        return res.status(400).json({ message: 'No available placement found' });
      }

      // STEP 5 — Insert user
      const newUser = await db.exec(
        `INSERT INTO User SET name=:name, email=:email, mobile=:mobile, userId=:userId, parent=:parent, position=:pos`,
        {
          params: {
            name,
            email,
            mobile,
            userId: refferalCode,
            parent: parentId,
            pos: childPosition,
          },
        }
      );

      // Clear or update relevant cache
      await redis.del(`userTree:${referrerId}`);
      await redis.del('userTree:root');

      res.status(201).json({
        message: 'User placed successfully',
        user: newUser[0],
      });
    } catch (err) {
      console.error('Signup error:', err);
      res.status(500).json({ message: 'Internal server error', error: err.message });
    }
  });

  // ------------------ CACHED USER TREE ------------------
  app.get('/user/tree/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      // 1️⃣ Try Redis cache first
      const cacheKey = `userTree:${userId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.status(200).json({ message: 'User tree (cached)', tree: JSON.parse(cached) });
      }

      // 2️⃣ Otherwise query OrientDB
      const user = await db.exec(`SELECT FROM User WHERE userId = :userId`, { params: { userId } });
      if (!user.length) return res.status(404).json({ message: 'User not found' });

      const tree = await buildUserTree(user[0]['@rid']);

      // 3️⃣ Cache result for 15 minutes
      await redis.set(cacheKey, JSON.stringify(tree), 'EX', 60 * 15);

      res.status(200).json({ message: 'User tree fetched', tree });
    } catch (error) {
      console.error('Error fetching user tree:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ------------------ Helper Functions ------------------
  async function findFirstAvailableSlot(startNodeRid) {
    const queue = [startNodeRid];
    while (queue.length > 0) {
      const current = queue.shift();
      const leftChild = await db.exec(
        `SELECT FROM User WHERE parent=:pid AND position='left' LIMIT 1`,
        { params: { pid: current } }
      );
      if (leftChild.length === 0) return current;
      const rightChild = await db.exec(
        `SELECT FROM User WHERE parent=:pid AND position='right' LIMIT 1`,
        { params: { pid: current } }
      );
      if (leftChild.length > 0) queue.push(leftChild[0]['@rid']);
      if (rightChild.length > 0) queue.push(rightChild[0]['@rid']);
    }
    return null;
  }

  function generateUserId() {
    return `MH28ABC${Math.floor(100 + Math.random() * 900)}`;
  }

  async function buildUserTree(userRid) {
    const userData = await db.exec(
      `SELECT @rid as rid, userId, name, email, mobile, position, referralCredits FROM User WHERE @rid = :rid`,
      { params: { rid: userRid } }
    );
    if (!userData.length) return null;
    const user = userData[0];

    const children = await db.exec(
      `SELECT @rid as rid, userId, name, position, referralCredits FROM User WHERE parent = :parentRid`,
      { params: { parentRid: user.rid } }
    );
    const leftChild = children.find(c => c.position === 'left') || null;
    const rightChild = children.find(c => c.position === 'right') || null;

    return {
      userId: user.userId,
      name: user.name,
      position: user.position,
      referralCredits: user.referralCredits || 0,
      left: leftChild ? await buildUserTree(leftChild.rid) : null,
      right: rightChild ? await buildUserTree(rightChild.rid) : null,
    };
  }


  // ------------------ CHECK REFERRAL ID VALID OR NOT ------------------
app.get('/checkReferral/:referralId', async (req, res) => {
  let { referralId } = req.params;
 console.log("-------------------referralId--------------------",referralId)
  try {
    if (!referralId) {
      return res.status(400).json({ message: "Referral ID is required" });
    }

    let position = '';
    let cleanId = referralId;
 console.log("-------------------cleanId--------------------",cleanId)
    // CASE: Referral ID in format: MH01AAA001-L  OR  9000090000-R
    if (referralId.includes('-')) {
      const parts = referralId.split('-');
      cleanId = parts[0];
      const pos = parts[1]?.toUpperCase();

      if (pos === 'L') position = 'left';
      else if (pos === 'R') position = 'right';
      else position = '';  // invalid (not L or R)
    }
 console.log("-------------------3--------------------")
    // ---------- 1️⃣ Check Redis Cache ----------
    const cached = await redis.get(`referral:${cleanId}`);
    if (cached) {
      return res.status(200).json({
        message: "Referral checked (cached)",
        valid: JSON.parse(cached).valid,
        referralId: cleanId,
        position
      });
    }
console.log("-------------------4--------------------")
    // ---------- 2️⃣ Check in OrientDB ----------
    const result = await db.exec(
      `SELECT FROM User WHERE userId = :uid LIMIT 1`,
      { params: { uid: cleanId } }
    );

    const isValid = result.length > 0;
console.log("-------------------5--------------------")
    // ---------- 3️⃣ Store result in cache (10 min) ----------
    await redis.set(
      `referral:${cleanId}`,
      JSON.stringify({ valid: isValid }),
      'EX',
      60 * 10
    );
console.log("-------------------6--------------------")
    return res.status(200).json({
      message: "Referral checked",
      valid: isValid,
      referralId: cleanId,
      position
    });

  } catch (err) {
    console.error("Referral check error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});


// ------------------ USER UPLINE + DOWNLINE UPTO 5 LEVELS ------------------
app.get('/user/network/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const cacheKey = `userNetwork:${userId}`;

    // 1️⃣ Check Cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        message: "User network (cached)",
        data: JSON.parse(cached),
      });
    }

    // 2️⃣ Fetch User RID
    const user = await db.exec(
      `SELECT FROM User WHERE userId = :uid LIMIT 1`,
      { params: { uid: userId } }
    );

    if (!user.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const userRID = user[0]['@rid'];

    // -------------------------------
    // 🔼 3️⃣ FETCH UPLINE (5 parents)
    // -------------------------------
    const uplineQuery = `
      SELECT 
        out('Parent')[0] as level1,
        out('Parent')[0].out('Parent')[0] as level2,
        out('Parent')[0].out('Parent')[0].out('Parent')[0] as level3,
        out('Parent')[0].out('Parent')[0].out('Parent')[0].out('Parent')[0] as level4,
        out('Parent')[0].out('Parent')[0].out('Parent')[0].out('Parent')[0].out('Parent')[0] as level5
      FROM ${userRID}
    `;

    const uplineRaw = await db.exec(uplineQuery);

    const upline = Object.values(uplineRaw[0]).filter(x => x); // remove null


    // ----------------------------------
    // 🔽 4️⃣ FETCH DOWNLINE (5 levels)
    // ----------------------------------

    // Helper: Fetch Children of a node
    async function getChildren(rid) {
      return await db.exec(
        `SELECT expand( in('Parent') ) FROM ${rid}`
      );
    }

    const level1 = await getChildren(userRID);

    let level2 = [];
    for (const u of level1) {
      level2.push(...await getChildren(u['@rid']));
    }

    let level3 = [];
    for (const u of level2) {
      level3.push(...await getChildren(u['@rid']));
    }

    let level4 = [];
    for (const u of level3) {
      level4.push(...await getChildren(u['@rid']));
    }

    let level5 = [];
    for (const u of level4) {
      level5.push(...await getChildren(u['@rid']));
    }

    // Combine downline
    const combinedDownline = [
      ...level1,
      ...level2,
      ...level3,
      ...level4,
      ...level5,
    ];


    // 🔥 Final Response
    const finalData = {
      user: user[0],
      upline,
      downline: {
        level1,
        level2,
        level3,
        level4,
        level5,
        combined: combinedDownline,
      }
    };

    // Cache 15 minutes
    await redis.set(cacheKey, JSON.stringify(finalData), "EX", 60 * 15);

    return res.status(200).json({
      message: "User network (5-level) fetched",
      data: finalData,
    });

  } catch (error) {
    console.error("Network fetch error:", error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});



  // Basic health
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

startServer().catch((err) => console.error('❌ Error starting server:', err));
