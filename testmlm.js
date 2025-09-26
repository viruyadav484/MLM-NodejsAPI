const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB, getDB } = require('./db');
const cron = require('node-cron'); // For scheduled tasks

const app = express();
app.use(express.json());

const PORT = 5009;
const JWT_SECRET = "testTree";
const COMPANY_ROOT = "COMPANY_ROOT"; // Root user ID representing the company

let db;

// Commission slabs based on group sales, likes, and personal sales
const commissionSlabs = [
{ groupSales: 5000, likes: 250, personalSales: 0, percentage: 5 },
{ groupSales: 10000, likes: 500, personalSales: 0, percentage: 10 },
{ groupSales: 20000, likes: 750, personalSales: 1000, percentage: 15 },
{ groupSales: 35000, likes: 1000, personalSales: 2000, percentage: 19 },
{ groupSales: 50000, likes: 1250, personalSales: 3000, percentage: 22 },
{ groupSales: 100000, likes: 1500, personalSales: 4000, percentage: 25 },
{ groupSales: 200000, likes: 2000, personalSales: 5000, percentage: 28 },
{ groupSales: 500000, likes: 2250, personalSales: 6000, percentage: 31 },
{ groupSales: 1000000, likes: 2500, personalSales: 7000, percentage: 34 },
{ groupSales: 2000000, likes: 2750, personalSales: 8000, percentage: 36 },
{ groupSales: 3500000, likes: 3000, personalSales: 9000, percentage: 38 },
{ groupSales: 5000000, likes: 3250, personalSales: 10000, percentage: 40 }
].reverse(); // Reverse to evaluate from highest to lowest slab

