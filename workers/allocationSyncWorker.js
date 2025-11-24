const mongoose = require('mongoose');
const Allocation = require('../models/Allocation');
const Student = require('../models/Student');

// Configuration
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
let syncInterval = null;
let isRunning = false;

/**
 * Sync students to allocations based on division and batch
 * This function matches students to allocations:
 * - Theory: Match by division only
 * - Practical: Match by division AND batch
 */
async function syncAllocationStudents() {
  if (isRunning) {
    console.log('⚠️  Allocation sync already running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log('🔄 Starting allocation student sync...');

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
              allocationId: allocation._id.toString(),
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
              allocationId: allocation._id.toString(),
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

        // Check if students array needs updating
        const currentStudentIds = allocation.students.map(id => id.toString()).sort();
        const newStudentIds = studentIds.map(id => id.toString()).sort();
        
        const needsUpdate = JSON.stringify(currentStudentIds) !== JSON.stringify(newStudentIds);

        if (needsUpdate) {
          // Update allocation with student IDs (replace existing)
          allocation.students = studentIds;
          await allocation.save();

          results.updatedAllocations++;
          results.totalStudentsAdded += studentIds.length;
          
          console.log(`✅ Updated allocation ${allocation._id}: ${studentIds.length} students (${allocation.type}, Div: ${allocation.division}${allocation.batch ? `, Batch: ${allocation.batch}` : ''})`);
        }

      } catch (error) {
        console.error(`❌ Error syncing allocation ${allocation._id}:`, error.message);
        results.errors.push({
          allocationId: allocation._id.toString(),
          error: error.message
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Allocation sync completed in ${duration}ms`);
    console.log(`   - Total allocations: ${results.totalAllocations}`);
    console.log(`   - Updated: ${results.updatedAllocations}`);
    console.log(`   - Total students added: ${results.totalStudentsAdded}`);
    if (results.errors.length > 0) {
      console.log(`   - Errors: ${results.errors.length}`);
    }

    return results;

  } catch (error) {
    console.error('❌ Allocation sync error:', error);
    throw error;
  } finally {
    isRunning = false;
  }
}

/**
 * Start the background sync worker
 * @param {number} interval - Sync interval in milliseconds (default: 5 minutes)
 */
function startSyncWorker(interval = SYNC_INTERVAL) {
  if (syncInterval) {
    console.log('⚠️  Allocation sync worker already running');
    return;
  }

  console.log(`🚀 Starting allocation sync worker (interval: ${interval / 1000}s)`);
  
  // Run immediately on start
  syncAllocationStudents().catch(err => {
    console.error('Initial sync failed:', err);
  });

  // Then run at intervals
  syncInterval = setInterval(() => {
    syncAllocationStudents().catch(err => {
      console.error('Periodic sync failed:', err);
    });
  }, interval);
}

/**
 * Stop the background sync worker
 */
function stopSyncWorker() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('🛑 Allocation sync worker stopped');
  }
}

/**
 * Run sync once (manual trigger)
 */
async function runSyncOnce() {
  return await syncAllocationStudents();
}

module.exports = {
  startSyncWorker,
  stopSyncWorker,
  runSyncOnce,
  syncAllocationStudents
};

