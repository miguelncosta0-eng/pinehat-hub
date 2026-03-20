const { createClient } = require('@supabase/supabase-js');

// Lazy require to avoid circular dependency (ipc-settings → supabase → ipc-settings)
function getSettings() {
  return require('./ipc-settings').getSettings();
}

const SUPABASE_URL = 'https://cgdyqvvsxegmvzydbajq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZHlxdnZzeGVnbXZ6eWRiYWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzA1OTcsImV4cCI6MjA4OTYwNjU5N30.5niHWNCSfc6EozoferNn8yf4gVEKjicVzbdGmgExdsU';

let supabase = null;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return supabase;
}

// Check if a channel is shared (has supabaseChannelId in settings)
function isChannelShared(channelId) {
  const settings = getSettings();
  const channel = settings.channels?.[channelId];
  return !!(channel && channel.shared && channel.supabaseChannelId);
}

// Get the Supabase channel UUID for a local channel
function getSupabaseChannelId(channelId) {
  const settings = getSettings();
  return settings.channels?.[channelId]?.supabaseChannelId || null;
}

// Generate a short share code
function generateShareCode(channelName) {
  const prefix = (channelName || 'TEAM').substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${code}`;
}

// Upload a file to Supabase Storage and return the public URL
async function uploadThumbnail(filePath) {
  const fs = require('fs');
  const path = require('path');

  const ext = path.extname(filePath).toLowerCase();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const fileBuffer = fs.readFileSync(filePath);

  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };
  const contentType = mimeMap[ext] || 'image/png';

  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from('thumbnails')
    .upload(fileName, fileBuffer, { contentType, upsert: false });

  if (error) {
    console.error('[Supabase] Upload error:', error.message);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from('thumbnails')
    .getPublicUrl(fileName);

  return urlData?.publicUrl || null;
}

module.exports = { getSupabase, isChannelShared, getSupabaseChannelId, generateShareCode, uploadThumbnail, SUPABASE_URL };
