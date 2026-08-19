import { system, world } from "@minecraft/server";

const PROTOCOL_VERSION = 1;
const DATA_PROTOCOL_VERSION = 1;
const MAX_CHUNK_ENTRIES = 32;
const MAX_RESULT_LINES = 8;
const MAX_RESULT_MESSAGE_CHARS = 32768;
const PROVIDER_ID = /^[a-z0-9_.-]{1,64}$/i;
const VALID_KINDS = new Set(["entity", "block", "item"]);
const VALID_VISIBILITY = new Set(["always", "when_sneaking", "when_not_sneaking", "never"]);
const VALID_COLORS = new Set(["white", "gray", "dark_gray", "red", "green", "yellow", "aqua", "blue", "light_purple", "gold"]);

const clampPriority = value => Number.isFinite(Number(value))
  ? Math.max(-1000, Math.min(1000, Math.trunc(Number(value))))
  : 0;

function validate(definition) {
  if (!definition || typeof definition !== "object" || !PROVIDER_ID.test(definition.id ?? "")) {
    throw new TypeError("WATI Lens Provider: invalid provider id.");
  }
  if (!Array.isArray(definition.entries)) throw new TypeError("WATI Lens Provider: entries must be an array.");
  if (definition.entries.length > 1024) throw new RangeError("WATI Lens Provider: maximum 1024 entries.");
  for (const entry of definition.entries) {
    if (!entry || !VALID_KINDS.has(entry.kind) || typeof entry.id !== "string" || !entry.id.includes(":")) {
      throw new TypeError("WATI Lens Provider: every entry needs kind and namespaced id.");
    }
    if (entry.data !== undefined && typeof entry.data !== "function") {
      throw new TypeError("WATI Lens Provider: entry.data must be a function.");
    }
  }
}

function wireEntry(entry, providerPriority) {
  const { data, ...rest } = entry;
  return {
    ...rest,
    dynamicData: typeof data === "function",
    refreshTicks: Number.isInteger(entry.refreshTicks) ? Math.max(4, Math.min(200, entry.refreshTicks)) : 10,
    priority: entry.priority === undefined ? providerPriority : clampPriority(entry.priority)
  };
}

function buildContext(msg) {
  let viewer;
  let entity;
  let block;
  let itemStack;
  try { if (msg.u) viewer = world.getEntity(msg.u); } catch {}
  try { if (msg.e) entity = world.getEntity(msg.e); } catch {}
  if (msg.b && typeof msg.b === "object") {
    try {
      const dimension = world.getDimension(msg.b.d);
      block = dimension.getBlock({ x: Number(msg.b.x), y: Number(msg.b.y), z: Number(msg.b.z) });
    } catch {}
  }
  if (msg.k === "item" && entity) {
    try { itemStack = entity.getComponent("minecraft:item")?.itemStack; } catch {}
  }
  return Object.freeze({
    viewer,
    kind: msg.k,
    typeId: msg.i,
    canonicalKind: msg.ck,
    canonicalId: msg.ci,
    entity,
    block,
    itemStack,
    currentTick: system.currentTick
  });
}

function cleanLine(line) {
  if (!line || typeof line !== "object") return undefined;
  const label = typeof line.label === "string" ? line.label.slice(0, 80) : undefined;
  const labelKey = typeof line.labelKey === "string" ? line.labelKey.slice(0, 160) : undefined;
  const value = ["string","number","boolean"].includes(typeof line.value) ? String(line.value).slice(0, 160) : undefined;
  const valueKey = typeof line.valueKey === "string" ? line.valueKey.slice(0, 160) : undefined;
  if (!label && !labelKey && value === undefined && !valueKey) return undefined;
  return {
    id: typeof line.id === "string" ? line.id.slice(0, 64) : undefined,
    label,
    labelKey,
    value,
    valueKey,
    color: VALID_COLORS.has(line.color) ? line.color : "white",
    visibility: VALID_VISIBILITY.has(line.visibility) ? line.visibility : "always"
  };
}

function cleanEntity(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  if (Number.isFinite(Number(raw.armor))) out.armor = Math.max(0, Math.min(20, Math.round(Number(raw.armor))));
  if (raw.health && Number.isFinite(Number(raw.health.current)) && Number.isFinite(Number(raw.health.max)) && Number(raw.health.max) > 0) {
    out.health = { current: Math.max(0, Number(raw.health.current)), max: Math.max(1, Number(raw.health.max)) };
  }
  if (typeof raw.owner === "string") out.owner = raw.owner.slice(0, 80);
  if (typeof raw.tamed === "boolean") out.tamed = raw.tamed;
  if (typeof raw.baby === "boolean") out.baby = raw.baby;
  return Object.keys(out).length ? out : undefined;
}

