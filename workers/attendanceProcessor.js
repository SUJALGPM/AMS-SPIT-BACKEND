const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const mongoose = require('mongoose');

if (isMainThread) {
  // Main thread - export worker creation function
  module.exports = {
    processAttendanceCSV: (csvData, options) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: { csvData, options, type: 'csv' }
        });

        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    },

    processBulkAttendance: (attendanceRecords, options) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: { attendanceRecords, options, type: 'bulk' }
        });

        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    },

    calculateAttendanceAnalytics: (studentIds, options) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: { studentIds, options, type: 'analytics' }
        });

        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    }
  };
} else {
  // Worker thread
  const { csvData, attendanceRecords, studentIds, options, type } = workerData;

  async function processInWorker() {
    try {
      // Connect to MongoDB in worker thread
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');

      const Student = require('../models/Student');
      const Attendance = require('../models/Attendance');
      const Subject = require('../models/Subject');

      switch (type) {
        case 'csv':
          return await processCSVData(csvData, options);
        case 'bulk':
          return await processBulkData(attendanceRecords, options);
        case 'analytics':
          return await calculateAnalytics(studentIds, options);
        default:
          throw new Error('Unknown worker type');
      }
    } catch (error) {
      throw error;
    } finally {
      await mongoose.disconnect();
    }
  }

  async function processCSVData(csvData, options) {
    const { subjectId, type, teacherId } = options;
    const results = [];
    const errors = [];

    // Process CSV data in parallel chunks
    const chunkSize = 50;
    const chunks = [];
    
    for (let i = 0; i < csvData.length; i += chunkSize) {
      chunks.push(csvData.slice(i, i + chunkSize));
    }

    const Student = require('../models/Student');
    const Attendance = require('../models/Attendance');

    // Process chunks in parallel
    const chunkPromises = chunks.map(async (chunk, chunkIndex) => {
      const chunkResults = [];
      const chunkErrors = [];

      for (const row of chunk) {
        try {
          const student = await Student.findOne({ studentId: row.studentId });
          
          if (!student) {
            chunkErrors.push({
              row: chunkIndex * chunkSize + chunk.indexOf(row),
              error: `Student not found: ${row.studentId}`
            });
            continue;
          }

          const attendance = new Attendance({
            studentId: student._id,
            subjectId,
            status: row.status,
            type,
            recordedBy: teacherId,
            createdAtDate: row.date || (() => {
              const currentDate = new Date();
              const day = currentDate.getDate().toString().padStart(2, "0");
              const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
              const year = currentDate.getFullYear();
              return `${day}/${month}/${year}`;
            })(),
            createdAtTime: row.time || (() => {
              const currentTime = new Date();
              const hours = currentTime.getHours().toString().padStart(2, "0");
              const minutes = currentTime.getMinutes().toString().padStart(2, "0");
              const seconds = currentTime.getSeconds().toString().padStart(2, "0");
              return `${hours}:${minutes}:${seconds}`;
            })()
          });

          await attendance.save();
          
          // Update student's attendance record
          await Student.findByIdAndUpdate(
            student._id,
            { $push: { attedanceRecord: attendance._id } }
          );

          chunkResults.push({
            studentId: row.studentId,
            attendanceId: attendance._id,
            status: row.status
          });

        } catch (error) {
          chunkErrors.push({
            row: chunkIndex * chunkSize + chunk.indexOf(row),
            error: error.message
          });
        }
      }

      return { results: chunkResults, errors: chunkErrors };
    });

    // Wait for all chunks to complete
    const chunkResults = await Promise.all(chunkPromises);
    
    // Combine results
    chunkResults.forEach(({ results: chunkRes, errors: chunkErr }) => {
      results.push(...chunkRes);
      errors.push(...chunkErr);
    });

    return {
      success: true,
      recordsProcessed: results.length,
      errors: errors.length,
      results,
      errorDetails: errors
    };
  }

  async function processBulkData(attendanceRecords, options) {
    const { teacherId } = options;
    const results = [];
    const errors = [];

    const Attendance = require('../models/Attendance');
    const Student = require('../models/Student');

    // Process in parallel batches
    const batchSize = 25;
    const batches = [];
    
    for (let i = 0; i < attendanceRecords.length; i += batchSize) {
      batches.push(attendanceRecords.slice(i, i + batchSize));
    }

    const batchPromises = batches.map(async (batch) => {
      const batchResults = [];
      const batchErrors = [];

      for (const record of batch) {
        try {
          const attendance = new Attendance({
            ...record,
            recordedBy: teacherId
          });

          await attendance.save();
          
          // Update student's attendance record
          await Student.findByIdAndUpdate(
            record.studentId,
            { $push: { attedanceRecord: attendance._id } }
          );

          batchResults.push(attendance);
        } catch (error) {
          batchErrors.push({
            record,
            error: error.message
          });
        }
      }

      return { results: batchResults, errors: batchErrors };
    });

    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(({ results: batchRes, errors: batchErr }) => {
      results.push(...batchRes);
      errors.push(...batchErr);
    });

    return {
      success: true,
      recordsCreated: results.length,
      errors: errors.length,
      results,
      errorDetails: errors
    };
  }

  async function calculateAnalytics(studentIds, options) {
    const { threshold = 75 } = options;
    
    const Student = require('../models/Student');
    const Attendance = require('../models/Attendance');

    // Process students in parallel chunks
    const chunkSize = 10;
    const chunks = [];
    
    for (let i = 0; i < studentIds.length; i += chunkSize) {
      chunks.push(studentIds.slice(i, i + chunkSize));
    }

    const chunkPromises = chunks.map(async (chunk) => {
      const chunkResults = [];

      for (const studentId of chunk) {
        try {
          const student = await Student.findById(studentId).populate('departmentId');
          if (!student) continue;

          const attendance = await Attendance.find({ studentId })
            .populate('subjectId', 'name code');

          // Calculate subject-wise statistics
          const subjectStats = {};
          
          attendance.forEach(record => {
            const subjectId = record.subjectId._id.toString();
            if (!subjectStats[subjectId]) {
              subjectStats[subjectId] = {
                subject: record.subjectId,
                total: 0,
                present: 0,
                absent: 0,
                late: 0,
                excused: 0
              };
            }
            
            subjectStats[subjectId].total++;
            subjectStats[subjectId][record.status.toLowerCase()]++;
          });

          // Calculate percentages and identify defaulters
          const subjectPerformance = Object.values(subjectStats).map(stats => {
            const presentCount = stats.present + stats.late;
            const percentage = stats.total > 0 ? (presentCount / stats.total) * 100 : 0;
            
            return {
              ...stats,
              percentage,
              isDefaulter: percentage < threshold
            };
          });

          const overallStats = {
            totalClasses: attendance.length,
            totalPresent: attendance.filter(a => a.status === 'Present' || a.status === 'Late').length
          };
          overallStats.percentage = overallStats.totalClasses > 0 ? 
            (overallStats.totalPresent / overallStats.totalClasses) * 100 : 0;

          chunkResults.push({
            student: {
              _id: student._id,
              name: student.name,
              studentId: student.studentId,
              email: student.email,
              department: student.departmentId?.name
            },
            overallStats,
            subjectPerformance,
            isOverallDefaulter: overallStats.percentage < threshold
          });

        } catch (error) {
          console.error(`Error processing student ${studentId}:`, error);
        }
      }

      return chunkResults;
    });

    const results = await Promise.all(chunkPromises);
    const flatResults = results.flat();

    // Aggregate statistics
    const analytics = {
      totalStudents: flatResults.length,
      defaulters: flatResults.filter(r => r.isOverallDefaulter),
      averageAttendance: flatResults.reduce((sum, r) => sum + r.overallStats.percentage, 0) / flatResults.length,
      subjectWiseDefaulters: {},
      departmentStats: {}
    };

    // Calculate subject-wise defaulter statistics
    flatResults.forEach(result => {
      result.subjectPerformance.forEach(subject => {
        const subjectId = subject.subject._id.toString();
        if (!analytics.subjectWiseDefaulters[subjectId]) {
          analytics.subjectWiseDefaulters[subjectId] = {
            subject: subject.subject,
            totalStudents: 0,
            defaulterCount: 0
          };
        }
        
        analytics.subjectWiseDefaulters[subjectId].totalStudents++;
        if (subject.isDefaulter) {
          analytics.subjectWiseDefaulters[subjectId].defaulterCount++;
        }
      });

      // Department statistics
      const dept = result.student.department;
      if (dept) {
        if (!analytics.departmentStats[dept]) {
          analytics.departmentStats[dept] = {
            totalStudents: 0,
            defaulterCount: 0,
            averageAttendance: 0
          };
        }
        
        analytics.departmentStats[dept].totalStudents++;
        if (result.isOverallDefaulter) {
          analytics.departmentStats[dept].defaulterCount++;
        }
        analytics.departmentStats[dept].averageAttendance += result.overallStats.percentage;
      }
    });

    // Calculate department averages
    Object.keys(analytics.departmentStats).forEach(dept => {
      const stats = analytics.departmentStats[dept];
      stats.averageAttendance = stats.averageAttendance / stats.totalStudents;
    });

    return {
      success: true,
      analytics,
      studentDetails: flatResults,
      processedAt: new Date().toISOString(),
      processingTime: Date.now() - (options.startTime || Date.now())
    };
  }

  // Execute the worker function
  processInWorker()
    .then(result => {
      parentPort.postMessage(result);
    })
    .catch(error => {
      parentPort.postMessage({
        success: false,
        error: error.message,
        stack: error.stack
      });
    });
}