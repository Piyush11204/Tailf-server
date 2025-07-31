const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws'); // Optional: Replace with native WebSocket server if fully strict

const PORT = 3000;
const UPLOAD_DIR = './uploads';
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    fs.readFile(INDEX_PATH, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Error loading index.html');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/api/files') {
    fs.readdir(UPLOAD_DIR, (err, files) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Native WebSocket Server without `socket.io`
const clients = new Set();

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);

  ws.on('message', (msg) => {
    try {
      const { type, filename, lines } = JSON.parse(msg);
      const filePath = path.join(UPLOAD_DIR, filename);

      if (!fs.existsSync(filePath)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'File not found' }));
      }

      if (type === 'start-tail') {
        // Send last N lines
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n').filter(Boolean);
        const lastLines = allLines.slice(-lines);
        ws.send(JSON.stringify({ type: 'initial-lines', lines: lastLines }));

        let lastSize = fs.statSync(filePath).size;

        const watcher = setInterval(() => {
          const stats = fs.statSync(filePath);
          if (stats.size > lastSize) {
            const stream = fs.createReadStream(filePath, {
              start: lastSize,
              encoding: 'utf8',
            });

            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk;
              const newLines = buffer.split('\n');
              buffer = newLines.pop(); // Keep incomplete line

              newLines.forEach(line => {
                if (line.trim()) {
                  ws.send(JSON.stringify({ type: 'new-line', line }));
                }
              });
            });

            stream.on('end', () => {
              lastSize = stats.size;
            });
          }
        }, 1000);

        ws.on('close', () => clearInterval(watcher));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
