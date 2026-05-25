document.addEventListener('DOMContentLoaded', () => {
  
  // Elements
  const tabItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('page-title');
  
  const pdfCountEl = document.getElementById('pdf-count');
  const asnCountEl = document.getElementById('asn-count');
  const locAvailableEl = document.getElementById('loc-available');
  const locBlockedEl = document.getElementById('loc-blocked');
  const locBlockedNonUseEl = document.getElementById('loc-blocked-nonuse');
  
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
  
  const loadingModal = document.getElementById('loading-modal');
  const resultModal = document.getElementById('result-modal');
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');
  const resultIcon = document.getElementById('result-icon');

  // Initialization
  refreshData();
  fetchMasterDataStatus();

  // Custom Confirm Modal Logic
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const btnConfirmYes = document.getElementById('btn-confirm-yes');
  const btnConfirmNo = document.getElementById('btn-confirm-no');
  let confirmCallback = null;

  function showConfirmModal(title, message, callback) {
    if (!confirmModal) return;
    confirmTitle.innerText = title;
    confirmMessage.innerText = message;
    confirmCallback = callback;
    confirmModal.classList.add('active');
  }

  if (btnConfirmYes) {
    btnConfirmYes.addEventListener('click', () => {
      confirmModal.classList.remove('active');
      if (confirmCallback) confirmCallback();
    });
  }
  
  if (btnConfirmNo) {
    btnConfirmNo.addEventListener('click', () => {
      confirmModal.classList.remove('active');
      confirmCallback = null;
    });
  }

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
      if (targetId === 'inventory-analytics') pageTitle.innerText = 'Inventory Analytics';
      if (targetId === 'empty-locations') pageTitle.innerText = 'Empty Locations';
      if (targetId === 'master-data') {
        pageTitle.innerText = 'Master Data Management';
        fetchMasterDataStatus();
      }
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

  // Upload Buttons (PDF and Inventory)
  document.querySelectorAll('.btn-upload').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const folderType = e.target.closest('button').getAttribute('data-folder');
      document.getElementById(`file-upload-${folderType}`).click();
    });
  });

  // Handle file selection for upload (using FormData)
  ['inventory', 'pdf'].forEach(type => {
    const inputEl = document.getElementById(`file-upload-${type}`);
    if (inputEl) {
      inputEl.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files.length) return;
        
        loadingModal.classList.add('active');
        document.getElementById('loading-text').innerText = 'Uploading files to cloud...';
        
        try {
          const formData = new FormData();
          for (const file of files) {
            formData.append('files', file);
          }
          
          const res = await fetch(`/api/upload/${type}`, {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          
          if (!data.success) {
            showResultModal(false, 'Upload Failed', `<p>${data.error}</p>`);
          }
        } catch (err) {
          showResultModal(false, 'Upload Error', `<p>${err.message}</p>`);
        }
        
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
        inputEl.value = '';
        
        if (type === 'pdf') fetchPDFs();
        if (type === 'inventory') fetchInventoryFiles();
      });
    }
  });

  // Global Delete Listener Function for Input Files
  function attachInputDeleteListeners() {
    document.querySelectorAll('.btn-delete-input').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', async (e) => {
        const targetBtn = e.target.closest('button');
        const type = targetBtn.getAttribute('data-type');
        const filename = targetBtn.getAttribute('data-filename');
        
        showConfirmModal('Delete File', `Are you sure you want to delete ${filename}?`, async () => {
          try {
            await fetch(`/api/delete/${type}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            if (type === 'pdf') fetchPDFs();
            if (type === 'inventory') fetchInventoryFiles();
          } catch (err) {
            console.error('Delete failed', err);
          }
        });
      });
    });
  }

  // Generate ASN
  btnGenerate.addEventListener('click', async () => {
    if (pdfCountEl.innerText === '0') {
      showResultModal(false, 'Warning', 'No PDF files found. Please upload PDFs first.');
      return;
    }
    
    loadingModal.classList.add('active');
    document.getElementById('loading-text').innerText = 'Processing PDFs, assigning locations, generating ASN...';
    try {
      const res = await fetch('/api/generate', { method: 'POST' });
      const data = await res.json();
      loadingModal.classList.remove('active');
      document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
      
      if (data.success) {
        let html = `<div class="asn-results-list">`;
        data.files.forEach(f => {
          html += `
            <div class="asn-result-item">
              <div class="asn-result-header">
                <i class="fa-regular fa-file-excel" style="color: #10b981;"></i> 
                <strong>${f.filename}</strong>
              </div>
              <div class="asn-result-stats">
                <span class="stat-badge"><i class="fa-solid fa-map-location-dot"></i> ${f.locationCount} Locations</span>
                <span class="stat-badge"><i class="fa-solid fa-boxes-stacked"></i> ${f.palletCount} Pallets</span>
              </div>
              ${f.insufficientLocs ? '<div class="asn-warning"><i class="fa-solid fa-triangle-exclamation"></i> WARNING: Not enough empty locations!</div>' : ''}
            </div>
          `;
        });
        html += `</div>`;
        showResultModal(true, 'Generation Successful', html);
        refreshData();
      } else {
        showResultModal(false, 'Generation Failed', `<p>${data.error}</p>`);
      }
    } catch (err) {
      loadingModal.classList.remove('active');
      document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
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
  const radarAnim = document.getElementById('radar-anim');
  const previewContainer = document.getElementById('wrong-loc-preview-container');
  const previewBody = document.getElementById('wrong-loc-preview-body');

  function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      obj.innerHTML = Math.floor(progress * (end - start) + start);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }

  if (btnAnalyzeInventory) {
    btnAnalyzeInventory.addEventListener('click', async () => {
      radarAnim.classList.add('scanning');
      inventoryAnalyzeResult.classList.add('hidden');
      btnAnalyzeInventory.disabled = true;
      btnAnalyzeInventory.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
      
      try {
        await new Promise(r => setTimeout(r, 1000));
        
        const res = await fetch('/api/inventory/analyze', { method: 'POST' });
        const data = await res.json();
        
        radarAnim.classList.remove('scanning');
        btnAnalyzeInventory.disabled = false;
        btnAnalyzeInventory.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Start Deep Scan';
        
        if (data.success) {
          inventoryAnalyzeResult.classList.remove('hidden');
          inventoryAnalyzeMsg.innerText = data.message;
          
          animateValue(wrongLocCount, 0, data.wrongLocCount || 0, 1000);
          animateValue(wrongPalletCount, 0, data.wrongPalletCount || 0, 1000);
          
          if (data.wrongLocCount > 0) {
            btnDownloadWrongLoc.classList.remove('hidden');
            
            if (data.preview && data.preview.length > 0) {
              previewContainer.classList.remove('hidden');
              previewBody.innerHTML = data.preview.map(p => `
                <tr>
                  <td><strong>${p.loc}</strong></td>
                  <td>${p.id}</td>
                  <td>${p.sku}</td>
                  <td>${p.batch}</td>
                </tr>
              `).join('');
            } else {
              previewContainer.classList.add('hidden');
            }
          } else {
            btnDownloadWrongLoc.classList.add('hidden');
            previewContainer.classList.add('hidden');
          }
        } else {
          showResultModal(false, 'Analysis Failed', `<p>${data.error}</p>`);
        }
      } catch (err) {
        radarAnim.classList.remove('scanning');
        btnAnalyzeInventory.disabled = false;
        btnAnalyzeInventory.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Start Deep Scan';
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
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
        
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

  // ============================================================================
  // MASTER DATA MANAGEMENT
  // ============================================================================
  
  // Upload Master Data buttons
  document.querySelectorAll('.btn-upload-md').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mdType = e.target.closest('button').getAttribute('data-md-type');
      document.querySelector(`.md-file-input[data-md-type="${mdType}"]`).click();
    });
  });

  // Handle Master Data file upload
  document.querySelectorAll('.md-file-input').forEach(inputEl => {
    inputEl.addEventListener('change', async (e) => {
      const mdType = inputEl.getAttribute('data-md-type');
      const file = e.target.files[0];
      if (!file) return;

      loadingModal.classList.add('active');
      document.getElementById('loading-text').innerText = `Uploading ${file.name} to cloud...`;

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/master-data/${mdType}`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();

        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';

        if (data.success) {
          showResultModal(true, 'Upload Successful', `<p>${data.message}</p>`);
          fetchMasterDataStatus();
        } else {
          showResultModal(false, 'Upload Failed', `<p>${data.error}</p>`);
        }
      } catch (err) {
        loadingModal.classList.remove('active');
        document.getElementById('loading-text').innerText = 'Extracting data from PDFs and mapping locations.';
        showResultModal(false, 'Upload Error', `<p>${err.message}</p>`);
      }

      inputEl.value = '';
    });
  });

  // Refresh Master Data status button
  const btnRefreshMaster = document.getElementById('btn-refresh-master');
  if (btnRefreshMaster) {
    btnRefreshMaster.addEventListener('click', fetchMasterDataStatus);
  }

  async function fetchMasterDataStatus() {
    try {
      const res = await fetch('/api/master-data/status');
      const data = await res.json();
      if (data.success) {
        for (const [key, info] of Object.entries(data.data)) {
          const el = document.getElementById(`md-status-${key}`);
          if (el) {
            if (info.exists) {
              el.innerHTML = '<span style="color: var(--success);"><i class="fa-solid fa-circle-check"></i> Uploaded</span>';
            } else {
              el.innerHTML = '<span style="color: var(--danger);"><i class="fa-solid fa-circle-xmark"></i> Not uploaded</span>';
            }
          }
        }
      }
    } catch (e) { console.error(e); }
  }

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  
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
          pdfListEl.innerHTML = '<li>No PDF files found. Please upload PDF files.</li>';
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
          inventoryListEl.innerHTML = '<li>No Inventory files found. Please upload an inventory file.</li>';
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
            const sizeKB = Math.round((f.size || 0) / 1024);
            const dateStr = f.modified ? new Date(f.modified).toLocaleString() : '-';
            
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
              if (!filename) return;
              showConfirmModal('Delete ASN Output', `Delete ${filename}? This will free up the assigned locations.`, async () => {
                await fetch(`/api/asn/${encodeURIComponent(filename)}`, { method: 'DELETE' });
                refreshData();
              });
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
        if (locBlockedNonUseEl) {
          locBlockedNonUseEl.innerText = `${data.data.nonUse} blocked by non use`;
        }
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
            const dateStr = log.modified ? new Date(log.modified).toLocaleString() : '-';
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
