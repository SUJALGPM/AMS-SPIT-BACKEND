const cluster = require('cluster');
const os = require('os');
const path = require('path');

// Number of CPU cores
const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  console.log(`Starting ${numCPUs} workers...`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork({
      NODE_ID: `node-${i + 1}`,
      WORKER_ID: i + 1
    });
    
    console.log(`Worker ${worker.process.pid} started (NODE_ID: node-${i + 1})`);
  }

  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    console.log('Starting a new worker...');
    
    const newWorker = cluster.fork({
      NODE_ID: `node-${Date.now()}`,
      WORKER_ID: Date.now()
    });
    
    console.log(`New worker ${newWorker.process.pid} started`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Master received SIGTERM, shutting down gracefully...');
    
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    
    setTimeout(() => {
      console.log('Forcing shutdown...');
      process.exit(0);
    }, 10000);
  });

  // Handle worker messages for leader election coordination
  const workers = {};
  
  cluster.on('online', (worker) => {
    workers[worker.id] = {
      id: worker.id,
      pid: worker.process.pid,
      nodeId: `node-${worker.id}`,
      isLeader: false,
      lastHeartbeat: Date.now()
    };
    
    // Elect initial leader
    electLeader();
  });

  function electLeader() {
    const workerIds = Object.keys(workers).sort();
    const leaderId = workerIds[0]; // Elect worker with lowest ID
    
    // Reset all leader flags
    Object.values(workers).forEach(w => w.isLeader = false);
    
    if (workers[leaderId]) {
      workers[leaderId].isLeader = true;
      
      // Notify all workers about the new leader
      for (const id in cluster.workers) {
        cluster.workers[id].send({
          type: 'leader-election',
          leaderId: leaderId,
          isLeader: id === leaderId,
          workers: workers
        });
      }
      
      console.log(`Worker ${leaderId} (PID: ${workers[leaderId].pid}) elected as leader`);
    }
  }

  // Monitor worker health
  setInterval(() => {
    const now = Date.now();
    
    for (const [id, worker] of Object.entries(workers)) {
      if (now - worker.lastHeartbeat > 30000) { // 30 seconds timeout
        console.log(`Worker ${id} appears to be unresponsive, restarting...`);
        
        if (cluster.workers[id]) {
          cluster.workers[id].kill();
        }
        
        delete workers[id];
        electLeader();
      }
    }
  }, 10000); // Check every 10 seconds

} else {
  // Worker process
  const express = require('express');
  const mongoose = require('mongoose');
  const cors = require('cors');
  const cookieParser = require('cookie-parser');
  const { createServer } = require('http');
  const { Server } = require('socket.io');
  require('dotenv').config();

  const app = express();
  const server = createServer(app);
  
  // Configure Socket.IO with Redis adapter for clustering
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true
    },
    adapter: process.env.REDIS_URL ? require('socket.io-redis')(process.env.REDIS_URL) : undefined
  });

  // Middleware
  app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Add worker info to requests
  app.use((req, res, next) => {
    req.workerId = process.env.WORKER_ID;
    req.nodeId = process.env.NODE_ID;
    req.pid = process.pid;
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      workerId: process.env.WORKER_ID,
      nodeId: process.env.NODE_ID,
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  });

  // Worker info endpoint
  app.get('/worker-info', (req, res) => {
    res.json({
      workerId: process.env.WORKER_ID,
      nodeId: process.env.NODE_ID,
      pid: process.pid,
      isLeader: process.isLeader || false,
      uptime: process.uptime(),
      connections: io.engine.clientsCount
    });
  });

  // Database connection with retry logic
  async function connectDB() {
    const maxRetries = 5;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system', {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        });
        console.log(`Worker ${process.env.NODE_ID} connected to MongoDB`);
        break;
      } catch (error) {
        retries++;
        console.error(`Worker ${process.env.NODE_ID} DB connection attempt ${retries} failed:`, error.message);
        
        if (retries === maxRetries) {
          console.error('Max retries reached, exiting...');
          process.exit(1);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000 * retries));
      }
    }
  }

  // Socket.IO setup
  require('./sockets/socketHandlers')(io);

  // Make io available to routes
  app.use((req, res, next) => {
    req.io = io;
    next();
  });

  // Routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/attendance', require('./routes/attendance'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/grievances', require('./routes/grievances'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/teacher', require('./routes/teacher'));
  app.use('/api/student', require('./routes/student'));

  // Handle master messages
  process.on('message', (msg) => {
    if (msg.type === 'leader-election') {
      process.isLeader = msg.isLeader;
      console.log(`Worker ${process.env.NODE_ID} ${msg.isLeader ? 'is now' : 'is no longer'} the leader`);
      
      // Notify connected clients about leadership change
      io.emit('leadership-change', {
        nodeId: process.env.NODE_ID,
        isLeader: msg.isLeader,
        leaderId: msg.leaderId
      });
    }
  });

  // Send heartbeat to master
  setInterval(() => {
    if (process.send) {
      process.send({
        type: 'heartbeat',
        workerId: process.env.WORKER_ID,
        nodeId: process.env.NODE_ID,
        timestamp: Date.now(),
        connections: io.engine.clientsCount,
        memory: process.memoryUsage()
      });
    }
  }, 5000);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log(`Worker ${process.env.NODE_ID} received SIGTERM, shutting down gracefully...`);
    
    server.close(() => {
      mongoose.connection.close(false, () => {
        console.log(`Worker ${process.env.NODE_ID} shut down gracefully`);
        process.exit(0);
      });
    });
  });

  // Start server
  async function startServer() {
    await connectDB();
    
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Worker ${process.env.NODE_ID} (PID: ${process.pid}) running on port ${PORT}`);
    });
  }

  startServer().catch(error => {
    console.error(`Worker ${process.env.NODE_ID} failed to start:`, error);
    process.exit(1);
  });
}