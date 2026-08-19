import { system } from "@minecraft/server";

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_LENGTH = 7000;
const MAX_CHUNK_ENTRIES = 32;

function validToken(value) {
  return typeof value === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value);
}

function assertDefinition(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("WATI provider definition is required.");
  if (!validToken(definition.id)) throw new TypeError("WATI provider id is invalid.");
  if (!definition.source || typeof definition.source !== "object") throw new TypeError("WATI provider source is required.");
  if (!Array.isArray(definition.entries)) throw new TypeError("WATI provider entries must be an array.");
}

function encodedLength(value) {
  return JSON.stringify(value).length;
}

function makeChunks(providerId, entries) {
  const chunks = [];
  let current = [];
  for (const entry of entries) {
    const candidate = [...current, entry];
    const envelope = { v: PROTOCOL_VERSION, c: providerId, r: "chunk", entries: candidate };
    if (candidate.length > MAX_CHUNK_ENTRIES || encodedLength(envelope) > MAX_MESSAGE_LENGTH) {
      if (!current.length) throw new RangeError(`WATI provider entry is too large: ${entry?.id ?? entry?.i ?? "unknown"}`);
      chunks.push(current);
      current = [entry];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function rejectionDescription(message) {
  const details = [message.code ?? "unknown"];
  if (message.entryId) details.push(`entry=${message.entryId}`);
  if (Number.isInteger(message.entryIndex)) details.push(`index=${message.entryIndex}`);
  if (message.field) details.push(`field=${message.field}`);
  if (message.reason) details.push(`reason=${message.reason}`);
  if (message.maximum !== undefined) details.push(`maximum=${message.maximum}`);
  if (message.causeCode) details.push(`cause=${message.causeCode}`);
  return details.join(", ");
}

export function createWatiProvider(definition) {
  assertDefinition(definition);
  const providerId = definition.id;
  const chunks = makeChunks(providerId, definition.entries);
  let sequence = 0;
  let registering = false;
  let accepted = false;
  let lastResult;
  let activeTransaction;
  let rejectedPhase;

  function requestId(prefix) {
    sequence++;
    return `${prefix}${sequence.toString(36)}`;
  }

  function send(eventId, payload) {
    const message = JSON.stringify(payload);
    if (message.length > MAX_MESSAGE_LENGTH) throw new RangeError(`WATI provider message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
    system.sendScriptEvent(eventId, message);
  }

  function* registrationJob(transactionId) {
    try {
      send("wati:provider_begin", {
        v: PROTOCOL_VERSION,
        c: providerId,
        r: requestId("b"),
        t: transactionId,
        source: definition.source
      });
      yield;
      if (rejectedPhase === "begin") return;

      for (const entries of chunks) {
        send("wati:provider_chunk", {
          v: PROTOCOL_VERSION,
          c: providerId,
          r: requestId("d"),
          t: transactionId,
          entries
        });
        yield;
        if (rejectedPhase === "chunk") break;
      }

      send("wati:provider_commit", {
        v: PROTOCOL_VERSION,
        c: providerId,
        r: requestId("c"),
        t: transactionId
      });
    } catch (error) {
      console.warn(`[WATI Provider:${providerId}] Registration failed: ${error}`);
    } finally {
      registering = false;
      if (activeTransaction === transactionId) activeTransaction = undefined;
    }
  }

  function register() {
    if (registering) return false;

    // Lock synchronously before queuing the job. The previous SDK only locked
    // inside the generator, allowing startup and discovery to queue duplicate
    // registrations for the same provider.
    registering = true;
    accepted = false;
    rejectedPhase = undefined;
    const transactionId = requestId("t");
    activeTransaction = transactionId;

    try {
      system.runJob(registrationJob(transactionId));
      return true;
    } catch (error) {
      registering = false;
      activeTransaction = undefined;
      console.warn(`[WATI Provider:${providerId}] Could not queue registration: ${error}`);
      return false;
    }
  }

  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (event.id === "wati:provider_discover") {
      try {
        const message = JSON.parse(event.message);
        if (message?.v === PROTOCOL_VERSION) system.run(register);
      } catch {
        // Ignore malformed discovery messages.
      }
      return;
    }
    if (event.id !== "wati:provider_result") return;
    try {
      const message = JSON.parse(event.message);
      if (message?.v !== PROTOCOL_VERSION || message.c !== providerId) return;
      if (message.t && activeTransaction && message.t !== activeTransaction) return;
      lastResult = Object.freeze(message);
      if (message.ok !== true && (message.phase === "begin" || message.phase === "chunk")) {
        rejectedPhase = message.phase;
      }
      if (message.phase === "commit") accepted = message.ok === true;
      if (message.ok !== true) {
        console.warn(`[WATI Provider:${providerId}] ${message.phase ?? "request"} rejected: ${rejectionDescription(message)}`);
      }
    } catch {
      // Ignore results for other providers or invalid payloads.
    }
  }, { namespaces: ["wati"] });

  system.run(register);

  return Object.freeze({
    register,
    isAccepted: () => accepted,
    isRegistering: () => registering,
    lastResult: () => lastResult,
    protocolVersion: PROTOCOL_VERSION
  });
}
