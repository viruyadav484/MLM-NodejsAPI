


const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB, getDB } = require('./db');

const app = express();
app.use(express.json());

const PORT = 5009;
const JWT_SECRET = "testTree";

let db;

async function startServer() {
  db = await connectDB();

 /**
 * Signup Route - Places users in a binary tree based on referral & position.
 */
app.post('/signup', async (req, res) => {
  const { name, email, mobile, referrerId, position } = req.body;

  try {
    // const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `MH28ABC${Math.floor(100 + Math.random() * 900)}`;

    // Check if User class exists
    let userClass = await db.exec(`SELECT FROM (SELECT expand(classes) FROM metadata:schema) WHERE name = 'User'`);
    if (!userClass.length) {
      await db.exec(`CREATE CLASS User EXTENDS V`);
    }

    // Check if REFERRED_BY edge class exists
    let edgeClass = await db.exec(`SELECT FROM (SELECT expand(classes) FROM metadata:schema) WHERE name = 'REFERRED_BY'`);
    if (!edgeClass.length) {
      await db.exec(`CREATE CLASS REFERRED_BY EXTENDS E`);
    }

    // Check if root exists
    const rootUser = await db.exec(`SELECT id FROM User LIMIT 1`);

    if (!rootUser.length) {
      await db.exec(
        `INSERT INTO User SET id=:id, name=:name, email=:email, mobile=:mobile, 
        verified=false, enrollmentDate=sysdate(), enrolled=false, bankVerified=false, position='root', referralCredits=0`,
        { params: { id: userId, name, email, mobile } }
      );
      return res.json({ message: "First user created as root", userId });
    }

    let placement;
    let parentId;

    if (referrerId) {
      // Place under given referrer
      placement = await findAvailablePosition(referrerId, position);
      if (!placement) {
        return res.status(400).json({ message: "No available position found" });
      }
      parentId = placement.parentId;
    } else {
      // No referrer → place in first available LEFT spot under root
      placement = await findAvailablePosition(rootUser[0].id, "left");
      if (!placement) {
        return res.status(400).json({ message: "No available position found in tree" });
      }
      parentId = placement.parentId;
    }

    // Create new user
    await db.exec(
      `INSERT INTO User SET id=:id, name=:name, email=:email, mobile=:mobile, 
      verified=false, enrollmentDate=sysdate(), enrolled=false, bankVerified=false, position=:pos, referralCredits=0`,
      { params: { id: userId, name, email, mobile, pos: placement.side } }
    );

    // Create edge Parent -> Child
    await db.exec(
      `CREATE EDGE REFERRED_BY FROM (SELECT FROM User WHERE id=:parentId) TO (SELECT FROM User WHERE id=:id) 
      SET side=:pos`,
      { params: { id: userId, parentId, pos: placement.side } }
    );

    // Always give referral credits up the chain
    await giveReferralCredits(parentId);

    res.json({ message: "User created successfully", userId, placedUnder: parentId, side: placement.side });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Find first available position in binary tree using BFS.
 */
async function findAvailablePosition(referrerId, preferredSide) {
  let queue = [{ parentId: referrerId }];

  while (queue.length > 0) {
    let { parentId } = queue.shift();

    const children = await db.exec(
      `SELECT id, position FROM User WHERE id IN 
      (SELECT expand(out("REFERRED_BY")) FROM User WHERE id=:id)`,
      { params: { id: parentId } }
    );

    let leftChild = children.find(c => c.position === 'left');
    let rightChild = children.find(c => c.position === 'right');

    if (preferredSide === 'left' && !leftChild) return { parentId, side: 'left' };
    if (preferredSide === 'right' && !rightChild) return { parentId, side: 'right' };

    if (!leftChild) return { parentId, side: 'left' };
    if (!rightChild) return { parentId, side: 'right' };

    queue.push({ parentId: leftChild.id });
    queue.push({ parentId: rightChild.id });
  }
  return null;
}

/**
 * Give referral credits up the chain.
 */
async function giveReferralCredits(userId) {
  let currentUser = userId;
  let level = 1;

  while (currentUser) {
    await db.exec(
      `UPDATE User SET referralCredits = referralCredits + :credit WHERE id=:id`,
      { params: { id: currentUser, credit: Math.max(10 - (level - 1) * 2, 1) } } // decreasing reward
    );

    const referrer = await db.exec(
      `SELECT id FROM User WHERE id IN 
      (SELECT expand(in("REFERRED_BY")) FROM User WHERE id=:id)`,
      { params: { id: currentUser } }
    );

    currentUser = referrer.length ? referrer[0].id : null;
    level++;
  }
}


app.get('/user/tree/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
      // Get user details
      const user = await db.exec(
          `SELECT id, name, position FROM User WHERE id=:id`, 
          { params: { id: userId } }
      );

      if (!user.length) {
          return res.status(404).json({ message: "User not found." });
      }
     console.log("userId--------------",userId);
      // Build tree recursively
      const tree = await buildUserTree(userId);
      res.json({ tree });
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

/**
* Recursively fetches user tree structure.
*/
async function buildUserTree(userId) {
  // Fetch the current user's details
  const user = await db.exec(
      `SELECT id, name, position FROM User WHERE id=:id`, 
      { params: { id: userId } }
  );

  if (!user.length) return null;

  // Fetch children (LEFT & RIGHT)
  const children = await db.exec(
      `SELECT expand(out("REFERRED_BY")) FROM User WHERE id=:id`, // Ensuring correct direction
      { params: { id: userId } }
  );

  console.log(`User: ${user[0].name} (ID: ${user[0].id}) has children:`, children); // Debugging

  let leftChild = children.find(child => child.position === 'left') || null;
  let rightChild = children.find(child => child.position === 'right') || null;

  return {
      id: user[0].id,
      name: user[0].name,
      position: user[0].position,
      left: leftChild ? await buildUserTree(leftChild.id) : null,
      right: rightChild ? await buildUserTree(rightChild.id) : null
  };
}

  // **Start Server**
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

// **Start the server only after connecting to DB**
startServer().catch((err) => {
  console.error("❌ Error starting server:", err);
});
