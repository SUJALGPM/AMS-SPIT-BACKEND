const jwt = require('jsonwebtoken');
const EventEmitter = require('events');

// Distributed message queue for reliability
class DistributedMessageQueue extends EventEmitter {
  constructor() {
    super();
    this.pendingMessages = new Map();
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
  }

  async sendWithRetry(socketId, event, data, messageId = null) {
    const id = messageId || `msg_${Date.now()}_${Math.random()}`;
    
    try {
      // Store message for retry mechanism
      this.pendingMessages.set(id, {
        socketId,
        event,
        data,
        attempts: 0,
        timestamp: Date.now()
      });

      await this.attemptSend(id);
      return id;
    } catch (error) {
      console.error(`Failed to send message ${id}:`, error);
      throw error;
    }
  }

  async attemptSend(messageId) {
    const message = this.pendingMessages.get(messageId);
    if (!message) return;

    try {
      // Emit the message
      this.emit('send-message', message);
      
      // Remove from pending after successful send
      setTimeout(() => {
        this.pendingMessages.delete(messageId);
      }, 5000); // Clean up after 5 seconds
      
    } catch (error) {
      message.attempts++;
      
      if (message.attempts < this.retryAttempts) {
        console.log(`Retrying message ${messageId}, attempt ${message.attempts}`);
        setTimeout(() => this.attemptSend(messageId), this.retryDelay * message.attempts);
      } else {
        console.error(`Failed to deliver message ${messageId} after ${this.retryAttempts} attempts`);
        this.pendingMessages.delete(messageId);
      }
    }
  }

  // Clean up old messages
  cleanup() {
    const now = Date.now();
    for (const [id, message] of this.pendingMessages) {
      if (now - message.timestamp > 300000) { // 5 minutes
        this.pendingMessages.delete(id);
      }
    }
  }
}

// Lamport Clock for logical ordering
class LamportClock {
  constructor() {
    this.time = 0;
  }

  tick() {
    this.time++;
    return this.time;
  }

  update(receivedTime) {
    this.time = Math.max(this.time, receivedTime) + 1;
    return this.time;
  }

  getTime() {
    return this.time;
  }
}

