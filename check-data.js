const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/attendance_system', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const Department = require('./models/Department');
const Subject = require('./models/Subject');

async function checkData() {
  try {
    console.log('Checking departments...');
    const departments = await Department.find();
    console.log(`Found ${departments.length} departments:`);
    departments.forEach(dept => {
      console.log(`  - ${dept.name} (ID: ${dept._id})`);
    });

    console.log('\nChecking subjects...');
    const subjects = await Subject.find().populate('departmentId', 'name');
    console.log(`Found ${subjects.length} subjects:`);
    subjects.forEach(subj => {
      console.log(`  - ${subj.name} (${subj.code}) - Dept: ${subj.departmentId?.name || 'N/A'}`);
    });

    mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    mongoose.connection.close();
  }
}

checkData();
