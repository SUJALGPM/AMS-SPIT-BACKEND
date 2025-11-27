const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const Subject = require('../models/Subject');
const Allocation = require('../models/Allocation');
const { authMiddleware } = require('../middleware/auth');
const Admin = require("../models/Admin");
const Semester = require("../models/Semester");
const Department = require("../models/Department");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Mark attendance (single or bulk) with parallel processing
router.post('/mark', authMiddleware, async (req, res) => {
  try {
    const { attendanceRecords } = req.body;
    const teacherId = req.user.userId;
    const startTime = Date.now();

    // Use worker thread for bulk processing if more than 10 records
    if (attendanceRecords.length > 10) {
      const attendanceProcessor = require('../workers/attendanceProcessor');
      
      const result = await attendanceProcessor.processBulkAttendance(
        attendanceRecords,
        { teacherId, startTime }
      );

      if (!result.success) {
        return res.status(500).json({
          message: 'Error processing bulk attendance',
          error: result.error,
          details: result.errorDetails
        });
      }

      // Emit real-time update with Lamport timestamp
      await req.io.emitToRole('admin', 'attendance-updated', {
        records: result.results,
        teacherId,
        processingTime: Date.now() - startTime,
        recordsCreated: result.recordsCreated,
        nodeId: process.env.NODE_ID || 'node-1'
      });

      // Check for defaulters in background
      setImmediate(async () => {
        try {
          const defaulters = await checkDefaulters(75);
          if (defaulters.length > 0) {
            await req.io.emitToRole('admin', 'defaulter-alert', {
              defaulters,
              threshold: 75,
              triggeredBy: teacherId
            });
          }
        } catch (error) {
          console.error('Error checking defaulters:', error);
        }
      });

      res.json({
        message: 'Bulk attendance processed successfully',
        recordsCreated: result.recordsCreated,
        errors: result.errors,
        processingTime: Date.now() - startTime,
        processedInWorker: true
      });

    } else {
      // Process small batches in main thread
      const createdRecords = [];

      for (const record of attendanceRecords) {
        const attendance = new Attendance({
          ...record,
          recordedBy: teacherId
        });
        
        const savedRecord = await attendance.save();
        
        // Update student's attendance record
        await Student.findByIdAndUpdate(
          record.studentId,
          { $push: { attedanceRecord: savedRecord._id } }
        );

        createdRecords.push(savedRecord);
      }

      // Emit real-time update
      await req.io.emitToRole('admin', 'attendance-updated', {
        records: createdRecords,
        teacherId,
        processingTime: Date.now() - startTime
      });

      // Check for defaulters
      const defaulters = await checkDefaulters(75);
      if (defaulters.length > 0) {
        await req.io.emitToRole('admin', 'defaulter-alert', {
          defaulters,
          threshold: 75,
          triggeredBy: teacherId
        });
      }

      res.json({
        message: 'Attendance marked successfully',
        records: createdRecords,
        processingTime: Date.now() - startTime
      });
    }

  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload CSV attendance with parallel processing
// router.post('/upload-csv', authMiddleware, upload.single('csvFile'), async (req, res) => {
//   try {
//     const { subjectId, type } = req.body;
//     const teacherId = req.user.userId;
//     const startTime = Date.now();
//     const results = [];

//     // Read CSV file
//     const csvStream = fs.createReadStream(req.file.path)
//       .pipe(csv())
//       .on('data', (data) => results.push(data))
//       .on('end', async () => {
//         try {
//           console.log(`Processing CSV with ${results.length} records using worker thread`);
          
//           // Use worker thread for CSV processing
//           const attendanceProcessor = require('../workers/attendanceProcessor');
          
//           const result = await attendanceProcessor.processAttendanceCSV(
//             results,
//             { subjectId, type, teacherId, startTime }
//           );

//           // Clean up uploaded file
//           fs.unlinkSync(req.file.path);

//           if (!result.success) {
//             return res.status(500).json({
//               message: 'Error processing CSV',
//               error: result.error,
//               errorDetails: result.errorDetails
//             });
//           }

//           // Emit real-time update to all connected clients
//           await req.io.emitToRole('admin', 'csv-upload-completed', {
//             fileName: req.file.originalname,
//             recordsProcessed: result.recordsProcessed,
//             errors: result.errors,
//             teacherId,
//             subjectId,
//             processingTime: Date.now() - startTime,
//             nodeId: process.env.NODE_ID || 'node-1'
//           });

//           // Emit to teacher's connected clients
//           await req.io.emitToUser(teacherId, 'attendance-csv-processed', {
//             fileName: req.file.originalname,
//             recordsProcessed: result.recordsProcessed,
//             errors: result.errors,
//             processingTime: Date.now() - startTime
//           });

//           // Check for defaulters in background
//           setImmediate(async () => {
//             try {
//               const defaulters = await checkDefaulters(75);
//               if (defaulters.length > 0) {
//                 await req.io.emitToRole('admin', 'defaulter-alert', {
//                   defaulters,
//                   threshold: 75,
//                   triggeredBy: teacherId,
//                   source: 'csv-upload'
//                 });
//               }
//             } catch (error) {
//               console.error('Error checking defaulters after CSV upload:', error);
//             }
//           });

//           res.json({
//             message: 'CSV processed successfully',
//             recordsProcessed: result.recordsProcessed,
//             errors: result.errors,
//             errorDetails: result.errorDetails,
//             processingTime: Date.now() - startTime,
//             processedInWorker: true
//           });

//         } catch (error) {
//           console.error('CSV processing error:', error);
          
//           // Clean up file on error
//           try {
//             fs.unlinkSync(req.file.path);
//           } catch (unlinkError) {
//             console.error('Error cleaning up file:', unlinkError);
//           }
          
//           res.status(500).json({ 
//             message: 'Error processing CSV',
//             error: error.message 
//           });
//         }
//       })
//       .on('error', (error) => {
//         console.error('CSV reading error:', error);
        
//         // Clean up file on error
//         try {
//           fs.unlinkSync(req.file.path);
//         } catch (unlinkError) {
//           console.error('Error cleaning up file:', unlinkError);
//         }
        
//         res.status(500).json({ 
//           message: 'Error reading CSV file',
//           error: error.message 
//         });
//       });

//   } catch (error) {
//     console.error('CSV upload error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// });

// Utility to generate student email (same as before)
function generateEmail(fullName, type) {
  const parts = fullName.trim().split(" ");
  const firstName = parts[0];
  const lastName = parts.slice(1).join("").replace(/\s+/g, "");
  const year = type?.toUpperCase() === "R" ? "23" : "24";
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${year}@spit.ac.in`;
}

// Upload CSV for student creation
router.post('/upload-students-csv', upload.single('csvFile'), async (req, res) => {
  try {
    const { departmentId, semesterId, adminId } = req.body;
    const results = [];

    // ✅ Step 1: Validate admin, department, and semester
    const adminExist = await Admin.findById(adminId);
    if (!adminExist)
      return res.status(404).json({ success: false, message: "Admin not found" });

    const departmentExists = await Department.findById(departmentId);
    if (!departmentExists)
      return res.status(404).json({ success: false, message: "Department not found" });

    const semesterExists = await Semester.findById(semesterId);
    if (!semesterExists)
      return res.status(404).json({ success: false, message: "Semester not found" });

    if (!req.file)
      return res.status(400).json({ success: false, message: "No file uploaded" });

    console.log(`📁 Reading CSV file: ${req.file.originalname}`);

    // ✅ Step 2: Parse CSV
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          console.log(`🧾 Processing ${results.length} student records...`);
          const insertedStudents = [];
          let count = 0;

          for (const row of results) {
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

            // Normalize gender
            const gender =
              genderCode === "M" ? "Male" :
              genderCode === "F" ? "Female" : "Other";

            // Skip if already exists
            const existing = await Student.findOne({ studentId: UID });
            if (existing) continue;

            // Generate email & hash password
            const email = generateEmail(name, type);
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
            });

            insertedStudents.push(student);

            // Link to allocations
            const cleanDivision = division?.trim();
            const cleanBatch = batch?.trim() || null;

            // Theory linkage
            await Allocation.updateMany(
              { division: cleanDivision, type: "Theory" },
              { $addToSet: { students: student._id } }
            );

            // Practical linkage
            if (cleanBatch) {
              await Allocation.updateMany(
                { division: cleanDivision, batch: cleanBatch, type: "Practical" },
                { $addToSet: { students: student._id } }
              );
            }

            count++;
            console.log(`✅ ${count} students uploaded so far...`);
          }

          // Delete file after processing
          fs.unlinkSync(req.file.path);

          res.status(201).json({
            success: true,
            message: "Students uploaded successfully and linked to allocations",
            count: insertedStudents.length,
            students: insertedStudents,
          });

        } catch (error) {
          console.error("CSV processing error:", error);
          try { fs.unlinkSync(req.file.path); } catch (_) {}
          res.status(500).json({ success: false, message: "Error processing CSV", error: error.message });
        }
      })
      .on('error', (error) => {
        console.error("CSV reading error:", error);
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        res.status(500).json({ success: false, message: "Error reading CSV file", error: error.message });
      });

  } catch (error) {
    console.error("Upload CSV error:", error);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

// Sample Excel sheet generator for attendance upload
router.get('/sample-sheet', authMiddleware, async (req, res) => {
  try {
    const division = (req.query.division || 'A').toString().toUpperCase();

    const makeRow = (...cells) => cells;
    const headerRow = makeRow('Roll', 'UID', 'NAME OF STUDENTS', 'Batch',
      'SE (Th) lectures attended', '% attended',
      'CNS (Th) lectures attended', '% attended',
      'DC (Th) lectures attended', '% attended',
      'AISC (Th) lectures attended', '% attended',
      'TOC (Th) lectures attended', '% attended',
      'SE (Lab) Lab attended', '% attended',
      'CNS (Lab) Lab attended', '% attended',
      'DC (Lab) Lab attended', '% attended',
      'AISC (Lab) Lab attended', '% attended');

    const categoryRow = makeRow('', '', '', '',
      'Theory Subjects', '', '', '', '', '', '', '', '', '',
      'Lab Subjects', '', '', '', '', '');

    const subjectRow = makeRow('', '', '', '',
      'SE (Th) - Total = 32', '',
      'CNS (Th) - Total = 29', '',
      'DC (Th) - Total = 29', '',
      'AISC (Th) - Total = 29', '',
      'TOC (Th) - Total = 36', '',
      'SE (Lab)  A=10, B=11   C=11, D=10', '',
      'CNS (Lab) A=11, B=10   C=10, D=10', '',
      'DC (Lab)  A=11, B=10   C=10, D=10', '',
      'AISC (Lab) A=10, B=10  C=9, D=11', '');

    const monthRow = makeRow('', 'Month & Year', '', '', `Aug-25 to Oct-25`);

    const dataRows = [
      makeRow('1', '2023000001', 'Sample Student 1', 'A', 28, 88, 25, 86, 24, 83, 26, 90, 36, 100, 10, 100, 10, 91, 11, 91, 9, 90),
      makeRow('2', '2023000002', 'Sample Student 2', 'B', 31, 97, 27, 93, 26, 90, 28, 97, 36, 100, 9, 90, 11, 100, 10, 91, 10, 100),
      makeRow('3', '2023000003', 'Sample Student 3', 'C', 29, 91, 25, 86, 26, 90, 26, 90, 36, 100, 10, 100, 10, 91, 10, 91, 10, 100),
      makeRow('4', '2023000004', 'Sample Student 4', 'D', 23, 72, 16, 55, 15, 52, 23, 79, 36, 100, 8, 80, 9, 82, 8, 73, 8, 80)
    ];

    const aoa = [monthRow, [], categoryRow, subjectRow, headerRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Division ${division}`);

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance_sample_template.xlsx"');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Error generating sample sheet:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate sample sheet' });
  }
});

