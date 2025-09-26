const db = require('./db');

async function createUser(id, name, email) {
  const result = await db.command(
    `INSERT INTO User SET id = :id, name = :name, email = :email, verified = false, enrollmentDate = sysdate()`, 
    { params: { id, name, email } }
  ).one();
  return result;
}

async function addReferral(parentId, childId) {
    await db.command(
      `CREATE EDGE REFERRED_BY FROM (SELECT FROM User WHERE id = :childId) 
       TO (SELECT FROM User WHERE id = :parentId)`, 
      { params: { parentId, childId } }
    ).one();
  }

  async function getUserWithUpline(userId) {
    const result = await db.query(
      `SELECT expand(out("REFERRED_BY")) FROM User WHERE id = :userId`, 
      { params: { userId } }
    );
    return result;
  }
  

  async function getUserWithDownline(userId) {
    const result = await db.query(
      `SELECT expand(in("REFERRED_BY")) FROM User WHERE id = :userId`, 
      { params: { userId } }
    );
    return result;
  }

  async function findAvailablePlacement(referrerId) {
    const result = await db.query(
      `SELECT id FROM User WHERE id = :referrerId AND 
      (SELECT count(*) FROM (TRAVERSE out("REFERRED_BY") FROM User WHERE id = :referrerId) LIMIT 2) < 2`,
      { params: { referrerId } }
    );
    return result.length ? referrerId : null;
  }
  
  async function autoPlaceUser(newUserId, referrerId = null) {
    let parent = referrerId ? await findAvailablePlacement(referrerId) : 'company-root-id';
    
    if (parent) {
      await addReferral(parent, newUserId);
      console.log(`User ${newUserId} placed under ${parent}`);
    } else {
      console.log("No available position found.");
    }
  }
  
  
  module.exports = { createUser, addReferral };
  
