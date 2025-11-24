const mongoose = require('mongoose');
const Department = require('./models/Department');
const Subject = require('./models/Subject');
const Semester = require('./models/Semester');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/attendance_system', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function seedData() {
  try {
    console.log('Starting database seeding...\n');

    // Check and Create Departments
    console.log('Checking departments...');
    let departments = await Department.find();
    
    if (departments.length === 0) {
      console.log('Creating departments...');
      departments = await Department.insertMany([
        { name: 'Computer Science', description: 'Computer Science and Engineering' },
        { name: 'Information Technology', description: 'Information Technology' },
        { name: 'Electronics', description: 'Electronics and Communication Engineering' },
        { name: 'Mechanical Engineering', description: 'Mechanical Engineering' },
        { name: 'Civil Engineering', description: 'Civil Engineering' }
      ]);
      console.log(`✓ Created ${departments.length} departments`);
    } else {
      console.log(`✓ Found ${departments.length} existing departments`);
    }

    // Get Computer Science department for creating subjects
    const csDept = departments.find(d => d.name === 'Computer Science');
    const itDept = departments.find(d => d.name === 'Information Technology');

    // Create Semesters for CS department
    console.log('\nCreating semesters...');
    const semesters = await Semester.insertMany([
      { departmentId: csDept._id, semesterNumber: 1, academicYear: 2024, startMonth: 'August', endMonth: 'December' },
      { departmentId: csDept._id, semesterNumber: 2, academicYear: 2025, startMonth: 'January', endMonth: 'May' },
      { departmentId: csDept._id, semesterNumber: 3, academicYear: 2024, startMonth: 'August', endMonth: 'December' },
      { departmentId: csDept._id, semesterNumber: 4, academicYear: 2025, startMonth: 'January', endMonth: 'May' },
      { departmentId: itDept._id, semesterNumber: 1, academicYear: 2024, startMonth: 'August', endMonth: 'December' },
      { departmentId: itDept._id, semesterNumber: 2, academicYear: 2025, startMonth: 'January', endMonth: 'May' },
    ]);
    console.log(`✓ Created ${semesters.length} semesters`);

    // Create Subjects for CS department
    console.log('\nCreating subjects...');
    const subjects = await Subject.insertMany([
      // Semester 1 - CS
      { name: 'Programming Fundamentals', code: 'CS101', departmentId: csDept._id, semesterId: semesters[0]._id },
      { name: 'Mathematics I', code: 'MATH101', departmentId: csDept._id, semesterId: semesters[0]._id },
      { name: 'Physics', code: 'PHY101', departmentId: csDept._id, semesterId: semesters[0]._id },
      
      // Semester 2 - CS
      { name: 'Data Structures', code: 'CS201', departmentId: csDept._id, semesterId: semesters[1]._id },
      { name: 'Database Management Systems', code: 'CS202', departmentId: csDept._id, semesterId: semesters[1]._id },
      { name: 'Mathematics II', code: 'MATH201', departmentId: csDept._id, semesterId: semesters[1]._id },
      
      // Semester 3 - CS
      { name: 'Operating Systems', code: 'CS301', departmentId: csDept._id, semesterId: semesters[2]._id },
      { name: 'Computer Networks', code: 'CS302', departmentId: csDept._id, semesterId: semesters[2]._id },
      { name: 'Software Engineering', code: 'CS303', departmentId: csDept._id, semesterId: semesters[2]._id },
      
      // Semester 4 - CS
      { name: 'Web Development', code: 'CS401', departmentId: csDept._id, semesterId: semesters[3]._id },
      { name: 'Machine Learning', code: 'CS402', departmentId: csDept._id, semesterId: semesters[3]._id },
      { name: 'Cloud Computing', code: 'CS403', departmentId: csDept._id, semesterId: semesters[3]._id },

      // IT Department
      { name: 'Web Technologies', code: 'IT101', departmentId: itDept._id, semesterId: semesters[4]._id },
      { name: 'Network Security', code: 'IT102', departmentId: itDept._id, semesterId: semesters[4]._id },
      { name: 'Mobile App Development', code: 'IT201', departmentId: itDept._id, semesterId: semesters[5]._id },
    ]);
    console.log(`✓ Created ${subjects.length} subjects`);

    console.log('\n✅ Database seeding completed successfully!');
    console.log('\nSummary:');
    console.log(`  - Departments: ${departments.length}`);
    console.log(`  - Semesters: ${semesters.length}`);
    console.log(`  - Subjects: ${subjects.length}`);

    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    mongoose.connection.close();
  }
}

seedData();
