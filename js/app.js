const btnConnect = document.getElementById("btnConnect");
const btnExport = document.getElementById("btnExport");
const devProductEl = document.getElementById("devProduct");
const devSerialEl = document.getElementById("devSerial");
const devCountEl = document.getElementById("devCount");
const devTimeEl = document.getElementById("devTime");
const logToggle = document.getElementById("logToggle");
const logContainer = document.getElementById("logContainer");

Driver.setLogger(UI.logLine);

async function connectAndSync() {
  try {
    UI.logLine("Requesting device via WebHID...", "dim");

    const devs = await navigator.hid.requestDevice({
      filters: [{ vendorId: Driver.VID, productId: Driver.PID }]
    });
    if (!devs.length) return UI.logLine("No device selected", "error");

    Driver.device = devs[0];
    devProductEl.textContent = Driver.device.productName || "Silicon Labs C8051F34x";

    Driver.device.removeEventListener("inputreport", Driver.onInputReport);
    Driver.device.addEventListener("inputreport", Driver.onInputReport);

    if (!Driver.device.opened) {
      await Driver.device.open();
      UI.logLine("Device opened", "dim");
    }

    UI.setStatus(true, "Connected");
    await Driver.enableUart();

    UI.logLine("Reading serial number...", "dim");
    const serial = await Driver.readSerial();
    devSerialEl.textContent = `${serial} (TD-${serial.slice(0, 4)})`;

    UI.logLine("Reading device time...", "dim");
    const dt = await Driver.getDatetime();
    devTimeEl.textContent = dt.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    UI.logLine("Reading measurement range settings...", "dim");
    const range = await Driver.readRangeSettings();
    Driver.unit = range.unit;
    UI.unit = range.unit;

    UI.logLine("Reading stored data count...", "dim");
    const count = await Driver.readCount();
    devCountEl.textContent = count;

    const readings = count ? await Driver.readAllReadings(count) : [];
    window.readings = readings;
    UI.renderTable(readings);
    UI.drawChart(readings);

    btnExport.disabled = !readings.length;
    btnExport.onclick = () => UI.exportCSV(readings);

  } catch (e) {
    UI.logLine("Error: " + e, "error");
    UI.setStatus(false, "Error");
  }
}

btnConnect.addEventListener("click", connectAndSync);
logToggle.addEventListener("click", () => {
  const visible = logContainer.style.display !== "none";
  logContainer.style.display = visible ? "none" : "block";
  logToggle.textContent = visible ? "Show log" : "Hide log";
});


if (!("hid" in navigator)) {
  document.getElementById("hidWarning").style.display = "block";
  document.getElementById("btnConnect").disabled = true;
}

