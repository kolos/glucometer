window.UI = (() => {

  const MEAL_TYPE = {
    0: { label: "Normal", class: "meal-normal" },
    1: { label: "Before meal", class: "meal-before" },
    2: { label: "After meal", class: "meal-after" }
  };

  const logEl = document.getElementById("log");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const tableBody = document.getElementById("readingsBody");
  const tablePill = document.getElementById("tablePill");
  const summaryPill = document.getElementById("summaryPill");
  const chartCanvas = document.getElementById("chartCanvas");
  const chartTitle = document.getElementById("chartTitle");

  tablePill.addEventListener("click", () => {
    if (window.readings) {
      copyToClipboard(window.readings);
    }
  });

  function ts() {
    return new Date().toISOString().split("T")[1].replace("Z", "");
  }

  function logLine(t, c = "") {
    const d = document.createElement("div");
    d.className = "log-line" + (c ? " " + c : "");
    d.textContent = `[${ts()}] ${t}`;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(on, t) {
    statusDot.classList.toggle("online", on);
    statusText.textContent = t;
  }

  function renderTable(d) {
    tableBody.innerHTML = "";
    const s = d.slice().reverse();

    s.forEach((r, i) => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${s.length - i}</td>
        <td>${r.date.toLocaleDateString()}</td>
        <td>${r.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
        <td><span class="value-chip">${r.value}<span class="unit">mg/dL</span></span></td>
        <td><span class="meal-chip ${MEAL_TYPE[r.measureType].class}">${MEAL_TYPE[r.measureType].label}</span></td>
      `;

      tableBody.appendChild(tr);
    });

    tablePill.textContent = `${d.length} entr${d.length === 1 ? "y" : "ies"}`;

    if (d.length) {
      const vals = d.map(r => r.value);
      const min = Math.min(...vals), max = Math.max(...vals);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      summaryPill.textContent = `Min ${min} · Max ${max} · Avg ${Math.round(avg)}`;
      chartTitle.textContent = `Last ${d.length} readings`;
    } else {
      summaryPill.textContent = "No data";
      chartTitle.textContent = "No readings yet";
    }
  }

  function drawChart(d) {
    const c = chartCanvas;
    const ctx = c.getContext("2d");

    const pl = 32, pr = 10, pt = 10, pb = 20;
    const minSpacing = 10;
    const requiredWidth = pl + pr + Math.max(0, (d.length - 1) * minSpacing);
    const cssWidth = Math.max(c.clientWidth, requiredWidth);

    const w = c.width = cssWidth * devicePixelRatio;
    const h = c.height = c.clientHeight * devicePixelRatio;

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!d.length) {
      ctx.fillStyle = "#5f6c9a";
      ctx.font = "12px sans-serif";
      ctx.fillText("No readings to display", 12, h / 2);
      return;
    }

    const vals = d.map(r => r.value);
    const min = Math.min(...vals), max = Math.max(...vals);

    const pw = cssWidth - pl - pr;
    const ph = c.clientHeight - pt - pb;

    const xs = d.length > 1 ? pw / (d.length - 1) : 0;
    const ys = max === min ? 1 : ph / (max - min);

    // Horizontal grid lines
    ctx.strokeStyle = "#151a2a";
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = pt + ph * i / 4;
      ctx.moveTo(pl, y);
      ctx.lineTo(cssWidth - pr, y);
    }
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = "#5f6c9a";
    ctx.font = "10px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const v = max - (max - min) * i / 4;
      const y = pt + ph * i / 4;
      ctx.fillText(Math.round(v), 4, y + 3);
    }

    // Line
    ctx.strokeStyle = "#4f8cff";
    ctx.beginPath();
    d.forEach((r, i) => {
      const x = pl + xs * i;
      const y = pt + (max - r.value) * ys;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Points
    ctx.fillStyle = "#4f8cff";
    d.forEach((r, i) => {
      const x = pl + xs * i;
      const y = pt + (max - r.value) * ys;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }


  function exportCSV(d) {
    if (!d.length) return;
    const header = ["index", "date", "time", "value_mg_dL", "meal_type"];
    const rows = d.map(r => {
      const dt = r.date;
      return [
        r.index,
        dt.toISOString().slice(0, 10),
        dt.toTimeString().slice(0, 8),
        r.value,
        r.measureType
      ];
    });
    const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "td42xx_readings.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showCopyToast() {
    const toast = document.getElementById("copyToast");
    toast.style.opacity = "1";
    toast.style.transform = "translateY(-12px)";

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-6px)";
    }, 1000);
  }


  function copyToClipboard(d) {
    if (!d.length) {
      logLine("No readings to copy", "dim");
      return;
    }

    // Excel-friendly TSV
    const header = "timestamp\tvalue\tmealType";
    const lines = d.map(r =>
      `${r.date.toISOString()}\t${r.value}\t${r.measureType}`
    );

    const tsv = [header, ...lines].join("\n");

    navigator.clipboard.writeText(tsv).then(() => {
      logLine(`Copied ${d.length} readings to clipboard`, "dim");
      showCopyToast();
    });
  }

  return {
    logLine,
    setStatus,
    renderTable,
    drawChart,
    exportCSV,
    copyToClipboard
  };

})();

