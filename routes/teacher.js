const express = require('express');
const Allocation = require('../models/Allocation');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const Subject = require('../models/Subject');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get teacher's allocations
router.get('/allocations', authMiddleware, requireRole(['teacher']), async (req, res) => {
  try {
    const teacherId = req.user.userId;

    const allocations = await Allocation.find({ teacherId })
      .populate('subjectId', 'name code')
      .populate('students', 'name studentId email')
      .sort({ type: 1, division: 1, batch: 1 });

    res.json(allocations);
  } catch (error) {
    console.error('Get allocations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get attendance reports for teacher's subjects
router.get('/attendance-reports', authMiddleware, requireRole(['teacher']), async (req, res) => {
  try {
    const teacherId = req.user.userId;
    const { subjectId, startDate, endDate } = req.query;

    // Get teacher's allocated subjects
    const allocations = await Allocation.find({ teacherId }).select('subjectId type');
    const allocatedSubjectIds = allocations.map(a => a.subjectId);
    
    // If teacher has no allocations, return empty array
    if (allocatedSubjectIds.length === 0) {
      return res.json([]);
    }

    // Build filter based on allocated subjects
    const filter = { 
      subjectId: { $in: allocatedSubjectIds }
    };
    
    // Apply subject filter if specified
    if (subjectId && allocatedSubjectIds.some(id => id.toString() === subjectId)) {
      filter.subjectId = subjectId;
    }
    
    // Apply date range filter if provided
    if (startDate && endDate) {
      // Parse dates (assuming format: YYYY-MM-DD)
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include entire end date
      
      // Since createdAtDate is stored as string "DD/MM/YYYY", we need to filter differently
      // For now, we'll get all records and filter in memory
      // In production, you might want to add a proper date field
    }

    const attendance = await Attendance.find(filter)
      .populate('studentId', 'name studentId email')
      .populate('subjectId', 'name code')
      .sort({ updatedAt: -1 });

    // Apply date range filter in memory if needed (using updatedAt)
    let filteredAttendance = attendance;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      filteredAttendance = attendance.filter(record => {
        const recordDate = new Date(record.updatedAt);
        return recordDate >= start && recordDate <= end;
      });
    }

    // Group by subject and type (Theory/Practical)
    const subjectReports = {};
    
    filteredAttendance.forEach(record => {
      if (!record.subjectId) return;
      
      const subjectId = record.subjectId._id.toString();
      const type = record.type; // Theory or Practical
      const key = `${subjectId}_${type}`;
      
      if (!subjectReports[key]) {
        subjectReports[key] = {
          subject: record.subjectId,
          type: type,
          records: [],
          stats: {
            totalConducted: 0,
            totalAttended: 0,
            percentage: 0
          }
        };
      }

      subjectReports[key].records.push(record);
      
      // Aggregate summary data
      subjectReports[key].stats.totalConducted += record.totalConducted || 0;
      subjectReports[key].stats.totalAttended += record.totalAttended || 0;
    });

    // Calculate percentages
    Object.keys(subjectReports).forEach(key => {
      const stats = subjectReports[key].stats;
      stats.percentage = stats.totalConducted > 0 
        ? (stats.totalAttended / stats.totalConducted) * 100 
        : 0;
    });

    // Convert to array and sort by subject name, then by type
    const reports = Object.values(subjectReports).sort((a, b) => {
      if (a.subject.name !== b.subject.name) {
        return a.subject.name.localeCompare(b.subject.name);
      }
      return a.type.localeCompare(b.type);
    });

    res.json(reports);
  } catch (error) {
    console.error('Get attendance reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get students for a specific allocation
router.get('/allocations/:allocationId/students', authMiddleware, requireRole(['teacher']), async (req, res) => {
  try {
    const { allocationId } = req.params;
    const teacherId = req.user.userId;

    const allocation = await Allocation.findOne({ 
      _id: allocationId, 
      teacherId 
    }).populate('students', 'name studentId email division batch');

    if (!allocation) {
      return res.status(404).json({ message: 'Allocation not found' });
    }

    res.json(allocation.students);
  } catch (error) {
    console.error('Get allocation students error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;