async function startServer() {
db = await connectDB();

// **User Signup with Placement Logic**
app.post('/signup', async (req, res) => {
const { name, email, password, referrerId, position } = req.body;
const hashedPassword = await bcrypt.hash(password, 10);
const userId = `MH28ABC${Math.floor(100 + Math.random() * 900)}`;

try {
// Insert new user with initial attributes
await db.exec(
`INSERT INTO User SET id=:id, name=:name, email=:email, password=:password, 
verified=false, enrollmentDate=sysdate(), enrolled=false, bankVerified=false, 
position=null, sales=0, groupSales=0, likes=0, personalSales=0, commission=0`,
{ params: { id: userId, name, email, password: hashedPassword } }
);

// Determine placement: non-referred users go under COMPANY_ROOT's left subtree
const preferredSide = position || 'left';
const effectiveReferrerId = referrerId || COMPANY_ROOT;
const placement = await findAvailablePosition(effectiveReferrerId, preferredSide);

if (!placement) {
return res.status(400).json({ message: "No available position found in the tree." });
}

// Create REFERRED_BY edge to link user to parent
await db.exec(
`CREATE EDGE REFERRED_BY FROM (SELECT FROM User WHERE id=:id) 
TO (SELECT FROM User WHERE id=:parentId)`,
{ params: { id: userId, parentId: placement.parentId } }
);

// Update user's position
await db.exec(
`UPDATE User SET position=:pos WHERE id=:id`,
{ params: { id: userId, pos: placement.side } }
);

res.json({ message: "User created successfully", userId });
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// **Find Available Position in Binary Tree**
/**
* Places a new user in the tree based on preferredSide:
* - 'right': Places as referrer's right child if empty; otherwise, searches right subtree for first empty left position.
* - 'left' or unspecified: Places as referrer's left child if empty; otherwise, searches left subtree for first empty left position.
*/
async function findAvailablePosition(referrerId, preferredSide) {
let startUserId;
if (preferredSide === 'right') {
const rightChild = await getChild(referrerId, 'right');
if (!rightChild) {
return { parentId: referrerId, side: 'right' };
} else {
startUserId = rightChild.id;
}
} else { // 'left' or no side specified
const leftChild = await getChild(referrerId, 'left');
if (!leftChild) {
return { parentId: referrerId, side: 'left' };
} else {
startUserId = leftChild.id;
}
}

// BFS to find first user with no left child in the specified subtree
let queue = [startUserId];
while (queue.length > 0) {
let currentId = queue.shift();
const leftChild = await getChild(currentId, 'left');
if (!leftChild) {
return { parentId: currentId, side: 'left' };
}
if (leftChild) queue.push(leftChild.id);
const rightChild = await getChild(currentId, 'right');
if (rightChild) queue.push(rightChild.id);
}
return null; // No available position found
}

// **Helper: Get Child on Specific Side**
async function getChild(parentId, side) {
const children = await db.exec(
`SELECT id FROM User WHERE id IN (SELECT expand(in("REFERRED_BY")) 
FROM User WHERE id=:parentId) AND position=:side`,
{ params: { parentId, side } }
);
return children[0] || null;
}

// **User Login**
app.post('/login', async (req, res) => {
const { email, password } = req.body;
try {
const user = await db.exec(
`SELECT * FROM User WHERE email = :email LIMIT 1`,
{ params: { email } }
);
if (!user.length) return res.status(404).json({ message: "User not found" });
const isMatch = await bcrypt.compare(password, user[0].password);
if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });
const token = jwt.sign({ id: user[0].id }, JWT_SECRET, { expiresIn: '1h' });
res.json({ token, user: user[0] });
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// **Enroll User in Networking**
app.post('/enroll', async (req, res) => {
const { userId } = req.body;
try {
// Simplified: assumes payment is handled externally
await db.exec(
`UPDATE User SET enrolled=true WHERE id=:userId`,
{ params: { userId } }
);
res.json({ message: "User enrolled successfully" });
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// **Admin Verify User Bank and ID**
app.post('/admin/verify-user', async (req, res) => {
const { userId } = req.body;
// Note: Admin authentication should be added in a production environment
try {
await db.exec(
`UPDATE User SET bankVerified=true WHERE id=:userId`,
{ params: { userId } }
);
res.json({ message: "User verified successfully" });
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// **Purchase Coins with Sales Update and Time Restriction**
app.post('/purchase-coins', async (req, res) => {
const { userId, amount } = req.body;
const currentTime = new Date();
const day = currentTime.getDay(); // 0 = Sunday, 6 = Saturday
const hours = currentTime.getHours();
const minutes = currentTime.getMinutes();

// Restrict purchases from Saturday 11:55 PM to Sunday 12:15 AM
if ((day === 6 && hours >= 23 && minutes >= 55) ||
(day === 0 && (hours === 0 && minutes < 15))) {
return res.status(403).json({ message: "Coin purchases are restricted during this time" });
}

try {
// Update user's personal sales
await db.exec(
`UPDATE User SET personalSales = personalSales + :amount WHERE id=:userId`,
{ params: { userId, amount } }
);

// Update group sales for user and uplines
let currentId = userId;
while (true) {
await db.exec(
`UPDATE User SET groupSales = groupSales + :amount WHERE id=:currentId`,
{ params: { currentId, amount } }
);
const upline = await getUpline(currentId);
if (!upline) break;
currentId = upline.id;
}
res.json({ message: "Coin purchase successful" });
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// **Helper: Get Upline (Direct Referrer)**
async function getUpline(userId) {
const result = await db.exec(
`SELECT expand(out("REFERRED_BY")) FROM User WHERE id=:userId`,
{ params: { userId } }
);
return result[0] || null;
}

// **Calculate Commissions Bottom-Up**
app.post('/calculate-commissions', async (req, res) => {
try {
await calculateCommission(COMPANY_ROOT);
res.json({ message: "Commission calculation completed" });
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// **Recursive Commission Calculation**
async function calculateCommission(userId) {
const user = await db.exec(
`SELECT * FROM User WHERE id=:userId`,
{ params: { userId } }
);
if (!user[0] || !user[0].enrolled || !user[0].bankVerified) return 0;

// Get direct downlines
const downlines = await db.exec(
`SELECT id FROM User WHERE id IN (SELECT expand(in("REFERRED_BY")) 
FROM User WHERE id=:userId)`,
{ params: { userId } }
);

let downlineCommissions = [];
for (let downline of downlines) {
const downlineCommission = await calculateCommission(downline.id);
downlineCommissions.push(downlineCommission);
}

// Determine applicable slab
const slab = determineSlab(user[0].groupSales, user[0].likes, user[0].personalSales);
if (!slab) return 0;

// Calculate commission: (percentage * groupSales) - (sum of two downline commissions)
let commission = (slab.percentage / 100) * user[0].groupSales;
if (downlineCommissions.length >= 2) {
commission -= (downlineCommissions[0] + downlineCommissions[1]);
} else if (downlineCommissions.length === 1) {
commission -= downlineCommissions[0];
}
commission = Math.max(0, commission); // Ensure non-negative commission

// Update user's commission
await db.exec(
`UPDATE User SET commission = :commission WHERE id=:userId`,
{ params: { userId, commission } }
);

return commission;
}

// **Determine Slab Based on Metrics**
function determineSlab(groupSales, likes, personalSales) {
for (let slab of commissionSlabs) {
if (groupSales >= slab.groupSales && likes >= slab.likes && personalSales >= slab.personalSales) {
return slab;
}
}
return null;
}

// **Weekly Reset of Metrics**
cron.schedule('0 0 * * 0', async () => { // Runs every Sunday at midnight
await db.exec(
`UPDATE User SET groupSales=0, likes=0, personalSales=0, commission=0`
);
console.log('Weekly reset completed');
});

// **Start Server**
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

// **Initialize Server**
startServer().catch((err) => {
console.error("❌ Error starting server:", err);
});