// Upload division-wise attendance sheet (new format with all subjects)
router.post('/upload-division-sheet', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { division } = req.body;
    const teacherId = req.user.userId;
    
    if (!division || !['A', 'B', 'C', 'D'].includes(division.toUpperCase())) {
      return res.status(400).json({ 
        success: false, 
        message: 'Division is required and must be A, B, C, or D' 
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    const filePath = req.file.path;
    const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
    let workbook;
    let sheetData;

    // Read file based on extension
    if (['xlsx', 'xls'].includes(fileExtension)) {
      workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { 
        header: 1, 
        defval: '',
        raw: false 
      });
    } else if (fileExtension === 'csv') {
      // For CSV, read as array of arrays
      const results = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv({ headers: false }))
          .on('data', (data) => {
            results.push(Object.values(data));
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (error) => {
            reject(error);
          });
      });
      sheetData = results;
      await processDivisionSheet(sheetData, division.toUpperCase(), teacherId, req, res, filePath);
      return; // Exit early since processDivisionSheet handles response
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: 'Unsupported file format. Please upload CSV, XLS, or XLSX file' 
      });
    }

    // Process Excel file
    await processDivisionSheet(sheetData, division.toUpperCase(), teacherId, req, res, filePath);

  } catch (error) {
    console.error('Upload division sheet error:', error);
    try { 
      if (req.file?.path) fs.unlinkSync(req.file.path); 
    } catch (_) {}
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Helper function to parse batch info from string like "A= 10, B= 11            C= 11, D=  10"
// Also handles: "A=10, B=10 C=10 D=11" or "A= 11, B=10 C=11 D=0"
function parseBatchInfo(text) {
  if (!text) return {};
  
  const batchInfo = {};
  // Normalize the text: replace multiple spaces with single space, but preserve structure
  // This handles cases like "A= 10, B= 11            C= 11, D=  10"
  const normalized = String(text)
    .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
    .replace(/\s*,\s*/g, ' ')  // Normalize commas with spaces
    .trim();
  
  // Match patterns like "A=10", "A= 10", "A:10", "A = 10", etc.
  // Also handle formats without commas: "A=10 B=11 C=11 D=10"
  // The pattern matches: letter (A-D), optional spaces, = or :, optional spaces, digits
  const batchPattern = /([A-D])\s*[=:]\s*(\d+)/gi;
  let match;
  
  while ((match = batchPattern.exec(normalized)) !== null) {
    const batch = match[1].toUpperCase();
    const value = parseInt(match[2], 10);
    if (batch && !isNaN(value) && value >= 0) {
      batchInfo[batch] = value;
    }
  }
  
  // Debug logging if we found batch info
  if (Object.keys(batchInfo).length > 0) {
    console.log(`🔍 Parsed batch info from "${text}" -> ${JSON.stringify(batchInfo)}`);
  }
  
  return batchInfo;
}

function findLabSubject(subjectRow, subjectRowAbove, startCol, endCol, division) {
  let subjectCode = null;
  let batchInfo = {};
  let foundCol = -1;
  for (let c = Math.max(0, startCol); c <= Math.min(subjectRow.length - 1, endCol); c++) {
    const sr = String(subjectRow[c] || '').toUpperCase();
    const sa = String(subjectRowAbove[c] || '').toUpperCase();
    const combined = `${sa} ${sr}`;
    let match = combined.match(/([A-Z]{2,4})\s*\(LAB\)/i) || sr.match(/([A-Z]{2,4})\s*\(LAB\)/i) || sa.match(/([A-Z]{2,4})\s*\(LAB\)/i) || combined.match(/([A-Z]{2,4})\s*LAB/i);
    if (match) {
      subjectCode = match[1];
      foundCol = c;
      batchInfo = parseBatchInfo(subjectRow[c]) || {};
      if (Object.keys(batchInfo).length === 0) batchInfo = parseBatchInfo(combined) || {};
      if (Object.keys(batchInfo).length === 0) {
        for (let adj = Math.max(0, c - 4); adj <= Math.min(subjectRow.length - 1, c + 4); adj++) {
          const adjVal = String(subjectRow[adj] || '').trim();
          const bi = parseBatchInfo(adjVal);
          if (Object.keys(bi).length > 0) { batchInfo = bi; break; }
        }
      }
    }
  }
  return { subjectCode, batchInfo, foundCol };
}

// Helper function to process division sheet
async function processDivisionSheet(sheetData, division, teacherId, req, res, filePath) {
  try {
    // Find header row (Row 5 in 1-based, index 4 in 0-based)
    // Looking for "Roll", "UID", "NAME OF STUDENTS", "DIV" or "Batch"
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(10, sheetData.length); i++) {
      const row = sheetData[i];
      const rowStr = row.join(' ').toUpperCase();
      if (rowStr.includes('ROLL') && (rowStr.includes('UID') || rowStr.includes('STUDENT'))) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: 'Could not find header row in sheet' 
      });
    }

    // Find subject header row (Row 4 in 1-based, index 3 in 0-based)
    // This row contains subject names with totals
    // Also check row above (Row 3) for subject names in merged cells
    let subjectHeaderRowIndex = headerRowIndex > 0 ? headerRowIndex - 1 : -1;
    const subjectRow = sheetData[subjectHeaderRowIndex] || [];
    const subjectRowAbove = headerRowIndex >= 2 ? sheetData[headerRowIndex - 2] || [] : [];

    // Parse headers
    const headers = sheetData[headerRowIndex];
    const rollCol = headers.findIndex(h => h.toString().toUpperCase().includes('ROLL'));
    const uidCol = headers.findIndex(h => h.toString().toUpperCase().includes('UID'));
    const nameCol = headers.findIndex(h => h.toString().toUpperCase().includes('NAME') || h.toString().toUpperCase().includes('STUDENT'));
    // Look for either DIV or BATCH column (Excel format has Batch)
    const divCol = headers.findIndex(h => {
      const headerUpper = h.toString().toUpperCase();
      return headerUpper.includes('DIV') || headerUpper.includes('BATCH');
    });

    if (rollCol === -1 || uidCol === -1 || nameCol === -1) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: 'Could not find required columns (Roll, UID, Name)' 
      });
    }

    // Parse subjects from subject row (Row 4) and headers (Row 5)
    // Subject row contains subject names with totals like "SE (Th) - Total = 32"
    const subjects = [];

    // First, identify subject boundaries from Row 3 (Theory Subjects / Lab Subjects)
    let theoryStartCol = -1;
    let labStartCol = -1;
    if (headerRowIndex >= 2) {
      const categoryRow = sheetData[headerRowIndex - 2]; // Row 3
      if (categoryRow) {
        const categoryRowStr = categoryRow.join(' ').toUpperCase();
        for (let col = 0; col < categoryRow.length; col++) {
          const cell = String(categoryRow[col] || '').toUpperCase();
          if (cell.includes('THEORY') && theoryStartCol === -1) {
            theoryStartCol = col;
          }
          if (cell.includes('LAB') || cell.includes('PRACTICAL')) {
            labStartCol = col;
            break;
          }
        }
      }
    }

    let currentSubject = null;
    for (let col = Math.max(divCol + 1, 0); col < headers.length; col++) {
      const header = String(headers[col] || '').trim().toLowerCase();
      const subjectRowValue = String(subjectRow[col] || '').trim();
      const subjectRowUpper = subjectRowValue.toUpperCase();
      const subjectRowAboveValue = String(subjectRowAbove[col] || '').trim().toUpperCase();

      // Check if this column is "attended" (not percentage)
      if (header.includes('attended') && !header.includes('%')) {
        let subjectFound = false;
        if (labStartCol !== -1 && col >= labStartCol) {
          const found = findLabSubject(subjectRow, subjectRowAbove, labStartCol, col, division);
          if (found.subjectCode) {
            const batchTotal = found.batchInfo && found.batchInfo[division] ? found.batchInfo[division] : null;
            const exists = subjects.find(s => s.name === found.subjectCode && s.type === 'Practical' && s.attendedCol === col);
            if (!exists) {
              subjects.push({
                name: found.subjectCode,
                type: 'Practical',
                totalLectures: batchTotal,
                batchInfo: found.batchInfo,
                attendedCol: col,
                percentageCol: col + 1 < headers.length && headers[col + 1]?.toString().toLowerCase().includes('%') ? col + 1 : -1
              });
              console.log(`📝 Found Lab subject: ${found.subjectCode} at column ${col}, batch totals: ${JSON.stringify(found.batchInfo)}`);
              subjectFound = true;
            }
          }
        }
        
        if (!subjectFound) for (let backCol = Math.max(0, col - 6); backCol <= Math.min(subjectRow.length - 1, col + 6); backCol++) {
          // Check subject row (Row 4)
          const backSubjectRow = String(subjectRow[backCol] || '').trim().toUpperCase();
          // Check row above (Row 3) for merged cells
          const backSubjectRowAbove = String(subjectRowAbove[backCol] || '').trim().toUpperCase();
          
          // Combine both rows for checking
          const combinedRow = `${backSubjectRowAbove} ${backSubjectRow}`;
          
          // Check for Theory subject pattern: "SE (Th)" or "SE (Th) - Total = 32"
          if (combinedRow.includes('(TH)') || combinedRow.includes('THEORY') || backSubjectRow.includes('(TH)') || backSubjectRowAbove.includes('(TH)')) {
            // Try to extract subject code
            let codeMatch = combinedRow.match(/([A-Z]{2,4})\s*\(TH\)/i) || 
                           backSubjectRow.match(/([A-Z]{2,4})\s*\(TH\)/i) ||
                           backSubjectRowAbove.match(/([A-Z]{2,4})\s*\(TH\)/i);
            
            if (!codeMatch) {
              // Try simpler pattern - just look for 2-4 uppercase letters before (Th)
              codeMatch = combinedRow.match(/([A-Z]{2,4})\s*\(TH/i);
            }
            
            if (codeMatch) {
              const totalMatch = combinedRow.match(/TOTAL[=\s:]*(\d+)/i) || 
                                backSubjectRow.match(/TOTAL[=\s:]*(\d+)/i) ||
                                backSubjectRowAbove.match(/TOTAL[=\s:]*(\d+)/i);
              
              const subjectCode = codeMatch[1];
              
              // Check if we already added this subject
              const exists = subjects.find(s => s.name === subjectCode && s.type === 'Theory' && s.attendedCol === col);
              if (!exists) {
                subjects.push({
                  name: subjectCode,
                  type: 'Theory',
                  totalLectures: totalMatch ? parseInt(totalMatch[1]) : null,
                  attendedCol: col,
                  percentageCol: col + 1 < headers.length && headers[col + 1]?.toString().toLowerCase().includes('%') ? col + 1 : -1
                });
                console.log(`📝 Found Theory subject: ${subjectCode} at column ${col}, total: ${totalMatch ? totalMatch[1] : 'N/A'}`);
                subjectFound = true;
                break;
              }
            }
          }
          
          // Check for Lab subject pattern: "SE (Lab)" or "SE (Lab) - A=10 B=11"
          if (combinedRow.includes('(LAB)') || combinedRow.includes('LAB') || backSubjectRow.includes('(LAB)') || backSubjectRowAbove.includes('(LAB)')) {
            // Try to extract subject code
            let labMatch = combinedRow.match(/([A-Z]{2,4})\s*\(LAB\)/i) || 
                          backSubjectRow.match(/([A-Z]{2,4})\s*\(LAB\)/i) ||
                          backSubjectRowAbove.match(/([A-Z]{2,4})\s*\(LAB\)/i) ||
                          combinedRow.match(/([A-Z]{2,4})\s*LAB/i);
            
            if (labMatch) {
              const subjectCode = labMatch[1];
              
              // Parse batch info - check multiple sources:
              // Batch data is typically in Row 4 (subjectRow) in the same or adjacent column as subject name
              let batchInfo = {};
              let batchText = '';
              
              // Strategy 1: Check the actual subjectRow at backCol (where subject name was found)
              const currentSubjectRowValue = String(subjectRow[backCol] || '').trim();
              if (currentSubjectRowValue) {
                batchInfo = parseBatchInfo(currentSubjectRowValue);
                if (Object.keys(batchInfo).length > 0) {
                  batchText = currentSubjectRowValue;
                  console.log(`✅ Found batch info for ${subjectCode} in subjectRow[${backCol}]: "${currentSubjectRowValue}"`);
                }
              }
              
              // Strategy 2: If not found, check combined row (subjectRow + rowAbove)
              if (Object.keys(batchInfo).length === 0) {
                batchText = combinedRow || backSubjectRow || backSubjectRowAbove || '';
                batchInfo = parseBatchInfo(batchText);
                if (Object.keys(batchInfo).length > 0) {
                  console.log(`✅ Found batch info for ${subjectCode} in combined row: "${batchText}"`);
                }
              }
              
              // Strategy 3: Check adjacent columns in subjectRow (within 3 columns)
              if (Object.keys(batchInfo).length === 0) {
                for (let adjCol = Math.max(0, backCol - 3); adjCol <= Math.min(subjectRow.length - 1, backCol + 3); adjCol++) {
                  if (adjCol === backCol) continue; // Already checked
                  const adjValue = String(subjectRow[adjCol] || '').trim();
                  if (adjValue) {
                    const adjBatchInfo = parseBatchInfo(adjValue);
                    if (Object.keys(adjBatchInfo).length > 0) {
                      batchInfo = adjBatchInfo;
                      batchText = adjValue;
                      console.log(`✅ Found batch info for ${subjectCode} in adjacent column ${adjCol}: "${adjValue}"`);
                      break;
                    }
                  }
                }
              }
              
              // Log if still no batch info found
              if (Object.keys(batchInfo).length === 0) {
                console.warn(`⚠️  No batch info found for ${subjectCode} at column ${col}. Checked:`);
                console.warn(`   - subjectRow[${backCol}]: "${currentSubjectRowValue}"`);
                console.warn(`   - combinedRow: "${combinedRow}"`);
                console.warn(`   - backSubjectRow: "${backSubjectRow}"`);
                console.warn(`   - backSubjectRowAbove: "${backSubjectRowAbove}"`);
              }
              
              let batchTotal = null;
              if (Object.keys(batchInfo).length > 0) {
                batchTotal = batchInfo[division] || null;
              }
              
              // Check if we already added this subject
              const exists = subjects.find(s => s.name === subjectCode && s.type === 'Practical' && s.attendedCol === col);
              if (!exists) {
                subjects.push({
                  name: subjectCode,
                  type: 'Practical',
                  totalLectures: batchTotal,
                  batchInfo,
                  attendedCol: col,
                  percentageCol: col + 1 < headers.length && headers[col + 1]?.toString().toLowerCase().includes('%') ? col + 1 : -1
                });
                if (Object.keys(batchInfo).length > 0) {
                  console.log(`📝 Found Lab subject: ${subjectCode} at column ${col}, batch totals: ${JSON.stringify(batchInfo)}`);
                } else {
                  console.warn(`⚠️  No batch info parsed for ${subjectCode} from text: "${batchText}" (checked column ${backCol})`);
                }
                subjectFound = true;
                break;
              }
            }
          }
        }

        // If not found above, try to extract from merged cells or adjacent columns
        if (!subjectFound && col > 0) {
          for (let i = 1; i <= 6 && (col - i >= 0 || col + i < subjectRow.length); i++) {
            const backCol = col - i;
            const fwdCol = col + i;
            const testCol = backCol >= 0 ? backCol : fwdCol;
            const testValue = String(subjectRow[testCol] || '').trim().toUpperCase();
            const testValueAbove = String(subjectRowAbove[testCol] || '').trim().toUpperCase();
            const combinedTest = `${testValueAbove} ${testValue}`;
            
            // Check for subject code patterns
            if (combinedTest.match(/[A-Z]{2,4}\s*\(TH\)/i) || combinedTest.match(/[A-Z]{2,4}\s*\(LAB\)/i)) {
              const codeMatch = combinedTest.match(/([A-Z]{2,4})\s*\(TH\)/i) || combinedTest.match(/([A-Z]{2,4})\s*\(LAB\)/i);
              if (codeMatch) {
                const isLab = combinedTest.includes('LAB');
                const totalMatch = combinedTest.match(/TOTAL[=\s:]*(\d+)/i);
                
                let batchInfo = {};
                if (isLab) {
                  // Parse batch info from the combined test string
                  batchInfo = parseBatchInfo(combinedTest);
                  
                  // If no batch info found, also check the actual subjectRow at testCol
                  if (Object.keys(batchInfo).length === 0) {
                    const testSubjectRowValue = String(subjectRow[testCol] || '').trim();
                    batchInfo = parseBatchInfo(testSubjectRowValue);
                  }
                  
                  // If still no batch info, check adjacent columns
                  if (Object.keys(batchInfo).length === 0) {
                    for (let adjCol = Math.max(0, testCol - 2); adjCol <= Math.min(subjectRow.length - 1, testCol + 2); adjCol++) {
                      const adjValue = String(subjectRow[adjCol] || '').trim();
                      const adjBatchInfo = parseBatchInfo(adjValue);
                      if (Object.keys(adjBatchInfo).length > 0) {
                        batchInfo = adjBatchInfo;
                        break;
                      }
                    }
                  }
                }
                
                const exists = subjects.find(s => s.name === codeMatch[1] && s.type === (isLab ? 'Practical' : 'Theory') && s.attendedCol === col);
                if (!exists) {
                  subjects.push({
                    name: codeMatch[1],
                    type: isLab ? 'Practical' : 'Theory',
                    totalLectures: isLab ? (batchInfo[division] || null) : (totalMatch ? parseInt(totalMatch[1]) : null),
                    batchInfo: isLab ? batchInfo : null,
                    attendedCol: col,
                    percentageCol: col + 1 < headers.length && headers[col + 1]?.toString().toLowerCase().includes('%') ? col + 1 : -1
                  });
                  console.log(`📝 Found subject (fallback): ${codeMatch[1]} (${isLab ? 'Lab' : 'Theory'}) at column ${col}`);
                  subjectFound = true;
                  break;
                }
              }
            }
            
            // Also check for simple subject codes (2-4 uppercase letters)
            if (!subjectFound && testValue && testValue.match(/^[A-Z]{2,4}$/)) {
              const isTheory = (theoryStartCol !== -1 && testCol >= theoryStartCol && testCol < (labStartCol !== -1 ? labStartCol : headers.length));
              const isLab = (labStartCol !== -1 && testCol >= labStartCol);
              
              if (isTheory || isLab) {
                const exists = subjects.find(s => s.name === testValue && s.type === (isLab ? 'Practical' : 'Theory') && s.attendedCol === col);
                if (!exists) {
                  subjects.push({
                    name: testValue,
                    type: isLab ? 'Practical' : 'Theory',
                    totalLectures: null,
                    batchInfo: null,
                    attendedCol: col,
                    percentageCol: col + 1 < headers.length && headers[col + 1]?.toString().toLowerCase().includes('%') ? col + 1 : -1
                  });
                  console.log(`📝 Found subject (simple): ${testValue} (${isLab ? 'Lab' : 'Theory'}) at column ${col}`);
                  subjectFound = true;
                  break;
                }
              }
            }
          }
        }
      }
    }

    console.log(`🔍 Parsed ${subjects.length} subjects from sheet:`, subjects.map(s => `${s.name} (${s.type})`).join(', '));
    
    if (subjects.length === 0) {
      // Debug: Log what we found in the sheet
      console.log('❌ No subjects found. Debug info:');
      console.log(`   Header row index: ${headerRowIndex}`);
      console.log(`   Subject row index: ${subjectHeaderRowIndex}`);
      console.log(`   Sample header row: ${headers.slice(0, 10).join(' | ')}`);
      console.log(`   Sample subject row: ${subjectRow.slice(0, 10).join(' | ')}`);
      console.log(`   Sample subject row above: ${subjectRowAbove.slice(0, 10).join(' | ')}`);
      
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: 'Could not identify any subjects in the sheet. Please ensure the sheet format matches the expected structure with subject names in Row 4 (e.g., "SE (Th)", "CNS (Lab)")' 
      });
    }

    // Get all subjects from database to map
    const allDbSubjects = await Subject.find();
    const subjectMap = {};
    
    console.log(`📚 Found ${subjects.length} subjects in sheet, ${allDbSubjects.length} subjects in database`);
    if (allDbSubjects.length > 0) {
      console.log(`   Available subjects in DB: ${allDbSubjects.map(s => `${s.code}(${s.name})`).join(', ')}`);
    }
    
    // Map sheet subjects to database subjects
    const unmatchedSubjects = [];
    for (const sheetSubject of subjects) {
      // Try multiple matching strategies
      let dbSubject = allDbSubjects.find(s => 
        s.code.toUpperCase() === sheetSubject.name.toUpperCase()
      );
      
      // If not found by exact code match, try name matching
      if (!dbSubject) {
        dbSubject = allDbSubjects.find(s => 
          s.name.toUpperCase().includes(sheetSubject.name.toUpperCase()) ||
          sheetSubject.name.toUpperCase().includes(s.name.toUpperCase())
        );
      }
      
      // If still not found, try code substring matching
      if (!dbSubject) {
        dbSubject = allDbSubjects.find(s => 
          s.code.toUpperCase().includes(sheetSubject.name.toUpperCase()) ||
          sheetSubject.name.toUpperCase().includes(s.code.toUpperCase())
        );
      }
      
      if (!dbSubject) {
        unmatchedSubjects.push(sheetSubject);
        console.warn(`⚠️  Subject "${sheetSubject.name}" (${sheetSubject.type}) not found in database.`);
        continue;
      }

      console.log(`✅ Matched sheet subject "${sheetSubject.name}" to database subject "${dbSubject.name}" (${dbSubject.code})`);

      subjectMap[sheetSubject.attendedCol] = {
        subjectId: dbSubject._id,
        subjectName: dbSubject.name,
        type: sheetSubject.type,
        totalLectures: sheetSubject.totalLectures,
        batchInfo: sheetSubject.batchInfo || null
      };
      
      // Log batch info for Practical subjects
      if (sheetSubject.type === 'Practical' && sheetSubject.batchInfo) {
        console.log(`📋 Mapped Practical subject "${dbSubject.name}" (${dbSubject.code}) with batch info: ${JSON.stringify(sheetSubject.batchInfo)}`);
      }
    }
    
    if (unmatchedSubjects.length > 0 && Object.keys(subjectMap).length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: `No matching subjects found. Sheet has: ${subjects.map(s => s.name).join(', ')}, but database has: ${allDbSubjects.map(s => s.code).join(', ')}. Please ensure subjects exist with codes matching the sheet.`,
        sheetSubjects: subjects.map(s => s.name),
        databaseSubjects: allDbSubjects.map(s => ({ code: s.code, name: s.name }))
      });
    }

    // Process student rows
    let recordsCreated = 0;
    let errors = [];
    const students = await Student.find({ division }).select('_id studentId name batch division');
    
    console.log(`📊 Found ${students.length} students in database for division ${division}`);
    if (students.length > 0) {
      console.log(`   Sample student UIDs: ${students.slice(0, 5).map(s => s.studentId).join(', ')}`);
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: `No students found in database for division ${division}. Please ensure students are created with division = "${division}"` 
      });
    }

    console.log(`📋 Found ${Object.keys(subjectMap).length} subjects to process`);
    if (Object.keys(subjectMap).length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: 'No matching subjects found in database. Please ensure subjects exist with codes matching the sheet (SE, CNS, DC, AISC, TOC, etc.)' 
      });
    }

    let studentsFound = 0;
    let studentsNotFound = 0;

    const allocationUpdates = {};
    const allocationStudents = {};

    for (let rowIndex = headerRowIndex + 1; rowIndex < sheetData.length; rowIndex++) {
      const row = sheetData[rowIndex];
      if (!row || row.length === 0) continue;

      const uid = String(row[uidCol] || '').trim();
      if (!uid) continue;

      // Find student by UID
      const student = students.find(s => s.studentId === uid);
      if (!student) {
        studentsNotFound++;
        errors.push({
          row: rowIndex + 1,
          studentId: uid,
          error: `Student not found in database for division ${division}. UID: ${uid}`
        });
        continue;
      }
      
      studentsFound++;

      // Process each subject's attendance
      for (const [colIndex, subjectInfo] of Object.entries(subjectMap)) {
        const col = parseInt(colIndex);
        const attendedValue = parseFloat(row[col] || 0);
        const percentageValue = parseFloat(row[col + 1] || 0);

        if (isNaN(attendedValue) || attendedValue < 0) continue;

        // For Practical subjects, use batch-specific total if available
        if (subjectInfo.type === 'Practical') {
          // Use batch-specific total if available from sheet
          if (subjectInfo.batchInfo && subjectInfo.batchInfo[student.batch]) {
            subjectInfo.totalLectures = subjectInfo.batchInfo[student.batch];
          }
          
          // Optional: Check allocation (but don't skip if not found)
          // This is just for validation, attendance will still be created
          const allocation = await Allocation.findOne({
            subjectId: subjectInfo.subjectId,
            type: 'Practical',
            division: division,
            batch: student.batch
          });

          if (!allocation) {
            console.warn(`⚠️  No allocation found for Practical subject ${subjectInfo.subjectName}, batch ${student.batch}, division ${division}. Creating attendance anyway.`);
          } else if (!allocation.students.includes(student._id)) {
            console.warn(`⚠️  Student ${student.studentId} not in allocation for ${subjectInfo.subjectName}. Creating attendance anyway.`);
          }
        }

        // Calculate total classes - use provided total or calculate from percentage
        let totalClasses = subjectInfo.totalLectures;
        if (!totalClasses || totalClasses === 0) {
          if (percentageValue > 0) {
            totalClasses = Math.round((attendedValue / percentageValue) * 100);
          } else {
            totalClasses = Math.round(attendedValue); // Fallback: assume all attended
          }
        }
        
        // Ensure we have a valid total
        if (!totalClasses || totalClasses < attendedValue) {
          totalClasses = Math.max(Math.round(attendedValue), Math.ceil(attendedValue * 1.2)); // At least attended, or 20% buffer
        }
        
        // Calculate percentage
        const calculatedPercentage = totalClasses > 0 ? (attendedValue / totalClasses) * 100 : 0;
        const finalPercentage = percentageValue > 0 ? percentageValue : calculatedPercentage;
        
        // Extract period from sheet if available (Row 1)
        let period = null;
        if (sheetData.length > 0 && sheetData[0]) {
          const periodRow = sheetData[0].join(' ');
          const periodMatch = periodRow.match(/([A-Za-z]{3}-\d{2}\s+to\s+[A-Za-z]{3}-\d{2})/i) || 
                             periodRow.match(/(\d{4}-\d{2}\s+to\s+\d{4}-\d{2})/i);
          if (periodMatch) {
            period = periodMatch[1];
          }
        }

        // Create or update summary attendance record
        const totalAttended = Math.round(attendedValue);
        const totalConducted = Math.round(totalClasses);

        // Build query - if period is null, match any record with null period for this student-subject-type
        const query = {
          studentId: student._id,
          subjectId: subjectInfo.subjectId,
          type: subjectInfo.type
        };
        
        // Only include period in query if it's set
        if (period) {
          query.period = period;
        } else {
          // When period is null, match records where period is null or doesn't exist
          query.$or = [
            { period: null },
            { period: { $exists: false } }
          ];
        }

        // Use upsert to update if exists, create if not
        const attendanceRecord = await Attendance.findOneAndUpdate(
          query,
          {
            $set: {
              totalConducted: totalConducted,
              totalAttended: totalAttended,
              percentage: finalPercentage,
              period: period || null,
              division: division,
              batch: subjectInfo.type === 'Practical' ? student.batch : null,
              recordedBy: teacherId,
              updatedAt: new Date()
            }
          },
          {
            upsert: true,
            new: true
          }
        );

        recordsCreated++;

        // Update student's attendance record reference
        await Student.findByIdAndUpdate(student._id, {
          $addToSet: { attedanceRecord: attendanceRecord._id }
        });

        // Track allocation updates
        // For Theory: key = "subjectId_Theory_division"
        // For Practical: key = "subjectId_Practical_division_batch"
        const batchKey = subjectInfo.type === 'Practical' ? (student.batch || '') : '';
        const allocationKey = `${subjectInfo.subjectId}_${subjectInfo.type}_${division}_${batchKey}`;
        
        // The "Total" from sheet header (e.g., "SE(Th) - Total = 32") is the SAME for all students
        // This represents the total conducted lectures used in percentage calculation
        // Example: SE(Th) - Total = 32, Attended = 28, Percentage = 88% (28/32 = 87.5% ≈ 88%)
        // 
        // For Allocation schema:
        // - totalPlanned: The "Total = 32" from sheet header (same for all students)
        // - totalConducted: The "Total = 32" from sheet header (same for all students)
        // We MUST use the value from sheet header, NOT the calculated per-student value
        // because the calculated value can vary per student and cause incorrect results
        
        let totalFromSheetHeader = null;
        if (subjectInfo.type === 'Practical' && subjectInfo.batchInfo && subjectInfo.batchInfo[student.batch]) {
          // For Practical: use batch-specific total from sheet header (e.g., "A=10, B=11")
          totalFromSheetHeader = subjectInfo.batchInfo[student.batch];
        } else if (subjectInfo.totalLectures && subjectInfo.totalLectures > 0) {
          // For Theory: use totalLectures from sheet header (e.g., "Total = 32")
          totalFromSheetHeader = subjectInfo.totalLectures;
        }
        
        // Only track if we have a valid value from sheet header
        // This ensures we use the consistent value from sheet, not calculated per-student values
        if (totalFromSheetHeader && totalFromSheetHeader > 0) {
          if (!allocationUpdates[allocationKey]) {
            allocationUpdates[allocationKey] = {
              subjectId: subjectInfo.subjectId,
              type: subjectInfo.type,
              division: division,
              batch: subjectInfo.type === 'Practical' ? batchKey : null,
              totalPlanned: totalFromSheetHeader,
              totalConducted: totalFromSheetHeader // Same as planned - from sheet header
            };
            if (subjectInfo.type === 'Practical') {
              console.log(`📊 Tracking Practical allocation update: ${subjectInfo.subjectName}, batch ${batchKey}, totalPlanned=${totalFromSheetHeader}, totalConducted=${totalFromSheetHeader}`);
            }
          } else {
            // Update both values - use the value from sheet header (should be same for all students)
            // Only update if we have a valid value
            allocationUpdates[allocationKey].totalPlanned = totalFromSheetHeader;
            allocationUpdates[allocationKey].totalConducted = totalFromSheetHeader;
          }
        } else if (subjectInfo.type === 'Practical') {
          console.warn(`⚠️  No totalFromSheetHeader for Practical subject ${subjectInfo.subjectName}, batch ${batchKey}. batchInfo: ${JSON.stringify(subjectInfo.batchInfo)}`);
        }

        if (!allocationStudents[allocationKey]) {
          allocationStudents[allocationKey] = {
            subjectId: subjectInfo.subjectId,
            type: subjectInfo.type,
            division: division,
            batch: subjectInfo.type === 'Practical' ? batchKey : null,
            students: new Set()
          };
        }
        allocationStudents[allocationKey].students.add(student._id);
      }
    }

    // Update Allocation entries with totalPlanned and totalConducted
    console.log(`📊 Updating ${Object.keys(allocationUpdates).length} allocation entries...`);
    let allocationsUpdated = 0;
    for (const [key, updateInfo] of Object.entries(allocationUpdates)) {
      try {
        const allocationQuery = {
          subjectId: updateInfo.subjectId,
          type: updateInfo.type,
          division: updateInfo.division
        };
        
        // For Practical subjects, include batch in query
        if (updateInfo.type === 'Practical' && updateInfo.batch) {
          allocationQuery.batch = updateInfo.batch;
        }

        const allocation = await Allocation.findOneAndUpdate(
          allocationQuery,
          {
            $set: {
              totalPlanned: updateInfo.totalPlanned || 0,
              totalConducted: updateInfo.totalConducted || 0
            }
          },
          { new: true }
        );

        if (allocation) {
          allocationsUpdated++;
          console.log(`✅ Updated allocation for ${updateInfo.type} subject ${updateInfo.subjectId}, division ${updateInfo.division}${updateInfo.batch ? `, batch ${updateInfo.batch}` : ''}: totalPlanned=${updateInfo.totalPlanned}, totalConducted=${updateInfo.totalConducted}`);
        } else {
          console.warn(`⚠️  Allocation not found for ${updateInfo.type} subject ${updateInfo.subjectId}, division ${updateInfo.division}${updateInfo.batch ? `, batch ${updateInfo.batch}` : ''}`);
        }
      } catch (error) {
        console.error(`❌ Error updating allocation for key ${key}:`, error);
      }
    }

    const studentUpdateKeys = Object.keys(allocationStudents);
    if (studentUpdateKeys.length > 0) {
      for (const k of studentUpdateKeys) {
        const info = allocationStudents[k];
        const query = {
          subjectId: info.subjectId,
          type: info.type,
          division: info.division
        };
        if (info.type === 'Practical' && info.batch) {
          query.batch = info.batch;
        }
        const ids = Array.from(info.students);
        try {
          await Allocation.updateOne(query, { $addToSet: { students: { $each: ids } } });
        } catch (e) {}
      }
    }

    // Clean up file
    fs.unlinkSync(filePath);

    // Check for defaulters in background
    setImmediate(async () => {
      try {
        const defaulters = await checkDefaulters(75);
        if (defaulters.length > 0 && req.io) {
          await req.io.emitToRole('admin', 'defaulter-alert', {
            defaulters,
            threshold: 75,
            triggeredBy: teacherId,
            source: 'division-sheet-upload'
          });
        }
      } catch (error) {
        console.error('Error checking defaulters after sheet upload:', error);
      }
    });

    console.log(`✅ Processing complete: ${recordsCreated} records created, ${studentsFound} students found, ${studentsNotFound} students not found, ${allocationsUpdated} allocations updated`);

    res.json({
      success: true,
      message: `Successfully processed attendance sheet for division ${division}`,
      recordsCreated,
      subjectsProcessed: Object.keys(subjectMap).length,
      studentsFound,
      studentsNotFound,
      totalStudentsInSheet: studentsFound + studentsNotFound,
      allocationsUpdated,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit errors to first 10
      errorCount: errors.length
    });

  } catch (error) {
    console.error('Process division sheet error:', error);
    try { fs.unlinkSync(filePath); } catch (_) {}
    throw error;
  }
}

