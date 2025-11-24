const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const Admin = require('../models/Admin');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const Department = require('../models/Department');
const Semester = require('../models/Semester');
const Subject = require('../models/Subject');
const Allocation = require('../models/Allocation');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Helper function to generate email
function generateEmail(fullName, type) {
  const parts = fullName.trim().split(" ");
  const firstName = parts[0];
  const lastName = parts.slice(1).join("").replace(/\s+/g, "");
  const year = type?.toUpperCase() === "R" ? "23" : "24";
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${year}@spit.ac.in`;
}

const router = express.Router();

// Get all users
router.get('/users', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { role, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let users = [];
    let total = 0;

    if (!role || role === 'all') {
      // Get all users
      const teachers = await Teacher.find()
        .select('-teacherPassword')
        .skip(skip)
        .limit(parseInt(limit));
      
      const students = await Student.find()
        .select('-password')
        .populate('departmentId', 'name')
        .skip(skip)
        .limit(parseInt(limit));

      users = [
        ...teachers.map(t => ({ ...t.toObject(), role: 'teacher' })),
        ...students.map(s => ({ ...s.toObject(), role: 'student' }))
      ];

      total = await Teacher.countDocuments() + await Student.countDocuments();
    } else if (role === 'teacher') {
      const query = search ? {
        $or: [
          { teacherName: { $regex: search, $options: 'i' } },
          { teacherEmail: { $regex: search, $options: 'i' } }
        ]
      } : {};

      const teachers = await Teacher.find(query)
        .select('-teacherPassword')
        .skip(skip)
        .limit(parseInt(limit));

      users = teachers.map(t => ({ ...t.toObject(), role: 'teacher' }));
      total = await Teacher.countDocuments(query);
    } else if (role === 'student') {
      const query = search ? {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { studentId: { $regex: search, $options: 'i' } }
        ]
      } : {};

      const students = await Student.find(query)
        .select('-password')
        .populate('departmentId', 'name')
        .skip(skip)
        .limit(parseInt(limit));

      users = students.map(s => ({ ...s.toObject(), role: 'student' }));
      total = await Student.countDocuments(query);
    }

    res.json({
      users,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: users.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create teacher
router.post('/teachers', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { teacherName, teacherEmail, teacherPassword, teacherGender, teacherNumber, department } = req.body;
    const adminId = req.user.userId;

    // Check if teacher already exists
    const existingTeacher = await Teacher.findOne({ teacherEmail });
    if (existingTeacher) {
      return res.status(400).json({ message: 'Teacher already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(teacherPassword, 10);

    const teacher = new Teacher({
      teacherName,
      teacherEmail,
      teacherPassword: hashedPassword,
      teacherGender,
      teacherNumber,
      department,
      createdBy: adminId
    });

    await teacher.save();

    // Add teacher to admin's teachers list
    await Admin.findByIdAndUpdate(adminId, {
      $push: { Teachers: teacher._id }
    });

    res.json({
      message: 'Teacher created successfully',
      teacher: {
        ...teacher.toObject(),
        teacherPassword: undefined
      }
    });

  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create student
router.post('/students', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { name, studentId, email, password, division, batch, contactNumber, gender, departmentId, semesterId } = req.body;

    // Check if student already exists
    const existingStudent = await Student.findOne({
      $or: [{ email }, { studentId }]
    });
    
    if (existingStudent) {
      return res.status(400).json({ message: 'Student already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const student = new Student({
      name,
      studentId,
      email,
      password: hashedPassword,
      division,
      batch,
      contactNumber,
      gender,
      departmentId,
      semesterId
    });

    await student.save();

    res.json({
      message: 'Student created successfully',
      student: {
        ...student.toObject(),
        password: undefined
      }
    });

  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create department
router.post('/departments', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { name, adminId } = req.body;
    const currentAdminId = adminId || req.user.userId;

    // Check admin exist or not
    const adminExist = await Admin.findById(currentAdminId);
    if (!adminExist) {
      return res.status(404).json({ message: "Admin not found..!!", success: false });
    }

    // Check if department already exists
    const existingDepartment = await Department.findOne({ name });
    if (existingDepartment) {
      return res.status(400).json({ message: "Department already exists" });
    }

    // Create department
    const newDept = new Department({ name });
    const savedDept = await newDept.save();

    // Push department ID into admin's Departments array
    await Admin.findByIdAndUpdate(
      currentAdminId,
      { $push: { Departments: savedDept._id } },
      { new: true }
    );

    res.status(201).json({ message: "Department created", department: savedDept });

  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ message: "Error creating department", error });
  }
});

// Get all departments (accessible by authenticated users for dropdowns)
router.get('/departments', authMiddleware, async (req, res) => {
  try {
    const departments = await Department.find().select('_id name description');
    res.json(departments);
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all teachers (for dropdowns - no pagination)
router.get('/teachers/all', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const teachers = await Teacher.find()
      .select('_id teacherName teacherEmail')
      .sort({ teacherName: 1 });
    
    res.json(teachers);
  } catch (error) {
    console.error('Get all teachers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all allocations (for admin timetable)
router.get('/allocations', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const allocations = await Allocation.find()
      .populate('subjectId', 'name code')
      .populate('teacherId', 'teacherName teacherEmail')
      .populate('students', 'name studentId')
      .sort({ type: 1, division: 1, batch: 1 });

    res.json(allocations);
  } catch (error) {
    console.error('Get allocations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get semesters by department (accessible by authenticated users for dropdowns)
router.get('/departments/:departmentId/semesters', authMiddleware, async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    const semesters = await Semester.find({ departmentId }).select('_id semesterNumber academicYear startMonth endMonth');
    res.json(semesters);
  } catch (error) {
    console.error('Get semesters error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get subjects by semester
router.get('/semesters/:semesterId/subjects', authMiddleware, async (req, res) => {
  try {
    const { semesterId } = req.params;
    
    const subjects = await Subject.find({ semesterId }).select('_id name code');
    res.json(subjects);
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create Semester
router.post('/semesters', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { semesterNumber, academicYear, dptId, startMonth, endMonth } = req.body;

    // Check department exist or not
    const dptExist = await Department.findById(dptId);
    if (!dptExist) {
      return res.status(404).json({ message: "Department not found..!!", success: false });
    }

    // Check if semester already exists for this department and year
    const existing = await Semester.findOne({
      semesterNumber,
      academicYear,
      departmentId: dptId,
    });

    if (existing) {
      return res.status(400).json({ message: "Semester already exists" });
    }

    // Create new semester
    const newSem = new Semester({
      semesterNumber,
      academicYear,
      departmentId: dptId,
      startMonth,
      endMonth,
    });

    const savedSem = await newSem.save();

    // Push semester ID into department's semesters array
    await Department.findByIdAndUpdate(
      dptId,
      { $push: { semesters: savedSem._id } },
      { new: true }
    );

    res.status(201).json({ message: "Semester created", semester: savedSem });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating semester", error });
  }
});

// Create Subject
router.post('/subjects', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { name, code, departmentId, semesterId } = req.body;

    // Check department exists
    const departmentExists = await Department.findById(departmentId);
    if (!departmentExists) {
      return res.status(404).json({ message: "Department not found" });
    }

    // Check semester exists
    const semesterExists = await Semester.findById(semesterId);
    if (!semesterExists) {
      return res.status(404).json({ message: "Semester not found" });
    }

    // Check if subject code already exists
    const existingSubject = await Subject.findOne({ code });
    if (existingSubject) {
      return res.status(400).json({ message: "Subject code already exists" });
    }

    // Create subject
    const newSubject = new Subject({
      name,
      code,
      departmentId,
      semesterId,
    });

    const savedSubject = await newSubject.save();

    // Push subject ID into semester's subjects array
    await Semester.findByIdAndUpdate(
      semesterId,
      { $push: { subjects: savedSubject._id } },
      { new: true }
    );

    res.status(201).json({
      message: "Subject created successfully",
      subject: savedSubject,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create subject", error });
  }
});

// Update Subject
router.put('/subjects/:subjectId', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { name, code } = req.body;

    // Find subject
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ message: "Subject not found" });
    }

    // Update fields if provided
    if (name) subject.name = name;
    if (code && code !== subject.code) {
      const existingCode = await Subject.findOne({ code });
      if (existingCode) {
        return res.status(400).json({ message: "Subject code already exists" });
      }
      subject.code = code;
    }

    const updatedSubject = await subject.save();

    res.status(200).json({
      message: "Subject updated successfully",
      subject: updatedSubject,
    });

  } catch (error) {
    console.error("Error updating subject:", error);
    res.status(500).json({ message: "Failed to update subject", error });
  }
});

// Create Allocation
router.post('/allocations', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const {
      adminId,
      subjectId,
      teacherId,
      type,
      totalPlanned,
      totalConducted,
      division,
      batch,
    } = req.body;

    const currentAdminId = adminId || req.user.userId;

    // Validate admin
    const adminExists = await Admin.findById(currentAdminId);
    if (!adminExists) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    // Validate teacher
    const teacherExists = await Teacher.findById(teacherId);
    if (!teacherExists) {
      return res.status(404).json({ success: false, message: "Teacher not found" });
    }

    // Validate subject
    const subjectExists = await Subject.findById(subjectId);
    if (!subjectExists) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    // Duplicate check
    let duplicateQuery = { subjectId, type };
    if (type === "Theory") {
      duplicateQuery.division = division || null;
    } else if (type === "Practical") {
      if (!division || !batch) {
        return res.status(400).json({
          success: false,
          message: "Division and Batch are required for Practical",
        });
      }
      duplicateQuery.division = division;
      duplicateQuery.batch = batch;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid type. Must be 'Theory' or 'Practical'",
      });
    }

    const allocationExists = await Allocation.findOne(duplicateQuery);
    if (allocationExists) {
      return res.status(400).json({
        success: false,
        message: "Allocation already exists for this subject/type/division/batch",
      });
    }

    // Create allocation
    const allocation = new Allocation({
      subjectId,
      teacherId,
      students: [],
      type,
      totalPlanned: totalPlanned || 0,
      totalConducted: totalConducted || 0,
      division: type === "Theory" ? division || null : division,
      batch: type === "Theory" ? null : batch,
    });

    await allocation.save();

    // Push allocation into Admin's Allocations array
    adminExists.Allocations.push(allocation._id);
    await adminExists.save();

    res.status(201).json({
      success: true,
      message: "Allocation created and linked to admin successfully",
      data: allocation,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upload student Excel sheet
router.post('/upload-students', authMiddleware, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    const { departmentId, semesterId, adminId } = req.body;
    const currentAdminId = adminId || req.user.userId;

    // Check admin exist or not
    const adminExist = await Admin.findById(currentAdminId);
    if (!adminExist) {
      return res.status(404).json({ message: "Admin not found", success: false });
    }

    // Check if department exists
    const departmentExists = await Department.findById(departmentId);
    if (!departmentExists) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    // Check if semester exists
    const semesterExists = await Semester.findById(semesterId);
    if (!semesterExists) {
      return res.status(404).json({ success: false, message: "Semester not found" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const insertedStudents = [];
    let count = 0;

    for (const row of sheetData) {
      const {
        UID,
        "NAME OF STUDENTS": name,
        PASSWORD: password,
        DIVISION: division,
        BATCH: batch,
        GENDER: genderCode,
        "REGULAR/DSY": type,
        CONTACT: contactNumber,
      } = row;

      // Map gender from M/F to enum values
      const gender = genderCode === "M" ? "Male" : genderCode === "F" ? "Female" : "Other";

      // Check if student already exists
      const existing = await Student.findOne({ studentId: UID });
      if (existing) continue;

      // Generate email
      const email = generateEmail(name, type);

      // Hash password
      const hashedPassword = await bcrypt.hash(String(password), 10);

      // Create student
      const student = await Student.create({
        name,
        studentId: String(UID),
        email,
        password: hashedPassword,
        division,
        batch,
        contactNumber: contactNumber === "NA" ? "" : contactNumber,
        gender,
        departmentId,
        semesterId,
      });

      insertedStudents.push(student);

      // Push to allocations with new logic
      const cleanDivision = division?.trim();
      const cleanBatch = batch?.trim() || null;

      // Always link to Theory
      await Allocation.updateMany(
        { division: cleanDivision, type: "Theory" },
        { $addToSet: { students: student._id } }
      );

      // Link to Practical if batch is given
      if (cleanBatch) {
        await Allocation.updateMany(
          { division: cleanDivision, batch: cleanBatch, type: "Practical" },
          { $addToSet: { students: student._id } }
        );
      }

      count++;
      console.log(`${count} students uploaded so far...`);
    }

    // Clean up file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      success: true,
      message: "Student Uploaded successfully and linked to allocations",
      count: insertedStudents.length,
      students: insertedStudents,
    });

  } catch (error) {
    console.error("Upload error:", error);
    if (req.file) {
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// Clear all students from allocations
router.post('/allocations/clear-students', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    // $set will replace students array with an empty array
    const result = await Allocation.updateMany({}, { $set: { students: [] } });

    res.status(200).json({
      success: true,
      message: "All student IDs removed from all allocations",
      modifiedCount: result.modifiedCount,
    });

  } catch (error) {
    console.error("Error clearing allocation students:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Upload teacher data through excel sheet
router.post('/upload-teachers', authMiddleware, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    const createdBy = req.body.createdBy || req.user.userId;

    // Check admin exist or not
    const adminExist = await Admin.findById(createdBy);
    if (!adminExist) {
      return res.status(404).json({ message: "Admin not found", success: false });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let createdTeachers = [];

    for (const row of data) {
      const {
        UID,
        "NAME OF TEACHERS": teacherName,
        PASSWORD: plainPassword,
        GENDER: rawGender,
        DEPARTMENT: department,
        CONTACT: teacherNumber
      } = row;

      // Skip incomplete rows
      if (!teacherName || !plainPassword || !department) continue;

      // Generate email from name → name.surname@spit.ac.in
      const nameParts = teacherName.trim().toLowerCase().split(/\s+/);
      let teacherEmail = "";
      if (nameParts.length >= 2) {
        teacherEmail = `${nameParts[0]}.${nameParts[nameParts.length - 1]}@spit.ac.in`;
      } else {
        teacherEmail = `${nameParts[0]}@spit.ac.in`;
      }

      // Map gender codes to full form
      let teacherGender = null;
      if (rawGender) {
        const g = rawGender.toString().trim().toUpperCase();
        if (g === "M") teacherGender = "Male";
        else if (g === "F") teacherGender = "Female";
        else if (g === "O") teacherGender = "Other";
      }

      // Avoid duplicates
      const existing = await Teacher.findOne({ teacherEmail });
      if (existing) continue;

      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      const newTeacher = new Teacher({
        teacherName,
        teacherEmail,
        teacherPassword: hashedPassword,
        teacherGender,
        teacherNumber: teacherNumber && teacherNumber !== "NA" ? teacherNumber : null,
        department,
        createdBy,
      });

      const savedTeacher = await newTeacher.save();

      // Update teacher id in admin record
      await Admin.findByIdAndUpdate(createdBy, {
        $push: { Teachers: savedTeacher._id },
      });

      createdTeachers.push(savedTeacher);
    }

    // Clean up file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      message: "Teachers uploaded successfully",
      teachers: createdTeachers,
    });

  } catch (error) {
    console.error(error);
    if (req.file) {
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ message: "Error uploading teachers", error: error.message });
  }
});

// Get system settings
router.get('/settings', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    // Return default settings - in a real app, these would be stored in database
    const settings = {
      attendanceThreshold: 75,
      defaulterAlertThreshold: 70,
      autoNotifyDefaulters: true,
      allowGrievanceSubmission: true,
      maxGrievanceAttachments: 5,
      csvUploadMaxSize: 5, // MB
      sessionTimeout: 24 // hours
    };

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update system settings
router.put('/settings', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const settings = req.body;
    
    // In a real app, save to database
    // For now, just return success
    
    res.json({
      message: 'Settings updated successfully',
      settings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle user active status
router.put('/users/:userId/toggle-status', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    let user;
    if (role === 'teacher') {
      user = await Teacher.findById(userId);
    } else if (role === 'student') {
      user = await Student.findById(userId);
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Toggle active status (add isActive field if not exists)
    const newStatus = !user.isActive;
    
    if (role === 'teacher') {
      await Teacher.findByIdAndUpdate(userId, { isActive: newStatus });
    } else {
      await Student.findByIdAndUpdate(userId, { isActive: newStatus });
    }

    res.json({
      message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus
    });

  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Sync students to allocations based on division and batch
router.post('/allocations/sync-students', authMiddleware, requireRole(['admin']), async (req, res) => {
  try {
    const results = {
      totalAllocations: 0,
      updatedAllocations: 0,
      totalStudentsAdded: 0,
      errors: []
    };

    // Get all allocations
    const allocations = await Allocation.find();
    results.totalAllocations = allocations.length;

    for (const allocation of allocations) {
      try {
        let studentQuery = {};

        // Build query based on allocation type
        if (allocation.type === 'Theory') {
          // For Theory: Match by division only
          if (allocation.division) {
            studentQuery.division = allocation.division;
          } else {
            results.errors.push({
              allocationId: allocation._id,
              error: 'Theory allocation missing division'
            });
            continue;
          }
        } else if (allocation.type === 'Practical') {
          // For Practical: Match by division AND batch
          if (allocation.division && allocation.batch) {
            studentQuery.division = allocation.division;
            studentQuery.batch = allocation.batch;
          } else {
            results.errors.push({
              allocationId: allocation._id,
              error: 'Practical allocation missing division or batch'
            });
            continue;
          }
        } else {
          continue; // Skip invalid types
        }

        // Find matching students
        const matchingStudents = await Student.find(studentQuery).select('_id');
        const studentIds = matchingStudents.map(s => s._id);

        // Update allocation with student IDs (replace existing)
        allocation.students = studentIds;
        await allocation.save();

        results.updatedAllocations++;
        results.totalStudentsAdded += studentIds.length;

      } catch (error) {
        results.errors.push({
          allocationId: allocation._id,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: 'Students synced to allocations successfully',
      results
    });

  } catch (error) {
    console.error('Sync students to allocations error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;