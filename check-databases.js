const mongoose = require('mongoose');

async function checkDatabases() {
  try {
    // Connect to MongoDB without specifying database
    await mongoose.connect('mongodb://localhost:27017/', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    // List all databases
    const admin = mongoose.connection.db.admin();
    const { databases } = await admin.listDatabases();
    
    console.log('Available databases:');
    databases.forEach(db => {
      console.log(`  - ${db.name} (${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    });

    // Check both possible database names
    const dbNames = ['attendance-system', 'attendace-system'];
    
    for (const dbName of dbNames) {
      console.log(`\n=== Checking ${dbName} ===`);
      const db = mongoose.connection.client.db(dbName);
      
      const collections = await db.listCollections().toArray();
      console.log(`Collections: ${collections.map(c => c.name).join(', ')}`);
      
      if (collections.find(c => c.name === 'departments')) {
        const depts = await db.collection('departments').find().toArray();
        console.log(`Departments: ${depts.length}`);
        depts.forEach(d => console.log(`  - ${d.name}`));
      }
      
      if (collections.find(c => c.name === 'subjects')) {
        const subjects = await db.collection('subjects').find().toArray();
        console.log(`Subjects: ${subjects.length}`);
      }
    }

    mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    mongoose.connection.close();
  }
}

checkDatabases();
