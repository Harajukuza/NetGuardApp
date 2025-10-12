/**
 * NetGuard Test Webhook Server
 * Simple Express server for testing URL monitoring callbacks
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store received webhooks in memory (for testing)
let webhookHistory = [];
let healthCheckCount = 0;

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'active',
    message: 'NetGuard Test Server',
    endpoints: {
      health: '/health',
      webhook: '/webhook',
      history: '/webhook/history',
      clear: '/webhook/clear',
      simulate: {
        success: '/simulate/200',
        error: '/simulate/500',
        timeout: '/simulate/timeout',
        random: '/simulate/random'
      }
    },
    stats: {
      webhooksReceived: webhookHistory.length,
      healthChecks: healthCheckCount
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  healthCheckCount++;
  console.log(`Health check #${healthCheckCount} from: ${req.headers['user-agent']}`);

  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checkNumber: healthCheckCount,
    userAgent: req.headers['user-agent']
  });
});

// HEAD request for health (URL monitoring)
app.head('/health', (req, res) => {
  healthCheckCount++;
  console.log(`HEAD health check #${healthCheckCount}`);
  res.status(200).end();
});

// Webhook receiver endpoint
app.post('/webhook', (req, res) => {
  const webhook = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    headers: {
      'x-netguard-name': req.headers['x-netguard-name'],
      'x-netguard-version': req.headers['x-netguard-version'],
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    },
    body: req.body,
    ip: req.ip
  };

  webhookHistory.push(webhook);

  // Keep only last 100 webhooks in memory
  if (webhookHistory.length > 100) {
    webhookHistory = webhookHistory.slice(-100);
  }

  console.log('\n=== WEBHOOK RECEIVED ===');
  console.log(`ID: ${webhook.id}`);
  console.log(`From: ${req.headers['x-netguard-name'] || 'Unknown'}`);
  console.log(`Background: ${req.body.isBackground || false}`);
  console.log(`Results: ${req.body.results?.length || 0} URLs checked`);

  if (req.body.results) {
    req.body.results.forEach((result, index) => {
      console.log(`  [${index + 1}] ${result.url}: ${result.status} (${result.responseTime}ms)`);
    });
  }

  if (req.body.deviceInfo) {
    console.log(`Device: ${req.body.deviceInfo.platform} v${req.body.deviceInfo.version}`);
    console.log(`Battery: ${(req.body.deviceInfo.batteryLevel * 100).toFixed(0)}%`);
  }

  if (req.body.stats) {
    console.log(`Stats: ${req.body.stats.totalChecks} total checks`);
    console.log(`Success Rate: ${((req.body.stats.successfulChecks / req.body.stats.totalChecks) * 100).toFixed(1)}%`);
  }
  console.log('========================\n');

  // Save to file for persistence
  const logFile = path.join(__dirname, 'webhook-log.json');
  fs.appendFileSync(logFile, JSON.stringify(webhook) + '\n');

  res.status(200).json({
    success: true,
    received: true,
    id: webhook.id,
    message: 'Webhook processed successfully',
    timestamp: webhook.timestamp
  });
});

// Get webhook history
app.get('/webhook/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const recentWebhooks = webhookHistory.slice(-limit).reverse();

  res.json({
    total: webhookHistory.length,
    limit,
    webhooks: recentWebhooks.map(w => ({
      id: w.id,
      timestamp: w.timestamp,
      isBackground: w.body.isBackground,
      resultsCount: w.body.results?.length || 0,
      platform: w.body.deviceInfo?.platform,
      netguardName: w.headers['x-netguard-name']
    }))
  });
});

// Get detailed webhook by ID
app.get('/webhook/:id', (req, res) => {
  const webhook = webhookHistory.find(w => w.id === req.params.id);

  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  res.json(webhook);
});

// Clear webhook history
app.delete('/webhook/clear', (req, res) => {
  const count = webhookHistory.length;
  webhookHistory = [];
  healthCheckCount = 0;

  res.json({
    success: true,
    cleared: count,
    message: `Cleared ${count} webhooks from history`
  });
});

// Simulation endpoints for testing different responses
app.get('/simulate/200', (req, res) => {
  res.status(200).json({ status: 'success', code: 200 });
});

app.head('/simulate/200', (req, res) => {
  res.status(200).end();
});

app.get('/simulate/500', (req, res) => {
  res.status(500).json({ status: 'error', code: 500 });
});

app.head('/simulate/500', (req, res) => {
  res.status(500).end();
});

app.get('/simulate/timeout', (req, res) => {
  // Simulate timeout by not responding for 30 seconds
  const delay = parseInt(req.query.delay) || 30000;
  setTimeout(() => {
    res.status(200).json({ status: 'delayed', delay });
  }, delay);
});

app.head('/simulate/timeout', (req, res) => {
  const delay = parseInt(req.query.delay) || 30000;
  setTimeout(() => {
    res.status(200).end();
  }, delay);
});

app.get('/simulate/random', (req, res) => {
  const statuses = [200, 201, 204, 400, 404, 500, 502, 503];
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
  const randomDelay = Math.floor(Math.random() * 2000); // 0-2 seconds

  setTimeout(() => {
    res.status(randomStatus).json({
      status: randomStatus >= 400 ? 'error' : 'success',
      code: randomStatus,
      delay: randomDelay
    });
  }, randomDelay);
});

app.head('/simulate/random', (req, res) => {
  const statuses = [200, 201, 204, 400, 404, 500, 502, 503];
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
  const randomDelay = Math.floor(Math.random() * 2000);

  setTimeout(() => {
    res.status(randomStatus).end();
  }, randomDelay);
});

// Statistics endpoint
app.get('/stats', (req, res) => {
  const stats = {
    uptime: process.uptime(),
    webhooksReceived: webhookHistory.length,
    healthChecks: healthCheckCount,
    memoryUsage: process.memoryUsage(),
    recentWebhooks: webhookHistory.slice(-5).map(w => ({
      timestamp: w.timestamp,
      resultsCount: w.body.results?.length || 0
    }))
  };

  res.json(stats);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('=====================================');
  console.log('    NetGuard Test Webhook Server');
  console.log('=====================================');
  console.log(`Server running on port ${PORT}`);
  console.log(`Local:   http://localhost:${PORT}`);

  // Get network IP
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  Object.keys(networkInterfaces).forEach(interfaceName => {
    networkInterfaces[interfaceName].forEach(interface => {
      if (interface.family === 'IPv4' && !interface.internal) {
        console.log(`Network: http://${interface.address}:${PORT}`);
      }
    });
  });

  console.log('\nAvailable endpoints:');
  console.log('  GET  /              - Server info');
  console.log('  GET  /health        - Health check');
  console.log('  HEAD /health        - Health check (HEAD)');
  console.log('  POST /webhook       - Receive webhooks');
  console.log('  GET  /webhook/history - View webhook history');
  console.log('  GET  /webhook/:id   - Get specific webhook');
  console.log('  DELETE /webhook/clear - Clear history');
  console.log('  GET  /simulate/*    - Simulation endpoints');
  console.log('  GET  /stats         - Server statistics');
  console.log('=====================================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nSIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;
