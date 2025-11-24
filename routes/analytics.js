const express = require('express');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Department = require('../models/Department');
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');
const Allocation = require('../models/Allocation');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get system analytics overview with MapReduce processing
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Basic counts (fast queries)
    const [totalStudents, totalTeachers, totalDepartments, totalSubjects] = await Promise.all([
      Student.countDocuments(),
      Teacher.countDocuments(),
      Department.countDocuments(),
      Subject.countDocuments()
    ]);

    // Use MapReduce for complex analytics
    const MapReduceAnalytics = require('../services/mapReduceAnalytics');
    const analytics = new MapReduceAnalytics();

    // Run analytics in parallel
    const [departmentAnalysis, subjectAnalysis, defaulterAnalysis] = await Promise.all([
      analytics.departmentWiseAttendanceSummary(),
      analytics.subjectLevelPerformanceAnalysis(),
      analytics.defaulterPercentageAnalysis(75)
    ]);

    // Attendance stats for current month (optimized query)
    const currentDate = new Date();
    const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, "0");
    const currentYear = currentDate.getFullYear();

    const monthlyAttendance = await Attendance.aggregate([
      {
        $match: {
          createdAtDate: { $regex: `/${currentMonth}/${currentYear}$` }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          present: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Present', 'Late']] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const attendanceRate = monthlyAttendance.length > 0 ? 
      (monthlyAttendance[0].present / monthlyAttendance[0].total) * 100 : 0;

    // Weekly attendance trend (optimized with aggregation)
    const weeklyTrend = [];
    const datePromises = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getFullYear()}`;
      
      datePromises.push(
        Attendance.aggregate([
          { $match: { createdAtDate: dateStr } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              present: {
                $sum: {
                  $cond: [
                    { $in: ['$status', ['Present', 'Late']] },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ]).then(result => ({
          date: dateStr,
          attendanceRate: result.length > 0 ? 
            Math.round((result[0].present / result[0].total) * 10000) / 100 : 0
        }))
      );
    }

    const weeklyResults = await Promise.all(datePromises);
    weeklyTrend.push(...weeklyResults);

    // Combine all results
    const response = {
      overview: {
        totalStudents,
        totalTeachers,
        totalDepartments,
        totalSubjects,
        currentAttendanceRate: Math.round(attendanceRate * 100) / 100,
        processingTime: Date.now() - startTime,
        nodeId: process.env.NODE_ID || 'node-1'
      },
      departmentStats: departmentAnalysis.results.map(dept => ({
        name: dept.departmentName,
        studentCount: dept.totalStudents,
        averageAttendance: Math.round(dept.averageAttendance * 100) / 100,
        totalClasses: dept.totalClasses
      })),
      weeklyTrend,
      mapReduceAnalytics: {
        departmentSummary: departmentAnalysis.summary,
        subjectPerformance: subjectAnalysis.summary,
        defaulterAnalysis: {
          totalDefaulters: defaulterAnalysis.totalDefaulters,
          defaulterPercentage: Math.round(defaulterAnalysis.overallDefaulterPercentage * 100) / 100,
          departmentBreakdown: defaulterAnalysis.departmentBreakdown
        }
      },
      performance: {
        totalProcessingTime: Date.now() - startTime,
        parallelProcessing: true,
        workersUsed: require('os').cpus().length
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message,
      processingTime: Date.now() - (req.startTime || Date.now())
    });
  }
});

// Get subject-wise attendance analytics
router.get('/subjects', authMiddleware, async (req, res) => {
  try {
    const subjects = await Subject.find().populate('departmentId', 'name');
    const subjectAnalytics = [];

    for (const subject of subjects) {
      const attendance = await Attendance.find({ subjectId: subject._id });
      
      // Aggregate summary data
      let totalConducted = 0;
      let totalAttended = 0;
      
      attendance.forEach(record => {
        totalConducted += record.totalConducted || 0;
        totalAttended += record.totalAttended || 0;
      });
      
      const averageAttendance = totalConducted > 0 
        ? (totalAttended / totalConducted) * 100 
        : 0;

      subjectAnalytics.push({
        subject: {
          _id: subject._id,
          name: subject.name,
          code: subject.code,
          department: subject.departmentId?.name
        },
        totalClasses: totalConducted,
        averageAttendance: Math.round(averageAttendance * 100) / 100
      });
    }

    res.json(subjectAnalytics);

  } catch (error) {
    console.error('Subject analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get teacher performance analytics
router.get('/teachers', authMiddleware, async (req, res) => {
  try {
    const teachers = await Teacher.find();
    const teacherAnalytics = [];

    for (const teacher of teachers) {
      // Get all allocations for this teacher (subjects assigned to the teacher)
      const allocations = await Allocation.find({ teacherId: teacher._id })
        .select('subjectId type');
      
      let classesRecorded = 0;
      const uniqueSubjectIds = new Set();
      
      // For each allocation (subject+type combination), count unique lecture dates
      for (const allocation of allocations) {
        const subjectId = allocation.subjectId;
        const type = allocation.type;
        
        // Track unique subjects
        uniqueSubjectIds.add(subjectId.toString());
        
        // Get attendance records for this specific subject and type
        const attendanceRecords = await Attendance.find({ 
          subjectId: subjectId,
          type: type
        }).select('createdAtDate');
        
        // Count unique dates for this subject+type combination
        const uniqueDates = new Set();
        attendanceRecords.forEach(record => {
          uniqueDates.add(record.createdAtDate);
        });
        
        // Add to total classes
        classesRecorded += uniqueDates.size;
      }
      
      teacherAnalytics.push({
        teacher: {
          _id: teacher._id,
          name: teacher.teacherName,
          email: teacher.teacherEmail,
          department: teacher.department
        },
        classesRecorded,
        subjectsHandled: uniqueSubjectIds.size
      });
    }

    res.json(teacherAnalytics);

  } catch (error) {
    console.error('Teacher analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;