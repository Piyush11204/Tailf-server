const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = './uploads';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// Store active watchers
const activeWatchers = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(file => {
      return fs.statSync(path.join(UPLOAD_DIR, file)).isFile();
    });
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ 
    message: 'File uploaded successfully', 
    filename: req.file.filename 
  });
});

app.get('/api/tail/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);
  const lines = parseInt(req.query.lines) || 10;
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n').filter(line => line.trim() !== '');
    const lastLines = allLines.slice(-lines);
    res.json({ lines: lastLines });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

app.delete('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      // Stop watching if active
      if (activeWatchers.has(filename)) {
        activeWatchers.get(filename).close();
        activeWatchers.delete(filename);
      }
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});


// Get the full content of a log file as plain text
app.get('/logs/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  res.sendFile(path.resolve(filePath));
});

// Socket.IO for real-time tail functionality
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('start-tail', (data) => {
    const { filename, lines = 10 } = data;
    const filePath = path.join(UPLOAD_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      socket.emit('error', { message: 'File not found' });
      return;
    }
    
    // Send initial lines
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim() !== '');
      const lastLines = allLines.slice(-lines);
      socket.emit('initial-lines', { lines: lastLines });
      
      // Start watching file
      let lastSize = fs.statSync(filePath).size;
      
      const watcher = fs.watchFile(filePath, { interval: 100 }, (curr, prev) => {
        if (curr.size > prev.size) {
          const stream = fs.createReadStream(filePath, {
            start: lastSize,
            encoding: 'utf8'
          });
          
          let buffer = '';
          stream.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line
            
            lines.forEach(line => {
              if (line.trim()) {
                socket.emit('new-line', { line: line.trim() });
              }
            });
          });
          
          stream.on('end', () => {
            lastSize = curr.size;
          });
        }
      });
      
      activeWatchers.set(`${socket.id}-${filename}`, watcher);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to read file' });
    }
  });
  
  socket.on('stop-tail', (data) => {
    const { filename } = data;
    const watcherKey = `${socket.id}-${filename}`;
    
    if (activeWatchers.has(watcherKey)) {
      fs.unwatchFile(path.join(UPLOAD_DIR, filename));
      activeWatchers.delete(watcherKey);
      socket.emit('tail-stopped', { filename });
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Clean up watchers for this socket
    for (const [key, watcher] of activeWatchers.entries()) {
      if (key.startsWith(socket.id)) {
        const filename = key.split('-').slice(1).join('-');
        fs.unwatchFile(path.join(UPLOAD_DIR, filename));
        activeWatchers.delete(key);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`��� Tail server running on http://localhost:${PORT}`);
  console.log(`�� Upload directory: ${path.resolve(UPLOAD_DIR)}`);
});
