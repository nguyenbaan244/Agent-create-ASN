document.addEventListener('DOMContentLoaded', () => {
  
  // Elements
  const tabItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('page-title');
  
  const pdfCountEl = document.getElementById('pdf-count');
  const asnCountEl = document.getElementById('asn-count');
  const locAvailableEl = document.getElementById('loc-available');
  const locBlockedEl = document.getElementById('loc-blocked');
  
  const pdfListEl = document.getElementById('pdf-list');
  const inventoryListEl = document.getElementById('inventory-list');
  const asnTableBody = document.getElementById('asn-table-body');
  const noAsnMsg = document.getElementById('no-asn-msg');
  const asnTable = document.getElementById('asn-table');
  const logListEl = document.getElementById('log-list');
  
  const btnGenerate = document.getElementById('btn-generate');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnRefreshInputs = document.getElementById('btn-refresh-inputs');
  const btnRefreshLogs = document.getElementById('btn-refresh-logs');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnShutdown = document.getElementById('btn-shutdown');
  
  const loadingModal = document.getElementById('loading-modal');
  const resultModal = document.getElementById('result-modal');
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');
  const resultIcon = document.getElementById('result-icon');

  // Initialization
  refreshData();

  // Navigation logic
  tabItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.classList.contains('disabled')) return;
      
      tabItems.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      item.classList.add('active');
      const targetId = item.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
      
      if (targetId === 'asn-generator') pageTitle.innerText = 'ASN Generator Workflow';
      if (targetId === 'logs') {
        pageTitle.innerText = 'Activity Logs';
        fetchLogs();
      }
    });
  });

  // Action Buttons
  btnRefresh.addEventListener('click', fetchASNFiles);
  if (btnRefreshInputs) {
    btnRefreshInputs.addEventListener('click', () => {
      fetchPDFs();
      fetchInventoryFiles();
    });
  }
  btnRefreshLogs.addEventListener('click', fetchLogs);
  btnCloseModal.addEventListener('click', () => resultModal.classList.remove('active'));
  
  // Open Folder Buttons
  document.querySelectorAll('.btn-open-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const folderType = e.target.closest('button').getAttribute('data-folder');
      try {
        await fetch(`/api/open-folder/${folderType}`, { method: 'POST' });
      } catch (err) {
        console.error('Failed to open folder', err);
      }
    });
  });

  // Upload Buttons
  document.querySelectorAll('.btn-upload').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const folderType = e.target.closest('button').getAttribute('data-folder');
      document.getElementById(`file-upload-${folderType}`).click();
    });
  });

  // Handle file selection for upload
  ['inventory', 'pdf'].forEach(type => {
    const inputEl = document.getElementById(`file-upload-${type}`);
    if (inputEl) {
      inputEl.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files.length) return;
        
        loadingModal.classList.add('active');
        document.getElementById('loading-text').innerText = 'Uploading files...';
        
        for (const file of files) {
          try {
            const base64Str = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(file);
            });
            
            await fetch(`/api/upload/${type}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: file.name, content: base64Str })
            });
          } catch (err) {
            console.error('Upload failed', err);
          }
        }
        
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.'; // reset
        inputEl.value = ''; // reset input
        
        if (type === 'pdf') fetchPDFs();
        if (type === 'inventory') fetchInventoryFiles();
      });
    }
  });

  // Global Delete Listener Function for Input Files
  function attachInputDeleteListeners() {
    // Remove old listeners to prevent duplicates by cloning
    document.querySelectorAll('.btn-delete-input').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', async (e) => {
        const targetBtn = e.target.closest('button');
        const type = targetBtn.getAttribute('data-type');
        const filename = targetBtn.getAttribute('data-filename');
        
        if (confirm(`Are you sure you want to delete ${filename}?`)) {
          try {
            await fetch(`/api/delete/${type}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            if (type === 'pdf') fetchPDFs();
            if (type === 'inventory') fetchInventoryFiles();
          } catch (err) {
            console.error('Delete failed', err);
          }
        }
      });
    });
  }
  
  btnShutdown.addEventListener('click', async () => {
    if (confirm('Are you sure you want to stop the Agent Hub server? You will need to run the start file again to use it.')) {
      try {
        await fetch('/api/shutdown', { method: 'POST' });
        document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column; font-family:sans-serif;"><h2>Server Stopped</h2><p>You can safely close this browser tab.</p></div>';
      } catch (e) {
        console.error(e);
      }
    }
  });

  btnGenerate.addEventListener('click', async () => {
    if (pdfCountEl.innerText === '0') {
      showResultModal(false, 'Warning', 'No PDF files found in Input folder.');
      return;
    }
    
    loadingModal.classList.add('active');
    try {
      const res = await fetch('/api/generate', { method: 'POST' });
      const data = await res.json();
      loadingModal.classList.remove('active');
      
      if (data.success) {
        let html = `<ul>`;
        data.files.forEach(f => {
          html += `<li><strong>${f.filename}</strong><br>
          Locations assigned: ${f.locationCount} <br>
          Pallets processed: ${f.palletCount}
          ${f.insufficientLocs ? '<br><span style="color:var(--danger)">WARNING: Not enough locations!</span>' : ''}
          </li>`;
        });
        html += `</ul>`;
        showResultModal(true, 'Generation Successful', html);
        refreshData();
      } else {
        showResultModal(false, 'Generation Failed', `<p>${data.error}</p>`);
      }
    } catch (err) {
      loadingModal.classList.remove('active');
      showResultModal(false, 'Error', `<p>${err.message}</p>`);
    }
  });

  // Inventory Analysis Logic
  const btnAnalyzeInventory = document.getElementById('btn-analyze-inventory');
  const inventoryAnalyzeResult = document.getElementById('inventory-analyze-result');
  const inventoryAnalyzeMsg = document.getElementById('inventory-analyze-msg');
  const wrongLocCount = document.getElementById('wrong-loc-count');
  const wrongPalletCount = document.getElementById('wrong-pallet-count');
  const btnDownloadWrongLoc = document.getElementById('btn-download-wrong-loc');

  if (btnAnalyzeInventory) {
    btnAnalyzeInventory.addEventListener('click', async () => {
      loadingModal.classList.add('active');
      document.getElementById('loading-text').innerText = 'Analyzing inventory locations...';
      
      try {
        const res = await fetch('/api/inventory/analyze', { method: 'POST' });
        const data = await res.json();
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.'; // Reset text
        
        if (data.success) {
          inventoryAnalyzeResult.classList.remove('hidden');
          inventoryAnalyzeMsg.innerText = data.message;
          wrongLocCount.innerText = data.wrongLocCount;
          wrongPalletCount.innerText = data.wrongPalletCount;
          
          if (data.wrongLocCount > 0) {
            btnDownloadWrongLoc.classList.remove('hidden');
            showResultModal(true, 'Analysis Complete', `<p>${data.message}</p><p>Please download the report for details.</p>`);
          } else {
            btnDownloadWrongLoc.classList.add('hidden');
            showResultModal(true, 'Analysis Complete', `<p>${data.message}</p>`);
          }
        } else {
          showResultModal(false, 'Analysis Failed', `<p>${data.error}</p>`);
        }
      } catch (err) {
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
        showResultModal(false, 'Error', `<p>${err.message}</p>`);
      }
    });
  }

  // Empty Locations Logic
  const btnExtractEmptyLoc = document.getElementById('btn-extract-empty-loc');
  const emptyLocResult = document.getElementById('empty-loc-result');
  const emptyLocMsg = document.getElementById('empty-loc-msg');
  const emptyLocCountVal = document.getElementById('empty-loc-count-val');
  const btnDownloadEmptyLoc = document.getElementById('btn-download-empty-loc');

  if (btnExtractEmptyLoc) {
    btnExtractEmptyLoc.addEventListener('click', async () => {
      loadingModal.classList.add('active');
      document.getElementById('loading-text').innerText = 'Extracting empty locations...';
      
      try {
        const res = await fetch('/api/empty-locations/generate', { method: 'POST' });
        const data = await res.json();
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.'; // Reset text
        
        if (data.success) {
          emptyLocResult.classList.remove('hidden');
          emptyLocMsg.innerText = data.message;
          emptyLocCountVal.innerText = data.emptyCount;
          
          if (data.emptyCount > 0) {
            btnDownloadEmptyLoc.classList.remove('hidden');
            showResultModal(true, 'Extraction Complete', `<p>${data.message}</p><p>Please download the report for details.</p>`);
          } else {
            btnDownloadEmptyLoc.classList.add('hidden');
            showResultModal(true, 'Extraction Complete', `<p>${data.message}</p>`);
          }
        } else {
          showResultModal(false, 'Extraction Failed', `<p>${data.error}</p>`);
        }
      } catch (err) {
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
        showResultModal(false, 'Error', `<p>${err.message}</p>`);
      }
    });
  }

  // Data Fetching functions
  async function refreshData() {
    fetchPDFs();
    fetchInventoryFiles();
    fetchASNFiles();
    fetchLocationStatus();
  }

  async function fetchPDFs() {
    try {
      const res = await fetch('/api/pdfs');
      const data = await res.json();
      if (data.success) {
        pdfCountEl.innerText = data.data.length;
        pdfListEl.innerHTML = '';
        if (data.data.length === 0) {
          pdfListEl.innerHTML = '<li>No PDF files found. Please add to Input folder.</li>';
        } else {
          data.data.forEach(f => {
            pdfListEl.innerHTML += `<li style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <span><i class="fa-solid fa-file-pdf" style="color: var(--primary);"></i> ${f}</span>
              <button class="btn-delete-input" data-type="pdf" data-filename="${f}" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash"></i></button>
            </li>`;
          });
          attachInputDeleteListeners();
        }
      }
    } catch (e) { console.error(e); }
  }

  async function fetchInventoryFiles() {
    try {
      if (!inventoryListEl) return;
      const res = await fetch('/api/inventory-files');
      const data = await res.json();
      if (data.success) {
        inventoryListEl.innerHTML = '';
        if (data.data.length === 0) {
          inventoryListEl.innerHTML = '<li>No Inventory files found. Please add to Input/Inventory folder.</li>';
        } else {
          data.data.forEach(f => {
            inventoryListEl.innerHTML += `<li style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <span><i class="fa-solid fa-file-excel" style="color: var(--success);"></i> ${f}</span>
              <button class="btn-delete-input" data-type="inventory" data-filename="${f}" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash"></i></button>
            </li>`;
          });
          attachInputDeleteListeners();
        }
      }
    } catch (e) { console.error(e); }
  }

  async function fetchASNFiles() {
    try {
      const res = await fetch('/api/asn-files');
      const data = await res.json();
      if (data.success) {
        asnCountEl.innerText = data.data.length;
        
        if (data.data.length === 0) {
          asnTable.classList.add('hidden');
          noAsnMsg.classList.remove('hidden');
        } else {
          asnTable.classList.remove('hidden');
          noAsnMsg.classList.add('hidden');
          
          asnTableBody.innerHTML = '';
          data.data.forEach(f => {
            const sizeKB = Math.round(f.size / 1024);
            const dateStr = new Date(f.modified).toLocaleString();
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td><strong><i class="fa-regular fa-file-excel" style="color:var(--success);margin-right:8px"></i> ${f.name}</strong></td>
              <td>${sizeKB} KB</td>
              <td>${dateStr}</td>
              <td class="actions">
                <a href="/api/download/${encodeURIComponent(f.name)}" class="btn-sm btn-download"><i class="fa-solid fa-download"></i> Download</a>
                <button class="btn-sm btn-delete" data-filename="${f.name}"><i class="fa-solid fa-trash"></i> Delete</button>
              </td>
            `;
            asnTableBody.appendChild(tr);
          });
          
          // Add delete listeners
          document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const filename = e.target.closest('button').getAttribute('data-filename');
              if (confirm(`Delete ${filename}? This will free up the assigned locations.`)) {
                await fetch(`/api/asn/${encodeURIComponent(filename)}`, { method: 'DELETE' });
                refreshData();
              }
            });
          });
        }
      }
    } catch (e) { console.error(e); }
  }

  async function fetchLocationStatus() {
    try {
      const res = await fetch('/api/locations/status');
      const data = await res.json();
      if (data.success) {
        locAvailableEl.innerText = data.data.available;
        locBlockedEl.innerText = `${data.data.asnBlocked} blocked by active ASNs`;
      }
    } catch (e) { console.error(e); }
  }

  async function fetchLogs() {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.success) {
        logListEl.innerHTML = '';
        if (data.data.length === 0) {
          logListEl.innerHTML = '<p>No logs found.</p>';
        } else {
          data.data.forEach(log => {
            const dateStr = new Date(log.modified).toLocaleString();
            logListEl.innerHTML += `
              <div class="log-file">
                <div class="log-file-header">
                  <span>${log.name}</span>
                  <span>${dateStr}</span>
                </div>
                <div class="log-content">${log.content}</div>
              </div>
            `;
          });
        }
      }
    } catch (e) { console.error(e); }
  }

  function showResultModal(isSuccess, title, htmlBody) {
    resultTitle.innerText = title;
    resultBody.innerHTML = htmlBody;
    
    if (isSuccess) {
      resultIcon.className = 'result-icon success';
      resultIcon.innerHTML = '<i class="fa-solid fa-check-circle"></i>';
    } else {
      resultIcon.className = 'result-icon error';
      resultIcon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    }
    
    resultModal.classList.add('active');
  }

});
