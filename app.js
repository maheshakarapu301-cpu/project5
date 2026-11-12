(() => {
  "use strict";

  // 1. Generate 550 Mock Analytics Rows
  const REGIONS = ["ap-south-1 (Mumbai)", "us-east-1 (N. Virginia)", "eu-central-1 (Frankfurt)", "ap-northeast-1 (Tokyo)"];
  const ORGS = ["Acme FinTech", "Globex Logistics", "Initech Cloud", "Umbrella Health", "Stark Energy", "Wayne Retail"];
  const TOTAL_ROWS = 550;

  let records = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
    id: `TNT-${String(1001 + i).padStart(4, "0")}`,
    org: `${ORGS[i % ORGS.length]} #${Math.floor(i / ORGS.length) + 1}`,
    region: REGIONS[i % REGIONS.length],
    eps: Math.floor(120 + ((i * 37) % 4800)),
    active: i % 3 !== 0,
    selected: false
  }));

  let filteredRecords = [...records];
  let openDropdownRowId = null;

  // DOM References
  const tableBody = document.getElementById("tableBody");
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const searchInput = document.getElementById("searchInput");
  const rowCounter = document.getElementById("rowCounter");
  const kpiTotalRows = document.getElementById("kpiTotalRows");
  const kpiActiveCount = document.getElementById("kpiActiveCount");
  const kpiSelectedCount = document.getElementById("kpiSelectedCount");
  const toastEl = document.getElementById("toast");

  // 2. High-Speed Batch Rendering with DocumentFragment (Prevents Layout Thrashing)
  function renderTable(data) {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const tr = document.createElement("tr");
      tr.dataset.id = row.id;
      if (row.selected) tr.classList.add("row-selected");

      tr.innerHTML = `
        <td>
          <input type="checkbox" class="row-checkbox" data-action="select"
            aria-label="Select ${row.org}" ${row.selected ? "checked" : ""} />
        </td>
        <td class="mono-id">${row.id}</td>
        <td><strong>${row.org}</strong></td>
        <td>${row.region}</td>
        <td>${row.eps.toLocaleString()} req/s</td>
        <td>
          <button type="button" class="toggle-switch" role="switch"
            data-action="toggle" aria-checked="${row.active}"
            aria-label="Toggle stream for ${row.org}">
            <span class="toggle-thumb"></span>
          </button>
        </td>
        <td class="action-cell">
          <button type="button" class="icon-btn" data-action="menu-trigger"
            aria-haspopup="true" aria-expanded="false" aria-label="Row actions for ${row.org}">
            <svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
            </svg>
          </button>
          <div class="dropdown-menu" role="menu">
            <button type="button" class="dropdown-item" role="menuitem" data-action="inspect">Inspect Stream</button>
            <button type="button" class="dropdown-item" role="menuitem" data-action="reset-eps">Reset Rate Limit</button>
            <button type="button" class="dropdown-item danger" role="menuitem" data-action="delete">Archive Tenant</button>
          </div>
        </td>
      `;
      fragment.appendChild(tr);
    }

    tableBody.replaceChildren(fragment);
    updateMetrics();
  }

  // 3. Single Event Delegation Listener on Parent <tbody> (60 FPS O(1) Event Handling)
  tableBody.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;

    const tr = actionTarget.closest("tr");
    if (!tr) return;

    const rowId = tr.dataset.id;
    const action = actionTarget.dataset.action;
    const record = records.find((r) => r.id === rowId);
    if (!record) return;

    // Inline Selection
    if (action === "select") {
      record.selected = actionTarget.checked;
      tr.classList.toggle("row-selected", record.selected);
      updateMetrics();
    }

    // Inline Toggle Switch
    if (action === "toggle") {
      record.active = !record.active;
      actionTarget.setAttribute("aria-checked", String(record.active));
      updateMetrics();
      showToast(`${record.id} stream ${record.active ? "enabled" : "paused"}`);
    }

    // Inline Dropdown Menu Trigger
    if (action === "menu-trigger") {
      event.stopPropagation();
      const menu = tr.querySelector(".dropdown-menu");
      const isOpen = menu.classList.contains("open");
      closeAllDropdowns();
      if (!isOpen) {
        menu.classList.add("open");
        actionTarget.setAttribute("aria-expanded", "true");
        openDropdownRowId = rowId;
      }
    }

    // Dropdown Menu Items
    if (action === "inspect") {
      closeAllDropdowns();
      showToast(`Inspecting ${record.org} (${record.eps} req/s)`);
    }

    if (action === "reset-eps") {
      record.eps = 1000;
      tr.children[4].textContent = "1,000 req/s";
      closeAllDropdowns();
      showToast(`Rate limit reset for ${record.id}`);
    }

    if (action === "delete") {
      records = records.filter((r) => r.id !== rowId);
      filteredRecords = filteredRecords.filter((r) => r.id !== rowId);
      tr.remove();
      updateMetrics();
      showToast(`Archived ${record.id}`);
    }
  });

  // Close open dropdowns when clicking outside or pressing Escape
  document.addEventListener("click", closeAllDropdowns);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllDropdowns();
      document.getElementById("sidebar").classList.remove("open");
    }
  });

  function closeAllDropdowns() {
    if (!openDropdownRowId) return;
    tableBody.querySelectorAll(".dropdown-menu.open").forEach((menu) => {
      menu.classList.remove("open");
      menu.previousElementSibling?.setAttribute("aria-expanded", "false");
    });
    openDropdownRowId = null;
  }

  // Select All Visible Rows
  selectAllCheckbox.addEventListener("change", (e) => {
    const checked = e.target.checked;
    const visibleIds = new Set(filteredRecords.map((r) => r.id));
    records.forEach((r) => {
      if (visibleIds.has(r.id)) r.selected = checked;
    });
    tableBody.querySelectorAll("tr").forEach((tr) => {
      tr.classList.toggle("row-selected", checked);
      const cb = tr.querySelector(".row-checkbox");
      if (cb) cb.checked = checked;
    });
    updateMetrics();
  });

  // Debounced Search Filter (320px-2560px responsive)
  let searchTimer;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      filteredRecords = q
        ? records.filter(
            (r) =>
              r.id.toLowerCase().includes(q) ||
              r.org.toLowerCase().includes(q) ||
              r.region.toLowerCase().includes(q)
          )
        : [...records];
      renderTable(filteredRecords);
    }, 120);
  });

  // Update KPI Cards & Counters
  function updateMetrics() {
    const activeCount = records.filter((r) => r.active).length;
    const selectedCount = records.filter((r) => r.selected).length;
    kpiTotalRows.textContent = records.length;
    kpiActiveCount.textContent = activeCount;
    kpiSelectedCount.textContent = selectedCount;
    rowCounter.textContent = `Showing ${filteredRecords.length} of ${records.length} records`;
  }

  // Toast Helper
  let toastTimer;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  // Sidebar & Theme Controls
  const sidebar = document.getElementById("sidebar");
  const openSidebarBtn = document.getElementById("openSidebarBtn");
  const closeSidebarBtn = document.getElementById("closeSidebarBtn");

  openSidebarBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    openSidebarBtn.setAttribute("aria-expanded", "true");
  });

  closeSidebarBtn.addEventListener("click", () => {
    sidebar.classList.remove("open");
    openSidebarBtn.setAttribute("aria-expanded", "false");
  });

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const count = records.filter((r) => r.selected).length;
    showToast(count > 0 ? `Exported ${count} selected tenant records` : "Select at least one row to export");
  });

  // Initial Render
  renderTable(filteredRecords);
})();