// Get attendance for student
router.get('/student/:studentId', authMiddleware, async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const attendance = await Attendance.find({ studentId })
      .populate('subjectId', 'name code')
      .populate('recordedBy', 'teacherName')
      .sort({ updatedAt: -1 });

    // Group by subject and type, but use the most recent record's totals
    const subjectStats = {};
    
    attendance.forEach(record => {
      if (!record.subjectId) return;
      const subjectId = record.subjectId._id.toString();
      const key = `${subjectId}_${record.type}`;

      const current = subjectStats[key];
      if (!current || (record.updatedAt && current.updatedAt && new Date(record.updatedAt) > new Date(current.updatedAt))) {
        subjectStats[key] = {
          subject: record.subjectId,
          type: record.type,
          totalConducted: record.totalConducted || 0,
          totalAttended: record.totalAttended || 0,
          percentage: record.percentage && record.percentage > 0
            ? record.percentage
            : ((record.totalConducted || 0) > 0 ? ((record.totalAttended || 0) / (record.totalConducted || 0)) * 100 : 0),
          period: record.period,
          division: record.division,
          batch: record.batch,
          updatedAt: record.updatedAt
        };
      }
    });

    // Remove internal field
    Object.keys(subjectStats).forEach(k => { delete subjectStats[k].updatedAt; });

    res.json({
      attendance,
      subjectStats: Object.values(subjectStats)
    });

  } catch (error) {
    console.error('Get student attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get defaulters
router.get('/defaulters', authMiddleware, async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 75;
    const userRole = req.user.role;
    const userId = req.user.userId;
    
    // If teacher, filter by their allocated subjects
    let allocatedSubjectIds = null;
    if (userRole === 'teacher') {
      const allocations = await Allocation.find({ teacherId: userId }).select('subjectId');
      allocatedSubjectIds = allocations.map(a => a.subjectId);
      
      // If teacher has no allocations, return empty array
      if (allocatedSubjectIds.length === 0) {
        return res.json([]);
      }
    }
    
    const defaulters = await checkDefaulters(threshold, allocatedSubjectIds);
    
    res.json(defaulters);
  } catch (error) {
    console.error('Get defaulters error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/defaulters/report', authMiddleware, async (req, res) => {
  try {
    const division = req.query.division ? String(req.query.division).toUpperCase() : undefined;
    const departmentId = req.query.departmentId || undefined;
    const semesterId = req.query.semesterId || undefined;
    const userRole = req.user.role;
    const userId = req.user.userId;

    let allocatedSubjectIds = null;
    if (userRole === 'teacher') {
      const allocations = await Allocation.find({ teacherId: userId }).select('subjectId');
      allocatedSubjectIds = allocations.map(a => a.subjectId);
      if (allocatedSubjectIds.length === 0) {
        return res.json({ below50: [], between50to65: [], between65_1_to74_99: [], meta: { division, departmentId, semesterId } });
      }
    }

    const studentQuery = {};
    if (division) studentQuery.division = division;
    if (departmentId) studentQuery.departmentId = departmentId;
    if (semesterId) studentQuery.semesterId = semesterId;

    const students = await Student.find(studentQuery).select('name studentId email division batch departmentId semesterId');

    const below50 = [];
    const between50to65 = [];
    const between65_1_to74_99 = [];

    for (const student of students) {
      const attendanceQuery = { studentId: student._id };
      if (allocatedSubjectIds && allocatedSubjectIds.length > 0) {
        attendanceQuery.subjectId = { $in: allocatedSubjectIds };
      }
      const records = await Attendance.find(attendanceQuery)
        .select('totalConducted totalAttended percentage subjectId updatedAt')
        .populate('subjectId', 'name code');
      if (records.length === 0) continue;
      let total = 0;
      let present = 0;
      let percent = 0;
      // Build per-subject latest percentage map
      const perSubject = {};
      for (const r of records) {
        total += r.totalConducted || 0;
        present += r.totalAttended || 0;
        if (r.percentage && r.percentage > 0) percent = r.percentage;
        if (r.subjectId) {
          const sid = r.subjectId._id.toString();
          const existing = perSubject[sid];
          if (!existing || (r.updatedAt && existing.updatedAt && new Date(r.updatedAt) > new Date(existing.updatedAt))) {
            const subTotal = r.totalConducted || 0;
            const subPresent = r.totalAttended || 0;
            const subPercent = r.percentage && r.percentage > 0
              ? r.percentage
              : (subTotal > 0 ? (subPresent / subTotal) * 100 : 0);
            perSubject[sid] = {
              subject: r.subjectId,
              percentage: subPercent,
              updatedAt: r.updatedAt
            };
          }
        }
      }
      if (percent === 0 && total > 0) percent = (present / total) * 100;
      const subjectList = Object.values(perSubject)
        .map(s => ({ name: s.subject.name, code: s.subject.code, percentage: parseFloat(s.percentage.toFixed(2)) }));
      const item = {
        student: {
          _id: student._id,
          name: student.name,
          studentId: student.studentId,
          email: student.email,
          division: student.division,
          batch: student.batch
        },
        percentage: parseFloat(percent.toFixed(2)),
        subjects: subjectList
      };
      if (percent < 50) {
        below50.push(item);
      } else if (percent >= 50 && percent <= 65) {
        between50to65.push(item);
      } else if (percent > 65 && percent <= 74.99) {
        between65_1_to74_99.push(item);
      }
    }

    res.json({ below50, between50to65, between65_1_to74_99, meta: { division, departmentId, semesterId } });
  } catch (error) {
    console.error('Defaulter report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to check defaulters
async function checkDefaulters(threshold, allocatedSubjectIds = null) {
  try {
    const students = await Student.find().populate('attedanceRecord');
    const defaulters = [];

    for (const student of students) {
      // Build query to filter attendance by allocated subjects if provided
      const attendanceQuery = { studentId: student._id };
      if (allocatedSubjectIds && allocatedSubjectIds.length > 0) {
        attendanceQuery.subjectId = { $in: allocatedSubjectIds };
      }
      
      const attendance = await Attendance.find(attendanceQuery)
        .populate('subjectId', 'name code');

      // Skip if no attendance records found
      if (attendance.length === 0) {
        continue;
      }

      const subjectStats = {};
      
      attendance.forEach(record => {
        // Skip if subjectId is not populated or doesn't match allocated subjects
        if (!record.subjectId) {
          return;
        }
        
        const subjectId = record.subjectId._id;
        const subjectIdStr = subjectId.toString();
        
        // Double check if subject is in allocated list (for teachers)
        // Convert both to strings for comparison
        if (allocatedSubjectIds && !allocatedSubjectIds.some(id => id.toString() === subjectIdStr)) {
          return;
        }
        
        // Use summary data from the record
        if (!subjectStats[subjectIdStr]) {
          subjectStats[subjectIdStr] = {
            subject: record.subjectId,
            total: 0,
            present: 0,
            percentage: 0
          };
        }
        
        // Accumulate totals (in case there are multiple periods)
        subjectStats[subjectIdStr].total += record.totalConducted || 0;
        subjectStats[subjectIdStr].present += record.totalAttended || 0;
        
        // Use the percentage from record if available, otherwise calculate
        if (record.percentage > 0) {
          subjectStats[subjectIdStr].percentage = record.percentage;
        }
      });

      const defaulterSubjects = [];
      Object.values(subjectStats).forEach(stats => {
        // Calculate percentage from totals if not already set
        let percentage = stats.percentage;
        if (percentage === 0 && stats.total > 0) {
          percentage = (stats.present / stats.total) * 100;
        }
        
        if (percentage < threshold) {
          defaulterSubjects.push({
            subject: stats.subject,
            total: stats.total,
            present: stats.present,
            percentage: percentage
          });
        }
      });

      // Only add student if they have defaulter subjects
      if (defaulterSubjects.length > 0) {
        defaulters.push({
          student: {
            _id: student._id,
            name: student.name,
            studentId: student.studentId,
            email: student.email
          },
          defaulterSubjects
        });
      }
    }

    return defaulters;
  } catch (error) {
    console.error('Check defaulters error:', error);
    return [];
  }
}

module.exports = router;
