const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class FaultToleranceManager extends EventEmitter {
  constructor() {
    super();
    this.checkpointDir = path.join(__dirname, '../checkpoints');
    this.logDir = path.join(__dirname, '../logs');
    this.replicationNodes = [];
    this.isLeader = false;
    this.lastCheckpoint = null;
    this.operationLog = [];
    this.maxLogSize = 1000;
    
    this.initializeDirectories();
    this.startPeriodicCheckpointing();
  }

  async initializeDirectories() {
    try {
      await fs.mkdir(this.checkpointDir, { recursive: true });
      await fs.mkdir(this.logDir, { recursive: true });
      console.log('Fault tolerance directories initialized');
    } catch (error) {
      console.error('Error initializing directories:', error);
    }
  }

  // Checkpoint system for attendance and grievance records
  async createCheckpoint(type, data) {
    try {
      const timestamp = new Date().toISOString();
      const checkpointId = `${type}_${Date.now()}`;
      
      const checkpoint = {
        id: checkpointId,
        type,
        timestamp,
        nodeId: process.env.NODE_ID || 'node-1',
        data,
        operationCount: this.operationLog.length,
        hash: this.generateHash(data)
      };

      const filePath = path.join(this.checkpointDir, `${checkpointId}.json`);
      await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
      
      this.lastCheckpoint = checkpoint;
      
      // Replicate to other nodes
      await this.replicateCheckpoint(checkpoint);
      
      console.log(`Checkpoint created: ${checkpointId}`);
      this.emit('checkpoint-created', checkpoint);
      
      return checkpointId;
    } catch (error) {
      console.error('Error creating checkpoint:', error);
      throw error;
    }
  }

  // Log operations for replay capability
  async logOperation(operation) {
    try {
      const logEntry = {
        id: `op_${Date.now()}_${Math.random()}`,
        timestamp: new Date().toISOString(),
        nodeId: process.env.NODE_ID || 'node-1',
        operation,
        lamportTime: operation.lamportTime || 0
      };

      this.operationLog.push(logEntry);
      
      // Write to persistent log
      const logFile = path.join(this.logDir, `operations_${new Date().toISOString().split('T')[0]}.log`);
      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
      
      // Trim log if too large
      if (this.operationLog.length > this.maxLogSize) {
        this.operationLog = this.operationLog.slice(-this.maxLogSize);
      }
      
      // Replicate to other nodes
      await this.replicateOperation(logEntry);
      
      this.emit('operation-logged', logEntry);
      
    } catch (error) {
      console.error('Error logging operation:', error);
    }
  }

  // Recovery from failure
  async recoverFromFailure() {
    try {
      console.log('Starting recovery process...');
      
      // Find latest checkpoint
      const latestCheckpoint = await this.findLatestCheckpoint();
      
      if (latestCheckpoint) {
        console.log(`Recovering from checkpoint: ${latestCheckpoint.id}`);
        
        // Restore from checkpoint
        await this.restoreFromCheckpoint(latestCheckpoint);
        
        // Replay operations since checkpoint
        await this.replayOperationsSinceCheckpoint(latestCheckpoint);
        
        console.log('Recovery completed successfully');
        this.emit('recovery-completed', latestCheckpoint);
        
        return true;
      } else {
        console.log('No checkpoint found, starting fresh');
        return false;
      }
      
    } catch (error) {
      console.error('Error during recovery:', error);
      this.emit('recovery-failed', error);
      throw error;
    }
  }

  async findLatestCheckpoint() {
    try {
      const files = await fs.readdir(this.checkpointDir);
      const checkpointFiles = files.filter(f => f.endsWith('.json'));
      
      if (checkpointFiles.length === 0) return null;
      
      // Sort by timestamp (newest first)
      checkpointFiles.sort((a, b) => {
        const timeA = parseInt(a.split('_')[1]);
        const timeB = parseInt(b.split('_')[1]);
        return timeB - timeA;
      });
      
      const latestFile = checkpointFiles[0];
      const filePath = path.join(this.checkpointDir, latestFile);
      const content = await fs.readFile(filePath, 'utf8');
      
      return JSON.parse(content);
    } catch (error) {
      console.error('Error finding latest checkpoint:', error);
      return null;
    }
  }

  async restoreFromCheckpoint(checkpoint) {
    try {
      // Verify checkpoint integrity
      const expectedHash = this.generateHash(checkpoint.data);
      if (expectedHash !== checkpoint.hash) {
        throw new Error('Checkpoint integrity check failed');
      }
      
      // Restore data based on checkpoint type
      switch (checkpoint.type) {
        case 'attendance':
          await this.restoreAttendanceData(checkpoint.data);
          break;
        case 'grievances':
          await this.restoreGrievanceData(checkpoint.data);
          break;
        case 'full-system':
          await this.restoreFullSystemData(checkpoint.data);
          break;
        default:
          console.warn(`Unknown checkpoint type: ${checkpoint.type}`);
      }
      
      this.lastCheckpoint = checkpoint;
      console.log(`Restored from checkpoint: ${checkpoint.id}`);
      
    } catch (error) {
      console.error('Error restoring from checkpoint:', error);
      throw error;
    }
  }

  async replayOperationsSinceCheckpoint(checkpoint) {
    try {
      // Read operation logs since checkpoint
      const operations = await this.getOperationsSince(checkpoint.timestamp);
      
      console.log(`Replaying ${operations.length} operations since checkpoint`);
      
      // Sort operations by Lamport timestamp for correct ordering
      operations.sort((a, b) => a.lamportTime - b.lamportTime);
      
      for (const operation of operations) {
        await this.replayOperation(operation);
      }
      
      console.log('Operation replay completed');
      
    } catch (error) {
      console.error('Error replaying operations:', error);
      throw error;
    }
  }

  async getOperationsSince(timestamp) {
    try {
      const operations = [];
      const logFiles = await fs.readdir(this.logDir);
      
      for (const file of logFiles) {
        if (file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.trim().split('\n').filter(line => line);
          
          for (const line of lines) {
            try {
              const operation = JSON.parse(line);
              if (new Date(operation.timestamp) > new Date(timestamp)) {
                operations.push(operation);
              }
            } catch (parseError) {
              console.warn('Error parsing log line:', parseError);
            }
          }
        }
      }
      
      return operations;
    } catch (error) {
      console.error('Error reading operation logs:', error);
      return [];
    }
  }

  async replayOperation(logEntry) {
    try {
      const { operation } = logEntry;
      
      switch (operation.type) {
        case 'attendance-mark':
          await this.replayAttendanceMark(operation);
          break;
        case 'grievance-submit':
          await this.replayGrievanceSubmit(operation);
          break;
        case 'grievance-update':
          await this.replayGrievanceUpdate(operation);
          break;
        default:
          console.warn(`Unknown operation type: ${operation.type}`);
      }
      
    } catch (error) {
      console.error('Error replaying operation:', error);
      // Continue with other operations even if one fails
    }
  }

  // Data replication methods
  async replicateCheckpoint(checkpoint) {
    if (!this.isLeader) return;
    
    const replicationPromises = this.replicationNodes.map(async (node) => {
      try {
        await this.sendToNode(node, 'replicate-checkpoint', checkpoint);
      } catch (error) {
        console.error(`Failed to replicate checkpoint to node ${node.id}:`, error);
      }
    });
    
    await Promise.allSettled(replicationPromises);
  }

  async replicateOperation(operation) {
    if (!this.isLeader) return;
    
    const replicationPromises = this.replicationNodes.map(async (node) => {
      try {
        await this.sendToNode(node, 'replicate-operation', operation);
      } catch (error) {
        console.error(`Failed to replicate operation to node ${node.id}:`, error);
      }
    });
    
    await Promise.allSettled(replicationPromises);
  }

  async sendToNode(node, type, data) {
    // Implementation depends on your communication method (HTTP, Socket.IO, etc.)
    // This is a placeholder for the actual network communication
    console.log(`Sending ${type} to node ${node.id}`);
  }

  // Periodic sync verification
  async verifySyncWithNodes() {
    if (!this.isLeader) return;
    
    try {
      const syncPromises = this.replicationNodes.map(async (node) => {
        const nodeChecksum = await this.getNodeChecksum(node);
        const localChecksum = await this.calculateLocalChecksum();
        
        if (nodeChecksum !== localChecksum) {
          console.warn(`Sync mismatch with node ${node.id}, initiating resync`);
          await this.resyncNode(node);
        }
      });
      
      await Promise.allSettled(syncPromises);
      
    } catch (error) {
      console.error('Error verifying sync:', error);
    }
  }

  // Utility methods
  generateHash(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  async calculateLocalChecksum() {
    // Calculate checksum of current system state
    const Attendance = require('../models/Attendance');
    const Grievance = require('../models/Grievance');
    
    const [attendanceCount, grievanceCount] = await Promise.all([
      Attendance.countDocuments(),
      Grievance.countDocuments()
    ]);
    
    return this.generateHash({ attendanceCount, grievanceCount, timestamp: Date.now() });
  }

  // Periodic checkpointing
  startPeriodicCheckpointing() {
    // Create checkpoint every 5 minutes
    setInterval(async () => {
      try {
        if (this.isLeader) {
          await this.createSystemCheckpoint();
        }
      } catch (error) {
        console.error('Error in periodic checkpointing:', error);
      }
    }, 5 * 60 * 1000);
    
    // Verify sync every 10 minutes
    setInterval(async () => {
      try {
        await this.verifySyncWithNodes();
      } catch (error) {
        console.error('Error in sync verification:', error);
      }
    }, 10 * 60 * 1000);
  }

  async createSystemCheckpoint() {
    try {
      const Attendance = require('../models/Attendance');
      const Grievance = require('../models/Grievance');
      const Student = require('../models/Student');
      
      // Get recent data for checkpoint
      const recentAttendance = await Attendance.find({
        createdAtDate: { $gte: this.getDateDaysAgo(7) }
      }).limit(1000);
      
      const recentGrievances = await Grievance.find({
        createdAt: { $gte: this.getDateDaysAgo(30) }
      });
      
      const systemData = {
        attendance: recentAttendance,
        grievances: recentGrievances,
        metadata: {
          totalStudents: await Student.countDocuments(),
          checkpointReason: 'periodic',
          nodeId: process.env.NODE_ID
        }
      };
      
      await this.createCheckpoint('full-system', systemData);
      
    } catch (error) {
      console.error('Error creating system checkpoint:', error);
    }
  }

  getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Restore methods for different data types
  async restoreAttendanceData(data) {
    const Attendance = require('../models/Attendance');
    
    for (const record of data) {
      try {
        await Attendance.findOneAndUpdate(
          { _id: record._id },
          record,
          { upsert: true, new: true }
        );
      } catch (error) {
        console.error('Error restoring attendance record:', error);
      }
    }
  }

  async restoreGrievanceData(data) {
    const Grievance = require('../models/Grievance');
    
    for (const record of data) {
      try {
        await Grievance.findOneAndUpdate(
          { _id: record._id },
          record,
          { upsert: true, new: true }
        );
      } catch (error) {
        console.error('Error restoring grievance record:', error);
      }
    }
  }

  async restoreFullSystemData(data) {
    await Promise.all([
      this.restoreAttendanceData(data.attendance || []),
      this.restoreGrievanceData(data.grievances || [])
    ]);
  }

  // Replay methods for different operation types
  async replayAttendanceMark(operation) {
    const Attendance = require('../models/Attendance');
    const Student = require('../models/Student');
    
    try {
      const attendance = new Attendance(operation.data);
      await attendance.save();
      
      await Student.findByIdAndUpdate(
        operation.data.studentId,
        { $addToSet: { attedanceRecord: attendance._id } }
      );
      
    } catch (error) {
      // Handle duplicate key errors gracefully
      if (error.code !== 11000) {
        throw error;
      }
    }
  }

  async replayGrievanceSubmit(operation) {
    const Grievance = require('../models/Grievance');
    
    try {
      const grievance = new Grievance(operation.data);
      await grievance.save();
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }
  }

  async replayGrievanceUpdate(operation) {
    const Grievance = require('../models/Grievance');
    
    try {
      await Grievance.findByIdAndUpdate(
        operation.data.grievanceId,
        operation.data.updates,
        { new: true }
      );
    } catch (error) {
      console.error('Error replaying grievance update:', error);
    }
  }

  // Node management
  addReplicationNode(node) {
    this.replicationNodes.push(node);
    console.log(`Added replication node: ${node.id}`);
  }

  removeReplicationNode(nodeId) {
    this.replicationNodes = this.replicationNodes.filter(n => n.id !== nodeId);
    console.log(`Removed replication node: ${nodeId}`);
  }

  setLeaderStatus(isLeader) {
    this.isLeader = isLeader;
    console.log(`Node ${process.env.NODE_ID} is ${isLeader ? 'now' : 'no longer'} the leader`);
  }
}

module.exports = FaultToleranceManager;