function sanitizePayload(data) {
  if (!data || typeof data !== "object") return {};
  const payload = {};
  if (Array.isArray(data.lines)) payload.lines = data.lines.map(cleanLine).filter(Boolean).slice(0, MAX_RESULT_LINES);
  const entity = cleanEntity(data.entity);
  if (entity) payload.entity = entity;
  return payload;
}

function safeResult(providerId, requestId, ok, data, ttl, code) {
  try {
    let packet = {
      v: DATA_PROTOCOL_VERSION,
      p: providerId,
      r: requestId,
      ok,
      ...(ok ? { data: sanitizePayload(data), ttl } : { code: code ?? "provider_error" })
    };
    let serialized = JSON.stringify(packet);
    if (serialized.length > MAX_RESULT_MESSAGE_CHARS) {
      packet = { v: DATA_PROTOCOL_VERSION, p: providerId, r: requestId, ok: false, code: "result_too_large" };
      serialized = JSON.stringify(packet);
    }
    system.sendScriptEvent("wati_lens:data_result", serialized);
  } catch {}
}

export function createWatiLensProvider(definition) {
  validate(definition);
  const entries = definition.entries.map(e => Object.freeze({ ...e }));
  const frozen = Object.freeze({
    id: definition.id,
    priority: clampPriority(definition.priority),
    source: definition.source ?? {},
    entries
  });
  const dynamicByKey = new Map();
  for (const entry of entries) if (typeof entry.data === "function") dynamicByKey.set(`${entry.kind}\u0000${entry.id}`, entry);
  let sequence = 0;
  let active = true;

  function publish() {
    if (!active) return;
    const request = `${system.currentTick.toString(36)}${(++sequence).toString(36)}`;
    const token = `${frozen.id}.${request}`;
    const wireEntries = entries.map(entry => wireEntry(entry, frozen.priority));
    try {
      system.sendScriptEvent("wati_lens:provider_begin", JSON.stringify({
        v: PROTOCOL_VERSION, p: frozen.id, r: request, t: token, n: wireEntries.length,
        priority: frozen.priority, s: frozen.source
      }));
      for (let i = 0, q = 0; i < wireEntries.length; i += MAX_CHUNK_ENTRIES, q++) {
        system.sendScriptEvent("wati_lens:provider_chunk", JSON.stringify({
          v: PROTOCOL_VERSION, p: frozen.id, r: request, t: token, q, e: wireEntries.slice(i, i + MAX_CHUNK_ENTRIES)
        }));
      }
      system.sendScriptEvent("wati_lens:provider_commit", JSON.stringify({
        v: PROTOCOL_VERSION, p: frozen.id, r: request, t: token
      }));
    } catch {
      // Lens is optional. The source add-on must continue working without it.
    }
  }

  function dispose() {
    if (!active) return;
    active = false;
    const request = `${system.currentTick.toString(36)}${(++sequence).toString(36)}`;
    try {
      system.sendScriptEvent("wati_lens:provider_unregister", JSON.stringify({
        v: PROTOCOL_VERSION, p: frozen.id, r: request
      }));
    } catch {}
  }

  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (!active) return;
    if (event.id === "wati_lens:provider_discover") {
      try {
        const msg = JSON.parse(event.message);
        if (msg?.v === PROTOCOL_VERSION) system.run(publish);
      } catch {}
      return;
    }
    if (event.id !== "wati_lens:data_request") return;
    let msg;
    try { msg = JSON.parse(event.message); } catch { return; }
    if (msg?.v !== DATA_PROTOCOL_VERSION || msg.p !== frozen.id || typeof msg.r !== "string") return;
    const entry = dynamicByKey.get(`${msg.k}\u0000${msg.i}`) ?? dynamicByKey.get(`${msg.ck}\u0000${msg.ci}`);
    if (!entry || typeof entry.data !== "function") return;
    system.run(() => {
      if (!active) return;
      const started = Date.now();
      let value;
      try { value = entry.data(buildContext(msg)); }
      catch (error) {
        safeResult(frozen.id, msg.r, false, undefined, undefined, `callback_error:${String(error).slice(0,96)}`);
        return;
      }
      const finish = data => {
        const elapsed = Date.now() - started;
        if (elapsed > 25) console.warn(`[WATI Lens Provider:${frozen.id}] callback lento: ${elapsed} ms`);
        const ttl = Number.isInteger(data?.ttl)
          ? Math.max(4, Math.min(200, data.ttl))
          : (Number.isInteger(entry.refreshTicks) ? Math.max(4, Math.min(200, entry.refreshTicks)) : 10);
        safeResult(frozen.id, msg.r, true, data, ttl);
      };
      if (value && typeof value.then === "function") {
        value.then(finish).catch(error => safeResult(frozen.id, msg.r, false, undefined, undefined, `async_error:${String(error).slice(0,96)}`));
      } else finish(value);
    });
  }, { namespaces: ["wati_lens"] });

  system.run(publish);
  return Object.freeze({ publish, dispose, definition: frozen });
}
