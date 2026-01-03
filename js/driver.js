window.Driver = (() => {

  const VID = 0x10C4, PID = 0xEA80;
  const START = 0x51, STOP = 0xA3, ACK = 0xA5;
  const FRAME_SIZE = 8, DATA_LENGTH = 4;

  const CMD_GET_SYSTEM_CLOCK_TIME     = 35;
  const CMD_DEVICE_PROJECT_CODE       = 36;
  const CMD_STORAGE_DATA_WITH_INDEX1  = 37;
  const CMD_STORAGE_DATA_WITH_INDEX2  = 38;
  const CMD_DEVICE_SERIAL_NUMBER1     = 39;
  const CMD_DEVICE_SERIAL_NUMBER2     = 40;
  const CMD_NUMBER_OF_STORED_READINGS = 43;
  const CMD_GET_RANGE                 = 47;
  const CMD_GET_TIME_SETTING          = 33;
  const CMD_SET_SYSTEM_CLOCK_TIME     = 51;
  const CMD_SET_RANGE                 = 63;
  const CMD_SET_TIME_SETTING          = 49;
  const CMD_SLEEP                     = 80;
  const CMD_CLEAR_MEMORY              = 82;


  const FEATURE_UART_CFG = 0x41;

  let device = null;
  let uartBuffer = [];
  let log = () => {};

  function setLogger(fn) { log = fn; }

  function hex(a) {
    return Array.from(a).map(x => x.toString(16).padStart(2, "0")).join(" ");
  }

  function onInputReport(e) {
    const a = new Uint8Array(e.data.buffer);
    if (!a.length) return;
    uartBuffer.push(a[0]);
  }

  function makeFrame(cmd, data) {
    const b = new Uint8Array(FRAME_SIZE);
    b[0] = START;
    b[1] = cmd;
    if (!data) data = new Uint8Array(DATA_LENGTH);
    b.set(data, 2);
    b[6] = STOP;
    let s = 0;
    for (let i = 0; i < 7; i++) s += b[i];
    b[7] = s & 0xff;
    return b;
  }

  function parseShortFrame(cmd, f) {
    if (f[0] !== START) return null;
    if (f[1] !== cmd) return null;
    if (f[6] !== ACK) return null;
    let s = 0;
    for (let i = 0; i < 7; i++) s += f[i];
    if ((s & 0xff) !== f[7]) return null;
    return f.slice(2, 6);
  }

  async function hidWriteUart(p) {
    log("TX: " + hex(p), "tx");
    
    const b = new Uint8Array(64);
    b[0] = p.length;
    b.set(p, 1);
    await device.sendReport(b[0], b.slice(1, 1 + p.length));
  }

  async function sendCmd(cmd, data) {
    await hidWriteUart(makeFrame(cmd, data));
  }

  async function recvShortResp(cmd, retries = 200) {
    for (let i = 0; i < retries; i++) {

      while (uartBuffer.length >= FRAME_SIZE) {
        const f = Uint8Array.from(uartBuffer.slice(0, FRAME_SIZE));
        const fc = f[1];

        log("RX: " + hex(f), "rx");

        // Wake-up frame
        if (fc === 0x54) {
          uartBuffer.splice(0, FRAME_SIZE);
          log("Wake-up frame received", "dim");
          return "WAKEUP";
        }

        // Expected response
        if (fc === cmd) {
          const p = parseShortFrame(cmd, f);
          uartBuffer.splice(0, FRAME_SIZE);
          if (p) return p;
        }

        // Otherwise discard one byte and continue scanning
        uartBuffer.shift();
      }

      await new Promise(r => setTimeout(r, 10));
    }

    throw new Error("No valid response for cmd " + cmd.toString(16));
  }

  async function sendCmdAndWait(cmd, data) {
    while (true) {
      await sendCmd(cmd, data);

      const resp = await recvShortResp(cmd);

      if (resp === "WAKEUP") {
        log("Device woke up, retrying command...", "dim");
        await new Promise(r => setTimeout(r, 20));
        continue;   // retry the same command
      }

      return resp;  // normal response
    }
  }

  async function enableUart() {
    const b = new Uint8Array([1]);
    log("Sending feature report 0x41 01 to enable UART", "dim");
    await device.sendFeatureReport(FEATURE_UART_CFG, b);
  }

  async function readSerial() {
    const hi = await sendCmdAndWait(CMD_DEVICE_SERIAL_NUMBER2);
    const lo = await sendCmdAndWait(CMD_DEVICE_SERIAL_NUMBER1);
    const h = [hi[3], hi[2], hi[1], hi[0]].map(x => x.toString(16).padStart(2, "0")).join("");
    const l = [lo[3], lo[2], lo[1], lo[0]].map(x => x.toString(16).padStart(2, "0")).join("");
    return h + l;
  }

  async function readCount() {
    const r = await sendCmdAndWait(CMD_NUMBER_OF_STORED_READINGS);
    return r[0] | (r[1] << 8);
  }

  function encodeIndexPayload(i) {
    const d = new Uint8Array(4);
    d[0] = i & 0xff;
    d[1] = (i >> 8) & 0xff;
    return d;
  }

  function decodeRecordTimestamp(a) {
    const year   = 2000 + (a[1] >> 1);
    const month  = ((a[1] & 1) << 3) | ((a[0] >> 5) & 7);
    const day    = a[0] & 0x1f;
    const hour   = a[3];
    const minute = a[2] & 0x3f;
    return new Date(year, month - 1, day, hour, minute);
  }

  async function readRecord(i) {
    log(`Reading record index ${i}...`, "dim");
    const p = encodeIndexPayload(i);
    const a = await sendCmdAndWait(CMD_STORAGE_DATA_WITH_INDEX1, p);

    if (a[0] === 0 && a[1] === 0 && a[2] === 0 && a[3] === 0) return null;
    if (a[2] & 0x80) return null;

    const date = decodeRecordTimestamp(a);

    const b = await sendCmdAndWait(CMD_STORAGE_DATA_WITH_INDEX2, p);
    const value = b[0] | (b[1] << 8);
    const measureType = b[3] >> 6;

    return { index: i, date, value, measureType };
  }

  async function readAllReadings(c) {
    const out = [];
    for (let i = 0; i < c; i++) {
      const r = await readRecord(i);
      if (r) out.push(r);
    }
    return out;
  }

  function decodeSystemClockPayload(p) {
    const b0 = p[0];
    const b1 = p[1];
    const b2 = p[2];
    const b3 = p[3];

    const day = b0 & 0x1F;
    const month = ((b0 >> 5) & 0x07) | ((b1 & 0x01) << 3);
    const year = 2000 + ((b1 >> 1) & 0x7F);
    const minute = b2 & 0x3F;
    const hour = b3 & 0x1F;

    return new Date(year, month - 1, day, hour, minute);
  }

  function encodeSystemClockPayload(dt) {
    const year = dt.getFullYear();
    const month = dt.getMonth() + 1;
    const day = dt.getDate();
    const hour = dt.getHours();
    const minute = dt.getMinutes();

    const b0 = ((month & 0x0F) << 5) | (day & 0x1F);
    const b1 = (((year - 2000) & 0x7F) << 1) | ((month >> 3) & 0x01);
    const b2 = minute & 0x3F;
    const b3 = hour & 0x1F;

    return new Uint8Array([b0, b1, b2, b3]);
  }

  async function getDatetime() {
    const p = await sendCmdAndWait(CMD_GET_SYSTEM_CLOCK_TIME);
    return decodeSystemClockPayload(p);
  }

  async function setDatetime(dt) {
    const payload = encodeSystemClockPayload(dt);
    await sendCmdAndWait(CMD_SET_SYSTEM_CLOCK_TIME, payload);
  }

  return {
    VID, PID,
    get device() { return device; },
    set device(d) { device = d; },

    uartBuffer,
    setLogger,
    onInputReport,

    enableUart,
    readSerial,
    readCount,
    readAllReadings,
    getDatetime,
    setDatetime,
  };

})();

