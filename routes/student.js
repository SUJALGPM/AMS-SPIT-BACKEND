const express = require('express');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get student profile
router.get('/profile', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const studentId = req.user.userId;

    const student = await Student.findById(studentId)
      .select('-password')
      .populate('departmentId', 'name')
      .populate('semesterId', 'semesterNumber academicYear');

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json(student);
  } catch (error) {
    console.error('Get student profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get student's subjects
router.get('/subjects', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const studentId = req.user.userId;

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Build query - if student has semesterId, filter by it, otherwise just by department
    const query = { departmentId: student.departmentId };
    if (student.semesterId) {
      query.semesterId = student.semesterId;
    }

    const subjects = await Subject.find(query);

    res.json(subjects);
  } catch (error) {
    console.error('Get student subjects error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get attendance summary
router.get('/attendance-summary', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const studentId = req.user.userId;

    const attendance = await Attendance.find({ studentId })
      .populate('subjectId', 'name code')
      .sort({ updatedAt: -1 });

    // Group by subject and type, aggregate if multiple periods
    const subjectStats = {};
    
    attendance.forEach(record => {
      if (!record.subjectId) return;
      
      const subjectId = record.subjectId._id.toString();
      const key = `${subjectId}_${record.type}`;
      
      if (!subjectStats[key]) {
        subjectStats[key] = {
          subject: record.subjectId,
          type: record.type,
          totalConducted: 0,
          totalAttended: 0,
          percentage: 0,
          period: record.period,
          division: record.division,
          batch: record.batch
        };
      }
      
      // Aggregate totals if multiple periods
      subjectStats[key].totalConducted += record.totalConducted || 0;
      subjectStats[key].totalAttended += record.totalAttended || 0;
      
      // Use latest percentage or calculate
      if (record.percentage > 0) {
        subjectStats[key].percentage = record.percentage;
      }
    });

    // Calculate percentages for aggregated records
    Object.keys(subjectStats).forEach(key => {
      const stats = subjectStats[key];
      if (stats.percentage === 0 && stats.totalConducted > 0) {
        stats.percentage = (stats.totalAttended / stats.totalConducted) * 100;
      }
    });

    // Overall stats - sum up totals from all subjects
    const totalClasses = Object.values(subjectStats).reduce((sum, stats) => sum + stats.totalConducted, 0);
    const totalAttended = Object.values(subjectStats).reduce((sum, stats) => sum + stats.totalAttended, 0);
    const overallPercentage = totalClasses > 0 ? (totalAttended / totalClasses) * 100 : 0;

    res.json({
      overall: {
        totalClasses,
        totalAttended,
        percentage: Math.round(overallPercentage * 100) / 100
      },
      subjects: Object.values(subjectStats)
    });

  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update student profile
router.put('/profile', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const currentStudentId = req.user.userId;
    const allowedFields = ['name', 'email', 'contactNumber', 'gender', 'division', 'batch'];
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // Never allow changing the UID (studentId) from this endpoint
    if (req.body.studentId) delete req.body.studentId;

    // If email is being updated, ensure uniqueness
    if (updates.email) {
      const existing = await Student.findOne({ email: updates.email, _id: { $ne: currentStudentId } });
      if (existing) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    const updated = await Student.findByIdAndUpdate(
      currentStudentId,
      { $set: updates },
      { new: true }
    )
      .select('-password')
      .populate('departmentId', 'name')
      .populate('semesterId', 'semesterNumber academicYear');

    if (!updated) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Update student profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
