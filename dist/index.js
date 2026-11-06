// packages/plugin/src/index.ts
import os10 from "node:os";
import path15 from "node:path";

// packages/protocol/src/types.ts
var PROTOCOL_VERSION = 2;
var CLIENT_ID = "dsh-plugin-environments/0.2.0";
var WINDOW = 1024 * 1024;
var CHUNK = 256 * 1024;
var MAX_FRAME = 16 * 1024 * 1024 + 64 * 1024;

// packages/protocol/src/errors.ts
var EnvError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "EnvError";
    this.code = code;
  }
};
function errorCode(error) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : void 0;
  }
  return void 0;
}
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

// packages/protocol/src/frame.ts
function encodeFrame(header, payload) {
  const h = Buffer.from(JSON.stringify(header), "utf8");
  const p = toBuffer(payload);
  const out = Buffer.allocUnsafe(8 + h.length + p.length);
  out.writeUInt32BE(4 + h.length + p.length, 0);
  out.writeUInt32BE(h.length, 4);
  h.copy(out, 8);
  p.copy(out, 8 + h.length);
  return out;
}
function toBuffer(payload) {
  if (!payload) return Buffer.alloc(0);
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
}
var FrameDecoder = class {
  chunks = [];
  length = 0;
  onFrame;
  constructor(onFrame) {
    this.onFrame = onFrame;
  }
  push(data) {
    this.chunks.push(data);
    this.length += data.length;
    while (this.length >= 4) {
      const head = this.peek(4);
      const frameLen = head.readUInt32BE(0);
      if (frameLen < 4 || frameLen > MAX_FRAME) throw new EnvError("PROTOCOL", `bad frame length ${frameLen}`);
      if (this.length < 4 + frameLen) return;
      const body = this.take(4 + frameLen).subarray(4);
      const headerLen = body.readUInt32BE(0);
      if (headerLen > frameLen - 4) throw new EnvError("PROTOCOL", "bad header length");
      const header = JSON.parse(body.subarray(4, 4 + headerLen).toString("utf8"));
      this.onFrame(header, body.subarray(4 + headerLen));
    }
  }
  peek(n) {
    const first = this.chunks[0];
    if (first && first.length >= n) return first.subarray(0, n);
    const merged = Buffer.concat(this.chunks);
    this.chunks = [merged];
    return merged.subarray(0, n);
  }
  take(n) {
    const merged = this.chunks.length === 1 && this.chunks[0] ? this.chunks[0] : Buffer.concat(this.chunks);
    const out = merged.subarray(0, n);
    const rest = merged.subarray(n);
    this.chunks = rest.length > 0 ? [rest] : [];
    this.length -= n;
    return out;
  }
};

// packages/protocol/src/channel.ts
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
var SendWindow = class {
  credit = WINDOW;
  waiters = [];
  closed = false;
  add(n) {
    this.credit += n;
    this.flush();
  }
  close() {
    this.closed = true;
    this.flush();
  }
  flush() {
    let w = this.waiters[0];
    while (w && (this.closed || this.credit >= w.n)) {
      this.waiters.shift();
      if (!this.closed) this.credit -= w.n;
      w.resolve(!this.closed);
      w = this.waiters[0];
    }
  }
  /** Resolve true once n bytes may be sent, false if the channel closed. */
  take(n) {
    if (this.closed) return Promise.resolve(false);
    if (this.waiters.length === 0 && this.credit >= n) {
      this.credit -= n;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => this.waiters.push({ n, resolve }));
  }
};
var Channel = class extends EventEmitter {
  host;
  ch;
  closed = false;
  closeResult = void 0;
  closeError = void 0;
  exit = void 0;
  done;
  readables = /* @__PURE__ */ new Map();
  windows = /* @__PURE__ */ new Map();
  resolveDone;
  constructor(host, ch) {
    super();
    this.host = host;
    this.ch = ch;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }
  /** Readable for server→client data on fd (default 1). */
  readable(fd = 1) {
    return this.creditReadable(fd);
  }
  creditReadable(fd) {
    const existing = this.readables.get(fd);
    if (existing) return existing;
    let pending = 0;
    const r2 = new Readable({
      highWaterMark: 512 * 1024,
      read: () => {
        if (pending > 0 && !this.closed) {
          this.host.send({ t: "win", ch: this.ch, ...fdField(fd, 1), n: pending });
          pending = 0;
        }
      }
    });
    r2.dshCredit = (n) => {
      if (r2.readableFlowing !== false && r2.readableLength < r2.readableHighWaterMark) {
        if (!this.closed) this.host.send({ t: "win", ch: this.ch, ...fdField(fd, 1), n });
      } else {
        pending += n;
      }
    };
    this.readables.set(fd, r2);
    return r2;
  }
  window(fd) {
    let w = this.windows.get(fd);
    if (!w) {
      w = new SendWindow();
      this.windows.set(fd, w);
    }
    return w;
  }
  /** Send bytes to the server on fd (default 0), respecting flow control. */
  async write(data, fd = 0) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    for (let off = 0; off < buf.length; off += CHUNK) {
      const part = buf.subarray(off, Math.min(buf.length, off + CHUNK));
      if (!await this.window(fd).take(part.length)) throw new EnvError("CLOSED", "channel closed");
      this.host.send({ t: "data", ch: this.ch, ...fdField(fd, 0) }, part);
    }
  }
  end(fd = 0) {
    if (!this.closed) this.host.send({ t: "eof", ch: this.ch, ...fdField(fd, 0) });
  }
  /** Writable for client→server data on fd (default 0). */
  writable(fd = 0) {
    return new Writable({
      highWaterMark: 256 * 1024,
      write: (chunk2, _enc, cb) => {
        this.write(chunk2, fd).then(() => cb(), cb);
      },
      final: (cb) => {
        this.end(fd);
        cb();
      },
      destroy: (err, cb) => cb(err)
    });
  }
  /** Abort the channel from the client side. */
  close() {
    if (this.closed) return;
    this.host.send({ t: "close", ch: this.ch });
    this.markClosed(void 0, void 0);
  }
  /** Deliver one frame addressed to this channel. */
  handleFrame(header, payload) {
    switch (header.t) {
      case "data": {
        const r2 = this.creditReadable(header.fd ?? 1);
        const copy = Buffer.from(payload);
        r2.push(copy);
        r2.dshCredit(copy.length);
        break;
      }
      case "eof":
        this.creditReadable(header.fd ?? 1).push(null);
        break;
      case "win":
        this.window(header.fd ?? 0).add(header.n ?? 0);
        break;
      case "exit":
        this.exit = { code: header.code ?? null, signal: header.signal ?? null };
        this.emit("exit", this.exit);
        break;
      case "close":
        this.markClosed(header.result, header.error ? new EnvError(header.error.code, header.error.message) : void 0);
        break;
    }
  }
  /** Mark the channel closed (by the server, the client or a lost connection). */
  markClosed(result, error) {
    if (this.closed) return;
    this.closed = true;
    this.closeResult = result;
    this.closeError = error;
    for (const w of this.windows.values()) w.close();
    for (const r2 of this.readables.values()) {
      if (!r2.readableEnded) {
        if (error) r2.destroy(error);
        else r2.push(null);
      }
    }
    this.host.forgetChannel(this.ch);
    this.emit("close", { result, error });
    this.resolveDone({ result, error });
  }
};
function fdField(fd, defaultFd) {
  return fd === defaultFd ? {} : { fd };
}

// packages/protocol/src/client.ts
import { EventEmitter as EventEmitter2 } from "node:events";
var EnvClient = class extends EventEmitter2 {
  transport;
  token;
  pingMs;
  closed = false;
  closeError = void 0;
  info = void 0;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  channels = /* @__PURE__ */ new Map();
  earlyFrames = /* @__PURE__ */ new Map();
  listenerHandlers = /* @__PURE__ */ new Map();
  decoder;
  hello;
  helloResolve;
  helloReject;
  pingTimer;
  constructor(transport, { token = "", pingMs = 15e3 } = {}) {
    super();
    this.transport = transport;
    this.token = token;
    this.pingMs = pingMs;
    this.decoder = new FrameDecoder((h, p) => this.onFrame(h, p));
    this.hello = new Promise((resolve, reject) => {
      this.helloResolve = resolve;
      this.helloReject = reject;
    });
    this.hello.catch(() => {
    });
    transport.on("data", (data) => {
      try {
        this.decoder.push(data);
      } catch (error) {
        this.fail(error);
      }
    });
    transport.on("close", () => this.fail(new EnvError("CLOSED", "connection closed")));
    transport.on("error", (error) => this.fail(error));
  }
  /** Perform the handshake; resolves to the (raw) server Info. */
  async connect(signal) {
    this.send({ t: "hello", v: PROTOCOL_VERSION, token: this.token, client: CLIENT_ID });
    const onAbort = () => this.fail(new EnvError("CANCELLED", "connect aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    let info;
    try {
      info = await this.hello;
      this.info = info;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (this.pingMs > 0) {
      let n = 0;
      this.pingTimer = setInterval(() => this.send({ t: "ping", n: ++n }), this.pingMs);
      this.pingTimer.unref();
    }
    return info;
  }
  send(header, payload) {
    if (this.closed) return;
    try {
      this.transport.write(encodeFrame(header, payload));
    } catch (error) {
      this.fail(error);
    }
  }
  forgetChannel(ch) {
    this.channels.delete(ch);
  }
  onFrame(header, payload) {
    switch (header.t) {
      case "hello": {
        const h = header;
        if (h.ok) this.helloResolve(h.info);
        else this.helloReject(new EnvError(h.error?.code ?? "AUTH", h.error?.message ?? "handshake rejected"));
        return;
      }
      case "res": {
        const h = header;
        const p = this.pending.get(h.id);
        if (!p) return;
        this.pending.delete(h.id);
        if (h.ok) p.resolve({ result: h.result, payload: Buffer.from(payload) });
        else p.reject(new EnvError(h.error?.code ?? "EIO", h.error?.message ?? "operation failed"));
        return;
      }
      case "ping":
        this.send({ t: "pong", n: header.n });
        return;
      case "pong":
        return;
      case "accept": {
        const h = header;
        const ch = this.channel(h.ch);
        this.emit("accept", { listener: h.listener, ch, peer: h.peer });
        this.listenerHandlers.get(h.listener)?.(ch, h.peer);
        return;
      }
      default: {
        const h = header;
        if (h.ch === void 0) return;
        const ch = this.channels.get(h.ch);
        if (ch) ch.handleFrame(h, payload);
        else {
          let q2 = this.earlyFrames.get(h.ch);
          if (!q2) this.earlyFrames.set(h.ch, q2 = []);
          q2.push([h, Buffer.from(payload)]);
        }
      }
    }
  }
  /** Get or create the client half of a server-allocated channel. */
  channel(id) {
    const existing = this.channels.get(id);
    if (existing) return existing;
    const ch = new Channel(this, id);
    this.channels.set(id, ch);
    const early = this.earlyFrames.get(id);
    if (early) {
      this.earlyFrames.delete(id);
      for (const [h, p] of early) ch.handleFrame(h, p);
    }
    return ch;
  }
  /** Issue a request. Resolves to `{ result, payload }`. */
  request(op, args, payload, signal) {
    if (this.closed) return Promise.reject(this.closeError ?? new EnvError("CLOSED", "connection closed"));
    if (signal?.aborted) return Promise.reject(new EnvError("CANCELLED", "aborted"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.has(id)) return;
        this.send({ t: "cancel", id });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        }
      });
      this.send({ t: "req", id, op, args }, payload);
    });
  }
  /** Issue a request and return only its JSON result. */
  async call(op, args, payload, signal) {
    return (await this.request(op, args, payload, signal)).result;
  }
  /** Route connections accepted by listener `id` to `fn`. Returns an unsubscribe function. */
  onListener(id, fn) {
    this.listenerHandlers.set(id, fn);
    return () => this.listenerHandlers.delete(id);
  }
  /** Tear the connection down with `error`, failing every pending request and channel. */
  fail(error) {
    if (this.closed) return;
    const err = error instanceof Error ? error : new EnvError("CLOSED", errorMessage(error));
    this.closed = true;
    this.closeError = err;
    clearInterval(this.pingTimer);
    this.helloReject(err);
    for (const p of this.pending.values()) p.reject(err instanceof EnvError ? err : new EnvError("CLOSED", err.message));
    this.pending.clear();
    for (const ch of [...this.channels.values()]) ch.markClosed(void 0, new EnvError("CLOSED", "connection closed"));
    try {
      this.transport.destroy?.();
    } catch {
    }
    this.emit("close", err);
  }
  close() {
    if (this.closed) return;
    try {
      this.transport.end?.();
    } catch {
    }
    this.fail(new EnvError("CLOSED", "connection closed by client"));
  }
};

// packages/protocol/src/transports.ts
import { EventEmitter as EventEmitter3 } from "node:events";
var CallbackTransport = class extends EventEmitter3 {
  writeFn;
  endFn;
  destroyFn;
  constructor(fns) {
    super();
    this.writeFn = fns.write;
    this.endFn = fns.end;
    this.destroyFn = fns.destroy;
    this.on("newListener", (event) => {
      if (event !== "data" || !this.early || this.flushing) return;
      this.flushing = true;
      queueMicrotask(() => {
        const queued = this.early ?? [];
        this.early = void 0;
        for (const d of queued) this.emit("data", d);
      });
    });
  }
  early = [];
  flushing = false;
  /** Deliver received bytes; bytes pushed before anyone listens for `data` are held, not dropped. */
  push(data) {
    if (this.early) this.early.push(data);
    else this.emit("data", data);
  }
  write(data) {
    return this.writeFn(data);
  }
  end() {
    return this.endFn();
  }
  destroy() {
    return this.destroyFn();
  }
};
function childTransport(child) {
  const t = new CallbackTransport({
    write: (buf) => child.stdin.write(buf),
    end: () => child.stdin.end(),
    destroy: () => {
      try {
        child.stdin.end();
      } catch {
      }
      setTimeout(() => {
        try {
          child.kill();
        } catch {
        }
      }, 2e3).unref();
    }
  });
  child.stdout.on("data", (d) => t.emit("data", d));
  child.on("exit", () => t.emit("close"));
  child.on("error", (e) => t.emit("error", e));
  child.stdin.on("error", () => {
  });
  return t;
}

// packages/protocol/src/secure.ts
import crypto from "node:crypto";
var SECURE_MAGIC = Buffer.from("DSHS");
var SECURE_VERSION = 2;
var MAX_RECORD = 64 * 1024;
var TAG = 16;
var INFO = Buffer.from("dsh-env secure v2\0");
var HANDSHAKE_TIMEOUT_MS = 15e3;
function deriveKeys(secret, nonceI, nonceR, id, transcript) {
  const okm = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(secret),
      Buffer.concat([nonceI, nonceR]),
      Buffer.concat([INFO, Buffer.from(id)]),
      128
    )
  );
  const th = crypto.createHash("sha256").update(transcript).digest();
  const mac = (key, label) => crypto.createHmac("sha256", key).update(label).update(th).digest();
  return {
    i2r: okm.subarray(0, 32),
    r2i: okm.subarray(32, 64),
    confirmI: mac(okm.subarray(64, 96), "initiator"),
    confirmR: mac(okm.subarray(96, 128), "responder")
  };
}
var RecordCipher = class {
  key;
  seq = 0n;
  constructor(key) {
    this.key = key;
  }
  nonce() {
    const n = Buffer.alloc(12);
    n.writeBigUInt64BE(this.seq, 4);
    this.seq++;
    return n;
  }
  /** Encrypt one record (`plain.length <= MAX_RECORD`) into its wire bytes. */
  seal(plain) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(plain.length + TAG);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, this.nonce(), { authTagLength: TAG });
    c.setAAD(len);
    return Buffer.concat([len, c.update(plain), c.final(), c.getAuthTag()]);
  }
  /** Decrypt one record body (ciphertext || tag) whose length prefix is `len`. */
  open(len, body) {
    if (body.length < TAG) throw new EnvError("PROTOCOL", "short record");
    const d = crypto.createDecipheriv("aes-256-gcm", this.key, this.nonce(), { authTagLength: TAG });
    d.setAAD(len);
    d.setAuthTag(body.subarray(body.length - TAG));
    try {
      return Buffer.concat([d.update(body.subarray(0, body.length - TAG)), d.final()]);
    } catch {
      throw new EnvError("PROTOCOL", "record authentication failed");
    }
  }
};
var HandshakeReader = class {
  buf = Buffer.alloc(0);
  want;
  ended;
  offData;
  constructor(transport) {
    let active = true;
    const onData = (d) => {
      if (!active) return;
      this.buf = Buffer.concat([this.buf, d]);
      this.pump();
    };
    const onEnd = (e) => {
      if (!active) return;
      this.ended = e ?? new EnvError("AUTH", "peer closed the connection during the handshake (unknown id or wrong secret?)");
      this.pump();
    };
    transport.on("data", onData);
    transport.on("close", () => onEnd());
    transport.on("error", (e) => onEnd(e));
    this.offData = () => {
      active = false;
    };
  }
  pump() {
    const w = this.want;
    if (!w) return;
    if (this.buf.length >= w.n) {
      this.want = void 0;
      const out = this.buf.subarray(0, w.n);
      this.buf = this.buf.subarray(w.n);
      w.resolve(out);
    } else if (this.ended) {
      this.want = void 0;
      w.reject(this.ended);
    }
  }
  read(n) {
    return new Promise((resolve, reject) => {
      this.want = { n, resolve, reject };
      this.pump();
    });
  }
  /** Stop listening and return bytes received past the handshake. */
  detach() {
    this.offData();
    return this.buf;
  }
};
function withTimeout(p, transport, signal) {
  return new Promise((resolve, reject) => {
    const fail = (e) => {
      cleanup();
      try {
        transport.destroy?.();
      } catch {
      }
      reject(e);
    };
    const timer = setTimeout(() => fail(new EnvError("ETIMEDOUT", "secure handshake timed out")), HANDSHAKE_TIMEOUT_MS);
    const onAbort = () => fail(new EnvError("CANCELLED", "aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => fail(e instanceof Error ? e : new EnvError("EIO", String(e)))
    );
  });
}
function recordTransport(inner, leftover, rx, tx) {
  let closed = false;
  const out = new CallbackTransport({
    write: (data) => {
      for (let i = 0; i < data.length; i += MAX_RECORD) inner.write(tx.seal(data.subarray(i, i + MAX_RECORD)));
      return true;
    },
    end: () => inner.end?.(),
    destroy: () => inner.destroy?.()
  });
  const close = () => {
    if (closed) return;
    closed = true;
    out.emit("close");
  };
  const deliver = (plain) => out.push(plain);
  let buf = Buffer.alloc(0);
  const onData = (d) => {
    if (closed) return;
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    try {
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (n < TAG || n > MAX_RECORD + TAG) throw new EnvError("PROTOCOL", "bad record length");
        if (buf.length < 4 + n) break;
        const plain = rx.open(buf.subarray(0, 4), buf.subarray(4, 4 + n));
        buf = buf.subarray(4 + n);
        if (plain.length) deliver(plain);
      }
    } catch (e) {
      out.emit("error", e instanceof Error ? e : new EnvError("PROTOCOL", String(e)));
      try {
        inner.destroy?.();
      } catch {
      }
      close();
    }
  };
  inner.on("data", onData);
  inner.on("close", close);
  inner.on("error", (e) => {
    if (!closed) out.emit("error", e);
  });
  if (leftover.length) onData(leftover);
  return out;
}
function secureInitiate(transport, { secret, id = "", signal }) {
  const reader = new HandshakeReader(transport);
  const idBytes = Buffer.from(id);
  if (idBytes.length > 255) return Promise.reject(new EnvError("EINVAL", "id too long"));
  const nonceI = crypto.randomBytes(32);
  const hello = Buffer.concat([
    SECURE_MAGIC,
    Buffer.from([SECURE_VERSION]),
    nonceI,
    Buffer.from([idBytes.length]),
    idBytes
  ]);
  const run = async () => {
    transport.write(hello);
    const reply = await reader.read(69);
    if (!reply.subarray(0, 4).equals(SECURE_MAGIC) || reply[4] !== SECURE_VERSION)
      throw new EnvError("PROTOCOL", "peer does not speak the dsh-env secure channel");
    const keys = deriveKeys(
      secret,
      nonceI,
      reply.subarray(5, 37),
      idBytes,
      Buffer.concat([hello, reply.subarray(0, 37)])
    );
    if (!crypto.timingSafeEqual(keys.confirmR, reply.subarray(37, 69)))
      throw new EnvError("AUTH", "peer failed to prove knowledge of the secret (wrong secret?)");
    transport.write(keys.confirmI);
    return recordTransport(transport, reader.detach(), new RecordCipher(keys.r2i), new RecordCipher(keys.i2r));
  };
  return withTimeout(run(), transport, signal);
}
function secureRespond(transport, lookup) {
  const reader = new HandshakeReader(transport);
  const run = async () => {
    const head = await reader.read(38);
    if (!head.subarray(0, 4).equals(SECURE_MAGIC)) throw new EnvError("PROTOCOL", "not a dsh-env secure channel");
    if (head[4] !== SECURE_VERSION) throw new EnvError("PROTOCOL", "unsupported secure channel version");
    const idBytes = await reader.read(head[37] ?? 0);
    const id = idBytes.toString("utf8");
    const secret = lookup(id);
    if (secret === void 0) throw new EnvError("AUTH", `unknown id "${id}"`);
    const nonceR = crypto.randomBytes(32);
    const replyHead = Buffer.concat([SECURE_MAGIC, Buffer.from([SECURE_VERSION]), nonceR]);
    const keys = deriveKeys(secret, head.subarray(5, 37), nonceR, idBytes, Buffer.concat([head, idBytes, replyHead]));
    transport.write(Buffer.concat([replyHead, keys.confirmR]));
    const confirm = await reader.read(32);
    if (!crypto.timingSafeEqual(keys.confirmI, confirm))
      throw new EnvError("AUTH", "client failed to prove knowledge of the secret");
    return {
      transport: recordTransport(transport, reader.detach(), new RecordCipher(keys.i2r), new RecordCipher(keys.r2i)),
      id
    };
  };
  return withTimeout(run(), transport, void 0);
}
function generateSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

// packages/protocol/src/websocket.ts
import crypto2 from "node:crypto";
import http from "node:http";
import https from "node:https";
var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var MAX_PAYLOAD = 16 * 1024 * 1024 + 64 * 1024;
var OP = { cont: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 };
function wsAcceptKey(key) {
  return crypto2.createHash("sha1").update(key.trim() + GUID).digest("base64");
}
function encodeWsFrame(opcode, payload, mask) {
  const n = payload.length;
  const lenBytes = n < 126 ? 0 : n <= 65535 ? 2 : 8;
  const head = Buffer.alloc(2 + lenBytes + (mask ? 4 : 0));
  head[0] = 128 | opcode;
  const m = mask ? 128 : 0;
  if (lenBytes === 0) head[1] = m | n;
  else if (lenBytes === 2) {
    head[1] = m | 126;
    head.writeUInt16BE(n, 2);
  } else {
    head[1] = m | 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  if (!mask) return Buffer.concat([head, payload]);
  const key = crypto2.randomBytes(4);
  key.copy(head, 2 + lenBytes);
  const body = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) body[i] = (payload[i] ?? 0) ^ (key[i & 3] ?? 0);
  return Buffer.concat([head, body]);
}
var WsDecoder = class {
  buf = Buffer.alloc(0);
  expectMasked;
  onFrame;
  constructor(expectMasked, onFrame) {
    this.expectMasked = expectMasked;
    this.onFrame = onFrame;
  }
  push(data) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    for (; ; ) {
      const b = this.buf;
      if (b.length < 2) return;
      const b0 = b[0] ?? 0;
      const b1 = b[1] ?? 0;
      if (b0 & 112) throw new EnvError("PROTOCOL", "reserved websocket bits set");
      const fin = (b0 & 128) !== 0;
      const opcode = b0 & 15;
      const masked = (b1 & 128) !== 0;
      if (masked !== this.expectMasked)
        throw new EnvError("PROTOCOL", masked ? "server frames must not be masked" : "client frames must be masked");
      let len = b1 & 127;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) throw new EnvError("PROTOCOL", "websocket frame too large");
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD) throw new EnvError("PROTOCOL", "websocket frame too large");
      if (opcode >= 8 && (len > 125 || !fin)) throw new EnvError("PROTOCOL", "bad websocket control frame");
      const keyAt = off;
      if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = (payload[i] ?? 0) ^ (b[keyAt + (i & 3)] ?? 0);
        payload = out;
      } else {
        payload = Buffer.from(payload);
      }
      this.buf = b.subarray(off + len);
      this.onFrame({ fin, opcode, payload });
    }
  }
};
function wsTransport(socket, head, isClient) {
  let closed = false;
  let sentClose = false;
  const sendClose = () => {
    if (sentClose || socket.destroyed) return;
    sentClose = true;
    const code = Buffer.alloc(2);
    code.writeUInt16BE(1e3);
    socket.write(encodeWsFrame(OP.close, code, isClient));
  };
  const t = new CallbackTransport({
    write: (data) => socket.write(encodeWsFrame(OP.binary, data, isClient)),
    end: () => {
      sendClose();
      socket.end();
    },
    destroy: () => {
      sendClose();
      socket.destroy();
    }
  });
  const close = () => {
    if (closed) return;
    closed = true;
    t.emit("close");
  };
  const decoder = new WsDecoder(!isClient, (f) => {
    switch (f.opcode) {
      case OP.binary:
      case OP.cont:
        if (f.payload.length) t.push(f.payload);
        return;
      case OP.ping:
        socket.write(encodeWsFrame(OP.pong, f.payload, isClient));
        return;
      case OP.pong:
        return;
      case OP.close:
        sendClose();
        socket.end();
        close();
        return;
      default:
        throw new EnvError("PROTOCOL", "text frames are not supported");
    }
  });
  const onData = (d) => {
    if (closed) return;
    try {
      decoder.push(d);
    } catch (e) {
      t.emit("error", e instanceof Error ? e : new EnvError("PROTOCOL", String(e)));
      socket.destroy();
      close();
    }
  };
  socket.on("data", onData);
  socket.on("end", () => {
    socket.end();
    close();
  });
  socket.on("close", close);
  socket.on("error", (e) => {
    if (!closed) t.emit("error", e);
  });
  if (head.length) onData(head);
  return t;
}
function wsConnect(url, { signal, timeoutMs = 15e3, headers = {} } = {}) {
  const u = new URL(url);
  if (u.protocol !== "ws:" && u.protocol !== "wss:")
    return Promise.reject(new EnvError("EINVAL", `not a websocket URL: ${url}`));
  const key = crypto2.randomBytes(16).toString("base64");
  const mod = u.protocol === "wss:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      protocol: u.protocol === "wss:" ? "https:" : "http:",
      hostname: u.hostname.replace(/^\[|\]$/g, ""),
      port: u.port || (u.protocol === "wss:" ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      headers: {
        ...headers,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13"
      }
    });
    let done = false;
    const finish = (e, t) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (e) {
        req.destroy();
        reject(e);
      } else if (t) resolve(t);
    };
    const timer = setTimeout(() => finish(new EnvError("ETIMEDOUT", `connecting to ${url} timed out`)), timeoutMs);
    const onAbort = () => finish(new EnvError("CANCELLED", "aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("upgrade", (res, socket, head) => {
      if (res.headers["sec-websocket-accept"] !== wsAcceptKey(key)) {
        socket.destroy();
        finish(new EnvError("PROTOCOL", "bad Sec-WebSocket-Accept"));
        return;
      }
      if ("setNoDelay" in socket && typeof socket.setNoDelay === "function") socket.setNoDelay(true);
      finish(void 0, wsTransport(socket, head, true));
    });
    req.on("response", (res) => {
      res.resume();
      finish(new EnvError("EIO", `websocket upgrade refused: HTTP ${String(res.statusCode)}`));
    });
    req.on(
      "error",
      (e) => finish(new EnvError(e.code ?? "EIO", `cannot connect to ${url}: ${e.message}`))
    );
    req.end();
  });
}
function wsAccept(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  if (req.method !== "GET" || upgrade !== "websocket" || typeof key !== "string") {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return void 0;
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r
\r
`
  );
  return wsTransport(socket, head, false);
}

// packages/plugin/src/api/actions.ts
import os4 from "node:os";
import path6 from "node:path";

// packages/plugin/src/env/winuser/accounts.ts
import crypto4 from "node:crypto";
import fs3 from "node:fs";
import os2 from "node:os";
import path4 from "node:path";

// packages/plugin/src/env/host-process.ts
import { execFileSync, spawn } from "node:child_process";
import { isUtf8 } from "node:buffer";
function codePageLabel(cp) {
  const known = {
    936: "gbk",
    54936: "gb18030",
    950: "big5",
    932: "shift_jis",
    949: "euc-kr",
    866: "ibm866",
    874: "windows-874",
    20866: "koi8-r",
    65001: "utf-8"
  };
  const label = known[cp];
  if (label) return label;
  if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  return "windows-1252";
}
var legacy;
function legacyDecoder() {
  if (legacy) return legacy;
  let cp = 437;
  try {
    const out = execFileSync("cmd.exe", ["/d", "/c", "chcp"], { windowsHide: true, timeout: 5e3 }).toString("latin1");
    cp = Number(/(\d+)\s*$/.exec(out.trim())?.[1] ?? cp);
  } catch {
  }
  try {
    legacy = new TextDecoder(codePageLabel(cp));
  } catch {
    legacy = new TextDecoder("windows-1252");
  }
  return legacy;
}
function decodeHostText(buf, decoder) {
  if (isUtf8(buf)) return Buffer.from(buf).toString("utf8");
  if (!decoder && process.platform !== "win32") return Buffer.from(buf).toString("utf8");
  const dec = (decoder ?? legacyDecoder)();
  let out = "";
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(10, start);
    const end = nl < 0 ? buf.length : nl + 1;
    const line = buf.subarray(start, end);
    out += isUtf8(line) ? Buffer.from(line).toString("utf8") : dec.decode(line);
    start = end;
  }
  return out;
}
function runHost(cmd, args, { input, signal, timeoutMs = 12e4, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out = [];
    const err = [];
    let size = 0;
    child.stdout.on("data", (d) => {
      size += d.length;
      if (size <= maxBytes) out.push(d);
    });
    child.stderr.on("data", (d) => err.push(d));
    const kill = () => {
      try {
        child.kill();
      } catch {
      }
    };
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new EnvError(e.code === "ENOENT" ? "ENOENT" : "EIO", `${cmd}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (size > maxBytes) {
        reject(new EnvError("ETOOBIG", `output exceeds ${maxBytes} bytes`));
        return;
      }
      resolve({ code, stdout: Buffer.concat(out), stderr: decodeHostText(Buffer.concat(err)) });
    });
    child.stdin.on("error", () => {
    });
    if (input !== void 0) child.stdin.end(input);
    else child.stdin.end();
  });
}
var HostChildProcess = class {
  child;
  pid;
  pty;
  stdin;
  stdout;
  stderr;
  exited;
  onResize;
  constructor(child, { pty = false, onResize } = {}) {
    this.child = child;
    this.pid = child.pid;
    this.pty = pty;
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.stderr = child.stderr;
    this.onResize = onResize;
    child.stdin.on("error", () => {
    });
    this.exited = new Promise((resolve) => {
      child.once("error", () => resolve({ code: null, signal: "ERROR" }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  }
  write(data) {
    return new Promise((resolve, reject) => this.child.stdin.write(data, (e) => e ? reject(e) : resolve()));
  }
  end() {
    this.child.stdin.end();
  }
  async resize(rows, cols) {
    await this.onResize?.(rows, cols);
  }
  async kill() {
    if (this.child.exitCode !== null) return;
    if (process.platform === "win32") {
      await runHost("taskkill", ["/T", "/F", "/PID", String(this.child.pid)]).catch(() => {
      });
    } else {
      try {
        this.child.kill("SIGKILL");
      } catch {
      }
    }
  }
};

// packages/plugin/src/env/server/connect.ts
import { spawn as spawn2 } from "node:child_process";
import net2 from "node:net";

// packages/plugin/src/server-binary.ts
import crypto3 from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import zlib from "node:zlib";

// packages/plugin/src/paths.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var PACKAGE_NAME = "dsh-plugin-environments";
function findPackageRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (; ; ) {
    const manifest = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.name === PACKAGE_NAME) return dir;
    } catch {
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    dir = parent;
  }
}
var PACKAGE_ROOT = findPackageRoot();
function binDir(target = `${process.platform}-${process.arch}`) {
  return path.join(PACKAGE_ROOT, "bin", target);
}
var ANDROID_HELPER_JAR = path.join(PACKAGE_ROOT, "android", "dsh-clipboard.jar");
var CRATE_TARGET_DIR = path.join(PACKAGE_ROOT, "..", "..", "crates", "dsh-env-server", "target");

// packages/plugin/src/server-binary.ts
var SERVER_TARGETS = ["win32-x64", "linux-x64", "linux-ia32", "linux-arm64", "darwin-arm64"];
var HOST_TARGET = `${process.platform}-${process.arch}`;
function serverExeName(target = HOST_TARGET) {
  return target.startsWith("win32-") ? "dsh-env-server.exe" : "dsh-env-server";
}
function targetForHost(system, machine) {
  const sys = system.trim().toLowerCase();
  const m = machine.trim().toLowerCase();
  const arch = /^(x86_64|amd64|x64)$/.test(m) ? "x64" : /^(aarch64|arm64|armv8.*)$/.test(m) ? "arm64" : /^(i[3-6]86|x86)$/.test(m) ? "ia32" : void 0;
  if (!arch) return void 0;
  const platform = sys === "linux" ? "linux" : sys === "darwin" ? "darwin" : /windows|mingw|msys|cygwin/.test(sys) ? "win32" : void 0;
  if (!platform) return void 0;
  const target = `${platform}-${arch}`;
  return SERVER_TARGETS.includes(target) ? target : void 0;
}
function targetBinDir(target) {
  const root = process.env["DSH_ENV_SERVER_BIN_DIR"];
  return root ? path2.join(root, target) : binDir(target);
}
function locate(target) {
  const exe = serverExeName(target);
  const dir = targetBinDir(target);
  const raw = path2.join(dir, exe);
  if (fs2.existsSync(raw)) return { file: raw, compressed: false };
  const br = `${raw}.br`;
  if (fs2.existsSync(br)) return { file: br, compressed: true };
  if (target === HOST_TARGET) {
    for (const profile of ["release", "debug"]) {
      const built = path2.join(CRATE_TARGET_DIR, profile, exe);
      if (fs2.existsSync(built)) return { file: built, compressed: false };
    }
  }
  return void 0;
}
function serverBinaryBytes(target = HOST_TARGET) {
  const override = target === HOST_TARGET ? process.env["DSH_ENV_SERVER_BIN"] : void 0;
  if (override && fs2.existsSync(override)) return fs2.readFileSync(override);
  const found = locate(target);
  if (!found) return void 0;
  const data = fs2.readFileSync(found.file);
  return found.compressed ? zlib.brotliDecompressSync(data) : data;
}
function binaryHash(data) {
  return crypto3.createHash("sha256").update(data).digest("hex").slice(0, 16);
}
function cacheRoot() {
  const home = process.env["DSH_HOME"] || path2.join(os.homedir(), ".dsh");
  return path2.join(home, "cache", "dsh-plugin-environments", "bin");
}
function serverBinaryFile(target = HOST_TARGET, override) {
  if (override) return override;
  const env = target === HOST_TARGET ? process.env["DSH_ENV_SERVER_BIN"] : void 0;
  if (env && fs2.existsSync(env)) return env;
  const found = locate(target);
  if (!found) {
    throw new EnvError("ENOENT", `dsh-env-server binary for ${target} not found in ${targetBinDir(target)}`);
  }
  if (!found.compressed) return found.file;
  const data = zlib.brotliDecompressSync(fs2.readFileSync(found.file));
  const dir = path2.join(cacheRoot(), `${target}-${binaryHash(data)}`);
  const file = path2.join(dir, serverExeName(target));
  if (fs2.existsSync(file) && fs2.statSync(file).size === data.length) return file;
  fs2.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs2.writeFileSync(tmp, data, { mode: 493 });
  try {
    fs2.renameSync(tmp, file);
  } catch (e) {
    fs2.rmSync(tmp, { force: true });
    if (!fs2.existsSync(file)) throw e;
  }
  return file;
}

// packages/plugin/src/env/environment.ts
import { EventEmitter as EventEmitter4 } from "node:events";
import path3 from "node:path";
var tunnelSeq = 0;
var Environment = class extends EventEmitter4 {
  id;
  name;
  kind;
  info = void 0;
  closed = false;
  closeError = void 0;
  tunnels = /* @__PURE__ */ new Map();
  constructor({ id, name: name2, kind }) {
    super();
    this.id = id;
    this.name = name2 ?? id;
    this.kind = kind;
  }
  get caps() {
    return new Set(this.info?.caps ?? []);
  }
  hasCap(cap) {
    return this.caps.has(cap);
  }
  get family() {
    return this.info?.family ?? "posix";
  }
  /** Path module matching the environment's platform. */
  get path() {
    return this.family === "windows" ? path3.win32 : path3.posix;
  }
  /** Resolve a possibly relative path against cwd in the environment's spelling. */
  resolvePath(p, cwd) {
    const P = this.path;
    if (P.isAbsolute(p)) return P.normalize(p);
    return P.resolve(cwd ?? this.info?.cwd ?? (this.family === "windows" ? "C:\\" : "/"), p);
  }
  /** Register an open tunnel so it is listed and closed together with the environment. */
  trackTunnel(spec) {
    const id = `t${++tunnelSeq}`;
    const { close, ...rest } = spec;
    const entry = {
      id,
      ...rest,
      createdAt: Date.now(),
      close: async () => {
        if (!this.tunnels.has(id)) return;
        this.tunnels.delete(id);
        await close();
        this.emit("change");
      }
    };
    this.tunnels.set(id, entry);
    this.emit("change");
    return entry;
  }
  listTunnels() {
    return [...this.tunnels.values()].map(({ close: _close, ...rest }) => rest);
  }
  /** Mark the environment closed (transport lost or closed). Idempotent. */
  markClosed(error) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    for (const t of [...this.tunnels.values()]) t.close().catch(() => {
    });
    this.emit("close", error);
  }
  /** Close tunnels and the transport. Idempotent. */
  async close() {
    if (this.closed) return;
    for (const t of [...this.tunnels.values()]) await t.close().catch(() => {
    });
    try {
      await this.closeTransport();
    } finally {
      this.markClosed();
    }
  }
  /** Release the underlying transport (connection, child process, ...). */
  async closeTransport() {
  }
  // ---- capability defaults -------------------------------------------------
  stat(_path, _opts) {
    return this.unsupported("stat");
  }
  readdir(_path, _opts) {
    return this.unsupported("readdir");
  }
  readFile(_path, _opts) {
    return this.unsupported("readFile");
  }
  writeFile(_path, _data, _opts) {
    return this.unsupported("writeFile");
  }
  mkdir(_path, _opts) {
    return this.unsupported("mkdir");
  }
  remove(_path, _opts) {
    return this.unsupported("remove");
  }
  rename(_from, _to, _opts) {
    return this.unsupported("rename");
  }
  copy(_from, _to, _opts) {
    return this.unsupported("copy");
  }
  realpath(p, _opts) {
    return Promise.resolve(p);
  }
  glob(_pattern, _opts) {
    return this.unsupported("glob");
  }
  grep(_pattern, _opts) {
    return this.unsupported("grep");
  }
  spawn(_spec, _opts) {
    return this.unsupported("spawn");
  }
  forward(_opts) {
    return this.unsupported("forward");
  }
  reverse(_opts) {
    return this.unsupported("reverse");
  }
  screenshot(_opts) {
    return this.unsupported("screenshot");
  }
  input(_actions, _opts) {
    return this.unsupported("input");
  }
  /**
   * Capture the screen (or part of it) for computer use. The default takes a full
   * {@link screenshot}; implementations may honour `opts` and return a smaller area.
   */
  async capture(opts = {}) {
    const s = await this.screenshot(opts);
    return { png: s.png, width: s.width, height: s.height, rect: { x: 0, y: 0, width: s.width, height: s.height } };
  }
  /** Attached displays (physical pixels). */
  displays(_opts) {
    return this.unsupported("displays");
  }
  /** Top-level windows in z-order (topmost first). */
  windows(_opts) {
    return this.unsupported("windows");
  }
  /** Focus, minimize, maximize, restore, close or move (`rect`, physical pixels) a window. */
  windowAction(_hwnd, _action, _rect, _opts) {
    return this.unsupported("windowAction");
  }
  unsupported(op) {
    return Promise.reject(unsupported(this, op));
  }
  /** Run a command to completion and collect output (convenience). */
  async exec(spec, { signal, stdin, maxBytes = 4 * 1024 * 1024, timeoutMs } = {}) {
    const proc = await this.spawn(spec, { signal });
    const out = [];
    const err = [];
    let outLen = 0;
    let errLen = 0;
    let truncated = false;
    proc.stdout.on("data", (d) => {
      if (outLen < maxBytes) {
        out.push(d);
        outLen += d.length;
      } else truncated = true;
    });
    proc.stderr.on("data", (d) => {
      if (errLen < maxBytes) {
        err.push(d);
        errLen += d.length;
      } else truncated = true;
    });
    const onAbort = () => {
      proc.kill().catch(() => {
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = timeoutMs ? setTimeout(onAbort, timeoutMs) : void 0;
    try {
      if (stdin !== void 0) await proc.write(Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin));
      proc.end();
      const exit = await proc.exited;
      const ended = (s) => s.readableEnded ? void 0 : new Promise((r2) => {
        s.once("end", r2);
        s.once("close", r2);
        setTimeout(r2, 2e3);
      });
      await Promise.all([ended(proc.stdout), ended(proc.stderr)]);
      return {
        code: exit.code,
        signal: exit.signal,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
        truncated,
        timedOut: signal?.aborted ? false : void 0
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  describe() {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      info: this.info,
      closed: this.closed,
      tunnels: this.listTunnels()
    };
  }
};
function unsupported(env, op) {
  return new EnvError("UNSUPPORTED", `${env.name ?? "environment"} (${env.kind}) does not support ${op}`);
}

// packages/plugin/src/env/server/server-process.ts
import { Readable as Readable2 } from "node:stream";
var ServerProcess = class {
  client;
  channel;
  pid;
  pty;
  stdin;
  stdout;
  stderr;
  exited;
  constructor(client, channel, pid, pty) {
    this.client = client;
    this.channel = channel;
    this.pid = pid;
    this.pty = pty;
    this.stdin = channel.writable(0);
    this.stdout = channel.readable(1);
    this.stderr = pty ? Readable2.from([]) : channel.readable(2);
    for (const s of [this.stdin, this.stdout, this.stderr]) s.on("error", () => {
    });
    this.exited = new Promise((resolve) => {
      channel.once("exit", (exit) => resolve(exit));
      void channel.done.then(({ error }) => {
        if (channel.exit) resolve(channel.exit);
        else resolve({ code: null, signal: error ? "DISCONNECTED" : "KILLED" });
      });
    });
  }
  write(data) {
    return this.channel.write(data, 0);
  }
  end() {
    this.channel.end(0);
  }
  async resize(rows, cols) {
    await this.client.call("proc.resize", { ch: this.channel.ch, rows, cols });
  }
  async kill(signal = "KILL") {
    if (this.channel.closed) return;
    try {
      await this.client.call("proc.kill", { ch: this.channel.ch, signal });
    } catch {
      this.channel.close();
    }
  }
};

// packages/plugin/src/env/server/tunnels.ts
import dgram from "node:dgram";
import net from "node:net";
function pipeChannelSocket(channel, socket) {
  const r2 = channel.readable(1);
  r2.pipe(socket);
  socket.on("data", (d) => {
    socket.pause();
    channel.write(d, 0).then(
      () => socket.resume(),
      () => socket.destroy()
    );
  });
  socket.on("end", () => channel.end(0));
  socket.on("error", () => channel.close());
  socket.on("close", () => channel.close());
  channel.once("close", () => socket.destroy());
}
function udpType(host) {
  return host.includes(":") ? "udp6" : "udp4";
}
async function forwardTcp(client, localHost, localPort, remoteHost, remotePort) {
  const server = net.createServer((socket) => {
    socket.pause();
    client.call("net.connect", { host: remoteHost, port: remotePort, proto: "tcp" }).then(
      ({ ch }) => {
        pipeChannelSocket(client.channel(ch), socket);
        socket.resume();
      },
      () => socket.destroy()
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(localPort, localHost, resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
async function forwardUdp(client, localHost, localPort, remoteHost, remotePort) {
  const sock = dgram.createSocket(udpType(localHost));
  await new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(localPort, localHost, resolve);
  });
  const peers = /* @__PURE__ */ new Map();
  sock.on("message", (msg, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`;
    let entry = peers.get(key);
    if (!entry) {
      entry = {
        ready: client.call("net.connect", { host: remoteHost, port: remotePort, proto: "udp" }).then(({ ch }) => {
          const channel = client.channel(ch);
          channel.readable(1).on("data", (d) => sock.send(d, rinfo.port, rinfo.address));
          channel.once("close", () => peers.delete(key));
          return channel;
        })
      };
      peers.set(key, entry);
    }
    const ready = entry.ready;
    void (async () => {
      try {
        const channel = await ready;
        await channel.write(msg, 0);
      } catch {
        peers.delete(key);
      }
    })();
  });
  return {
    port: sock.address().port,
    close: async () => {
      for (const e of peers.values()) {
        e.ready.then(
          (c) => c.close(),
          () => {
          }
        );
      }
      await new Promise((resolve) => sock.close(() => resolve()));
    }
  };
}
async function reverseTunnel(client, remoteHost, remotePort, localHost, localPort, proto) {
  const { id, port } = await client.call("net.listen", { host: remoteHost, port: remotePort, proto });
  let off;
  if (proto === "udp") {
    off = client.onListener(id, (channel) => {
      const sock = dgram.createSocket(udpType(localHost));
      sock.connect(localPort, localHost, () => {
        channel.readable(1).on("data", (d) => sock.send(d));
      });
      sock.on("message", (msg) => {
        channel.write(msg, 0).catch(() => {
        });
      });
      sock.on("error", () => channel.close());
      channel.once("close", () => {
        try {
          sock.close();
        } catch {
        }
      });
    });
  } else {
    off = client.onListener(id, (channel) => {
      const socket = net.connect(localPort, localHost);
      socket.once("connect", () => pipeChannelSocket(channel, socket));
      socket.once("error", () => channel.close());
    });
  }
  return {
    port,
    close: async () => {
      off();
      await client.call("net.unlisten", { id }).catch(() => {
      });
    }
  };
}

// packages/plugin/src/env/server/server-env.ts
var STREAM_THRESHOLD = 15 * 1024 * 1024;
var MAX_READ = 16 * 1024 * 1024;
var ServerEnvironment = class extends Environment {
  client;
  /** True when the server runs over an SSH exec channel. */
  viaServer = false;
  /** SSH connection carrying the server, when `viaServer`. */
  ssh = void 0;
  /** Windows account the server runs as (winuser environments). */
  account = void 0;
  /** Private desktop the account's windows live on, when it has one (`WinSta0\<name>`). */
  desktopName = void 0;
  /** Process id of a server launched for this environment, when known. */
  serverPid = void 0;
  /** How the connection is carried (diagnostics), e.g. `ssh-forward`, `ssh-stdio`. */
  transportMode = void 0;
  /** Address of the server as seen from its host, when it listens on one. */
  remoteEndpoint = void 0;
  onCloseHook;
  constructor(opts) {
    super(opts);
    this.client = new EnvClient(opts.transport, { token: opts.token ?? "" });
    this.onCloseHook = opts.onClose;
    this.client.on("close", (error) => this.markClosed(error));
  }
  async open(signal) {
    this.info = normalizeInfo(await this.client.connect(signal));
    return this;
  }
  async stat(path16, opts = {}) {
    return this.client.call("fs.stat", { path: path16, follow: opts.follow ?? true }, void 0, opts.signal);
  }
  async readdir(path16, opts = {}) {
    return (await this.client.call("fs.readdir", { path: path16 }, void 0, opts.signal)).entries;
  }
  async readFile(path16, opts = {}) {
    const max = opts.maxBytes ?? opts.max;
    if (opts.offset === void 0 && opts.length === void 0 && (max === void 0 || max > STREAM_THRESHOLD)) {
      const st = await this.stat(path16, opts);
      if (st && st.size > STREAM_THRESHOLD) {
        if (max !== void 0 && st.size > max)
          throw new EnvError("ETOOBIG", `${path16} is ${st.size} bytes (limit ${max})`);
        const chunks = [];
        for await (const c of await this.openRead(path16, opts)) chunks.push(c);
        return Buffer.concat(chunks);
      }
    }
    const { payload } = await this.client.request(
      "fs.read",
      {
        path: path16,
        ...opts.offset !== void 0 ? { offset: opts.offset } : {},
        ...opts.length !== void 0 ? { length: opts.length } : {},
        ...max !== void 0 ? { max: Math.min(max, MAX_READ) } : {}
      },
      void 0,
      opts.signal
    );
    return payload;
  }
  async writeFile(path16, data, opts = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length > STREAM_THRESHOLD && (opts.mode ?? "overwrite") === "overwrite") {
      const w = await this.openWrite(path16, opts);
      return w.writeAll(buf);
    }
    return this.client.call(
      "fs.write",
      { path: path16, mode: opts.mode ?? "overwrite", atomic: opts.atomic ?? true, mkdirs: opts.mkdirs ?? false },
      buf,
      opts.signal
    );
  }
  async mkdir(path16, opts = {}) {
    await this.client.call("fs.mkdir", { path: path16, recursive: opts.recursive ?? false }, void 0, opts.signal);
  }
  async remove(path16, opts = {}) {
    await this.client.call("fs.remove", { path: path16, recursive: opts.recursive ?? false }, void 0, opts.signal);
  }
  async rename(from, to, opts = {}) {
    await this.client.call("fs.rename", { from, to, overwrite: opts.overwrite ?? false }, void 0, opts.signal);
  }
  async copy(from, to, opts = {}) {
    await this.client.call(
      "fs.copy",
      { from, to, recursive: opts.recursive ?? true, overwrite: opts.overwrite ?? false },
      void 0,
      opts.signal
    );
  }
  async realpath(path16, opts = {}) {
    return (await this.client.call("fs.realpath", { path: path16 }, void 0, opts.signal)).path;
  }
  async openRead(path16, opts = {}) {
    const { ch } = await this.client.call("fs.readStream", { path: path16 }, void 0, opts.signal);
    const channel = this.client.channel(ch);
    const r2 = channel.readable(1);
    opts.signal?.addEventListener("abort", () => channel.close(), { once: true });
    return r2;
  }
  async openWrite(path16, opts = {}) {
    const { ch } = await this.client.call(
      "fs.writeStream",
      { path: path16, atomic: opts.atomic ?? true, mkdirs: opts.mkdirs ?? false },
      void 0,
      opts.signal
    );
    const channel = this.client.channel(ch);
    const done = channel.done.then(({ result, error }) => {
      if (error) throw error;
      return result;
    });
    done.catch(() => {
    });
    return {
      stream: channel.writable(0),
      done,
      async writeAll(buf) {
        await channel.write(buf, 0);
        channel.end(0);
        return done;
      },
      abort() {
        channel.close();
      }
    };
  }
  async glob(pattern, opts = {}) {
    return this.client.call(
      "fs.glob",
      {
        pattern,
        cwd: opts.cwd,
        limit: opts.limit ?? 1e3,
        hidden: opts.hidden ?? false,
        gitignore: opts.gitignore ?? true
      },
      void 0,
      opts.signal
    );
  }
  async grep(pattern, opts = {}) {
    const { signal, ...rest } = opts;
    return this.client.call("fs.grep", { pattern, ...rest }, void 0, signal);
  }
  async spawn(spec, opts = {}) {
    const { ch, pid } = await this.client.call("proc.spawn", spec, void 0, opts.signal);
    const channel = this.client.channel(ch);
    return new ServerProcess(this.client, channel, pid, !!spec.pty);
  }
  /** Forward a local port to host:port as seen from the environment. */
  async forward({
    localHost = "127.0.0.1",
    localPort = 0,
    remoteHost = "127.0.0.1",
    remotePort,
    proto = "tcp"
  }) {
    const open = proto === "udp" ? forwardUdp : forwardTcp;
    const t = await open(this.client, localHost, localPort, remoteHost, remotePort);
    return this.trackTunnel({
      kind: "forward",
      proto,
      localHost,
      localPort: t.port,
      remoteHost,
      remotePort,
      close: t.close
    });
  }
  /** Listen on remoteHost:remotePort in the environment and forward connections to localHost:localPort. */
  async reverse({
    remoteHost = "127.0.0.1",
    remotePort = 0,
    localHost = "127.0.0.1",
    localPort,
    proto = "tcp"
  }) {
    const t = await reverseTunnel(this.client, remoteHost, remotePort, localHost, localPort, proto);
    return this.trackTunnel({
      kind: "reverse",
      proto,
      remoteHost,
      remotePort: t.port,
      localHost,
      localPort,
      close: t.close
    });
  }
  async screenshot(opts = {}) {
    if (!this.caps.has("screenshot")) throw new EnvError("UNSUPPORTED", `${this.name} cannot take screenshots`);
    const { result, payload } = await this.client.request("sys.screenshot", {}, void 0, opts.signal);
    return { png: payload, width: result.width, height: result.height };
  }
  async capture(opts = {}) {
    if (!this.caps.has("screenshot")) throw new EnvError("UNSUPPORTED", `${this.name} cannot take screenshots`);
    const args = this.caps.has("displays") ? {
      ...opts.display !== void 0 ? { display: opts.display } : {},
      ...opts.rect ? { rect: opts.rect } : {},
      ...opts.window !== void 0 ? { window: opts.window } : {},
      ...opts.maxWidth ? { maxWidth: Math.round(opts.maxWidth) } : {},
      ...opts.maxHeight ? { maxHeight: Math.round(opts.maxHeight) } : {},
      ...opts.cursor ? { cursor: true } : {}
    } : {};
    const { result, payload } = await this.client.request("sys.screenshot", args, void 0, opts.signal);
    return {
      png: payload,
      width: result.width,
      height: result.height,
      rect: {
        x: result.x ?? 0,
        y: result.y ?? 0,
        width: result.srcWidth ?? result.width,
        height: result.srcHeight ?? result.height
      },
      cursor: result.cursor
    };
  }
  async displays(opts = {}) {
    if (!this.caps.has("displays")) throw new EnvError("UNSUPPORTED", `${this.name} cannot list displays`);
    return (await this.client.call("sys.displays", {}, void 0, opts.signal)).displays;
  }
  async windows(opts = {}) {
    if (!this.caps.has("windows")) throw new EnvError("UNSUPPORTED", `${this.name} cannot list windows`);
    return (await this.client.call("sys.windows", { all: !!opts.all }, void 0, opts.signal)).windows;
  }
  async windowAction(hwnd, action, rect, opts = {}) {
    if (!this.caps.has("windows")) throw new EnvError("UNSUPPORTED", `${this.name} cannot manage windows`);
    return this.client.call("sys.window", { hwnd, action, ...rect ?? {} }, void 0, opts.signal);
  }
  async input(actions, opts = {}) {
    if (!this.caps.has("input")) throw new EnvError("UNSUPPORTED", `${this.name} does not support input injection`);
    await this.client.call("sys.input", { actions }, void 0, opts.signal);
  }
  async closeTransport() {
    this.client.close();
    await this.onCloseHook?.();
  }
};
function normalizeInfo(info) {
  return {
    os: info.os ?? "unknown",
    family: info.family ?? (info.pathSep === "\\" ? "windows" : "posix"),
    arch: info.arch ?? "",
    hostname: info.hostname ?? "",
    user: info.user ?? "",
    home: info.home ?? "",
    cwd: info.cwd ?? "",
    pathSep: info.pathSep ?? "/",
    shell: info.shell ?? "",
    caps: info.caps ?? [],
    version: info.version ?? ""
  };
}

// packages/plugin/src/env/server/connect.ts
var SERVER_EXE = serverExeName();
function serverBinary(override) {
  return serverBinaryFile(HOST_TARGET, override);
}
async function openLocal({ id, name: name2, cwd, binary, env, signal }) {
  const bin = serverBinary(binary);
  const child = spawn2(bin, ["stdio", ...cwd ? ["--cwd", cwd] : []], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  const stderr = [];
  child.stderr.on("data", (d) => {
    if (stderr.length < 50) stderr.push(d.toString());
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const environment = new ServerEnvironment({
    id,
    name: name2,
    kind: "local",
    transport: childTransport(child),
    onClose: async () => {
      try {
        child.stdin.end();
      } catch {
      }
      const t = setTimeout(() => {
        try {
          child.kill();
        } catch {
        }
      }, 1500);
      await exited;
      clearTimeout(t);
    }
  });
  try {
    await environment.open(signal);
  } catch (error) {
    try {
      child.kill();
    } catch {
    }
    throw new EnvError(
      errorCode(error) ?? "EIO",
      `local environment failed to start: ${errorMessage(error)}${stderr.length ? `
${stderr.join("")}` : ""}`
    );
  }
  return environment;
}
function parseServerUrl(url) {
  const s = url.trim();
  if (/^wss?:\/\//i.test(s)) {
    new URL(s);
    return { kind: "ws", url: s };
  }
  const m = /^(?:tcp:\/\/)?(\[[^\]]+\]|[^:/]+):(\d+)\/?$/i.exec(s);
  if (!m?.[1] || !m[2])
    throw new EnvError("EINVAL", `invalid server address "${url}" (use host:port, tcp://, ws:// or wss://)`);
  return { kind: "tcp", host: m[1].replace(/^\[|\]$/g, ""), port: Number(m[2]) };
}
function dialTcp(host, port, signal, timeoutMs = 15e3) {
  const socket = net2.connect({ host, port });
  socket.setNoDelay(true);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new EnvError("ETIMEDOUT", `connecting to ${host}:${port} timed out`));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new EnvError("CANCELLED", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(socket);
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new EnvError(e.code ?? "EIO", `cannot connect to ${host}:${port}: ${e.message}`));
    });
  });
}
async function dialSecure(target, secret, { signal, timeoutMs = 15e3 } = {}) {
  const raw = target.kind === "ws" ? await wsConnect(target.url, { signal, timeoutMs }) : await dialTcp(target.host, target.port, signal, timeoutMs);
  try {
    return await secureInitiate(raw, { secret, signal });
  } catch (e) {
    raw.destroy?.();
    throw e;
  }
}
async function openServer({
  id,
  name: name2,
  kind = "server",
  url,
  host,
  port,
  token,
  signal,
  timeoutMs = 15e3,
  onClose
}) {
  if (!token) throw new EnvError("EINVAL", "a shared secret (token) is required to connect to dsh-env-server");
  const target = url ? parseServerUrl(url) : { kind: "tcp", host: host ?? "", port: Number(port) };
  const transport = await dialSecure(target, token, { signal, timeoutMs });
  const environment = new ServerEnvironment({ id, name: name2, kind, transport, onClose });
  try {
    await environment.open(signal);
  } catch (error) {
    transport.destroy?.();
    throw error;
  }
  return environment;
}

// packages/plugin/src/env/winuser/accounts.ts
var ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_-]{0,19}$/;
function secretPath(dataDir, name2) {
  return path4.resolve(dataDir, "winusers", `${name2}.secret`);
}
async function runElevated(args, { timeoutMs = 18e4 } = {}) {
  if (process.platform !== "win32")
    throw new EnvError("UNSUPPORTED", "Windows accounts can only be managed on Windows hosts");
  const bin = serverBinary();
  const id = crypto4.randomUUID();
  const out = path4.join(os2.tmpdir(), `dsh-env-elev-${id}.json`);
  const script = path4.join(os2.tmpdir(), `dsh-env-elev-${id}.cmd`);
  const quote = (a) => `"${a.replace(/"/g, '""')}"`;
  fs3.writeFileSync(
    script,
    `@echo off\r
chcp 65001 >nul\r
${quote(bin)} ${args.map(quote).join(" ")} > ${quote(out)} 2>&1\r
`
  );
  let r2;
  try {
    r2 = await runHost(bin, ["elevate", "--", "cmd.exe", "/d", "/c", script], { timeoutMs });
  } finally {
    fs3.rmSync(script, { force: true });
  }
  let text2 = "";
  try {
    text2 = decodeHostText(fs3.readFileSync(out));
  } catch {
  }
  fs3.rmSync(out, { force: true });
  if (!text2.trim()) {
    throw new EnvError(
      "EACCES",
      `administrator approval was cancelled or failed${r2.stderr.trim() ? `: ${r2.stderr.trim()}` : ""}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text2.trim().split(/\r?\n/).pop() ?? "");
  } catch {
    throw new EnvError("EIO", `unexpected output: ${text2.trim()}`);
  }
  if (!parsed.ok) throw new EnvError("EIO", parsed.error ?? "operation failed");
  return parsed;
}
async function runServerElevated(args, opts = {}) {
  return await runElevated(args, opts);
}
async function listWindowsAccounts() {
  if (process.platform !== "win32") return [];
  const r2 = await runHost(serverBinary(), ["winuser", "list"], { timeoutMs: 2e4 });
  try {
    return JSON.parse(decodeHostText(r2.stdout));
  } catch {
    return [];
  }
}
async function createWindowsAccount(name2, { dataDir, grantPaths = [] }) {
  if (!ACCOUNT_RE.test(name2)) {
    throw new EnvError("EINVAL", "account name must be 1-20 letters, digits, _ or -, starting with a letter");
  }
  const secret = secretPath(dataDir, name2);
  fs3.mkdirSync(path4.dirname(secret), { recursive: true });
  await runElevated(["winuser", "create", "--name", name2, "--secret-out", secret]);
  for (const p of grantPaths) await runElevated(["winuser", "grant", "--name", name2, "--path", p]);
  return { name: name2, secret };
}
async function deleteWindowsAccount(name2, { dataDir, purgeProfile = true }) {
  const r2 = await runElevated(["winuser", "delete", "--name", name2, ...purgeProfile ? ["--purge-profile"] : []]);
  fs3.rmSync(secretPath(dataDir, name2), { force: true });
  return typeof r2["warning"] === "string" ? { warning: r2["warning"] } : {};
}

// packages/plugin/src/env/winuser/session-mode.ts
import fs4 from "node:fs";
import path5 from "node:path";
function termwrapDir() {
  return path5.join(PACKAGE_ROOT, "vendor", "termwrap");
}
async function probeSession(signal) {
  if (process.platform !== "win32") {
    throw new EnvError("UNSUPPORTED", "real sessions are only available on Windows hosts");
  }
  const r2 = await runHost(serverBinary(), ["session", "status"], { timeoutMs: 3e4, signal });
  const line = r2.stdout.toString("utf8").split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  if (!line) {
    throw new EnvError("EIO", `session status produced no JSON: ${r2.stderr.trim() || r2.stdout.toString("utf8").trim()}`);
  }
  const parsed = JSON.parse(line);
  if (!parsed.ok) throw new EnvError("EIO", "session status failed");
  return parsed;
}
function termwrapPayload(dir = termwrapDir()) {
  const files = [];
  let version = null;
  let license = false;
  try {
    const marker = path5.join(dir, "VERSION");
    if (fs4.existsSync(marker)) version = fs4.readFileSync(marker, "utf8").trim() || null;
    license = fs4.existsSync(path5.join(dir, "LICENSE"));
    for (const name2 of fs4.readdirSync(dir)) {
      if (name2 === "VERSION" || name2 === "LICENSE" || name2 === "README.md") continue;
      const file = path5.join(dir, name2);
      const stat = fs4.statSync(file);
      if (!stat.isFile()) continue;
      files.push({ name: name2, bytes: stat.size });
    }
  } catch {
  }
  return { dir, version, license, files, present: files.length > 0 };
}

// packages/plugin/src/env/server/reverse.ts
import { EventEmitter as EventEmitter5 } from "node:events";
import http2 from "node:http";
import net3 from "node:net";
import os3 from "node:os";
var REVERSE_DEFAULTS = {
  tcp: { host: "0.0.0.0", port: 7462 },
  ws: { host: "0.0.0.0", port: 7463, path: "/dsh-env" }
};
var PING_MS = 15e3;
var ReverseHub = class extends EventEmitter5 {
  lookup;
  log;
  settings = {};
  tcpServer;
  httpServer;
  status = {
    tcp: { enabled: false, listening: false, host: REVERSE_DEFAULTS.tcp.host, port: REVERSE_DEFAULTS.tcp.port },
    ws: {
      enabled: false,
      listening: false,
      host: REVERSE_DEFAULTS.ws.host,
      port: REVERSE_DEFAULTS.ws.port,
      path: REVERSE_DEFAULTS.ws.path
    },
    publicHost: defaultPublicHost()
  };
  spares = /* @__PURE__ */ new Map();
  active = /* @__PURE__ */ new Map();
  lastPeer = /* @__PURE__ */ new Map();
  waiters = /* @__PURE__ */ new Map();
  sockets = /* @__PURE__ */ new Set();
  disposed = false;
  constructor(lookup, log) {
    super();
    this.lookup = lookup;
    this.log = log;
  }
  /** Apply listener settings, (re)starting listeners whose address changed. */
  async configure(settings) {
    this.settings = settings;
    this.status.publicHost = settings.publicHost?.trim() || defaultPublicHost();
    const tcp = { ...REVERSE_DEFAULTS.tcp, ...settings.tcp };
    const ws = { ...REVERSE_DEFAULTS.ws, ...settings.ws };
    const tcpChanged = !!tcp.enabled !== this.status.tcp.enabled || tcp.host !== this.status.tcp.host || tcp.port !== this.status.tcp.port;
    const wsChanged = !!ws.enabled !== this.status.ws.enabled || ws.host !== this.status.ws.host || ws.port !== this.status.ws.port || ws.path !== this.status.ws.path;
    if (tcpChanged) {
      await closeServer(this.tcpServer);
      this.tcpServer = void 0;
      this.status.tcp = { enabled: !!tcp.enabled, listening: false, host: tcp.host, port: tcp.port };
      if (tcp.enabled && !this.disposed) {
        const server = net3.createServer((socket) => this.onSocket(socket, socket));
        this.tcpServer = server;
        await this.listen(server, this.status.tcp);
      }
    }
    if (wsChanged) {
      await closeServer(this.httpServer);
      this.httpServer = void 0;
      const path16 = ws.path.startsWith("/") ? ws.path : `/${ws.path}`;
      this.status.ws = { enabled: !!ws.enabled, listening: false, host: ws.host, port: ws.port, path: path16 };
      if (ws.enabled && !this.disposed) {
        const server = http2.createServer((_req, res) => {
          res.writeHead(426, { "content-type": "text/plain" }).end("dsh-env reverse endpoint: WebSocket only\n");
        });
        server.on("upgrade", (req, socket, head) => {
          const reqPath = (req.url ?? "").split("?")[0];
          if (reqPath !== path16) {
            socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
            return;
          }
          const t = wsAccept(req, socket, head);
          if (t) this.onSocket(t, socket);
        });
        this.httpServer = server;
        await this.listen(server, this.status.ws);
      }
    }
    this.emit("change");
    return this.describe();
  }
  listen(server, status) {
    return new Promise((resolve) => {
      const onError = (e) => {
        status.listening = false;
        status.error = errorMessage(e);
        this.log?.(`reverse listener ${status.host}:${status.port}: ${status.error}`);
        resolve();
      };
      server.once("error", onError);
      server.listen(status.port, status.host, () => {
        server.off("error", onError);
        server.on("error", (e) => this.log?.(`reverse listener: ${errorMessage(e)}`));
        status.listening = true;
        status.error = void 0;
        status.port = server.address().port;
        resolve();
      });
    });
  }
  describe() {
    return { tcp: { ...this.status.tcp }, ws: { ...this.status.ws }, publicHost: this.status.publicHost };
  }
  get currentSettings() {
    return this.settings;
  }
  /** Connection state of one reverse environment. */
  state(id) {
    const last = this.lastPeer.get(id);
    return {
      idle: this.spares.get(id)?.length ?? 0,
      active: this.active.get(id)?.size ?? 0,
      peer: last?.peer,
      since: last?.since
    };
  }
  connected(id) {
    const s = this.state(id);
    return s.idle > 0 || s.active > 0;
  }
  onSocket(raw, socket) {
    if (this.disposed) {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 3e4);
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    const peer = `${socket.remoteAddress ?? "?"}:${String(socket.remotePort ?? "")}`;
    secureRespond(raw, (id) => this.lookup(id)).then(
      ({ transport, id }) => this.addSpare(id, transport, peer),
      (e) => {
        this.log?.(`reverse connection from ${peer} rejected: ${errorMessage(e)}`);
        socket.destroy();
      }
    );
  }
  addSpare(id, inner, peer) {
    let target;
    let closed = false;
    const outer = new CallbackTransport({
      write: (d) => inner.write(d),
      end: () => inner.end?.(),
      destroy: () => inner.destroy?.()
    });
    let n = 0;
    const spare = {
      transport: outer,
      peer,
      since: Date.now(),
      ping: setInterval(() => inner.write(encodeFrame({ t: "ping", n: ++n })), PING_MS),
      handOver: (t) => {
        clearInterval(spare.ping);
        target = t;
      },
      dispose: () => {
        clearInterval(spare.ping);
        inner.destroy?.();
      }
    };
    spare.ping.unref();
    inner.on("data", (d) => {
      if (target) target.push(d);
    });
    const onClose = () => {
      if (closed) return;
      closed = true;
      clearInterval(spare.ping);
      this.removeSpare(id, spare);
      if (target) target.emit("close");
      this.emit("change");
    };
    inner.on("close", onClose);
    inner.on("error", (e) => {
      if (target) target.emit("error", e);
      onClose();
    });
    this.lastPeer.set(id, { peer, since: Date.now() });
    const waiter = this.waiters.get(id)?.shift();
    if (waiter) {
      waiter.resolve(this.activate(id, spare));
    } else {
      const list = this.spares.get(id) ?? [];
      list.push(spare);
      this.spares.set(id, list);
      while (list.length > 4) list.shift()?.dispose();
    }
    this.emit("change");
  }
  removeSpare(id, spare) {
    const list = this.spares.get(id);
    if (!list) return;
    const i = list.indexOf(spare);
    if (i >= 0) list.splice(i, 1);
  }
  activate(id, spare) {
    this.removeSpare(id, spare);
    const t = new CallbackTransport({
      write: (d) => spare.transport.write(d),
      end: () => spare.transport.end(),
      destroy: () => spare.transport.destroy()
    });
    spare.handOver(t);
    const set = this.active.get(id) ?? /* @__PURE__ */ new Set();
    this.active.set(id, set);
    set.add(t);
    t.on("close", () => {
      set.delete(t);
      this.emit("change");
    });
    return t;
  }
  /**
   * Take a connection for environment `id`, waiting up to `timeoutMs` for the server to dial
   * in (it reconnects with backoff, and dials a new spare right after one is taken).
   */
  take(id, { signal, timeoutMs = 1e4 } = {}) {
    const spare = this.spares.get(id)?.shift();
    if (spare) {
      const t = this.activate(id, spare);
      this.emit("change");
      return Promise.resolve(t);
    }
    if (!this.status.tcp.listening && !this.status.ws.listening) {
      return Promise.reject(
        new EnvError("ENOENT", "reverse connections are disabled: enable a TCP or WebSocket listener first")
      );
    }
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(id) ?? [];
      this.waiters.set(id, list);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = list.indexOf(waiter);
        if (i >= 0) list.splice(i, 1);
      };
      const waiter = {
        resolve: (t) => {
          cleanup();
          resolve(t);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        }
      };
      const onAbort = () => waiter.reject(new EnvError("CANCELLED", "aborted"));
      const timer = setTimeout(
        () => waiter.reject(
          new EnvError("ETIMEDOUT", `environment ${id} is not connected (run dsh-env-server connect on it)`)
        ),
        timeoutMs
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      list.push(waiter);
    });
  }
  /** Drop every connection of `id` (secret rotated or environment deleted). */
  disconnect(id) {
    for (const s of this.spares.get(id) ?? []) s.dispose();
    this.spares.delete(id);
    for (const t of this.active.get(id) ?? []) t.destroy?.();
    this.emit("change");
  }
  async dispose() {
    this.disposed = true;
    for (const list of this.waiters.values())
      for (const w of [...list]) w.reject(new EnvError("CLOSED", "plugin is shutting down"));
    for (const id of [...this.spares.keys(), ...this.active.keys()]) this.disconnect(id);
    for (const s of this.sockets) s.destroy();
    await Promise.all([closeServer(this.tcpServer), closeServer(this.httpServer)]);
    this.tcpServer = void 0;
    this.httpServer = void 0;
  }
};
function sanitizeReverseSettings(input) {
  const o = (v) => v && typeof v === "object" ? v : {};
  const port = (v, fallback) => {
    const n = Number(v);
    if (v === void 0 || v === "" || v === null) return fallback;
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new EnvError("EINVAL", `invalid port ${JSON.stringify(v)}`);
    return n;
  };
  const host = (v, fallback) => typeof v === "string" && v.trim() ? v.trim() : fallback;
  const root = o(input);
  const tcp = o(root["tcp"]);
  const ws = o(root["ws"]);
  const path16 = host(ws["path"], REVERSE_DEFAULTS.ws.path);
  const out = {
    tcp: {
      enabled: tcp["enabled"] === true,
      host: host(tcp["host"], REVERSE_DEFAULTS.tcp.host),
      port: port(tcp["port"], REVERSE_DEFAULTS.tcp.port)
    },
    ws: {
      enabled: ws["enabled"] === true,
      host: host(ws["host"], REVERSE_DEFAULTS.ws.host),
      port: port(ws["port"], REVERSE_DEFAULTS.ws.port),
      path: path16.startsWith("/") ? path16 : `/${path16}`
    }
  };
  const pub = root["publicHost"];
  if (typeof pub === "string" && pub.trim()) out.publicHost = pub.trim();
  return out;
}
function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
function defaultPublicHost() {
  for (const list of Object.values(os3.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return os3.hostname();
}
function reverseCommands({ id, secret, status, cwd }) {
  const host = status.publicHost.includes(":") ? `[${status.publicHost}]` : status.publicHost;
  const urls = [];
  if (status.ws.enabled) urls.push(`ws://${host}:${status.ws.port}${status.ws.path ?? "/"}`);
  if (status.tcp.enabled) urls.push(`tcp://${host}:${status.tcp.port}`);
  const url = urls[0];
  if (!url) return { urls, posix: void 0, windows: void 0 };
  const file = `.dsh-env-${id}.token`;
  const posixCwd = cwd ? ` --cwd '${cwd.replace(/'/g, `'\\''`)}'` : "";
  const winCwd = cwd ? ` --cwd '${cwd.replace(/'/g, "''")}'` : "";
  return {
    urls,
    posix: `(umask 077 && printf '%s\\n' '${secret}' > ~/${file}) && dsh-env-server connect ${url} --id ${id} --token-file ~/${file}${posixCwd}`,
    windows: `Set-Content -Path "$HOME\\${file}" -Value '${secret}'; dsh-env-server.exe connect ${url} --id ${id} --token-file "$HOME\\${file}"${winCwd}`
  };
}

// packages/plugin/src/host-api.ts
function agentOf(exec2) {
  return exec2.agent;
}
function sessionIdOf(agent) {
  return agent.session.header.id ?? agent.session.id;
}
function parentSessionOf(agent) {
  const h = agent.session.header;
  return h.origin === "subagent" && h.parentSession ? h.parentSession : void 0;
}
function sessionStarted(agent) {
  try {
    return agent.session.requestHeader?.() !== void 0;
  } catch {
    return false;
  }
}
function promptSectionOrder(ctx) {
  try {
    return ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX");
  } catch {
    return 900;
  }
}
function asCordisContext(ctx) {
  return ctx;
}
function asPluginContext(ctx) {
  return ctx;
}

// packages/plugin/src/manager/availability.ts
import net4 from "node:net";

// packages/plugin/src/env/adb/devices.ts
function adbCommand(adb) {
  const [exe = "adb", ...prefix] = typeof adb === "string" ? [adb] : adb;
  return { exe, prefix };
}
async function listAdbDevices(adb = "adb") {
  const { exe, prefix } = adbCommand(adb);
  const { stdout } = await runHost(exe, [...prefix, "devices", "-l"], { timeoutMs: 15e3 });
  const devices = [];
  for (const line of stdout.toString().split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(\S+)(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, serial = "", state = "", rest = ""] = m;
    const props = Object.fromEntries([...rest.matchAll(/(\w+):(\S+)/g)].map((x) => [x[1], x[2]]));
    devices.push({
      serial,
      state,
      model: props["model"],
      product: props["product"],
      device: props["device"],
      transportId: props["transport_id"],
      emulator: serial.startsWith("emulator-")
    });
  }
  return devices;
}

// packages/plugin/src/manager/availability.ts
var tcpProbe = (host, port, timeoutMs) => new Promise((resolve, reject) => {
  const socket = net4.connect({ host, port });
  const done = (error) => {
    clearTimeout(timer);
    socket.destroy();
    if (error) reject(error);
    else resolve();
  };
  const timer = setTimeout(() => done(new Error(`timed out connecting to ${host}:${port}`)), timeoutMs);
  socket.once("connect", () => done());
  socket.once("error", (e) => done(e));
});
var AvailabilityChecker = class {
  manager;
  ttlMs;
  probeTimeoutMs;
  tcp;
  listAdb;
  platform;
  now;
  cache = /* @__PURE__ */ new Map();
  adbCache = /* @__PURE__ */ new Map();
  constructor(manager, options = {}) {
    this.manager = manager;
    this.ttlMs = options.ttlMs ?? 15e3;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 3e3;
    this.tcp = options.tcpProbe ?? tcpProbe;
    this.listAdb = options.listAdb ?? ((adb) => listAdbDevices(adb));
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
  }
  /** Forget cached results (all, or of one environment after it was edited). */
  invalidate(envId) {
    if (envId === void 0) this.cache.clear();
    else this.cache.delete(envId);
  }
  /**
   * Availability of several environments. Checks that do not finish within `waitMs` report their
   * previous result (or `unknown`) and keep running, so the next call picks them up.
   */
  async check(envIds, { waitMs = 2e3 } = {}) {
    const ids = [...new Set(envIds)];
    const out = {};
    await Promise.all(
      ids.map(async (id) => {
        out[id] = await this.one(id, waitMs);
      })
    );
    return out;
  }
  async one(envId, waitMs) {
    const def = this.manager.get(envId);
    if (!def) return { state: "error", reason: `unknown environment "${envId}"`, checkedAt: this.now() };
    const live = this.manager.leasesOf(def.id).filter((l) => !l.released && !l.env.closed);
    if (live.length > 0) {
      const busy = this.manager.status(def).busy;
      return { state: busy ? "busy" : "available", reason: busy ? "in use" : "connected", checkedAt: this.now() };
    }
    const entry = this.cache.get(envId) ?? {};
    this.cache.set(envId, entry);
    if (entry.value && this.now() - entry.value.checkedAt < this.ttlMs) return entry.value;
    if (!entry.pending) {
      const pending2 = this.probe(def).then(
        (value2) => value2,
        (e) => ({ state: "error", reason: errorMessage(e), checkedAt: this.now() })
      );
      entry.pending = pending2;
      void pending2.then((value2) => {
        entry.value = value2;
        if (entry.pending === pending2) delete entry.pending;
      });
    }
    const pending = entry.pending;
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(void 0), waitMs);
      timer.unref?.();
    });
    const value = await Promise.race([pending, late]);
    clearTimeout(timer);
    return value ?? entry.value ?? { state: "unknown", reason: "checking", checkedAt: this.now() };
  }
  async probe(def) {
    const c = def.config;
    const at = () => this.now();
    switch (def.kind) {
      case "local":
        return { state: "available", checkedAt: at() };
      case "server":
      case "ssh": {
        const host = c.host ?? "";
        const port = Number(c.port ?? (def.kind === "ssh" ? 22 : NaN));
        if (!host || !Number.isFinite(port)) return { state: "error", reason: "host or port missing", checkedAt: at() };
        try {
          await this.tcp(host, port, this.probeTimeoutMs);
          return { state: "available", checkedAt: at() };
        } catch (e) {
          return { state: "offline", reason: `${host}:${port} unreachable (${errorMessage(e)})`, checkedAt: at() };
        }
      }
      case "adb": {
        let devices;
        try {
          devices = await this.adbDevices(c.adb || this.manager.adb);
        } catch (e) {
          return { state: "error", reason: `adb: ${errorMessage(e)}`, checkedAt: at() };
        }
        const device = devices.find((d) => d.serial === c.serial);
        if (!device) return { state: "offline", reason: `device ${c.serial ?? "?"} not connected`, checkedAt: at() };
        if (device.state !== "device") {
          return { state: "offline", reason: `device ${device.serial} is ${device.state}`, checkedAt: at() };
        }
        return { state: "available", checkedAt: at() };
      }
      case "winuser":
        return this.platform === "win32" ? { state: "available", checkedAt: at() } : { state: "error", reason: "Windows accounts need a Windows host", checkedAt: at() };
      default:
        return { state: "unknown", checkedAt: at() };
    }
  }
  adbDevices(adb) {
    const d = this.manager.discovered;
    if (adb === this.manager.adb && this.manager.autoDiscoverAdb && this.now() - d.at < 5e3 && !d.adbError) {
      return Promise.resolve(d.adb);
    }
    const hit = this.adbCache.get(adb);
    if (hit && this.now() - hit.at < 5e3) return hit.devices;
    const devices = this.listAdb(adb);
    this.adbCache.set(adb, { at: this.now(), devices });
    devices.catch(() => this.adbCache.delete(adb));
    return devices;
  }
};

// packages/plugin/src/api/actions.ts
function describeInfo(info) {
  if (!info) return void 0;
  return {
    os: info.os,
    family: info.family,
    arch: info.arch,
    hostname: info.hostname,
    user: info.user,
    home: info.home,
    cwd: info.cwd,
    shell: info.shell,
    caps: info.caps,
    version: info.version,
    pathSep: info.pathSep
  };
}
var str = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : void 0;
var text = (v) => str(v) ?? "";
function createActions(ctx, manager, { mounting, borrowing, mountsDir, availability = new AvailabilityChecker(manager) }) {
  const infoCache = /* @__PURE__ */ new Map();
  const workspacePathOf = (workspacePath, workspaceId) => {
    let p = str(workspacePath);
    if (!p && workspaceId) {
      const id = text(workspaceId);
      p = ctx.get("workspaceRegistry")?.get(id)?.path ?? manager.state.remoteWorkspaces.find((w) => w.workspaceId === id)?.hostPath;
    }
    if (!p) throw new EnvError("EINVAL", "workspace not found");
    return p;
  };
  const agentFor = (sessionId) => {
    try {
      return ctx.get("agents")?.get(sessionId);
    } catch {
      return void 0;
    }
  };
  const sessionState = (sessionId) => {
    if (!sessionId) return void 0;
    const agent = agentFor(sessionId);
    const settings = manager.sessionSettings(sessionId);
    const cwd = agent?.session.header.cwd ?? settings.cwd;
    const record = agent ? mounting.mountOf(agent) : void 0;
    const borrowable = manager.borrowableFor(sessionId, cwd);
    const held = agent ? borrowing.heldOf(agent).map((e) => ({
      ...e.lease.describe(),
      alias: e.alias,
      name: e.lease.def.name,
      tools: e.tools.length,
      gui: e.gui,
      attached: e.attached
    })) : [];
    const started = !!agent && sessionStarted(agent);
    const mount = agent ? mounting.wantedOf(agent) : manager.mountFor(sessionId, cwd);
    return {
      sessionId,
      live: !!agent,
      cwd,
      mount: mount ? { envId: mount.envId, remoteRoot: mount.remoteRoot, source: mount.source, inherited: !!mount.parent } : void 0,
      mountExplicitlyOff: settings.mount === false,
      mountActive: record ? {
        envId: record.envId,
        remoteRoot: record.map.remoteRoot,
        since: record.startedAt,
        /** Mode of the mount's lease; `gui` says whether this session holds that GUI. */
        mode: record.lease.mode,
        gui: agent ? record.lease.guiUsers.has(sessionIdOf(agent)) : false,
        shared: !!record.parent
      } : void 0,
      mountError: settings.mountError,
      /** Set while the session cannot run because its mount is missing (the turn error it gets). */
      mountBlocked: agent ? mounting.blockReason(agent) : void 0,
      borrowableSource: borrowable.source,
      borrowable: borrowable.defs.map((d) => d.id),
      borrowableExplicit: Array.isArray(settings.borrowable) ? settings.borrowable : void 0,
      held,
      started
    };
  };
  const state = async ({ sessionId, discover }) => {
    await manager.refreshDiscovery(!!discover);
    const defs = manager.definitions().map((d) => ({
      ...manager.publicDef(d),
      status: manager.status(d),
      info: describeInfo(infoCache.get(d.id)?.info),
      lastError: infoCache.get(d.id)?.error,
      ...d.kind === "reverse" ? { connection: manager.reverse.state(d.id) } : {}
    }));
    return {
      platform: process.platform,
      defaults: { mountMode: manager.defaultMountMode },
      environments: defs,
      discovered: { adb: manager.discovered.adb, adbError: manager.discovered.adbError },
      remoteWorkspaces: manager.state.remoteWorkspaces,
      workspaces: manager.state.workspaces,
      leases: [...manager.leases.values()].map((l) => ({ ...l.describe(), name: l.def.name })),
      session: sessionState(str(sessionId)),
      reverse: { ...manager.reverse.describe(), settings: manager.reverseSettings() }
    };
  };
  const reveal = (def, secret) => ({
    secret,
    ...reverseCommands({ id: def.id, secret, status: manager.reverse.describe(), cwd: def.config.cwd })
  });
  return {
    state,
    async save({ environment }) {
      const input = environment;
      const previous = input.id ? manager.get(String(input.id))?.config.token : void 0;
      const def = manager.upsert(input);
      infoCache.delete(def.id);
      availability.invalidate(def.id);
      const fresh = def.kind === "reverse" && def.config.token && def.config.token !== previous;
      return { environment: manager.publicDef(def), ...fresh ? { reverse: reveal(def, def.config.token ?? "") } : {} };
    },
    async "reverse.rotate"({ id }) {
      const def = manager.require(text(id));
      const secret = manager.rotateReverseSecret(def.id);
      return { reverse: reveal(def, secret) };
    },
    async "reverse.settings"({ settings }) {
      if (settings !== void 0) await manager.setReverseSettings(sanitizeReverseSettings(settings));
      return { status: manager.reverse.describe(), settings: manager.reverseSettings() };
    },
    async delete({ id }) {
      const envId = text(id);
      for (const l of manager.leasesOf(envId)) await l.release("environment deleted");
      manager.remove(envId);
      availability.invalidate(envId);
      return {};
    },
    async test({ id }) {
      const envId = text(id);
      const def = manager.require(envId);
      const started = Date.now();
      availability.invalidate(envId);
      try {
        const env = await manager.open(def);
        const info = env.info;
        await env.close();
        infoCache.set(envId, { info, at: Date.now() });
        return { ok: true, info: describeInfo(info), ms: Date.now() - started };
      } catch (e) {
        infoCache.set(envId, { error: errorMessage(e), at: Date.now() });
        return { ok: false, error: errorMessage(e), code: errorCode(e) };
      }
    },
    /**
     * One live frame of an environment's desktop for the Environments page viewer.
     *
     * A connection a live lease already holds is preferred: that is the desktop the agent is
     * actually working on. For a `session`-mode account opening a second connection would start a
     * *second* session, so the viewer asks for a running session instead of inventing one. Every
     * other environment falls back to the same short-lived browse connection the file browser
     * uses (a private desktop is created on demand and closed again once the viewer stops asking).
     */
    async "desktop.frame"({ envId, maxWidth, cursor }) {
      const id = text(envId);
      if (!id) throw new EnvError("EINVAL", "envId is required");
      const width = Math.min(Math.max(Math.round(Number(maxWidth) || 960), 120), 2560);
      const frame = async (env) => {
        if (!env.hasCap("screenshot")) {
          throw new EnvError("UNSUPPORTED", `${env.name} cannot show a desktop`);
        }
        const shot = await env.capture({ maxWidth: width, cursor: cursor !== false });
        if (!shot.png) throw new EnvError("EIO", `${env.name} returned no image`);
        const desktopName = env.desktopName;
        return {
          mime: "image/png",
          data: shot.png.toString("base64"),
          width: shot.width,
          height: shot.height,
          desktop: desktopName ?? null,
          cursor: shot.cursor ?? null,
          at: Date.now()
        };
      };
      const leased = manager.leasesOf(id)[0]?.env;
      if (leased && !leased.closed) return await frame(leased);
      const def = manager.require(id);
      if (def.kind === "winuser" && def.config.desktop === "session") {
        throw new EnvError(
          "EBUSY",
          "this account has no session running right now; start one from a session before watching its desktop"
        );
      }
      return await manager.browse(id, frame);
    },
    async "fs.list"({ envId, path: p }) {
      const id = text(envId);
      return manager.browse(id, async (env) => {
        const info = env.info;
        const target = p ? env.resolvePath(text(p), info?.cwd) : info?.cwd || info?.home || "";
        const entries = (await env.readdir(target)).map((e) => ({
          name: e.name,
          type: e.type,
          size: e.size,
          mtimeMs: e.mtimeMs
        }));
        const parent = env.path.dirname(target);
        infoCache.set(id, { info, at: Date.now() });
        return {
          path: target,
          parent: parent === target ? void 0 : parent,
          entries,
          sep: info?.pathSep,
          home: info?.home,
          cwd: info?.cwd,
          info: describeInfo(info)
        };
      });
    },
    async "fs.mkdir"({ envId, path: p }) {
      return manager.browse(text(envId), async (env) => {
        await env.mkdir(text(p), { recursive: true });
        return {};
      });
    },
    async "remoteWorkspace.create"({ envId, root, title }) {
      if (!root) throw new EnvError("EINVAL", "root is required");
      const ws = manager.addRemoteWorkspace({ envId: text(envId), root: text(root), title: str(title), mountsDir });
      const registry = ctx.get("workspaceRegistry");
      let workspaceId;
      if (registry) {
        const created = await registry.create(ws.hostPath, ws.title);
        workspaceId = created.id;
        ws.workspaceId = workspaceId;
        manager.save();
      }
      return { workspace: ws, workspaceId };
    },
    async "remoteWorkspace.delete"({ id }) {
      const ws = manager.removeRemoteWorkspace(text(id));
      const registry = ctx.get("workspaceRegistry");
      if (ws?.workspaceId && registry) {
        try {
          await registry.delete(ws.workspaceId);
        } catch {
        }
      }
      return {};
    },
    async "session.set"({ sessionId, mount, borrowable, cwd }) {
      const sid = str(sessionId);
      if (!sid) throw new EnvError("EINVAL", "sessionId is required");
      if (mount !== void 0 && sessionState(sid)?.started) {
        throw new EnvError("EINVAL", "the session has already started; its mount can no longer change");
      }
      const patch = {};
      if (mount !== void 0) {
        const m = mount;
        patch.mount = m === null ? void 0 : m === false ? false : { envId: m.envId, remoteRoot: m.remoteRoot };
        patch.mountError = void 0;
      }
      if (borrowable !== void 0)
        patch.borrowable = borrowable === null ? void 0 : borrowable.map(String);
      if (cwd) patch.cwd = text(cwd);
      manager.setSessionSettings(sid, patch);
      const agent = agentFor(sid);
      if (agent && mount !== void 0) await mounting.ensure(agent);
      return { session: sessionState(sid) };
    },
    /** Re-attempt the mount of a live session (after it failed or was lost). */
    async "session.remount"({ sessionId }) {
      const sid = str(sessionId);
      if (!sid) throw new EnvError("EINVAL", "sessionId is required");
      const agent = agentFor(sid);
      if (!agent) throw new EnvError("EINVAL", "the session is not running");
      await mounting.ensure(agent);
      return { session: sessionState(sid) };
    },
    /** Change a workspace's default borrowable list: `borrowable` (string[], or null = every environment). */
    async "workspace.set"({ workspacePath, workspaceId, borrowable }) {
      const p = workspacePathOf(workspacePath, workspaceId);
      let settings = manager.workspaceSettings(p);
      if (borrowable !== void 0) {
        settings = manager.setWorkspaceSettings(p, {
          borrowable: Array.isArray(borrowable) ? borrowable.map(String) : null
        });
      }
      return { settings, binding: manager.workspaceBinding(p, str(workspaceId)) };
    },
    /**
     * Bindings of the workspaces the GUI lists, with the availability of every bound environment.
     * Body: `{ workspaces: [{ workspaceId, path }] }`.
     */
    async "workspace.bindings"({ workspaces }) {
      const items = Array.isArray(workspaces) ? workspaces : [];
      const bindings = items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item;
        const workspaceId = str(record["workspaceId"]);
        let p = str(record["path"]);
        if (!p && workspaceId) {
          try {
            p = workspacePathOf(void 0, workspaceId);
          } catch {
          }
        }
        if (!p) return [];
        return [{ workspaceId, path: p, ...manager.workspaceBinding(p, workspaceId) }];
      });
      await manager.refreshDiscovery(false);
      const envIds = [...new Set(bindings.flatMap((b) => b.envId ? [b.envId] : []))];
      const availabilityById = await availability.check(envIds);
      const environments = envIds.flatMap((id) => {
        const def = manager.get(id);
        return def ? [{ id: def.id, name: def.name, kind: def.kind }] : [];
      });
      return { bindings, availability: availabilityById, environments };
    },
    async "lease.release"({ leaseId }) {
      return { released: await borrowing.releaseLease(text(leaseId)) };
    },
    /**
     * Install the TermWrap payload (elevated) so this machine can host one session per isolated
     * account. The server cycles `TermService`/`UmRdpService` afterwards because the SCM re-reads
     * the service DLL on every start, so the patch is live without a reboot; the returned
     * `rebootRequired` is set only when that restart did not take. The payload travels inside our
     * own release package (MIT, plain files), so the install needs no network access.
     */
    async "session.install"() {
      if (process.platform !== "win32") {
        throw new EnvError("UNSUPPORTED", "TermWrap can only be installed on a Windows host");
      }
      const payload = termwrapPayload();
      if (!payload.present) {
        throw new EnvError(
          "ENOENT",
          "this build was packaged without the TermWrap payload; install TermWrap manually (see docs/session-mode.md)"
        );
      }
      const result = await runServerElevated(["session", "install", "--payload", payload.dir]);
      return { ...result, payloadVersion: payload.version };
    },
    /**
     * Switch the Remote Desktop host on without installing anything. That is the whole job on a
     * Server SKU, which hosts several sessions natively; on a client SKU it is not enough (one
     * session at a time), which is why the UI offers the TermWrap install there instead.
     */
    async "session.enable"() {
      if (process.platform !== "win32") {
        throw new EnvError("UNSUPPORTED", "Remote Desktop hosting is only available on Windows");
      }
      return await runServerElevated(["session", "enable"]);
    },
    /**
     * Let an account log on through Remote Desktop (elevated), which is what the session logon
     * needs. Idempotent: an account that is already a member is fine.
     */
    async "session.allow"({ account }) {
      if (process.platform !== "win32") {
        throw new EnvError("UNSUPPORTED", "Remote Desktop logon is only available on Windows");
      }
      const name2 = str(account) ?? "";
      if (!ACCOUNT_RE.test(name2)) throw new EnvError("EINVAL", "a valid account name is required");
      return await runServerElevated(["session", "allow", "--account", name2]);
    },
    async "winuser.list"() {
      return { accounts: await listWindowsAccounts(), supported: process.platform === "win32" };
    },
    /**
     * Whether this machine can host a separate session per isolated account, and whether the
     * TermWrap payload needed for it shipped with this build.
     */
    async "session.status"() {
      const payload = termwrapPayload();
      const termwrap = {
        present: payload.present,
        version: payload.version,
        license: payload.license,
        files: payload.files
      };
      if (process.platform !== "win32") {
        return {
          ok: true,
          ready: false,
          missing: ["not-windows"],
          reasons: ["real sessions are only available on Windows hosts"],
          termwrap
        };
      }
      const probe = await probeSession();
      return { ...probe, termwrap };
    },
    async "winuser.create"({ name: name2, environmentName, grantPaths, desktop }) {
      const account = str(name2) ?? "";
      if (!ACCOUNT_RE.test(account)) {
        throw new EnvError("EINVAL", "account name must be 1-20 letters, digits, _ or -, starting with a letter");
      }
      await createWindowsAccount(account, {
        dataDir: manager.dataDir,
        grantPaths: Array.isArray(grantPaths) ? grantPaths.map(String) : []
      });
      const mode = str(desktop);
      const def = manager.upsert({
        id: `win_${account.toLowerCase()}`,
        name: str(environmentName) || `Windows \xB7 ${account}`,
        kind: "winuser",
        // The desktop choice made while creating the account must survive into the definition,
        // otherwise a fresh account would silently fall back to the human's desktop.
        config: { account, desktop: mode === "private" || mode === "session" ? mode : "shared" },
        description: `Local account ${account}`
      });
      return { environment: manager.publicDef(def) };
    },
    async "winuser.delete"({ name: name2 }) {
      const account = text(name2);
      for (const d of manager.state.environments.filter((e) => e.kind === "winuser" && e.config.account === account)) {
        for (const l of manager.leasesOf(d.id)) await l.release("account deleted");
        manager.remove(d.id);
      }
      return await deleteWindowsAccount(account, { dataDir: manager.dataDir });
    },
    async defaults() {
      return { home: os4.homedir(), mountsDir, sep: path6.sep };
    }
  };
}

// packages/plugin/src/api/index.ts
var ROUTE = "/api/environments";
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function installApi(ctx, manager, deps) {
  const actions = createActions(ctx, manager, deps);
  const handle = async (request) => {
    let body;
    try {
      body = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams) : JSON.parse(await request.text() || "{}");
    } catch {
      return json({ ok: false, error: "invalid JSON body" }, 400);
    }
    const name2 = String(body["action"]);
    const action = Object.hasOwn(actions, name2) ? actions[name2] : void 0;
    if (!action) return json({ ok: false, error: `unknown action ${name2}` }, 400);
    try {
      return json({ ok: true, value: await action(body) });
    } catch (e) {
      return json({ ok: false, error: errorMessage(e), code: errorCode(e) });
    }
  };
  ctx.inject(["connection"], (scope) => {
    scope.connection.fetch.register({
      path: ROUTE,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: (request) => handle(request)
    });
  });
  return { actions };
}

// packages/plugin/src/env/host-env.ts
import fs5 from "node:fs";
import fsp from "node:fs/promises";
import path7 from "node:path";
function wrap(e, p) {
  return new EnvError(errorCode(e) ?? "EIO", `${p}: ${errorMessage(e)}`);
}
function statOf(st) {
  return {
    type: st.isDirectory() ? "dir" : st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other",
    size: st.size,
    mtimeMs: st.mtimeMs,
    mode: st.mode & 4095
  };
}
var HostEnvironment = class extends Environment {
  constructor(cwd) {
    super({ id: "host", name: "workspace", kind: "host" });
    const windows = process.platform === "win32";
    this.info = {
      os: windows ? "windows" : process.platform === "darwin" ? "macos" : process.platform,
      family: windows ? "windows" : "posix",
      arch: "",
      hostname: "",
      user: "",
      cwd,
      home: "",
      pathSep: path7.sep,
      shell: "",
      caps: ["fs"],
      version: ""
    };
  }
  async stat(p, opts = {}) {
    try {
      return statOf(opts.follow === false ? await fsp.lstat(p) : await fsp.stat(p));
    } catch (e) {
      const code = errorCode(e);
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw wrap(e, p);
    }
  }
  async readdir(p) {
    try {
      const entries = await fsp.readdir(p, { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        let st;
        try {
          st = await fsp.stat(path7.join(p, e.name));
        } catch {
        }
        out.push({ name: e.name, type: st ? statOf(st).type : "other", size: st?.size, mtimeMs: st?.mtimeMs });
      }
      return out.sort((a, b) => a.name < b.name ? -1 : 1);
    } catch (e) {
      throw wrap(e, p);
    }
  }
  async readFile(p, opts = {}) {
    try {
      if (opts.offset !== void 0 || opts.length !== void 0) {
        const fh = await fsp.open(p, "r");
        try {
          const st2 = await fh.stat();
          const len = Math.max(0, Math.min(opts.length ?? st2.size, st2.size - (opts.offset ?? 0)));
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, opts.offset ?? 0);
          return buf;
        } finally {
          await fh.close();
        }
      }
      const st = await fsp.stat(p);
      const max = opts.maxBytes ?? opts.max;
      if (max !== void 0 && st.size > max) throw new EnvError("ETOOBIG", `${p} is ${st.size} bytes (limit ${max})`);
      return await fsp.readFile(p);
    } catch (e) {
      if (e instanceof EnvError) throw e;
      throw wrap(e, p);
    }
  }
  async writeFile(p, data, opts = {}) {
    try {
      if (opts.mkdirs) await fsp.mkdir(path7.dirname(p), { recursive: true });
      if (opts.mode === "create" && fs5.existsSync(p)) throw new EnvError("EEXIST", `already exists: ${p}`);
      if (opts.mode === "append") await fsp.appendFile(p, data);
      else {
        const tmp = path7.join(path7.dirname(p), `.${path7.basename(p)}.dsh-tmp-${Date.now()}`);
        await fsp.writeFile(tmp, data);
        await fsp.rename(tmp, p);
      }
      return statOf(await fsp.stat(p));
    } catch (e) {
      if (e instanceof EnvError) throw e;
      throw wrap(e, p);
    }
  }
  async mkdir(p, opts = {}) {
    try {
      await fsp.mkdir(p, { recursive: !!opts.recursive });
    } catch (e) {
      throw wrap(e, p);
    }
  }
  async remove(p, opts = {}) {
    try {
      await fsp.rm(p, { recursive: !!opts.recursive });
    } catch (e) {
      throw wrap(e, p);
    }
  }
  async rename(a, b) {
    try {
      await fsp.rename(a, b);
    } catch (e) {
      throw wrap(e, a);
    }
  }
  openRead(p) {
    return Promise.resolve(fs5.createReadStream(p));
  }
};

// packages/plugin/src/manager/definitions.ts
var KINDS = ["local", "server", "ssh", "adb", "winuser", "reverse"];
var SECRET_FIELDS = ["token", "password", "passphrase"];
var SECRET_MARKER = "\u2022\u2022\u2022\u2022\u2022\u2022";
var LOCAL_ID = "local";
function isLeaseMode(v) {
  return v === "headless" || v === "gui";
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "env";
}
function aliasFor(id) {
  let a = slug(id);
  if (!/^[a-z]/.test(a)) a = `env_${a}`;
  return a;
}
function definitionLabel(def) {
  return `${def.id}: ${def.name} [${def.kind}${def.description ? `, ${def.description}` : ""}]`;
}
function isHeadlessParallel(def) {
  return def.headlessParallel !== false;
}
var LEGACY_EXCLUSIVE_KINDS = ["adb", "winuser"];
function migrateDefinition(record) {
  if (!("exclusive" in record)) return false;
  const exclusive = record["exclusive"];
  delete record["exclusive"];
  if (exclusive === true && !LEGACY_EXCLUSIVE_KINDS.includes(String(record["kind"]))) {
    record["headlessParallel"] = false;
  }
  return true;
}
function isKind(kind) {
  return KINDS.includes(kind);
}

// packages/plugin/src/tools/common.ts
import path8 from "node:path";
var TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }]
};
var MAX_TEXT = 3e4;
function clip(text2, max = MAX_TEXT) {
  if (text2.length <= max) return text2;
  const head = Math.floor(max * 0.3);
  const tail = max - head;
  return `${text2.slice(0, head)}
\u2026 [${text2.length - max} characters omitted] \u2026
${text2.slice(-tail)}`;
}
function numbered(text2, offset = 1, limit = 2e3) {
  const lines = text2.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const start = Math.max(1, offset);
  const slice = lines.slice(start - 1, start - 1 + limit);
  const body = slice.map((l, i) => `${start + i}: ${l.length > 2e3 ? `${l.slice(0, 2e3)}\u2026` : l}`).join("\n");
  const more = start - 1 + slice.length < lines.length ? `

(Showing lines ${start}-${start + slice.length - 1} of ${lines.length}. Use offset=${start + slice.length} to continue.)` : `

(End of file - total ${lines.length} lines)`;
  return body + more;
}
function looksBinary(buf) {
  const n = Math.min(buf.length, 8e3);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
function formatSize(n) {
  if (n === void 0 || n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
async function copyBetween(src, srcPath, dst, dstPath, {
  overwrite = false,
  signal,
  onFile
} = {}) {
  const st = await src.stat(srcPath);
  if (!st) throw new EnvError("ENOENT", `source not found: ${srcPath}`);
  let files = 0;
  let bytes = 0;
  const copyFile = async (s, d) => {
    signal?.throwIfAborted();
    if (!overwrite && await dst.stat(d))
      throw new EnvError("EEXIST", `destination exists: ${d} (pass overwrite=true)`);
    const data = await src.readFile(s, { maxBytes: 2 * 1024 * 1024 * 1024, signal });
    await dst.writeFile(d, data, { mode: "overwrite", atomic: true, mkdirs: true, signal });
    files++;
    bytes += data.length;
    onFile?.(s, d, data.length);
  };
  const walk = async (s, d) => {
    const info = await src.stat(s);
    if (info?.type === "dir") {
      await dst.mkdir(d, { recursive: true });
      for (const e of await src.readdir(s)) await walk(src.path.join(s, e.name), dst.path.join(d, e.name));
    } else if (info?.type === "file") {
      await copyFile(s, d);
    }
  };
  await walk(srcPath, dstPath);
  return { files, bytes, type: st.type };
}
function sniffImage(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 2303741511) return "image/png";
  if (buf.length > 3 && buf[0] === 255 && buf[1] === 216) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return void 0;
}
function baseName(p) {
  return path8.posix.basename(String(p).replace(/\\/g, "/"));
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r(?!\n)/g, "\n");
}

// packages/plugin/src/env/adb/adb-env.ts
import { spawn as spawn3 } from "node:child_process";
import fs6 from "node:fs";
import os5 from "node:os";
import path9 from "node:path";
import zlib3 from "node:zlib";

// packages/plugin/src/image/codec.ts
import zlib2 from "node:zlib";

// packages/plugin/src/image/jpeg.ts
var ZIGZAG = (() => {
  const out = [];
  for (let s = 0; s < 15; s++) {
    const cells = [];
    for (let y = 0; y < 8; y++) {
      const x = s - y;
      if (x >= 0 && x < 8) cells.push(y * 8 + x);
    }
    if (s % 2 === 0) cells.reverse();
    out.push(...cells);
  }
  return out;
})();
var LUM_Q = [
  16,
  11,
  10,
  16,
  24,
  40,
  51,
  61,
  12,
  12,
  14,
  19,
  26,
  58,
  60,
  55,
  14,
  13,
  16,
  24,
  40,
  57,
  69,
  56,
  14,
  17,
  22,
  29,
  51,
  87,
  80,
  62,
  18,
  22,
  37,
  56,
  68,
  109,
  103,
  77,
  24,
  35,
  55,
  64,
  81,
  104,
  113,
  92,
  49,
  64,
  78,
  87,
  103,
  121,
  120,
  101,
  72,
  92,
  95,
  98,
  112,
  100,
  103,
  99
];
var CHR_Q = [
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  99,
  99,
  99,
  99,
  99,
  99,
  ...Array(32).fill(99)
];
var DC_LUM = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [...Array(12).keys()] };
var DC_CHR = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [...Array(12).keys()] };
var AC_LUM = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125],
  vals: [
    1,
    2,
    3,
    0,
    4,
    17,
    5,
    18,
    33,
    49,
    65,
    6,
    19,
    81,
    97,
    7,
    34,
    113,
    20,
    50,
    129,
    145,
    161,
    8,
    35,
    66,
    177,
    193,
    21,
    82,
    209,
    240,
    36,
    51,
    98,
    114,
    130,
    9,
    10,
    22,
    23,
    24,
    25,
    26,
    37,
    38,
    39,
    40,
    41,
    42,
    52,
    53,
    54,
    55,
    56,
    57,
    58,
    67,
    68,
    69,
    70,
    71,
    72,
    73,
    74,
    83,
    84,
    85,
    86,
    87,
    88,
    89,
    90,
    99,
    100,
    101,
    102,
    103,
    104,
    105,
    106,
    115,
    116,
    117,
    118,
    119,
    120,
    121,
    122,
    131,
    132,
    133,
    134,
    135,
    136,
    137,
    138,
    146,
    147,
    148,
    149,
    150,
    151,
    152,
    153,
    154,
    162,
    163,
    164,
    165,
    166,
    167,
    168,
    169,
    170,
    178,
    179,
    180,
    181,
    182,
    183,
    184,
    185,
    186,
    194,
    195,
    196,
    197,
    198,
    199,
    200,
    201,
    202,
    210,
    211,
    212,
    213,
    214,
    215,
    216,
    217,
    218,
    225,
    226,
    227,
    228,
    229,
    230,
    231,
    232,
    233,
    234,
    241,
    242,
    243,
    244,
    245,
    246,
    247,
    248,
    249,
    250
  ]
};
var AC_CHR = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119],
  vals: [
    0,
    1,
    2,
    3,
    17,
    4,
    5,
    33,
    49,
    6,
    18,
    65,
    81,
    7,
    97,
    113,
    19,
    34,
    50,
    129,
    8,
    20,
    66,
    145,
    161,
    177,
    193,
    9,
    35,
    51,
    82,
    240,
    21,
    98,
    114,
    209,
    10,
    22,
    36,
    52,
    225,
    37,
    241,
    23,
    24,
    25,
    26,
    38,
    39,
    40,
    41,
    42,
    53,
    54,
    55,
    56,
    57,
    58,
    67,
    68,
    69,
    70,
    71,
    72,
    73,
    74,
    83,
    84,
    85,
    86,
    87,
    88,
    89,
    90,
    99,
    100,
    101,
    102,
    103,
    104,
    105,
    106,
    115,
    116,
    117,
    118,
    119,
    120,
    121,
    122,
    130,
    131,
    132,
    133,
    134,
    135,
    136,
    137,
    138,
    146,
    147,
    148,
    149,
    150,
    151,
    152,
    153,
    154,
    162,
    163,
    164,
    165,
    166,
    167,
    168,
    169,
    170,
    178,
    179,
    180,
    181,
    182,
    183,
    184,
    185,
    186,
    194,
    195,
    196,
    197,
    198,
    199,
    200,
    201,
    202,
    210,
    211,
    212,
    213,
    214,
    215,
    216,
    217,
    218,
    226,
    227,
    228,
    229,
    230,
    231,
    232,
    233,
    234,
    242,
    243,
    244,
    245,
    246,
    247,
    248,
    249,
    250
  ]
};
function buildCodes({ bits, vals }) {
  const codes = /* @__PURE__ */ new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < (bits[len - 1] ?? 0); i++) codes.set(vals[k++] ?? 0, [code++, len]);
    code <<= 1;
  }
  return codes;
}
function scaledQuant(base, quality) {
  const q2 = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q2 < 50 ? 5e3 / q2 : 200 - q2 * 2;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}
var COS = (() => {
  const t = new Float64Array(64);
  for (let u = 0; u < 8; u++)
    for (let x = 0; x < 8; x++)
      t[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos((2 * x + 1) * u * Math.PI / 16);
  return t;
})();
var BitWriter = class {
  bytes = [];
  acc = 0;
  n = 0;
  write(code, len) {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = this.acc << 1 | code >> i & 1;
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        if (this.acc === 255) this.bytes.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  finish() {
    if (this.n > 0) this.write((1 << 8 - this.n) - 1, 8 - this.n);
    return this.bytes;
  }
};
function category(v) {
  let a = Math.abs(v);
  let n = 0;
  while (a) {
    n++;
    a >>= 1;
  }
  return n;
}
function encodeJpeg(img, quality = 80) {
  const { width, height, data } = img;
  const qy = scaledQuant(LUM_Q, quality);
  const qc = scaledQuant(CHR_Q, quality);
  const codes = {
    dcY: buildCodes(DC_LUM),
    acY: buildCodes(AC_LUM),
    dcC: buildCodes(DC_CHR),
    acC: buildCodes(AC_CHR)
  };
  const out = [];
  const u16 = (v) => out.push(v >> 8 & 255, v & 255);
  const marker = (m, payload) => {
    out.push(255, m);
    u16(payload.length + 2);
    out.push(...payload);
  };
  out.push(255, 216);
  marker(224, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  marker(219, [0, ...ZIGZAG.map((i) => qy[i] ?? 1), 1, ...ZIGZAG.map((i) => qc[i] ?? 1)]);
  marker(192, [
    8,
    height >> 8 & 255,
    height & 255,
    width >> 8 & 255,
    width & 255,
    3,
    1,
    17,
    0,
    2,
    17,
    1,
    3,
    17,
    1
  ]);
  const dht = (cls, id, spec) => [cls << 4 | id, ...spec.bits, ...spec.vals];
  marker(196, [...dht(0, 0, DC_LUM), ...dht(1, 0, AC_LUM), ...dht(0, 1, DC_CHR), ...dht(1, 1, AC_CHR)]);
  marker(218, [3, 1, 0, 2, 17, 3, 17, 0, 63, 0]);
  const bw = new BitWriter();
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  const comp = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];
  const prevDc = [0, 0, 0];
  const encodeBlock = (src, q2, dc, ac, ci) => {
    for (let y = 0; y < 8; y++)
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++) s += (src[y * 8 + x] ?? 0) * (COS[u * 8 + x] ?? 0);
        tmp[y * 8 + u] = s;
      }
    for (let u = 0; u < 8; u++)
      for (let v = 0; v < 8; v++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += (tmp[y * 8 + u] ?? 0) * (COS[v * 8 + y] ?? 0);
        block[v * 8 + u] = s;
      }
    const coef = ZIGZAG.map((i) => Math.round((block[i] ?? 0) / (q2[i] ?? 1)));
    const diff = (coef[0] ?? 0) - (prevDc[ci] ?? 0);
    prevDc[ci] = coef[0] ?? 0;
    const emit = (table, sym) => {
      const c = table.get(sym);
      if (!c) throw new Error(`no Huffman code for symbol ${sym}`);
      bw.write(c[0], c[1]);
    };
    const bitsOf = (v, n) => v < 0 ? v + (1 << n) - 1 : v;
    const dn = category(diff);
    emit(dc, dn);
    if (dn) bw.write(bitsOf(diff, dn), dn);
    let run = 0;
    let last = 63;
    while (last > 0 && coef[last] === 0) last--;
    for (let k = 1; k <= last; k++) {
      const v = coef[k] ?? 0;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        emit(ac, 240);
        run -= 16;
      }
      const n = category(v);
      emit(ac, run << 4 | n);
      bw.write(bitsOf(v, n), n);
      run = 0;
    }
    if (last < 63) emit(ac, 0);
  };
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(height - 1, by + y);
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const p = (sy * width + sx) * 3;
          const r2 = data[p] ?? 0;
          const g = data[p + 1] ?? 0;
          const b = data[p + 2] ?? 0;
          const i = y * 8 + x;
          comp[0][i] = 0.299 * r2 + 0.587 * g + 0.114 * b - 128;
          comp[1][i] = -0.168736 * r2 - 0.331264 * g + 0.5 * b;
          comp[2][i] = 0.5 * r2 - 0.418688 * g - 0.081312 * b;
        }
      }
      encodeBlock(comp[0], qy, codes.dcY, codes.acY, 0);
      encodeBlock(comp[1], qc, codes.dcC, codes.acC, 1);
      encodeBlock(comp[2], qc, codes.dcC, codes.acC, 2);
    }
  }
  const entropy = bw.finish();
  const head = Buffer.from(out);
  return Buffer.concat([head, Buffer.from(entropy), Buffer.from([255, 217])]);
}

// packages/plugin/src/image/codec.ts
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function isPng(buf) {
  return buf.length > 33 && Buffer.from(buf.buffer, buf.byteOffset, 8).equals(PNG_SIGNATURE);
}
function pngSize(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePng(input) {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!isPng(buf)) throw new Error("not a PNG image");
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === void 0) throw new Error(`unsupported PNG colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("palette PNG without PLTE");
  const raw = zlib2.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("truncated PNG data");
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i] ?? 0;
      const a = i >= channels ? px[dst + i - channels] ?? 0 : 0;
      const b = y > 0 ? px[prev + i] ?? 0 : 0;
      const c = y > 0 && i >= channels ? px[prev + i - channels] ?? 0 : 0;
      let v;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + (a + b >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      px[dst + i] = v & 255;
    }
  }
  if (channels === 3) return { width, height, data: px };
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    const s = i * channels;
    if (colorType === 3) {
      const p = (px[s] ?? 0) * 3;
      out[j] = palette?.[p] ?? 0;
      out[j + 1] = palette?.[p + 1] ?? 0;
      out[j + 2] = palette?.[p + 2] ?? 0;
    } else if (channels <= 2) {
      out[j] = out[j + 1] = out[j + 2] = px[s] ?? 0;
    } else {
      out[j] = px[s] ?? 0;
      out[j + 1] = px[s + 1] ?? 0;
      out[j + 2] = px[s + 2] ?? 0;
    }
  }
  return { width, height, data: out };
}
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(parts) {
  let c = 4294967295;
  for (const p of parts) for (const b of p) c = (CRC_TABLE[(c ^ b) & 255] ?? 0) ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(img) {
  const { width, height, data } = img;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const o = y * (stride + 1);
    let sumSub = 0;
    let sumUp = 0;
    for (let i = 0; i < stride; i++) {
      const v = data[row + i] ?? 0;
      const s = v - (i >= 3 ? data[row + i - 3] ?? 0 : 0) & 255;
      const u = v - (y > 0 ? data[row - stride + i] ?? 0 : 0) & 255;
      sumSub += s < 128 ? s : 256 - s;
      sumUp += u < 128 ? u : 256 - u;
    }
    const up = y > 0 && sumUp < sumSub;
    raw[o] = up ? 2 : 1;
    for (let i = 0; i < stride; i++) {
      const v = data[row + i] ?? 0;
      const ref = up ? data[row - stride + i] ?? 0 : i >= 3 ? data[row + i - 3] ?? 0 : 0;
      raw[o + 1 + i] = v - ref & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib2.deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0))
  ]);
}
function decodeScreencapRaw(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 16) throw new Error("screencap output is too short");
  const width = b.readUInt32LE(0);
  const height = b.readUInt32LE(4);
  const format = b.readUInt32LE(8);
  const pixels = width * height * 4;
  const header = b.length - pixels;
  if (width === 0 || height === 0 || header !== 12 && header !== 16) {
    throw new Error(`unexpected screencap layout (${width}x${height}, ${b.length} bytes)`);
  }
  if (format !== 1 && format !== 2 && format !== 5) throw new Error(`unsupported screencap pixel format ${format}`);
  const bgr = format === 5;
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, s = header, d = 0; i < width * height; i++, s += 4, d += 3) {
    out[d] = b[bgr ? s + 2 : s] ?? 0;
    out[d + 1] = b[s + 1] ?? 0;
    out[d + 2] = b[bgr ? s : s + 2] ?? 0;
  }
  return { width, height, data: out };
}
function crop(img, r2) {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(r2.x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(r2.y)));
  const x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil(r2.x + r2.width)));
  const y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil(r2.y + r2.height)));
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.width + x0) * 3;
    out.set(img.data.subarray(s, s + w * 3), y * w * 3);
  }
  return { width: w, height: h, data: out };
}
function axisWeights(src, dst) {
  const scale = src / dst;
  const out = [];
  for (let i = 0; i < dst; i++) {
    const a = i * scale;
    const b = Math.min(src, (i + 1) * scale);
    const first = Math.min(src - 1, Math.floor(a));
    const last = Math.max(first + 1, Math.min(src, Math.ceil(b)));
    const w = new Float32Array(last - first);
    let sum = 0;
    for (let j = first; j < last; j++) {
      const c = Math.max(0, Math.min(j + 1, b) - Math.max(j, a));
      w[j - first] = c;
      sum += c;
    }
    if (sum <= 0) {
      w.fill(0);
      w[0] = 1;
      sum = 1;
    }
    for (let k = 0; k < w.length; k++) w[k] = (w[k] ?? 0) / sum;
    out.push({ first, w });
  }
  return out;
}
function resize(img, width, height) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === img.width && height === img.height) return img;
  const xs = axisWeights(img.width, width);
  const ys = axisWeights(img.height, height);
  const tmp = new Float32Array(width * img.height * 3);
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width * 3;
    const orow = y * width * 3;
    for (let x = 0; x < width; x++) {
      const { first, w } = xs[x] ?? { first: 0, w: new Float32Array([1]) };
      let r2 = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < w.length; k++) {
        const p = row + (first + k) * 3;
        const wk = w[k] ?? 0;
        r2 += (img.data[p] ?? 0) * wk;
        g += (img.data[p + 1] ?? 0) * wk;
        b += (img.data[p + 2] ?? 0) * wk;
      }
      tmp[orow + x * 3] = r2;
      tmp[orow + x * 3 + 1] = g;
      tmp[orow + x * 3 + 2] = b;
    }
  }
  const out = new Uint8Array(width * height * 3);
  const stride = width * 3;
  for (let y = 0; y < height; y++) {
    const { first, w } = ys[y] ?? { first: 0, w: new Float32Array([1]) };
    const o = y * stride;
    for (let i = 0; i < stride; i++) {
      let acc = 0;
      for (let k = 0; k < w.length; k++) acc += (tmp[(first + k) * stride + i] ?? 0) * (w[k] ?? 0);
      out[o + i] = Math.min(255, Math.max(0, Math.round(acc)));
    }
  }
  return { width, height, data: out };
}
function fitSize(w, h, maxEdge, maxUpscale = 1) {
  const s = Math.min(maxUpscale, maxEdge / Math.max(w, h));
  if (s === 1) return { width: w, height: h };
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
function encodeImage(img, format = "auto", quality = 80) {
  if (format === "jpeg") return { data: encodeJpeg(img, quality), mediaType: "image/jpeg" };
  const png = encodePng(img);
  if (format === "png") return { data: png, mediaType: "image/png" };
  const budget = img.width * img.height * 0.6;
  if (png.length <= budget) return { data: png, mediaType: "image/png" };
  const jpeg = encodeJpeg(img, quality);
  return jpeg.length < png.length * 0.7 ? { data: jpeg, mediaType: "image/jpeg" } : { data: png, mediaType: "image/png" };
}

// packages/plugin/src/env/posix-shell.ts
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function globToRegExp(pattern) {
  let p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p.includes("/")) p = `**/${p}`;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i);
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = p.indexOf("}", i);
      if (end < 0) {
        re += "\\{";
        continue;
      }
      re += `(?:${p.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
      i = end;
    } else if (c === "[") {
      const end = p.indexOf("]", i);
      if (end < 0) {
        re += "\\[";
        continue;
      }
      let cls = p.slice(i + 1, end);
      if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
      re += `[${cls}]`;
      i = end;
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}
function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
}
function statType(f) {
  if (f.includes("directory")) return "dir";
  if (f.includes("symbolic")) return "symlink";
  if (f.includes("regular")) return "file";
  return "other";
}
function statScript(path16, follow = true) {
  return `if [ -e ${shq(path16)} ] || [ -L ${shq(path16)} ]; then stat ${follow ? "-L " : ""}-c '%F|%s|%Y|%a' ${shq(path16)}; else echo MISSING; fi`;
}
function parseStat(out) {
  const line = out.trim().split(/\r?\n/).pop() ?? "";
  if (line === "MISSING" || line === "") return null;
  const [f = "", size, mtime, mode = ""] = line.split("|");
  return {
    type: statType(f),
    size: Number(size) || 0,
    mtimeMs: (Number(mtime) || 0) * 1e3,
    mode: parseInt(mode, 8) || 0
  };
}
function readdirScript(path16) {
  return `cd ${shq(path16)} || exit 3; ls -A1 | while IFS= read -r f; do stat -L -c '%n|%F|%s|%Y' -- "$f" 2>/dev/null || echo "$f|symbolic link|0|0"; done`;
}
function parseReaddir(out) {
  const entries = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const parts = line.split("|");
    const mtime = parts.pop();
    const size = parts.pop();
    const f = parts.pop() ?? "";
    const name2 = parts.join("|");
    if (name2 === "*" || name2 === ".*" || name2 === "." || name2 === "..") continue;
    entries.push({ name: name2, type: statType(f), size: Number(size) || 0, mtimeMs: (Number(mtime) || 0) * 1e3 });
  }
  entries.sort(byName);
  return entries;
}
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
function findScript(cwd, { hidden = false, maxDepth } = {}) {
  const prune = hidden ? "" : `\\( -name '.*' -a ! -name . \\) -prune -o `;
  const depth = maxDepth ? `-maxdepth ${maxDepth} ` : "";
  return `cd ${shq(cwd)} || exit 3; find . ${depth}${prune}\\( -type f -o -type d \\) -print 2>/dev/null | head -n 200000`;
}
function filterGlob(out, pattern, limit = 1e3) {
  const re = globToRegExp(pattern);
  const paths = [];
  let truncated = false;
  for (let line of out.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line === ".") continue;
    const rel = line.replace(/^\.\//, "");
    if (re.test(rel)) {
      if (paths.length >= limit) {
        truncated = true;
        break;
      }
      paths.push(rel);
    }
  }
  return { paths, truncated };
}
function grepScript(cwd, pattern, { path: path16, literal, ignoreCase, filesOnly, glob } = {}) {
  const flags = ["-r", "-n", "-I", "-s"];
  if (literal) flags.push("-F");
  else flags.push("-E");
  if (ignoreCase) flags.push("-i");
  if (filesOnly) flags.push("-l");
  if (glob && !glob.includes("/")) flags.push(`--include=${shq(glob)}`);
  const target = path16 ? shq(path16) : ".";
  return `cd ${shq(cwd)} || exit 3; grep ${flags.join(" ")} -e ${shq(pattern)} ${target} 2>/dev/null | head -n 20000`;
}
function parseGrep(out, { filesOnly, limit = 500, glob } = {}) {
  const re = glob && glob.includes("/") ? globToRegExp(glob) : void 0;
  const matches = [];
  const files = /* @__PURE__ */ new Set();
  let truncated = false;
  for (const raw of out.split(/\r?\n/)) {
    if (!raw) continue;
    if (filesOnly) {
      const rel2 = raw.replace(/^\.\//, "");
      if (re && !re.test(rel2)) continue;
      if (files.size >= limit) {
        truncated = true;
        break;
      }
      files.add(rel2);
      continue;
    }
    const m = /^(.*?):(\d+):(.*)$/.exec(raw);
    if (!m) continue;
    const [, file = "", line, text2 = ""] = m;
    const rel = file.replace(/^\.\//, "");
    if (re && !re.test(rel)) continue;
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    files.add(rel);
    matches.push({ path: rel, line: Number(line), text: text2.length > 500 ? `${text2.slice(0, 500)}\u2026` : text2 });
  }
  return { matches, files: [...files], truncated };
}

// packages/plugin/src/env/adb/keys.ts
var KEYS = {
  home: 3,
  back: 4,
  call: 5,
  endcall: 6,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  center: 23,
  dpad_center: 23,
  volume_up: 24,
  volume_down: 25,
  power: 26,
  camera: 27,
  clear: 28,
  comma: 55,
  period: 56,
  alt: 57,
  alt_left: 57,
  alt_right: 58,
  shift: 59,
  shift_left: 59,
  shift_right: 60,
  tab: 61,
  space: 62,
  explorer: 64,
  envelope: 65,
  enter: 66,
  return: 66,
  del: 67,
  backspace: 67,
  minus: 69,
  equals: 70,
  slash: 76,
  at: 77,
  menu: 82,
  notification: 83,
  notifications: 83,
  search: 84,
  media_play_pause: 85,
  playpause: 85,
  media_stop: 86,
  media_next: 87,
  media_previous: 88,
  page_up: 92,
  pageup: 92,
  page_down: 93,
  pagedown: 93,
  escape: 111,
  esc: 111,
  delete: 112,
  forward_del: 112,
  ctrl: 113,
  control: 113,
  ctrl_left: 113,
  ctrl_right: 114,
  caps_lock: 115,
  meta: 117,
  meta_left: 117,
  win: 117,
  cmd: 117,
  meta_right: 118,
  move_home: 122,
  move_end: 123,
  insert: 124,
  volume_mute: 164,
  mute: 164,
  app_switch: 187,
  recent: 187,
  recents: 187,
  overview: 187,
  sleep: 223,
  wakeup: 224,
  wake: 224,
  assist: 219,
  brightness_down: 220,
  brightness_up: 221,
  paste: 279,
  copy: 278,
  cut: 277,
  all_apps: 284
};
function androidKey(key) {
  const k = String(key).trim().toLowerCase().replace(/^keycode_/, "");
  if (/^\d$/.test(k)) return 7 + Number(k);
  if (/^\d{2,3}$/.test(k)) return Number(k);
  if (/^[a-z]$/.test(k)) return 29 + k.charCodeAt(0) - 97;
  const code = KEYS[k];
  if (code !== void 0) return code;
  const fn = /^f([1-9]|1[0-2])$/.exec(k);
  if (fn) return 130 + Number(fn[1]);
  return `KEYCODE_${k.toUpperCase()}`;
}

// packages/plugin/src/env/adb/input.ts
var r = (n) => Math.round(n ?? NaN);
function need(a, ...keys) {
  for (const k of keys) {
    if (a[k] === void 0 || !Number.isFinite(a[k])) throw new EnvError("EINVAL", `${a.kind} needs ${keys.join(", ")}`);
  }
}
function isAsciiTypable(text2) {
  return /^[\x20-\x7e\n\r\t]*$/.test(text2);
}
var CLIPBOARD_HELPER_JAR = "/data/local/tmp/dsh-clipboard.jar";
var CLIPBOARD_HELPER_CLASS = "dsh.Clipboard";
var PASTE_KEYCODE = 279;
function clipboardHelperCommand(command, route = "auto") {
  return `CLASSPATH=${CLIPBOARD_HELPER_JAR} app_process / ${CLIPBOARD_HELPER_CLASS} ${command}${route === "binder" ? " binder" : ""}`;
}
function shq2(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function inputTextCommands(text2, chunk2 = 200) {
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(`input text ${shq2(cur.replace(/ /g, "%s"))}`);
    cur = "";
  };
  const t = text2.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i] ?? "";
    if (c === "\n" || c === "	") {
      flush();
      out.push(`input keyevent ${c === "\n" ? 66 : 61}`);
      continue;
    }
    cur += c;
    if (c === "%" && t[i + 1] === "s" || cur.length >= chunk2) flush();
  }
  flush();
  return out;
}
function keyCommand(combo, { repeat = 1, holdMs = 0 } = {}) {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new EnvError("EINVAL", "empty key");
  if (parts.length > 1) {
    const codes = parts.map((p) => androidKey(p));
    const one = `input keycombination ${codes.join(" ")}`;
    return Array(Math.min(50, Math.max(1, repeat))).fill(one).join("; ");
  }
  const code = androidKey(parts[0]);
  if (holdMs > 0) return `input keyevent --longpress ${code}`;
  return `input keyevent ${Array(Math.min(100, Math.max(1, repeat))).fill(code).join(" ")}`;
}
function actionScript(a, screen) {
  switch (a.kind) {
    case "click":
    case "tap": {
      need(a, "x", "y");
      const at = `${r(a.x)} ${r(a.y)}`;
      if (a.long || a.button === "right") return `input swipe ${at} ${at} ${r(a.holdMs ?? a.durationMs ?? 800)}`;
      const count = a.count ?? (a.double ? 2 : 1);
      if (count <= 1) return `input tap ${at}`;
      return `${Array(count - 1).fill(`input tap ${at} & sleep 0.12;`).join(" ")} input tap ${at}; wait`;
    }
    case "long_press":
      need(a, "x", "y");
      return `input swipe ${r(a.x)} ${r(a.y)} ${r(a.x)} ${r(a.y)} ${r(a.durationMs ?? a.holdMs ?? a.ms ?? 800)}`;
    case "swipe": {
      const path16 = a.path;
      if (path16 && path16.length >= 2) return pathScript(path16, a.durationMs ?? 300);
      need(a, "x", "y", "x2", "y2");
      return `input swipe ${r(a.x)} ${r(a.y)} ${r(a.x2)} ${r(a.y2)} ${r(a.durationMs ?? a.ms ?? 300)}`;
    }
    case "drag": {
      const path16 = a.path ?? (a.x2 !== void 0 ? [
        [a.x ?? 0, a.y ?? 0],
        [a.x2, a.y2 ?? 0]
      ] : void 0);
      if (!path16 || path16.length < 2) throw new EnvError("EINVAL", "drag needs a path of at least two points");
      const dur = r(a.durationMs ?? a.ms ?? 800);
      const [p0, p1] = [path16[0], path16[path16.length - 1]];
      if (path16.length === 2 && p0 && p1) {
        return a.holdMs === 0 ? `input swipe ${r(p0[0])} ${r(p0[1])} ${r(p1[0])} ${r(p1[1])} ${dur}` : `input draganddrop ${r(p0[0])} ${r(p0[1])} ${r(p1[0])} ${r(p1[1])} ${dur}`;
      }
      return pathScript(path16, dur);
    }
    case "scroll": {
      const x = r(a.x ?? screen.width / 2);
      const y = r(a.y ?? screen.height / 2);
      const dy = (a.dy ?? 0) * screen.height * 0.1;
      const dx = (a.dx ?? 0) * screen.width * 0.1;
      const clampX = (v) => r(Math.min(screen.width * 0.95, Math.max(screen.width * 0.05, v)));
      const clampY = (v) => r(Math.min(screen.height * 0.95, Math.max(screen.height * 0.05, v)));
      if (!dx && !dy) throw new EnvError("EINVAL", "scroll needs dx or dy");
      return `input swipe ${clampX(x + dx / 2)} ${clampY(y + dy / 2)} ${clampX(x - dx / 2)} ${clampY(y - dy / 2)} ${r(a.durationMs ?? 450)}`;
    }
    case "key":
      if (!a.key) throw new EnvError("EINVAL", "key needs `key`");
      return keyCommand(a.key, { repeat: a.repeat, holdMs: a.holdMs });
    case "move":
    case "mouse_down":
    case "mouse_up":
    case "key_down":
    case "key_up":
      throw new EnvError(
        "UNSUPPORTED",
        `${a.kind} is not available on Android (touch screens have no hover or held keys); use click, long_press, swipe or drag`
      );
    default:
      throw new EnvError("EINVAL", `unsupported input action ${a.kind}`);
  }
}
function pathScript(path16, durationMs) {
  const pause = Math.max(0, durationMs / Math.max(1, path16.length - 1) / 1e3).toFixed(3);
  const [first, ...rest] = path16;
  const last = rest[rest.length - 1] ?? first;
  const lines = [`input motionevent DOWN ${r(first?.[0])} ${r(first?.[1])}`];
  for (const p of rest) lines.push(`sleep ${pause}`, `input motionevent MOVE ${r(p[0])} ${r(p[1])}`);
  lines.push(`input motionevent UP ${r(last?.[0])} ${r(last?.[1])}`);
  return lines.join("; ");
}

// packages/plugin/src/env/adb/adb-env.ts
var ADB_IME = "com.android.adbkeyboard/.AdbIME";
var AdbEnvironment = class extends Environment {
  serial;
  adb;
  adbPrefix;
  android = void 0;
  constructor({ id, name: name2, serial, adb = "adb" }) {
    super({ id, name: name2, kind: "adb" });
    this.serial = serial;
    const { exe, prefix } = adbCommand(adb);
    this.adb = exe;
    this.adbPrefix = prefix;
  }
  /** adb arguments addressing this device. */
  args(...rest) {
    return [...this.adbPrefix, ...this.serial ? ["-s", this.serial] : [], ...rest];
  }
  /** Run a script with `adb shell -T`. */
  async sh(script, opts = {}) {
    const r2 = await runHost(this.adb, this.args("shell", "-T", script), opts);
    return { ...r2, out: decodeHostText(r2.stdout) };
  }
  async open() {
    const r2 = await runHost(this.adb, this.args("get-state"), { timeoutMs: 15e3 });
    if (r2.code !== 0 || !decodeHostText(r2.stdout).includes("device")) {
      throw new EnvError(
        "EIO",
        `device ${this.serial ?? ""} is not available: ${r2.stderr.trim() || decodeHostText(r2.stdout).trim()}`
      );
    }
    const props = await this.sh(
      "getprop ro.product.model; getprop ro.build.version.release; getprop ro.product.cpu.abi; getprop ro.build.version.sdk; id -un 2>/dev/null || echo shell"
    );
    const [model, release, abi, sdk, user] = props.out.split(/\r?\n/).map((s) => s.trim());
    this.android = { model, release, abi, sdk: Number(sdk) || void 0 };
    this.info = {
      os: "android",
      family: "posix",
      arch: abi ?? "",
      hostname: model ?? this.serial ?? "",
      user: user || "shell",
      home: "/sdcard",
      cwd: "/data/local/tmp",
      pathSep: "/",
      shell: "sh",
      caps: ["fs", "glob", "grep", "proc", "pty", "tcp", "tcp-listen", "screenshot", "input", "android"],
      version: `Android ${release ?? "?"} (SDK ${sdk ?? "?"})`
    };
    return this;
  }
  async stat(p, opts = {}) {
    return parseStat((await this.sh(statScript(p, opts.follow ?? true), opts)).out);
  }
  async readdir(p, opts = {}) {
    const r2 = await this.sh(readdirScript(p), opts);
    if (r2.code === 3 || /No such file|Not a directory/.test(r2.stderr)) throw new EnvError("ENOENT", `cannot list ${p}`);
    return parseReaddir(r2.out);
  }
  async readFile(p, opts = {}) {
    const max = opts.maxBytes ?? opts.max ?? 256 * 1024 * 1024;
    let script = `cat ${shq(p)}`;
    if (opts.offset !== void 0 || opts.length !== void 0) {
      script = `tail -c +${(opts.offset ?? 0) + 1} ${shq(p)}${opts.length !== void 0 ? ` | head -c ${opts.length}` : ""}`;
    }
    const st = await this.stat(p, opts);
    if (!st) throw new EnvError("ENOENT", `no such file: ${p}`);
    if (st.type === "dir") throw new EnvError("EISDIR", `is a directory: ${p}`);
    const want = opts.length !== void 0 ? Math.min(opts.length, Math.max(0, st.size - (opts.offset ?? 0))) : st.size - (opts.offset ?? 0);
    if (want > max) throw new EnvError("ETOOBIG", `${p} is ${st.size} bytes (limit ${max})`);
    const r2 = await runHost(this.adb, this.args("exec-out", script), { signal: opts.signal, maxBytes: max + 1024 });
    return r2.stdout;
  }
  async writeFile(p, data, opts = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const dir = path9.posix.dirname(p);
    if (opts.mkdirs) await this.sh(`mkdir -p ${shq(dir)}`);
    if ((opts.mode ?? "overwrite") === "create" && await this.stat(p))
      throw new EnvError("EEXIST", `already exists: ${p}`);
    if (opts.mode === "append") {
      const tmpRemote = `/data/local/tmp/.dsh-append-${process.pid}-${Date.now()}`;
      await this.push(buf, tmpRemote);
      await this.sh(`cat ${shq(tmpRemote)} >> ${shq(p)}; rm -f ${shq(tmpRemote)}`);
    } else {
      await this.push(buf, p);
    }
    return this.stat(p);
  }
  /** Write bytes to a device path through a host temp file and `adb push`. */
  async push(buf, remote) {
    const tmp = path9.join(os5.tmpdir(), `dsh-adb-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs6.writeFileSync(tmp, buf);
    try {
      const r2 = await runHost(this.adb, this.args("push", tmp, remote));
      if (r2.code !== 0) {
        throw new EnvError(
          /Permission denied|Read-only/.test(r2.stderr + decodeHostText(r2.stdout)) ? "EACCES" : "EIO",
          `adb push failed: ${(r2.stderr || decodeHostText(r2.stdout)).trim()}`
        );
      }
    } finally {
      fs6.rmSync(tmp, { force: true });
    }
  }
  /** Push a host file to the device. */
  async pushFile(hostPath, remote) {
    const r2 = await runHost(this.adb, this.args("push", hostPath, remote), { timeoutMs: 30 * 60 * 1e3 });
    if (r2.code !== 0) throw new EnvError("EIO", `adb push failed: ${(r2.stderr || decodeHostText(r2.stdout)).trim()}`);
  }
  /** Pull a device file to the host. */
  async pullFile(remote, hostPath) {
    const r2 = await runHost(this.adb, this.args("pull", remote, hostPath), { timeoutMs: 30 * 60 * 1e3 });
    if (r2.code !== 0) throw new EnvError("EIO", `adb pull failed: ${(r2.stderr || decodeHostText(r2.stdout)).trim()}`);
  }
  /** Run a script, map a non-zero exit to an EnvError by its message, and return the output. */
  async check(script, opts) {
    const r2 = await this.sh(`${script} 2>&1; echo "__rc=$?"`, opts);
    const m = /__rc=(\d+)\s*$/.exec(r2.out);
    const code = m ? Number(m[1]) : r2.code;
    const msg = r2.out.replace(/__rc=\d+\s*$/, "").trim();
    if (code !== 0) {
      const errCode = /No such file/.test(msg) ? "ENOENT" : /File exists/.test(msg) ? "EEXIST" : /Permission denied|Read-only/.test(msg) ? "EACCES" : /not empty/i.test(msg) ? "ENOTEMPTY" : "EIO";
      throw new EnvError(errCode, msg || `command failed (${String(code)})`);
    }
    return msg;
  }
  async mkdir(p, opts = {}) {
    await this.check(`mkdir ${opts.recursive ? "-p " : ""}${shq(p)}`, opts);
  }
  async remove(p, opts = {}) {
    if (!await this.stat(p, { follow: false })) throw new EnvError("ENOENT", `no such file: ${p}`);
    await this.check(
      opts.recursive ? `rm -rf ${shq(p)}` : `if [ -d ${shq(p)} ] && [ ! -L ${shq(p)} ]; then rmdir ${shq(p)}; else rm -f ${shq(p)}; fi`,
      opts
    );
  }
  async rename(from, to, opts = {}) {
    if (!opts.overwrite && await this.stat(to, { follow: false }))
      throw new EnvError("EEXIST", `already exists: ${to}`);
    await this.check(`mv -f ${shq(from)} ${shq(to)}`, opts);
  }
  async copy(from, to, opts = {}) {
    await this.check(`cp ${opts.recursive ?? true ? "-r " : ""}${shq(from)} ${shq(to)}`, opts);
  }
  async realpath(p, opts = {}) {
    return (await this.check(`realpath ${shq(p)} 2>/dev/null || readlink -f ${shq(p)}`, opts)).split("\n").pop() ?? "";
  }
  async glob(pattern, opts = {}) {
    const cwd = opts.cwd ?? this.info?.cwd ?? "";
    const r2 = await this.sh(findScript(cwd, { hidden: opts.hidden }), {
      signal: opts.signal,
      maxBytes: 64 * 1024 * 1024
    });
    return { ...filterGlob(r2.out, pattern, opts.limit ?? 1e3), cwd };
  }
  async grep(pattern, opts = {}) {
    const cwd = opts.cwd ?? this.info?.cwd ?? "";
    const r2 = await this.sh(grepScript(cwd, pattern, opts), { signal: opts.signal, maxBytes: 64 * 1024 * 1024 });
    return { ...parseGrep(r2.out, { filesOnly: opts.filesOnly, limit: opts.limit ?? 500, glob: opts.glob }), cwd };
  }
  async spawn(spec) {
    let script = spec.command ?? (spec.argv ?? []).map(shq).join(" ");
    const envPrefix = Object.entries(spec.env ?? {}).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
    if (envPrefix) script = `export ${envPrefix}; ${script}`;
    if (spec.cwd) script = `cd ${shq(spec.cwd)} && ${script}`;
    const child = spawn3(this.adb, this.args("shell", ...spec.pty ? ["-t", "-t"] : ["-T"], script), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    return new HostChildProcess(child, { pty: !!spec.pty });
  }
  async forward({
    localHost: _localHost = "127.0.0.1",
    localPort = 0,
    remoteHost = "127.0.0.1",
    remotePort,
    proto = "tcp"
  }) {
    if (proto !== "tcp") throw new EnvError("UNSUPPORTED", "adb can only forward TCP");
    if (remoteHost !== "127.0.0.1" && remoteHost !== "localhost") {
      throw new EnvError("UNSUPPORTED", "adb forwards only reach the device loopback");
    }
    const r2 = await runHost(this.adb, this.args("forward", `tcp:${localPort}`, `tcp:${remotePort}`));
    if (r2.code !== 0) throw new EnvError("EIO", `adb forward failed: ${r2.stderr.trim()}`);
    const port = localPort === 0 ? Number(decodeHostText(r2.stdout).trim()) : localPort;
    return this.trackTunnel({
      kind: "forward",
      proto,
      localHost: "127.0.0.1",
      localPort: port,
      remoteHost,
      remotePort,
      close: async () => {
        await runHost(this.adb, this.args("forward", "--remove", `tcp:${port}`)).catch(() => {
        });
      }
    });
  }
  async reverse({
    remoteHost = "127.0.0.1",
    remotePort = 0,
    localHost = "127.0.0.1",
    localPort,
    proto = "tcp"
  }) {
    if (proto !== "tcp") throw new EnvError("UNSUPPORTED", "adb can only reverse-forward TCP");
    const r2 = await runHost(this.adb, this.args("reverse", `tcp:${remotePort}`, `tcp:${localPort}`));
    if (r2.code !== 0) throw new EnvError("EIO", `adb reverse failed: ${r2.stderr.trim()}`);
    const port = remotePort === 0 ? Number(decodeHostText(r2.stdout).trim()) : remotePort;
    return this.trackTunnel({
      kind: "reverse",
      proto,
      remoteHost,
      remotePort: port,
      localHost,
      localPort,
      close: async () => {
        await runHost(this.adb, this.args("reverse", "--remove", `tcp:${port}`)).catch(() => {
        });
      }
    });
  }
  /** Last known screen size in the current orientation. */
  screen = void 0;
  gzip = void 0;
  adbKeyboard = void 0;
  async screenshot(opts = {}) {
    const cap = await this.capture(opts);
    if (cap.png) return { png: cap.png, width: cap.width, height: cap.height };
    const img = cap.image;
    if (!img) throw new EnvError("EIO", "screencap returned no image");
    return { png: encodePng(img), width: img.width, height: img.height };
  }
  /**
   * Full-screen capture. Raw `screencap` piped through `gzip -1` is about twice as fast over
   * USB as `screencap -p` (the device spends most of the time PNG-compressing).
   */
  async capture(opts = {}) {
    if (this.gzip === void 0) {
      this.gzip = (await this.sh("command -v gzip >/dev/null 2>&1 && echo yes", opts)).out.trim() === "yes";
    }
    if (this.gzip) {
      const r3 = await runHost(this.adb, this.args("exec-out", "screencap | gzip -1"), {
        signal: opts.signal,
        maxBytes: 256 * 1024 * 1024
      });
      try {
        const image = decodeScreencapRaw(zlib3.gunzipSync(r3.stdout));
        this.screen = { width: image.width, height: image.height };
        return { image, width: image.width, height: image.height, rect: { x: 0, y: 0, ...this.screen } };
      } catch {
        this.gzip = false;
      }
    }
    const r2 = await runHost(this.adb, this.args("exec-out", "screencap", "-p"), opts);
    const png = r2.stdout;
    if (!isPng(png)) throw new EnvError("EIO", `screencap failed: ${r2.stderr.trim() || png.toString().slice(0, 200)}`);
    const { width, height } = pngSize(png);
    this.screen = { width, height };
    return { png, width, height, rect: { x: 0, y: 0, width, height } };
  }
  /** Screen size in the current orientation (from `wm size` and the display rotation). */
  async screenSize(opts = {}) {
    if (this.screen) return this.screen;
    const r2 = await this.sh("wm size; dumpsys input | grep -m1 -E 'SurfaceOrientation|Orientation:'", opts);
    const m = /Override size:\s*(\d+)x(\d+)/.exec(r2.out) ?? /Physical size:\s*(\d+)x(\d+)/.exec(r2.out);
    if (!m) throw new EnvError("EIO", `cannot read the screen size: ${r2.out.trim()}`);
    let w = Number(m[1]);
    let h = Number(m[2]);
    if (/(SurfaceOrientation:\s*[13])|(Orientation:\s*Rotation(90|270))/.test(r2.out)) [w, h] = [h, w];
    this.screen = { width: w, height: h };
    return this.screen;
  }
  async input(actions, opts = {}) {
    for (const a of actions) {
      if (a.kind === "wait") {
        await new Promise((res) => setTimeout(res, Math.min(6e4, a.ms ?? 0)));
        continue;
      }
      if (a.kind === "type") {
        await this.typeText(a.text ?? "", opts);
        continue;
      }
      const screen = a.kind === "scroll" ? await this.screenSize(opts) : this.screen ?? { width: 1080, height: 1920 };
      await this.check(actionScript(a, screen), opts);
    }
  }
  /** Whether the ADB Keyboard IME (com.android.adbkeyboard) is installed. */
  async hasAdbKeyboard(opts = {}) {
    if (this.adbKeyboard === void 0) {
      this.adbKeyboard = (await this.sh("ime list -a -s 2>/dev/null", opts)).out.includes(ADB_IME);
    }
    return this.adbKeyboard;
  }
  /** Result of probing the bundled clipboard helper; undefined until it has been probed. */
  unicodePaste = void 0;
  /**
   * Type text into the focused field.
   *
   * ASCII goes through `input text`. Anything else cannot be turned into key events — Android's
   * `KeyCharacterMap` only knows ASCII plus a few accented Latin letters, which is also why
   * scrcpy's text injection silently drops CJK — so the text is written to the device clipboard
   * and delivered with KEYCODE_PASTE. That needs no IME switch and nothing installed on the
   * device: the bundled `dsh-clipboard.jar` (a few KiB, run as the shell user through
   * `app_process`) only writes the clipboard. Devices where it cannot run fall back to the ADB
   * Keyboard IME.
   */
  async typeText(text2, opts = {}) {
    if (isAsciiTypable(text2)) {
      for (const cmd of inputTextCommands(text2)) await this.check(cmd, opts);
      return;
    }
    if (await this.ensureClipboardHelper(opts)) {
      try {
        await this.pasteUnicode(text2, opts);
        return;
      } catch (err) {
        if (!await this.hasAdbKeyboard(opts)) throw err;
        await this.typeWithAdbKeyboard(text2, opts);
        return;
      }
    }
    if (await this.hasAdbKeyboard(opts)) {
      await this.typeWithAdbKeyboard(text2, opts);
      return;
    }
    throw new EnvError(
      "UNSUPPORTED",
      `Android cannot type non-ASCII characters: \`input text\` (like scrcpy) can only produce what KeyCharacterMap knows, and neither the bundled clipboard helper nor the ADB Keyboard IME is usable here. The helper is run as the shell user through \`app_process\` (pushed to ${CLIPBOARD_HELPER_JAR}), which needs Android 7 or newer and a device that allows it. Alternatively install ADB Keyboard (https://github.com/senzhk/ADBKeyBoard, package com.android.adbkeyboard) with install_apk, type ASCII only, or paste text the app already offers.`
    );
  }
  /**
   * Push the bundled clipboard helper once per environment and check that it runs. Android 7 is
   * required, because KEYCODE_PASTE only exists from API 24.
   */
  async ensureClipboardHelper(opts = {}) {
    if (this.unicodePaste !== void 0) return this.unicodePaste;
    try {
      if (this.android?.sdk !== void 0 && this.android.sdk < 24) {
        this.unicodePaste = false;
      } else {
        await this.pushFile(ANDROID_HELPER_JAR, CLIPBOARD_HELPER_JAR);
        this.unicodePaste = (await this.sh(clipboardHelperCommand("get"), opts)).code === 0;
      }
    } catch {
      this.unicodePaste = false;
    }
    return this.unicodePaste;
  }
  /** Put `text` on the clipboard, press PASTE, then hand the clipboard back as we found it. */
  async pasteUnicode(text2, opts = {}) {
    const previous = await this.readClipboard(opts);
    await this.writeClipboard(text2, opts);
    try {
      await this.check(`input keyevent ${PASTE_KEYCODE}`, opts);
    } finally {
      await new Promise((res) => setTimeout(res, 800));
      if (previous) await this.writeClipboard(previous, opts).catch(() => {
      });
      else await this.sh(clipboardHelperCommand("clear"), opts).catch(() => {
      });
    }
  }
  async readClipboard(opts) {
    const r2 = await this.sh(clipboardHelperCommand("get"), opts);
    if (r2.code !== 0) throw new EnvError("EIO", `clipboard helper failed: ${(r2.stderr || r2.out).trim()}`);
    return r2.out;
  }
  async writeClipboard(text2, opts) {
    const r2 = await this.sh(clipboardHelperCommand("set"), { ...opts, input: text2 });
    if (r2.code !== 0 || !r2.out.includes("ok")) {
      throw new EnvError("EIO", `clipboard helper failed: ${(r2.stderr || r2.out).trim()}`);
    }
  }
  /**
   * The historical fallback: the ADB Keyboard IME is switched on for the broadcast and the
   * previous keyboard is restored afterwards.
   */
  async typeWithAdbKeyboard(text2, opts) {
    const b64 = Buffer.from(text2, "utf8").toString("base64");
    const script = [
      "prev=$(settings get secure default_input_method)",
      `ime enable ${ADB_IME} >/dev/null 2>&1`,
      `ime set ${ADB_IME} >/dev/null`,
      "sleep 0.6",
      `am broadcast -a ADB_INPUT_B64 --es msg ${b64} >/dev/null`,
      "sleep 0.3",
      `if [ -n "$prev" ] && [ "$prev" != "null" ] && [ "$prev" != "${ADB_IME}" ]; then ime set "$prev" >/dev/null; fi`
    ].join("; ");
    await this.check(script, opts);
  }
  // ---- Android specifics ---------------------------------------------------
  async installApk(hostApkPath, { replace = true, grant = true, downgrade = false } = {}) {
    const args = this.args(
      "install",
      ...replace ? ["-r"] : [],
      ...grant ? ["-g"] : [],
      ...downgrade ? ["-d"] : [],
      hostApkPath
    );
    const r2 = await runHost(this.adb, args, { timeoutMs: 15 * 60 * 1e3 });
    const text2 = `${decodeHostText(r2.stdout)}${r2.stderr}`.trim();
    if (r2.code !== 0 || !/Success/.test(text2)) throw new EnvError("EIO", `install failed: ${text2}`);
    return text2;
  }
  /** uiautomator XML of the current screen (retried once: dumps fail while the UI animates). */
  async uiDump(opts = {}) {
    const file = `/data/local/tmp/.dsh-ui-${process.pid}.xml`;
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r2 = await this.sh(`uiautomator dump ${file} 2>&1 >/dev/null; cat ${file} 2>/dev/null; rm -f ${file}`, opts);
      if (r2.out.includes("<hierarchy"))
        return r2.out.slice(r2.out.indexOf("<?xml") >= 0 ? r2.out.indexOf("<?xml") : r2.out.indexOf("<hierarchy"));
      last = r2.out.trim();
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new EnvError("EIO", `uiautomator dump failed: ${last.slice(0, 300) || "no output"}`);
  }
  /** Foreground package/activity. */
  async foreground(opts = {}) {
    const r2 = await this.sh(
      "dumpsys activity activities 2>/dev/null | grep -m1 -E 'topResumedActivity|mResumedActivity'; dumpsys window 2>/dev/null | grep -m1 mCurrentFocus",
      opts
    );
    const m = /u\d+\s+([\w.]+)\/([\w.$]+)/.exec(r2.out);
    return { package: m?.[1], activity: m?.[2]?.startsWith(".") ? `${m[1]}${m[2]}` : m?.[2], raw: r2.out.trim() };
  }
  /** Screen on/off and lock state. */
  async deviceState(opts = {}) {
    const r2 = await this.sh(
      "dumpsys power | grep -m1 -E 'mWakefulness='; dumpsys window | grep -E '^ *(showing|secure)=|isKeyguardShowing|mDreamingLockscreen' ",
      opts
    );
    const awake = /mWakefulness=Awake/.test(r2.out);
    const locked = /isKeyguardShowing=true|^\s*showing=true|mDreamingLockscreen=true/m.test(r2.out);
    const secure = /^\s*secure=true/m.test(r2.out);
    return { awake, locked, secure };
  }
  /** Facts for the device tool. */
  async deviceInfo(opts = {}) {
    this.screen = void 0;
    const [screen, state, fg, extra] = await Promise.all([
      this.screenSize(opts),
      this.deviceState(opts),
      this.foreground(opts),
      this.sh(
        `wm density | tail -n1; settings get secure default_input_method; dumpsys battery | grep -m1 ' level'; dumpsys input | grep -m1 -E 'SurfaceOrientation|Orientation:'; [ -f ${CLIPBOARD_HELPER_JAR} ] && echo __helper=yes || echo __helper=no`,
        opts
      )
    ]);
    const lines = extra.out.split(/\r?\n/).map((s) => s.trim());
    return {
      model: this.android?.model,
      android: `${this.android?.release ?? "?"} (SDK ${this.android?.sdk ?? "?"})`,
      abi: this.android?.abi,
      screen: `${screen.width}x${screen.height} (current orientation)`,
      density: lines[0]?.replace(/^.*:\s*/, ""),
      rotation: lines[3]?.replace(/^.*(Rotation|Orientation:?)\s*/, ""),
      foreground: fg.package ? `${fg.package}/${fg.activity ?? ""}` : fg.raw,
      keyboard: lines[1],
      adbKeyboard: await this.hasAdbKeyboard(opts) ? "installed (fallback for non-ASCII typing)" : "not installed",
      nonAsciiTyping: this.describeUnicodeTyping(extra.out.includes("__helper=yes")),
      ...describeStateFields(state),
      battery: lines[2]?.replace(/^.*:\s*/, "")
    };
  }
  /** How `type` delivers non-ASCII text on this device; see `typeText`. */
  describeUnicodeTyping(helperPushed) {
    if (this.android?.sdk !== void 0 && this.android.sdk < 24) {
      return "not available (Android < 7 has no KEYCODE_PASTE); ASCII only, or install the ADB Keyboard IME";
    }
    return helperPushed ? "clipboard paste with the bundled helper (pushed, used automatically; no IME switch)" : "clipboard paste with the bundled helper (pushed on first use; no IME switch)";
  }
  /** Wake the screen and dismiss an insecure lock screen. */
  async unlock(opts = {}) {
    let s = await this.deviceState(opts);
    if (!s.awake) await this.check("input keyevent 224", opts);
    s = await this.deviceState(opts);
    if (!s.locked) return `${describeState(s)}; nothing to unlock`;
    await this.check("wm dismiss-keyguard 2>/dev/null; sleep 0.6", opts);
    s = await this.deviceState(opts);
    if (s.locked) {
      const scr = await this.screenSize(opts);
      await this.check(
        `input swipe ${Math.round(scr.width / 2)} ${Math.round(scr.height * 0.9)} ${Math.round(scr.width / 2)} ${Math.round(scr.height * 0.3)} 300; sleep 0.6`,
        opts
      );
      s = await this.deviceState(opts);
    }
    if (!s.locked) return `${describeState(s)}; unlocked`;
    return s.secure ? "The lock screen is protected by a PIN, pattern or password; it cannot be unlocked without the user. Ask the user to unlock the device." : `${describeState(s)}; the lock screen is still showing`;
  }
};
function describeStateFields(s) {
  return {
    screenOn: s.awake ? "yes" : "no",
    locked: s.locked ? `yes${s.secure ? " (secure: PIN/pattern/password)" : ""}` : "no"
  };
}
function describeState(s) {
  const f = describeStateFields(s);
  return `screen on: ${f["screenOn"]}, locked: ${f["locked"]}`;
}
function formatForeground(fg) {
  return fg.package ? `Foreground: ${fg.package}/${fg.activity ?? "?"}` : `Foreground: ${fg.raw || "unknown"}`;
}

// packages/plugin/src/tools/lease/android-tools.ts
import fs7 from "node:fs";
import os6 from "node:os";
import path10 from "node:path";
function addAndroidTools(t, env) {
  const { label: name2, add, workspaceOf } = t;
  add({
    name: "install_apk",
    description: `Install an APK on ${name2}. apk_path is read from this session's workspace unless "source" names another borrowed environment alias.`,
    parameters: {
      apk_path: { type: "string", required: true, description: "Path of the .apk file." },
      source: {
        type: "string",
        description: "Alias of another borrowed environment that holds the file (default: this session's workspace)."
      },
      replace: { type: "boolean", description: "Replace an installed app (default true)." },
      downgrade: { type: "boolean", description: "Allow version downgrade." }
    },
    output: TEXT_OUTPUT,
    timeoutMs: 20 * 60 * 1e3,
    async execute(args, exec2) {
      const { env: srcEnv, cwd: srcCwd, hostPath } = await workspaceOf(exec2, args.source, args.apk_path);
      let local = hostPath;
      let temp;
      if (!local) {
        const p = srcEnv.resolvePath(args.apk_path, srcCwd);
        const data = await srcEnv.readFile(p, { maxBytes: 4 * 1024 * 1024 * 1024, signal: exec2.signal });
        temp = path10.join(os6.tmpdir(), `dsh-apk-${Date.now()}-${baseName(p)}`);
        fs7.writeFileSync(temp, data);
        local = temp;
      }
      try {
        const text2 = await env.installApk(local, { replace: args.replace ?? true, downgrade: !!args.downgrade });
        return `Installed ${baseName(args.apk_path)} on ${name2}: ${text2.split("\n").pop()}`;
      } finally {
        if (temp) fs7.rmSync(temp, { force: true });
      }
    }
  });
  add({
    name: "app",
    description: `Manage Android apps on ${name2}: launch (by package), stop, clear data, uninstall, info, list installed packages, current (foreground app/activity), open_url (open a link or deep link with the default handler), start (am start with an explicit intent).`,
    parameters: {
      action: {
        type: "string",
        enum: ["launch", "stop", "clear", "uninstall", "info", "list", "current", "open_url", "start"],
        required: true,
        description: "Operation."
      },
      package: { type: "string", description: "Package name, e.g. com.example.app (filter text for list)." },
      activity: {
        type: "string",
        description: 'launch/start: activity class (".MainActivity" or full name) or a full component "pkg/.Activity".'
      },
      url: {
        type: "string",
        description: "open_url: http(s) URL or deep link (also used as the intent data for start)."
      },
      intent_action: { type: "string", description: "start: intent action, e.g. android.settings.WIFI_SETTINGS." },
      extras: {
        type: "object",
        additionalProperties: true,
        description: 'start: string extras {"key": "value"}.'
      }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const pkg = args.package;
      const need2 = () => {
        if (!pkg) throw new Error("package is required");
      };
      const run = async (cmd) => {
        const r2 = await env.exec({ command: cmd }, { signal: exec2.signal, timeoutMs: 6e4 });
        return `${r2.stdout.toString()}${r2.stderr.toString()}`.trim();
      };
      const component = () => {
        const act = args.activity;
        if (!act) return void 0;
        if (act.includes("/")) return act;
        if (!pkg) throw new Error("package is required with a bare activity name");
        return `${pkg}/${act}`;
      };
      switch (args.action) {
        case "launch":
          need2();
          return args.activity ? await run(`am start -W -n ${shq2(component() ?? "")}`) : await run(`monkey -p ${shq2(pkg ?? "")} -c android.intent.category.LAUNCHER 1 2>&1 | tail -n 2`);
        case "stop":
          need2();
          await run(`am force-stop ${shq2(pkg ?? "")}`);
          return `stopped ${pkg}`;
        case "clear":
          need2();
          return await run(`pm clear ${shq2(pkg ?? "")}`);
        case "uninstall":
          need2();
          return await run(`pm uninstall ${shq2(pkg ?? "")}`);
        case "info":
          need2();
          return clip(
            await run(
              `dumpsys package ${shq2(pkg ?? "")} | grep -E 'versionName|versionCode|firstInstallTime|lastUpdateTime|targetSdk|enabled=' | head -n 20`
            )
          );
        case "current":
          return formatForeground(await env.foreground({ signal: exec2.signal }));
        case "open_url": {
          if (!args.url) throw new Error("url is required");
          const out = await run(
            `am start -W -a android.intent.action.VIEW -d ${shq2(args.url)}${pkg ? ` -p ${shq2(pkg)}` : ""}`
          );
          return `${clip(out)}
${formatForeground(await env.foreground({ signal: exec2.signal }))}`;
        }
        case "start": {
          const parts = ["am start -W"];
          if (args.intent_action) parts.push(`-a ${shq2(args.intent_action)}`);
          if (args.url) parts.push(`-d ${shq2(args.url)}`);
          const comp = component();
          if (comp) parts.push(`-n ${shq2(comp)}`);
          else if (pkg) parts.push(`-p ${shq2(pkg)}`);
          for (const [k, v] of Object.entries(args.extras ?? {}))
            parts.push(`--es ${shq2(k)} ${shq2(typeof v === "string" ? v : JSON.stringify(v))}`);
          if (parts.length === 1) throw new Error("start needs intent_action, url, activity or package");
          const out = await run(parts.join(" "));
          return `${clip(out)}
${formatForeground(await env.foreground({ signal: exec2.signal }))}`;
        }
        case "list":
        default:
          return clip(await run(`pm list packages -3${pkg ? ` | grep -i ${shq2(pkg)}` : ""}`)) || "No third-party packages";
      }
    }
  });
  add({
    name: "logcat",
    description: `Read recent Android log lines from ${name2}.`,
    parameters: {
      lines: { type: "integer", description: "Number of recent lines (default 200)." },
      filter: { type: "string", description: "Only keep lines containing this text (case-insensitive)." },
      level: { type: "string", enum: ["V", "D", "I", "W", "E", "F"], description: "Minimum priority (default V)." },
      clear: { type: "boolean", description: "Clear the log buffer after reading." }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const n = Math.min(5e3, args.lines ?? 200);
      const r2 = await env.exec(
        { command: `logcat -d -v time -t ${args.filter ? 2e4 : n} *:${args.level ?? "V"}` },
        { signal: exec2.signal, timeoutMs: 6e4 }
      );
      let lines = r2.stdout.toString().split(/\r?\n/);
      const filter = args.filter;
      if (filter) lines = lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())).slice(-n);
      if (args.clear) await env.exec({ command: "logcat -c" }, { signal: exec2.signal });
      return clip(lines.join("\n")) || "(empty)";
    }
  });
}
function addAndroidGuiTools(t, env) {
  const { label: name2, add } = t;
  add({
    name: "device",
    description: `Device state and controls of ${name2}: info (model, Android version, screen size/density/rotation, foreground app, keyboard, screen on/locked, battery), wake, sleep, unlock (wake and dismiss a lock screen that has no PIN/pattern/password; reports when a secure lock needs the user), notifications / quick_settings (open the shade), collapse (close it). Navigation keys (back, home, recents) are ${t.alias}__input key actions.`,
    parameters: {
      action: {
        type: "string",
        enum: ["info", "wake", "sleep", "unlock", "notifications", "quick_settings", "collapse"],
        description: "Default info."
      }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const signal = exec2.signal;
      switch (args.action ?? "info") {
        case "wake":
          await env.check("input keyevent 224", { signal });
          return describeState(await env.deviceState({ signal }));
        case "sleep":
          await env.check("input keyevent 223", { signal });
          return "screen off";
        case "unlock":
          return await env.unlock({ signal });
        case "notifications":
          await env.check("cmd statusbar expand-notifications", { signal });
          return "notification shade opened";
        case "quick_settings":
          await env.check("cmd statusbar expand-settings", { signal });
          return "quick settings opened";
        case "collapse":
          await env.check("cmd statusbar collapse", { signal });
          return "panels collapsed";
        default: {
          const info = await env.deviceInfo({ signal });
          return Object.entries(info).filter(([, v]) => v !== void 0 && v !== "").map(([k, v]) => `${k}: ${String(v)}`).join("\n");
        }
      }
    }
  });
}

// packages/plugin/src/tools/lease/context.ts
function createLeaseToolContext(ctx, defineTool, lease, workspaceOf, tools, aliasOverride) {
  const env = lease.env;
  const alias = aliasOverride ?? lease.alias;
  const cwd = env.info?.cwd;
  return {
    ctx,
    lease,
    env,
    alias,
    label: `${lease.def.name} (${alias})`,
    cwd,
    abs: (p) => env.resolvePath(p ?? ".", cwd),
    add: (def) => {
      const options = def;
      tools.push(defineTool({ ...options, name: `${alias}__${def.name}` }));
    },
    workspaceOf
  };
}

// packages/plugin/src/tools/image.ts
async function imageCapable(ctx, exec2) {
  const agent = agentOf(exec2);
  const routed = agent?.session.requestHeader?.()?.config;
  const provider = routed?.provider ?? agent?.options?.provider;
  const model = routed?.model ?? agent?.options?.model;
  const llm = ctx.get("llm");
  if (provider === void 0 || model === void 0 || llm === void 0) return true;
  try {
    const info = await llm.resolveModelInfo(provider, model, exec2.signal);
    return !info.inputModalities || info.inputModalities.includes("image");
  } catch {
    return true;
  }
}
var IMAGE_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", required: true },
    image: {
      type: "object",
      additionalProperties: true,
      properties: {
        attachmentId: { type: "string", required: true },
        mediaType: { type: "string", required: true },
        bytes: { type: "integer", required: true },
        width: { type: "integer", required: true },
        height: { type: "integer", required: true }
      }
    }
  }
};
var IMAGE_OUTPUT = {
  schema: IMAGE_RESULT_SCHEMA,
  render: (_args, value) => {
    const blocks = [{ type: "text", text: value.text }];
    if (value.image) blocks.push({ type: "image", attachment: value.image });
    return blocks;
  }
};
async function imageValue(ctx, exec2, data, { name: name2, text: text2, mediaType = "image/png" }) {
  const attachments = ctx.get("attachments");
  if (!attachments) return { text: `${text2}
(no attachment store is mounted, so the image cannot be shown)` };
  if (!await imageCapable(ctx, exec2)) {
    return { text: `${text2}
(the current model does not accept images; switch to an image-capable model to view it)` };
  }
  const ref = await attachments.saveImage({ data: new Uint8Array(data), mediaType, name: name2 });
  let note = `${text2}
${ref.mediaType} ${ref.width}x${ref.height}`;
  if (ref.originalDimensions) {
    const fx = (ref.originalDimensions.width / ref.width).toFixed(3);
    const fy = (ref.originalDimensions.height / ref.height).toFixed(3);
    note += ` (downscaled from ${ref.originalDimensions.width}x${ref.originalDimensions.height}; multiply x by ${fx} and y by ${fy} to get screen coordinates)`;
  }
  const image = {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name !== void 0 ? { name: ref.name } : {},
    ...ref.originalDimensions ? { originalDimensions: { ...ref.originalDimensions } } : {}
  };
  return { text: note, image };
}

// packages/plugin/src/tools/lease/file-tools.ts
function addFileTools({ ctx, env, alias: a, label: name2, cwd, abs, add }) {
  add({
    name: "exec",
    description: `Run a shell command in the borrowed environment ${name2} (${env.info?.os}, shell ${env.info?.shell || "default"}) and wait for it to finish. Relative paths start at ${cwd}. For long-running or interactive programs use ${a}__process_start.`,
    parameters: {
      command: { type: "string", required: true, description: "Command line, interpreted by the environment's shell." },
      cwd: { type: "string", description: `Working directory (default ${cwd}).` },
      timeout_seconds: {
        type: "number",
        description: "Kill the command after this many seconds (default 120, max 3600)."
      },
      stdin: { type: "string", description: "Text written to the command's standard input." }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const timeoutMs = Math.min(3600, Math.max(1, args.timeout_seconds ?? 120)) * 1e3;
      const started = Date.now();
      const r2 = await env.exec(
        { command: args.command, cwd: args.cwd ? abs(args.cwd) : cwd },
        { signal: exec2.signal, stdin: args.stdin, timeoutMs }
      );
      const secs = ((Date.now() - started) / 1e3).toFixed(1);
      const out = stripAnsi(r2.stdout.toString("utf8"));
      const err = stripAnsi(r2.stderr.toString("utf8"));
      const timedOut = Date.now() - started >= timeoutMs - 50 && r2.code === null;
      let text2 = `exit code: ${r2.code ?? `none (${r2.signal ?? "killed"})`}${timedOut ? " \u2014 timed out" : ""} (${secs}s)`;
      if (out) text2 += `
--- stdout ---
${clip(out)}`;
      if (err) text2 += `
--- stderr ---
${clip(err, 1e4)}`;
      if (!out && !err) text2 += "\n(no output)";
      return text2;
    }
  });
  add({
    name: "read_file",
    description: `Read a text file from ${name2}. Returns numbered lines.`,
    parameters: {
      path: { type: "string", required: true, description: `Absolute path, or relative to ${cwd}.` },
      offset: { type: "integer", description: "1-based first line (default 1)." },
      limit: { type: "integer", description: "Maximum number of lines (default 2000)." }
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec2) {
      const p = abs(args.path);
      const st = await env.stat(p, { signal: exec2.signal });
      if (!st) throw new Error(`${p} does not exist`);
      if (st.type === "dir") throw new Error(`${p} is a directory; use ${a}__list_dir`);
      if (st.size > 20 * 1024 * 1024) {
        throw new Error(
          `${p} is ${formatSize(st.size)}; read a window with ${a}__exec (e.g. head/tail) or copy it with env_transfer`
        );
      }
      const buf = await env.readFile(p, { signal: exec2.signal, maxBytes: 20 * 1024 * 1024 });
      if (looksBinary(buf)) {
        const img = sniffImage(buf);
        throw new Error(
          `${p} is a binary file (${formatSize(buf.length)})${img ? `; use ${a}__read_image to view it` : "; copy it with env_transfer instead"}`
        );
      }
      return `<path>${p}</path>
${numbered(buf.toString("utf8"), args.offset ?? 1, args.limit ?? 2e3)}`;
    }
  });
  add({
    name: "read_image",
    description: `Read a PNG/JPEG/WebP/GIF image file from ${name2} and show it.`,
    parameters: { path: { type: "string", required: true, description: `Absolute path, or relative to ${cwd}.` } },
    output: IMAGE_OUTPUT,
    async execute(args, exec2) {
      const p = abs(args.path);
      const buf = await env.readFile(p, { signal: exec2.signal, maxBytes: 30 * 1024 * 1024 });
      const mediaType = sniffImage(buf);
      if (!mediaType) throw new Error(`${p} is not a PNG/JPEG/WebP/GIF image`);
      return imageValue(ctx, exec2, buf, { name: baseName(p), text: `<path>${p}</path>`, mediaType });
    }
  });
  add({
    name: "write_file",
    description: `Create or overwrite a text file in ${name2}. Parent directories are created.`,
    parameters: {
      path: { type: "string", required: true, description: `Absolute path, or relative to ${cwd}.` },
      content: { type: "string", required: true, description: "Complete file content." },
      append: { type: "boolean", description: "Append instead of replacing." }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const p = abs(args.path);
      const st = await env.writeFile(p, Buffer.from(args.content, "utf8"), {
        mode: args.append ? "append" : "overwrite",
        mkdirs: true,
        signal: exec2.signal
      });
      return `${args.append ? "Appended to" : "Wrote"} ${p} (${formatSize(st?.size ?? Buffer.byteLength(args.content))})`;
    }
  });
  add({
    name: "edit_file",
    description: `Replace literal text in a file in ${name2}. old_string must match exactly once unless replace_all is true.`,
    parameters: {
      path: { type: "string", required: true, description: `Absolute path, or relative to ${cwd}.` },
      old_string: { type: "string", required: true, description: "Exact text to replace." },
      new_string: { type: "string", required: true, description: "Replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence." }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const p = abs(args.path);
      const raw = (await env.readFile(p, { signal: exec2.signal, maxBytes: 20 * 1024 * 1024 })).toString("utf8");
      const crlf = raw.includes("\r\n");
      const text2 = raw.replaceAll("\r\n", "\n");
      const oldS = args.old_string.replaceAll("\r\n", "\n");
      if (!oldS) throw new Error("old_string must not be empty");
      const count = text2.split(oldS).length - 1;
      if (count === 0) throw new Error(`old_string was not found in ${p}`);
      if (count > 1 && !args.replace_all)
        throw new Error(`old_string matched ${count} times in ${p}; add context or set replace_all`);
      let next = text2.split(oldS).join(args.new_string.replaceAll("\r\n", "\n"));
      if (crlf) next = next.split("\n").join("\r\n");
      await env.writeFile(p, Buffer.from(next, "utf8"), { mode: "overwrite", signal: exec2.signal });
      return `Edited ${p} (${count} replacement${count > 1 ? "s" : ""})`;
    }
  });
  add({
    name: "list_dir",
    description: `List a directory in ${name2}.`,
    parameters: { path: { type: "string", description: `Directory (default ${cwd}).` } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec2) {
      const p = abs(args.path ?? ".");
      const entries = await env.readdir(p, { signal: exec2.signal });
      const lines = entries.slice(0, 1e3).map(
        (e) => `${e.type === "dir" ? `${e.name}/` : e.name}${e.type === "file" && e.size !== void 0 ? `  ${formatSize(e.size)}` : ""}`
      );
      return `<path>${p}</path>
${lines.join("\n") || "(empty)"}${entries.length > 1e3 ? `
\u2026 ${entries.length - 1e3} more entries` : ""}`;
    }
  });
  const shellSearch = env.kind === "adb" || env.kind === "ssh";
  if (env.hasCap("glob") || shellSearch) {
    add({
      name: "glob",
      description: `Find files in ${name2} by glob pattern (e.g. "**/*.kt"). Results are relative to the search directory.`,
      parameters: {
        pattern: { type: "string", required: true, description: "Glob pattern." },
        path: { type: "string", description: `Directory to search (default ${cwd}).` }
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec2) {
        const base = abs(args.path ?? ".");
        const r2 = await env.glob(args.pattern, { cwd: base, limit: 500, signal: exec2.signal });
        return `<path>${base}</path>
${r2.paths.join("\n") || "No files found"}${r2.truncated ? "\n(results truncated)" : ""}`;
      }
    });
  }
  if (env.hasCap("grep") || shellSearch) {
    add({
      name: "grep",
      description: `Search file contents in ${name2} with a regular expression.`,
      parameters: {
        pattern: {
          type: "string",
          required: true,
          description: "Regular expression (or literal text with literal=true)."
        },
        path: { type: "string", description: `File or directory to search (default ${cwd}).` },
        glob: { type: "string", description: 'Only search files matching this glob, e.g. "*.ts".' },
        ignore_case: { type: "boolean", description: "Case-insensitive search." },
        literal: { type: "boolean", description: "Treat the pattern as literal text." },
        files_only: { type: "boolean", description: "Only list matching files." }
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec2) {
        const r2 = await env.grep(args.pattern, {
          cwd,
          path: args.path ? abs(args.path) : void 0,
          glob: args.glob,
          ignoreCase: args.ignore_case,
          literal: args.literal,
          filesOnly: args.files_only,
          limit: 300,
          signal: exec2.signal
        });
        if (args.files_only) return r2.files.join("\n") || "No matches";
        return (r2.matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") || "No matches") + (r2.truncated ? "\n(results truncated)" : "");
      }
    });
  }
}

// packages/plugin/src/tools/lease/process-tools.ts
import { StringDecoder } from "node:string_decoder";
var ManagedProcess = class {
  id;
  proc;
  command;
  startedAt = Date.now();
  exit = void 0;
  buffer = "";
  total = 0;
  waiters = [];
  constructor(id, proc, command) {
    this.id = id;
    this.proc = proc;
    this.command = command;
    const collect = () => {
      const decoder = new StringDecoder("utf8");
      return (d) => {
        const s = decoder.write(d);
        this.buffer += s;
        this.total += s.length;
        if (this.buffer.length > 1024 * 1024) this.buffer = this.buffer.slice(-512 * 1024);
        this.notify();
      };
    };
    proc.stdout.on("data", collect());
    if (proc.stderr !== proc.stdout) proc.stderr.on("data", collect());
    void proc.exited.then((exit) => {
      this.exit = exit;
      this.notify();
    });
  }
  notify() {
    for (const w of this.waiters.splice(0)) w();
  }
  /** Return and clear the buffered output. */
  take() {
    const out = this.buffer;
    this.buffer = "";
    return out;
  }
  waitForOutput(ms, signal) {
    if (this.buffer.length > 0 || this.exit) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.waiters.push(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
};
function addProcessTools({
  env,
  alias: a,
  label: name2,
  cwd,
  abs,
  add
}) {
  const processes = /* @__PURE__ */ new Map();
  let procSeq = 0;
  add({
    name: "process_start",
    description: `Start a long-running or interactive program in ${name2} without waiting for it. Returns a process id for ${a}__process_io and ${a}__process_kill. Use pty=true for programs that need a terminal.`,
    parameters: {
      command: { type: "string", required: true, description: "Command line, interpreted by the environment's shell." },
      cwd: { type: "string", description: `Working directory (default ${cwd}).` },
      pty: { type: "boolean", description: "Run inside a pseudo-terminal." },
      wait_ms: { type: "integer", description: "Collect initial output for this long (default 1500)." }
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const proc = await env.spawn({
        command: args.command,
        cwd: args.cwd ? abs(args.cwd) : cwd,
        ...args.pty ? { pty: { rows: 40, cols: 120 } } : {}
      });
      const id = `p${++procSeq}`;
      const mp = new ManagedProcess(id, proc, args.command);
      processes.set(id, mp);
      await new Promise((r2) => setTimeout(r2, Math.min(3e4, args.wait_ms ?? 1500)));
      const out = stripAnsi(mp.take());
      return `process ${id} ${mp.exit ? `exited with code ${mp.exit.code}` : "running"}${proc.pid ? ` (pid ${proc.pid})` : ""}
${out ? clip(out) : "(no output yet)"}`;
    }
  });
  add({
    name: "process_io",
    description: `Send input to and/or read new output from a process started with ${a}__process_start.`,
    parameters: {
      id: { type: "string", required: true, description: 'Process id, e.g. "p1".' },
      input: { type: "string", description: 'Text to write to standard input (include "\\n" to press Enter).' },
      close_stdin: { type: "boolean", description: "Close standard input after writing." },
      wait_ms: { type: "integer", description: "Wait up to this long for new output (default 1000, max 60000)." }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const mp = processes.get(args.id);
      if (!mp) throw new Error(`unknown process ${args.id}; running: ${[...processes.keys()].join(", ") || "none"}`);
      if (args.input !== void 0 && !mp.exit) await mp.proc.write(Buffer.from(args.input, "utf8"));
      if (args.close_stdin) mp.proc.end();
      await mp.waitForOutput(Math.min(6e4, args.wait_ms ?? 1e3), exec2.signal);
      if (!mp.exit) await new Promise((r2) => setTimeout(r2, 150));
      const out = stripAnsi(mp.take());
      return `process ${mp.id}: ${mp.exit ? `exited with code ${mp.exit.code ?? mp.exit.signal}` : "running"}
${out ? clip(out) : "(no new output)"}`;
    }
  });
  add({
    name: "process_kill",
    description: `Stop a process started with ${a}__process_start (kills its whole process tree).`,
    parameters: { id: { type: "string", required: true, description: "Process id." } },
    output: TEXT_OUTPUT,
    async execute(args) {
      const mp = processes.get(args.id);
      if (!mp) throw new Error(`unknown process ${args.id}`);
      await mp.proc.kill();
      await Promise.race([mp.proc.exited, new Promise((r2) => setTimeout(r2, 3e3))]);
      processes.delete(args.id);
      return `process ${args.id} stopped`;
    }
  });
  return processes;
}

// packages/plugin/src/tools/screen/session.ts
function toPhysical(f, x, y) {
  return { x: f.x + (x + 0.5) / f.sx - 0.5, y: f.y + (y + 0.5) / f.sy - 0.5 };
}
function toImage(f, x, y) {
  return { x: (x - f.x + 0.5) * f.sx - 0.5, y: (y - f.y + 0.5) * f.sy - 0.5 };
}
function rectToPhysical(f, r2) {
  const x0 = f.x + r2.x / f.sx;
  const y0 = f.y + r2.y / f.sy;
  const x1 = f.x + (r2.x + r2.width) / f.sx;
  const y1 = f.y + (r2.y + r2.height) / f.sy;
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}
function rectToImage(f, r2) {
  return {
    x: Math.round((r2.x - f.x) * f.sx),
    y: Math.round((r2.y - f.y) * f.sy),
    width: Math.round(r2.width * f.sx),
    height: Math.round(r2.height * f.sy)
  };
}
function center(r2) {
  return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
}
var q = (s) => JSON.stringify(s.length > 80 ? `${s.slice(0, 77)}...` : s);
function formatElement(e, f) {
  const c = toImage(f, center(e.bounds).x, center(e.bounds).y);
  const w = Math.round(e.bounds.width * f.sx);
  const h = Math.round(e.bounds.height * f.sy);
  const label = [
    e.text ? q(e.text) : "",
    e.desc && e.desc !== e.text ? `desc=${q(e.desc)}` : "",
    e.id ? `#${e.id}` : "",
    e.value !== void 0 && e.value !== "" && e.value !== e.text ? `value=${q(e.value)}` : ""
  ].filter(Boolean).join(" ");
  return `${"  ".repeat(Math.min(e.depth, 6))}[${e.index}] ${e.role}${label ? ` ${label}` : ""} @(${Math.round(c.x)},${Math.round(c.y)}) ${w}x${h}${e.flags.length ? ` [${e.flags.join(",")}]` : ""}`;
}
var DEFAULT_MAX_EDGE = 1280;
var MIN_MAX_EDGE = 256;
var MAX_MAX_EDGE = 2048;
var ScreenSession = class {
  frame = void 0;
  /** Display used by screenshots that do not name one. */
  display = void 0;
  /** Window followed by screenshots that do not name a target (after a window screenshot). */
  window = void 0;
  maxEdge = DEFAULT_MAX_EDGE;
  /** Elements of the latest `ui` listing (physical bounds, so they survive re-screenshots). */
  elements = [];
  env;
  constructor(env) {
    this.env = env;
  }
  /** Capture, crop/resize, encode, and make the result the current frame. */
  async shoot(o = {}) {
    const maxEdge = Math.min(MAX_MAX_EDGE, Math.max(MIN_MAX_EDGE, Math.round(o.maxEdge ?? this.maxEdge)));
    if (o.maxEdge !== void 0 && !o.region) this.maxEdge = maxEdge;
    let want;
    if (o.region) {
      const f = await this.ensureFrame(o.signal);
      if (o.region.width <= 0 || o.region.height <= 0) throw new EnvError("EINVAL", "region needs a positive size");
      want = rectToPhysical(f, o.region);
    }
    const display = o.display ?? this.display;
    const window = o.region ? void 0 : o.window;
    const cap = await this.env.capture({
      display,
      rect: want,
      window: window?.hwnd,
      maxWidth: want ? void 0 : maxEdge,
      maxHeight: want ? void 0 : maxEdge,
      cursor: o.cursor,
      signal: o.signal
    });
    let covered = cap.rect;
    let img = cap.image;
    const pixels = () => {
      if (img) return img;
      if (!cap.png || !isPng(cap.png)) throw new EnvError("EIO", "the environment returned no image");
      img = decodePng(cap.png);
      return img;
    };
    if (want) {
      const x0 = Math.max(want.x, covered.x);
      const y0 = Math.max(want.y, covered.y);
      const x1 = Math.min(want.x + want.width, covered.x + covered.width);
      const y1 = Math.min(want.y + want.height, covered.y + covered.height);
      if (x1 <= x0 || y1 <= y0) throw new EnvError("EINVAL", "region lies outside the screen");
      const inner = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      if (inner.x !== covered.x || inner.y !== covered.y || inner.width !== covered.width || inner.height !== covered.height) {
        const kx = cap.width / covered.width;
        const ky = cap.height / covered.height;
        img = crop(pixels(), {
          x: (inner.x - covered.x) * kx,
          y: (inner.y - covered.y) * ky,
          width: inner.width * kx,
          height: inner.height * ky
        });
      }
      covered = inner;
    }
    const target = fitSize(covered.width, covered.height, maxEdge, want ? 2 : 1);
    const curW = img?.width ?? cap.width;
    const curH = img?.height ?? cap.height;
    if (curW !== target.width || curH !== target.height) img = resize(pixels(), target.width, target.height);
    let encoded;
    if (!img && cap.png && (o.format ?? "auto") !== "jpeg") {
      encoded = (o.format ?? "auto") === "auto" && cap.png.length > target.width * target.height * 0.6 ? encodeImage(pixels(), "auto", o.quality) : { data: cap.png, mediaType: "image/png" };
    } else {
      encoded = encodeImage(pixels(), o.format ?? "auto", o.quality ?? 80);
    }
    const frame = {
      x: covered.x,
      y: covered.y,
      sx: target.width / covered.width,
      sy: target.height / covered.height,
      width: target.width,
      height: target.height,
      kind: want ? "region" : window ? "window" : "screen",
      display: want || window ? void 0 : display,
      window
    };
    this.frame = frame;
    if (!want) {
      this.window = window;
      if (o.display !== void 0) this.display = o.display;
    }
    return {
      ...encoded,
      frame,
      rect: covered,
      cursor: cap.cursor ? toImage(frame, cap.cursor.x, cap.cursor.y) : void 0
    };
  }
  /** The current frame, taking a (discarded) screenshot first when none exists. */
  async ensureFrame(signal) {
    if (this.frame) return this.frame;
    return (await this.shoot({ signal })).frame;
  }
  /** Frame coordinates → physical, after making sure a frame exists. */
  async physical(x, y, signal) {
    return toPhysical(await this.ensureFrame(signal), x, y);
  }
  element(index) {
    const e = this.elements.find((el) => el.index === index);
    if (!e) {
      throw new EnvError(
        "EINVAL",
        this.elements.length ? `no element [${index}] in the latest ui listing (0..${this.elements.length - 1})` : "no ui listing yet; call the ui tool first"
      );
    }
    return e;
  }
};
function describeFrame(f, rect) {
  const where = f.kind === "window" ? `window ${JSON.stringify(f.window?.title ?? "")}` : f.kind === "region" ? `zoomed region` : f.display !== void 0 && f.display >= 0 ? `display ${f.display}` : f.display === -1 ? "all displays" : "screen";
  const scale = f.sx === 1 && f.sy === 1 ? "1:1" : `scale ${f.sx.toFixed(3)}`;
  return `Image ${f.width}x${f.height} of ${where} (physical ${rect.width}x${rect.height} at ${rect.x},${rect.y}; ${scale}). From now on all x/y coordinates (input, ui, windows) are pixels of THIS image: (0,0) top-left .. (${f.width - 1},${f.height - 1}) bottom-right.`;
}
async function mapAction(s, a, signal) {
  const { element, ...rest } = a;
  const out = { ...rest };
  if (element !== void 0) {
    const c = center(s.element(element).bounds);
    out.x = c.x;
    out.y = c.y;
  } else if (a.x !== void 0 && a.y !== void 0) {
    const p = await s.physical(a.x, a.y, signal);
    out.x = p.x;
    out.y = p.y;
  }
  if (a.x2 !== void 0 && a.y2 !== void 0) {
    const p = await s.physical(a.x2, a.y2, signal);
    out.x2 = p.x;
    out.y2 = p.y;
  }
  if (a.path) {
    const f = await s.ensureFrame(signal);
    out.path = a.path.map(([x, y]) => {
      const p = toPhysical(f, x, y);
      return [p.x, p.y];
    });
  }
  for (const k of ["x", "y", "x2", "y2"]) {
    const v = out[k];
    if (v !== void 0) out[k] = Math.round(v);
  }
  if (out.path) out.path = out.path.map(([x, y]) => [Math.round(x), Math.round(y)]);
  return out;
}

// packages/plugin/src/tools/screen/windows.ts
async function resolveWindow(env, selector, signal) {
  const list = await env.windows({ signal });
  const sel = typeof selector === "string" ? selector.trim() : selector;
  if (sel === void 0 || sel === "") {
    const fg = list.find((w) => w.foreground);
    if (!fg) throw new EnvError("ENOENT", "no foreground window; name a window");
    return fg;
  }
  const asNum = typeof sel === "number" ? sel : /^(0x[0-9a-f]+|\d+)$/i.test(sel) ? Number(sel) : void 0;
  if (asNum !== void 0) {
    const w = list.find((x) => x.hwnd === asNum);
    if (w) return w;
    if (typeof sel === "number") throw new EnvError("ENOENT", `no window with handle ${sel}`);
  }
  const needle = String(sel).toLowerCase();
  const matches = list.filter(
    (w) => w.title.toLowerCase().includes(needle) || w.process.toLowerCase().replace(/\.exe$/, "") === needle.replace(/\.exe$/, "")
  );
  const exact = matches.find((w) => w.title.toLowerCase() === needle);
  const found = exact ?? matches[0];
  if (!found) {
    throw new EnvError(
      "ENOENT",
      `no window matches ${JSON.stringify(sel)}. Open windows: ${list.slice(0, 15).map((w) => JSON.stringify(w.title)).join(", ")}`
    );
  }
  return found;
}
function formatWindow(w, f) {
  const r2 = f ? rectToImage(f, w) : w;
  const flags = [
    w.foreground ? "foreground" : "",
    w.minimized ? "minimized" : "",
    w.maximized ? "maximized" : "",
    w.topmost ? "topmost" : ""
  ].filter(Boolean);
  return `hwnd=${w.hwnd} ${JSON.stringify(w.title)} ${w.process || "?"} (pid ${w.pid}) at (${r2.x},${r2.y}) ${r2.width}x${r2.height}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

// packages/plugin/src/tools/lease/screen-tools.ts
var sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
async function screenshotValue(ctx, exec2, session, alias, opts, before = "") {
  const shot = await session.shoot({ ...opts, signal: exec2.signal });
  let text2 = `${before}${before ? "\n" : ""}${describeFrame(shot.frame, shot.rect)}`;
  if (shot.cursor) text2 += `
Mouse pointer at (${Math.round(shot.cursor.x)},${Math.round(shot.cursor.y)}).`;
  if (shot.frame.kind === "screen" && session.env.hasCap("displays")) {
    const displays = await session.env.displays({ signal: exec2.signal }).catch(() => []);
    if (displays.length > 1) {
      text2 += `
Displays: ${displays.map((d) => `${d.index}${d.primary ? " (primary)" : ""} ${d.width}x${d.height} at ${d.x},${d.y}`).join("; ")}. Pick one with display=N.`;
    }
  }
  return imageValue(ctx, exec2, shot.data, {
    name: `${alias}-screenshot.${shot.mediaType === "image/jpeg" ? "jpg" : "png"}`,
    text: text2,
    mediaType: shot.mediaType
  });
}
async function followUpShot(session, signal) {
  if (session.window && session.env.hasCap("windows")) {
    const w = await resolveWindow(session.env, session.window.hwnd, signal).catch(() => void 0);
    if (w && !w.minimized) return { window: w };
  }
  return {};
}
async function toEnvActions(session, actions, signal) {
  const android = session.env.kind === "adb";
  const out = [];
  for (const a of actions) {
    const path16 = a.path?.map((p) => {
      if (p.length !== 2 || !p.every((n) => Number.isFinite(n)))
        throw new EnvError("EINVAL", "path points must be [x, y]");
      return [p[0] ?? 0, p[1] ?? 0];
    });
    const base = {
      kind: a.kind,
      x: a.x,
      y: a.y,
      x2: a.x2,
      y2: a.y2,
      element: a.element,
      path: path16,
      button: a.button,
      count: a.count,
      modifiers: a.modifiers,
      dx: a.dx,
      dy: a.dy,
      text: a.text,
      key: a.key,
      repeat: a.repeat,
      holdMs: a.hold_ms,
      durationMs: a.duration_ms,
      ms: a.ms
    };
    for (const k of Object.keys(base)) if (base[k] === void 0) delete base[k];
    const m = await mapAction(session, base, signal);
    if (a.kind === "type" && (a.element !== void 0 || a.x !== void 0 && a.y !== void 0)) {
      out.push({ kind: "click", x: m.x, y: m.y });
      out.push({ kind: "wait", ms: android ? 300 : 120 });
      out.push({ kind: "type", text: a.text ?? "" });
      continue;
    }
    if (!android && a.kind === "long_press") {
      out.push({ kind: "mouse_down", x: m.x, y: m.y, button: m.button });
      out.push({ kind: "wait", ms: Math.min(1e4, a.duration_ms ?? a.hold_ms ?? a.ms ?? 800) });
      out.push({ kind: "mouse_up", x: m.x, y: m.y, button: m.button });
      continue;
    }
    if (!android && (a.kind === "drag" || a.kind === "swipe") && !m.path && m.x2 !== void 0) {
      m.path = [
        [m.x ?? 0, m.y ?? 0],
        [m.x2, m.y2 ?? 0]
      ];
    }
    if (android && (a.kind === "click" || a.kind === "long_press") && (m.x === void 0 || m.y === void 0))
      throw new EnvError("EINVAL", `${a.kind} needs x and y (or element)`);
    out.push(m);
  }
  return out;
}
function inputDescription(env, a, name2) {
  if (env.kind === "adb") {
    return [
      `Touch and key input on ${name2} (Android). Actions run in order. x/y are pixels of the latest screenshot image (${a}__screenshot, ${a}__ui or a screenshot returned by this tool); instead of x/y you can pass element: N to target [N] of the latest ${a}__ui listing.`,
      "Kinds: click {x,y,count?} taps (count 2 = double tap); long_press {x,y,duration_ms?}; swipe {x,y,x2,y2,duration_ms?} for scrolling/flinging/sliders; drag {x,y,x2,y2 or path:[[x,y],...]} press-and-hold then move (rearrange, drag-and-drop);",
      "scroll {x?,y?,dy} (+1 \u2248 10% of the screen; positive scrolls down/reveals content below; dx for horizontal); type {text} into the focused field (element/x,y taps it first; newline = Enter; non-ASCII is pasted from the device clipboard, so the field must allow pasting);",
      'key {key, repeat?} \u2014 names: back, home, recents, enter, del (backspace), tab, escape, up/down/left/right, power, wakeup, volume_up, menu, search, paste, a-z, 0-9, KEYCODE_* or a numeric code; combos like "ctrl+a" use keycombination;',
      "wait {ms}. Set screenshot: true to get a fresh screenshot after the actions instead of calling the screenshot tool."
    ].join(" ");
  }
  return [
    `Mouse and keyboard input on ${name2}. Actions run in order. x/y are pixels of the latest screenshot image (${a}__screenshot, ${a}__ui or a screenshot returned by this tool); instead of x/y you can pass element: N to target [N] of the latest ${a}__ui listing.`,
    'Kinds: click {x,y,button?,count?,modifiers?} (count 2 = double click; modifiers like "ctrl" or "shift+alt" are held during the click); move {x,y}; drag {x,y,x2,y2 or path:[[x,y],...], duration_ms?} (press, move, release); long_press {x,y,duration_ms?};',
    "scroll {x,y,dy,dx?} in wheel notches (\u22483 lines each; positive dy scrolls down); type {text} any Unicode text, \\n = Enter (element/x,y clicks the target first);",
    'key {key, repeat?, hold_ms?} \u2014 combos like "ctrl+s", "alt+tab", "ctrl+shift+esc", "win+r", or single keys: enter, esc, tab, backspace, delete, home, end, pageup, pagedown, up, down, left, right, f1-f24, space, a-z, 0-9;',
    "key_down/key_up {key} hold keys across actions (anything still held is released when the call ends); mouse_down/mouse_up {x?,y?,button?}; wait {ms}.",
    "Set screenshot: true to get a fresh screenshot after the actions (waits settle_ms first) instead of calling the screenshot tool."
  ].join(" ");
}
function addScreenTools({ ctx, env, alias: a, label: name2, add }, session) {
  const windowsCaps = env.hasCap("windows");
  const displayCaps = env.hasCap("displays");
  if (env.hasCap("screenshot")) {
    add({
      name: "screenshot",
      description: [
        `Capture the screen of ${name2}. The image is downscaled so its long edge is at most max_size (default ${DEFAULT_MAX_EDGE}); all x/y in ${a}__input, ${a}__ui${windowsCaps ? ` and ${a}__windows` : ""} then refer to pixels of THIS image (the scaling is handled for you).`,
        "Use region to zoom into part of the current image (coordinates of the current image; up to 2x magnification) when text is too small; the zoomed image becomes the coordinate frame until the next screenshot.",
        windowsCaps ? "window captures one window (even when covered) by title, process name or hwnd." : "",
        displayCaps ? "display picks a monitor on multi-monitor systems (0 = primary, -1 = all)." : ""
      ].filter(Boolean).join(" "),
      parameters: {
        region: {
          type: "object",
          additionalProperties: false,
          description: "Zoom: rectangle in the current screenshot coordinates.",
          properties: {
            x: { type: "number", required: true },
            y: { type: "number", required: true },
            width: { type: "number", required: true },
            height: { type: "number", required: true }
          }
        },
        ...windowsCaps ? {
          window: {
            type: "string",
            description: "Capture only this window: title substring, process name or hwnd."
          }
        } : {},
        ...displayCaps ? {
          display: {
            type: "integer",
            description: "Monitor index (0 = primary, -1 = all monitors); remembered for later screenshots."
          }
        } : {},
        max_size: {
          type: "integer",
          description: `Long-edge limit in pixels, 256-2048 (default ${DEFAULT_MAX_EDGE}; remembered).`
        },
        format: {
          type: "string",
          enum: ["auto", "png", "jpeg"],
          description: "auto (default): PNG for UI, JPEG when the PNG would be large (photos, video)."
        },
        quality: { type: "integer", description: "JPEG quality 30-95 (default 80)." },
        ...windowsCaps ? { cursor: { type: "boolean", description: "Draw the mouse pointer into the image." } } : {}
      },
      output: IMAGE_OUTPUT,
      async execute(args, exec2) {
        const window = "window" in args && typeof args.window === "string" && args.window ? await resolveWindow(env, args.window, exec2.signal) : void 0;
        if (window?.minimized) throw new Error(`window ${JSON.stringify(window.title)} is minimized; restore it first`);
        return screenshotValue(ctx, exec2, session, a, {
          region: args.region,
          window,
          display: "display" in args && typeof args.display === "number" ? args.display : void 0,
          maxEdge: args.max_size,
          format: args.format,
          quality: args.quality === void 0 ? void 0 : Math.min(95, Math.max(30, args.quality)),
          cursor: "cursor" in args && args.cursor === true
        });
      }
    });
  }
  if (env.hasCap("input")) {
    const android = env.kind === "adb";
    const kinds = android ? ["click", "long_press", "swipe", "drag", "scroll", "type", "key", "wait"] : [
      "click",
      "move",
      "drag",
      "long_press",
      "scroll",
      "type",
      "key",
      "key_down",
      "key_up",
      "mouse_down",
      "mouse_up",
      "wait"
    ];
    add({
      name: "input",
      description: inputDescription(env, a, name2),
      parameters: {
        actions: {
          type: "array",
          required: true,
          description: "Actions to perform in order.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: kinds, required: true },
              x: { type: "number" },
              y: { type: "number" },
              element: {
                type: "integer",
                description: `Index of an element from the latest ${a}__ui listing (instead of x/y).`
              },
              x2: { type: "number", description: "End point of a swipe/drag." },
              y2: { type: "number" },
              path: {
                type: "array",
                description: "Drag path [[x,y], ...] (at least two points).",
                items: { type: "array", items: { type: "number" } }
              },
              ...android ? {} : {
                button: { type: "string", enum: ["left", "right", "middle"] },
                modifiers: {
                  type: "string",
                  description: 'Keys held during click/drag/scroll, e.g. "ctrl+shift".'
                }
              },
              count: { type: "integer", description: "Clicks/taps (2 = double)." },
              dx: { type: "number", description: "Horizontal scroll (positive = right)." },
              dy: { type: "number", description: "Vertical scroll (positive = down)." },
              text: { type: "string" },
              key: { type: "string" },
              repeat: { type: "integer", description: "Press the key this many times." },
              hold_ms: { type: "integer", description: "Hold the key / press this long." },
              duration_ms: { type: "integer", description: "Gesture duration." },
              ms: { type: "integer", description: "wait: milliseconds." }
            }
          }
        },
        screenshot: { type: "boolean", description: "Return a screenshot after the actions." },
        settle_ms: { type: "integer", description: "Wait before that screenshot (default 500)." }
      },
      output: IMAGE_OUTPUT,
      async execute(args, exec2) {
        const acts = await toEnvActions(session, args.actions, exec2.signal);
        await env.input(acts, { signal: exec2.signal });
        const n = args.actions.length;
        const done = `Performed ${n} action${n === 1 ? "" : "s"}.`;
        if (!args.screenshot) return { text: done };
        await sleep(Math.min(1e4, Math.max(0, args.settle_ms ?? 500)));
        return screenshotValue(ctx, exec2, session, a, await followUpShot(session, exec2.signal), done);
      }
    });
  }
}

// packages/plugin/src/tools/lease/tunnel-tool.ts
function describeTunnel(t) {
  const route = t.kind === "forward" ? `host 127.0.0.1:${t.localPort} \u2192 env ${t.remoteHost}:${t.remotePort}` : `env ${t.remoteHost}:${t.remotePort} \u2192 host ${t.localHost}:${t.localPort}`;
  return `${t.id}: ${route} (${t.proto})`;
}
function addTunnelTool({ env, label: name2, add }) {
  add({
    name: "tunnel",
    description: `Manage network tunnels for ${name2}. direction "to_env" makes a port of the environment reachable at 127.0.0.1:<local_port> on the harness host (like ssh -L); "from_env" makes a host port reachable inside the environment at <env_host>:<env_port> (like ssh -R; e.g. let a phone reach a dev server). UDP needs a dsh-env-server based environment.`,
    parameters: {
      action: { type: "string", enum: ["open", "close", "list"], required: true, description: "What to do." },
      direction: { type: "string", enum: ["to_env", "from_env"], description: "Tunnel direction (for open)." },
      env_port: { type: "integer", description: "Port inside the environment (0 = pick one, for from_env)." },
      env_host: { type: "string", description: "Host inside the environment (default 127.0.0.1)." },
      local_port: { type: "integer", description: "Port on the harness host (0 = pick one, for to_env)." },
      protocol: { type: "string", enum: ["tcp", "udp"], description: "Default tcp." },
      id: { type: "string", description: "Tunnel id (for close)." }
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (args.action === "list") return env.listTunnels().map(describeTunnel).join("\n") || "No tunnels";
      if (args.action === "close") {
        const t2 = env.tunnels.get(args.id ?? "");
        if (!t2) throw new Error(`unknown tunnel ${args.id}`);
        await t2.close();
        return `closed ${args.id}`;
      }
      const proto = args.protocol ?? "tcp";
      if (args.direction === "from_env") {
        if (!args.local_port) throw new Error("local_port (the host port to expose) is required");
        const t2 = await env.reverse({
          remoteHost: args.env_host ?? "127.0.0.1",
          remotePort: args.env_port ?? 0,
          localHost: "127.0.0.1",
          localPort: args.local_port,
          proto
        });
        return `opened ${describeTunnel(t2)}`;
      }
      if (!args.env_port) throw new Error("env_port is required");
      const t = await env.forward({
        localHost: "127.0.0.1",
        localPort: args.local_port ?? 0,
        remoteHost: args.env_host ?? "127.0.0.1",
        remotePort: args.env_port,
        proto
      });
      return `opened ${describeTunnel(t)}`;
    }
  });
}

// packages/plugin/src/tools/screen/android-ui.ts
var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}
function parseBounds(b) {
  const m = b && /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b);
  if (!m) return void 0;
  const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(Number);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
function parseNodes(xml) {
  const nodes = [];
  const stack = [];
  const re = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m;
  while (m = re.exec(xml)) {
    if (m[0] === "</node>") {
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const [, key, value] of (m[1] ?? "").matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (key) attrs[key] = decodeXml(value ?? "");
    }
    const parent = stack[stack.length - 1] ?? -1;
    const idx = nodes.length;
    nodes.push({ attrs, depth: stack.length, parent, children: [] });
    if (parent >= 0) nodes[parent]?.children.push(idx);
    if (m[2] !== "/") stack.push(idx);
  }
  return nodes;
}
function parseUiautomator(xml, opts = {}) {
  const nodes = parseNodes(xml);
  const filter = opts.filter ?? "default";
  const query = opts.query?.toLowerCase();
  const absorbed = /* @__PURE__ */ new Set();
  const labelOf = (i) => {
    const n = nodes[i];
    return (n?.attrs["text"] || n?.attrs["content-desc"] || "").trim();
  };
  const interactive = (a) => a["clickable"] === "true" || a["long-clickable"] === "true" || a["scrollable"] === "true" || a["checkable"] === "true" || /EditText|AutoCompleteTextView/.test(a["class"] ?? "");
  const inherited = /* @__PURE__ */ new Map();
  nodes.forEach((n, i) => {
    if (!interactive(n.attrs) || labelOf(i) || n.attrs["scrollable"] === "true") return;
    const texts = [];
    const walk = (j) => {
      for (const c of nodes[j]?.children ?? []) {
        const child = nodes[c];
        if (!child || texts.length >= 3) return;
        if (interactive(child.attrs) && child.attrs["scrollable"] !== "true" && labelOf(c)) continue;
        const l = labelOf(c);
        if (l) {
          texts.push(l);
          absorbed.add(c);
        }
        walk(c);
      }
    };
    walk(i);
    if (texts.length) inherited.set(i, texts.join(" | "));
  });
  const out = [];
  const limit = opts.limit ?? 400;
  nodes.forEach((n, i) => {
    const a = n.attrs;
    const bounds = parseBounds(a["bounds"]);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    if (opts.screen && (bounds.x >= opts.screen.width || bounds.y >= opts.screen.height || bounds.x + bounds.width <= 0 || bounds.y + bounds.height <= 0))
      return;
    const text2 = (a["text"] ?? "").trim() || inherited.get(i);
    const desc = (a["content-desc"] ?? "").trim() || void 0;
    const id = a["resource-id"] ? a["resource-id"].replace(/^[\w.]+:id\//, "") : void 0;
    const isInteractive = interactive(a);
    if (filter === "interactive" && !isInteractive) return;
    if (filter === "default" && !isInteractive && (!(text2 || desc) || absorbed.has(i))) return;
    if (query) {
      const hay = `${text2 ?? ""}
${desc ?? ""}
${a["resource-id"] ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return;
    }
    const flags = [];
    if (a["clickable"] === "true") flags.push("clickable");
    if (a["long-clickable"] === "true") flags.push("long-clickable");
    if (a["scrollable"] === "true") flags.push("scrollable");
    if (/EditText|AutoCompleteTextView/.test(a["class"] ?? "")) flags.push("editable");
    if (a["checkable"] === "true") flags.push(a["checked"] === "true" ? "checked" : "unchecked");
    if (a["selected"] === "true") flags.push("selected");
    if (a["focused"] === "true") flags.push("focused");
    if (a["password"] === "true") flags.push("password");
    if (a["enabled"] === "false") flags.push("disabled");
    if (out.length >= limit) return;
    out.push({
      index: out.length,
      depth: filter === "all" ? n.depth : 0,
      role: (a["class"] ?? "node").split(".").pop() || "node",
      text: text2 || void 0,
      desc,
      id,
      bounds,
      flags,
      ...a["hint"] && a["hint"] !== text2 ? { value: `hint: ${a["hint"]}` } : {}
    });
  });
  return out;
}
function dumpPackage(xml) {
  return /<node\b[^>]*\bpackage="([^"]*)"/.exec(xml)?.[1];
}

// packages/plugin/src/tools/screen/uia.ts
var UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Out-Json($o) {
  $s = ConvertTo-Json -InputObject $o -Depth 8 -Compress
  $s = [regex]::Replace($s, '[^\x00-\x7e]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.Write($s)
}
function Rect($r) {
  if ($r.IsEmpty -or [double]::IsInfinity($r.Width) -or $r.Width -le 0) { return $null }
  return @([int][math]::Round($r.X), [int][math]::Round($r.Y), [int][math]::Round($r.Width), [int][math]::Round($r.Height))
}
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  try { Add-Type -AssemblyName UIAutomationClientsideProviders } catch {}
  $req = '__REQ__' | ConvertFrom-Json
  $A = [System.Windows.Automation.AutomationElement]
  $NS = $A::NotSupported
  $root = $A::FromHandle([IntPtr][long]$req.hwnd)
  if ($req.op -eq 'list') {
    $cr = New-Object System.Windows.Automation.CacheRequest
    $cr.TreeScope = [System.Windows.Automation.TreeScope]::Subtree
    if (-not $req.raw) { $cr.TreeFilter = [System.Windows.Automation.Automation]::ControlViewCondition }
    $cr.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::None
    $props = @($A::NameProperty, $A::ControlTypeProperty, $A::AutomationIdProperty, $A::ClassNameProperty,
      $A::BoundingRectangleProperty, $A::IsEnabledProperty, $A::IsOffscreenProperty, $A::HasKeyboardFocusProperty,
      $A::IsKeyboardFocusableProperty, $A::RuntimeIdProperty, $A::IsInvokePatternAvailableProperty,
      $A::IsTogglePatternAvailableProperty, $A::IsValuePatternAvailableProperty,
      $A::IsExpandCollapsePatternAvailableProperty, $A::IsSelectionItemPatternAvailableProperty,
      $A::IsScrollPatternAvailableProperty, $A::IsRangeValuePatternAvailableProperty,
      [System.Windows.Automation.ValuePattern]::ValueProperty,
      [System.Windows.Automation.TogglePattern]::ToggleStateProperty,
      [System.Windows.Automation.ExpandCollapsePattern]::ExpandCollapseStateProperty,
      [System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty)
    foreach ($p in $props) { $cr.Add($p) }
    $c = $root.GetUpdatedCache($cr)
    $out = New-Object System.Collections.ArrayList
    $limit = [int]$req.limit
    $maxDepth = [int]$req.depth
    function Walk($e, [int]$d, [string]$path) {
      if ($out.Count -ge $limit) { return }
      $pats = @()
      if ($e.GetCachedPropertyValue($A::IsInvokePatternAvailableProperty)) { $pats += 'invoke' }
      if ($e.GetCachedPropertyValue($A::IsTogglePatternAvailableProperty)) {
        $ts = $e.GetCachedPropertyValue([System.Windows.Automation.TogglePattern]::ToggleStateProperty)
        $pats += $(if ("$ts" -eq 'On') { 'on' } elseif ("$ts" -eq 'Off') { 'off' } else { 'toggle' })
      }
      if ($e.GetCachedPropertyValue($A::IsExpandCollapsePatternAvailableProperty)) {
        $es = $e.GetCachedPropertyValue([System.Windows.Automation.ExpandCollapsePattern]::ExpandCollapseStateProperty)
        if ("$es" -ne 'LeafNode') { $pats += $(if ("$es" -eq 'Expanded') { 'expanded' } else { 'collapsed' }) }
      }
      if ($e.GetCachedPropertyValue($A::IsSelectionItemPatternAvailableProperty)) {
        $pats += $(if ($e.GetCachedPropertyValue([System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty) -eq $true) { 'selected' } else { 'selectable' })
      }
      if ($e.GetCachedPropertyValue($A::IsScrollPatternAvailableProperty)) { $pats += 'scrollable' }
      if ($e.GetCachedPropertyValue($A::IsRangeValuePatternAvailableProperty)) { $pats += 'range' }
      $v = $null
      if ($e.GetCachedPropertyValue($A::IsValuePatternAvailableProperty)) {
        $pats += 'value'
        $vv = $e.GetCachedPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty)
        if ($vv -ne $NS -and $null -ne $vv) { $v = [string]$vv; if ($v.Length -gt 200) { $v = $v.Substring(0, 200) + '...' } }
      }
      $ct = $e.GetCachedPropertyValue($A::ControlTypeProperty)
      $n = [string]$e.GetCachedPropertyValue($A::NameProperty)
      if ($n.Length -gt 200) { $n = $n.Substring(0, 200) + '...' }
      [void]$out.Add([ordered]@{
        d = $d; p = $path
        t = ("$($ct.ProgrammaticName)" -replace '^ControlType\.', '')
        n = $n
        id = [string]$e.GetCachedPropertyValue($A::AutomationIdProperty)
        c = [string]$e.GetCachedPropertyValue($A::ClassNameProperty)
        r = (Rect $e.GetCachedPropertyValue($A::BoundingRectangleProperty))
        en = [bool]$e.GetCachedPropertyValue($A::IsEnabledProperty)
        off = [bool]$e.GetCachedPropertyValue($A::IsOffscreenProperty)
        foc = [bool]$e.GetCachedPropertyValue($A::HasKeyboardFocusProperty)
        kf = [bool]$e.GetCachedPropertyValue($A::IsKeyboardFocusableProperty)
        pat = $pats
        v = $v
        rid = @($e.GetCachedPropertyValue($A::RuntimeIdProperty))
      })
      if ($d -lt $maxDepth) {
        $i = 0
        foreach ($ch in $e.CachedChildren) { Walk $ch ($d + 1) "$path/$i"; $i++ }
      }
    }
    Walk $c 0 ''
    Out-Json ([ordered]@{ root = (Rect $c.GetCachedPropertyValue($A::BoundingRectangleProperty)); items = $out; truncated = ($out.Count -ge $limit) })
  } else {
    $el = $null
    if ($req.rid) {
      $cond = New-Object System.Windows.Automation.PropertyCondition($A::RuntimeIdProperty, [int[]]$req.rid)
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $cond)
    }
    if (-not $el -and $null -ne $req.path) {
      $w = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $el = $root
      foreach ($s in ($req.path -split '/' | Where-Object { $_ -ne '' })) {
        $ch = $w.GetFirstChild($el)
        for ($k = 0; $k -lt [int]$s -and $ch; $k++) { $ch = $w.GetNextSibling($ch) }
        $el = $ch
        if (-not $el) { break }
      }
    }
    if (-not $el) { throw 'element not found (the UI changed); list the elements again' }
    function Pat($pat) { $o = $null; if ($el.TryGetCurrentPattern($pat, [ref]$o)) { return $o } return $null }
    $used = $req.action
    switch ($req.action) {
      'click' {
        $p = Pat ([System.Windows.Automation.InvokePattern]::Pattern)
        if ($p) { $p.Invoke(); $used = 'invoke'; break }
        $p = Pat ([System.Windows.Automation.TogglePattern]::Pattern)
        if ($p) { $p.Toggle(); $used = 'toggle'; break }
        $p = Pat ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($p) { $p.Select(); $used = 'select'; break }
        $p = Pat ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($p) {
          if ("$($p.Current.ExpandCollapseState)" -eq 'Expanded') { $p.Collapse(); $used = 'collapse' } else { $p.Expand(); $used = 'expand' }
          break
        }
        $used = 'mouse'
      }
      'invoke' { $p = Pat ([System.Windows.Automation.InvokePattern]::Pattern); if (-not $p) { throw 'the element does not support Invoke' }; $p.Invoke() }
      'toggle' { $p = Pat ([System.Windows.Automation.TogglePattern]::Pattern); if (-not $p) { throw 'the element does not support Toggle' }; $p.Toggle() }
      'select' { $p = Pat ([System.Windows.Automation.SelectionItemPattern]::Pattern); if (-not $p) { throw 'the element does not support selection' }; $p.Select() }
      'expand' { $p = Pat ([System.Windows.Automation.ExpandCollapsePattern]::Pattern); if (-not $p) { throw 'the element cannot expand' }; $p.Expand() }
      'collapse' { $p = Pat ([System.Windows.Automation.ExpandCollapsePattern]::Pattern); if (-not $p) { throw 'the element cannot collapse' }; $p.Collapse() }
      'scroll_into_view' { $p = Pat ([System.Windows.Automation.ScrollItemPattern]::Pattern); if (-not $p) { throw 'the element does not support ScrollIntoView' }; $p.ScrollIntoView() }
      'focus' { $el.SetFocus() }
      'set_text' {
        $p = Pat ([System.Windows.Automation.ValuePattern]::Pattern)
        if ($p -and -not $p.Current.IsReadOnly) { $p.SetValue([string]$req.value); $used = 'value' }
        else { try { $el.SetFocus() } catch {}; $used = 'focus' }
      }
      default { throw "unknown action $($req.action)" }
    }
    $r = $null
    try { $r = Rect $el.Current.BoundingRectangle } catch {}
    Out-Json ([ordered]@{ used = $used; rect = $r })
  }
} catch {
  Out-Json @{ error = $_.Exception.Message }
}
`;
function uiaCommand(req) {
  const json2 = JSON.stringify(req).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  const script = UIA_SCRIPT.replace("'__REQ__'", `'${json2.replace(/'/g, "''")}'`);
  return Buffer.from(script, "utf16le").toString("base64");
}
var arr = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
async function runUia(env, req, signal) {
  const r2 = await env.exec(
    {
      argv: [
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        uiaCommand(req)
      ]
    },
    { signal, timeoutMs: 6e4, maxBytes: 32 * 1024 * 1024 }
  );
  const text2 = r2.stdout.toString("utf8").trim();
  const start = text2.indexOf("{");
  if (start < 0) {
    throw new EnvError(
      "EIO",
      `UI Automation failed: ${(r2.stderr.toString("utf8") || text2 || `exit ${r2.code}`).slice(0, 500)}`
    );
  }
  const value = JSON.parse(text2.slice(start));
  if (value.error) throw new EnvError("EIO", `UI Automation: ${value.error}`);
  return value;
}
function uiaMapper(root, win) {
  if (!root || root[2] <= 0 || root[3] <= 0) return ([x, y, w, h]) => ({ x, y, width: w, height: h });
  const sx = win.width / root[2];
  const sy = win.height / root[3];
  if (Math.abs(sx - 1) < 0.1 && Math.abs(sy - 1) < 0.1) return ([x, y, w, h]) => ({ x, y, width: w, height: h });
  return ([x, y, w, h]) => ({
    x: Math.round(win.x + (x - root[0]) * sx),
    y: Math.round(win.y + (y - root[1]) * sy),
    width: Math.round(w * sx),
    height: Math.round(h * sy)
  });
}
var INTERACTIVE_TYPES = /* @__PURE__ */ new Set([
  "Button",
  "CheckBox",
  "ComboBox",
  "Edit",
  "Hyperlink",
  "ListItem",
  "MenuItem",
  "RadioButton",
  "Slider",
  "SplitButton",
  "Spinner",
  "TabItem",
  "TreeItem",
  "DataItem",
  "Document",
  "ScrollBar",
  "Thumb"
]);
async function listUia(env, win, opts = {}) {
  const filter = opts.filter ?? "default";
  const res = await runUia(
    env,
    { op: "list", hwnd: win.hwnd, depth: opts.depth ?? 40, limit: 3e3, raw: false },
    opts.signal
  );
  const map = uiaMapper(res.root, win);
  const query = opts.query?.toLowerCase();
  const out = [];
  const limit = opts.limit ?? 300;
  const names = /* @__PURE__ */ new Map();
  for (const it of arr(res.items)) {
    if (!it.r) continue;
    const pats = arr(it.pat);
    const interactive = pats.length > 0 || it.kf && INTERACTIVE_TYPES.has(it.t);
    if (interactive && it.n) names.set(it.p, it.n.trim());
    if (filter !== "all" && it.off) continue;
    if (filter === "interactive" && !interactive) continue;
    if (filter === "default" && !interactive && !it.n.trim()) continue;
    if (filter !== "all" && !interactive && names.get(it.p.slice(0, it.p.lastIndexOf("/"))) === it.n.trim()) continue;
    if (query && !`${it.n}
${it.id}
${it.v ?? ""}
${it.t}`.toLowerCase().includes(query)) continue;
    if (out.length >= limit) break;
    const flags = [...pats];
    if (it.foc) flags.push("focused");
    if (!it.en) flags.push("disabled");
    if (it.off) flags.push("offscreen");
    out.push({
      index: out.length,
      depth: filter === "all" ? it.d : 0,
      role: it.t || "Custom",
      text: it.n.trim() || void 0,
      id: it.id || void 0,
      value: it.v ?? void 0,
      bounds: map(it.r),
      flags,
      ref: { runtimeId: arr(it.rid), path: it.p, hwnd: win.hwnd }
    });
  }
  return { elements: out, truncated: res.truncated };
}
async function actUia(env, el, action, value, signal) {
  if (!el.ref?.hwnd) throw new EnvError("EINVAL", "this element has no UI Automation reference");
  const res = await runUia(
    env,
    {
      op: "act",
      hwnd: el.ref.hwnd,
      rid: el.ref.runtimeId ?? null,
      path: el.ref.path ?? null,
      action,
      value: value ?? ""
    },
    signal
  );
  return { used: res.used };
}

// packages/plugin/src/tools/lease/ui-tools.ts
var sleep2 = (ms) => new Promise((r2) => setTimeout(r2, ms));
var ANDROID_ACTIONS = ["list", "click", "long_press", "set_text", "scroll"];
var WINDOWS_ACTIONS = [
  "list",
  "click",
  "double_click",
  "right_click",
  "set_text",
  "focus",
  "toggle",
  "expand",
  "collapse",
  "select",
  "scroll_into_view",
  "scroll"
];
function addUiTools({ ctx, env, alias: a, label: name2, add }, session) {
  const android = env instanceof AdbEnvironment ? env : void 0;
  const uia = !android && env.hasCap("uia") && env.hasCap("windows");
  if (!android && !uia) return;
  const list = async (o, signal) => {
    if (android) {
      const xml = await android.uiDump({ signal });
      if (o.raw) return { header: "", elements: [], raw: xml };
      const screen = await android.screenSize({ signal });
      const elements2 = parseUiautomator(xml, { filter: o.filter, query: o.query, screen });
      session.elements = elements2;
      const fg = dumpPackage(xml);
      return { header: `Foreground package: ${fg ?? "?"}.`, elements: elements2 };
    }
    const win = await resolveWindow(env, o.window, signal);
    if (win.minimized)
      throw new EnvError("EINVAL", `window ${JSON.stringify(win.title)} is minimized; restore it first`);
    const { elements, truncated } = await listUia(env, win, { filter: o.filter, query: o.query, signal });
    session.elements = elements;
    return {
      header: `Window hwnd=${win.hwnd} ${JSON.stringify(win.title)} (${win.process}).${truncated ? " The tree was truncated; narrow it with query." : ""}`,
      elements,
      window: win
    };
  };
  const target = async (args, signal) => {
    if (args.element !== void 0) return session.element(args.element);
    if (!args.match)
      throw new EnvError("EINVAL", "give element (index from the latest listing) or match (text to find)");
    const { elements } = await list({ filter: "default", query: args.match, window: args.window }, signal);
    const needle = args.match.toLowerCase();
    const exact = elements.find((e) => [e.text, e.desc, e.id].some((v) => v?.toLowerCase() === needle));
    const found = exact ?? elements[0];
    if (!found) throw new EnvError("ENOENT", `no element matches ${JSON.stringify(args.match)}`);
    return found;
  };
  const run = (acts, signal) => env.input(acts, { signal });
  const actions = android ? ANDROID_ACTIONS : WINDOWS_ACTIONS;
  add({
    name: "ui",
    description: android ? `List the on-screen UI elements of ${name2} (Android accessibility tree via uiautomator) or act on one. "list" returns lines like '[3] Button "OK" #ok_button @(540,1200) 200x96 [clickable]': index, class, text/description, resource id, centre and size in the latest screenshot's pixels, and flags. Act with action click / long_press / set_text (focus, clear and type text) / scroll (direction) on element: N, or match: "text" to find the element by text, description or resource id. Prefer this over guessing coordinates from screenshots; element indexes are also accepted by ${a}__input.` : `List the UI Automation elements of a window on ${name2} (default: the foreground window) or act on one. "list" returns lines like '[3] Button "Save" #saveBtn @(512,300) 90x32 [invoke]': index, control type, name, automation id, centre and size in the latest screenshot's pixels, and supported patterns/states. click uses the Invoke/Toggle/Select pattern when available (works even if covered) and otherwise clicks the centre; set_text sets the value directly (or focuses and types); also double_click, right_click, focus, toggle, expand, collapse, select, scroll_into_view, scroll (direction). Target with element: N from the latest listing or match: "text". Apps without UI Automation support (some games, custom-drawn or old Win32/WinForms apps) show few elements; use screenshots there.`,
    parameters: {
      action: { type: "string", enum: actions, description: "Default list." },
      element: { type: "integer", description: "Element index from the latest listing." },
      match: {
        type: "string",
        description: "Find the target by text / description / id (case-insensitive substring)."
      },
      text: { type: "string", description: "set_text: the new text." },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "scroll: content direction to reveal."
      },
      amount: {
        type: "number",
        description: "scroll: how far (default 5 \u2248 half a screen on Android, 5 wheel notches on Windows)."
      },
      filter: {
        type: "string",
        enum: ["default", "interactive", "all"],
        description: "list: default = interactive or labelled elements; interactive = actionable only; all = every node (indented by depth)."
      },
      query: { type: "string", description: "list: only elements whose text/description/id contains this." },
      ...uia ? {
        window: {
          type: "string",
          description: "Window title substring, process name or hwnd (default foreground)."
        }
      } : {},
      ...android ? { raw: { type: "boolean", description: "list: return the raw uiautomator XML." } } : {},
      screenshot: { type: "boolean", description: "After an action, return a fresh screenshot." }
    },
    output: IMAGE_OUTPUT,
    timeoutMs: 12e4,
    async execute(args, exec2) {
      const signal = exec2.signal;
      const action = args.action ?? "list";
      const windowSel = "window" in args && typeof args.window === "string" ? args.window : void 0;
      if (action === "list") {
        const raw = "raw" in args && args.raw === true;
        const res = await list({ filter: args.filter, query: args.query, window: windowSel, raw }, signal);
        if (res.raw !== void 0) return { text: clip(res.raw) };
        const frame = await session.ensureFrame(signal);
        const lines = res.elements.map((e) => formatElement(e, frame));
        return {
          text: clip(
            `${res.header} ${res.elements.length} element${res.elements.length === 1 ? "" : "s"}; coordinates are pixels of the latest screenshot (${frame.width}x${frame.height}).
${lines.join("\n") || "(no matching elements)"}`
          )
        };
      }
      const el = await target({ element: args.element, match: args.match, window: windowSel }, signal);
      const c = center(el.bounds);
      let note = "";
      if (android) {
        switch (action) {
          case "click":
            await run([{ kind: "tap", x: c.x, y: c.y }], signal);
            break;
          case "long_press":
            await run([{ kind: "long_press", x: c.x, y: c.y }], signal);
            break;
          case "set_text": {
            await run([{ kind: "tap", x: c.x, y: c.y }], signal);
            await sleep2(300);
            const sdk = android.android?.sdk ?? 0;
            const clear = sdk >= 33 ? `${keyCommand("ctrl+a")}; input keyevent 67` : `input keyevent 123; ${keyCommand("del", { repeat: Math.min(200, (el.text?.length ?? 0) + 5) })}`;
            if (el.text || sdk < 33) await android.check(clear, { signal });
            await android.typeText(args.text ?? "", { signal });
            break;
          }
          case "scroll":
            await run([scrollAction(el, args.direction, args.amount ?? 5)], signal);
            break;
          default:
            throw new EnvError("EINVAL", `unsupported action ${action}`);
        }
      } else {
        const focusWin = async () => {
          if (el.ref?.hwnd) await env.windowAction(el.ref.hwnd, "focus", void 0, { signal }).catch(() => void 0);
        };
        switch (action) {
          case "click": {
            const { used } = await actUia(env, el, "click", void 0, signal);
            if (used === "mouse") {
              await focusWin();
              await run([{ kind: "click", x: c.x, y: c.y }], signal);
            }
            note = used === "mouse" ? "clicked the centre with the mouse" : `used the ${used} pattern`;
            break;
          }
          case "double_click":
          case "right_click":
            await focusWin();
            await run(
              [
                action === "double_click" ? { kind: "click", x: c.x, y: c.y, count: 2 } : { kind: "click", x: c.x, y: c.y, button: "right" }
              ],
              signal
            );
            break;
          case "set_text": {
            const { used } = await actUia(env, el, "set_text", args.text ?? "", signal);
            if (used !== "value") {
              await focusWin();
              await run(
                [
                  { kind: "click", x: c.x, y: c.y },
                  { kind: "key", key: "ctrl+a" },
                  { kind: "type", text: args.text ?? "" }
                ],
                signal
              );
              note = "no settable value: clicked, selected all and typed";
            } else note = "set via the Value pattern";
            break;
          }
          case "scroll":
            await run([scrollAction(el, args.direction, args.amount ?? 5, true)], signal);
            break;
          default: {
            const { used } = await actUia(env, el, action, void 0, signal);
            note = `used ${used}`;
          }
        }
      }
      const done = `${action} on [${el.index}] ${el.role}${el.text ? ` ${JSON.stringify(el.text)}` : ""}${note ? ` (${note})` : ""}. Element indexes may be stale now; list again before using them.`;
      if (!args.screenshot) return { text: done };
      await sleep2(500);
      return screenshotValue(ctx, exec2, session, a, await followUpShot(session, signal), done);
    }
  });
}
function scrollAction(el, direction, amount, wheel = false) {
  const c = center(el.bounds);
  const n = Math.max(0.5, Math.min(20, amount));
  const dir = direction ?? "down";
  if (wheel) {
    return {
      kind: "scroll",
      x: Math.round(c.x),
      y: Math.round(c.y),
      dy: dir === "down" ? n : dir === "up" ? -n : 0,
      dx: dir === "right" ? n : dir === "left" ? -n : 0
    };
  }
  const vertical = dir === "up" || dir === "down";
  const span = (vertical ? el.bounds.height : el.bounds.width) * Math.min(0.8, n * 0.16);
  const sign = dir === "down" || dir === "right" ? 1 : -1;
  const from = vertical ? { x: c.x, y: c.y + sign * span / 2 } : { x: c.x + sign * span / 2, y: c.y };
  const to = vertical ? { x: c.x, y: c.y - sign * span / 2 } : { x: c.x - sign * span / 2, y: c.y };
  return {
    kind: "swipe",
    x: Math.round(from.x),
    y: Math.round(from.y),
    x2: Math.round(to.x),
    y2: Math.round(to.y),
    durationMs: 450
  };
}

// packages/plugin/src/tools/lease/windows-tools.ts
function addWindowTools({ env, alias: a, label: name2, add }, session) {
  if (!env.hasCap("windows")) return;
  add({
    name: "windows",
    description: `List the top-level windows of ${name2} (z-order, topmost first, with handle, title, process and position in the latest screenshot's pixels) or focus / minimize / maximize / restore / close / move one. Select the window by title substring, process name (e.g. "notepad") or hwnd. close asks the window to close (like clicking X; it may show a save prompt). Use ${a}__screenshot window=... to capture a single window.`,
    parameters: {
      action: {
        type: "string",
        enum: ["list", "focus", "minimize", "maximize", "restore", "close", "move"],
        description: "Default list."
      },
      window: { type: "string", description: "Title substring, process name or hwnd (default: foreground window)." },
      all: { type: "boolean", description: "list: include hidden, untitled and tool windows." },
      x: { type: "number", description: "move: new left edge (screenshot coordinates)." },
      y: { type: "number" },
      width: { type: "number" },
      height: { type: "number" }
    },
    output: TEXT_OUTPUT,
    async execute(args, exec2) {
      const signal = exec2.signal;
      const action = args.action ?? "list";
      if (action === "list") {
        const list = await env.windows({ signal, all: !!args.all });
        const frame = session.frame;
        return `${list.length} window${list.length === 1 ? "" : "s"}${frame ? " (positions in the latest screenshot pixels)" : " (physical pixels; take a screenshot to switch to its coordinates)"}:
` + list.map((w2) => formatWindow(w2, frame)).join("\n");
      }
      const w = await resolveWindow(env, args.window, signal);
      let rect;
      if (action === "move") {
        const { x, y, width, height } = args;
        if (x === void 0 || y === void 0 || width === void 0 || height === void 0)
          throw new EnvError("EINVAL", "move needs x, y, width and height");
        rect = rectToPhysical(await session.ensureFrame(signal), { x, y, width, height });
      }
      const r2 = await env.windowAction(w.hwnd, action, rect, { signal });
      if (session.window?.hwnd === w.hwnd && action === "close") session.window = void 0;
      const state = action === "focus" && !r2.foreground ? " \u2014 Windows refused to bring it to the front" : "";
      return `${action} ${JSON.stringify(w.title)} (hwnd=${w.hwnd}): ${r2.ok ? "done" : "failed"}${state}${r2.foreground ? "; it is now the foreground window" : ""}.`;
    }
  });
}

// packages/plugin/src/tools/lease/index.ts
function leaseTools({ ctx, defineTool, lease, alias, workspaceOf }) {
  const headless = [];
  const gui = [];
  const t = createLeaseToolContext(ctx, defineTool, lease, workspaceOf, headless, alias);
  addFileTools(t);
  const processes = addProcessTools(t);
  addTunnelTool(t);
  if (t.env instanceof AdbEnvironment) addAndroidTools(t, t.env);
  const g = createLeaseToolContext(ctx, defineTool, lease, workspaceOf, gui, alias);
  const screen = new ScreenSession(g.env);
  addScreenTools(g, screen);
  addUiTools(g, screen);
  addWindowTools(g, screen);
  if (g.env instanceof AdbEnvironment) addAndroidGuiTools(g, g.env);
  const dispose = async () => {
    for (const mp of processes.values()) await mp.proc.kill().catch(() => {
    });
    processes.clear();
  };
  return { headless, gui, dispose, processes };
}

// packages/plugin/src/borrowing/index.ts
function sessionOf(exec2) {
  const agent = agentOf(exec2);
  if (!agent) throw new Error("environment tools need an agent session");
  return { agent, sessionId: sessionIdOf(agent), cwd: agent.session.header.cwd };
}
function describeEnv(env) {
  const i = env.info;
  return `${i?.os ?? "?"}${i?.arch ? `/${i.arch}` : ""}${i?.version ? `, ${i.version}` : ""}; user ${i?.user || "?"}; cwd ${i?.cwd || "?"}; shell ${i?.shell || "?"}`;
}
function installBorrowing(ctx, manager, deps, hooks) {
  const { defineTool, createScope } = deps;
  const held = /* @__PURE__ */ new WeakMap();
  const liveAgents = /* @__PURE__ */ new Set();
  const warn = (message) => {
    try {
      ctx.logger("environments").warn(message);
    } catch {
    }
  };
  const heldOf = (agent) => {
    let m = held.get(agent);
    if (!m) {
      const entries = /* @__PURE__ */ new Map();
      m = entries;
      held.set(agent, entries);
      liveAgents.add(agent);
      agent.ctx.effect(
        () => () => {
          liveAgents.delete(agent);
          for (const entry of entries.values()) entry.release("session closed").catch(() => {
          });
          entries.clear();
        },
        "environments: borrowed leases"
      );
    }
    return m;
  };
  const persistHeld = (sessionId, agent) => {
    const own = [...held.get(agent)?.values() ?? []].filter((e) => !e.attached);
    manager.setSessionSettings(sessionId, {
      held: own.length > 0 ? own.map((e) => ({ envId: e.lease.envId, alias: e.alias, ...e.gui ? { gui: true } : {} })) : void 0
    });
  };
  const workspaceOf = async (exec2, sourceAlias, filePath) => {
    const { agent, cwd } = sessionOf(exec2);
    if (sourceAlias && sourceAlias !== "workspace") {
      const entry = heldOf(agent).get(sourceAlias);
      if (!entry) throw new Error(`no borrowed environment with alias "${sourceAlias}"`);
      return { env: entry.lease.env, cwd: entry.lease.env.info?.cwd };
    }
    const mount = hooks.mountOf(agent);
    if (mount) return { env: mount.env, cwd: mount.map.remoteRoot };
    const host = new HostEnvironment(cwd);
    return { env: host, cwd, hostPath: filePath ? host.resolvePath(filePath, cwd) : void 0 };
  };
  const location = async (exec2, spec) => {
    const { agent } = sessionOf(exec2);
    const m = /^([A-Za-z][A-Za-z0-9_]*):(.*)$/.exec(spec);
    const alias = m?.[1];
    if (m && alias && !/^[A-Za-z]$/.test(alias)) {
      const rest = m[2] || ".";
      if (alias === "workspace") {
        const w2 = await workspaceOf(exec2);
        return { ...w2, path: w2.env.resolvePath(rest, w2.cwd), label: "workspace" };
      }
      const entry = heldOf(agent).get(alias);
      if (!entry) {
        throw new Error(
          `"${alias}" is not a borrowed environment of this session (borrowed: ${[...heldOf(agent).keys()].join(", ") || "none"})`
        );
      }
      const env = entry.lease.env;
      return { env, cwd: env.info?.cwd, path: env.resolvePath(rest, env.info?.cwd), label: alias };
    }
    const w = await workspaceOf(exec2);
    return { ...w, path: w.env.resolvePath(spec, w.cwd), label: "workspace" };
  };
  const freeAlias = (m, base) => {
    let alias = base;
    for (let i = 2; m.has(alias); i++) alias = `${base}_${i}`;
    return alias;
  };
  const makeEntry = (agent, lease, alias, attached) => {
    const m = heldOf(agent);
    const sessionId = sessionIdOf(agent);
    const built = leaseTools({ ctx, defineTool, lease, alias, workspaceOf });
    let headlessScope;
    let guiScope;
    const register = (list) => {
      const scope = createScope(ctx, agent);
      try {
        for (const t of list) scope.ctx.tools.register(t);
      } catch (e) {
        void scope.dispose();
        throw e;
      }
      return scope;
    };
    const toolNames = () => [
      ...attached ? [] : built.headless.map((t) => t.name),
      ...entry.gui ? built.gui.map((t) => t.name) : []
    ];
    const dropGui = async () => {
      const scope = guiScope;
      guiScope = void 0;
      entry.gui = false;
      entry.tools = toolNames();
      await scope?.dispose().catch(() => {
      });
      await manager.setGui(lease, sessionId, false);
    };
    let releasing;
    const entry = {
      lease,
      alias,
      attached,
      gui: false,
      tools: [],
      async setGui(on, { wait, timeoutMs, signal }) {
        if (on === entry.gui) return;
        if (!on) {
          await dropGui();
          return;
        }
        await manager.setGui(lease, sessionId, true, { wait, timeoutMs, signal });
        if (releasing) {
          await manager.setGui(lease, sessionId, false);
          throw new Error(`${lease.def.name} was returned meanwhile`);
        }
        try {
          guiScope = register(built.gui);
        } catch (e) {
          await manager.setGui(lease, sessionId, false);
          throw e;
        }
        entry.gui = true;
        entry.tools = toolNames();
      },
      release: (why) => releasing ??= (async () => {
        if (m.get(alias) === entry) m.delete(alias);
        await built.dispose().catch(() => {
        });
        await dropGui().catch(() => {
        });
        await headlessScope?.dispose().catch(() => {
        });
        if (!attached) await lease.release(why);
        persistHeld(sessionId, agent);
        if (attached && why === "returned") manager.setSessionSettings(sessionId, { mountGui: false });
      })()
    };
    if (!attached) {
      headlessScope = register(built.headless);
      entry.tools = toolNames();
    }
    lease.once("release", (why) => {
      if (m.get(alias) === entry) void entry.release(why);
    });
    return entry;
  };
  const borrow = async (agent, envId, {
    gui,
    guiFallback = false,
    wait,
    timeoutMs,
    signal,
    reason
  }) => {
    const m = heldOf(agent);
    const sessionId = sessionIdOf(agent);
    const def = manager.require(envId);
    const lease = await manager.acquire(def.id, {
      owner: { sessionId, title: hooks.titleOf?.(sessionId) ?? sessionId, reason },
      purpose: "borrow",
      // A GUI lease is taken in one step (it queues as one request); with a fallback the GUI is
      // tried separately so a busy GUI still yields a headless lease.
      mode: gui && !guiFallback ? "gui" : "headless",
      wait,
      timeoutMs,
      signal
    });
    const alias = freeAlias(m, aliasFor(def.id));
    let entry;
    try {
      entry = makeEntry(agent, lease, alias, false);
    } catch (e) {
      await lease.release("registration failed");
      throw e;
    }
    m.set(alias, entry);
    let guiError;
    if (gui) {
      try {
        await entry.setGui(true, { wait: false });
      } catch (e) {
        if (!guiFallback) {
          await entry.release("registration failed");
          throw e;
        }
        guiError = errorMessage(e);
      }
    }
    persistHeld(sessionId, agent);
    return { entry, guiError };
  };
  const attachMount = async (agent, lease, opts) => {
    const m = heldOf(agent);
    const sessionId = sessionIdOf(agent);
    const entry = makeEntry(agent, lease, freeAlias(m, lease.alias), true);
    await entry.setGui(true, opts);
    if (lease.released) {
      await entry.release("mount lost");
      throw new Error(`the mount of ${lease.def.name} was lost`);
    }
    m.set(entry.alias, entry);
    manager.setSessionSettings(sessionId, { mountGui: true });
    return entry;
  };
  hooks.mountEvents?.on("mounted", (agent, record) => {
    const sessionId = sessionIdOf(agent);
    const saved = manager.sessionSettings(sessionId).mountGui;
    const wanted = saved ?? (!record.parent && manager.mountModeOf(record.lease.def) === "gui");
    if (!wanted) return;
    attachMount(agent, record.lease, { wait: false }).catch(
      (e) => warn(`mount of ${sessionId} stays headless: ${errorMessage(e)}`)
    );
  });
  hooks.mountEvents?.on("unmounted", (agent, record) => {
    for (const e of [...held.get(agent)?.values() ?? []]) {
      if (e.attached && e.lease === record.lease) void e.release("unmounted");
    }
  });
  const allowedFor = (sessionId, cwd) => manager.borrowableFor(sessionId, cwd);
  const matches = (d, name2) => d.id === name2 || d.name === name2 || aliasFor(d.id) === name2;
  const modeText = (e) => e.gui ? "GUI" : "headless";
  const borrowablePrompt = (agent) => {
    try {
      const { defs } = allowedFor(sessionIdOf(agent), agent.session.header.cwd);
      if (defs.length === 0) return "";
      return [
        "Environments this session may borrow (env_list shows their live status; borrow one with env_borrow, give it back with env_return):",
        ...defs.map((d) => `- ${definitionLabel(d)}`)
      ].join("\n");
    } catch (e) {
      warn(`could not list the borrowable environments for the prompt: ${errorMessage(e)}`);
      return "";
    }
  };
  ctx.on("agent/created", ({ agent }) => {
    const scope = createScope(ctx, agent);
    try {
      scope.ctx.systemPrompt.section({
        name: "environments:borrowable",
        order: promptSectionOrder(scope.ctx) + 1,
        interpolate: false,
        text: () => borrowablePrompt(agent)
      });
    } catch (e) {
      void scope.dispose();
      warn(`could not add the borrowable environments to the prompt: ${errorMessage(e)}`);
      return;
    }
    agent.ctx.effect(() => () => void scope.dispose(), "environments: borrowable prompt");
  });
  ctx.tools.register(
    defineTool({
      name: "env_list",
      description: "List the environments (devices/machines) this session may borrow, their status (including who holds their GUI), and the ones it currently holds.",
      parameters: {},
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(_args, exec2) {
        const { agent, sessionId, cwd } = sessionOf(exec2);
        await manager.refreshDiscovery();
        const { defs, source } = allowedFor(sessionId, cwd);
        const mine = heldOf(agent);
        const mount = hooks.mountOf(agent);
        const lines = defs.map((d) => {
          const st = manager.status(d);
          const holding = [...mine.values()].find((e) => e.lease.envId === d.id && !e.attached);
          const who = (h) => h.title ?? h.sessionId;
          const parts = [];
          if (holding) parts.push(`held by you as "${holding.alias}" (${modeText(holding)})`);
          else if (mount?.envId === d.id) parts.push("your mount");
          else if (st.busy)
            parts.push(
              `busy (exclusive; ${st.holders.map(who).join(", ")}${st.queue.length ? `; ${st.queue.length} waiting` : ""})`
            );
          else parts.push(st.holders.length ? `available headless (${st.holders.length} in use)` : "available");
          if (st.gui && !holding?.gui)
            parts.push(`GUI held by ${st.gui.title ?? st.gui.sessionId ?? "another session"}`);
          const guiQueue = st.queue.filter((q2) => q2.mode === "gui").length;
          if (guiQueue && !st.busy) parts.push(`${guiQueue} waiting for the GUI`);
          if (!st.headlessParallel && !st.busy && !holding) parts.push("exclusive");
          return `- ${definitionLabel(d)} \u2014 ${parts.join("; ")}`;
        });
        const attached = mount ? [...mine.values()].find((e) => e.attached && e.lease === mount.lease) : void 0;
        return [
          mount ? `This session is mounted on ${mount.env.name} (${mount.map.remoteRoot}${mount.parent ? ", shared with the parent session" : ""}); your normal file and shell tools already act there. ${attached ? `You hold its GUI (tools "${attached.alias}__*").` : `The mount is headless; env_borrow { environment: "${mount.envId}", gui: true } takes its GUI.`}` : void 0,
          `Borrowable environments (${source === "all" ? "all configured" : `${source} list`}):`,
          lines.join("\n") || "(none \u2014 the user can allow environments in the Environments panel)",
          mine.size ? `
Held now: ${[...mine.values()].map((e) => `${e.alias} \u2192 ${e.lease.def.name} (${e.attached ? "GUI of your mount" : modeText(e)})`).join(", ")}` : ""
        ].filter((x) => x !== void 0).join("\n");
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "env_borrow",
      description: [
        'Borrow an environment (e.g. an Android device, a test machine, a Windows test account). On success a set of tools prefixed with the environment alias (e.g. "<alias>__exec", "<alias>__read_file", "<alias>__install_apk") becomes available from your next step. Return it with env_return when done.',
        "A lease is headless by default: files, commands, processes, tunnels and non-screen tools (install_apk, app, logcat). Headless leases of other sessions may run at the same time, unless the environment is exclusive.",
        'Pass gui: true only when you need to see or drive the screen: it adds "<alias>__screenshot", "<alias>__input", "<alias>__ui", "<alias>__windows" / "<alias>__device" (as the environment supports). Only one session at a time holds the GUI of an environment; with wait: true you queue for it.',
        "Calling env_borrow again on an environment you hold (or your mounted environment) with gui: true upgrades it to GUI; gui: false gives the GUI back but keeps the lease."
      ].join(" "),
      parameters: {
        environment: { type: "string", required: true, description: "Environment id from env_list." },
        gui: {
          type: "boolean",
          description: "Also take the GUI (screen tools). Default false. On an environment you already hold: true upgrades, false downgrades, omitted keeps the mode."
        },
        wait: {
          type: "boolean",
          description: "If it (or its GUI) is busy, wait in line instead of failing immediately (default false)."
        },
        timeout_seconds: { type: "number", description: "Maximum time to wait when wait=true (default 600)." },
        reason: { type: "string", description: 'Short note shown to other sessions and the user, e.g. "e2e tests".' }
      },
      output: TEXT_OUTPUT,
      async execute(args, exec2) {
        const { agent, sessionId, cwd } = sessionOf(exec2);
        await manager.refreshDiscovery();
        const m = heldOf(agent);
        const mount = hooks.mountOf(agent);
        const waitArgs = {
          wait: !!args.wait,
          timeoutMs: Math.max(1, Math.min(24 * 3600, args.timeout_seconds ?? 600)) * 1e3,
          signal: exec2.signal
        };
        const { defs } = allowedFor(sessionId, cwd);
        const mountDef = mount ? manager.get(mount.envId) : void 0;
        const def = defs.find((d) => d.id === args.environment) ?? (mountDef && matches(mountDef, args.environment) ? mountDef : void 0) ?? defs.find((d) => matches(d, args.environment)) ?? [...m.values()].map((e) => e.lease.def).find((d) => matches(d, args.environment));
        if (!def) {
          const known = manager.get(args.environment);
          throw new Error(
            known ? `${known.name} is not in this session's borrowable list; ask the user to allow it` : `unknown environment "${args.environment}"; call env_list`
          );
        }
        const gui = args.gui;
        const existing = [...m.values()].find((e) => e.lease.envId === def.id && !e.attached);
        if (existing) {
          if (gui === true && !existing.gui) {
            await existing.setGui(true, waitArgs);
            persistHeld(sessionId, agent);
            return `Took the GUI of ${def.name} ("${existing.alias}"). Tools now: ${existing.tools.join(", ")}.`;
          }
          if (gui === false && existing.gui) {
            await existing.setGui(false, waitArgs);
            persistHeld(sessionId, agent);
            return `Gave back the GUI of ${def.name}; "${existing.alias}" stays borrowed headless. Tools now: ${existing.tools.join(", ")}.`;
          }
          return `You already hold ${def.name} as "${existing.alias}" (${modeText(existing)}). Tools: ${existing.tools.join(", ")}.`;
        }
        if (mount && mount.envId === def.id) {
          const attached = [...m.values()].find((e) => e.attached && e.lease === mount.lease);
          if (gui === true) {
            if (attached)
              return `You already hold the GUI of your mount ${def.name}. Tools: ${attached.tools.join(", ")}.`;
            const entry2 = await attachMount(agent, mount.lease, waitArgs);
            return `Took the GUI of your mounted environment ${def.name}. New tools: ${entry2.tools.join(", ") || "(none: the environment has no screen tools)"}. env_return "${entry2.alias}" gives the GUI back; the mount stays.`;
          }
          if (gui === false && attached) {
            await attached.release("returned");
            return `Gave back the GUI of ${def.name}; the session stays mounted on it.`;
          }
          return `This session is mounted on ${def.name}; your file and shell tools already act there${attached ? " and you hold its GUI" : ""}. ${attached ? "" : "Pass gui: true to take its GUI (screen tools)."}`.trim();
        }
        const { entry, guiError } = await borrow(agent, def.id, { ...waitArgs, gui: !!gui, reason: args.reason });
        const env = entry.lease.env;
        return [
          `Borrowed ${def.name} as "${entry.alias}" (${modeText(entry)}; ${describeEnv(env)}).`,
          guiError ? `The GUI could not be taken: ${guiError}` : void 0,
          `New tools: ${entry.tools.join(", ")}.`,
          !entry.gui && (env.hasCap("screenshot") || env.kind === "adb") ? "Screen tools need the GUI: env_borrow again with gui: true." : void 0,
          `Copy files between this session's workspace and the environment with env_transfer (e.g. source "app/build/outputs/apk/debug/app-debug.apk", destination "${entry.alias}:/data/local/tmp/app.apk").`,
          "Call env_return when you are done so others can use it."
        ].filter((x) => x !== void 0).join("\n");
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "env_return",
      description: "Return a borrowed environment. Its tools disappear and every process and tunnel opened through it is closed. With gui_only: true only the GUI is given back (the screen tools disappear, the lease stays headless). For your mounted environment this gives back its GUI; the mount itself stays.",
      parameters: {
        environment: {
          type: "string",
          required: true,
          description: 'Alias or id of the borrowed environment, or "all".'
        },
        gui_only: {
          type: "boolean",
          description: "Only give back the GUI and keep the headless lease (default false)."
        }
      },
      output: TEXT_OUTPUT,
      async execute(args, exec2) {
        const { agent, sessionId } = sessionOf(exec2);
        const m = heldOf(agent);
        const targets = args.environment === "all" ? [...m.values()] : [...m.values()].filter((e) => e.alias === args.environment || e.lease.envId === args.environment);
        if (targets.length === 0) {
          const mount = hooks.mountOf(agent);
          if (mount && (mount.envId === args.environment || mount.lease.alias === args.environment)) {
            throw new Error(
              `${mount.env.name} is this session's mount and cannot be returned; you do not hold its GUI either`
            );
          }
          throw new Error(`nothing borrowed as "${args.environment}" (borrowed: ${[...m.keys()].join(", ") || "none"})`);
        }
        const out = [];
        for (const e of targets) {
          if (e.attached) {
            await e.release("returned");
            out.push(`gave back the GUI of ${e.lease.def.name} (still mounted)`);
          } else if (args.gui_only) {
            if (e.gui) {
              await e.setGui(false, { wait: false });
              out.push(`gave back the GUI of ${e.lease.def.name} ("${e.alias}" stays headless)`);
            } else out.push(`${e.lease.def.name} holds no GUI`);
          } else {
            await e.release("returned");
            out.push(`returned ${e.lease.def.name}`);
          }
        }
        persistHeld(sessionId, agent);
        return `${out.join("; ")}.`.replace(/^./, (c) => c.toUpperCase());
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "env_transfer",
      description: `Copy a file or directory between this session's workspace and borrowed environments, or between two borrowed environments. Locations are "alias:/path" for a borrowed environment, or a plain path (or "workspace:path") for the session workspace.`,
      parameters: {
        source: {
          type: "string",
          required: true,
          description: 'Source location, e.g. "build/app.apk" or "pixel:/sdcard/Download/log.txt".'
        },
        destination: {
          type: "string",
          required: true,
          description: "Destination location (full target path, not just the directory)."
        },
        overwrite: { type: "boolean", description: "Replace existing files." }
      },
      output: TEXT_OUTPUT,
      timeoutMs: 60 * 60 * 1e3,
      async execute(args, exec2) {
        const src = await location(exec2, args.source);
        const dst = await location(exec2, args.destination);
        let target = dst.path;
        const dstStat = await dst.env.stat(target).catch(() => null);
        const srcStat = await src.env.stat(src.path);
        if (!srcStat) throw new Error(`source not found: ${args.source}`);
        if (dstStat?.type === "dir" && srcStat.type === "file")
          target = dst.env.path.join(target, src.env.path.basename(src.path));
        const started = Date.now();
        const r2 = await copyBetween(src.env, src.path, dst.env, target, {
          overwrite: !!args.overwrite,
          signal: exec2.signal
        });
        return `Copied ${r2.files} file${r2.files === 1 ? "" : "s"} (${formatSize(r2.bytes)}) from ${src.label}:${src.path} to ${dst.label}:${target} in ${((Date.now() - started) / 1e3).toFixed(1)}s.`;
      }
    })
  );
  ctx.on("agent/created", ({ agent }) => {
    const sessionId = sessionIdOf(agent);
    const settings = manager.sessionSettings(sessionId);
    if (!Array.isArray(settings.held) || settings.held.length === 0) return;
    for (const h of settings.held) {
      borrow(agent, h.envId, { wait: false, gui: !!h.gui, guiFallback: true }).then(
        ({ guiError }) => {
          if (guiError) warn(`re-borrowed ${h.envId} headless: ${guiError}`);
        },
        (e) => {
          warn(`could not re-borrow ${h.envId}: ${errorMessage(e)}`);
          persistHeld(sessionId, agent);
        }
      );
    }
  });
  return {
    heldOf: (agent) => [...held.get(agent)?.values() ?? []],
    async releaseLease(leaseId) {
      for (const agent of liveAgents) {
        for (const e of held.get(agent)?.values() ?? []) {
          if (e.lease.id === leaseId && !e.attached) {
            await e.release("released by the user");
            return true;
          }
        }
      }
      const lease = manager.leases.get(leaseId);
      if (lease) {
        await lease.release("released by the user");
        return true;
      }
      return false;
    }
  };
}

// packages/plugin/src/deps.ts
async function importRuntime(spec) {
  return await import(spec);
}
async function optionalImport(spec) {
  try {
    return await importRuntime(spec);
  } catch {
    return void 0;
  }
}
function pluginExport(mod, named) {
  return mod["default"] ?? mod[named];
}
async function loadDeps() {
  const [tools, scope, fsMod, subprocess, bashLocal, pwshLocal, toolBash, toolPwsh, toolFs, skills] = await Promise.all(
    [
      import("@deepseek-ai/dsh-tools"),
      import("@deepseek-ai/dsh-scope"),
      import("@deepseek-ai/dsh-fs"),
      import("@deepseek-ai/dsh-subprocess"),
      importRuntime("@deepseek-ai/dsh-bash-local"),
      importRuntime("@deepseek-ai/dsh-pwsh-local"),
      importRuntime("@deepseek-ai/dsh-tool-bash"),
      importRuntime("@deepseek-ai/dsh-tool-pwsh"),
      importRuntime("@deepseek-ai/dsh-tool-fs"),
      optionalImport("@deepseek-ai/dsh-skill-filesystem")
    ]
  );
  const createScope = scope.createScope;
  return {
    defineTool: tools.defineTool,
    createScope: (ctx, key) => createScope(asCordisContext(ctx), key),
    FileSystem: fsMod.FileSystem,
    FsError: fsMod.FsError,
    SubprocessRuntime: subprocess.SubprocessRuntime,
    SubprocessExecutableNotFoundError: subprocess.SubprocessExecutableNotFoundError,
    BashLocal: pluginExport(bashLocal, "LocalBashExecutor"),
    PwshLocal: pluginExport(pwshLocal, "PwshLocalExecutor"),
    // Tool plugins are the module namespaces themselves (name/apply exports).
    ToolBash: toolBash,
    ToolPwsh: toolPwsh,
    ToolFs: toolFs,
    SkillFilesystem: skills
  };
}

// packages/plugin/src/manager/manager.ts
import crypto7 from "node:crypto";
import { EventEmitter as EventEmitter7 } from "node:events";
import fs10 from "node:fs";
import os9 from "node:os";
import path13 from "node:path";

// packages/plugin/src/env/ssh/connection.ts
import fs8 from "node:fs";
import os8 from "node:os";
import path11 from "node:path";
import ssh2 from "ssh2";

// packages/plugin/src/env/ssh/ssh-config.ts
import { execFile, spawn as spawn4 } from "node:child_process";
import os7 from "node:os";
import { Duplex } from "node:stream";
import { promisify } from "node:util";
function expandHome(p) {
  return p.replace(/^~(?=$|[\\/])/, os7.homedir());
}
function parseSshG(text2) {
  const values = /* @__PURE__ */ new Map();
  const identityFiles = [];
  for (const line of text2.split(/\r?\n/)) {
    const match = /^(\S+)\s+(.*\S)/.exec(line.trim());
    if (!match) continue;
    const key = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? "";
    if (key === "identityfile") identityFiles.push(expandHome(value));
    else if (value !== "none" && !values.has(key)) values.set(key, value);
  }
  const host = values.get("hostname");
  if (!host) return void 0;
  const proxyJump = values.get("proxyjump");
  const proxyCommand = values.get("proxycommand");
  return {
    host,
    port: Number(values.get("port") ?? 22),
    user: values.get("user") ?? os7.userInfo().username,
    identityFiles,
    ...proxyJump ? { proxyJump } : {},
    ...proxyCommand ? { proxyCommand } : {}
  };
}
async function resolveSshTarget(host, signal) {
  try {
    const { stdout } = await promisify(execFile)("ssh", ["-G", "--", host], {
      timeout: 1e4,
      windowsHide: true,
      ...signal ? { signal } : {}
    });
    return parseSshG(stdout);
  } catch {
    return void 0;
  }
}
function expandProxyTokens(command, dest) {
  const values = {
    "%": "%",
    h: dest.host,
    n: dest.alias,
    p: String(dest.port),
    r: dest.user
  };
  return command.replace(/%([%hnpr])/g, (_, token) => values[token] ?? "");
}
function proxyJumpArgs(proxyJump, dest) {
  const hops = proxyJump.split(",").map((hop2) => hop2.trim());
  const last = hops.pop() ?? "";
  const args = ["-o", "BatchMode=yes", "-W", `${dest.host}:${dest.port}`];
  if (hops.length > 0) args.push("-J", hops.join(","));
  const hop = /^(?:(.+)@)?(?:\[([^\]]+)\]|([^:@]+))(?::(\d+))?$/.exec(last);
  if (!hop || last.startsWith("ssh://")) return [...args, last];
  const [, user, bracketed, plain, port] = hop;
  if (user) args.push("-l", user);
  if (port) args.push("-p", port);
  args.push(bracketed ?? plain ?? last);
  return args;
}
function openProxy(target, dest) {
  let child;
  if (target.proxyCommand) {
    child = spawn4(expandProxyTokens(target.proxyCommand, dest), { shell: true, windowsHide: true });
  } else if (target.proxyJump) {
    child = spawn4("ssh", proxyJumpArgs(target.proxyJump, dest), { windowsHide: true });
  } else {
    return void 0;
  }
  const sock = Duplex.from({ readable: child.stdout, writable: child.stdin });
  let stderr = "";
  let spawnError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-4e3);
  });
  child.once("error", (e) => {
    spawnError = e.message;
  });
  const closed = new Promise((resolve) => {
    child.once("close", (code) => {
      sock.destroy();
      const lastLine = stderr.trim().split(/\r?\n/).pop();
      resolve(lastLine || spawnError || (code ? `proxy exited with code ${code}` : ""));
    });
  });
  return { sock, kill: () => child.kill(), closed };
}

// packages/plugin/src/env/ssh/connection.ts
var DEFAULT_KEY_FILES = ["id_ed25519", "id_ecdsa", "id_rsa"].map((name2) => path11.join(os8.homedir(), ".ssh", name2));
function sshConnectConfig(cfg, target) {
  const out = {
    host: target?.host ?? cfg.host,
    port: cfg.port ?? target?.port ?? 22,
    username: cfg.username ?? target?.user ?? os8.userInfo().username,
    readyTimeout: cfg.readyTimeoutMs ?? 2e4,
    keepaliveInterval: 15e3,
    keepaliveCountMax: 4
  };
  if (cfg.password) out.password = cfg.password;
  if (cfg.privateKeyPath) {
    out.privateKey = fs8.readFileSync(expandHome(cfg.privateKeyPath));
    if (cfg.passphrase) out.passphrase = cfg.passphrase;
  }
  if (!out.password && !out.privateKey) {
    if (process.platform === "win32") out.agent = "\\\\.\\pipe\\openssh-ssh-agent";
    else if (process.env["SSH_AUTH_SOCK"]) out.agent = process.env["SSH_AUTH_SOCK"];
    for (const p of target?.identityFiles ?? DEFAULT_KEY_FILES) {
      if (!out.privateKey && fs8.existsSync(p)) {
        try {
          out.privateKey = fs8.readFileSync(p);
        } catch {
        }
      }
    }
  }
  return out;
}
async function connectClient(cfg, signal) {
  const target = cfg.sshConfig === "off" ? void 0 : await resolveSshTarget(cfg.host, signal);
  if (signal?.aborted) throw new EnvError("CANCELLED", "aborted");
  let options;
  try {
    options = sshConnectConfig(cfg, target);
  } catch (e) {
    throw new EnvError("EINVAL", `ssh config: ${errorMessage(e)}`);
  }
  const proxy = target && openProxy(target, { alias: cfg.host, host: options.host, port: options.port, user: options.username });
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    const onAbort = () => {
      proxy?.kill();
      conn.end();
      reject(new EnvError("CANCELLED", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    conn.once("ready", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(conn);
    });
    conn.once("error", (e) => {
      signal?.removeEventListener("abort", onAbort);
      proxy?.kill();
      const code = e.level === "client-authentication" ? "AUTH" : "EIO";
      void (proxy?.closed ?? Promise.resolve("")).then((reason) => {
        reject(new EnvError(code, `ssh ${cfg.host}: ${e.message}${reason ? ` (${reason})` : ""}`));
      });
    });
    conn.once("close", () => proxy?.kill());
    try {
      conn.connect(proxy ? { ...options, sock: proxy.sock } : options);
    } catch (e) {
      proxy?.kill();
      reject(new EnvError("EINVAL", `ssh config: ${errorMessage(e)}`));
    }
  });
}
function execOnce(conn, command, { input, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(new EnvError("EIO", err.message));
        return;
      }
      const out = [];
      const errOut = [];
      let size = 0;
      stream.on("data", (d) => {
        size += d.length;
        if (size <= maxBytes) out.push(d);
      });
      stream.stderr.on("data", (d) => errOut.push(d));
      stream.on(
        "close",
        (code, signal) => resolve({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(errOut).toString() })
      );
      if (input !== void 0) stream.end(input);
      else stream.end();
    });
  });
}

// packages/plugin/src/env/ssh/provision.ts
import crypto5 from "node:crypto";
async function probeHost(conn) {
  const posix = await execOnce(conn, 'uname -sm; echo "$HOME"').catch(() => void 0);
  if (posix?.code === 0) {
    const [uname = "", home = ""] = posix.stdout.toString().split(/\r?\n/);
    const [sys = "", machine = ""] = uname.trim().split(/\s+/);
    if (sys && home.trim()) return { target: targetForHost(sys, machine), shell: "sh", home: home.trim(), sep: "/" };
  }
  const win = await execOnce(conn, 'cmd /c "echo %PROCESSOR_ARCHITECTURE% %USERPROFILE%"').catch(() => void 0);
  const line = win?.code === 0 ? win.stdout.toString().trim().split(/\r?\n/)[0] ?? "" : "";
  const m = /^(\S+)\s+(.+)$/.exec(line.trim());
  if (!m?.[1] || !m[2] || m[1].startsWith("%")) return void 0;
  const ps = await execOnce(conn, "echo $PSVersionTable.PSEdition").catch(() => void 0);
  const shell = /^(Desktop|Core)\s*$/m.test(ps?.stdout.toString() ?? "") ? "powershell" : "cmd";
  return { target: targetForHost("windows", m[1]), shell, home: m[2].trim(), sep: "\\" };
}
function remoteCommand(shell, program, args) {
  switch (shell) {
    case "sh":
      return [program, ...args].map(shq).join(" ");
    case "powershell": {
      const q2 = (s) => `'${s.replace(/'/g, "''")}'`;
      return `& ${[program, ...args].map(q2).join(" ")}`;
    }
    case "cmd": {
      const q2 = (s) => /^[\w.:\\/=-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
      return [`"${program}"`, ...args.map(q2)].join(" ");
    }
  }
}
function openSftp(conn) {
  return new Promise((resolve, reject) => conn.sftp((e, s) => e ? reject(e) : resolve(s)));
}
var sftpCall = (fn) => new Promise((resolve, reject) => fn((err, r2) => err ? reject(err) : resolve(r2)));
async function sftpStat(sftp, p) {
  try {
    return await sftpCall((cb) => sftp.stat(p, cb));
  } catch {
    return void 0;
  }
}
async function privateDir(sftp, p, posix) {
  try {
    await sftpCall((cb) => sftp.mkdir(p, { mode: 448 }, (err) => cb(err, void 0)));
  } catch (e) {
    if (!(await sftpStat(sftp, p))?.isDirectory()) throw e;
  }
  if (posix) await sftpCall((cb) => sftp.chmod(p, 448, (err) => cb(err, void 0))).catch(() => {
  });
}
async function installBinary(conn, host, data) {
  const windows = host.target?.startsWith("win32-") ?? host.sep === "\\";
  const posix = host.sep === "/";
  const name2 = `dsh-env-server-${binaryHash(data)}${windows ? ".exe" : ""}`;
  const rel = `.dsh-env/bin/${name2}`;
  const abs = [host.home.replace(/[\\/]+$/, ""), ".dsh-env", "bin", name2].join(host.sep);
  const sftp = await openSftp(conn);
  try {
    const existing = await sftpStat(sftp, rel);
    if (existing?.isFile() && existing.size === data.length) return abs;
    await privateDir(sftp, ".dsh-env", posix);
    await privateDir(sftp, ".dsh-env/bin", posix);
    const tmp = `${rel}.${crypto5.randomBytes(6).toString("hex")}.part`;
    await new Promise((resolve, reject) => {
      const w = sftp.createWriteStream(tmp, { mode: 448 });
      w.on("close", () => resolve());
      w.on("error", reject);
      w.end(data);
    });
    try {
      if (posix) await sftpCall((cb) => sftp.chmod(tmp, 448, (err) => cb(err, void 0)));
      try {
        await sftpCall((cb) => sftp.ext_openssh_rename(tmp, rel, (err) => cb(err, void 0)));
      } catch {
        await sftpCall((cb) => sftp.rename(tmp, rel, (err) => cb(err, void 0)));
      }
    } catch (e) {
      await sftpCall((cb) => sftp.unlink(tmp, (err) => cb(err, void 0))).catch(() => {
      });
      const now = await sftpStat(sftp, rel);
      if (!(now?.isFile() && now.size === data.length))
        throw new EnvError("EIO", `could not install dsh-env-server: ${errorMessage(e)}`);
    }
    return abs;
  } finally {
    sftp.end();
  }
}
async function provisionServer(conn, host, signal) {
  const data = host.target ? serverBinaryBytes(host.target) : void 0;
  if (!data) return void 0;
  signal?.throwIfAborted();
  return installBinary(conn, host, data);
}
function exec(conn, command) {
  return new Promise(
    (resolve, reject) => conn.exec(command, (err, stream) => err ? reject(new EnvError("EIO", err.message)) : resolve(stream))
  );
}
function forwardOut(conn, port) {
  return new Promise(
    (resolve, reject) => conn.forwardOut("127.0.0.1", 0, "127.0.0.1", port, (err, ch) => err ? reject(err) : resolve(ch))
  );
}
function cutLifeline(stream) {
  try {
    stream.end();
  } catch {
  }
  setTimeout(() => {
    try {
      stream.close();
    } catch {
    }
  }, 2e3).unref();
}
async function serverOverForward(opts) {
  const { conn, id, name: name2, host, serverPath, cwd, signal } = opts;
  const secret = generateSecret();
  const args = [
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-stdin",
    "--lifeline",
    "--exit-idle",
    ...cwd ? ["--cwd", cwd] : []
  ];
  const stream = await exec(conn, remoteCommand(host.shell, serverPath, args));
  stream.write(`${secret}
`);
  let stderr = "";
  stream.stderr.on("data", (d) => {
    if (stderr.length < 4e3) stderr += d.toString();
  });
  const started = await new Promise((resolve, reject) => {
    let out = "";
    const done = (e, v) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stream.off("data", onData);
      stream.off("close", onClose);
      if (e) reject(e);
      else if (v) resolve(v);
    };
    const onData = (d) => {
      out += d.toString();
      const m = /DSH_ENV_SERVER listening=\S*:(\d+)/.exec(out);
      if (m?.[1]) {
        const pid = /DSH_ENV_SERVER pid=(\d+)/.exec(out)?.[1];
        done(void 0, { port: Number(m[1]), pid: pid ? Number(pid) : void 0 });
      }
    };
    const onClose = () => done(new EnvError("EIO", `dsh-env-server exited before listening${stderr ? `: ${stderr.trim()}` : ""}`));
    const onAbort = () => done(new EnvError("CANCELLED", "aborted"));
    const timer = setTimeout(() => done(new EnvError("ETIMEDOUT", "dsh-env-server did not start")), 2e4);
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.on("data", onData);
    stream.on("close", onClose);
  }).catch((e) => {
    cutLifeline(stream);
    throw e;
  });
  stream.on("data", () => {
  });
  let channel;
  try {
    channel = await forwardOut(conn, started.port);
  } catch {
    cutLifeline(stream);
    return void 0;
  }
  let transport;
  try {
    transport = await secureInitiate(channel, { secret, signal });
  } catch (e) {
    channel.destroy();
    cutLifeline(stream);
    throw e;
  }
  const env = new ServerEnvironment({
    id,
    name: name2,
    kind: "ssh",
    transport,
    onClose: () => {
      cutLifeline(stream);
      conn.end();
    }
  });
  stream.on("close", () => env.markClosed(new EnvError("CLOSED", "dsh-env-server exited")));
  env.serverPid = started.pid;
  env.transportMode = "ssh-forward";
  env.remoteEndpoint = `127.0.0.1:${started.port}`;
  try {
    return await env.open(signal);
  } catch (e) {
    env.client.close();
    cutLifeline(stream);
    throw e;
  }
}
async function serverOverExec(conn, command, { id, name: name2, signal }) {
  const stream = await exec(conn, command);
  stream.stderr.on("data", () => {
  });
  const env = new ServerEnvironment({ id, name: name2, kind: "ssh", transport: stream, onClose: () => void conn.end() });
  env.transportMode = "ssh-stdio";
  try {
    return await env.open(signal);
  } catch (e) {
    env.client.close();
    cutLifeline(stream);
    throw e;
  }
}

// packages/plugin/src/env/ssh/ssh-env.ts
import net5 from "node:net";

// packages/plugin/src/env/ssh/ssh-process.ts
var SshProcess = class {
  stream;
  pty;
  pid = void 0;
  stdin;
  stdout;
  stderr;
  exited;
  constructor(stream, pty) {
    this.stream = stream;
    this.pty = pty;
    this.stdin = stream;
    this.stdout = stream;
    this.stderr = stream.stderr;
    this.exited = new Promise((resolve) => {
      let exit;
      stream.on("exit", (code, signal) => {
        exit = { code: code ?? null, signal: signal ?? null };
      });
      stream.on("close", () => resolve(exit ?? { code: null, signal: "CLOSED" }));
    });
  }
  write(data) {
    return new Promise((resolve, reject) => this.stream.write(data, (e) => e ? reject(e) : resolve()));
  }
  end() {
    this.stream.end();
  }
  resize(rows, cols) {
    this.stream.setWindow(rows, cols, 0, 0);
    return Promise.resolve();
  }
  kill(signal = "KILL") {
    try {
      this.stream.signal(signal);
    } catch {
    }
    try {
      this.stream.close();
    } catch {
    }
    return Promise.resolve();
  }
};

// packages/plugin/src/env/ssh/walk-glob.ts
async function walkGlob(env, pattern, { cwd = "", limit = 1e3, hidden = false, signal } = {}) {
  const re = globToRegExp(pattern);
  const P = env.path;
  const paths = [];
  let truncated = false;
  let visited = 0;
  const walk = async (dir, rel) => {
    if (truncated || signal?.aborted) return;
    let entries;
    try {
      entries = await env.readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (!hidden && e.name.startsWith(".")) continue;
      if (e.name === "node_modules" || e.name === ".git") continue;
      const r2 = rel ? `${rel}/${e.name}` : e.name;
      if (re.test(r2)) {
        if (paths.length >= limit) {
          truncated = true;
          return;
        }
        paths.push(r2);
      }
      if (e.type === "dir" && ++visited < 2e4) await walk(P.join(dir, e.name), r2);
    }
  };
  await walk(cwd, "");
  return { paths, truncated, cwd };
}

// packages/plugin/src/env/ssh/ssh-env.ts
function sftpError(e, p) {
  const status = e?.code;
  const message = errorMessage(e);
  const code = status === 2 ? "ENOENT" : status === 3 ? "EACCES" : status === 4 && /exist/i.test(message) ? "EEXIST" : "EIO";
  return new EnvError(code, `${p}: ${message}`);
}
function modeType(mode) {
  const t = mode & 61440;
  return t === 16384 ? "dir" : t === 32768 ? "file" : t === 40960 ? "symlink" : "other";
}
var SshEnvironment = class extends Environment {
  conn;
  config;
  sftpHandle;
  constructor({ id, name: name2, conn, config }) {
    super({ id, name: name2, kind: "ssh" });
    this.conn = conn;
    this.config = config;
    conn.on("close", () => this.markClosed(new EnvError("CLOSED", "ssh connection closed")));
    conn.on("error", () => {
    });
  }
  get sftp() {
    if (!this.sftpHandle) throw new EnvError("CLOSED", "sftp session is not open");
    return this.sftpHandle;
  }
  async open() {
    this.sftpHandle = await new Promise(
      (resolve, reject) => this.conn.sftp((e, s) => e ? reject(new EnvError("EIO", `sftp: ${e.message}`)) : resolve(s))
    );
    const probe = await execOnce(this.conn, 'uname -s; uname -m; echo "$HOME"; pwd; echo "$SHELL"; id -un; hostname');
    const lines = probe.stdout.toString().split(/\r?\n/);
    const windows = probe.code !== 0 || !/^(Linux|Darwin|FreeBSD|OpenBSD|NetBSD|SunOS|CYGWIN|MINGW|MSYS)/i.test(lines[0] ?? "");
    if (windows) {
      const home = (await this.realpathSftp(".").catch(() => "C:/Users")).replace(/^\/([A-Za-z]:)/, "$1");
      this.info = {
        os: "windows",
        family: "windows",
        arch: "",
        hostname: this.config.host,
        user: this.config.username ?? "",
        home,
        cwd: this.config.cwd ?? home,
        pathSep: "\\",
        shell: "cmd.exe",
        caps: ["fs", "proc", "pty", "tcp", "tcp-listen"],
        version: "ssh"
      };
    } else {
      const [uname = "", arch = "", home = "", pwd, shell, user = "", host] = lines;
      this.info = {
        os: /darwin/i.test(uname) ? "macos" : uname.toLowerCase(),
        family: "posix",
        arch,
        hostname: host || this.config.host,
        user,
        home,
        cwd: this.config.cwd ?? pwd ?? home,
        pathSep: "/",
        shell: shell || "/bin/sh",
        caps: ["fs", "glob", "grep", "proc", "pty", "tcp", "tcp-listen"],
        version: "ssh"
      };
    }
    return this;
  }
  /** OpenSSH for Windows expects /C:/path; posix paths pass through. */
  sftpPath(p) {
    if (this.family === "windows" && /^[A-Za-z]:/.test(p)) return `/${p.replace(/\\/g, "/")}`;
    return p;
  }
  realpathSftp(p) {
    return new Promise((resolve, reject) => this.sftp.realpath(p, (e, r2) => e ? reject(sftpError(e, p)) : resolve(r2)));
  }
  /** Promisify one SFTP call; rejects with the raw SFTP error. */
  sftpCall(fn) {
    return new Promise((resolve, reject) => fn((e, r2) => e ? reject(e) : resolve(r2)));
  }
  /** Promisify one result-less SFTP call; rejects with the raw SFTP error. */
  sftpDo(fn) {
    return new Promise((resolve, reject) => fn((e) => e ? reject(e) : resolve()));
  }
  async stat(p, opts = {}) {
    try {
      const target = this.sftpPath(p);
      const s = await this.sftpCall(
        (cb) => opts.follow === false ? this.sftp.lstat(target, cb) : this.sftp.stat(target, cb)
      );
      return { type: modeType(s.mode), size: s.size, mtimeMs: s.mtime * 1e3, mode: s.mode & 4095 };
    } catch (e) {
      if (e?.code === 2) return null;
      throw sftpError(e, p);
    }
  }
  async readdir(p) {
    let list;
    try {
      list = await this.sftpCall(
        (cb) => this.sftp.readdir(this.sftpPath(p), cb)
      );
    } catch (e) {
      throw sftpError(e, p);
    }
    return list.filter((e) => e.filename !== "." && e.filename !== "..").map((e) => ({ name: e.filename, type: modeType(e.attrs.mode), size: e.attrs.size, mtimeMs: e.attrs.mtime * 1e3 })).sort(byName);
  }
  async readFile(p, opts = {}) {
    const st = await this.stat(p);
    if (!st) throw new EnvError("ENOENT", `no such file: ${p}`);
    if (st.type === "dir") throw new EnvError("EISDIR", `is a directory: ${p}`);
    const start = opts.offset ?? 0;
    const end = opts.length !== void 0 ? Math.min(st.size, start + opts.length) : st.size;
    const max = opts.maxBytes ?? opts.max ?? 256 * 1024 * 1024;
    if (end - start > max) throw new EnvError("ETOOBIG", `${p} is ${st.size} bytes (limit ${max})`);
    if (end <= start) return Buffer.alloc(0);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const s = this.sftp.createReadStream(this.sftpPath(p), { start, end: end - 1 });
      s.on("data", (d) => chunks.push(d));
      s.on("end", resolve);
      s.on("error", (e) => reject(sftpError(e, p)));
    });
    return Buffer.concat(chunks);
  }
  async writeFile(p, data, opts = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const P = this.path;
    if (opts.mkdirs) await this.mkdir(P.dirname(p), { recursive: true });
    const mode = opts.mode ?? "overwrite";
    if (mode === "create" && await this.stat(p)) throw new EnvError("EEXIST", `already exists: ${p}`);
    const write = (target, flags) => new Promise((resolve, reject) => {
      const s = this.sftp.createWriteStream(this.sftpPath(target), { flags });
      s.on("close", resolve);
      s.on("error", (e) => reject(sftpError(e, target)));
      s.end(buf);
    });
    if (mode === "append") {
      await write(p, "a");
    } else if (opts.atomic === false) {
      await write(p, "w");
    } else {
      const tmp = P.join(P.dirname(p), `.${P.basename(p)}.dsh-tmp-${Date.now().toString(16)}`);
      await write(tmp, "w");
      try {
        await this.renameReplace(tmp, p);
      } catch (e) {
        await this.sftpDo((cb) => this.sftp.unlink(this.sftpPath(tmp), cb)).catch(() => {
        });
        throw e;
      }
    }
    return this.stat(p);
  }
  /** Rename, replacing an existing target (posix-rename extension when available). */
  async renameReplace(from, to) {
    const src = this.sftpPath(from);
    const dst = this.sftpPath(to);
    try {
      if (typeof this.sftp.ext_openssh_rename === "function") {
        await this.sftpDo((cb) => this.sftp.ext_openssh_rename(src, dst, cb));
        return;
      }
    } catch {
    }
    try {
      await this.sftpDo((cb) => this.sftp.rename(src, dst, cb));
    } catch (e) {
      if (await this.stat(to)) {
        await this.sftpDo((cb) => this.sftp.unlink(dst, cb));
        await this.sftpDo((cb) => this.sftp.rename(src, dst, cb));
      } else throw sftpError(e, to);
    }
  }
  async mkdir(p, opts = {}) {
    if (opts.recursive) {
      const st = await this.stat(p);
      if (st?.type === "dir") return;
      const parent = this.path.dirname(p);
      if (parent !== p) await this.mkdir(parent, { recursive: true });
    }
    try {
      await this.sftpDo((cb) => this.sftp.mkdir(this.sftpPath(p), cb));
    } catch (e) {
      if (opts.recursive && (await this.stat(p))?.type === "dir") return;
      throw sftpError(e, p);
    }
  }
  async remove(p, opts = {}) {
    const st = await this.stat(p, { follow: false });
    if (!st) throw new EnvError("ENOENT", `no such file: ${p}`);
    if (st.type === "dir") {
      if (opts.recursive) {
        for (const e of await this.readdir(p)) await this.remove(this.path.join(p, e.name), { recursive: true });
      }
      await this.sftpDo((cb) => this.sftp.rmdir(this.sftpPath(p), cb)).catch((e) => {
        throw sftpError(e, p);
      });
    } else {
      await this.sftpDo((cb) => this.sftp.unlink(this.sftpPath(p), cb)).catch((e) => {
        throw sftpError(e, p);
      });
    }
  }
  async rename(from, to, opts = {}) {
    if (!opts.overwrite && await this.stat(to, { follow: false }))
      throw new EnvError("EEXIST", `already exists: ${to}`);
    await this.renameReplace(from, to);
  }
  async realpath(p) {
    const r2 = await this.realpathSftp(this.sftpPath(p));
    return this.family === "windows" ? r2.replace(/^\/([A-Za-z]:)/, "$1") : r2;
  }
  async glob(pattern, opts = {}) {
    const cwd = opts.cwd ?? this.info?.cwd ?? "";
    if (this.family === "windows") return walkGlob(this, pattern, { ...opts, cwd });
    const r2 = await execOnce(this.conn, findScript(cwd, { hidden: opts.hidden }));
    return { ...filterGlob(r2.stdout.toString(), pattern, opts.limit ?? 1e3), cwd };
  }
  async grep(pattern, opts = {}) {
    const cwd = opts.cwd ?? this.info?.cwd ?? "";
    if (this.family === "windows") {
      throw new EnvError(
        "UNSUPPORTED",
        "grep over plain SSH needs a POSIX host; install dsh-env-server on Windows hosts"
      );
    }
    const r2 = await execOnce(this.conn, grepScript(cwd, pattern, opts));
    return {
      ...parseGrep(r2.stdout.toString(), { filesOnly: opts.filesOnly, limit: opts.limit ?? 500, glob: opts.glob }),
      cwd
    };
  }
  async spawn(spec) {
    let command = spec.command ?? (spec.argv ?? []).map((a) => this.family === "windows" ? JSON.stringify(a) : shq(a)).join(" ");
    if (this.family === "posix") {
      const envPrefix = Object.entries(spec.env ?? {}).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
      if (envPrefix) command = `export ${envPrefix}; ${command}`;
      if (spec.cwd) command = `cd ${shq(spec.cwd)} && ${command}`;
    } else if (spec.cwd) {
      command = `cd /d "${spec.cwd}" && ${command}`;
    }
    const stream = await new Promise((resolve, reject) => {
      const opts = spec.pty ? { pty: { rows: spec.pty.rows ?? 24, cols: spec.pty.cols ?? 80, term: "xterm-256color" } } : {};
      this.conn.exec(command, opts, (err, s) => err ? reject(new EnvError("EIO", err.message)) : resolve(s));
    });
    return new SshProcess(stream, !!spec.pty);
  }
  async forward({
    localHost = "127.0.0.1",
    localPort = 0,
    remoteHost = "127.0.0.1",
    remotePort,
    proto = "tcp"
  }) {
    if (proto !== "tcp") throw new EnvError("UNSUPPORTED", "ssh forwards TCP only (install dsh-env-server for UDP)");
    const server = net5.createServer((socket) => {
      this.conn.forwardOut(
        socket.remoteAddress ?? "127.0.0.1",
        socket.remotePort ?? 0,
        remoteHost,
        remotePort,
        (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.pipe(stream).pipe(socket);
          stream.on("close", () => socket.destroy());
          socket.on("close", () => stream.close());
          socket.on("error", () => {
          });
        }
      );
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(localPort, localHost, resolve);
    });
    return this.trackTunnel({
      kind: "forward",
      proto,
      localHost,
      localPort: server.address().port,
      remoteHost,
      remotePort,
      close: () => new Promise((r2) => server.close(() => r2()))
    });
  }
  async reverse({
    remoteHost = "127.0.0.1",
    remotePort = 0,
    localHost = "127.0.0.1",
    localPort,
    proto = "tcp"
  }) {
    if (proto !== "tcp") throw new EnvError("UNSUPPORTED", "ssh reverse-forwards TCP only");
    const port = await new Promise(
      (resolve, reject) => this.conn.forwardIn(
        remoteHost,
        remotePort,
        (e, p) => e ? reject(new EnvError("EIO", `remote forward refused: ${e.message}`)) : resolve(p || remotePort)
      )
    );
    const onConn = (info, accept) => {
      if (info.destPort !== port) return;
      const stream = accept();
      const socket = net5.connect(localPort, localHost);
      socket.pipe(stream).pipe(socket);
      socket.on("error", () => stream.close());
      stream.on("close", () => socket.destroy());
    };
    this.conn.on("tcp connection", onConn);
    return this.trackTunnel({
      kind: "reverse",
      proto,
      remoteHost,
      remotePort: port,
      localHost,
      localPort,
      close: async () => {
        this.conn.off("tcp connection", onConn);
        await new Promise((r2) => this.conn.unforwardIn(remoteHost, port, () => r2()));
      }
    });
  }
  closeTransport() {
    try {
      this.sftpHandle?.end();
    } catch {
    }
    this.conn.end();
    return Promise.resolve();
  }
};

// packages/plugin/src/env/ssh/open.ts
async function openSsh({ id, name: name2, config, signal }) {
  const conn = await connectClient(config, signal);
  try {
    const host = await probeHost(conn);
    let serverPath = config.serverPath;
    if (!serverPath && config.install !== "off" && host) {
      serverPath = await provisionServer(conn, host, signal).catch(() => void 0);
    }
    if (serverPath && host) {
      let env2;
      try {
        if (config.transport !== "stdio") {
          env2 = await serverOverForward({ conn, id, name: name2, host, serverPath, cwd: config.cwd, signal });
        }
        env2 ??= await serverOverExec(
          conn,
          remoteCommand(host.shell, serverPath, ["stdio", ...config.cwd ? ["--cwd", config.cwd] : []]),
          { id, name: name2, signal }
        );
        const opened = env2;
        conn.on("close", () => opened.markClosed(new EnvError("CLOSED", "ssh connection closed")));
        env2.ssh = conn;
        env2.viaServer = true;
        return env2;
      } catch (e) {
        if (config.serverPath) throw e;
      }
    }
    const env = new SshEnvironment({ id, name: name2, conn, config });
    await env.open();
    return env;
  } catch (e) {
    conn.end();
    throw e;
  }
}

// packages/plugin/src/env/winuser/winuser-env.ts
import { spawn as spawn5 } from "node:child_process";
import crypto6 from "node:crypto";
import fs9 from "node:fs";
import net6 from "node:net";
import path12 from "node:path";
function sessionShellCommand(binary, port, token, cwd) {
  const quote = (s) => /\s/.test(s) ? `"${s}"` : s;
  return [
    quote(binary),
    "serve",
    "--listen",
    `127.0.0.1:${port}`,
    "--token",
    token,
    "--once",
    // Windows gives a console application started as the session's shell a console window: without
    // this it would sit on the account's desktop, in the way of everything the agent does.
    "--no-console",
    // Windows does not reliably end the session when its shell exits (it can sit at the logon
    // screen instead). A session left behind is worse than useless: the next logon reconnects to it
    // and the shell never runs again.
    "--end-session",
    "--cwd",
    quote(cwd ?? "~")
  ].join(" ");
}
function privateDesktopName(account) {
  const safe = account.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40);
  return `dsh-${safe || "account"}`;
}
function sha256(file) {
  return crypto6.createHash("sha256").update(fs9.readFileSync(file)).digest("hex");
}
function sharedBinary(binary, base = process.env["ProgramData"] ?? "C:\\ProgramData") {
  const src = serverBinary(binary);
  const dir = path12.join(base, "dsh-env");
  try {
    const hash = sha256(src);
    const dst = path12.join(dir, `dsh-env-server-${hash.slice(0, 16)}.exe`);
    fs9.mkdirSync(dir, { recursive: true });
    if (!fs9.existsSync(dst) || sha256(dst) !== hash) {
      const tmp = `${dst}.${process.pid}.tmp`;
      fs9.copyFileSync(src, tmp);
      fs9.renameSync(tmp, dst);
    }
    for (const f of fs9.readdirSync(dir)) {
      if (/^dsh-env-server.*\.exe$/i.test(f) && path12.join(dir, f) !== dst) {
        try {
          fs9.rmSync(path12.join(dir, f), { force: true });
        } catch {
        }
      }
    }
    return dst;
  } catch (e) {
    throw new EnvError(
      "EACCES",
      `cannot place the server binary where other accounts can run it (${dir}): ${errorMessage(e)}`
    );
  }
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net6.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}
function firstLine(child, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const out = [];
    const err = [];
    const finish = (fn) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.off("data", onData);
      child.off("close", onClose);
      fn();
    };
    const text2 = () => decodeHostText(Buffer.concat(out));
    const onData = (d) => {
      out.push(d);
      const s = text2();
      const nl = s.indexOf("\n");
      if (nl >= 0) finish(() => resolve(s.slice(0, nl).trim()));
    };
    const onClose = () => finish(() => resolve(text2().trim() || decodeHostText(Buffer.concat(err)).trim() || "launcher exited"));
    const onAbort = () => finish(() => reject(new EnvError("CANCELLED", "aborted")));
    const timer = setTimeout(
      () => finish(() => reject(new EnvError("ETIMEDOUT", "starting the account session timed out"))),
      timeoutMs
    );
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => err.push(d));
    child.on("close", onClose);
    child.once("error", (e) => finish(() => reject(new EnvError("EIO", e.message))));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function stopLauncher(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r2) => child.once("close", r2));
  child.stdin.end();
  const t = setTimeout(() => child.kill(), 3e3);
  await exited;
  clearTimeout(t);
}
function windowsAccountLaunchArgs({
  account,
  secretFile,
  binary,
  port,
  token,
  cwd,
  desktop = "shared"
}) {
  const desktopName = desktop === "private" ? privateDesktopName(account) : void 0;
  return [
    "winuser",
    "launch",
    "--name",
    account,
    "--secret-file",
    secretFile,
    "--supervise",
    ...cwd ? ["--cwd", cwd] : [],
    ...desktopName ? ["--desktop", desktopName] : [],
    "--",
    binary,
    "serve",
    "--listen",
    `127.0.0.1:${port}`,
    "--token",
    token,
    "--once",
    // Without a configured directory start in the account's own profile.
    "--cwd",
    cwd ?? "~"
  ];
}
var allowedAccounts = /* @__PURE__ */ new Map();
async function accountSidOf(account) {
  const accounts = await listWindowsAccounts().catch(() => []);
  const hit = accounts.find((a) => a.name.toLowerCase() === account.toLowerCase());
  return hit?.sid ?? null;
}
async function ensureAllowed(account, sid) {
  if (allowedAccounts.get(account) === sid) return;
  await runServerElevated(["session", "allow", "--account", account]);
  allowedAccounts.set(account, sid);
}
async function openAccountSession(base, account, secret, bin, port, token, cwd) {
  const status = await probeSession(base.signal);
  if (!status.ready) {
    throw new EnvError("UNSUPPORTED", `this machine cannot host a separate session yet: ${status.reasons.join("; ")}`);
  }
  const shell = sessionShellCommand(bin, port, token, cwd);
  const sid = await accountSidOf(account);
  if (sid !== null) await ensureAllowed(account, sid);
  const startClient = () => {
    const state = {
      child: spawn5(
        serverBinary(),
        [
          "winuser",
          "session",
          "--name",
          account,
          "--secret-file",
          secret,
          "--shell",
          shell,
          "--width",
          "1280",
          "--height",
          "800"
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
      ),
      connected: false,
      // The account is still logged on somewhere, so this logon would only rejoin that session.
      busy: false,
      log: ""
    };
    state.child.stdout.setEncoding("utf8");
    state.child.stdout.on("data", (chunk2) => {
      state.log += chunk2;
      if (chunk2.includes('"connected":true')) state.connected = true;
      if (chunk2.includes('"code":"session-busy"')) state.busy = true;
    });
    state.child.stderr.setEncoding("utf8");
    state.child.stderr.on("data", (chunk2) => {
      state.log += chunk2;
    });
    state.child.on("error", (e) => {
      state.log += errorMessage(e);
    });
    return state;
  };
  let session = startClient();
  let lastError;
  let endedStale = false;
  let reAllowed = false;
  for (let attempt = 0; attempt < 3 && !base.signal?.aborted; attempt++) {
    const deadline = Date.now() + 9e4;
    while (Date.now() < deadline) {
      if (base.signal?.aborted) break;
      try {
        const env = await openServer({
          id: base.id,
          name: base.name,
          kind: "winuser",
          host: "127.0.0.1",
          port,
          token,
          signal: base.signal,
          timeoutMs: 3e3,
          onClose: () => {
            session.child.kill();
          }
        });
        env.account = account;
        env.desktopName = `session:${account}`;
        return env;
      } catch (e) {
        lastError = e;
        if ((session.child.exitCode !== null || session.busy) && !session.connected) break;
        await new Promise((res) => setTimeout(res, 500));
      }
    }
    if (session.busy && !endedStale) {
      endedStale = true;
      session.child.kill();
      await runServerElevated(["session", "logoff", "--account", account]);
      session = startClient();
      continue;
    }
    if (!reAllowed && /access denied/i.test(session.log)) {
      const fresh = await accountSidOf(account);
      if (fresh !== null) {
        reAllowed = true;
        allowedAccounts.delete(account);
        session.child.kill();
        await ensureAllowed(account, fresh);
        session = startClient();
        continue;
      }
    }
    break;
  }
  session.child.kill();
  const detail = session.log.trim().split("\n").filter(Boolean).at(-1);
  const hint = /access denied/i.test(session.log) ? " (the account refused the logon during CredSSP: create it again from the Environments page, which resets its password and re-grants the Remote Desktop logon right)" : "";
  throw new EnvError(
    "ETIMEDOUT",
    `the session for ${account} did not come up${lastError === void 0 ? "" : `: ${errorMessage(lastError)}`}${detail ? ` (${detail})` : ""}${hint}`
  );
}
async function openWindowsAccount({
  id,
  name: name2,
  account,
  dataDir,
  cwd,
  desktop = "shared",
  signal
}) {
  if (process.platform !== "win32") throw new EnvError("UNSUPPORTED", "Windows accounts are only available on Windows");
  const secret = secretPath(dataDir, account);
  if (!fs9.existsSync(secret)) {
    throw new EnvError("ENOENT", `no stored credentials for account ${account}; recreate it from the Environments page`);
  }
  const bin = sharedBinary();
  const port = await freePort();
  const token = crypto6.randomBytes(24).toString("hex");
  if (desktop === "session") {
    return await openAccountSession({ id, name: name2, signal }, account, secret, bin, port, token, cwd);
  }
  const desktopName = desktop === "private" ? privateDesktopName(account) : void 0;
  const args = windowsAccountLaunchArgs({
    account,
    secretFile: secret,
    binary: bin,
    port,
    token,
    cwd,
    desktop
  });
  const launcher = spawn5(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  launcher.stdin.on("error", () => {
  });
  let launched;
  let line = "";
  try {
    line = await firstLine(launcher, 12e4, signal);
    launched = JSON.parse(line);
  } catch (e) {
    await stopLauncher(launcher);
    if (errorCode(e)) throw e;
  }
  if (!launched?.ok) {
    await stopLauncher(launcher);
    throw new EnvError("EIO", `could not start a session as ${account}: ${launched?.error ?? line}`);
  }
  const deadline = Date.now() + 3e4;
  let lastError;
  while (Date.now() < deadline && launcher.exitCode === null) {
    if (signal?.aborted) {
      await stopLauncher(launcher);
      throw new EnvError("CANCELLED", "aborted");
    }
    try {
      const env = await openServer({
        id,
        name: name2,
        kind: "winuser",
        host: "127.0.0.1",
        port,
        token,
        signal,
        timeoutMs: 3e3,
        onClose: () => stopLauncher(launcher)
      });
      env.account = account;
      env.desktopName = desktopName;
      env.serverPid = launched.pid;
      return env;
    } catch (e) {
      lastError = e;
      if (errorCode(e) === "AUTH") break;
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  await stopLauncher(launcher);
  throw new EnvError(
    errorCode(lastError) === "AUTH" ? "AUTH" : "ETIMEDOUT",
    `the server started as ${account} did not accept connections: ${lastError === void 0 ? "it exited" : errorMessage(lastError)}`
  );
}

// packages/plugin/src/manager/lease.ts
import { EventEmitter as EventEmitter6 } from "node:events";
var Lease = class extends EventEmitter6 {
  registry;
  id;
  def;
  env;
  owner;
  purpose;
  alias;
  createdAt = Date.now();
  /** Session ids using the GUI of this lease. */
  guiUsers = /* @__PURE__ */ new Set();
  released = false;
  constructor(registry, { id, def, env, owner, purpose, alias }) {
    super();
    this.registry = registry;
    this.id = id;
    this.def = def;
    this.env = env;
    this.owner = owner;
    this.purpose = purpose;
    this.alias = alias;
    env.once("close", () => void this.release("connection lost"));
  }
  get envId() {
    return this.def.id;
  }
  get mode() {
    return this.guiUsers.size > 0 ? "gui" : "headless";
  }
  /** Add or remove a GUI user (manager only: admission is checked there). */
  setGuiUser(user, on) {
    const before = this.mode;
    if (on) this.guiUsers.add(user);
    else this.guiUsers.delete(user);
    if (this.mode !== before) {
      this.emit("mode", this.mode);
      this.registry.onLeaseModeChanged(this);
    }
  }
  async release(reason = "returned") {
    if (this.released) return;
    this.released = true;
    this.registry.forgetLease(this);
    this.emit("release", reason);
    try {
      await this.env.close();
    } catch {
    }
    this.registry.onLeaseReleased(this);
  }
  describe() {
    return {
      id: this.id,
      envId: this.envId,
      alias: this.alias,
      purpose: this.purpose,
      owner: this.owner,
      createdAt: this.createdAt,
      tunnels: this.env.listTunnels(),
      mode: this.mode,
      guiUsers: [...this.guiUsers]
    };
  }
};

// packages/plugin/src/manager/state.ts
var STATE_VERSION = 2;
function emptyState() {
  return { version: STATE_VERSION, environments: [], workspaces: {}, sessions: {}, remoteWorkspaces: [] };
}

// packages/plugin/src/manager/manager.ts
var EnvironmentManager = class extends EventEmitter7 {
  dataDir;
  file;
  autoDiscoverAdb;
  adb;
  logger;
  state = emptyState();
  leases = /* @__PURE__ */ new Map();
  waiters = /* @__PURE__ */ new Map();
  claims = /* @__PURE__ */ new Map();
  discovered = { adb: [], adbError: void 0, at: 0 };
  browseConnections = /* @__PURE__ */ new Map();
  saveTimer;
  disposed = false;
  /** Listeners and connection pool for reverse environments. */
  reverse;
  reverseDefaults;
  /** Mount mode of environments without their own. */
  defaultMountMode;
  constructor({
    dataDir,
    autoDiscoverAdb = true,
    adb = "adb",
    logger,
    reverse = {},
    mountMode
  }) {
    super();
    this.dataDir = dataDir;
    this.file = path13.join(dataDir, "environments.json");
    this.autoDiscoverAdb = autoDiscoverAdb;
    this.adb = adb;
    this.logger = logger;
    this.reverseDefaults = reverse;
    this.defaultMountMode = isLeaseMode(mountMode) ? mountMode : "headless";
    this.reverse = new ReverseHub(
      (id) => {
        const def = this.state.environments.find((e) => e.id === id && e.kind === "reverse");
        return def?.config.token;
      },
      (msg) => this.logger?.info("environments: %s", msg)
    );
    this.reverse.on("change", () => this.emit("change"));
  }
  /** Listener settings in effect: saved from the GUI, else the plugin config. */
  reverseSettings() {
    return this.state.reverseListener ?? this.reverseDefaults;
  }
  /** Persist and apply new reverse listener settings. */
  async setReverseSettings(settings) {
    this.state.reverseListener = settings;
    this.save();
    await this.reverse.configure(settings);
  }
  /** Start the reverse listeners configured at load time. */
  async startReverse() {
    await this.reverse.configure(sanitizeReverseSettings(this.reverseSettings()));
  }
  /** Generate a new secret for a reverse environment, dropping its connections. Returns the secret. */
  rotateReverseSecret(id) {
    const def = this.state.environments.find((e) => e.id === id && e.kind === "reverse");
    if (!def) throw new EnvError("ENOENT", `unknown reverse environment ${id}`);
    def.config.token = generateSecret();
    this.save();
    this.reverse.disconnect(id);
    return def.config.token;
  }
  // ---------------------------------------------------------------- persistence
  load() {
    fs10.mkdirSync(this.dataDir, { recursive: true });
    try {
      const raw = JSON.parse(fs10.readFileSync(this.file, "utf8"));
      this.state = { ...this.state, ...raw };
    } catch {
    }
    this.state.environments ??= [];
    this.state.workspaces ??= {};
    this.state.sessions ??= {};
    this.state.remoteWorkspaces ??= [];
    dropRetiredSettings(this.state);
    if (migrateState(this.state)) this.save();
  }
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 50);
    this.saveTimer.unref();
    this.emit("change");
  }
  flush() {
    clearTimeout(this.saveTimer);
    try {
      fs10.mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs10.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs10.renameSync(tmp, this.file);
    } catch (e) {
      this.logger?.warn("environments: cannot save state: %s", errorMessage(e));
    }
  }
  // ---------------------------------------------------------------- definitions
  /**
   * The built-in `local` environment: a dsh-env-server child process on the harness host. It is
   * an environment like any other (borrowable, mountable); a session that is not mounted runs on
   * the host itself without it.
   */
  builtinLocal() {
    return {
      id: LOCAL_ID,
      name: "\u672C\u673A\uFF08\u72EC\u7ACB\u8FDB\u7A0B\uFF09",
      kind: "local",
      builtin: true,
      description: os9.hostname(),
      config: {},
      borrowable: true
    };
  }
  discoveredDefs() {
    if (!this.autoDiscoverAdb) return [];
    const configuredSerials = new Set(this.state.environments.filter((e) => e.kind === "adb").map((e) => e.config.serial));
    const taken = new Set(this.state.environments.map((e) => e.id));
    return this.discovered.adb.filter((d) => d.state === "device" && !configuredSerials.has(d.serial)).map((d) => {
      let id = `adb_${slug(d.model || d.serial)}`;
      if (taken.has(id)) id = `adb_${slug(d.serial)}`;
      taken.add(id);
      return {
        id,
        name: d.model ? `${d.model.replace(/_/g, " ")}${d.emulator ? " (AVD)" : ""}` : d.serial,
        kind: "adb",
        discovered: true,
        description: d.serial,
        config: { serial: d.serial },
        borrowable: true
      };
    });
  }
  definitions() {
    return [this.builtinLocal(), ...this.state.environments, ...this.discoveredDefs()];
  }
  get(id) {
    return this.definitions().find((d) => d.id === id);
  }
  /** Find a definition by id, name, alias or adb serial; throws ENOENT. */
  require(id) {
    const def = this.get(id) ?? this.definitions().find((d) => d.name === id || aliasFor(d.id) === id || d.config.serial === id);
    if (!def) throw new EnvError("ENOENT", `unknown environment "${id}"`);
    return def;
  }
  /** Like require(), but refreshes device discovery when the id is not known yet. */
  async resolve(id) {
    try {
      return this.require(id);
    } catch {
      await this.refreshDiscovery(true);
      return this.require(id);
    }
  }
  /** Persist a discovered device so references to it survive restarts and unplugging. */
  adopt(def) {
    if (!def.discovered) return def;
    const { discovered: _discovered, ...rest } = def;
    this.state.environments.push(rest);
    this.save();
    return rest;
  }
  /** Mode in which mounting occupies an environment. */
  mountModeOf(def) {
    return def.mountMode ?? this.defaultMountMode;
  }
  /** Public view: secrets are replaced by a marker. */
  publicDef(def) {
    const config = { ...def.config };
    for (const k of SECRET_FIELDS) if (config[k]) config[k] = SECRET_MARKER;
    return {
      ...def,
      config,
      alias: aliasFor(def.id),
      headlessParallel: isHeadlessParallel(def),
      effectiveMountMode: this.mountModeOf(def)
    };
  }
  upsert(input) {
    if (!isKind(input.kind)) throw new EnvError("EINVAL", `unknown kind ${input.kind}`);
    if (input.id === LOCAL_ID) throw new EnvError("EINVAL", "the local environment is built in");
    const name2 = String(input.name ?? "").trim() || (input.id ?? "");
    const id = input.id ? String(input.id) : aliasFor(name2);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/.test(id)) throw new EnvError("EINVAL", "id must be letters, digits, _ . -");
    const existing = this.state.environments.find((e) => e.id === id);
    const config = { ...input.config };
    for (const k of SECRET_FIELDS) {
      if (config[k] === SECRET_MARKER) config[k] = existing?.config[k];
      if (config[k] === "" || config[k] === void 0) delete config[k];
    }
    if (input.kind === "server" && !config["url"] && (!config["host"] || !config["port"]))
      throw new EnvError("EINVAL", "a URL, or host and port, is required");
    if (input.kind === "reverse") {
      delete config["host"];
      delete config["port"];
      config["token"] ??= generateSecret();
    }
    if (input.kind === "ssh" && !config["host"]) throw new EnvError("EINVAL", "host is required");
    if (input.kind === "adb" && !config["serial"]) throw new EnvError("EINVAL", "serial is required");
    if (input.kind === "winuser" && !config["account"]) throw new EnvError("EINVAL", "account is required");
    if (input.kind === "winuser") {
      const mode = config["desktop"];
      config["desktop"] = mode === "private" || mode === "session" ? mode : "shared";
    } else {
      delete config["desktop"];
    }
    if (config["port"] !== void 0) config["port"] = Number(config["port"]);
    const headlessParallel = input.headlessParallel === void 0 ? existing?.headlessParallel : input.headlessParallel === false ? false : void 0;
    const mountMode = input.mountMode === void 0 ? existing?.mountMode : isLeaseMode(input.mountMode) ? input.mountMode : void 0;
    const def = {
      id,
      name: name2,
      kind: input.kind,
      description: input.description ?? "",
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      borrowable: input.borrowable ?? true,
      ...headlessParallel === false ? { headlessParallel } : {},
      ...mountMode ? { mountMode } : {},
      // Field values come from the UI form; they are interpreted per kind when opening.
      config
    };
    if (existing) {
      delete existing.headlessParallel;
      delete existing.mountMode;
      Object.assign(existing, def);
    } else this.state.environments.push(def);
    this.save();
    return def;
  }
  remove(id) {
    this.reverse.disconnect(id);
    const before = this.state.environments.length;
    this.state.environments = this.state.environments.filter((e) => e.id !== id);
    if (this.state.environments.length === before) throw new EnvError("ENOENT", `unknown environment ${id}`);
    this.save();
  }
  async refreshDiscovery(force = false) {
    if (!this.autoDiscoverAdb) return this.discovered;
    if (!force && Date.now() - this.discovered.at < 5e3) return this.discovered;
    try {
      this.discovered = { adb: await listAdbDevices(this.adb), adbError: void 0, at: Date.now() };
    } catch (e) {
      this.discovered = { adb: [], adbError: errorMessage(e), at: Date.now() };
    }
    return this.discovered;
  }
  // ---------------------------------------------------------------- connections
  /** Open a fresh connection to an environment. */
  open = async (def, { signal } = {}) => {
    const base = { id: def.id, name: def.name, signal };
    const c = def.config;
    switch (def.kind) {
      case "local":
        return openLocal({ ...base, cwd: c.cwd || os9.homedir() });
      case "server":
        return c.url ? openServer({ ...base, url: c.url, token: c.token }) : openServer({ ...base, host: c.host ?? "", port: Number(c.port), token: c.token });
      case "reverse": {
        const transport = await this.reverse.take(def.id, { signal });
        const env = new ServerEnvironment({ id: def.id, name: def.name, kind: "reverse", transport });
        try {
          return await env.open(signal);
        } catch (e) {
          transport.destroy?.();
          throw e;
        }
      }
      case "ssh":
        return openSsh({ ...base, config: { ...c, host: c.host ?? "" } });
      case "adb": {
        const env = new AdbEnvironment({ id: def.id, name: def.name, serial: c.serial, adb: c.adb || this.adb });
        return env.open();
      }
      case "winuser":
        return openWindowsAccount({
          ...base,
          account: c.account ?? "",
          dataDir: this.dataDir,
          cwd: c.cwd,
          desktop: c.desktop === "private" || c.desktop === "session" ? c.desktop : "shared"
        });
      default:
        throw new EnvError("EINVAL", `unknown environment kind ${String(def.kind)}`);
    }
  };
  /** A cached connection for UI browsing (not a lease). Closed after idle time. */
  async browse(id, fn) {
    const def = this.require(id);
    let entry = this.browseConnections.get(id);
    if (!entry || entry.env?.closed) {
      const fresh = { promise: this.open(def), refs: 0 };
      entry = fresh;
      this.browseConnections.set(id, fresh);
      fresh.promise.then(
        (env) => {
          fresh.env = env;
        },
        () => this.browseConnections.delete(id)
      );
    }
    const current = entry;
    current.refs++;
    clearTimeout(current.timer);
    try {
      const env = await current.promise;
      return await fn(env);
    } finally {
      current.refs--;
      if (current.refs === 0) {
        current.timer = setTimeout(() => {
          this.browseConnections.delete(id);
          current.promise.then(
            (env) => env.close(),
            () => {
            }
          );
        }, 6e4);
        current.timer.unref();
      }
    }
  }
  // ---------------------------------------------------------------- leases
  //
  // Admission rules (see README "借用"):
  //
  // | environment             | new headless lease        | new GUI lease / upgrade to GUI           |
  // | ----------------------- | ------------------------- | ---------------------------------------- |
  // | headlessParallel (dflt) | always admitted           | waits while another lease holds the GUI  |
  // | exclusive (false)       | waits while any lease is held (either mode); upgrades of the only lease are immediate |
  //
  // Waiters are served strictly in FIFO order per environment. A request admitted while its
  // connection is still opening counts as a holder (a claim), so nobody slips in meanwhile.
  leasesOf(envId) {
    return [...this.leases.values()].filter((l) => l.envId === envId);
  }
  /** Leases and admitted claims of an environment, except `except`. */
  holdersOf(envId, except) {
    return [...this.leasesOf(envId).filter((l) => l !== except), ...this.claims.get(envId) ?? []];
  }
  /** Whether a request fits next to the current holders (ignoring the queue). */
  fits(def, mode, except) {
    const others = this.holdersOf(def.id, except);
    if (!isHeadlessParallel(def)) return others.length === 0;
    return mode === "headless" || !others.some((h) => h.mode === "gui");
  }
  /** Whether a waiter queued earlier competes for the same slot (FIFO fairness). */
  queuedAhead(def, mode, upgrade) {
    const list = this.waiters.get(def.id) ?? [];
    if (!isHeadlessParallel(def)) return !upgrade && list.length > 0;
    return mode === "gui" && list.some((w) => w.mode === "gui");
  }
  addClaim(envId, claim) {
    const set = this.claims.get(envId) ?? /* @__PURE__ */ new Set();
    set.add(claim);
    this.claims.set(envId, set);
  }
  dropClaim(envId, claim) {
    const set = this.claims.get(envId);
    set?.delete(claim);
    if (set?.size === 0) this.claims.delete(envId);
  }
  /** Who stands in the way of a request, for error messages. */
  blocker(def, mode, except) {
    const leases = this.leasesOf(def.id).filter((l) => l !== except);
    const h = (isHeadlessParallel(def) && mode === "gui" ? leases.find((l) => l.mode === "gui") : void 0) ?? leases[0];
    const who = h ? h.owner?.title ?? h.owner?.sessionId ?? "another session" : "another session";
    return h ? `${who} (${h.purpose}, ${h.mode})` : `${who} (queued)`;
  }
  status(def) {
    const leases = this.leasesOf(def.id);
    const guiLease = leases.find((l) => l.mode === "gui");
    return {
      busy: !this.fits(def, "headless") || this.queuedAhead(def, "headless", false),
      guiBusy: !this.fits(def, "gui") || this.queuedAhead(def, "gui", false),
      headlessParallel: isHeadlessParallel(def),
      holders: leases.map((l) => ({
        leaseId: l.id,
        sessionId: l.owner?.sessionId,
        title: l.owner?.title,
        purpose: l.purpose,
        mode: l.mode,
        guiUsers: [...l.guiUsers],
        since: l.createdAt
      })),
      gui: guiLease ? {
        leaseId: guiLease.id,
        sessionId: guiLease.owner?.sessionId,
        title: guiLease.owner?.title,
        users: [...guiLease.guiUsers]
      } : void 0,
      queue: (this.waiters.get(def.id) ?? []).map((w) => ({
        sessionId: w.owner?.sessionId,
        since: w.since,
        mode: w.mode,
        upgrade: !!w.lease
      }))
    };
  }
  /**
   * Acquire an environment in a mode (default headless), following the admission rules above.
   * `wait: false` fails with EBUSY instead of queueing.
   */
  async acquire(envId, {
    owner,
    purpose = "borrow",
    mode = "headless",
    wait = false,
    timeoutMs = 10 * 60 * 1e3,
    signal,
    alias
  } = {}) {
    const def = this.require(envId);
    const claim = { mode, owner };
    if (!this.fits(def, mode) || this.queuedAhead(def, mode, false)) {
      const sid = owner?.sessionId;
      if (!isHeadlessParallel(def) && sid && this.leasesOf(def.id).some((l) => l.owner?.sessionId === sid))
        throw new EnvError("EEXIST", `this session already holds ${def.name}`);
      if (!wait) {
        throw new EnvError(
          "EBUSY",
          mode === "gui" && isHeadlessParallel(def) ? `the GUI of ${def.name} is in use by ${this.blocker(def, mode)}` : `${def.name} is in use by ${this.blocker(def, mode)}`
        );
      }
      await this.enqueue(def, { owner, mode, timeoutMs, signal, admit: () => this.addClaim(def.id, claim) });
    } else this.addClaim(def.id, claim);
    let env;
    try {
      env = await this.open(def, { signal });
    } catch (e) {
      this.dropClaim(def.id, claim);
      this.wakeNext(def.id);
      throw e;
    }
    this.dropClaim(def.id, claim);
    const lease = new Lease(this, {
      id: crypto7.randomUUID(),
      def,
      env,
      owner,
      purpose,
      alias: alias ?? aliasFor(def.id)
    });
    if (mode === "gui") lease.guiUsers.add(guiUserOf(owner, lease));
    this.leases.set(lease.id, lease);
    this.emit("change");
    return lease;
  }
  /**
   * Take (`on`) or give up the GUI of a lease for one user (a session id). Taking it is immediate
   * when the lease already is a GUI lease or the GUI is free; otherwise it fails with EBUSY, or
   * queues with `wait: true` like `acquire`. Giving it up never waits; the lease stays headless.
   */
  async setGui(lease, user, on, { wait = false, timeoutMs, signal } = {}) {
    if (!on) {
      lease.setGuiUser(user, false);
      return;
    }
    if (lease.released) throw new EnvError("ECLOSED", `the lease of ${lease.def.name} was released`);
    if (lease.guiUsers.has(user)) return;
    const def = lease.def;
    if (lease.mode === "gui" || this.fits(def, "gui", lease) && !this.queuedAhead(def, "gui", true)) {
      lease.setGuiUser(user, true);
      return;
    }
    if (!wait) throw new EnvError("EBUSY", `the GUI of ${def.name} is in use by ${this.blocker(def, "gui", lease)}`);
    await this.enqueue(def, {
      owner: { ...lease.owner, sessionId: user },
      mode: "gui",
      lease,
      timeoutMs: timeoutMs ?? 10 * 60 * 1e3,
      signal,
      admit: () => lease.setGuiUser(user, true)
    });
  }
  enqueue(def, {
    owner,
    mode,
    lease,
    timeoutMs,
    signal,
    admit
  }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new EnvError("CANCELLED", "stopped waiting"));
        return;
      }
      const list = this.waiters.get(def.id) ?? [];
      this.waiters.set(def.id, list);
      const waiter = { owner, since: Date.now(), mode, lease };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = list.indexOf(waiter);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0 && this.waiters.get(def.id) === list) this.waiters.delete(def.id);
        this.emit("change");
      };
      waiter.cancel = (error) => {
        cleanup();
        reject(error);
        this.wakeNext(def.id);
      };
      const onAbort = () => waiter.cancel?.(new EnvError("CANCELLED", "stopped waiting"));
      const timer = setTimeout(
        () => waiter.cancel?.(new EnvError("ETIMEDOUT", `timed out waiting for ${def.name}`)),
        timeoutMs
      );
      waiter.wake = () => {
        cleanup();
        admit();
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      list.push(waiter);
      this.emit("change");
    });
  }
  /** Admit waiters from the front of the queue while they fit. */
  wakeNext(envId) {
    const def = this.get(envId);
    const list = this.waiters.get(envId);
    if (!def || !list) return;
    for (let first = list[0]; first; first = list[0]) {
      if (first.lease?.released) {
        first.cancel?.(new EnvError("ECLOSED", `the lease of ${def.name} was released`));
        continue;
      }
      if (!this.fits(def, first.mode, first.lease)) return;
      first.wake?.();
    }
  }
  forgetLease(lease) {
    this.leases.delete(lease.id);
  }
  onLeaseReleased(lease) {
    this.emit("change");
    this.wakeNext(lease.envId);
  }
  onLeaseModeChanged(lease) {
    this.emit("change");
    if (lease.mode === "headless") this.wakeNext(lease.envId);
  }
  async releaseAll(predicate = () => true) {
    await Promise.all([...this.leases.values()].filter(predicate).map((l) => l.release("released")));
  }
  normPath(p) {
    if (!p) return p;
    const r2 = path13.resolve(p);
    return process.platform === "win32" ? r2.toLowerCase() : r2;
  }
  workspaceSettings(hostPath) {
    return this.state.workspaces[String(this.normPath(hostPath))] ?? {};
  }
  /**
   * Merge a patch into a workspace's settings. Keys absent from the patch are kept; keys
   * present with `undefined`/`null` are cleared. Empty settings are dropped from the state.
   */
  setWorkspaceSettings(hostPath, patch) {
    const key = this.normPath(hostPath);
    const next = { ...this.state.workspaces[key] };
    for (const [k, v] of Object.entries(patch)) {
      if (v === void 0 || v === null) delete next[k];
      else next[k] = v;
    }
    const settings = next;
    if (Object.keys(settings).length === 0) delete this.state.workspaces[key];
    else this.state.workspaces[key] = settings;
    this.save();
    return settings;
  }
  /**
   * What a workspace is bound to: a remote workspace is bound to its environment, any other
   * workspace runs on the host.
   */
  workspaceBinding(hostPath, workspaceId) {
    const remote = (workspaceId ? this.state.remoteWorkspaces.find((w) => w.workspaceId === workspaceId) : void 0) ?? this.remoteWorkspaceFor(hostPath);
    const settings = this.workspaceSettings(remote?.hostPath ?? hostPath);
    const borrowable = Array.isArray(settings.borrowable) ? settings.borrowable : void 0;
    if (remote) {
      return {
        kind: "remote",
        envId: remote.envId,
        remoteRoot: remote.root,
        remoteWorkspace: { id: remote.id, title: remote.title },
        borrowable
      };
    }
    return { kind: "host", borrowable };
  }
  sessionSettings(sessionId) {
    return this.state.sessions[sessionId] ?? {};
  }
  /** Merge a patch into a session's settings; `undefined`/`null` values delete keys. */
  setSessionSettings(sessionId, patch) {
    const next = { ...this.state.sessions[sessionId], ...patch, updatedAt: Date.now() };
    for (const k of Object.keys(next)) if (next[k] === void 0 || next[k] === null) delete next[k];
    const settings = next;
    this.state.sessions[sessionId] = settings;
    this.save();
    return settings;
  }
  /** Remote workspace whose host placeholder contains (or equals) the given host directory. */
  remoteWorkspaceFor(hostPath) {
    if (!hostPath) return void 0;
    const p = this.normPath(hostPath);
    return this.state.remoteWorkspaces.find((w) => {
      const h = this.normPath(w.hostPath);
      return p === h || p.startsWith(h + path13.sep);
    });
  }
  /**
   * Mount effective for a session: its own choice (`false` turns the remote workspace mount
   * off), else its remote workspace.
   */
  mountFor(sessionId, cwd) {
    const s = this.sessionSettings(sessionId);
    if (s.mount === false) return void 0;
    if (s.mount?.envId) return { ...s.mount, hostRoot: s.mount.hostRoot ?? cwd, source: "session" };
    const ws = this.remoteWorkspaceFor(cwd);
    if (ws)
      return { envId: ws.envId, remoteRoot: ws.root, hostRoot: ws.hostPath, source: "workspace", workspace: ws.id };
    return void 0;
  }
  /** Environments a session may borrow: session list, else workspace list, else every borrowable env. */
  borrowableFor(sessionId, cwd) {
    const s = this.sessionSettings(sessionId);
    let ids = s.borrowable;
    let source = "session";
    if (!Array.isArray(ids)) {
      const ws = this.remoteWorkspaceFor(cwd);
      const wsSettings = this.workspaceSettings(ws?.hostPath ?? cwd);
      ids = wsSettings.borrowable;
      source = "workspace";
    }
    const defs = this.definitions().filter((d) => d.borrowable !== false);
    if (!Array.isArray(ids)) return { source: "all", defs };
    const set = new Set(ids);
    return { source, defs: defs.filter((d) => set.has(d.id)) };
  }
  addRemoteWorkspace({
    envId,
    root,
    title,
    mountsDir
  }) {
    const def = this.require(envId);
    const id = crypto7.randomUUID().slice(0, 8);
    const base = path13.posix.basename(root.replace(/\\/g, "/"));
    const name2 = `${slug(def.id)}-${slug(base || "root")}-${id}`;
    const hostPath = path13.join(mountsDir, name2);
    fs10.mkdirSync(hostPath, { recursive: true });
    fs10.writeFileSync(
      path13.join(hostPath, ".dsh-environment-mount.json"),
      JSON.stringify(
        {
          envId,
          root,
          note: "Placeholder for a remote workspace mounted by dsh-plugin-environments. Files live in the environment."
        },
        null,
        2
      )
    );
    const ws = {
      id,
      envId,
      root,
      title: title || `${base || root} @ ${def.name}`,
      hostPath,
      createdAt: Date.now()
    };
    this.state.remoteWorkspaces.push(ws);
    this.save();
    return ws;
  }
  removeRemoteWorkspace(id) {
    const ws = this.state.remoteWorkspaces.find((w) => w.id === id);
    this.state.remoteWorkspaces = this.state.remoteWorkspaces.filter((w) => w.id !== id);
    this.save();
    return ws;
  }
  async dispose() {
    this.disposed = true;
    this.flush();
    for (const list of [...this.waiters.values()])
      for (const w of [...list]) w.cancel?.(new EnvError("CANCELLED", "the environments plugin is stopping"));
    await this.releaseAll();
    for (const entry of this.browseConnections.values()) {
      clearTimeout(entry.timer);
      entry.promise.then(
        (env) => env.close(),
        () => {
        }
      );
    }
    this.browseConnections.clear();
    await this.reverse.dispose();
  }
};
function guiUserOf(owner, lease) {
  return owner?.sessionId ?? `lease:${lease.id}`;
}
function migrateState(state) {
  let changed = false;
  for (const def of state.environments) {
    if (def && typeof def === "object" && migrateDefinition(def)) changed = true;
  }
  if (state.version !== STATE_VERSION) {
    state.version = STATE_VERSION;
    changed = true;
  }
  return changed;
}
function dropRetiredSettings(state) {
  for (const [key, settings] of Object.entries(state.workspaces)) {
    if (!settings || typeof settings !== "object") continue;
    const record = settings;
    if (!("defaultMount" in record)) continue;
    delete record["defaultMount"];
    if (Object.keys(record).length === 0) delete state.workspaces[key];
  }
  for (const settings of Object.values(state.sessions)) {
    if (settings && typeof settings === "object") delete settings["mountOrigin"];
  }
}

// packages/plugin/src/mount/index.ts
import { EventEmitter as EventEmitter8 } from "node:events";

// packages/plugin/src/mount/fs-provider.ts
var FS_CODE = {
  ENOENT: "FS_NOT_FOUND",
  ENOTDIR: "FS_NOT_DIRECTORY",
  EACCES: "FS_PERMISSION_DENIED",
  EPERM: "FS_PERMISSION_DENIED",
  ETOOBIG: "FS_TOO_LARGE",
  EISDIR: "FS_NOT_REGULAR_FILE",
  CANCELLED: "FS_ABORTED"
};
var TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
var DIFF_BASIS_MAX = 2 * 1024 * 1024;
var TEXT_MAX = 64 * 1024 * 1024;
function normalizeLf(s) {
  return s.replaceAll("\r\n", "\n");
}
function detectCrlf(s) {
  const sample = s.slice(0, 64 * 1024);
  const crlf = sample.split("\r\n").length - 1;
  const lf = sample.split("\n").length - 1 - crlf;
  return crlf > lf;
}
function fileUrlOf(env, p) {
  if (env.family === "windows") {
    return `file:///${p.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:")}`;
  }
  return `file://${p.split("/").map(encodeURIComponent).join("/")}`;
}
var versionOf = (st) => `${Math.round((st.mtimeMs ?? NaN) * 1e3)}:${st.size}`;
var kindOf = (t) => t === "dir" ? "directory" : t === "file" ? "file" : "other";
var keyOf = (target) => String(target.targetKey);
function createEnvFileSystem({ FileSystem, FsError }) {
  const toFsError = (e, display) => {
    if (e instanceof FsError) return e;
    const code = FS_CODE[errorCode(e) ?? ""] ?? "FS_IO_ERROR";
    return new FsError(`${display ? `${display}: ` : ""}${errorMessage(e)}`, code);
  };
  return class EnvFileSystem extends FileSystem {
    static inject = [];
    map;
    env;
    constructor(ctx, config) {
      super(ctx);
      this.map = config.map;
      this.env = config.map.env;
    }
    target(p) {
      return { targetKey: p, displayPath: p };
    }
    resolve(p, opts = {}) {
      if (typeof p !== "string" || p.length === 0) {
        return Promise.reject(new FsError("path must be a non-empty string", "FS_NOT_FOUND"));
      }
      return Promise.resolve(this.target(this.map.resolve(p, opts.cwd)));
    }
    processPath(target) {
      return keyOf(target);
    }
    processPathFromHostPath(hostPath) {
      return this.map.hostPrefix(hostPath) === void 0 ? void 0 : this.map.toRemote(hostPath);
    }
    fileUrl(target) {
      return fileUrlOf(this.env, keyOf(target));
    }
    contains(parent, child) {
      const P = this.env.path;
      const a = keyOf(parent);
      const b = keyOf(child);
      const norm = (s) => this.env.family === "windows" ? s.toLowerCase() : s;
      if (norm(a) === norm(b)) return true;
      const rel = P.relative(a, b);
      return rel !== "" && !rel.startsWith("..") && !P.isAbsolute(rel);
    }
    async stat(target, signal) {
      try {
        const st = await this.env.stat(keyOf(target), { signal });
        if (!st) return void 0;
        return { version: versionOf(st), type: kindOf(st.type), ...st.type === "file" ? { size: st.size } : {} };
      } catch (e) {
        const code = errorCode(e);
        if (code === "ENOENT" || code === "ENOTDIR") return void 0;
        throw toFsError(e, target.displayPath);
      }
    }
    async lstat(p, opts = {}, signal) {
      const abs = this.map.resolve(p, opts.cwd);
      try {
        const st = await this.env.stat(abs, { follow: false, signal });
        if (!st) return void 0;
        return {
          version: versionOf(st),
          type: st.type === "dir" ? "directory" : st.type,
          ...st.type === "file" ? { size: st.size } : {}
        };
      } catch (e) {
        if (errorCode(e) === "ENOENT") return void 0;
        throw toFsError(e, abs);
      }
    }
    async readRaw(target, signal, max) {
      try {
        return await this.env.readFile(keyOf(target), { signal, ...max !== void 0 ? { maxBytes: max } : {} });
      } catch (e) {
        throw toFsError(e, target.displayPath);
      }
    }
    decode(buf, display) {
      if (buf.includes(0)) throw new FsError(`cannot read "${display}": binary file`, "FS_NOT_TEXT");
      try {
        return TEXT_DECODER.decode(buf);
      } catch {
        throw new FsError(`cannot read "${display}": not valid UTF-8 text`, "FS_NOT_TEXT");
      }
    }
    async readText(target, signal) {
      const st = await this.stat(target, signal);
      if (!st) throw new FsError(`cannot read "${target.displayPath}": not found`, "FS_NOT_FOUND");
      if (st.type !== "file") {
        throw new FsError(`cannot read "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      }
      return this.decode(await this.readRaw(target, signal, TEXT_MAX), target.displayPath);
    }
    async streamText(target, signal) {
      const text2 = await this.readText(target, signal);
      return (async function* () {
        for (let i = 0; i < text2.length; i += 256 * 1024) yield text2.slice(i, i + 256 * 1024);
      })();
    }
    async readBytes(target, signal, maxBytes) {
      return new Uint8Array(await this.readRaw(target, signal, maxBytes));
    }
    async readByteRange(target, range, signal) {
      try {
        return new Uint8Array(
          await this.env.readFile(keyOf(target), { offset: range.offset, length: range.length, signal })
        );
      } catch (e) {
        throw toFsError(e, target.displayPath);
      }
    }
    async listDir(target, signal) {
      let entries;
      try {
        entries = await this.env.readdir(keyOf(target), { signal });
      } catch (e) {
        throw toFsError(e, target.displayPath);
      }
      const P = this.env.path;
      return entries.map((e) => ({
        name: e.name,
        type: kindOf(e.type),
        target: this.target(P.join(keyOf(target), e.name)),
        ...e.mtimeMs !== void 0 && e.size !== void 0 ? { version: versionOf(e) } : {},
        ...e.type === "file" && e.size !== void 0 ? { size: e.size } : {}
      }));
    }
    /** Current state of a file as the diff basis for writes. */
    async current(target, signal) {
      const st = await this.env.stat(keyOf(target), { signal }).catch((e) => {
        if (errorCode(e) === "ENOENT") return null;
        throw toFsError(e, target.displayPath);
      });
      if (!st) return { exists: false };
      if (st.type !== "file") throw new FsError(`"${target.displayPath}" is not a regular file`, "FS_NOT_REGULAR_FILE");
      let text2 = null;
      let crlf = false;
      if (st.size <= DIFF_BASIS_MAX) {
        try {
          const raw = this.decode(await this.readRaw(target, signal, DIFF_BASIS_MAX), target.displayPath);
          crlf = detectCrlf(raw);
          text2 = normalizeLf(raw);
        } catch {
        }
      }
      return { exists: true, version: versionOf(st), text: text2, crlf };
    }
    async writeText(target, content, expected, signal) {
      const cur = await this.current(target, signal);
      if (expected?.kind === "createIfAbsent" && cur.exists) {
        throw new FsError(`"${target.displayPath}" already exists; read it before overwriting`, "FS_NOT_OBSERVED");
      }
      if (expected?.kind === "replaceIfVersion" && (!cur.exists || cur.version !== expected.version)) {
        throw new FsError(`"${target.displayPath}" changed since it was read; read it again`, "FS_STALE_VERSION");
      }
      const after = normalizeLf(content);
      const out = cur.crlf ? after.split("\n").join("\r\n") : content;
      signal?.throwIfAborted();
      let st;
      try {
        st = await this.env.writeFile(keyOf(target), Buffer.from(out, "utf8"), {
          mode: "overwrite",
          atomic: true,
          mkdirs: true,
          signal
        });
      } catch (e) {
        throw toFsError(e, target.displayPath);
      }
      return {
        operation: cur.exists ? "update" : "create",
        version: versionOf(st ?? {}),
        before: cur.exists ? cur.text ?? null : null,
        after
      };
    }
    async editText(target, edit, expected, signal) {
      const st = await this.env.stat(keyOf(target), { signal }).catch(() => null);
      if (!st) throw new FsError(`"${target.displayPath}" does not exist`, "FS_STALE_VERSION");
      if (expected && versionOf(st) !== expected.version) {
        throw new FsError(`"${target.displayPath}" changed since it was read; read it again`, "FS_STALE_VERSION");
      }
      const raw = this.decode(await this.readRaw(target, signal, TEXT_MAX), target.displayPath);
      const crlf = detectCrlf(raw);
      const before = normalizeLf(raw);
      const oldNorm = normalizeLf(edit.oldString);
      if (oldNorm.length === 0) throw new FsError("old_string must be a non-empty string", "FS_EDIT_NOT_FOUND");
      const count = before.split(oldNorm).length - 1;
      if (count === 0) throw new FsError(`old_string was not found in "${target.displayPath}"`, "FS_EDIT_NOT_FOUND");
      if (!edit.replaceAll && count > 1) {
        throw new FsError(
          `old_string matched ${count} times in "${target.displayPath}"; provide a more specific old_string or set replace_all to true`,
          "FS_AMBIGUOUS_EDIT"
        );
      }
      const after = before.split(oldNorm).join(normalizeLf(edit.newString));
      const out = crlf ? after.split("\n").join("\r\n") : after;
      let written;
      try {
        written = await this.env.writeFile(keyOf(target), Buffer.from(out, "utf8"), {
          mode: "overwrite",
          atomic: true,
          signal
        });
      } catch (e) {
        throw toFsError(e, target.displayPath);
      }
      return { version: versionOf(written ?? {}), before, after };
    }
  };
}

// packages/plugin/src/mount/gate.ts
var MountBlockedError = class extends Error {
  name = "MountBlockedError";
};
function untilAborted(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
function installMountGate(ctx, target) {
  ctx.on("agent/pre-step", async (event, next) => {
    if (target.blockReason(event.agent) !== void 0) {
      await untilAborted(
        target.ensure(event.agent).catch(() => void 0),
        event.signal
      );
      const reason = target.blockReason(event.agent);
      if (reason !== void 0) throw new MountBlockedError(reason);
    }
    return next();
  });
  ctx.on("tools/pre-execute", async (exec2, next) => {
    const reason = exec2.agent ? target.blockReason(exec2.agent) : void 0;
    if (reason !== void 0) return { kind: "deny", reason };
    return next();
  });
}

// packages/plugin/src/mount/instructions.ts
var INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];
var INSTRUCTION_MAX = 64 * 1024;
async function loadInstructions(env, root) {
  const P = env.path;
  let dirs = [root];
  const chain = [root];
  let dir = root;
  for (let i = 0; i < 6; i++) {
    if (await env.stat(P.join(dir, ".git")).catch(() => null)) {
      dirs = [...chain];
      break;
    }
    const parent = P.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    chain.unshift(dir);
  }
  const parts = [];
  let budget = INSTRUCTION_MAX;
  for (const d of dirs) {
    for (const name2 of INSTRUCTION_FILES) {
      const file = P.join(d, name2);
      const st = await env.stat(file).catch(() => null);
      if (st?.type !== "file" || st.size === 0) continue;
      const buf = await env.readFile(file, { maxBytes: 1024 * 1024 }).catch(() => void 0);
      if (!buf || buf.includes(0)) continue;
      let text2 = buf.toString("utf8").replace(/^\uFEFF/, "").trim();
      if (!text2) continue;
      if (text2.length > budget) text2 = `${text2.slice(0, budget)}
\u2026 (truncated)`;
      budget -= text2.length;
      parts.push(`<instructions path="${file}">
${text2}
</instructions>`);
      break;
    }
    if (budget <= 0) break;
  }
  if (parts.length === 0) return "";
  return `Project instructions from the mounted environment. Follow them like AGENTS.md instructions; files nearer the working directory take precedence.

${parts.join("\n\n")}`;
}

// packages/plugin/src/mount/map.ts
import path14 from "node:path";
var MountMap = class {
  env;
  hostRoot;
  remoteRoot;
  constructor({ env, hostRoot, remoteRoot }) {
    this.env = env;
    this.hostRoot = hostRoot ? path14.resolve(hostRoot) : void 0;
    this.remoteRoot = remoteRoot;
  }
  /** Path of `p` relative to the host root ('' for the root itself), or undefined when outside it. */
  hostPrefix(p) {
    if (!this.hostRoot || typeof p !== "string") return void 0;
    const win = process.platform === "win32";
    const norm = win ? p.replace(/\//g, "\\") : p;
    const a = win ? norm.toLowerCase() : norm;
    const b = win ? this.hostRoot.toLowerCase() : this.hostRoot;
    if (a === b) return "";
    const sep = win ? "\\" : "/";
    if (a.startsWith(b.endsWith(sep) ? b : b + sep)) return norm.slice(this.hostRoot.length).replace(/^[\\/]+/, "");
    return void 0;
  }
  toRemote(p) {
    const rel = this.hostPrefix(p);
    if (rel === void 0) return p;
    if (rel === "") return this.remoteRoot;
    return this.env.path.join(this.remoteRoot, ...rel.split(/[\\/]+/));
  }
  resolve(p, cwd) {
    const base = cwd ? this.toRemote(cwd) : this.remoteRoot;
    const mapped = this.toRemote(p);
    return this.env.resolvePath(mapped, base);
  }
};

// packages/plugin/src/mount/search-tools.ts
function registerSearchTools(sctx, defineTool, map) {
  const env = map.env;
  sctx.tools.register(
    defineTool({
      name: "glob",
      description: 'Find files by glob pattern (e.g. "**/*.ts", "src/**/test_*.py"). Results are paths relative to the search directory, newest first.',
      parameters: {
        pattern: { type: "string", required: true, description: "Glob pattern." },
        path: { type: "string", description: "Directory to search (default: the working directory)." }
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec2) {
        const base = map.resolve(args.path ?? ".", agentOf(exec2)?.session.header.cwd);
        const r2 = await env.glob(args.pattern, { cwd: base, limit: 200, signal: exec2.signal });
        if (r2.paths.length === 0) return "No files found";
        return `${r2.paths.join("\n")}${r2.truncated ? "\n(Results are truncated. Use a more specific path or pattern.)" : ""}`;
      }
    })
  );
  sctx.tools.register(
    defineTool({
      name: "grep",
      description: "Search file contents with a regular expression. Returns matching lines as path:line: text.",
      parameters: {
        pattern: {
          type: "string",
          required: true,
          description: "Regular expression (Rust/ripgrep syntax where available)."
        },
        path: { type: "string", description: "File or directory to search (default: the working directory)." },
        include: { type: "string", description: 'Only search files matching this glob, e.g. "*.ts".' },
        ignore_case: { type: "boolean", description: "Case-insensitive search." },
        files_only: { type: "boolean", description: "Only list matching file paths." }
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec2) {
        const sessionCwd = agentOf(exec2)?.session.header.cwd;
        const cwd = map.resolve(".", sessionCwd);
        const r2 = await env.grep(args.pattern, {
          cwd,
          path: args.path ? map.resolve(args.path, sessionCwd) : void 0,
          glob: args.include,
          ignoreCase: args.ignore_case,
          filesOnly: args.files_only,
          limit: 250,
          signal: exec2.signal
        });
        if (args.files_only) return r2.files.join("\n") || "No files found";
        if (r2.matches.length === 0) return "No files found";
        const byFile = /* @__PURE__ */ new Map();
        for (const m of r2.matches) {
          let lines2 = byFile.get(m.path);
          if (!lines2) byFile.set(m.path, lines2 = []);
          lines2.push(`  Line ${m.line}: ${m.text}`);
        }
        const lines = [`Found ${r2.matches.length} matches${r2.truncated ? " (truncated)" : ""}`];
        for (const [file, ms] of byFile) lines.push("", `${file}:`, ...ms);
        return lines.join("\n");
      }
    })
  );
}

// packages/plugin/src/mount/subprocess-provider.ts
import { PassThrough } from "node:stream";
function incompleteUtf8Tail(buf) {
  for (let i = 1; i <= Math.min(3, buf.length); i++) {
    const b = buf[buf.length - i] ?? 0;
    if ((b & 192) === 128) continue;
    if (b < 192) return 0;
    const need2 = b >= 240 ? 4 : b >= 224 ? 3 : 2;
    return need2 > i ? i : 0;
  }
  return 0;
}
var Collector = class {
  maxBytes;
  chunks = [];
  size = 0;
  total = 0;
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  push(buf) {
    this.chunks.push(buf);
    this.size += buf.length;
    this.total += buf.length;
    while (this.size > this.maxBytes && this.chunks.length > 1) {
      this.size -= this.chunks.shift()?.length ?? 0;
    }
  }
  /**
   * Text from `fromByte` on. The returned offset never points inside a UTF-8 character: an
   * incomplete trailing sequence is left for the next read.
   */
  readFrom(fromByte) {
    const start = this.total - this.size;
    const all = Buffer.concat(this.chunks);
    const lossy = fromByte < start;
    let view = lossy ? all : all.subarray(fromByte - start);
    if (lossy) {
      let skip = 0;
      while (skip < 3 && skip < view.length && ((view[skip] ?? 0) & 192) === 128) skip++;
      view = view.subarray(skip);
    }
    const tail = incompleteUtf8Tail(view);
    return { text: view.subarray(0, view.length - tail).toString("utf8"), nextOffset: this.total - tail, lossy };
  }
};
var OUTPUTS = ["stdout", "stderr"];
function createEnvSubprocessRuntime({ SubprocessRuntime, SubprocessExecutableNotFoundError }) {
  return class EnvSubprocessRuntime extends SubprocessRuntime {
    static inject = [];
    map;
    env;
    live = /* @__PURE__ */ new Set();
    constructor(ctx, config) {
      super(ctx);
      this.map = config.map;
      this.env = config.map.env;
      asPluginContext(ctx).effect(
        () => () => {
          for (const p of this.live) p.kill().catch(() => {
          });
        },
        "environments: mounted processes"
      );
    }
    async resolveExecutable(command, _env, signal) {
      if (this.env.path.isAbsolute(command)) {
        const st = await this.env.stat(command, { signal }).catch(() => null);
        if (st?.type === "file") return command;
        throw new SubprocessExecutableNotFoundError(`${command} not found in ${this.env.name}`);
      }
      if (/[\\/]/.test(command))
        throw new SubprocessExecutableNotFoundError(`relative executable paths are not supported: ${command}`);
      const probe = this.env.family === "windows" ? { argv: ["where.exe", command] } : { argv: ["sh", "-c", `command -v ${JSON.stringify(command)}`] };
      const r2 = await this.env.exec(probe, { signal }).catch(() => void 0);
      const found = r2?.code === 0 ? r2.stdout.toString().split(/\r?\n/).map((s) => s.trim()).find(Boolean) : void 0;
      if (!found) throw new SubprocessExecutableNotFoundError(`${command} not found in ${this.env.name}`);
      return found;
    }
    terminalEnvironment() {
      const shell = this.env.info?.shell;
      return Promise.resolve({
        platform: this.env.family === "windows" ? "windows" : "posix",
        ...shell ? { defaultShell: shell } : {}
      });
    }
    /** Map a harness spawn spec into the environment (argv, remote cwd, env with tombstones). */
    spawnSpec(spec) {
      const env = {};
      for (const [k, v] of Object.entries(spec.env ?? {})) env[k] = v === void 0 ? null : String(v);
      return { argv: [...spec.argv], cwd: this.map.toRemote(spec.cwd), env };
    }
    spawn(spec) {
      if (spec.signal?.aborted) throw new Error("spawn aborted");
      const stdinMode = spec.stdio.stdin;
      const stdin = stdinMode === "pipe" ? new PassThrough() : void 0;
      const pipes = {};
      const collected = {};
      for (const name2 of OUTPUTS) {
        const mode = spec.stdio[name2];
        if (mode === "pipe") pipes[name2] = new PassThrough();
        else if (typeof mode === "object") collected[name2] = new Collector(mode.maxBytes);
      }
      let proc;
      let terminated = false;
      let resolveDone;
      let rejectDone;
      const done = new Promise((res, rej) => {
        resolveDone = res;
        rejectDone = rej;
      });
      done.catch(() => {
      });
      const readers = {};
      for (const name2 of OUTPUTS) {
        const c = collected[name2];
        if (c) readers[name2] = { readFrom: (n) => c.readFrom(n) };
      }
      const handle = {
        stdin,
        stdout: pipes.stdout,
        stderr: pipes.stderr,
        control: void 0,
        collected: readers,
        done,
        terminate() {
          terminated = true;
          proc?.kill().catch(() => {
          });
        },
        async waitForExit(signal) {
          if (!proc) await new Promise((r2) => setTimeout(r2, 10));
          const aborted = new Promise((r2) => signal?.addEventListener("abort", () => r2(false), { once: true }));
          return Promise.race([
            done.then(
              () => true,
              () => true
            ),
            aborted
          ]);
        }
      };
      spec.signal?.addEventListener("abort", () => handle.terminate(), { once: true });
      this.env.spawn(this.spawnSpec(spec)).then(
        (p) => {
          proc = p;
          this.live.add(p);
          if (terminated) p.kill().catch(() => {
          });
          const outputs = [];
          for (const name2 of OUTPUTS) {
            const src = p[name2];
            const ended = new Promise((r2) => {
              src.once("end", r2);
              src.once("close", r2);
              src.once("error", r2);
            });
            outputs.push(ended);
            const pipe = pipes[name2];
            const collector = collected[name2];
            if (pipe) src.pipe(pipe);
            else if (collector) src.on("data", (d) => collector.push(d));
            else src.resume();
          }
          if (stdin) {
            stdin.on("data", (d) => {
              stdin.pause();
              p.write(d).then(
                () => stdin.resume(),
                () => stdin.resume()
              );
            });
            stdin.on("end", () => p.end());
          } else if (typeof stdinMode === "object") {
            void p.write(Buffer.from(stdinMode.data)).finally(() => p.end());
          } else {
            p.end();
          }
          void p.exited.then(async (exit) => {
            this.live.delete(p);
            await Promise.race([
              Promise.all(outputs),
              new Promise((r2) => setTimeout(r2, Math.min(spec.graceMs ?? 2e3, 5e3)))
            ]);
            for (const name2 of OUTPUTS) {
              const pipe = pipes[name2];
              if (pipe && !pipe.writableEnded) pipe.end();
            }
            const signal = exit.code === null ? exit.signal && /^SIG/.test(exit.signal) ? exit.signal : "SIGKILL" : null;
            resolveDone({ exitCode: exit.code, signal });
          });
        },
        (error) => {
          for (const s of Object.values(pipes)) s.destroy(error instanceof Error ? error : void 0);
          rejectDone(error);
        }
      );
      return handle;
    }
    async spawnTerminal(spec) {
      const env = {};
      for (const [k, v] of Object.entries(spec.env ?? {})) env[k] = String(v);
      env["TERM"] = spec.terminalType;
      const p = await this.env.spawn(
        { argv: [...spec.argv], cwd: this.map.toRemote(spec.cwd), env, pty: { rows: spec.rows, cols: spec.cols } },
        { signal: spec.signal }
      );
      this.live.add(p);
      const output = new PassThrough();
      p.stdout.pipe(output);
      const done = p.exited.then((exit) => {
        this.live.delete(p);
        return { exitCode: exit.code, signal: exit.code === null ? "SIGKILL" : null };
      });
      let revision = 0;
      return {
        pid: p.pid ?? 0,
        output,
        done,
        async write(data) {
          revision++;
          await p.write(Buffer.from(data, "utf8"));
        },
        async resize(cols, rows) {
          await p.resize(rows, cols);
        },
        inspectForeground() {
          return Promise.resolve(void 0);
        },
        inspectActivity() {
          return Promise.resolve({ state: "unknown", revision });
        },
        async signalForeground(signal) {
          if (signal === "SIGINT") await p.write(Buffer.from(""));
          else await p.kill();
          return p.pid ?? 0;
        },
        async terminate() {
          await p.kill();
          await done.catch(() => {
          });
        }
      };
    }
  };
}

// packages/plugin/src/mount/index.ts
var HOST_ONLY_TOOLS = [
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_list",
  "terminal_close",
  "terminal_signal",
  "lsp",
  "load_workspace_dependencies",
  "str_replace_editor"
];
function shellArgv(env, argv) {
  const base = (String(argv[0] ?? "").replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase();
  if (base === "bash" && env.info?.os === "android") return ["sh", ...argv.slice(1)];
  if (/^(pwsh|powershell)(\.exe)?$/.test(base) && env.family === "windows") {
    const preferred = /pwsh/i.test(env.info?.shell ?? "") ? "pwsh.exe" : "powershell.exe";
    return [preferred, ...argv.slice(1)];
  }
  return [...argv];
}
function satisfies(have, want, parentRecord) {
  if (want.parent) return have.parent === want.parent && !!parentRecord && have.lease === parentRecord.lease;
  return !have.parent && have.envId === want.envId && (!want.remoteRoot || have.map.remoteRoot === want.remoteRoot || have.requestedRoot === want.remoteRoot);
}
function installMounting(ctx, manager, deps) {
  const EnvFileSystem = createEnvFileSystem(deps);
  const BaseRuntime = createEnvSubprocessRuntime(deps);
  class EnvSubprocessRuntime extends BaseRuntime {
    spawnSpec(spec) {
      const s = super.spawnSpec(spec);
      return { ...s, argv: shellArgv(this.env, s.argv) };
    }
    spawnTerminal(spec) {
      return super.spawnTerminal({ ...spec, argv: shellArgv(this.env, spec.argv) });
    }
  }
  const mounts = /* @__PURE__ */ new WeakMap();
  const live = /* @__PURE__ */ new Set();
  const events = new EventEmitter8();
  const log = (format, ...args) => {
    try {
      ctx.logger("environments").info(format, ...args);
    } catch {
    }
  };
  const agentById = (id) => {
    try {
      return ctx.get("agents")?.get(id);
    } catch {
      return void 0;
    }
  };
  function wantedOf(agent, depth = 0) {
    const parentId = parentSessionOf(agent);
    if (parentId && depth < 16) {
      const parent = agentById(parentId);
      if (parent) {
        const want = wantedOf(parent, depth + 1);
        return want ? { ...want, parent } : void 0;
      }
      return manager.mountFor(parentId, agent.session.header.cwd);
    }
    return manager.mountFor(sessionIdOf(agent), agent.session.header.cwd);
  }
  async function install(agent, mount) {
    const sessionId = sessionIdOf(agent);
    const parentRecord = mount.parent ? mounts.get(mount.parent) : void 0;
    if (mount.parent && !parentRecord) {
      throw new Error(`\u7236\u4F1A\u8BDD\u7684\u6302\u8F7D\u4E0D\u53EF\u7528\uFF08${manager.get(mount.envId)?.name ?? mount.envId}\uFF09`);
    }
    const lease = parentRecord?.lease ?? await manager.acquire(mount.envId, {
      owner: { sessionId, title: `mounted session ${sessionId.slice(0, 8)}` },
      purpose: "mount",
      wait: false
    });
    const env = lease.env;
    let remoteRoot = parentRecord?.map.remoteRoot ?? (mount.remoteRoot || env.info?.cwd || "");
    if (!parentRecord) {
      try {
        remoteRoot = await env.realpath(remoteRoot);
      } catch {
      }
      const st = await env.stat(remoteRoot).catch(() => null);
      if (!st || st.type !== "dir") {
        await lease.release("root missing");
        throw new Error(`mount root ${remoteRoot} does not exist in ${env.name}`);
      }
    }
    const map = new MountMap({
      env,
      hostRoot: parentRecord?.map.hostRoot ?? mount.hostRoot ?? agent.session.header.cwd,
      remoteRoot
    });
    const scope = deps.createScope(ctx, agent);
    const realm = scope.ctx.isolate("fs").isolate("subprocess").isolate("shell").isolate("sandbox");
    const record = {
      env,
      map,
      lease,
      scope,
      envId: mount.envId,
      source: mount.source,
      startedAt: Date.now(),
      requestedRoot: mount.remoteRoot,
      parent: parentRecord ? mount.parent : void 0
    };
    mounts.set(agent, record);
    live.add(agent);
    try {
      realm.plugin(EnvFileSystem, { map });
      realm.plugin(EnvSubprocessRuntime, { map });
      if (env.family === "windows") {
        realm.plugin(deps.PwshLocal, { pwshPath: /pwsh/i.test(env.info?.shell ?? "") ? "pwsh.exe" : "powershell.exe" });
        realm.plugin(deps.ToolPwsh, {});
      } else {
        realm.plugin(deps.BashLocal, {});
        realm.plugin(deps.ToolBash, {});
      }
      realm.plugin(deps.ToolFs, {});
      if (deps.SkillFilesystem) realm.plugin(deps.SkillFilesystem, { providerName: "environment", watch: false });
      registerSearchTools(scope.ctx, deps.defineTool, map);
      scope.ctx.systemPrompt.variable("cwd", () => remoteRoot);
      const instructions = { text: await loadInstructions(env, remoteRoot).catch(() => "") };
      const instructionSection = (text2) => scope.ctx.systemPrompt.section({
        name: "environments:instructions",
        order: promptSectionOrder(scope.ctx) + 1,
        interpolate: false,
        text: text2
      });
      let disposeInstructions = instructions.text ? instructionSection(instructions.text) : void 0;
      scope.ctx.on("tools/result", (exec2, result) => {
        if (exec2.agent !== agent || result.isError || !["write", "edit"].includes(exec2.name)) return;
        const filePath = exec2.arguments?.["file_path"];
        const p = typeof filePath === "string" ? filePath : "";
        if (!INSTRUCTION_FILES.includes(p.replace(/\\/g, "/").split("/").pop() ?? "")) return;
        loadInstructions(env, remoteRoot).then(
          (text2) => {
            if (text2 === instructions.text || mounts.get(agent) !== record) return;
            instructions.text = text2;
            disposeInstructions?.();
            disposeInstructions = text2 ? instructionSection(text2) : void 0;
          },
          () => {
          }
        );
      });
      scope.ctx.systemPrompt.section({
        name: "environments:mount",
        order: promptSectionOrder(scope.ctx),
        interpolate: false,
        text: [
          `This session is mounted on the environment "${env.name}" (${env.info?.os}${env.info?.arch ? `/${env.info.arch}` : ""}, user ${env.info?.user ?? "?"}).`,
          `Your file tools (read, write, edit, read_image, glob, grep) and your ${env.family === "windows" ? "pwsh" : "bash"} tool operate inside that environment; the working directory is ${remoteRoot}.`,
          `Use paths in the environment's own form (${env.family === "windows" ? "e.g. C:\\path\\file" : "e.g. /path/file"}).`,
          ...record.parent ? ["This mount is shared with the parent session that delegated to you."] : [],
          ...env.hasCap("screenshot") || env.kind === "adb" ? [
            `The mount is headless unless this session holds the environment's GUI: screen tools (${lease.alias}__screenshot, ${lease.alias}__input, ...) exist only then. Take the GUI with env_borrow { environment: "${mount.envId}", gui: true } and give it back with env_return; the mount itself stays.`
          ] : [],
          "Use env_list / env_borrow to access additional devices."
        ].join("\n")
      });
      const visible = new Set(ctx.tools.schemas(agent).map((t) => t.name));
      const deny = [...HOST_ONLY_TOOLS, env.family === "windows" ? "bash" : "pwsh"].filter((n) => visible.has(n));
      if (deny.length > 0) {
        try {
          scope.ctx.tools.restrict({ deny });
        } catch (e) {
          log("restrict failed: %s", errorMessage(e));
        }
      }
      lease.once("release", (reason) => {
        if (mounts.get(agent) === record && !record.uninstalling) {
          log("mount of %s lost: %s", sessionId, reason);
          manager.setSessionSettings(sessionId, { mountError: `\u6302\u8F7D\u5DF2\u65AD\u5F00\uFF08${reason}\uFF09` });
          uninstall(agent).catch(() => {
          });
        }
      });
      agent.ctx.effect(
        () => () => {
          if (mounts.get(agent) === record) uninstall(agent).catch(() => {
          });
        },
        "environments: mount"
      );
    } catch (e) {
      await uninstall(agent);
      throw e;
    }
    events.emit("mounted", agent, record);
    return record;
  }
  async function uninstall(agent) {
    const record = mounts.get(agent);
    if (!record) return;
    record.uninstalling = true;
    mounts.delete(agent);
    live.delete(agent);
    events.emit("unmounted", agent, record);
    await record.scope.dispose().catch(() => {
    });
    if (!record.parent) await record.lease.release("unmounted").catch(() => {
    });
  }
  async function reconcile(agent) {
    const sessionId = sessionIdOf(agent);
    let want = wantedOf(agent);
    let record;
    try {
      if (want?.parent) {
        await ensure(want.parent).catch(() => void 0);
        want = wantedOf(agent);
      }
      const have = mounts.get(agent);
      const parentRecord = want?.parent ? mounts.get(want.parent) : void 0;
      if (have && want && satisfies(have, want, parentRecord)) record = have;
      else {
        if (have) await uninstall(agent);
        record = want ? await install(agent, want) : void 0;
      }
    } catch (e) {
      manager.setSessionSettings(sessionId, { mountError: errorMessage(e) });
      throw e;
    }
    if (manager.sessionSettings(sessionId).mountError !== void 0) {
      manager.setSessionSettings(sessionId, { mountError: void 0 });
    }
    return record;
  }
  const pending = /* @__PURE__ */ new WeakMap();
  function ensure(agent) {
    const previous = pending.get(agent) ?? Promise.resolve();
    const run = previous.then(() => reconcile(agent));
    const tracked = run.catch(() => void 0).finally(() => {
      if (pending.get(agent) === tracked) pending.delete(agent);
    });
    pending.set(agent, tracked);
    return run;
  }
  function blockReason(agent) {
    const sessionId = sessionIdOf(agent);
    const want = wantedOf(agent);
    if (!want) return void 0;
    const have = mounts.get(agent);
    if (have && satisfies(have, want, want.parent ? mounts.get(want.parent) : void 0)) return void 0;
    const name2 = manager.get(want.envId)?.name ?? want.envId;
    const error = manager.sessionSettings(sessionId).mountError;
    if (error !== void 0) return `\u73AF\u5883 ${name2} \u6302\u8F7D\u5931\u8D25\uFF1A${error}`;
    return pending.has(agent) ? `\u73AF\u5883 ${name2} \u6B63\u5728\u6302\u8F7D\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5` : `\u73AF\u5883 ${name2} \u6302\u8F7D\u5931\u8D25\uFF1A\u672A\u6302\u8F7D`;
  }
  ctx.on("agent/created", async ({ agent }) => {
    try {
      await ensure(agent);
    } catch (e) {
      log("mount failed for %s: %s", sessionIdOf(agent), errorMessage(e));
    }
  });
  installMountGate(ctx, { ensure, blockReason });
  return {
    mountOf: (agent) => mounts.get(agent),
    ensure,
    uninstall,
    blockReason,
    wantedOf,
    events,
    liveMounts: () => [...live].flatMap((agent) => {
      const record = mounts.get(agent);
      return record ? [{ agent, record }] : [];
    })
  };
}

// packages/plugin/src/index.ts
var name = "environments";
var inject = ["tools", "agents", "systemPrompt"];
function dshHome() {
  return process.env["DSH_HOME"] || path15.join(os10.homedir(), ".dsh");
}
async function apply(ctx, config = {}) {
  const deps = await loadDeps();
  const dataDir = config.dataDir || path15.join(dshHome(), "storages", "environments");
  const mountsDir = config.mountsDir || path15.join(dshHome(), "env-mounts");
  let logger;
  try {
    logger = ctx.logger("environments");
  } catch {
  }
  const manager = new EnvironmentManager({
    dataDir,
    autoDiscoverAdb: config.autoDiscoverAdb !== false,
    adb: config.adb || "adb",
    logger,
    reverse: config.reverse,
    mountMode: config.mountMode
  });
  manager.load();
  void manager.startReverse().catch((e) => logger?.warn("environments: reverse listeners: %s", String(e)));
  ctx.effect(() => () => manager.dispose(), "environments: manager");
  const titleOf = (sessionId) => sessionId.slice(0, 8);
  const mounting = installMounting(ctx, manager, deps);
  const borrowing = installBorrowing(ctx, manager, deps, {
    mountOf: (agent) => mounting.mountOf(agent),
    mountEvents: mounting.events,
    titleOf
  });
  installApi(ctx, manager, { mounting, borrowing, mountsDir });
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
