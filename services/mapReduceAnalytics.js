const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const mongoose = require('mongoose');

class MapReduceAnalytics {
  constructor() {
    this.workers = [];
    this.maxWorkers = require('os').cpus().length;
  }

  // MapReduce for department-wise attendance summaries
  async departmentWiseAttendanceSummary() {
    try {
      const Student = require('../models/Student');
      const students = await Student.find().populate('departmentId');
      
      // Group students by department (Map phase)
      const departmentGroups = this.mapStudentsByDepartment(students);
      
      // Process each department in parallel (Reduce phase)
      const departmentPromises = Object.entries(departmentGroups).map(
        ([deptId, studentIds]) => this.processDepartmentAttendance(deptId, studentIds)
      );
      
      const results = await Promise.all(departmentPromises);
      
      // Combine results
      return this.combineResults(results, 'department');
      
    } catch (error) {
      console.error('Error in department-wise analysis:', error);
      throw error;
    }
  }

  // MapReduce for subject-level average performance
  async subjectLevelPerformanceAnalysis() {
    try {
      const Subject = require('../models/Subject');
      const subjects = await Subject.find().populate('departmentId');
      
      // Map subjects by department
      const subjectGroups = this.mapSubjectsByDepartment(subjects);
      
      // Process each group in parallel
      const subjectPromises = Object.entries(subjectGroups).map(
        ([deptId, subjectIds]) => this.processSubjectPerformance(deptId, subjectIds)
      );
      
      const results = await Promise.all(subjectPromises);
      
      return this.combineResults(results, 'subject');
      
    } catch (error) {
      console.error('Error in subject-level analysis:', error);
      throw error;
    }
  }

  // MapReduce for defaulter percentage calculation
  async defaulterPercentageAnalysis(threshold = 75) {
    try {
      const Student = require('../models/Student');
      const students = await Student.find();
      
      // Divide students into chunks for parallel processing
      const chunks = this.chunkArray(students, Math.ceil(students.length / this.maxWorkers));
      
      // Process chunks in parallel
      const chunkPromises = chunks.map((chunk, index) => 
        this.processDefaulterChunk(chunk, threshold, index)
      );
      
      const results = await Promise.all(chunkPromises);
      
      // Reduce phase - combine all results
      return this.reduceDefaulterResults(results, threshold);
      
    } catch (error) {
      console.error('Error in defaulter analysis:', error);
      throw error;
    }
  }

  // Map phase: Group students by department
  mapStudentsByDepartment(students) {
    const groups = {};
    
    students.forEach(student => {
      const deptId = student.departmentId?._id?.toString() || 'unknown';
      if (!groups[deptId]) {
        groups[deptId] = {
          departmentName: student.departmentId?.name || 'Unknown',
          studentIds: []
        };
      }
      groups[deptId].studentIds.push(student._id);
    });
    
    return groups;
  }

  // Map phase: Group subjects by department
  mapSubjectsByDepartment(subjects) {
    const groups = {};
    
    subjects.forEach(subject => {
      const deptId = subject.departmentId?._id?.toString() || 'unknown';
      if (!groups[deptId]) {
        groups[deptId] = {
          departmentName: subject.departmentId?.name || 'Unknown',
          subjectIds: []
        };
      }
      groups[deptId].subjectIds.push(subject._id);
    });
    
    return groups;
  }

