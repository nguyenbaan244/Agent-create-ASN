const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'asn-agent';

// Folder constants
const FOLDERS = {
  inputPdf: 'input/pdf',
  inputInventory: 'input/inventory',
  masterData: 'master-data',
  asnOutput: 'output/asn',
  logs: 'output/logs',
};

// Master data file keys
const MASTER_DATA_FILES = {
  'goods-spec': 'Goods specification.xlsx',
  'master-loc': 'Master Location.xlsx',
  'non-use-loc': 'Location Non use.xlsx',
};

let _client = null;

function getClient() {
  if (_client) return _client;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  }
  _client = createClient(supabaseUrl, supabaseKey);
  return _client;
}

async function uploadFile(folder, filename, buffer, contentType) {
  const supabase = getClient();
  const filePath = `${folder}/${filename}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType, upsert: true });
  if (error) throw error;
  return data;
}

async function downloadFile(folder, filename) {
  const supabase = getClient();
  const filePath = `${folder}/${filename}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(filePath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function listFiles(folder) {
  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  // Filter out .emptyFolderPlaceholder
  return (data || []).filter(f => f.name && !f.name.startsWith('.'));
}

async function deleteFile(folder, filename) {
  const supabase = getClient();
  const filePath = `${folder}/${filename}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .remove([filePath]);
  if (error) throw error;
  return data;
}

async function deleteMultiple(paths) {
  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .remove(paths);
  if (error) throw error;
  return data;
}

async function fileExists(folder, filename) {
  try {
    const files = await listFiles(folder);
    return files.some(f => f.name === filename);
  } catch {
    return false;
  }
}

/**
 * Download all master data buffers from Supabase.
 * Returns { goodsSpecBuffer, masterLocBuffer, nonUseLocBuffer } or throws if missing.
 */
async function downloadAllMasterData() {
  const results = {};
  for (const [key, filename] of Object.entries(MASTER_DATA_FILES)) {
    try {
      results[key] = await downloadFile(FOLDERS.masterData, filename);
    } catch (err) {
      throw new Error(`Master Data file "${filename}" not found in Supabase. Please upload it first.`);
    }
  }
  return {
    goodsSpecBuffer: results['goods-spec'],
    masterLocBuffer: results['master-loc'],
    nonUseLocBuffer: results['non-use-loc'],
  };
}

/**
 * Download all ASN output buffers from Supabase.
 */
async function downloadAllAsnOutputs() {
  const files = await listFiles(FOLDERS.asnOutput);
  const buffers = [];
  for (const f of files) {
    if (f.name.endsWith('.xlsx')) {
      try {
        const buf = await downloadFile(FOLDERS.asnOutput, f.name);
        buffers.push(buf);
      } catch { /* skip */ }
    }
  }
  return buffers;
}

module.exports = {
  getClient,
  uploadFile,
  downloadFile,
  listFiles,
  deleteFile,
  deleteMultiple,
  fileExists,
  downloadAllMasterData,
  downloadAllAsnOutputs,
  BUCKET,
  FOLDERS,
  MASTER_DATA_FILES,
};
