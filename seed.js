const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import models
const Admin = require('./models/Admin');
const Teacher = require('./models/Teacher');
const Student = require('./models/Student');
const Department = require('./models/Department');
const Semester = require('./models/Semester');
const Subject = require('./models/Subject');
const Allocation = require('./models/Allocation');
const Attendance = require('./models/Attendance');
const Grievance = require('./models/Grievance');

// Helper function to generate random date in the past 30 days
function getRandomDate(daysBack = 30) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Helper function to generate random time
function getRandomTime() {
  const hours = Math.floor(Math.random() * 12) + 8; // 8 AM to 7 PM
  const minutes = Math.floor(Math.random() * 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`;
}

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
    console.log('Connected to MongoDB');

    // Clear existing data
    await Admin.deleteMany({});
    await Teacher.deleteMany({});
    await Student.deleteMany({});
    await Department.deleteMany({});
    await Semester.deleteMany({});
    await Subject.deleteMany({});
    await Allocation.deleteMany({});
    await Attendance.deleteMany({});
    await Grievance.deleteMany({});

    console.log('Cleared existing data');

    // Create Admin
    const hashedAdminPassword = await bcrypt.hash('password', 10);
    const admin = new Admin({
      adminId: 'admin123',
      adminName: 'System Administrator',
      adminPassword: hashedAdminPassword,
      adminGender: 'Male',
      adminNumber: '1234567890',
      Teachers: [],
      Departments: [],
      Allocations: []
    });
    await admin.save();
    console.log('Created admin user');

    // Create Multiple Departments
    const departmentsData = [
      { name: 'Computer Science', description: 'Department of Computer Science and Engineering' },
      { name: 'Information Technology', description: 'Department of Information Technology' },
      { name: 'Electronics', description: 'Department of Electronics and Communication' },
      { name: 'Mechanical Engineering', description: 'Department of Mechanical Engineering' },
      { name: 'Civil Engineering', description: 'Department of Civil Engineering' }
    ];

    const departments = [];
    for (const deptData of departmentsData) {
      const department = new Department({
        name: deptData.name,
        description: deptData.description,
        createdBy: admin._id,
        semesters: []
      });
      await department.save();
      departments.push(department);
      admin.Departments.push(department._id);
    }
    console.log('Created departments');

    // Create Semesters for each department
    const semesters = [];
    for (const department of departments) {
      for (let semNum = 1; semNum <= 8; semNum++) {
        const semester = new Semester({
          semesterNumber: semNum,
          academicYear: semNum <= 4 ? 2023 : 2024,
          departmentId: department._id,
          startMonth: semNum % 2 === 1 ? 'August' : 'January',
          endMonth: semNum % 2 === 1 ? 'December' : 'May',
          subjects: []
        });
        await semester.save();
        semesters.push(semester);
        department.semesters.push(semester._id);
      }
      await department.save();
    }
    console.log('Created semesters');

    // Create Subjects for each semester
    const subjectsData = {
      'Computer Science': [
        { name: 'Programming Fundamentals', code: 'CS101' },
        { name: 'Data Structures', code: 'CS201' },
        { name: 'Algorithms', code: 'CS202' },
        { name: 'Database Management', code: 'CS301' },
        { name: 'Web Development', code: 'CS302' },
        { name: 'Software Engineering', code: 'CS401' },
        { name: 'Machine Learning', code: 'CS402' },
        { name: 'Artificial Intelligence', code: 'CS501' }
      ],
      'Information Technology': [
        { name: 'IT Fundamentals', code: 'IT101' },
        { name: 'Network Security', code: 'IT201' },
        { name: 'System Administration', code: 'IT301' },
        { name: 'Cloud Computing', code: 'IT401' }
      ],
      'Electronics': [
        { name: 'Circuit Analysis', code: 'EC101' },
        { name: 'Digital Electronics', code: 'EC201' },
        { name: 'Microprocessors', code: 'EC301' },
        { name: 'Communication Systems', code: 'EC401' }
      ]
    };

    const allSubjects = [];
    for (const department of departments.slice(0, 3)) { // Only first 3 departments for subjects
      const deptSubjects = subjectsData[department.name] || [];
      for (let i = 0; i < deptSubjects.length; i++) {
        const subjectData = deptSubjects[i];
        const semesterIndex = Math.floor(i / 2); // 2 subjects per semester
        const semester = semesters.find(s => 
          s.departmentId.toString() === department._id.toString() && 
          s.semesterNumber === semesterIndex + 1
        );
        
        if (semester) {
          const subject = new Subject({
            name: subjectData.name,
            code: subjectData.code,
            departmentId: department._id,
            semesterId: semester._id
          });
          await subject.save();
          allSubjects.push(subject);
          semester.subjects.push(subject._id);
          await semester.save();
        }
      }
    }
    console.log('Created subjects');

    // Create Teachers
    const teachersData = [
      { name: 'Dr. John Smith', email: 'teacher@demo.com', gender: 'Male', number: '9876543210', dept: 'Computer Science' },
      { name: 'Prof. Sarah Johnson', email: 'sarah@demo.com', gender: 'Female', number: '9876543211', dept: 'Computer Science' },
      { name: 'Dr. Michael Brown', email: 'michael@demo.com', gender: 'Male', number: '9876543212', dept: 'Information Technology' },
      { name: 'Prof. Emily Davis', email: 'emily@demo.com', gender: 'Female', number: '9876543213', dept: 'Information Technology' },
      { name: 'Dr. Robert Wilson', email: 'robert@demo.com', gender: 'Male', number: '9876543214', dept: 'Electronics' },
      { name: 'Prof. Lisa Anderson', email: 'lisa@demo.com', gender: 'Female', number: '9876543215', dept: 'Electronics' },
      { name: 'Dr. James Taylor', email: 'james@demo.com', gender: 'Male', number: '9876543216', dept: 'Mechanical Engineering' },
      { name: 'Prof. Maria Garcia', email: 'maria@demo.com', gender: 'Female', number: '9876543217', dept: 'Civil Engineering' }
    ];

    const hashedTeacherPassword = await bcrypt.hash('password', 10);
    const teachers = [];
    for (const teacherData of teachersData) {
      const teacher = new Teacher({
        teacherName: teacherData.name,
        teacherEmail: teacherData.email,
        teacherPassword: hashedTeacherPassword,
        teacherGender: teacherData.gender,
        teacherNumber: teacherData.number,
        department: teacherData.dept,
        createdBy: admin._id
      });
      await teacher.save();
      teachers.push(teacher);
      admin.Teachers.push(teacher._id);
    }
    await admin.save();
    console.log('Created teachers');

    // Create Students
    const studentsData = [
      // Computer Science Students
      { name: 'Alice Johnson', studentId: 'CS2021001', email: 'student@demo.com', division: 'A', batch: 'B1', dept: 'Computer Science', sem: 5 },
      { name: 'Bob Wilson', studentId: 'CS2021002', email: 'bob@demo.com', division: 'A', batch: 'B1', dept: 'Computer Science', sem: 5 },
      { name: 'Carol Davis', studentId: 'CS2021003', email: 'carol@demo.com', division: 'A', batch: 'B2', dept: 'Computer Science', sem: 5 },
      { name: 'David Brown', studentId: 'CS2021004', email: 'david@demo.com', division: 'B', batch: 'B1', dept: 'Computer Science', sem: 5 },
      { name: 'Eva Martinez', studentId: 'CS2021005', email: 'eva@demo.com', division: 'B', batch: 'B2', dept: 'Computer Science', sem: 5 },
      { name: 'Frank Miller', studentId: 'CS2021006', email: 'frank@demo.com', division: 'A', batch: 'B1', dept: 'Computer Science', sem: 5 },
      { name: 'Grace Lee', studentId: 'CS2021007', email: 'grace@demo.com', division: 'A', batch: 'B2', dept: 'Computer Science', sem: 5 },
      { name: 'Henry Clark', studentId: 'CS2021008', email: 'henry@demo.com', division: 'B', batch: 'B1', dept: 'Computer Science', sem: 5 },
      { name: 'Ivy Rodriguez', studentId: 'CS2021009', email: 'ivy@demo.com', division: 'B', batch: 'B2', dept: 'Computer Science', sem: 5 },
      { name: 'Jack Thompson', studentId: 'CS2021010', email: 'jack@demo.com', division: 'A', batch: 'B1', dept: 'Computer Science', sem: 5 },
      
      // IT Students
      { name: 'Karen White', studentId: 'IT2021001', email: 'karen@demo.com', division: 'A', batch: 'B1', dept: 'Information Technology', sem: 3 },
      { name: 'Liam Harris', studentId: 'IT2021002', email: 'liam@demo.com', division: 'A', batch: 'B2', dept: 'Information Technology', sem: 3 },
      { name: 'Mia Lewis', studentId: 'IT2021003', email: 'mia@demo.com', division: 'B', batch: 'B1', dept: 'Information Technology', sem: 3 },
      { name: 'Noah Walker', studentId: 'IT2021004', email: 'noah@demo.com', division: 'B', batch: 'B2', dept: 'Information Technology', sem: 3 },
      { name: 'Olivia Hall', studentId: 'IT2021005', email: 'olivia@demo.com', division: 'A', batch: 'B1', dept: 'Information Technology', sem: 3 },
      
      // Electronics Students
      { name: 'Paul Allen', studentId: 'EC2021001', email: 'paul@demo.com', division: 'A', batch: 'B1', dept: 'Electronics', sem: 4 },
      { name: 'Quinn Young', studentId: 'EC2021002', email: 'quinn@demo.com', division: 'A', batch: 'B2', dept: 'Electronics', sem: 4 },
      { name: 'Rachel King', studentId: 'EC2021003', email: 'rachel@demo.com', division: 'B', batch: 'B1', dept: 'Electronics', sem: 4 },
      { name: 'Sam Wright', studentId: 'EC2021004', email: 'sam@demo.com', division: 'B', batch: 'B2', dept: 'Electronics', sem: 4 },
      { name: 'Tina Lopez', studentId: 'EC2021005', email: 'tina@demo.com', division: 'A', batch: 'B1', dept: 'Electronics', sem: 4 }
    ];

    const hashedStudentPassword = await bcrypt.hash('password', 10);
    const students = [];
    for (const studentData of studentsData) {
      const department = departments.find(d => d.name === studentData.dept);
      const semester = semesters.find(s => 
        s.departmentId.toString() === department._id.toString() && 
        s.semesterNumber === studentData.sem
      );
      
      const student = new Student({
        name: studentData.name,
        studentId: studentData.studentId,
        email: studentData.email,
        password: hashedStudentPassword,
        division: studentData.division,
        batch: studentData.batch,
        contactNumber: `98765432${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`,
        gender: Math.random() > 0.5 ? 'Male' : 'Female',
        attedanceRecord: [],
        departmentId: department._id,
        semesterId: semester._id
      });
      await student.save();
      students.push(student);
    }
    console.log('Created students');

    // Create Allocations
    const allocations = [];
    for (const subject of allSubjects) {
      const department = departments.find(d => d._id.toString() === subject.departmentId.toString());
      const deptTeachers = teachers.filter(t => t.department === department.name);
      const teacher = deptTeachers[Math.floor(Math.random() * deptTeachers.length)];
      
      if (teacher) {
        const subjectStudents = students.filter(s => 
          s.departmentId.toString() === subject.departmentId.toString() &&
          s.semesterId.toString() === subject.semesterId.toString()
        );

        // Create Theory allocation
        const theoryAllocation = new Allocation({
          subjectId: subject._id,
          teacherId: teacher._id,
          students: subjectStudents.map(s => s._id),
          type: 'Theory',
          division: 'A',
          batch: 'All',
          totalPlanned: 45,
          totalConducted: Math.floor(Math.random() * 35) + 25
        });
        await theoryAllocation.save();
        allocations.push(theoryAllocation);

        // Create Practical allocation (for some subjects)
        if (Math.random() > 0.4) {
          const practicalAllocation = new Allocation({
            subjectId: subject._id,
            teacherId: teacher._id,
            students: subjectStudents.map(s => s._id),
            type: 'Practical',
            division: 'A',
            batch: 'B1',
            totalPlanned: 30,
            totalConducted: Math.floor(Math.random() * 25) + 15
          });
          await practicalAllocation.save();
          allocations.push(practicalAllocation);
        }
      }
    }
    console.log('Created allocations');

    // Create Attendance Records
    const attendanceStatuses = ['Present', 'Absent', 'Late', 'Excused'];
    const attendanceRecords = [];
    
    for (const allocation of allocations) {
      const subject = allSubjects.find(s => s._id.toString() === allocation.subjectId.toString());
      const teacher = teachers.find(t => t._id.toString() === allocation.teacherId.toString());
      
      // Generate attendance for the past 30 days
      for (let day = 0; day < 30; day++) {
        // Random chance of having class on this day (70% chance)
        if (Math.random() > 0.3) {
          for (const studentId of allocation.students) {
            const student = students.find(s => s._id.toString() === studentId.toString());
            if (student) {
              // Generate attendance with realistic probabilities
              let status;
              const rand = Math.random();
              if (rand < 0.75) status = 'Present';      // 75% present
              else if (rand < 0.85) status = 'Late';    // 10% late
              else if (rand < 0.95) status = 'Absent';  // 10% absent
              else status = 'Excused';                  // 5% excused

              const attendance = new Attendance({
                studentId: student._id,
                subjectId: subject._id,
                status: status,
                type: allocation.type,
                recordedBy: teacher._id,
                createdAtDate: getRandomDate(30),
                createdAtTime: getRandomTime()
              });
              await attendance.save();
              attendanceRecords.push(attendance);
              student.attedanceRecord.push(attendance._id);
            }
          }
        }
      }
    }

    // Update students with attendance records
    for (const student of students) {
      await student.save();
    }
    console.log(`Created ${attendanceRecords.length} attendance records`);

    // Create Grievances
    const grievanceData = [
      {
        title: 'Attendance Discrepancy in Database Management',
        description: 'I was present in the Database Management class on 15th October, but it shows as absent in the system. I have witnesses who can confirm my presence.',
        status: 'Pending'
      },
      {
        title: 'Incorrect Late Marking',
        description: 'I was marked late for Web Development class, but I arrived on time. The teacher was running late that day and I was already seated when class started.',
        status: 'Under Review'
      },
      {
        title: 'Missing Attendance Record',
        description: 'My attendance for Software Engineering practical on 20th October is not recorded in the system. I attended the full session.',
        status: 'Resolved'
      },
      {
        title: 'System Error During Attendance',
        description: 'There was a technical issue during attendance marking for Machine Learning class. Several students including me were not marked present despite being in class.',
        status: 'Under Review'
      },
      {
        title: 'Medical Leave Not Updated',
        description: 'I had submitted medical certificate for my absence on 18th October, but it still shows as absent instead of excused.',
        status: 'Resolved'
      }
    ];

    for (let i = 0; i < grievanceData.length; i++) {
      const grievanceInfo = grievanceData[i];
      const randomStudent = students[Math.floor(Math.random() * students.length)];
      const randomSubject = allSubjects[Math.floor(Math.random() * allSubjects.length)];
      const randomTeacher = teachers[Math.floor(Math.random() * teachers.length)];

      const grievance = new Grievance({
        studentId: randomStudent._id,
        subjectId: randomSubject._id,
        title: grievanceInfo.title,
        description: grievanceInfo.description,
        attachments: [],
        status: grievanceInfo.status,
        response: grievanceInfo.status === 'Resolved' ? 'Your grievance has been reviewed and the attendance record has been updated accordingly.' : 
                 grievanceInfo.status === 'Under Review' ? 'We are currently investigating your grievance. You will be notified once resolved.' : undefined,
        reviewedBy: grievanceInfo.status !== 'Pending' ? randomTeacher._id : undefined,
        createdAt: getRandomDate(15),
        updatedAt: getRandomDate(5)
      });
      await grievance.save();
    }
    console.log('Created grievances');

    console.log('\n=== DEMO CREDENTIALS ===');
    console.log('Admin: admin123 / password');
    console.log('Teacher: teacher@demo.com / password (or any teacher email)');
    console.log('Student: student@demo.com / password (or any student email)');
    console.log('========================\n');

    console.log('📊 DATABASE STATISTICS:');
    console.log(`👥 Students: ${students.length}`);
    console.log(`👨‍🏫 Teachers: ${teachers.length}`);
    console.log(`🏢 Departments: ${departments.length}`);
    console.log(`📚 Subjects: ${allSubjects.length}`);
    console.log(`📋 Allocations: ${allocations.length}`);
    console.log(`✅ Attendance Records: ${attendanceRecords.length}`);
    console.log(`📝 Grievances: ${grievanceData.length}`);

    console.log('\nDatabase seeded successfully with comprehensive data!');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();