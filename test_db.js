const db = require('./backend/db');

async function test() {
  try {
    await db.initDB();
    console.log('DB initialized successfully');
    
    // Test getting dockets by phone
    const dockets = await db.getDocketsByPhone('7500272292');
    console.log('Dockets by phone:', dockets.length);
    
    // Test getting dockets by store
    const storeDockets = await db.getDocketsByStore('101');
    console.log('Dockets by store:', storeDockets.length);
    
    // Ping
    await db.ping();
    console.log('DB ping successful');
    
  } catch (e) {
    console.error('Test failed:', e.message);
  }
}

test();