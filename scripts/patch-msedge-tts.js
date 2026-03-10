/**
 * Patches msedge-tts to fix race condition crash:
 * "Cannot read properties of undefined (reading 'audio')"
 * The WebSocket onmessage handler can receive data for streams
 * that have already been destroyed. This adds null checks.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'msedge-tts', 'dist', 'MsEdgeTTS.js');

if (!fs.existsSync(filePath)) {
  console.log('[patch] msedge-tts not found, skipping');
  process.exit(0);
}

let code = fs.readFileSync(filePath, 'utf-8');

// Patch _pushAudioData
code = code.replace(
  '_pushAudioData(data, requestId) {\n        this._streams[requestId].audio.push(data);\n    }',
  '_pushAudioData(data, requestId) {\n        if (this._streams[requestId]) this._streams[requestId].audio.push(data);\n    }'
);

// Patch _pushMetadata
code = code.replace(
  '_pushMetadata(data, requestId) {\n        this._streams[requestId].metadata.push(data);\n    }',
  '_pushMetadata(data, requestId) {\n        if (this._streams[requestId]) this._streams[requestId].metadata.push(data);\n    }'
);

// Patch TURN_END handler
code = code.replace(
  /this\._streams\[requestId\]\.audio\.push\(null\);(\s*}\s*else if \(message\.includes)/,
  'if (this._streams[requestId]) this._streams[requestId].audio.push(null);$1'
);

fs.writeFileSync(filePath, code, 'utf-8');
console.log('[patch] msedge-tts patched successfully');
