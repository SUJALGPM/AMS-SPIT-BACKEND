const mongoose = require('mongoose');
require('dotenv').config();

// Import all models
const Student = require('./models/Student');
const Subject = require('./models/Subject');
const Teacher = require('./models/Teacher');
const Department = require('./models/Department');
const Semester = require('./models/Semester');
const Attendance = require('./models/Attendance');

// Helper functions
function getRandomDate(daysBack = 30) {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getRandomTime() {
  const hours = Math.floor(Math.random() * 8) + 9;
  const minutes = Math.floor(Math.random() * 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`;
}

async function addAttendanceData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
    console.log('Connected to MongoDB');

    // Clear existing attendance
    await Attendance.deleteMany({});
    
    // Get all data
    const students = await Student.find();
    const subjects = await Subject.find();
    const teachers = await Teacher.find();
    
    console.log(`Found ${students.length} students, ${subjects.length} subjects, ${teachers.length} teachers`);

    const attendanceRecords = [];
    
    // Create attendance for Computer Science students (first 10 students)
    const csStudents = students.slice(0, 10);
    const csSubjects = subjects.slice(0, 8); // First 8 subjects for CS
    const csTeachers = teachers.slice(0, 3); // First 3 teachers for CS

    for (const student of csStudents) {
      console.log(`Creating attendance for ${student.name}`);
      
      for (const subject of csSubjects) {
        const teacher = csTeachers[Math.floor(Math.random() * csTeachers.length)];
        
        // Generate 25-35 attendance records per subject
        const numRecords = Math.floor(Math.random() * 11) + 25;
        
        for (let i = 0; i < numRecords; i++) {
          let status;
          const rand = Math.random();
          
          // Create some defaulter students
          const isDefaulter = student.name.includes('David') || student.name.includes('Bob');
          
          if (isDefaulter) {
            if (rand < 0.60) status = 'Present';
            else if (rand < 0.70) status = 'Late';
            else if (rand < 0.90) status = 'Absent';
            else status = 'Excused';
          } else {
            if (rand < 0.82) status = 'Present';
            else if (rand < 0.90) status = 'Late';
            else if (rand < 0.97) status = 'Absent';
            else status = 'Excused';
          }

          const type = Math.random() > 0.6 ? 'Theory' : 'Practical';

          const attendance = new Attendance({
            studentId: student._id,
            subjectId: subject._id,
            status: status,
            type: type,
            recordedBy: teacher._id,
            createdAtDate: getRandomDate(40),
            createdAtTime: getRandomTime()
          });
          
          await attendance.save();
          attendanceRecords.push(attendance);
        }
      }
    }

    // Create attendance for IT students (next 5 students)
    const itStudents = students.slice(10, 15);
    const itSubjects = subjects.slice(8, 12); // Next 4 subjects for IT
    const itTeachers = teachers.slice(3, 5); // Next 2 teachers for IT

    for (const student of itStudents) {
      console.log(`Creating attendance for ${student.name}`);
      
      for (const subject of itSubjects) {
        const teacher = itTeachers[Math.floor(Math.random() * itTeachers.length)];
        
        const numRecords = Math.floor(Math.random() * 11) + 20;
        
        for (let i = 0; i < numRecords; i++) {
          let status;
          const rand = Math.random();
          
          if (rand < 0.78) status = 'Present';
          else if (rand < 0.86) status = 'Late';
          else if (rand < 0.95) status = 'Absent';
          else status = 'Excused';

          const type = Math.random() > 0.7 ? 'Theory' : 'Practical';

          const attendance = new Attendance({
            studentId: student._id,
            subjectId: subject._id,
            status: status,
            type: type,
            recordedBy: teacher._id,
            createdAtDate: getRandomDate(35),
            createdAtTime: getRandomTime()
          });
          
          await attendance.save();
          attendanceRecords.push(attendance);
        }
      }
    }

    // Create attendance for Electronics students (last 5 students)
    const ecStudents = students.slice(15, 20);
    const ecSubjects = subjects.slice(12, 16); // Last 4 subjects for Electronics
    const ecTeachers = teachers.slice(5, 8); // Last 3 teachers for Electronics

    for (const student of ecStudents) {
      console.log(`Creating attendance for ${student.name}`);
      
      for (const subject of ecSubjects) {
        const teacher = ecTeachers[Math.floor(Math.random() * ecTeachers.length)];
        
        const numRecords = Math.floor(Math.random() * 11) + 22;
        
        for (let i = 0; i < numRecords; i++) {
          let status;
          const rand = Math.random();
          
          // Make Sam a defaulter
          const isDefaulter = student.name.includes('Sam');
          
          if (isDefaulter) {
            if (rand < 0.58) status = 'Present';
            else if (rand < 0.68) status = 'Late';
            else if (rand < 0.88) status = 'Absent';
            else status = 'Excused';
          } else {
            if (rand < 0.80) status = 'Present';
            else if (rand < 0.88) status = 'Late';
            else if (rand < 0.96) status = 'Absent';
            else status = 'Excused';
          }

          const type = Math.random() > 0.65 ? 'Theory' : 'Practical';

          const attendance = new Attendance({
            studentId: student._id,
            subjectId: subject._id,
            status: status,
            type: type,
            recordedBy: teacher._id,
            createdAtDate: getRandomDate(30),
            createdAtTime: getRandomTime()
          });
          
          await attendance.save();
          attendanceRecords.push(attendance);
        }
      }
    }

    // Update students with attendance records
    console.log('Updating student records...');
    for (const student of students) {
      const studentAttendance = attendanceRecords.filter(a => 
        a.studentId.toString() === student._id.toString()
      );
      student.attedanceRecord = studentAttendance.map(a => a._id);
      await student.save();
    }

    console.log(`\n✅ Generated ${attendanceRecords.length} attendance records!`);
    
    // Statistics
    const presentCount = attendanceRecords.filter(a => a.status === 'Present').length;
    const absentCount = attendanceRecords.filter(a => a.status === 'Absent').length;
    const lateCount = attendanceRecords.filter(a => a.status === 'Late').length;
    const excusedCount = attendanceRecords.filter(a => a.status === 'Excused').length;
    
    console.log('\n📊 ATTENDANCE STATISTICS:');
    console.log(`Present: ${presentCount} (${((presentCount/attendanceRecords.length)*100).toFixed(1)}%)`);
    console.log(`Late: ${lateCount} (${((lateCount/attendanceRecords.length)*100).toFixed(1)}%)`);
    console.log(`Absent: ${absentCount} (${((absentCount/attendanceRecords.length)*100).toFixed(1)}%)`);
    console.log(`Excused: ${excusedCount} (${((excusedCount/attendanceRecords.length)*100).toFixed(1)}%)`);

    // Per-student summary
    console.log('\n👥 STUDENT ATTENDANCE SUMMARY:');
    for (const student of students) {
      const studentAttendance = attendanceRecords.filter(a => 
        a.studentId.toString() === student._id.toString()
      );
      const studentPresent = studentAttendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
      const percentage = studentAttendance.length > 0 ? ((studentPresent / studentAttendance.length) * 100).toFixed(1) : 0;
      const status = percentage >= 75 ? '✅' : percentage >= 65 ? '⚠️' : '❌';
      console.log(`${status} ${student.name}: ${studentPresent}/${studentAttendance.length} (${percentage}%)`);
    }

    console.log('\n🎉 Database is now fully populated with realistic attendance data!');
    process.exit(0);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addAttendanceData();