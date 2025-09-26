


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

 app.post('/signup', async (req, res) => {
    const { name, email, password, referrerId, position } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        // Generate Unique User ID
        const userId = `MH28ABC${Math.floor(100 + Math.random() * 900)}`;

        // Check if there are existing users (First user becomes root)
        const rootUser = await db.exec(`SELECT id FROM User LIMIT 1`);

        if (!rootUser.length) {
            // No users exist, make this user the root
            await db.exec(
                `INSERT INTO User SET id=:id, name=:name, email=:email, password=:password, 
                verified=false, enrollmentDate=sysdate(), enrolled=false, bankVerified=false, position='root'`,
                { params: { id: userId, name, email, password: hashedPassword } }
            );
            return res.json({ message: "First user created as root", userId });
        }

        // **Placement Logic**
        if (referrerId) {
            const placement = await findAvailablePosition(referrerId, position);

            if (!placement) {
                return res.status(400).json({ message: "No available position found in the tree." });
            }

            // Insert the new user with assigned position
            await db.exec(
                `INSERT INTO User SET id=:id, name=:name, email=:email, password=:password, 
                verified=false, enrollmentDate=sysdate(), enrolled=false, bankVerified=false, position=:pos`,
                { params: { id: userId, name, email, password: hashedPassword, pos: placement.side } }
            );

            // Create Edge (Link user to their referrer in the tree)
            await db.exec(
                `CREATE EDGE REFERRED_BY FROM (SELECT FROM User WHERE id=:id) TO (SELECT FROM User WHERE id=:parentId)`,
                { params: { id: userId, parentId: placement.parentId } }
            );

            // **Give referral credits** to the referrer and their upline
            await giveReferralCredits(placement.parentId);
        }

        res.json({ message: "User created successfully", userId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Finds the first available position in a **strict binary tree**:
 * - **Left-first priority** unless user specifies a position.
 * - **If both left & right are full**, finds the next available leftmost spot.
 */
async function findAvailablePosition(referrerId, preferredSide) {
    let queue = [{ parentId: referrerId }];

    while (queue.length > 0) {
        let { parentId } = queue.shift();

        // Get current node's children
        const children = await db.exec(
            `SELECT id, position FROM User WHERE id IN 
            (SELECT expand(in("REFERRED_BY")) FROM User WHERE id=:id)`,
            { params: { id: parentId } }
        );

        let leftChild = children.find(child => child.position === 'left');
        let rightChild = children.find(child => child.position === 'right');

        // ✅ If preferred side is specified and available, place the user there
        if (preferredSide === 'left' && !leftChild) return { parentId, side: 'left' };
        if (preferredSide === 'right' && !rightChild) return { parentId, side: 'right' };

        // ✅ Default behavior: Try to place in left first, then right
        if (!leftChild) return { parentId, side: 'left' };
        if (!rightChild) return { parentId, side: 'right' };

        // ✅ Both sides are taken; enqueue children to search deeper (left first)
        queue.push({ parentId: leftChild.id });
        queue.push({ parentId: rightChild.id });
    }

    return null; // No available position found
}

/**
 * Gives referral credits to the referrer and their upline.
 */
async function giveReferralCredits(userId) {
    let currentUser = userId;
    let level = 1; // Track referral levels

    while (currentUser) {
        // Update referral credit for the current user
        await db.exec(
            `UPDATE User SET referralCredits = referralCredits + :credit WHERE id = :id`,
            { params: { id: currentUser, credit: level * 10 } } // Higher levels get fewer credits
        );

        // Get the referrer of this user (if any)
        const referrer = await db.exec(
            `SELECT id FROM User WHERE id IN 
            (SELECT expand(out("REFERRED_BY")) FROM User WHERE id=:id)`,
            { params: { id: currentUser } }
        );

        currentUser = referrer.length ? referrer[0].id : null;
        level++; // Increase the level for indirect referrers
    }
}


    // **User Login**
  app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
      console.log("🔍 Searching for user with email:", email);
  
      const user = await db.exec(
        `SELECT * FROM User WHERE email = :email LIMIT 1`,
        { params: { email } }
      );
  
      console.log("🛠 Query Result:", user);  // <-- Check what is returned
  
      if (!user.length) {
        console.log("❌ User not found in query result");
        return res.status(404).json({ message: "User not found" });
      }
  
      const isMatch = await bcrypt.compare(password, user[0].password);
      if (!isMatch) {
        console.log("❌ Password does not match");
        return res.status(400).json({ message: "Invalid credentials" });
      }
  
      const token = jwt.sign({ id: user[0].id }, JWT_SECRET, { expiresIn: '1h' });
  
      console.log("✅ Login successful for user:", user[0]);
      res.json({ token, user: user[0] });
  
    } catch (error) {
      console.error("❌ Error in login:", error.message);
      res.status(500).json({ error: error.message });
    }
  });


  // **Get Full Tree Structure**
  app.get('/user/:userId/tree', async (req, res) => {
    try {
    const { userId } = req.params;
    //   const result = await db.exec(`TRAVERSE in("REFERRED_BY") FROM (SELECT FROM User WHERE id=:id)`, { params: { id } });
    // Fetch the tree starting from the given userId
    const tree = await getTree(userId);
    if (!tree) {
        return res.status(404).json({ message: "User not found or no downline." });
    }
    res.json(tree);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });


  /**
 * Recursive function to fetch MLM tree.
 */
async function getTree(userId) {
    // Fetch user details
    const user = await db.exec(
        `SELECT id, name, email FROM User WHERE id=:id`,
        { params: { id: userId } }
    );

    if (!user.length) return null; // Return null if user not found

    // Fetch children (left & right users)
    const referrals = await db.exec(
        `SELECT expand(in("REFERRED_BY")) FROM User WHERE id=:id`,
        { params: { id: userId } }
    );
    // Recursively fetch downlines
    for (let referral of referrals) {
        // console.log("88888888888888888888888888888888",referral.id);
        const child = await getTree(referral.id);
        // console.log("child ---------------",child);
        referral.children = await getTree(referral.id);
    }

    return { 
        id: user[0].id, 
        name: user[0].name, 
        email: user[0].email, 
        position: user[0].position, 
        children: referrals 
    };

}
app.get('/user/commission/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // Fetch user tree
        const userTree = await getTree(userId);

        // Calculate commissions
        const commissions = calculateCommissions(userTree);

        res.json({ userId, commissions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function calculateCommissions(user) {
    let commissionData = {};

    function calculateForNode(node) {
        if (!node || !node.id) return 0; // Ensure node exists

        let commission = 0;
        let leftSales = 0;
        let rightSales = 0;

        // Ensure children is an array
        let children = Array.isArray(node.children) ? node.children : [];

        // Find left and right child
        let leftChild = children.find(child => child.position === "left");
        let rightChild = children.find(child => child.position === "right");

        // Recursively calculate sales for left & right children
        leftSales = leftChild ? calculateForNode(leftChild) : 0;
        rightSales = rightChild ? calculateForNode(rightChild) : 0;

        // **Binary Matching Bonus**: 10% of weaker leg sales
        let binaryBonus = Math.min(leftSales, rightSales) * 0.10;
        commission += binaryBonus;

        // **Direct Referral Bonus**: $5 per direct referral
        let directReferralBonus = children.length * 5;
        commission += directReferralBonus;

        // **Upline Bonus**: Earn 5% from total children's earnings
        let uplineBonus = children.reduce((sum, child) => sum + (commissionData[child.id]?.commission || 0) * 0.05, 0);
        commission += uplineBonus;

        // Store commission data (rounded to 2 decimal places)
        commissionData[node.id] = {
            name: node.name,
            email: node.email,
            commission: commission.toFixed(2)
        };

        return commission + leftSales + rightSales; // Total sales for upline calculations
    }

    calculateForNode(user);
    return { userId: user.id, commissions: commissionData };
}





// **Calculate Weekly Commissions**
app.post('/calculate-commissions', async (req, res) => {
    try {
        // Fetch all users with their group sales (including their own sales)
        const users = await db.exec(`
            SELECT id, sales, 
                (SELECT SUM(sales) FROM User WHERE IN("REFERRED_BY") CONTAINS id) AS downlineSales
            FROM User
        `);

        let commissionData = [];

        for (let user of users) {
            let { id, sales, downlineSales } = user;

            // Total group sales = User's own sales + Downline sales
            let groupSales = (sales || 0) + (downlineSales || 0);

            // Fetch direct referrals (downline)
            const downline = await db.exec(
                `SELECT id, sales FROM User WHERE IN("REFERRED_BY") CONTAINS :id`, 
                { params: { id } }
            );

            // Deduct only direct downline commissions (10% of their sales)
            let downlineCommission = downline.reduce((sum, u) => sum + (u.sales * 0.10), 0);

            // Commission Calculation: 10% of group sales minus downline commission
            let commission = (groupSales * 0.10) - downlineCommission;

            // Ensure commission is non-negative
            commission = Math.max(0, commission);

            // Apply bonuses
            let specialBonus = groupSales * 0.05;  // 5% special bonus
            let achieversBonus = groupSales * 0.05; // 5% achievers bonus
            let franchiseBonus = groupSales * 0.10; // 10% franchise bonus

            // Apply taxes
            let gst = commission * 0.18; // Example 18% GST
            let googleTax = commission * 0.10; // Example 10% Google commission

            let netCommission = commission + specialBonus + achieversBonus + franchiseBonus - (gst + googleTax);

            // Ensure minimum slab requirement is met, otherwise reset to zero
            if (netCommission < 100) {
                netCommission = 0;
            }

            // Store commission data for updating
            commissionData.push({ id, netCommission });
        }

        // Update user commissions in the database
        for (let data of commissionData) {
            await db.exec(`UPDATE User SET commission = :netCommission WHERE id = :id`, { params: data });
        }

        res.json({ message: "Commission calculation completed", commissionData });

    } catch (error) {
        console.error("❌ Error in commission calculation:", error.message);
        res.status(500).json({ error: error.message });
    }
});

    // **Get User's Upline (Direct Referrer)**
  app.get('/user/:id/upline', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.exec(`SELECT expand(out("REFERRED_BY")) FROM User WHERE id=:id`, { params: { id } });
      console.log("result---------------",result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // **Get User's Downline (Direct Referrals)**
  app.get('/user/:id/downline', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.exec(`SELECT expand(in("REFERRED_BY")) FROM User WHERE id=:id`, { params: { id } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // **Start Server**
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

// **Start the server only after connecting to DB**
startServer().catch((err) => {
  console.error("❌ Error starting server:", err);
});