  // Process department attendance in worker thread
  async processDepartmentAttendance(deptId, departmentData) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          type: 'department-attendance',
          deptId,
          departmentData,
          mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system'
        }
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

  // Process subject performance in worker thread
  async processSubjectPerformance(deptId, subjectData) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          type: 'subject-performance',
          deptId,
          subjectData,
          mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system'
        }
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

  // Process defaulter chunk in worker thread
  async processDefaulterChunk(studentChunk, threshold, chunkIndex) {
    return new Promise((resolve, reject) => {
      // Convert Mongoose documents to plain objects for worker thread
      const plainStudentChunk = studentChunk.map(student => ({
        _id: student._id.toString(),
        name: student.name,
        studentId: student.studentId,
        email: student.email,
        departmentId: student.departmentId ? student.departmentId.toString() : null,
        semesterId: student.semesterId ? student.semesterId.toString() : null
      }));

      const worker = new Worker(__filename, {
        workerData: {
          type: 'defaulter-chunk',
          studentChunk: plainStudentChunk,
          threshold,
          chunkIndex,
          mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system'
        }
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

  // Utility function to chunk array
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // Combine results from parallel processing
  combineResults(results, type) {
    const combined = {
      type,
      processedAt: new Date().toISOString(),
      totalProcessed: results.length,
      results: results.filter(r => r.success),
      errors: results.filter(r => !r.success)
    };

    if (type === 'department') {
      combined.summary = {
        totalDepartments: combined.results.length,
        averageAttendance: combined.results.reduce((sum, r) => sum + r.averageAttendance, 0) / combined.results.length,
        totalStudents: combined.results.reduce((sum, r) => sum + r.totalStudents, 0)
      };
    } else if (type === 'subject') {
      combined.summary = {
        totalSubjects: combined.results.length,
        averagePerformance: combined.results.reduce((sum, r) => sum + r.averagePerformance, 0) / combined.results.length,
        totalClasses: combined.results.reduce((sum, r) => sum + r.totalClasses, 0)
      };
    }

    return combined;
  }

  // Reduce defaulter results
  reduceDefaulterResults(results, threshold) {
    const successful = results.filter(r => r.success);
    
    const combined = {
      type: 'defaulter-analysis',
      threshold,
      processedAt: new Date().toISOString(),
      chunks: successful.length,
      totalStudents: successful.reduce((sum, r) => sum + r.totalStudents, 0),
      totalDefaulters: successful.reduce((sum, r) => sum + r.defaulterCount, 0),
      departmentBreakdown: {},
      subjectBreakdown: {}
    };

    // Combine department and subject breakdowns
    successful.forEach(result => {
      // Merge department data
      Object.entries(result.departmentBreakdown || {}).forEach(([dept, data]) => {
        if (!combined.departmentBreakdown[dept]) {
          combined.departmentBreakdown[dept] = { students: 0, defaulters: 0 };
        }
        combined.departmentBreakdown[dept].students += data.students;
        combined.departmentBreakdown[dept].defaulters += data.defaulters;
      });

      // Merge subject data
      Object.entries(result.subjectBreakdown || {}).forEach(([subject, data]) => {
        if (!combined.subjectBreakdown[subject]) {
          combined.subjectBreakdown[subject] = { students: 0, defaulters: 0 };
        }
        combined.subjectBreakdown[subject].students += data.students;
        combined.subjectBreakdown[subject].defaulters += data.defaulters;
      });
    });

    // Calculate percentages
    combined.overallDefaulterPercentage = (combined.totalDefaulters / combined.totalStudents) * 100;
    
    Object.keys(combined.departmentBreakdown).forEach(dept => {
      const data = combined.departmentBreakdown[dept];
      data.percentage = (data.defaulters / data.students) * 100;
    });

    Object.keys(combined.subjectBreakdown).forEach(subject => {
      const data = combined.subjectBreakdown[subject];
      data.percentage = (data.defaulters / data.students) * 100;
    });

    return combined;
  }
}

// Worker thread implementations
if (!isMainThread) {
  const { type, mongoUri } = workerData;

  async function processInWorker() {
    await mongoose.connect(mongoUri);

    switch (type) {
      case 'department-attendance':
        return await processDepartmentAttendanceWorker();
      case 'subject-performance':
        return await processSubjectPerformanceWorker();
      case 'defaulter-chunk':
        return await processDefaulterChunkWorker();
      default:
        throw new Error('Unknown worker type');
    }
  }

  async function processDepartmentAttendanceWorker() {
    const { deptId, departmentData } = workerData;
    const Attendance = require('../models/Attendance');
    
    try {
      const attendance = await Attendance.find({
        studentId: { $in: departmentData.studentIds }
      }).populate('studentId subjectId');

      const stats = {
        departmentId: deptId,
        departmentName: departmentData.departmentName,
        totalStudents: departmentData.studentIds.length,
        totalClasses: attendance.length,
        presentCount: attendance.filter(a => a.status === 'Present' || a.status === 'Late').length,
        absentCount: attendance.filter(a => a.status === 'Absent').length,
        averageAttendance: 0
      };

      stats.averageAttendance = stats.totalClasses > 0 ? 
        (stats.presentCount / stats.totalClasses) * 100 : 0;

      return { success: true, ...stats };
    } catch (error) {
      return { success: false, error: error.message, departmentId: deptId };
    }
  }

  async function processSubjectPerformanceWorker() {
    const { deptId, subjectData } = workerData;
    const Attendance = require('../models/Attendance');
    
    try {
      const attendance = await Attendance.find({
        subjectId: { $in: subjectData.subjectIds }
      }).populate('subjectId');

      const subjectStats = {};
      
      attendance.forEach(record => {
        const subjectId = record.subjectId._id.toString();
        if (!subjectStats[subjectId]) {
          subjectStats[subjectId] = {
            subjectName: record.subjectId.name,
            subjectCode: record.subjectId.code,
            total: 0,
            present: 0
          };
        }
        
        subjectStats[subjectId].total++;
        if (record.status === 'Present' || record.status === 'Late') {
          subjectStats[subjectId].present++;
        }
      });

      // Calculate averages
      const subjects = Object.values(subjectStats).map(stats => ({
        ...stats,
        percentage: stats.total > 0 ? (stats.present / stats.total) * 100 : 0
      }));

      const averagePerformance = subjects.length > 0 ? 
        subjects.reduce((sum, s) => sum + s.percentage, 0) / subjects.length : 0;

      return {
        success: true,
        departmentId: deptId,
        departmentName: subjectData.departmentName,
        subjects,
        averagePerformance,
        totalClasses: attendance.length
      };
    } catch (error) {
      return { success: false, error: error.message, departmentId: deptId };
    }
  }

  async function processDefaulterChunkWorker() {
    const { studentChunk, threshold, chunkIndex } = workerData;
    const Attendance = require('../models/Attendance');
    const Student = require('../models/Student');
    
    try {
      let defaulterCount = 0;
      const departmentBreakdown = {};
      const subjectBreakdown = {};

      for (const student of studentChunk) {
        const fullStudent = await Student.findById(student._id).populate('departmentId');
        const attendance = await Attendance.find({ studentId: student._id })
          .populate('subjectId');

        // Calculate overall attendance
        const totalClasses = attendance.length;
        const presentClasses = attendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
        const percentage = totalClasses > 0 ? (presentClasses / totalClasses) * 100 : 0;

        const isDefaulter = percentage < threshold;
        if (isDefaulter) defaulterCount++;

        // Department breakdown
        const deptName = fullStudent.departmentId?.name || 'Unknown';
        if (!departmentBreakdown[deptName]) {
          departmentBreakdown[deptName] = { students: 0, defaulters: 0 };
        }
        departmentBreakdown[deptName].students++;
        if (isDefaulter) departmentBreakdown[deptName].defaulters++;

        // Subject breakdown
        const subjectStats = {};
        attendance.forEach(record => {
          const subjectName = record.subjectId?.name || 'Unknown';
          if (!subjectStats[subjectName]) {
            subjectStats[subjectName] = { total: 0, present: 0 };
          }
          subjectStats[subjectName].total++;
          if (record.status === 'Present' || record.status === 'Late') {
            subjectStats[subjectName].present++;
          }
        });

        Object.entries(subjectStats).forEach(([subjectName, stats]) => {
          const subjectPercentage = stats.total > 0 ? (stats.present / stats.total) * 100 : 0;
          const isSubjectDefaulter = subjectPercentage < threshold;

          if (!subjectBreakdown[subjectName]) {
            subjectBreakdown[subjectName] = { students: 0, defaulters: 0 };
          }
          subjectBreakdown[subjectName].students++;
          if (isSubjectDefaulter) subjectBreakdown[subjectName].defaulters++;
        });
      }

      return {
        success: true,
        chunkIndex,
        totalStudents: studentChunk.length,
        defaulterCount,
        departmentBreakdown,
        subjectBreakdown
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message, 
        chunkIndex,
        totalStudents: studentChunk.length 
      };
    }
  }

  processInWorker()
    .then(result => {
      parentPort.postMessage(result);
      mongoose.disconnect();
    })
    .catch(error => {
      parentPort.postMessage({
        success: false,
        error: error.message
      });
      mongoose.disconnect();
    });
}

module.exports = MapReduceAnalytics;