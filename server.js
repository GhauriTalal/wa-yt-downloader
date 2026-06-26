/*===============================================*\
|| ############################################# ||
|| # WWW.AMITDAS.SITE / Version 1.0.0          # ||
|| # ----------------------------------------- # ||
|| # Copyright 2025 AMITDAS All Rights Reserved # ||
|| ############################################# ||
\*===============================================*/

const express = require('express');
const handler = require('./api/index.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Mount the webhook handler
app.post('/', handler);
app.post('/api', handler);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📍 Webhook endpoint: http://localhost:${PORT}/`);
});
