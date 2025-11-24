const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const colors = require('colors');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');
const FaultToleranceManager = require('./services/faultTolerance');
require('dotenv').config();

// Create Express app and HTTP server
const app = express();
const server = createServer(app);

// Initialize Fault Tolerance Manager
const faultTolerance = new FaultToleranceManager();

// Middleware
// app.use(cors({
//   origin: process.env.CLIENT_URL || "http://localhost:5173",
//   credentials: true
// }));

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Attach distributed system info to every request
app.use((req, res, next) => {
  req.nodeId = process.env.NODE_ID || 'node-1';
  req.workerId = process.env.WORKER_ID || '1';
  req.faultTolerance = faultTolerance;
  next();
});

// -------------------------
// Socket.IO Setup
// -------------------------
const ioOptions = {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true
  }
};

const io = new Server(server, ioOptions);

// ✅ Optional Redis Adapter for clustering
if (process.env.REDIS_URL) {
  const { createAdapter } = require('@socket.io/redis-adapter');
  const { createClient } = require('redis');

  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('🔁 Socket.IO Redis Adapter connected');
    })
    .catch(err => console.error('Redis Adapter connection error:', err));
}

// -------------------------
// Health Check Endpoints
// -------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    nodeId: req.nodeId,
    workerId: req.workerId,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    connections: io.engine.clientsCount,
    timestamp: new Date().toISOString(),
    isLeader: faultTolerance.isLeader
  });
});

app.get('/system-info', (req, res) => {
  res.json({
    nodeId: req.nodeId,
    workerId: req.workerId,
    pid: process.pid,
    isLeader: faultTolerance.isLeader,
    uptime: process.uptime(),
    connections: io.engine.clientsCount,
    lastCheckpoint: faultTolerance.lastCheckpoint,
    operationLogSize: faultTolerance.operationLog.length,
    replicationNodes: faultTolerance.replicationNodes.length
  });
});

// -------------------------
// MongoDB Connection (Retry Logic)
// -------------------------
async function connectDatabase() {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
      console.log(`✅ Node ${process.env.NODE_ID || 'node-1'} connected to MongoDB`);

      // Attempt recovery
      const recovered = await faultTolerance.recoverFromFailure();
      if (recovered) console.log('🩺 System recovered from last checkpoint');

      break;
    } catch (error) {
      retries++;
      console.error(`❌ MongoDB connection attempt ${retries} failed:`, error.message);
      if (retries === maxRetries) {
        console.error('Max retries reached. Exiting...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000)); // exponential backoff
    }
  }
}

// -------------------------
// Socket.IO Event Handling
// -------------------------
require('./sockets/socketHandlers')(io);

io.on('connection', (socket) => {
  faultTolerance.logOperation({
    type: 'user-connection',
    userId: socket.user?.userId,
    nodeId: process.env.NODE_ID,
    timestamp: new Date().toISOString()
  });
});

// -------------------------
// Attach IO and FaultTolerance to Routes
// -------------------------
app.use((req, res, next) => {
  req.io = io;
  req.faultTolerance = faultTolerance;
  next();
});

// -------------------------
// Routes
// -------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/grievances', require('./routes/grievances'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));

// -------------------------
// Error Handling
// -------------------------
app.use((error, req, res, next) => {
  console.error('Server error:', error);

  req.faultTolerance.logOperation({
    type: 'server-error',
    error: error.message,
    stack: error.stack,
    nodeId: process.env.NODE_ID,
    timestamp: new Date().toISOString()
  });

  res.status(500).json({
    message: 'Internal server error',
    nodeId: process.env.NODE_ID,
    timestamp: new Date().toISOString()
  });
});

// -------------------------
// Graceful Shutdown
// -------------------------
async function gracefulShutdown(signal) {
  console.log(`\n⚠️ ${signal} received by Node ${process.env.NODE_ID}, shutting down gracefully...`);
  try {
    await faultTolerance.createSystemCheckpoint();
    console.log('💾 Final checkpoint saved.');
  } catch (err) {
    console.error('Checkpoint creation failed:', err);
  }

  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('🛑 MongoDB and server connections closed.');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  try {
    await faultTolerance.createCheckpoint('emergency', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Emergency checkpoint failed:', err);
  }
  process.exit(1);
});

// -------------------------
// Start Server
// -------------------------
async function startServer() {
  try {
    await connectDatabase();
    const PORT = process.env.PORT || 5000;

    server.listen(PORT, () => {
      console.log(`Distend-Backend live...`.bgCyan.white);
      console.log(`Distend-Backend-Database connected...`.bgGreen.white);
      console.log(`🚀 Node ${process.env.NODE_ID || 'node-1'} running on port ${PORT}`);
      console.log(`🧩 Worker ID: ${process.env.WORKER_ID || '1'}`);
      console.log(`💾 Fault Tolerance: Enabled`);
      console.log(`🔄 Load Balancing: ${process.env.REDIS_URL ? 'Redis Cluster' : 'Single Node'}`);
    });

    // Start allocation sync worker (runs continuously in background)
    const allocationSyncWorker = require('./workers/allocationSyncWorker');
    allocationSyncWorker.startSyncWorker();
    console.log('📋 Allocation sync worker started (runs every 5 minutes)');

    // Leader election status
    if (process.env.IS_LEADER === 'true') {
      faultTolerance.setLeaderStatus(true);
      console.log('👑 This node is acting as leader');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();