module.exports = (io) => {
  const messageQueue = new DistributedMessageQueue();
  const lamportClock = new LamportClock();
  const connectedUsers = new Map(); // Track connected users for leader election

  // Clean up old messages every 5 minutes
  setInterval(() => messageQueue.cleanup(), 300000);

  // Handle message queue events
  messageQueue.on('send-message', (message) => {
    const socket = io.sockets.sockets.get(message.socketId);
    if (socket) {
      socket.emit(message.event, {
        ...message.data,
        lamportTime: lamportClock.tick(),
        messageId: message.messageId
      });
    }
  });

  // Socket authentication middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
      socket.user = decoded;
      socket.lamportTime = 0;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.email} (${socket.user.role}) - Socket: ${socket.id}`);
    
    // Add to connected users for leader election
    connectedUsers.set(socket.id, {
      userId: socket.user.userId,
      role: socket.user.role,
      email: socket.user.email,
      connectedAt: Date.now(),
      isLeader: false
    });

    // Join role-based rooms
    socket.join(socket.user.role);
    socket.join(`user_${socket.user.userId}`);

    // Perform leader election for admin users
    if (socket.user.role === 'admin') {
      performLeaderElection();
    }

    // Enhanced attendance room management
    socket.on('join-attendance-room', (data) => {
      const { subjectId, classId } = data;
      const roomName = `attendance_${subjectId}_${classId}`;
      socket.join(roomName);
      
      // Broadcast user joined with Lamport timestamp
      socket.to(roomName).emit('user-joined-attendance', {
        userId: socket.user.userId,
        userName: socket.user.email,
        lamportTime: lamportClock.tick()
      });
    });

    socket.on('leave-attendance-room', (data) => {
      const { subjectId, classId } = data;
      const roomName = `attendance_${subjectId}_${classId}`;
      socket.leave(roomName);
      
      socket.to(roomName).emit('user-left-attendance', {
        userId: socket.user.userId,
        lamportTime: lamportClock.tick()
      });
    });

    // Enhanced real-time attendance marking with distributed coordination
    socket.on('mark-attendance-live', async (data) => {
      const { subjectId, classId, studentId, status, clientLamportTime } = data;
      
      // Update Lamport clock
      const currentTime = lamportClock.update(clientLamportTime || 0);
      
      const attendanceUpdate = {
        subjectId,
        classId,
        studentId,
        status,
        markedBy: socket.user.userId,
        markerName: socket.user.email,
        timestamp: new Date().toISOString(),
        lamportTime: currentTime,
        nodeId: process.env.NODE_ID || 'node-1'
      };

      // Broadcast to attendance room with retry mechanism
      const roomName = `attendance_${subjectId}_${classId}`;
      const roomSockets = await io.in(roomName).fetchSockets();
      
      for (const roomSocket of roomSockets) {
        if (roomSocket.id !== socket.id) {
          try {
            await messageQueue.sendWithRetry(
              roomSocket.id,
              'attendance-marked-live',
              attendanceUpdate
            );
          } catch (error) {
            console.error(`Failed to send attendance update to ${roomSocket.id}:`, error);
          }
        }
      }

      // Also broadcast to all admin users for monitoring
      const adminSockets = await io.in('admin').fetchSockets();
      for (const adminSocket of adminSockets) {
        try {
          await messageQueue.sendWithRetry(
            adminSocket.id,
            'attendance-update-admin',
            attendanceUpdate
          );
        } catch (error) {
          console.error(`Failed to send admin update to ${adminSocket.id}:`, error);
        }
      }
    });

    // Enhanced grievance notifications with distributed delivery
    socket.on('join-grievance-room', (grievanceId) => {
      socket.join(`grievance_${grievanceId}`);
    });

    socket.on('grievance-status-update', async (data) => {
      const { grievanceId, status, studentId, response } = data;
      const currentTime = lamportClock.tick();
      
      const updateData = {
        grievanceId,
        status,
        response,
        updatedBy: socket.user.userId,
        lamportTime: currentTime,
        timestamp: new Date().toISOString()
      };

      // Send to specific student
      const studentSockets = await io.in(`user_${studentId}`).fetchSockets();
      for (const studentSocket of studentSockets) {
        await messageQueue.sendWithRetry(
          studentSocket.id,
          'grievance-status-updated',
          updateData
        );
      }

      // Send to grievance room
      const grievanceRoom = `grievance_${grievanceId}`;
      const grievanceSockets = await io.in(grievanceRoom).fetchSockets();
      for (const grievanceSocket of grievanceSockets) {
        if (grievanceSocket.id !== socket.id) {
          await messageQueue.sendWithRetry(
            grievanceSocket.id,
            'grievance-status-updated',
            updateData
          );
        }
      }
    });

    // Defaulter alerts with distributed coordination
    socket.on('subscribe-defaulter-alerts', () => {
      socket.join('defaulter-alerts');
    });

    socket.on('defaulter-alert-broadcast', async (data) => {
      const { defaulters, threshold, triggeredBy } = data;
      const currentTime = lamportClock.tick();
      
      const alertData = {
        defaulters,
        threshold,
        triggeredBy,
        lamportTime: currentTime,
        timestamp: new Date().toISOString(),
        nodeId: process.env.NODE_ID || 'node-1'
      };

      // Send to all subscribed users
      const alertSockets = await io.in('defaulter-alerts').fetchSockets();
      for (const alertSocket of alertSockets) {
        await messageQueue.sendWithRetry(
          alertSocket.id,
          'defaulter-alert',
          alertData
        );
      }
    });

    // System notifications for admins
    socket.on('subscribe-system-notifications', () => {
      if (socket.user.role === 'admin') {
        socket.join('system-notifications');
      }
    });

    // Heartbeat for connection monitoring
    socket.on('heartbeat', (data) => {
      socket.emit('heartbeat-ack', {
        serverTime: Date.now(),
        lamportTime: lamportClock.tick(),
        nodeId: process.env.NODE_ID || 'node-1'
      });
    });

    // Handle message acknowledgments
    socket.on('message-ack', (messageId) => {
      messageQueue.pendingMessages.delete(messageId);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.email} - Socket: ${socket.id}`);
      connectedUsers.delete(socket.id);
      
      // Re-elect leader if disconnected user was a leader
      const wasLeader = connectedUsers.get(socket.id)?.isLeader;
      if (wasLeader) {
        performLeaderElection();
      }
    });
  });

  // Leader Election Algorithm (Bully Algorithm)
  function performLeaderElection() {
    const adminUsers = Array.from(connectedUsers.values())
      .filter(user => user.role === 'admin')
      .sort((a, b) => a.userId.localeCompare(b.userId)); // Sort by userId for deterministic election

    if (adminUsers.length === 0) return;

    // Reset all leader flags
    connectedUsers.forEach(user => user.isLeader = false);

    // Elect the admin with the highest userId (lexicographically)
    const leader = adminUsers[adminUsers.length - 1];
    const leaderSocket = Array.from(connectedUsers.entries())
      .find(([socketId, user]) => user.userId === leader.userId);

    if (leaderSocket) {
      const [socketId, userData] = leaderSocket;
      userData.isLeader = true;
      
      // Notify the new leader
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('leader-elected', {
          isLeader: true,
          lamportTime: lamportClock.tick(),
          timestamp: new Date().toISOString()
        });
      }

      // Notify other admins
      adminUsers.forEach(admin => {
        if (admin.userId !== leader.userId) {
          const adminSocketEntry = Array.from(connectedUsers.entries())
            .find(([_, user]) => user.userId === admin.userId);
          
          if (adminSocketEntry) {
            const adminSocket = io.sockets.sockets.get(adminSocketEntry[0]);
            if (adminSocket) {
              adminSocket.emit('leader-elected', {
                isLeader: false,
                leaderId: leader.userId,
                lamportTime: lamportClock.tick(),
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      });

      console.log(`Leader elected: ${leader.email} (${leader.userId})`);
    }
  }

  // Enhanced helper functions with distributed coordination
  const emitToRoleWithRetry = async (role, event, data) => {
    const roleSockets = await io.in(role).fetchSockets();
    const currentTime = lamportClock.tick();
    
    const enhancedData = {
      ...data,
      lamportTime: currentTime,
      timestamp: new Date().toISOString(),
      nodeId: process.env.NODE_ID || 'node-1'
    };

    for (const socket of roleSockets) {
      try {
        await messageQueue.sendWithRetry(socket.id, event, enhancedData);
      } catch (error) {
        console.error(`Failed to send to role ${role}, socket ${socket.id}:`, error);
      }
    }
  };

  const emitToUserWithRetry = async (userId, event, data) => {
    const userSockets = await io.in(`user_${userId}`).fetchSockets();
    const currentTime = lamportClock.tick();
    
    const enhancedData = {
      ...data,
      lamportTime: currentTime,
      timestamp: new Date().toISOString(),
      nodeId: process.env.NODE_ID || 'node-1'
    };

    for (const socket of userSockets) {
      try {
        await messageQueue.sendWithRetry(socket.id, event, enhancedData);
      } catch (error) {
        console.error(`Failed to send to user ${userId}, socket ${socket.id}:`, error);
      }
    }
  };

  // Expose enhanced helper functions
  io.emitToRole = emitToRoleWithRetry;
  io.emitToUser = emitToUserWithRetry;
  io.lamportClock = lamportClock;
  io.connectedUsers = connectedUsers;
  io.messageQueue = messageQueue;
  
  // Expose leader election
  io.performLeaderElection = performLeaderElection;
  
  // Get current leader
  io.getCurrentLeader = () => {
    return Array.from(connectedUsers.values()).find(user => user.isLeader);
  };
};